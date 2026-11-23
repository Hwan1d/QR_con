    const socket = io();
    let authToken = localStorage.getItem('qr_auth_token') || '';
    let currentUser = null;
    let currentRoom = null;
    let targetSecretRoom = null;

    // 캔버스 렌더링
    const canvas = document.getElementById('world-canvas');
    const ctx = canvas.getContext('2d');
    const miniCanvas = document.getElementById('minimap-canvas');
    const miniCtx = miniCanvas.getContext('2d');

    const WORLD_W = 4000;
    const WORLD_H = 3000;
    const graffitiCanvas = document.createElement('canvas');
    graffitiCanvas.width = WORLD_W;
    graffitiCanvas.height = WORLD_H;
    const gCtx = graffitiCanvas.getContext('2d');

    // ⚡ [최적화 3번] 오프스크린 백그라운드 베이킹 레이어 (Baked Canvas Layer)
    // 수천 개의 오래된 스트로크를 단일 픽셀 비트맵으로 영구 압축하여
    // 60FPS 렌더 루프 및 재렌더링 시 O(1) 초고속 블릿 보장
    const bakedCanvas = document.createElement('canvas');
    bakedCanvas.width = WORLD_W;
    bakedCanvas.height = WORLD_H;
    const bCtx = bakedCanvas.getContext('2d');

    let bakedCount = 0;
    const CLIENT_BAKE_THRESHOLD = 80;

    function resetGraffitiBg() {
      bCtx.fillStyle = '#090b12';
      bCtx.fillRect(0, 0, WORLD_W, WORLD_H);
      bCtx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      bCtx.lineWidth = 1;
      for (let x = 0; x < WORLD_W; x += 80) {
        bCtx.beginPath(); bCtx.moveTo(x, 0); bCtx.lineTo(x, WORLD_H); bCtx.stroke();
      }
      for (let y = 0; y < WORLD_H; y += 80) {
        bCtx.beginPath(); bCtx.moveTo(0, y); bCtx.lineTo(WORLD_W, y); bCtx.stroke();
      }

      gCtx.clearRect(0, 0, WORLD_W, WORLD_H);
      gCtx.drawImage(bakedCanvas, 0, 0);
      bakedCount = 0;
    }
    resetGraffitiBg();

    let camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: 0.9 };
    let cameraFollow = true;
    let isDraggingCamera = false;
    let dragStartX = 0, dragStartY = 0;
    let livePlayers = [];

    function updateRecenterBtn() {
      const btn = document.getElementById('btn-camera-recenter');
      const floatBtn = document.getElementById('btn-recenter-float');
      if (btn) btn.style.display = cameraFollow ? 'none' : 'inline-block';
      if (floatBtn) floatBtn.style.opacity = cameraFollow ? '0.6' : '1.0';
    }

    function updateZoomDisplay() {
      const txt = document.getElementById('zoom-level-text');
      if (txt) txt.innerText = `${camera.zoom.toFixed(1)}x`;
    }

    function recenterCamera() {
      cameraFollow = true;
      camera.zoom = 0.9;
      updateRecenterBtn();
      updateZoomDisplay();
    }

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      miniCanvas.width = 180;
      miniCanvas.height = 135;
    }
    window.addEventListener('resize', resize);
    resize();

    // ====================================================
    // 1. 인증 & 로비 방 목록 제어
    // ====================================================
    function switchLobbyAuthTab(tab) {
      const isLogin = tab === 'login';
      document.getElementById('lobby-tab-btn-login').style.background = isLogin ? '#00f5d4' : 'transparent';
      document.getElementById('lobby-tab-btn-login').style.color = isLogin ? '#000' : '#888';
      document.getElementById('lobby-tab-btn-reg').style.background = !isLogin ? '#c084fc' : 'transparent';
      document.getElementById('lobby-tab-btn-reg').style.color = !isLogin ? '#000' : '#888';
      document.getElementById('lobby-form-login').style.display = isLogin ? 'block' : 'none';
      document.getElementById('lobby-form-reg').style.display = !isLogin ? 'block' : 'none';
      document.getElementById('lobby-auth-err').innerText = '';
    }

    async function handleLobbyLogin(e) {
      e.preventDefault();
      const userId = document.getElementById('lobby-login-id').value.trim();
      const password = document.getElementById('lobby-login-pw').value;
      const errBox = document.getElementById('lobby-auth-err');
      errBox.innerText = '로그인 중...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, password })
        });
        const data = await res.json();
        if (res.ok) {
          authToken = data.token;
          localStorage.setItem('qr_auth_token', authToken);
          errBox.innerText = '';
          await checkLobbyAuth();
        } else {
          errBox.innerText = data.error || '로그인 실패';
        }
      } catch (err) {
        errBox.innerText = '서버 연결 실패';
      }
    }

    async function handleLobbyRegister(e) {
      e.preventDefault();
      const userId = document.getElementById('lobby-reg-id').value.trim();
      const alias = document.getElementById('lobby-reg-alias').value.trim();
      const password = document.getElementById('lobby-reg-pw').value;
      const roleElem = document.querySelector('input[name="lobby-reg-role"]:checked');
      const role = roleElem ? roleElem.value : 'standard';
      const errBox = document.getElementById('lobby-auth-err');
      errBox.innerText = '회원가입 처리 중...';

      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, alias, password, role })
        });
        const data = await res.json();
        if (res.ok) {
          authToken = data.token;
          localStorage.setItem('qr_auth_token', authToken);
          errBox.innerText = '';
          await checkLobbyAuth();
        } else {
          errBox.innerText = data.error || '회원가입 실패';
        }
      } catch (err) {
        errBox.innerText = '서버 연결 실패';
      }
    }

    async function checkLobbyAuth() {
      const bar = document.getElementById('lobby-auth-status');
      if (!authToken) {
        document.getElementById('lobby-login-modal').style.display = 'flex';
        return;
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (data.loggedIn) {
          currentUser = data.user;
          const isVip = currentUser.role === 'vip';
          bar.innerHTML = `
            <span>👤 <strong>${currentUser.alias}</strong> (${isVip ? '<span style="color:#00f5d4;">VIP</span>' : '<span style="color:#f15bb5;">일반</span>'})</span>
            <button onclick="logoutLobby()" style="background:none; border:none; color:#888; font-size:12px; cursor:pointer; text-decoration:underline; margin-left:8px;">로그아웃</button>
          `;
          document.getElementById('lobby-login-modal').style.display = 'none';
          loadRoomsList();
        } else {
          document.getElementById('lobby-login-modal').style.display = 'flex';
        }
      } catch (e) {
        document.getElementById('lobby-login-modal').style.display = 'flex';
      }
    }

    async function quickLobbyAuth(userId) {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, password: '1234' })
        });
        const data = await res.json();
        if (res.ok) {
          authToken = data.token;
          localStorage.setItem('qr_auth_token', authToken);
          await checkLobbyAuth();
        } else {
          document.getElementById('lobby-auth-err').innerText = data.error;
        }
      } catch (e) {
        document.getElementById('lobby-auth-err').innerText = '로그인 오류';
      }
    }

    async function logoutLobby() {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
      } catch (e) {}
      authToken = '';
      localStorage.removeItem('qr_auth_token');
      currentUser = null;
      document.getElementById('lobby-login-modal').style.display = 'flex';
    }

    let currentRoomMode = 'free';
    let battlePhase = 'waiting';

    async function loadRoomsList() {
      try {
        const res = await fetch('/api/rooms');
        const rooms = await res.json();
        const container = document.getElementById('rooms-container');
        container.innerHTML = '';

        rooms.forEach(r => {
          const card = document.createElement('div');
          card.className = `room-card ${r.isSecret ? 'secret' : ''} ${r.isClosed ? 'closed' : ''}`;
          if (r.isClosed) {
            card.style.opacity = '0.75';
            card.style.borderColor = '#ef4444';
            card.style.background = 'rgba(239, 68, 68, 0.08)';
          }
          const isBattle = r.mode === 'battle';
          card.onclick = () => onSelectRoom(r);
          card.innerHTML = `
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <div style="display:flex; align-items:center; gap:6px;">
                  <span style="background:${r.isClosed ? '#ef4444' : (r.isSecret ? '#9333ea' : '#00bbf9')}; color:#fff; font-size:11px; font-weight:800; padding:2px 8px; border-radius:6px;">
                    ${r.code}
                  </span>
                  <span style="background:${isBattle ? 'linear-gradient(135deg, #ff0055, #00bbf9)' : '#7928ca'}; color:#fff; font-size:10px; font-weight:800; padding:2px 6px; border-radius:4px;">
                    ${isBattle ? '⚔️ 영역 점령전' : '🎨 자유 모드'}
                  </span>
                </div>
                <span style="font-size:12px; font-weight:700; color:${r.isClosed ? '#ef4444' : '#fff'};">
                  ${r.isClosed ? '⛔ 폐쇄됨(CLOSED)' : (r.isSecret ? '🔒 비밀방' : '🌐 공개방')}
                </span>
              </div>
              <h3 style="font-size:16px; color:#fff; margin-bottom:4px;">${r.title}</h3>
              <p style="font-size:12px; color:#aaa;">개설자: ${r.owner}</p>
            </div>
            <div style="font-size:11px; color:${r.isClosed ? '#ef4444' : '#00f5d4'}; margin-top:12px; display:flex; justify-content:space-between;">
              <span>누적 획: ${r.strokeCount}개</span>
              <span style="font-weight:bold;">${r.isClosed ? '⛔ 입장 불가' : '입장하기 →'}</span>
            </div>
          `;
          container.appendChild(card);
        });
      } catch (e) {
        console.error(e);
      }
    }

    function onSelectRoom(r) {
      if (r.isClosed) {
        const isAdmin = currentAuthUser && currentAuthUser.role === 'admin';
        if (!isAdmin) {
          alert('⛔ 관리자에 의해 폐쇄(CLOSED)된 방입니다. 일반 유저는 입장할 수 없습니다.');
          return;
        }
      }

      if (r.isSecret) {
        targetSecretRoom = r;
        document.getElementById('secret-target-room-name').innerText = `[${r.code}] ${r.title}`;
        document.getElementById('entry-secret-code').value = '';
        document.getElementById('secret-entry-modal').style.display = 'flex';
      } else {
        enterGameRoom(r.code, r.title, r.mode);
      }
    }

    async function submitSecretEntry() {
      const code = document.getElementById('entry-secret-code').value.trim();
      if (!code) { alert('비밀 코드를 입력하세요.'); return; }

      try {
        const res = await fetch('/api/rooms/verify-entry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify({ roomCode: targetSecretRoom.code, secretCode: code })
        });
        const data = await res.json();
        if (res.ok) {
          closeSecretEntryModal();
          enterGameRoom(targetSecretRoom.code, targetSecretRoom.title, data.room?.mode);
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('입장 검증 오류');
      }
    }
    function closeSecretEntryModal() { document.getElementById('secret-entry-modal').style.display = 'none'; }

    // 새 방 만들기 모달
    function openCreateRoomModal() { document.getElementById('create-room-modal').style.display = 'flex'; }
    function closeCreateRoomModal() { document.getElementById('create-room-modal').style.display = 'none'; }
    function toggleSecretInput(checked) {
      document.getElementById('secret-code-group').style.display = checked ? 'block' : 'none';
    }

    async function submitCreateRoom() {
      const code = document.getElementById('new-room-code').value.trim();
      const title = document.getElementById('new-room-title').value.trim();
      const isSecret = document.getElementById('new-room-is-secret').checked;
      const secretCode = document.getElementById('new-room-secret-code').value.trim();
      const mode = document.querySelector('input[name="new-room-mode"]:checked')?.value || 'free';

      if (!code) { alert('방 코드를 입력하세요.'); return; }
      if (isSecret && !secretCode) { alert('비밀방 코드를 입력하세요.'); return; }

      try {
        const res = await fetch('/api/rooms/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ code, title, isSecret, secretCode, mode })
        });
        const data = await res.json();
        if (res.ok) {
          closeCreateRoomModal();
          enterGameRoom(data.room.code, data.room.title, data.room.mode);
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('방 생성 오류');
      }
    }

    // ====================================================
    // 2. 인게임 캔버스 전환 & 카메라 플레이어 팔로우
    // ====================================================
    function enterGameRoom(roomCode, roomTitle, roomMode) {
      currentRoom = roomCode.toUpperCase();
      currentRoomMode = roomMode || 'free';
      battlePhase = 'waiting';

      document.getElementById('lobby-screen').style.display = 'none';
      document.getElementById('game-screen').style.display = 'block';

      document.getElementById('ingame-room-badge').innerText = `${currentRoom}${currentRoomMode === 'battle' ? ' ⚔️점령전' : ''}`;
      document.getElementById('ingame-room-title').innerText = roomTitle || `${currentRoom} 캔버스`;
      document.getElementById('modal-room-code-label').innerText = currentRoom;

      // 배틀 모드 전용 HUD 토글
      const battleHud = document.getElementById('battle-hud-overlay');
      if (battleHud) {
        battleHud.style.display = currentRoomMode === 'battle' ? 'block' : 'none';
        if (currentRoomMode === 'battle') {
          document.getElementById('battle-waiting-panel').style.display = 'flex';
          document.getElementById('battle-playing-panel').style.display = 'none';
          document.getElementById('battle-countdown-overlay').style.display = 'none';
          document.getElementById('battle-gameover-panel').style.display = 'none';
          // 카메라 중심 고정
          camera.x = 2000;
          camera.y = 1500;
          camera.zoom = 0.65;
          updateZoomDisplay();
        }
      }

      resetGraffitiBg();
      socket.emit('join-screen', { room: currentRoom, token: authToken });

      // URL 해시/파라미터 업데이트
      window.history.pushState({}, '', `?room=${encodeURIComponent(currentRoom)}`);
    }

    // 방 폐쇄 또는 세션 종료 통보 수신
    socket.on('room-session-ended', (data) => {
      alert(data.reason || '관리자에 의해 해당 방이 폐쇄되었거나 종료되었습니다.');
      leaveToLobby();
    });

    function leaveToLobby() {
      if (currentRoom) {
        socket.emit('screen-leave-room', { room: currentRoom });
      }
      document.getElementById('game-screen').style.display = 'none';
      document.getElementById('lobby-screen').style.display = 'flex';
      const battleHud = document.getElementById('battle-hud-overlay');
      if (battleHud) battleHud.style.display = 'none';
      currentRoom = null;
      currentRoomMode = 'free';
      loadRoomsList();
      window.history.pushState({}, '', window.location.pathname);
    }

    let currentStrokes = [];

    // DB 누적 캔버스 복원 (대용량 획 자동 분할 베이킹 적용)
    socket.on('init-canvas-history', (data) => {
      resetGraffitiBg();
      const allStrokes = data.strokes || [];
      if (allStrokes.length > 50) {
        // 50개 이상의 획은 오래된 획들을 백그라운드 베이킹 캔버스에 즉시 고정
        const toBake = allStrokes.slice(0, allStrokes.length - 30);
        currentStrokes = allStrokes.slice(allStrokes.length - 30);
        for (let i = 0; i < toBake.length; i++) {
          drawStroke(toBake[i], bCtx);
        }
        bakedCount = toBake.length;
        gCtx.drawImage(bakedCanvas, 0, 0);
        for (let i = 0; i < currentStrokes.length; i++) {
          drawStroke(currentStrokes[i], gCtx);
        }
      } else {
        currentStrokes = allStrokes;
        redrawAllStrokes();
      }
      if (data.splats) data.splats.forEach(sp => drawSplat(sp));
    });

    // 캔버스 전체 지우기 (방장 전용 동작 브로드캐스트 수신)
    socket.on('canvas-cleared-all', () => {
      currentStrokes = [];
      resetGraffitiBg();
    });

    // 실시간 지우개에 의한 부분 획 삭제 수신 (초고속 O(1) 복원)
    socket.on('strokes-erased', (data) => {
      if (!data.removedIds || data.removedIds.length === 0) return;
      const idSet = new Set(data.removedIds);
      currentStrokes = currentStrokes.filter(s => !idSet.has(s.id));
      // 베이킹 레이어 위에 남아있는 최근 활성 획들만 초고속(0.1ms) 재합성
      gCtx.clearRect(0, 0, WORLD_W, WORLD_H);
      gCtx.drawImage(bakedCanvas, 0, 0);
      for (let i = 0; i < currentStrokes.length; i++) {
        drawStroke(currentStrokes[i], gCtx);
      }
    });

    // 실시간 새 획 수신
    socket.on('live-stroke-drawn', (s) => {
      currentStrokes.push(s);
      drawStroke(s, gCtx);

      // 점진적 베이킹 (Incremental Baking): 80획 이상 쌓이면 오래된 40획을 베이킹 버퍼로 압축
      if (currentStrokes.length >= CLIENT_BAKE_THRESHOLD) {
        const toBake = currentStrokes.splice(0, 40);
        for (let i = 0; i < toBake.length; i++) {
          drawStroke(toBake[i], bCtx);
        }
        bakedCount += toBake.length;
      }
    });
    socket.on('canvas-splat', (sp) => drawSplat(sp));

    function redrawAllStrokes() {
      gCtx.clearRect(0, 0, WORLD_W, WORLD_H);
      gCtx.drawImage(bakedCanvas, 0, 0);
      for (let i = 0; i < currentStrokes.length; i++) {
        drawStroke(currentStrokes[i], gCtx);
      }
    }

    const stampImgCache = {};

    function drawStroke(s, targetCtx = gCtx) {
      if (s.type === 'stamp' && s.dataUrl) {
        drawStampOnGraffiti(s, targetCtx);
        return;
      }

      // 🐾 1. 페인트 발자국 렌더링
      if (s.type === 'trail_footprint') {
        targetCtx.save();
        targetCtx.translate(s.x, s.y);
        targetCtx.rotate((s.angle || 0) + Math.PI / 2); // 걷는 방향 정렬
        targetCtx.fillStyle = s.color || '#00f5d4';
        targetCtx.shadowColor = s.color || '#00f5d4';
        targetCtx.shadowBlur = 10;

        // 메인 발바닥 패드 (타원형)
        targetCtx.beginPath();
        targetCtx.ellipse(0, 0, 4, 5.5, 0, 0, Math.PI * 2);
        targetCtx.fill();

        // 앞 발가락 점 3개
        const toeOffsets = [-3.5, 0, 3.5];
        for (let i = 0; i < 3; i++) {
          targetCtx.beginPath();
          targetCtx.arc(toeOffsets[i], -8, 1.6, 0, Math.PI * 2);
          targetCtx.fill();
        }
        targetCtx.restore();
        return;
      }

      // ✨ 2. 네온 점선 렌더링
      if (s.type === 'trail_dot') {
        targetCtx.save();
        targetCtx.fillStyle = s.color || '#fee440';
        targetCtx.shadowColor = s.color || '#fee440';
        targetCtx.shadowBlur = 14;
        targetCtx.beginPath();
        targetCtx.arc(s.x, s.y, s.radius || 6, 0, Math.PI * 2);
        targetCtx.fill();
        targetCtx.restore();
        return;
      }

      // 💨 3. 스프레이 분사 렌더링
      if (s.type === 'trail_spray') {
        targetCtx.save();
        targetCtx.fillStyle = s.color || '#ff007f';
        targetCtx.shadowColor = s.color || '#ff007f';
        targetCtx.shadowBlur = 8;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
          const r = Math.random() * 11 + 2;
          const sz = Math.random() * 2 + 1;
          targetCtx.beginPath();
          targetCtx.arc(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, sz, 0, Math.PI * 2);
          targetCtx.fill();
        }
        targetCtx.restore();
        return;
      }

      // ⚔️ 4. 영역 점령전 페인트 롤러 (Battle Paint)
      if (s.type === 'battle_paint') {
        targetCtx.save();
        targetCtx.strokeStyle = s.color || (s.team === 'red' ? '#ff0055' : '#00bbf9');
        targetCtx.lineWidth = s.width || 44;
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';
        targetCtx.shadowColor = s.color || (s.team === 'red' ? '#ff0055' : '#00bbf9');
        targetCtx.shadowBlur = 10;
        targetCtx.beginPath();
        targetCtx.moveTo(s.x1, s.y1);
        targetCtx.lineTo(s.x2, s.y2);
        targetCtx.stroke();
        targetCtx.restore();
        return;
      }

      // 〰️ 5. 기본 네온 실선 (Solid Line)
      targetCtx.save();
      targetCtx.strokeStyle = s.color || '#00f5d4';
      targetCtx.lineWidth = s.width || 8;
      targetCtx.lineCap = 'round';
      targetCtx.lineJoin = 'round';
      targetCtx.shadowColor = s.color;
      targetCtx.shadowBlur = 12;
      targetCtx.beginPath();
      targetCtx.moveTo(s.x1, s.y1);
      targetCtx.lineTo(s.x2, s.y2);
      targetCtx.stroke();
      targetCtx.restore();
    }

    function drawStampOnGraffiti(s, targetCtx = gCtx) {
      let img = stampImgCache[s.id];
      if (!img) {
        img = new Image();
        img.src = s.dataUrl;
        img.onload = () => {
          stampImgCache[s.id] = img;
          renderStampImage(img, s, targetCtx);
        };
      } else if (img.complete) {
        renderStampImage(img, s, targetCtx);
      }
    }

    // 🎨 캔버스에 그린 그림 원본 그대로 도장 찍기
    function renderStampImage(img, s, targetCtx = gCtx) {
      targetCtx.save();
      targetCtx.imageSmoothingEnabled = false;
      targetCtx.drawImage(img, s.x, s.y, s.width, s.height);
      targetCtx.restore();
    }

    // 스탬프 도장 쾅 찍힘 수신
    socket.on('live-stamp-placed', (s) => {
      currentStrokes.push(s);
      drawStroke(s, gCtx);

      if (currentStrokes.length >= CLIENT_BAKE_THRESHOLD) {
        const toBake = currentStrokes.splice(0, 40);
        for (let i = 0; i < toBake.length; i++) {
          drawStroke(toBake[i], bCtx);
        }
        bakedCount += toBake.length;
      }
    });

    function drawSplat(sp) {
      gCtx.save();
      gCtx.fillStyle = sp.color;
      gCtx.shadowColor = sp.color;
      gCtx.shadowBlur = 24;
      gCtx.beginPath();
      gCtx.arc(sp.x, sp.y, sp.size * 0.6, 0, Math.PI * 2);
      gCtx.fill();
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * sp.size * 1.5;
        const r = Math.random() * (sp.size * 0.25) + 3;
        gCtx.beginPath();
        gCtx.arc(sp.x + Math.cos(a) * d, sp.y + Math.sin(a) * d, r, 0, Math.PI * 2);
        gCtx.fill();
      }
      gCtx.restore();
    }

    // 소켓 월드 틱
    socket.on('world-tick', (data) => {
      livePlayers = data.players;
    });

    // 메인 렌더 루프: 카메라 추적 및 60FPS 절두체 컬링(View Frustum Culling) 최적화
    function render() {
      if (document.getElementById('game-screen').style.display === 'block') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 내 캐릭터 추적: cameraFollow가 활성화되어 있을 때만 활성 유저 캐릭터 추적!
        if (cameraFollow) {
          const humanPlayers = livePlayers.filter(p => !p.isAi);
          if (humanPlayers.length > 0) {
            const targetPlayer = humanPlayers[humanPlayers.length - 1]; // 최근 활성 유저
            const lerp = 0.08;
            camera.x += (targetPlayer.x - camera.x) * lerp;
            camera.y += (targetPlayer.y - camera.y) * lerp;
          }
        }

        // [리팩토링 5번] ⚡ 뷰포트 절두체 컬링 (View Frustum Culling)
        // 화면 크기와 카메라 줌을 바탕으로 현재 시야 영역을 계산하여 해당 범위만 슬라이싱 렌더링
        const halfW = (canvas.width / 2) / camera.zoom;
        const halfH = (canvas.height / 2) / camera.zoom;
        const viewMinX = Math.max(0, Math.floor(camera.x - halfW - 80));
        const viewMinY = Math.max(0, Math.floor(camera.y - halfH - 80));
        const viewMaxX = Math.min(WORLD_W, Math.ceil(camera.x + halfW + 80));
        const viewMaxY = Math.min(WORLD_H, Math.ceil(camera.y + halfH + 80));
        const viewW = viewMaxX - viewMinX;
        const viewH = viewMaxY - viewMinY;

        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-camera.x, -camera.y);

        // 오프스크린 그래피티 캔버스 렌더링 - 4000x3000 전체가 아닌 현재 시야(Frustum)만 초고속 블릿!
        if (viewW > 0 && viewH > 0) {
          ctx.drawImage(graffitiCanvas, viewMinX, viewMinY, viewW, viewH, viewMinX, viewMinY, viewW, viewH);
        }

        // 캔버스 테두리
        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

        // ⚔️ 영역 점령전(Battle Mode): 원형 경기장 테두리 및 대기 원형 존 시각화
        if (currentRoomMode === 'battle') {
          const ARENA_CX = 2000, ARENA_CY = 1500, ARENA_RADIUS = 1000, LOBBY_RADIUS = 360;

          // 원형 경기장 거대 네온 테두리
          ctx.save();
          ctx.strokeStyle = '#fee440';
          ctx.lineWidth = 8;
          ctx.shadowColor = '#fee440';
          ctx.shadowBlur = 24;
          ctx.beginPath();
          ctx.arc(ARENA_CX, ARENA_CY, ARENA_RADIUS, 0, Math.PI * 2);
          ctx.stroke();

          // 경기장 바깥 어두운 마스킹 비네팅
          ctx.strokeStyle = 'rgba(5, 7, 15, 0.92)';
          ctx.lineWidth = 1400;
          ctx.beginPath();
          ctx.arc(ARENA_CX, ARENA_CY, ARENA_RADIUS + 700, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          // 대기 단계(waiting/countdown)일 때 중앙 원형 로비 존 그리기
          if (battlePhase === 'waiting' || battlePhase === 'countdown') {
            ctx.save();
            // 좌측 RED 팀 반원
            ctx.fillStyle = 'rgba(255, 0, 85, 0.22)';
            ctx.beginPath();
            ctx.arc(ARENA_CX, ARENA_CY, LOBBY_RADIUS, Math.PI / 2, Math.PI * 1.5);
            ctx.fill();

            // 우측 BLUE 팀 반원
            ctx.fillStyle = 'rgba(0, 187, 249, 0.22)';
            ctx.beginPath();
            ctx.arc(ARENA_CX, ARENA_CY, LOBBY_RADIUS, -Math.PI / 2, Math.PI / 2);
            ctx.fill();

            // 대기 원 외곽 네온 점선
            ctx.strokeStyle = '#00f5d4';
            ctx.lineWidth = 4;
            ctx.setLineDash([12, 10]);
            ctx.beginPath();
            ctx.arc(ARENA_CX, ARENA_CY, LOBBY_RADIUS, 0, Math.PI * 2);
            ctx.stroke();

            // 중앙 팀 분할선
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(ARENA_CX, ARENA_CY - LOBBY_RADIUS);
            ctx.lineTo(ARENA_CX, ARENA_CY + LOBBY_RADIUS);
            ctx.stroke();
            ctx.setLineDash([]);

            // 바닥 진영 텍스트
            ctx.font = '900 24px Pretendard, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#ff0055';
            ctx.fillText('🔴 RED ZONE', ARENA_CX - 170, ARENA_CY - 10);
            ctx.font = '800 13px Pretendard, sans-serif';
            ctx.fillStyle = '#fca5a5';
            ctx.fillText('서 있으면 RED 팀 배정', ARENA_CX - 170, ARENA_CY + 18);

            ctx.font = '900 24px Pretendard, sans-serif';
            ctx.fillStyle = '#00bbf9';
            ctx.fillText('BLUE ZONE 🔵', ARENA_CX + 170, ARENA_CY - 10);
            ctx.font = '800 13px Pretendard, sans-serif';
            ctx.fillStyle = '#bae6fd';
            ctx.fillText('서 있으면 BLUE 팀 배정', ARENA_CX + 170, ARENA_CY + 18);

            ctx.restore();
          }
        }

        // 실시간 캐릭터 렌더링 (시야 밖의 플레이어는 렌더링 패스 스킵)
        for (const p of livePlayers) {
          if (p.x < viewMinX - 100 || p.x > viewMaxX + 100 || p.y < viewMinY - 100 || p.y > viewMaxY + 100) {
            continue;
          }
          ctx.save();
          ctx.translate(p.x, p.y);

          if (p.isErasing) {
            // 🧽 지우개 모드: 선택한 크기의 점선 원 영역 시각화
            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([6, 6]);
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(0, 0, p.eraserRadius || 30, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            // 내부 코어
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.arc(0, 0, 14, 0, Math.PI * 2);
            ctx.fill();

            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🧽', 0, 6);
          } else {
            // 일반 네온 발광 오라 (투명 상태면 점선/반투명 아우라로 표시하여 이동 중임을 알림)
            const isTransparent = p.color === 'transparent';
            ctx.fillStyle = isTransparent ? 'rgba(255, 255, 255, 0.25)' : p.color;
            ctx.shadowColor = isTransparent ? '#ffffff' : p.color;
            ctx.shadowBlur = isTransparent ? 10 : 24;
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.fill();

            // 캐릭터 내부 코어
            ctx.fillStyle = isTransparent ? '#888888' : '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 10, 0, Math.PI * 2);
            ctx.fill();
          }

          // 닉네임 및 팀 라벨
          if (p.team) {
            ctx.font = '900 12px Pretendard, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = p.team === 'red' ? '#ff0055' : '#00bbf9';
            ctx.fillText(p.team === 'red' ? '🔴 RED' : '🔵 BLUE', 0, -44);
          }

          ctx.font = 'bold 14px Pretendard, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#000000';
          ctx.shadowBlur = 6;
          ctx.fillText((p.isAi ? '🤖 ' : '') + (p.nickname || 'Artist') + (p.isErasing ? ` (🧽${p.eraserRadius || 30}px)` : ''), 0, -28);

          // AI 봇 또는 플레이어 말풍선 (Gemini 응답 말풍선)
          if (p.bubbleText) {
            ctx.save();
            ctx.font = 'bold 13px Pretendard, sans-serif';
            const metrics = ctx.measureText(p.bubbleText);
            const padX = 14;
            const bubbleW = metrics.width + padX * 2;
            const bubbleH = 28;
            const bubbleY = -72;

            ctx.fillStyle = 'rgba(15, 12, 32, 0.94)';
            ctx.strokeStyle = '#c084fc';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#c084fc';
            ctx.shadowBlur = 14;

            // 말풍선 사각 박스
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(-bubbleW / 2, bubbleY, bubbleW, bubbleH, 10);
            } else {
              ctx.rect(-bubbleW / 2, bubbleY, bubbleW, bubbleH);
            }
            ctx.fill();
            ctx.stroke();

            // 말풍선 꼬리표
            ctx.beginPath();
            ctx.moveTo(-6, bubbleY + bubbleH);
            ctx.lineTo(0, bubbleY + bubbleH + 7);
            ctx.lineTo(6, bubbleY + bubbleH);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // 텍스트
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 0;
            ctx.fillText(p.bubbleText, 0, bubbleY + 18);
            ctx.restore();
          }

          ctx.restore();
        }

        ctx.restore();
        renderMinimap();
        renderAiPip();
      }
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    function renderAiPip() {
      const activeAiBot = livePlayers.find(p => p.isAi);
      const pipCard = document.getElementById('ai-pip-card');
      if (activeAiBot) {
        if (pipCard.style.display === 'none') pipCard.style.display = 'block';
        document.getElementById('ai-pip-title').innerText = `🤖 ${activeAiBot.nickname} 드로잉 LIVE`;
        if (activeAiBot.bubbleText) {
          document.getElementById('ai-pip-prompt').innerText = activeAiBot.bubbleText.replace('🎨 ', '').replace(' 그리는 중!', '');
        }

        const pipCanvas = document.getElementById('ai-pip-canvas');
        const pCtx = pipCanvas.getContext('2d');
        pCtx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);

        pCtx.save();
        pCtx.translate(pipCanvas.width / 2, pipCanvas.height / 2);
        // AI 봇을 적절한 배율(1.6x)로 클로즈업
        const pipZoom = 1.6;
        pCtx.scale(pipZoom, pipZoom);
        pCtx.translate(-activeAiBot.x, -activeAiBot.y);

        // 캔버스 배경 및 전체 선 렌더링
        pCtx.drawImage(graffitiCanvas, 0, 0);

        // AI 봇 아티스트 본체 렌더링
        pCtx.save();
        pCtx.translate(activeAiBot.x, activeAiBot.y);
        pCtx.beginPath();
        pCtx.arc(0, 0, 16, 0, Math.PI * 2);
        pCtx.fillStyle = activeAiBot.color || '#a855f7';
        pCtx.shadowColor = activeAiBot.color || '#a855f7';
        pCtx.shadowBlur = 18;
        pCtx.fill();

        // 봇 눈 모양
        pCtx.fillStyle = '#ffffff';
        pCtx.beginPath();
        pCtx.arc(-5, -3, 3, 0, Math.PI * 2);
        pCtx.arc(5, -3, 3, 0, Math.PI * 2);
        pCtx.fill();

        // 봇 말풍선
        if (activeAiBot.bubbleText) {
          pCtx.font = 'bold 12px sans-serif';
          pCtx.fillStyle = '#ffffff';
          pCtx.textAlign = 'center';
          pCtx.shadowColor = '#000000';
          pCtx.shadowBlur = 6;
          pCtx.fillText(activeAiBot.bubbleText, 0, -24);
        }
        pCtx.restore();

        pCtx.restore();
      } else {
        if (pipCard.style.display !== 'none') pipCard.style.display = 'none';
      }
    }

    function renderMinimap() {
      miniCtx.clearRect(0, 0, 180, 135);
      miniCtx.drawImage(graffitiCanvas, 0, 0, 180, 135);
      miniCtx.strokeStyle = 'rgba(0, 245, 212, 0.4)';
      miniCtx.strokeRect(0, 0, 180, 135);

      for (const p of livePlayers) {
        const mx = (p.x / WORLD_W) * 180;
        const my = (p.y / WORLD_H) * 135;
        miniCtx.fillStyle = p.color;
        miniCtx.shadowColor = p.color;
        miniCtx.shadowBlur = 6;
        miniCtx.beginPath();
        miniCtx.arc(mx, my, 4, 0, Math.PI * 2);
        miniCtx.fill();
      }

      const vx = ((camera.x - (canvas.width / 2 / camera.zoom)) / WORLD_W) * 180;
      const vy = ((camera.y - (canvas.height / 2 / camera.zoom)) / WORLD_H) * 135;
      const vw = ((canvas.width / camera.zoom) / WORLD_W) * 180;
      const vh = ((canvas.height / camera.zoom) / WORLD_H) * 135;
      miniCtx.strokeStyle = '#ffffff';
      miniCtx.lineWidth = 1.5;
      miniCtx.strokeRect(vx, vy, vw, vh);
    }

    // ====================================================
    // 3. QR 모달 & 가상 컨트롤러
    // ====================================================
    function openQrModal() {
      fetch(`/api/qr?room=${encodeURIComponent(currentRoom)}`)
        .then(r => r.json())
        .then(data => {
          const container = document.getElementById('modal-qr-container');
          container.innerHTML = '';
          new QRCode(container, {
            text: data.controllerUrl,
            width: 220,
            height: 220,
            colorDark: '#000000',
            colorLight: '#ffffff'
          });
          document.getElementById('modal-qr-url').innerText = data.controllerUrl;
          document.getElementById('qr-modal').style.display = 'flex';
        });
    }
    function closeQrModal() { document.getElementById('qr-modal').style.display = 'none'; }

    function toggleVirtualController() {
      const container = document.getElementById('virtual-phone-container');
      const frame = document.getElementById('virtual-phone-frame');
      const isHidden = container.style.display === 'none' || !container.style.display;
      if (isHidden) {
        frame.src = `controller.html?room=${encodeURIComponent(currentRoom)}`;
        container.style.display = 'flex';
      } else {
        container.style.display = 'none';
        frame.src = '';
      }
    }

    function openControllerNewTab() {
      window.open(`/controller.html?room=${encodeURIComponent(currentRoom)}`, '_blank', 'width=420,height=750');
    }

    // ====================================================
    // 4. AI 큐레이터 실시간 비평 배너
    // ====================================================
    const docentBanner = document.getElementById('ai-docent-banner');
    const commentText = document.getElementById('ai-comment-text');
    const metaTag = document.getElementById('ai-meta-tag');
    let bannerTimer = null;

    socket.on('ai-docent-broadcast', (data) => {
      commentText.innerText = data.comment;
      metaTag.innerText = `분석 아티스트: ${data.author || 'AI'}`;
      docentBanner.style.display = 'block';

      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => docentBanner.style.display = 'none', 8000);
    });

    // 📢 관리자 긴급 공지 브로드캐스트 수신
    socket.on('admin-announcement-broadcast', (data) => {
      if (!data || !data.message) return;
      let banner = document.getElementById('admin-broadcast-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'admin-broadcast-banner';
        banner.style.position = 'fixed';
        banner.style.top = '20px';
        banner.style.left = '50%';
        banner.style.transform = 'translateX(-50%)';
        banner.style.zIndex = '99999';
        banner.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(185, 28, 28, 0.95))';
        banner.style.color = '#fff';
        banner.style.padding = '14px 32px';
        banner.style.borderRadius = '30px';
        banner.style.boxShadow = '0 8px 32px rgba(239, 68, 68, 0.6), 0 0 20px rgba(255, 255, 255, 0.4)';
        banner.style.border = '2px solid #fca5a5';
        banner.style.fontWeight = '800';
        banner.style.fontSize = '16px';
        banner.style.backdropFilter = 'blur(10px)';
        banner.style.display = 'flex';
        banner.style.alignItems = 'center';
        banner.style.gap = '12px';
        banner.style.transition = 'all 0.3s ease';
        document.body.appendChild(banner);
      }
      banner.innerHTML = `<span style="font-size:20px;">📢</span> <span>[긴급 관리자 공지]</span> <span style="font-weight:600; color:#fef08a;">${data.message}</span>`;
      banner.style.display = 'flex';
      banner.style.opacity = '1';
      if (window.adminBannerTimeout) clearTimeout(window.adminBannerTimeout);
      window.adminBannerTimeout = setTimeout(() => {
        banner.style.opacity = '0';
        setTimeout(() => banner.style.display = 'none', 300);
      }, 10000);
    });

    // ====================================================
    // ⚔️ 영역 점령전(Battle Mode) 소켓 리스너 & 컨트롤러
    // ====================================================
    function triggerStartBattle() {
      socket.emit('start-battle');
    }
    function triggerResetBattle() {
      socket.emit('reset-battle');
    }

    socket.on('battle-state-update', (data) => {
      battlePhase = data.phase || 'waiting';
      updateBattleUI(data);
    });

    socket.on('battle-teams-updated', (data) => {
      const redEl = document.getElementById('battle-red-count');
      const blueEl = document.getElementById('battle-blue-count');
      if (redEl) redEl.innerText = data.redCount || 0;
      if (blueEl) blueEl.innerText = data.blueCount || 0;
    });

    socket.on('battle-countdown', (data) => {
      battlePhase = 'countdown';
      document.getElementById('battle-waiting-panel').style.display = 'none';
      document.getElementById('battle-playing-panel').style.display = 'none';
      document.getElementById('battle-gameover-panel').style.display = 'none';
      const cdEl = document.getElementById('battle-countdown-overlay');
      if (cdEl) {
        cdEl.style.display = 'block';
        cdEl.innerText = data.count > 0 ? data.count : 'START!';
      }
    });

    socket.on('battle-started', (data) => {
      battlePhase = 'playing';
      currentStrokes = [];
      resetGraffitiBg();

      const cdEl = document.getElementById('battle-countdown-overlay');
      if (cdEl) cdEl.style.display = 'none';
      document.getElementById('battle-waiting-panel').style.display = 'none';
      document.getElementById('battle-gameover-panel').style.display = 'none';
      document.getElementById('battle-playing-panel').style.display = 'flex';

      document.getElementById('battle-playing-timer').innerText = `⏱️ 01:00`;
      const { red, blue } = getBattlePercentages(data);
      document.getElementById('battle-playing-red-pct').innerText = `${red}%`;
      document.getElementById('battle-playing-blue-pct').innerText = `${blue}%`;
      document.getElementById('battle-bar-red').style.width = `${red}%`;
      document.getElementById('battle-bar-blue').style.width = `${blue}%`;
    });

    function getBattlePercentages(data) {
      let r = 50;
      let b = 50;
      if (data) {
        if (typeof data.redPercent === 'number' && !isNaN(data.redPercent)) r = data.redPercent;
        else if (typeof data.redPct === 'number' && !isNaN(data.redPct)) r = data.redPct;
        if (typeof data.bluePercent === 'number' && !isNaN(data.bluePercent)) b = data.bluePercent;
        else if (typeof data.bluePct === 'number' && !isNaN(data.bluePct)) b = data.bluePct;
      }
      r = Math.max(0, Math.min(100, Math.round(r)));
      b = Math.max(0, Math.min(100, Math.round(b)));
      return { red: r, blue: b };
    }

    socket.on('battle-tick', (data) => {
      const mins = Math.floor(data.timer / 60).toString().padStart(2, '0');
      const secs = (data.timer % 60).toString().padStart(2, '0');
      const timerEl = document.getElementById('battle-playing-timer');
      if (timerEl) timerEl.innerText = `⏱️ ${mins}:${secs}`;
      const { red, blue } = getBattlePercentages(data);
      const redPct = document.getElementById('battle-playing-red-pct');
      const bluePct = document.getElementById('battle-playing-blue-pct');
      if (redPct) redPct.innerText = `${red}%`;
      if (bluePct) bluePct.innerText = `${blue}%`;
      const barRed = document.getElementById('battle-bar-red');
      const barBlue = document.getElementById('battle-bar-blue');
      if (barRed) barRed.style.width = `${red}%`;
      if (barBlue) barBlue.style.width = `${blue}%`;
    });

    socket.on('battle-game-over', (data) => {
      battlePhase = 'ended';
      document.getElementById('battle-playing-panel').style.display = 'none';
      const goPanel = document.getElementById('battle-gameover-panel');
      if (goPanel) goPanel.style.display = 'flex';
      const titleEl = document.getElementById('battle-winner-title');
      if (titleEl) {
        if (data.winner === 'red') {
          titleEl.innerHTML = '🏆 <span style="color:#ff0055;">RED 팀 대승리!</span>';
        } else if (data.winner === 'blue') {
          titleEl.innerHTML = '🏆 <span style="color:#00bbf9;">BLUE 팀 대승리!</span>';
        } else {
          titleEl.innerHTML = '🤝 <span style="color:#fee440;">무승부 (DRAW)!</span>';
        }
      }
      const { red, blue } = getBattlePercentages(data);
      const scoreEl = document.getElementById('battle-final-scores');
      if (scoreEl) scoreEl.innerText = `최종 점유율: RED ${red}% vs BLUE ${blue}%`;
    });

    socket.on('battle-reset', (data) => {
      battlePhase = 'waiting';
      currentStrokes = [];
      resetGraffitiBg();
      document.getElementById('battle-gameover-panel').style.display = 'none';
      document.getElementById('battle-playing-panel').style.display = 'none';
      document.getElementById('battle-countdown-overlay').style.display = 'none';
      document.getElementById('battle-waiting-panel').style.display = 'flex';
      const redEl = document.getElementById('battle-red-count');
      const blueEl = document.getElementById('battle-blue-count');
      if (redEl) redEl.innerText = data.redCount || 0;
      if (blueEl) blueEl.innerText = data.blueCount || 0;
    });

    function updateBattleUI(data) {
      if (data.phase === 'waiting') {
        document.getElementById('battle-waiting-panel').style.display = 'flex';
        document.getElementById('battle-playing-panel').style.display = 'none';
        document.getElementById('battle-countdown-overlay').style.display = 'none';
        document.getElementById('battle-gameover-panel').style.display = 'none';
        const redEl = document.getElementById('battle-red-count');
        const blueEl = document.getElementById('battle-blue-count');
        if (redEl) redEl.innerText = data.redCount || 0;
        if (blueEl) blueEl.innerText = data.blueCount || 0;
      } else if (data.phase === 'playing') {
        document.getElementById('battle-waiting-panel').style.display = 'none';
        document.getElementById('battle-playing-panel').style.display = 'flex';
        document.getElementById('battle-gameover-panel').style.display = 'none';
        document.getElementById('battle-countdown-overlay').style.display = 'none';
      }
    }

    // ====================================================
    // [리팩토링 7번] 🎮 대형 화면 자유 관전 컨트롤러 (마우스 휠 줌 & 드래그 패닝 & 복귀)
    // ====================================================
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      camera.zoom = Math.max(0.3, Math.min(3.0, camera.zoom * zoomFactor));
      updateZoomDisplay();
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // 좌클릭 드래그
        isDraggingCamera = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingCamera) {
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        if (Math.hypot(dx, dy) > 4) {
          cameraFollow = false;
          updateRecenterBtn();
        }
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
        camera.x = Math.max(0, Math.min(WORLD_W, camera.x));
        camera.y = Math.max(0, Math.min(WORLD_H, camera.y));
        dragStartX = e.clientX;
        dragStartY = e.clientY;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingCamera) {
        isDraggingCamera = false;
        canvas.style.cursor = 'default';
      }
    });

    canvas.addEventListener('dblclick', () => {
      recenterCamera();
    });

    // 시작 시 인증 및 로비 확인
    checkLobbyAuth();

    // 만약 URL 파라미터에 이미 ?room=... 이 지정되어 들어온 경우 바로 입장 지원
    const urlParams = new URLSearchParams(window.location.search);
    const initialRoomParam = urlParams.get('room');
    if (initialRoomParam && authToken) {
      enterGameRoom(initialRoomParam, initialRoomParam);
    }
