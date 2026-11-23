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

    function resetGraffitiBg() {
      gCtx.fillStyle = '#090b12';
      gCtx.fillRect(0, 0, WORLD_W, WORLD_H);
      gCtx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      gCtx.lineWidth = 1;
      for (let x = 0; x < WORLD_W; x += 80) {
        gCtx.beginPath(); gCtx.moveTo(x, 0); gCtx.lineTo(x, WORLD_H); gCtx.stroke();
      }
      for (let y = 0; y < WORLD_H; y += 80) {
        gCtx.beginPath(); gCtx.moveTo(0, y); gCtx.lineTo(WORLD_W, y); gCtx.stroke();
      }
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
          card.onclick = () => onSelectRoom(r);
          card.innerHTML = `
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <span style="background:${r.isClosed ? '#ef4444' : (r.isSecret ? '#9333ea' : '#00bbf9')}; color:#fff; font-size:11px; font-weight:800; padding:2px 8px; border-radius:6px;">
                  ${r.code}
                </span>
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
        enterGameRoom(r.code, r.title);
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
          enterGameRoom(targetSecretRoom.code, targetSecretRoom.title);
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

      if (!code) { alert('방 코드를 입력하세요.'); return; }
      if (isSecret && !secretCode) { alert('비밀방 코드를 입력하세요.'); return; }

      try {
        const res = await fetch('/api/rooms/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ code, title, isSecret, secretCode })
        });
        const data = await res.json();
        if (res.ok) {
          closeCreateRoomModal();
          enterGameRoom(data.room.code, data.room.title);
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
    function enterGameRoom(roomCode, roomTitle) {
      currentRoom = roomCode.toUpperCase();
      document.getElementById('lobby-screen').style.display = 'none';
      document.getElementById('game-screen').style.display = 'block';

      document.getElementById('ingame-room-badge').innerText = currentRoom;
      document.getElementById('ingame-room-title').innerText = roomTitle || `${currentRoom} 캔버스`;
      document.getElementById('modal-room-code-label').innerText = currentRoom;

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
        // 대형 화면이 로비로 나갈 때 컨트롤러들에게 방 세션 종료 통보
        socket.emit('screen-leave-room', { room: currentRoom });
      }
      document.getElementById('game-screen').style.display = 'none';
      document.getElementById('lobby-screen').style.display = 'flex';
      currentRoom = null;
      loadRoomsList();
      window.history.pushState({}, '', window.location.pathname);
    }

    let currentStrokes = [];

    // DB 누적 캔버스 복원
    socket.on('init-canvas-history', (data) => {
      currentStrokes = data.strokes || [];
      redrawAllStrokes();
      if (data.splats) data.splats.forEach(sp => drawSplat(sp));
    });

    // 캔버스 전체 지우기 (방장 전용 동작 브로드캐스트 수신)
    socket.on('canvas-cleared-all', () => {
      currentStrokes = [];
      resetGraffitiBg();
    });

    // 실시간 지우개에 의한 부분 획 삭제 수신
    socket.on('strokes-erased', (data) => {
      if (!data.removedIds || data.removedIds.length === 0) return;
      const idSet = new Set(data.removedIds);
      currentStrokes = currentStrokes.filter(s => !idSet.has(s.id));
      redrawAllStrokes();
    });

    socket.on('live-stroke-drawn', (s) => {
      currentStrokes.push(s);
      drawStroke(s);
    });
    socket.on('canvas-splat', (sp) => drawSplat(sp));

    function redrawAllStrokes() {
      resetGraffitiBg();
      for (let i = 0; i < currentStrokes.length; i++) {
        drawStroke(currentStrokes[i]);
      }
    }

    const stampImgCache = {};

    function drawStroke(s) {
      if (s.type === 'stamp' && s.dataUrl) {
        drawStampOnGraffiti(s);
        return;
      }

      // 🐾 1. 페인트 발자국 렌더링
      if (s.type === 'trail_footprint') {
        gCtx.save();
        gCtx.translate(s.x, s.y);
        gCtx.rotate((s.angle || 0) + Math.PI / 2); // 걷는 방향 정렬
        gCtx.fillStyle = s.color || '#00f5d4';
        gCtx.shadowColor = s.color || '#00f5d4';
        gCtx.shadowBlur = 10;

        // 메인 발바닥 패드 (타원형)
        gCtx.beginPath();
        gCtx.ellipse(0, 0, 4, 5.5, 0, 0, Math.PI * 2);
        gCtx.fill();

        // 앞 발가락 점 3개
        const toeOffsets = [-3.5, 0, 3.5];
        for (let i = 0; i < 3; i++) {
          gCtx.beginPath();
          gCtx.arc(toeOffsets[i], -8, 1.6, 0, Math.PI * 2);
          gCtx.fill();
        }
        gCtx.restore();
        return;
      }

      // ✨ 2. 네온 점선 렌더링
      if (s.type === 'trail_dot') {
        gCtx.save();
        gCtx.fillStyle = s.color || '#fee440';
        gCtx.shadowColor = s.color || '#fee440';
        gCtx.shadowBlur = 14;
        gCtx.beginPath();
        gCtx.arc(s.x, s.y, s.radius || 6, 0, Math.PI * 2);
        gCtx.fill();
        gCtx.restore();
        return;
      }

      // 💨 3. 스프레이 분사 렌더링
      if (s.type === 'trail_spray') {
        gCtx.save();
        gCtx.fillStyle = s.color || '#ff007f';
        gCtx.shadowColor = s.color || '#ff007f';
        gCtx.shadowBlur = 8;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
          const r = Math.random() * 11 + 2;
          const sz = Math.random() * 2 + 1;
          gCtx.beginPath();
          gCtx.arc(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, sz, 0, Math.PI * 2);
          gCtx.fill();
        }
        gCtx.restore();
        return;
      }

      // 〰️ 4. 기본 네온 실선 (Solid Line)
      gCtx.save();
      gCtx.strokeStyle = s.color || '#00f5d4';
      gCtx.lineWidth = s.width || 8;
      gCtx.lineCap = 'round';
      gCtx.lineJoin = 'round';
      gCtx.shadowColor = s.color;
      gCtx.shadowBlur = 12;
      gCtx.beginPath();
      gCtx.moveTo(s.x1, s.y1);
      gCtx.lineTo(s.x2, s.y2);
      gCtx.stroke();
      gCtx.restore();
    }

    function drawStampOnGraffiti(s) {
      let img = stampImgCache[s.id];
      if (!img) {
        img = new Image();
        img.src = s.dataUrl;
        img.onload = () => {
          stampImgCache[s.id] = img;
          renderStampImage(img, s);
        };
      } else if (img.complete) {
        renderStampImage(img, s);
      }
    }

    // 🎨 캔버스에 그린 그림 원본 그대로 도장 찍기 (스플래시나 흩뿌림 없이 그림 자체만 선명하게 각인)
    function renderStampImage(img, s) {
      gCtx.save();
      // 픽셀 아트와 벡터 브러시 모두 뭉개짐 없이 선명하게 렌더링
      gCtx.imageSmoothingEnabled = false;
      gCtx.drawImage(img, s.x, s.y, s.width, s.height);
      gCtx.restore();
    }

    // 스탬프 도장 쾅 찍힘 수신
    socket.on('live-stamp-placed', (s) => {
      currentStrokes.push(s);
      drawStroke(s);
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

          // 닉네임 라벨
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
