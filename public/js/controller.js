    const socket = io();
    const params = new URLSearchParams(window.location.search);
    let currentRoom = (params.get('room') || 'LOBBY').toUpperCase();

    let myColor = '#00f5d4';
    let myNickname = 'Artist';
    let currentAngle = 0;
    let currentIntensity = 0;
    let authToken = localStorage.getItem('qr_auth_token') || '';
    let currentAuthUser = null;
    let isRoomOwner = false;

    document.getElementById('room-code-tag').innerText = currentRoom;

    function joinGameRoom() {
      socket.emit('join-controller', {
        room: currentRoom,
        nickname: myNickname,
        color: myColor,
        userId: currentAuthUser ? currentAuthUser.userId : 'guest'
      });
      checkRoomOwnerStatus();
    }
    socket.on('connect', joinGameRoom);

    // 듀얼 모드 전환
    function switchMode(mode) {
      document.getElementById('tab-joystick').classList.toggle('active', mode === 'joystick');
      document.getElementById('tab-canvas').classList.toggle('active', mode === 'canvas');
      document.getElementById('joystick-view').style.display = mode === 'joystick' ? 'flex' : 'none';
      document.getElementById('canvas-view').style.display = mode === 'canvas' ? 'block' : 'none';
      if (mode === 'canvas') resizeTouchCanvas();
    }

    // ==========================================
    // 조이스틱 조작 (감도 비례 & 놓으면 정지)
    // ==========================================
    const joyZone = document.getElementById('joy-zone');
    const joyStick = document.getElementById('joy-stick');
    let isTouching = false;
    const center = { x: 110, y: 110 };
    const maxRadius = 75;

    function handleJoyMove(clientX, clientY) {
      const rect = joyZone.getBoundingClientRect();
      const x = clientX - rect.left - center.x;
      const y = clientY - rect.top - center.y;
      const dist = Math.hypot(x, y);

      currentAngle = Math.atan2(y, x);
      currentIntensity = Math.min(dist / maxRadius, 1.0);

      const clampedDist = Math.min(dist, maxRadius);
      const stickX = Math.cos(currentAngle) * clampedDist;
      const stickY = Math.sin(currentAngle) * clampedDist;

      joyStick.style.transform = `translate(${stickX}px, ${stickY}px)`;

      socket.emit('player-control', {
        angle: currentAngle,
        intensity: currentIntensity,
        color: myColor,
        nickname: myNickname
      });
    }

    function stopJoy() {
      currentIntensity = 0;
      joyStick.style.transform = `translate(0px, 0px)`;
      socket.emit('player-control', { intensity: 0 });
    }

    joyZone.addEventListener('pointerdown', (e) => {
      isTouching = true;
      joyZone.setPointerCapture(e.pointerId);
      handleJoyMove(e.clientX, e.clientY);
    });
    joyZone.addEventListener('pointermove', (e) => {
      if (isTouching) handleJoyMove(e.clientX, e.clientY);
    });
    joyZone.addEventListener('pointerup', () => {
      isTouching = false;
      stopJoy();
    });

    // ==========================================
    // 내 캐릭터 위치 중심 터치 드로잉 패드
    // ==========================================
    const tCanvas = document.getElementById('touch-draw-canvas');
    const tCtx = tCanvas.getContext('2d');
    let isDrawingPad = false;
    let lastPadPoint = null;

    function resizeTouchCanvas() {
      const box = document.getElementById('canvas-view');
      tCanvas.width = box.clientWidth;
      tCanvas.height = box.clientHeight;
    }
    window.addEventListener('resize', resizeTouchCanvas);

    let eraserRadius = 30;

    function setEraserSize(size) {
      eraserRadius = size;
      document.querySelectorAll('.btn-eraser-size').forEach(b => {
        b.classList.toggle('active', parseInt(b.innerText.match(/\d+/)?.[0]) === size);
      });
      if (myColor === 'eraser') {
        socket.emit('player-control', { isErasing: true, eraserRadius });
        showFeedback(`🧽 지우개 크기: ${size}px`);
      }
    }

    tCanvas.addEventListener('pointerdown', (e) => {
      if (myColor === 'transparent') {
        alert('현재 "선 끄기(🚫)" 상태입니다. 상단에서 색상이나 지우개를 선택해주세요!');
        return;
      }
      isDrawingPad = true;
      tCanvas.setPointerCapture(e.pointerId);
      const rect = tCanvas.getBoundingClientRect();
      lastPadPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });

    tCanvas.addEventListener('pointermove', (e) => {
      if (!isDrawingPad || !lastPadPoint || myColor === 'transparent') return;
      const rect = tCanvas.getBoundingClientRect();
      const cur = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const scale = 2.0;

      if (myColor === 'eraser') {
        // 터치 패드 지우개 궤적 시각 피드백
        tCtx.save();
        tCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        tCtx.lineWidth = Math.max(6, eraserRadius / 2);
        tCtx.lineCap = 'round';
        tCtx.beginPath();
        tCtx.moveTo(lastPadPoint.x, lastPadPoint.y);
        tCtx.lineTo(cur.x, cur.y);
        tCtx.stroke();
        tCtx.restore();

        socket.emit('erase-stroke-at', {
          dx: (cur.x - tCanvas.width / 2) * scale,
          dy: (cur.y - tCanvas.height / 2) * scale,
          radius: eraserRadius
        });
      } else {
        tCtx.strokeStyle = myColor;
        tCtx.lineWidth = 4;
        tCtx.lineCap = 'round';
        tCtx.beginPath();
        tCtx.moveTo(lastPadPoint.x, lastPadPoint.y);
        tCtx.lineTo(cur.x, cur.y);
        tCtx.stroke();

        const stroke = {
          dx1: (lastPadPoint.x - tCanvas.width / 2) * scale,
          dy1: (lastPadPoint.y - tCanvas.height / 2) * scale,
          dx2: (cur.x - tCanvas.width / 2) * scale,
          dy2: (cur.y - tCanvas.height / 2) * scale,
          color: myColor,
          width: 8
        };
        socket.emit('direct-draw-stroke', stroke);
      }
      lastPadPoint = cur;
    });

    tCanvas.addEventListener('pointerup', () => {
      isDrawingPad = false;
      lastPadPoint = null;
    });

    // 팔레트
    document.querySelectorAll('.swatch').forEach(s => {
      s.addEventListener('click', () => {
        document.querySelectorAll('.swatch').forEach(x => x.classList.remove('active'));
        s.classList.add('active');
        myColor = s.dataset.color;

        const sizeBar = document.getElementById('eraser-size-bar');
        if (myColor === 'eraser') {
          if (sizeBar) sizeBar.style.display = 'flex';
          joyStick.style.background = 'radial-gradient(circle, #ffffff, #888888)';
          joyStick.innerHTML = '<span style="font-size:24px; display:flex; align-items:center; justify-content:center; height:100%;">🧽</span>';
          socket.emit('player-control', { color: 'eraser', isErasing: true, eraserRadius });
          showFeedback('🧽 지우개 모드: 지나간 위치의 내 그림만 실시간으로 지웁니다.');
        } else if (myColor === 'transparent') {
          if (sizeBar) sizeBar.style.display = 'none';
          joyStick.innerHTML = '';
          joyStick.style.background = 'radial-gradient(circle, #555, #222)';
          socket.emit('player-control', { color: 'transparent', isDrawing: false, isErasing: false });
          showFeedback('🚫 선 끄기 모드: 선을 긋지 않고 이동만 합니다.');
        } else {
          if (sizeBar) sizeBar.style.display = 'none';
          joyStick.innerHTML = '';
          joyStick.style.background = `radial-gradient(circle, ${myColor}, #ffffff)`;
          socket.emit('player-control', { color: myColor, isDrawing: true, isErasing: false });
        }
      });
    });

    function promptSwitchRoom() {
      const target = prompt('입장할 룸 코드를 입력하세요:', currentRoom);
      if (target && target.trim()) {
        currentRoom = target.trim().toUpperCase();
        document.getElementById('room-code-tag').innerText = currentRoom;
        window.history.replaceState({}, '', `?room=${encodeURIComponent(currentRoom)}`);
        joinGameRoom();
      }
    }

    socket.on('canvas-cleared-all', () => {
      if (tCtx && tCanvas) {
        tCtx.clearRect(0, 0, tCanvas.width, tCanvas.height);
      }
    });

    // ==========================================
    // [Gemini 3.5 Flash] AI 봇 비평 & 드로잉 액션
    // ==========================================
    async function askAiCritic() {
      showFeedback('🤖 Gemini AI 봇이 캔버스를 분석하고 있습니다...');
      try {
        const res = await fetch('/api/ai/ask-critic', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ roomCode: currentRoom })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback(`💬 [${data.nickname}]: "${data.comment}"`);
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('AI 비평 호출 오류');
      }
    }

    async function promptAiDrawing() {
      const promptText = prompt('🎨 AI 봇에게 어떤 그림을 그려달라고 할까요?\n(예: 네온 하트, 고양이 얼굴, 별, 사이버 트럭)', '네온 하트');
      if (!promptText || !promptText.trim()) return;

      showFeedback(`🤖 Gemini가 "${promptText.trim()}" 벡터를 설계하고 있습니다...`);
      try {
        const res = await fetch('/api/ai/request-drawing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ roomCode: currentRoom, prompt: promptText.trim() })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback(`✨ ${data.message}`);
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('AI 드로잉 요청 오류');
      }
    }

    // ==========================================
    // 소유권(RLS) 지우기 & 방장 관리 권한
    // ==========================================
    // 1. 내가 그린 그림만 지우기 (소유권 RLS)
    async function clearMyDrawings() {
      if (!authToken) { alert('로그인이 필요합니다.'); return; }
      try {
        const res = await fetch('/api/canvas/clear-mine', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ roomCode: currentRoom })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback(`🧹 ${data.message}`);
          tCtx.clearRect(0, 0, tCanvas.width, tCanvas.height);
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('삭제 통신 오류');
      }
    }

    // 2. 방장 전용: 캔버스 전체 지우기
    async function clearAllCanvas() {
      if (!confirm('⚠️ 정말로 이 방의 캔버스 전체 그림을 모두 지우시겠습니까? (방장 전용)')) return;
      try {
        const res = await fetch('/api/canvas/clear-all', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ roomCode: currentRoom })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback('✨ 방장 권한으로 캔버스 전체를 초기화했습니다.');
          tCtx.clearRect(0, 0, tCanvas.width, tCanvas.height);
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('오류 발생');
      }
    }

    // 3. 방장 전용: AI 봇 소환
    async function spawnAiBot() {
      try {
        const res = await fetch('/api/ai/spawn-bot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ roomCode: currentRoom })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback(`🤖 ${data.message}`);
          updateBotCountBadge();
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('소환 오류');
      }
    }

    // 4. 방장 전용: AI 봇 삭제
    async function removeAiBot() {
      try {
        const res = await fetch('/api/ai/remove-bot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({ roomCode: currentRoom })
        });
        const data = await res.json();
        if (res.ok) {
          showFeedback(`👋 ${data.message}`);
          updateBotCountBadge();
        } else {
          alert(data.error);
        }
      } catch (e) {
        alert('삭제 오류');
      }
    }

    async function updateBotCountBadge() {
      try {
        const res = await fetch(`/api/ai/bot-status?roomCode=${encodeURIComponent(currentRoom)}`);
        const data = await res.json();
        document.getElementById('ai-bot-count').innerText = `AI 봇: ${data.botCount}/2`;
      } catch (e) {}
    }

    async function checkRoomOwnerStatus() {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(currentRoom)}/my-role`, {
          headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
        });
        const data = await res.json();
        const canManage = !!data.canManage;
        document.getElementById('owner-panel').style.display = canManage ? 'block' : 'none';
        if (canManage) {
          updateBotCountBadge();
          const titleTag = document.getElementById('owner-title-tag');
          if (titleTag) {
            titleTag.innerText = data.isAdmin ? '👑 시스템 관리자(Admin)' : `👑 방 주인 (${data.roomOwner})`;
          }
        }
      } catch (e) {
        document.getElementById('owner-panel').style.display = 'none';
      }
    }

    // 대형 화면이 로비로 나가거나 방이 종료되었을 때 컨트롤러 자동 차단
    socket.on('room-session-ended', (data) => {
      stopJoy();
      socket.disconnect();
      document.getElementById('session-ended-reason').innerText = data.reason || '대형 화면이 로비로 이동하였거나 방이 종료되었습니다.';
      document.getElementById('session-ended-overlay').style.display = 'flex';
    });

    function showFeedback(text) {
      const el = document.getElementById('bottom-feedback');
      el.innerText = text;
      setTimeout(() => el.innerText = '', 4000);
    }

    // ==========================================
    // 인증(Auth) 및 세션 관리
    // ==========================================
    function openAuthModal() {
      document.getElementById('auth-modal').style.display = 'flex';
      setAuthError('');
    }
    function closeAuthModal() {
      if (authToken) {
        document.getElementById('auth-modal').style.display = 'none';
      }
    }

    function switchAuthTab(tab) {
      const isLogin = tab === 'login';
      document.getElementById('btn-tab-login').classList.toggle('active', isLogin);
      document.getElementById('btn-tab-register').classList.toggle('active', !isLogin);
      document.getElementById('form-login').style.display = isLogin ? 'block' : 'none';
      document.getElementById('form-register').style.display = !isLogin ? 'block' : 'none';
      setAuthError('');
    }

    function setAuthError(msg) {
      document.getElementById('auth-error-msg').innerText = msg;
    }

    async function handleLoginSubmit(e) {
      e.preventDefault();
      const userId = document.getElementById('login-userId').value.trim();
      const password = document.getElementById('login-password').value;
      if (!userId || !password) return setAuthError('아이디와 비밀번호를 입력해주세요.');

      setAuthError('로그인 확인 중...');
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
          await checkAuthSession();
          joinGameRoom();
          showFeedback(`✨ 환영합니다, ${data.user.alias}님!`);
        } else {
          setAuthError(data.error || '로그인에 실패했습니다.');
        }
      } catch (err) {
        setAuthError('서버 연결 실패');
      }
    }

    async function handleRegisterSubmit(e) {
      e.preventDefault();
      const userId = document.getElementById('reg-userId').value.trim();
      const alias = document.getElementById('reg-alias').value.trim();
      const password = document.getElementById('reg-password').value;
      const roleElem = document.querySelector('input[name="reg-role"]:checked');
      const role = roleElem ? roleElem.value : 'standard';

      if (!userId || !alias || !password) return setAuthError('모든 항목을 입력해주세요.');

      setAuthError('회원가입 처리 중...');
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
          await checkAuthSession();
          joinGameRoom();
          showFeedback(`🎉 회원가입 완료! ${data.user.alias} 아티스트로 입장했습니다.`);
        } else {
          setAuthError(data.error || '회원가입 실패');
        }
      } catch (err) {
        setAuthError('서버 연결 실패');
      }
    }

    async function logoutAuth() {
      if (!confirm('정말 로그아웃하시겠습니까?')) return;
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
      } catch (e) {}
      authToken = '';
      currentAuthUser = null;
      localStorage.removeItem('qr_auth_token');
      document.getElementById('user-alias-label').innerText = '미로그인';
      document.getElementById('btn-auth-open').style.display = 'inline-block';
      document.getElementById('btn-logout').style.display = 'none';
      document.getElementById('owner-panel').style.display = 'none';
      openAuthModal();
      showFeedback('로그아웃되었습니다.');
    }

    async function checkAuthSession() {
      if (!authToken) {
        document.getElementById('user-alias-label').innerText = '미로그인';
        document.getElementById('btn-auth-open').style.display = 'inline-block';
        document.getElementById('btn-logout').style.display = 'none';
        openAuthModal();
        return;
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (data.loggedIn) {
          currentAuthUser = data.user;
          const isVip = currentAuthUser.role === 'vip';
          document.getElementById('user-alias-label').innerText = `${currentAuthUser.alias} (${isVip ? 'VIP' : '일반'})`;
          document.getElementById('user-alias-label').style.color = isVip ? '#00f5d4' : '#f15bb5';
          document.getElementById('btn-auth-open').style.display = 'none';
          document.getElementById('btn-logout').style.display = 'inline-block';
          loadPreferences();
          document.getElementById('auth-modal').style.display = 'none';
          checkRoomOwnerStatus();
        } else {
          logoutAuth();
        }
      } catch (e) {
        openAuthModal();
      }
    }

    async function quickAuth(userId) {
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
          await checkAuthSession();
          joinGameRoom();
        } else {
          setAuthError(data.error);
        }
      } catch (e) {
        setAuthError('로그인 오류');
      }
    }

    async function loadPreferences() {
      if (!authToken) return;
      try {
        const res = await fetch('/api/preferences', {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
          const pref = await res.json();
          if (pref.nickname) myNickname = pref.nickname;
          if (pref.color && pref.color !== 'transparent') {
            myColor = pref.color;
            document.querySelectorAll('.swatch').forEach(s => {
              s.classList.toggle('active', s.dataset.color === pref.color);
            });
            joyStick.style.background = `radial-gradient(circle, ${myColor}, #ffffff)`;
          }
          socket.emit('player-control', { color: myColor, nickname: myNickname });
        }
      } catch (e) {}
    }

    setTimeout(checkAuthSession, 300);
