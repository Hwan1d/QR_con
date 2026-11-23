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
    let canManageBattle = false;
    let currentRoomMode = 'free';
    let myTeam = null;
    let currentBattlePhase = 'waiting';

    // 🚶 이동 모드 ('move': 이동만 / 'draw': 자국 남기기)
    let moveMode = 'move';
    // 🐾 트레일 스타일 ('solid' | 'footprints' | 'dots' | 'spray')
    let currentTrailStyle = 'solid';

    // 📳 촉각 진동 피드백 (Haptics)
    function triggerHaptic(type = 'tap') {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          if (type === 'tap') navigator.vibrate(15);
          else if (type === 'toggle') navigator.vibrate(28);
          else if (type === 'stamp') navigator.vibrate([45, 35, 90]);
          else if (type === 'mode') navigator.vibrate([20, 20]);
        } catch (e) {}
      }
    }

    document.getElementById('room-code-tag').innerText = currentRoom;

    async function checkRoomMode() {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(currentRoom)}`);
        if (res.ok) {
          const roomData = await res.json();
          if (roomData.room && roomData.room.mode) {
            currentRoomMode = roomData.room.mode;
            applyRoomModeUI(currentRoomMode);
          }
        }
      } catch (e) {}
    }

    function applyRoomModeUI(mode) {
      currentRoomMode = mode || 'free';
      const isBattle = currentRoomMode === 'battle';
      
      document.querySelectorAll('.mode-tab-bar').forEach(el => {
        el.style.display = isBattle ? 'none' : 'flex';
      });
      
      const palette = document.querySelector('.palette');
      if (palette) palette.style.display = isBattle ? 'none' : 'flex';
      
      const moveModeBar = document.querySelector('.move-mode-bar');
      if (moveModeBar) moveModeBar.style.display = isBattle ? 'none' : 'flex';
      
      const trailBar = document.getElementById('trail-style-bar');
      if (trailBar) trailBar.style.display = 'none';

      const eraserBar = document.getElementById('eraser-size-bar');
      if (eraserBar) eraserBar.style.display = 'none';

      const battlePanel = document.getElementById('controller-battle-panel');
      if (battlePanel) battlePanel.style.display = isBattle ? 'block' : 'none';

      if (isBattle) {
        document.getElementById('joystick-view').style.display = 'flex';
        document.getElementById('canvas-view').style.display = 'none';
        document.getElementById('stamp-view').style.display = 'none';
        moveMode = 'draw';
        currentTrailStyle = 'solid';
        const statusHint = document.getElementById('joy-status-hint');
        if (statusHint) {
          statusHint.innerHTML = '⚔️ <span style="color:#00f5d4; font-weight:700;">영역 점령전 모드</span>: 조이스틱을 움직여 팀 영역을 점령하세요!';
        }
      }
    }

    function updateMyTeamUI(team, color) {
      myTeam = team;
      if (color) myColor = color;
      const badge = document.getElementById('ctrl-team-badge');
      if (!badge) return;
      if (team === 'red') {
        badge.innerText = '🔴 RED 팀';
        badge.style.background = 'rgba(255, 0, 85, 0.2)';
        badge.style.borderColor = '#ff0055';
        badge.style.color = '#ff0055';
        if (joyStick) joyStick.style.background = 'radial-gradient(circle, #ff0055, #ffffff)';
      } else if (team === 'blue') {
        badge.innerText = '🔵 BLUE 팀';
        badge.style.background = 'rgba(0, 187, 249, 0.2)';
        badge.style.borderColor = '#00bbf9';
        badge.style.color = '#00bbf9';
        if (joyStick) joyStick.style.background = 'radial-gradient(circle, #00bbf9, #ffffff)';
      } else {
        badge.innerText = '대기 중...';
        badge.style.background = 'rgba(255, 255, 255, 0.08)';
        badge.style.borderColor = '#555';
        badge.style.color = '#aaa';
      }
    }

    function triggerStartBattle() {
      triggerHaptic('tap');
      socket.emit('start-battle', { room: currentRoom });
    }

    function triggerResetBattle() {
      triggerHaptic('tap');
      socket.emit('reset-battle', { room: currentRoom });
    }

    function joinGameRoom() {
      socket.emit('join-controller', {
        room: currentRoom,
        nickname: myNickname,
        color: myColor,
        userId: currentAuthUser ? currentAuthUser.userId : 'guest',
        token: authToken
      });
      checkRoomMode();
      checkRoomOwnerStatus();
    }
    socket.on('connect', joinGameRoom);

    // 3단 모드 전환 (조이스틱 / 즉시 낙서 / 스탬프 캔버스)
    function switchMode(mode) {
      triggerHaptic('tap');
      document.getElementById('tab-joystick').classList.toggle('active', mode === 'joystick');
      document.getElementById('tab-canvas').classList.toggle('active', mode === 'canvas');
      document.getElementById('tab-stamp').classList.toggle('active', mode === 'stamp');

      document.getElementById('joystick-view').style.display = mode === 'joystick' ? 'flex' : 'none';
      document.getElementById('canvas-view').style.display = mode === 'canvas' ? 'block' : 'none';
      document.getElementById('stamp-view').style.display = mode === 'stamp' ? 'flex' : 'none';

      if (mode === 'canvas') resizeTouchCanvas();
      if (mode === 'stamp') initStampCanvasIfNeeded();
    }

    // 🚶 이동 모드 vs 🖌️ 자국 남기기(그리기) 모드 토글
    function setMoveMode(mode) {
      moveMode = mode;
      triggerHaptic('toggle');

      const btnMove = document.getElementById('btn-mode-move');
      const btnDraw = document.getElementById('btn-mode-draw');
      const trailBar = document.getElementById('trail-style-bar');
      const statusHint = document.getElementById('joy-status-hint');

      const isDraw = mode === 'draw';

      if (btnMove) {
        btnMove.style.borderColor = !isDraw ? '#00f5d4' : 'rgba(255,255,255,0.15)';
        btnMove.style.background = !isDraw ? 'linear-gradient(135deg, rgba(0,245,212,0.25), rgba(0,245,212,0.1))' : 'rgba(255,255,255,0.05)';
        btnMove.style.color = !isDraw ? '#00f5d4' : '#888';
      }
      if (btnDraw) {
        btnDraw.style.borderColor = isDraw ? '#c084fc' : 'rgba(255,255,255,0.15)';
        btnDraw.style.background = isDraw ? 'linear-gradient(135deg, rgba(192,132,252,0.25), rgba(192,132,252,0.1))' : 'rgba(255,255,255,0.05)';
        btnDraw.style.color = isDraw ? '#c084fc' : '#888';
      }

      if (trailBar) trailBar.style.display = isDraw ? 'block' : 'none';
      if (statusHint) {
        statusHint.innerHTML = isDraw
          ? `🖌️ <span style="color:#c084fc; font-weight:700;">[${getTrailStyleLabel(currentTrailStyle)}]</span> 자국을 남기며 이동 중!`
          : `🚶 <span style="color:#00f5d4; font-weight:700;">선 없이 자유롭게 이동</span> 중입니다`;
      }

      socket.emit('player-control', {
        isDrawing: isDraw,
        trailStyle: currentTrailStyle
      });

      showFeedback(isDraw ? `🖌️ 자국 남기기 모드 (${getTrailStyleLabel(currentTrailStyle)})` : '🚶 이동 전용 모드');
    }

    // 🐾 트레일 스타일 선택 (실선 / 발자국 / 점선 / 스프레이)
    function setTrailStyle(style) {
      currentTrailStyle = style;
      triggerHaptic('tap');

      const styles = ['solid', 'footprints', 'dots', 'spray'];
      for (const s of styles) {
        const el = document.getElementById(`btn-trail-${s}`);
        if (el) el.classList.toggle('active', s === style);
      }

      const statusHint = document.getElementById('joy-status-hint');
      if (statusHint && moveMode === 'draw') {
        statusHint.innerHTML = `🖌️ <span style="color:#c084fc; font-weight:700;">[${getTrailStyleLabel(currentTrailStyle)}]</span> 자국을 남기며 이동 중!`;
      }

      socket.emit('player-control', {
        isDrawing: moveMode === 'draw',
        trailStyle: currentTrailStyle
      });

      showFeedback(`선택된 스타일: ${getTrailStyleLabel(style)}`);
    }

    function getTrailStyleLabel(style) {
      if (style === 'footprints') return '🐾 페인트 발자국';
      if (style === 'dots') return '✨ 네온 점선';
      if (style === 'spray') return '💨 스프레이';
      return '〰️ 네온 실선';
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
        nickname: myNickname,
        isDrawing: moveMode === 'draw',
        trailStyle: currentTrailStyle
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
        canManageBattle = canManage;
        document.getElementById('owner-panel').style.display = canManage ? 'block' : 'none';
        if (canManage) {
          updateBotCountBadge();
          const titleTag = document.getElementById('owner-title-tag');
          if (titleTag) {
            titleTag.innerText = data.isAdmin ? '👑 시스템 관리자(Admin)' : `👑 방 주인 (${data.roomOwner})`;
          }
        }
        const btnBattleStart = document.getElementById('ctrl-btn-start-battle');
        if (btnBattleStart && currentRoomMode === 'battle') {
          btnBattleStart.style.display = (canManage && (currentBattlePhase === 'waiting' || currentBattlePhase === 'game_over')) ? 'block' : 'none';
        }
      } catch (e) {
        document.getElementById('owner-panel').style.display = 'none';
      }
    }

    // ==========================================
    // ⚔️ 영역 점령전 (Territory Battle) 소켓 이벤트
    // ==========================================
    socket.on('sync-my-position', (data) => {
      if (data.roomMode) {
        currentRoomMode = data.roomMode;
        applyRoomModeUI(currentRoomMode);
      }
      if (data.team) {
        updateMyTeamUI(data.team, data.color);
      }
    });

    socket.on('player-team-changed', (data) => {
      if (data.id === socket.id) {
        updateMyTeamUI(data.team, data.color);
        triggerHaptic('toggle');
        if (data.locked) {
          showFeedback(`🔒 팀 확정: ${data.team === 'red' ? '🔴 RED 팀' : '🔵 BLUE 팀'} (변경 불가)`);
        } else {
          showFeedback(`팀 배정: ${data.team === 'red' ? '🔴 RED 팀' : '🔵 BLUE 팀'}`);
        }
      }
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

    socket.on('battle-state-update', (data) => {
      if (!data) return;
      currentBattlePhase = data.phase || 'waiting';
      updateBattleUI(data);
    });

    socket.on('battle-teams-updated', (data) => {
      if (currentBattlePhase === 'waiting') {
        const msg = document.getElementById('ctrl-battle-msg');
        if (msg) msg.innerText = `대기실 인원: RED ${data.redCount}명 vs BLUE ${data.blueCount}명`;
      }
    });

    socket.on('battle-countdown', (data) => {
      currentBattlePhase = 'countdown';
      triggerHaptic('tap');
      const msg = document.getElementById('ctrl-battle-msg');
      if (msg) msg.innerHTML = `⏰ 경기 시작 <span style="color:#fee440; font-size:16px; font-weight:800;">${data.count}</span>초 전! (팀 고정)`;
      const btn = document.getElementById('ctrl-btn-start-battle');
      if (btn) btn.style.display = 'none';
    });

    socket.on('battle-started', (data) => {
      currentBattlePhase = 'playing';
      triggerHaptic('mode');
      const msg = document.getElementById('ctrl-battle-msg');
      if (msg) msg.innerText = '⚔️ 경기 시작! 조이스틱으로 영역을 넓히세요!';
      const timer = document.getElementById('ctrl-battle-timer');
      if (timer) timer.innerText = `${data.timer || 60}초`;
      const btn = document.getElementById('ctrl-btn-start-battle');
      if (btn) btn.style.display = 'none';
      const { red, blue } = getBattlePercentages(data);
      updateScoreBars(red, blue);
    });

    socket.on('battle-tick', (data) => {
      const timer = document.getElementById('ctrl-battle-timer');
      if (timer) timer.innerText = `${data.timer}초`;
      const { red, blue } = getBattlePercentages(data);
      updateScoreBars(red, blue);
    });

    socket.on('battle-game-over', (data) => {
      currentBattlePhase = 'game_over';
      triggerHaptic('stamp');
      const timer = document.getElementById('ctrl-battle-timer');
      if (timer) timer.innerText = '종료';
      const { red, blue } = getBattlePercentages(data);
      const msg = document.getElementById('ctrl-battle-msg');
      if (msg) {
        if (data.winner === 'red') {
          msg.innerHTML = `🏆 <strong style="color:#ff0055">RED 팀 승리!</strong> (${red}%)`;
        } else if (data.winner === 'blue') {
          msg.innerHTML = `🏆 <strong style="color:#00bbf9">BLUE 팀 승리!</strong> (${blue}%)`;
        } else {
          msg.innerHTML = `🤝 <strong>무승부!</strong> (${red}% vs ${blue}%)`;
        }
      }
      updateScoreBars(red, blue);
      
      const btn = document.getElementById('ctrl-btn-start-battle');
      if (btn && canManageBattle) {
        btn.innerText = '🔄 새 경기 시작';
        btn.style.display = 'block';
      }
    });

    socket.on('battle-reset', (data) => {
      currentBattlePhase = 'waiting';
      const timer = document.getElementById('ctrl-battle-timer');
      if (timer) timer.innerText = '60초';
      updateScoreBars(50, 50);
      const msg = document.getElementById('ctrl-battle-msg');
      if (msg) msg.innerText = '중앙 대기 원에서 좌/우 팀을 선택하세요!';
      const btn = document.getElementById('ctrl-btn-start-battle');
      if (btn) {
        btn.innerText = '⚔️ 영역 점령전 시작!';
        btn.style.display = canManageBattle ? 'block' : 'none';
      }
    });

    function updateScoreBars(redPct, bluePct) {
      const r = Math.max(0, Math.min(100, Math.round(Number.isFinite(redPct) ? redPct : 50)));
      const b = Math.max(0, Math.min(100, Math.round(Number.isFinite(bluePct) ? bluePct : (100 - r))));
      const barRed = document.getElementById('ctrl-bar-red');
      const barBlue = document.getElementById('ctrl-bar-blue');
      const pctRed = document.getElementById('ctrl-pct-red');
      const pctBlue = document.getElementById('ctrl-pct-blue');
      if (barRed) barRed.style.width = `${r}%`;
      if (barBlue) barBlue.style.width = `${b}%`;
      if (pctRed) pctRed.innerText = `RED ${r}%`;
      if (pctBlue) pctBlue.innerText = `${b}% BLUE`;
    }

    function updateBattleUI(data) {
      const timer = document.getElementById('ctrl-battle-timer');
      if (timer) timer.innerText = `${data.timer || 60}초`;
      const { red, blue } = getBattlePercentages(data);
      updateScoreBars(red, blue);

      const btn = document.getElementById('ctrl-btn-start-battle');
      if (btn) {
        if (data.phase === 'waiting' && canManageBattle) {
          btn.innerText = '⚔️ 영역 점령전 시작!';
          btn.style.display = 'block';
        } else if (data.phase === 'game_over' && canManageBattle) {
          btn.innerText = '🔄 새 경기 시작';
          btn.style.display = 'block';
        } else {
          btn.style.display = 'none';
        }
      }

      const msg = document.getElementById('ctrl-battle-msg');
      if (msg) {
        if (data.phase === 'waiting') {
          msg.innerText = `중앙 대기 원에서 좌/우 팀을 선택하세요! (RED ${data.redCount || 0} : ${data.blueCount || 0} BLUE)`;
        } else if (data.phase === 'playing') {
          msg.innerText = '⚔️ 점령전 진행 중! 경기장을 칠하세요!';
        }
      }
    }

    // 대형 화면이 로비로 나가거나 방이 종료되었을 때 컨트롤러 자동 차단
    socket.on('room-session-ended', (data) => {
      stopJoy();
      socket.disconnect();
      document.getElementById('session-ended-reason').innerText = data.reason || '대형 화면이 로비로 이동하였거나 방이 종료되었습니다.';
      document.getElementById('session-ended-overlay').style.display = 'flex';
    });

    // 🚨 관리자에 의한 강제 퇴장 (Kick) 처리
    socket.on('kicked-by-admin', (data) => {
      stopJoy();
      socket.disconnect();
      const reasonEl = document.getElementById('session-ended-reason');
      if (reasonEl) reasonEl.innerText = data.reason || '관리자에 의해 강제 퇴장(Kick) 처리되었습니다.';
      const overlay = document.getElementById('session-ended-overlay');
      if (overlay) overlay.style.display = 'flex';
      if (typeof triggerHaptic === 'function') triggerHaptic('error');
    });

    // 📢 관리자 긴급 공지 브로드캐스트 수신
    socket.on('admin-announcement-broadcast', (data) => {
      if (!data || !data.message) return;
      let banner = document.getElementById('admin-broadcast-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'admin-broadcast-banner';
        banner.style.position = 'fixed';
        banner.style.top = '12px';
        banner.style.left = '12px';
        banner.style.right = '12px';
        banner.style.zIndex = '99999';
        banner.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(185, 28, 28, 0.95))';
        banner.style.color = '#fff';
        banner.style.padding = '12px 16px';
        banner.style.borderRadius = '12px';
        banner.style.boxShadow = '0 6px 24px rgba(239, 68, 68, 0.6)';
        banner.style.border = '1px solid #fca5a5';
        banner.style.fontWeight = '700';
        banner.style.fontSize = '13px';
        banner.style.textAlign = 'center';
        banner.style.lineHeight = '1.4';
        banner.style.transition = 'all 0.3s ease';
        document.body.appendChild(banner);
      }
      banner.innerHTML = `📢 <strong>[관리자 공지]</strong> ${data.message}`;
      banner.style.display = 'block';
      banner.style.opacity = '1';
      if (typeof triggerHaptic === 'function') triggerHaptic('heavy');
      if (window.adminBannerTimeout) clearTimeout(window.adminBannerTimeout);
      window.adminBannerTimeout = setTimeout(() => {
        banner.style.opacity = '0';
        setTimeout(() => banner.style.display = 'none', 300);
      }, 9000);
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
      const bananaBtn = document.getElementById('btn-admin-banana');
      if (bananaBtn) bananaBtn.style.display = 'none';
      openAuthModal();
      showFeedback('로그아웃되었습니다.');
    }

    async function checkAuthSession() {
      if (!authToken) {
        document.getElementById('user-alias-label').innerText = '미로그인';
        document.getElementById('btn-auth-open').style.display = 'inline-block';
        document.getElementById('btn-logout').style.display = 'none';
        const bananaBtn = document.getElementById('btn-admin-banana');
        if (bananaBtn) bananaBtn.style.display = 'none';
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
          const isAdmin = currentAuthUser.role === 'admin';
          const isVip = currentAuthUser.role === 'vip';
          const roleTag = isAdmin ? '👑 ADMIN' : (isVip ? 'VIP' : '일반');
          document.getElementById('user-alias-label').innerText = `${currentAuthUser.alias} (${roleTag})`;
          document.getElementById('user-alias-label').style.color = isAdmin ? '#fee440' : (isVip ? '#00f5d4' : '#f15bb5');
          document.getElementById('btn-auth-open').style.display = 'none';
          document.getElementById('btn-logout').style.display = 'inline-block';

          // 어드민 전용 나노바나나 버튼 노출 제어
          const bananaBtn = document.getElementById('btn-admin-banana');
          if (bananaBtn) {
            bananaBtn.style.display = isAdmin ? 'inline-block' : 'none';
          }

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
        const pw = (userId === 'admin') ? 'admin' : '1234';
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, password: pw })
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

    // ========================================================
    // 🎨 나만의 스탬프 캔버스 엔진 (자유 브러시 & 픽셀 도트 듀얼 지원)
    // ========================================================
    const bCanvas = document.getElementById('battle-canvas');
    const bCtx = bCanvas ? bCanvas.getContext('2d', { willReadFrequently: true }) : null;

    let drawingStyle = 'smooth';      // 'smooth' | 'pixel'
    let battleTool = 'pen';           // 'pen' | 'bucket' | 'eraser'
    let brushThickness = 10;
    let pixelGridSize = 24;           // 16 | 24 | 32
    let showPixelGrid = true;
    let stampBgMode = 'transparent';  // 'transparent' | 'dark'
    let stampPlaceSize = 180;         // 100 | 180 | 280
    let isDrawingBattle = false;
    let lastBattlePoint = null;
    let stampCanvasInitialized = false;

    // 픽셀 모드용 2차원 데이터: pixelGrid[row][col] = hexColor or null
    let pixelGrid = [];
    function initPixelGrid(size) {
      pixelGridSize = size;
      pixelGrid = [];
      for (let r = 0; r < size; r++) {
        pixelGrid.push(new Array(size).fill(null));
      }
    }
    initPixelGrid(24);

    // 실행 취소(Undo) 스택
    const battleUndoStack = [];
    const MAX_UNDO = 15;

    function saveBattleUndo() {
      if (drawingStyle === 'smooth') {
        if (battleUndoStack.length >= MAX_UNDO) battleUndoStack.shift();
        battleUndoStack.push({
          style: 'smooth',
          imageData: bCtx.getImageData(0, 0, bCanvas.width, bCanvas.height)
        });
      } else {
        if (battleUndoStack.length >= MAX_UNDO) battleUndoStack.shift();
        const clone = pixelGrid.map(row => [...row]);
        battleUndoStack.push({
          style: 'pixel',
          grid: clone
        });
      }
    }

    function undoBattle() {
      if (battleUndoStack.length === 0) {
        showFeedback('⚠️ 되돌릴 작업이 없습니다.');
        return;
      }
      const prev = battleUndoStack.pop();
      if (prev.style === 'smooth') {
        bCtx.putImageData(prev.imageData, 0, 0);
      } else {
        pixelGrid = prev.grid.map(row => [...row]);
        renderPixelCanvas();
      }
      showFeedback('↩️ 실행 취소 완료');
    }

    function clearBattleCanvas() {
      if (!confirm('캔버스를 모두 지우시겠습니까?')) return;
      saveBattleUndo();
      if (drawingStyle === 'smooth') {
        if (stampBgMode === 'dark') {
          bCtx.fillStyle = '#141726';
          bCtx.fillRect(0, 0, bCanvas.width, bCanvas.height);
        } else {
          bCtx.clearRect(0, 0, bCanvas.width, bCanvas.height);
        }
      } else {
        initPixelGrid(pixelGridSize);
        renderPixelCanvas();
      }
      showFeedback('🗑️ 캔버스가 초기화되었습니다.');
    }

    function initStampCanvasIfNeeded() {
      if (stampCanvasInitialized || !bCanvas) return;
      stampCanvasInitialized = true;

      // 캔버스 기본 배경 초기화 (투명)
      bCtx.clearRect(0, 0, bCanvas.width, bCanvas.height);

      // 포인터 이벤트 등록
      bCanvas.addEventListener('pointerdown', onBattlePointerDown);
      bCanvas.addEventListener('pointermove', onBattlePointerMove);
      bCanvas.addEventListener('pointerup', onBattlePointerUp);
      bCanvas.addEventListener('pointercancel', onBattlePointerUp);
    }

    // 1. 드로잉 스타일 전환 (자유 브러시 vs 픽셀 아트)
    function setDrawingStyle(style) {
      if (drawingStyle === style) return;
      drawingStyle = style;

      document.getElementById('btn-style-smooth').classList.toggle('active', style === 'smooth');
      document.getElementById('btn-style-pixel').classList.toggle('active', style === 'pixel');
      document.getElementById('brush-options-bar').style.display = style === 'smooth' ? 'flex' : 'none';
      document.getElementById('pixel-options-bar').style.display = style === 'pixel' ? 'flex' : 'none';
      bCanvas.classList.toggle('pixel-mode', style === 'pixel');

      battleUndoStack.length = 0;

      if (style === 'pixel') {
        renderPixelCanvas();
        showFeedback('👾 픽셀 아트 모드 (도트 격자)');
      } else {
        showFeedback('🖌️ 자유 브러시 모드');
      }
    }

    // 2. 도구 선택 (펜, 채우기, 지우개)
    function setBattleTool(tool) {
      battleTool = tool;
      document.getElementById('tool-pen').classList.toggle('active', tool === 'pen');
      document.getElementById('tool-bucket').classList.toggle('active', tool === 'bucket');
      document.getElementById('tool-eraser').classList.toggle('active', tool === 'eraser');

      if (tool === 'pen') showFeedback('✏️ 펜 모드');
      else if (tool === 'bucket') showFeedback('🪣 영역 채우기(페인트통) 모드');
      else if (tool === 'eraser') showFeedback('🧽 지우개 모드');
    }

    // 3. 브러시 굵기 설정
    function setBrushThickness(thick) {
      brushThickness = thick;
      document.getElementById('btn-thick-3').classList.toggle('active', thick === 4);
      document.getElementById('btn-thick-8').classList.toggle('active', thick === 10);
      document.getElementById('btn-thick-18').classList.toggle('active', thick === 22);
      showFeedback(`🖌️ 브러시 굵기: ${thick}px`);
    }

    // 4. 픽셀 그리드 크기 설정
    function setPixelGridSize(size) {
      saveBattleUndo();
      initPixelGrid(size);
      document.getElementById('btn-grid-16').classList.toggle('active', size === 16);
      document.getElementById('btn-grid-24').classList.toggle('active', size === 24);
      document.getElementById('btn-grid-32').classList.toggle('active', size === 32);
      renderPixelCanvas();
      showFeedback(`👾 해상도: ${size}×${size}`);
    }

    function togglePixelGrid() {
      showPixelGrid = !showPixelGrid;
      document.getElementById('btn-toggle-grid').innerText = showPixelGrid ? '격자 ON' : '격자 OFF';
      document.getElementById('btn-toggle-grid').classList.toggle('active', showPixelGrid);
      renderPixelCanvas();
    }

    // 5. 스탬프 배경 투명/불투명 토글
    function setStampBgMode(mode) {
      stampBgMode = mode;
      document.getElementById('btn-bg-transparent').classList.toggle('active', mode === 'transparent');
      document.getElementById('btn-bg-dark').classList.toggle('active', mode === 'dark');

      const frame = document.getElementById('stamp-canvas-frame');
      if (mode === 'transparent') {
        frame.style.background = 'radial-gradient(circle at center, #1b2038 0%, #0e111e 100%)';
        showFeedback('✨ 투명 스티커 모드 (그린 부분만 찍힙니다)');
      } else {
        frame.style.background = '#141726';
        showFeedback('⬛ 어두운 배경 모드');
      }
      if (drawingStyle === 'pixel') renderPixelCanvas();
    }

    // 6. 도장 찍기 크기 설정 (100 / 180 / 280)
    function setStampPlaceSize(size) {
      stampPlaceSize = size;
      document.getElementById('btn-stamp-size-100').classList.toggle('active', size === 100);
      document.getElementById('btn-stamp-size-180').classList.toggle('active', size === 180);
      document.getElementById('btn-stamp-size-280').classList.toggle('active', size === 280);
      showFeedback(`📏 도장 크기: ${size}px`);
    }

    // ==========================================
    // 픽셀 캔버스 렌더러
    // ==========================================
    function renderPixelCanvas() {
      if (!bCtx) return;
      const w = bCanvas.width;
      const h = bCanvas.height;
      const cellSize = w / pixelGridSize;

      if (stampBgMode === 'dark') {
        bCtx.fillStyle = '#141726';
        bCtx.fillRect(0, 0, w, h);
      } else {
        bCtx.clearRect(0, 0, w, h);
      }

      // 셀 컬러 칠하기
      for (let r = 0; r < pixelGridSize; r++) {
        for (let c = 0; c < pixelGridSize; c++) {
          const col = pixelGrid[r][c];
          if (col) {
            bCtx.fillStyle = col;
            bCtx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
          }
        }
      }

      // 격자선 렌더링
      if (showPixelGrid) {
        bCtx.save();
        bCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        bCtx.lineWidth = 1;
        bCtx.beginPath();
        for (let i = 0; i <= pixelGridSize; i++) {
          const pos = i * cellSize;
          bCtx.moveTo(pos, 0);
          bCtx.lineTo(pos, h);
          bCtx.moveTo(0, pos);
          bCtx.lineTo(w, pos);
        }
        bCtx.stroke();
        bCtx.restore();
      }
    }

    // ==========================================
    // 포인터 터치/마우스 핸들러
    // ==========================================
    function getBattleCanvasPoint(e) {
      const rect = bCanvas.getBoundingClientRect();
      const scaleX = bCanvas.width / rect.width;
      const scaleY = bCanvas.height / rect.height;
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }

    function onBattlePointerDown(e) {
      e.preventDefault();
      bCanvas.setPointerCapture(e.pointerId);
      isDrawingBattle = true;
      saveBattleUndo();

      const pt = getBattleCanvasPoint(e);
      lastBattlePoint = pt;

      const activeColor = (battleTool === 'eraser') ? null : (myColor === 'eraser' || myColor === 'transparent' ? '#00f5d4' : myColor);

      if (drawingStyle === 'pixel') {
        const cellSize = bCanvas.width / pixelGridSize;
        const c = Math.floor(pt.x / cellSize);
        const r = Math.floor(pt.y / cellSize);

        if (c >= 0 && c < pixelGridSize && r >= 0 && r < pixelGridSize) {
          if (battleTool === 'bucket') {
            floodFillPixel(c, r, pixelGrid[r][c], activeColor);
          } else {
            pixelGrid[r][c] = activeColor;
          }
          renderPixelCanvas();
        }
      } else {
        // 자유 브러시 모드
        if (battleTool === 'bucket') {
          floodFillSmooth(Math.round(pt.x), Math.round(pt.y), activeColor || '#00f5d4');
        } else {
          bCtx.save();
          if (battleTool === 'eraser') {
            bCtx.globalCompositeOperation = 'destination-out';
            bCtx.fillStyle = 'rgba(0,0,0,1)';
          } else {
            bCtx.globalCompositeOperation = 'source-over';
            bCtx.fillStyle = activeColor || '#00f5d4';
          }
          bCtx.beginPath();
          bCtx.arc(pt.x, pt.y, brushThickness / 2, 0, Math.PI * 2);
          bCtx.fill();
          bCtx.restore();
        }
      }
    }

    function onBattlePointerMove(e) {
      if (!isDrawingBattle) return;
      e.preventDefault();
      const pt = getBattleCanvasPoint(e);
      const activeColor = (battleTool === 'eraser') ? null : (myColor === 'eraser' || myColor === 'transparent' ? '#00f5d4' : myColor);

      if (drawingStyle === 'pixel') {
        const cellSize = bCanvas.width / pixelGridSize;
        const c = Math.floor(pt.x / cellSize);
        const r = Math.floor(pt.y / cellSize);

        if (c >= 0 && c < pixelGridSize && r >= 0 && r < pixelGridSize && battleTool !== 'bucket') {
          if (pixelGrid[r][c] !== activeColor) {
            pixelGrid[r][c] = activeColor;
            renderPixelCanvas();
          }
        }
      } else {
        if (battleTool !== 'bucket' && lastBattlePoint) {
          bCtx.save();
          bCtx.lineCap = 'round';
          bCtx.lineJoin = 'round';
          bCtx.lineWidth = brushThickness;
          if (battleTool === 'eraser') {
            bCtx.globalCompositeOperation = 'destination-out';
            bCtx.strokeStyle = 'rgba(0,0,0,1)';
          } else {
            bCtx.globalCompositeOperation = 'source-over';
            bCtx.strokeStyle = activeColor || '#00f5d4';
          }
          bCtx.beginPath();
          bCtx.moveTo(lastBattlePoint.x, lastBattlePoint.y);
          bCtx.lineTo(pt.x, pt.y);
          bCtx.stroke();
          bCtx.restore();
        }
      }
      lastBattlePoint = pt;
    }

    function onBattlePointerUp(e) {
      if (!isDrawingBattle) return;
      isDrawingBattle = false;
      lastBattlePoint = null;
    }

    // ==========================================
    // 🪣 영역 채우기 (Flood Fill)
    // ==========================================
    function floodFillPixel(startCol, startRow, targetColor, fillColor) {
      if (targetColor === fillColor) return;
      const q = [[startCol, startRow]];
      const visited = Array.from({ length: pixelGridSize }, () => Array(pixelGridSize).fill(false));
      visited[startRow][startCol] = true;

      while (q.length > 0) {
        const [c, r] = q.shift();
        pixelGrid[r][c] = fillColor;

        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dc, dr] of dirs) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc >= 0 && nc < pixelGridSize && nr >= 0 && nr < pixelGridSize) {
            if (!visited[nr][nc] && pixelGrid[nr][nc] === targetColor) {
              visited[nr][nc] = true;
              q.push([nc, nr]);
            }
          }
        }
      }
    }

    function floodFillSmooth(startX, startY, fillHex) {
      const w = bCanvas.width;
      const h = bCanvas.height;
      const imgData = bCtx.getImageData(0, 0, w, h);
      const data = imgData.data;

      const fillRgb = hexToRgb(fillHex);
      const startIdx = (startY * w + startX) * 4;
      const targetR = data[startIdx];
      const targetG = data[startIdx + 1];
      const targetB = data[startIdx + 2];
      const targetA = data[startIdx + 3];

      if (targetR === fillRgb.r && targetG === fillRgb.g && targetB === fillRgb.b && targetA === 255) return;

      const match = (idx) => {
        return Math.abs(data[idx] - targetR) < 28 &&
               Math.abs(data[idx + 1] - targetG) < 28 &&
               Math.abs(data[idx + 2] - targetB) < 28 &&
               Math.abs(data[idx + 3] - targetA) < 28;
      };

      const pixelStack = [[startX, startY]];
      const visited = new Uint8Array(w * h);

      while (pixelStack.length > 0) {
        const [x, y] = pixelStack.pop();
        let curY = y;
        let idx = (curY * w + x) * 4;

        while (curY >= 0 && match(idx) && !visited[curY * w + x]) {
          curY--;
          idx -= w * 4;
        }
        curY++;
        idx += w * 4;

        let reachLeft = false;
        let reachRight = false;

        while (curY < h && match(idx) && !visited[curY * w + x]) {
          visited[curY * w + x] = 1;
          data[idx] = fillRgb.r;
          data[idx + 1] = fillRgb.g;
          data[idx + 2] = fillRgb.b;
          data[idx + 3] = 255;

          if (x > 0) {
            if (match(idx - 4) && !visited[curY * w + (x - 1)]) {
              if (!reachLeft) {
                pixelStack.push([x - 1, curY]);
                reachLeft = true;
              }
            } else if (reachLeft) reachLeft = false;
          }

          if (x < w - 1) {
            if (match(idx + 4) && !visited[curY * w + (x + 1)]) {
              if (!reachRight) {
                pixelStack.push([x + 1, curY]);
                reachRight = true;
              }
            } else if (reachRight) reachRight = false;
          }

          curY++;
          idx += w * 4;
        }
      }
      bCtx.putImageData(imgData, 0, 0);
    }

    function hexToRgb(hex) {
      let c = hex.replace('#', '');
      if (c.length === 3) c = c.split('').map(x => x + x).join('');
      const num = parseInt(c, 16);
      return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
    }

    // ==========================================
    // 🎯 스탬프 도장 추출 및 대형 화면에 쾅 찍기!
    // ==========================================
    function getExportStampDataUrl() {
      if (!bCanvas) return null;

      // 1. 픽셀 모드일 때는 격자선을 제외한 순수 아트만 렌더링
      if (drawingStyle === 'pixel') {
        let hasPixels = false;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = bCanvas.width;
        tempCanvas.height = bCanvas.height;
        const tCtx = tempCanvas.getContext('2d');
        const cellSize = tempCanvas.width / pixelGridSize;

        if (stampBgMode === 'dark') {
          tCtx.fillStyle = '#141726';
          tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        } else {
          tCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
        }

        for (let r = 0; r < pixelGridSize; r++) {
          for (let c = 0; c < pixelGridSize; c++) {
            const col = pixelGrid[r][c];
            if (col) {
              hasPixels = true;
              tCtx.fillStyle = col;
              tCtx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
            }
          }
        }
        if (!hasPixels && stampBgMode !== 'dark') return null;
        return tempCanvas.toDataURL('image/png');
      }

      // 2. 자유 브러시 모드
      if (stampBgMode === 'dark') {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = bCanvas.width;
        tempCanvas.height = bCanvas.height;
        const tCtx = tempCanvas.getContext('2d');
        tCtx.fillStyle = '#141726';
        tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tCtx.drawImage(bCanvas, 0, 0);
        return tempCanvas.toDataURL('image/png');
      }

      return bCanvas.toDataURL('image/png');
    }

    // 🎯 도장 찍기 실행! (스플래시나 잡음 없이 그린 그림 그대로 캔버스에 각인)
    function placeStampOnCanvas() {
      const dataUrl = getExportStampDataUrl();
      if (!dataUrl) {
        showFeedback('⚠️ 먼저 캔버스에 그림을 그려주세요!');
        return;
      }

      triggerHaptic('stamp');

      socket.emit('stamp-place', {
        size: stampPlaceSize,
        dataUrl: dataUrl
      });

      showFeedback(`🎯 ${stampPlaceSize}px 도장을 쾅 찍었습니다!`);

      // 버튼 애니메이션 피드백
      const btn = document.getElementById('btn-place-stamp');
      if (btn) {
        btn.style.transform = 'scale(0.92)';
        setTimeout(() => {
          btn.style.transform = 'scale(1)';
        }, 150);
      }
    }

    // ==========================================
    // ⚡ 고도화 AI 스탬프 자동 생성 (고화질 SVG 벡터 스티커 & 정밀 픽셀 아트)
    // ==========================================
    async function promptAiStamp() {
      const defaultTheme = drawingStyle === 'pixel' ? '황금 왕관' : '사이버펑크 네온 고양이';
      const promptText = prompt(`✨ AI에게 그릴 [${drawingStyle === 'pixel' ? '픽셀 아트' : '벡터 스티커'}] 주제를 입력하세요:`, defaultTheme);
      if (!promptText || !promptText.trim()) return;

      showFeedback(`🤖 스마트 AI [${drawingStyle === 'pixel' ? '픽셀' : '벡터'}] 스탬프 생성 중...`);

      try {
        const res = await fetch('/api/ai/generate-stamp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify({
            prompt: promptText.trim(),
            style: drawingStyle,
            gridSize: pixelGridSize
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || '생성 실패');
        }

        const data = await res.json();
        saveBattleUndo(); // 이전 작업 취소(Undo) 가능하도록 백업

        // 1. 고화질 2D 그래픽 SVG 스티커 반환 시 (벡터 모드)
        if (data.isImage && data.dataUrl) {
          const img = new Image();
          img.onload = () => {
            setDrawingStyle('smooth');
            bCtx.clearRect(0, 0, bCanvas.width, bCanvas.height);
            if (stampBgMode === 'dark') {
              bCtx.fillStyle = '#141726';
              bCtx.fillRect(0, 0, bCanvas.width, bCanvas.height);
            }
            bCtx.drawImage(img, 0, 0, bCanvas.width, bCanvas.height);
            showFeedback(`✨ "${promptText.trim()}" 고화질 2D 벡터 스티커 완성!`);
          };
          img.src = data.dataUrl;
          return;
        }

        // 2. 대칭 보정 픽셀 아트 (픽셀 모드: 16x16, 24x24, 32x32)
        if (data.style === 'pixel' && data.lines) {
          const targetGridSize = data.gridSize || pixelGridSize || 16;
          setPixelGridSize(targetGridSize);
          const pal = data.palette || {};
          for (let r = 0; r < targetGridSize; r++) {
            const line = data.lines[r] || '';
            for (let c = 0; c < targetGridSize; c++) {
              const char = line[c] || '.';
              pixelGrid[r][c] = pal[char] || null;
            }
          }
          renderPixelCanvas();
          showFeedback(`✨ "${promptText.trim()}" 정밀 픽셀 아트 (${targetGridSize}×${targetGridSize}) 완성!`);
          return;
        }

        // 3. 폴백 벡터 좌표
        if (data.style === 'smooth' && data.points) {
          if (stampBgMode === 'dark') {
            bCtx.fillStyle = '#141726';
            bCtx.fillRect(0, 0, bCanvas.width, bCanvas.height);
          } else {
            bCtx.clearRect(0, 0, bCanvas.width, bCanvas.height);
          }

          const pts = data.points;
          if (pts.length > 0) {
            bCtx.save();
            bCtx.lineCap = 'round';
            bCtx.lineJoin = 'round';
            bCtx.lineWidth = 10;
            bCtx.strokeStyle = data.color || (myColor !== 'eraser' && myColor !== 'transparent' ? myColor : '#00f5d4');
            bCtx.beginPath();
            bCtx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
              bCtx.lineTo(pts[i].x, pts[i].y);
            }
            bCtx.stroke();
            bCtx.restore();
          }
          showFeedback(`✨ "${promptText.trim()}" 스케치 완성!`);
        }
      } catch (e) {
        console.error(e);
        showFeedback(`⚠️ 생성 오류: ${e.message}`);
      }
    }

    // ==========================================
    // 🍌 [Admin 전용] 나노바나나 (Nano Banana) 고화질 스탬프 실험실
    // ==========================================
    async function promptNanoBananaStamp() {
      if (!currentAuthUser || currentAuthUser.role !== 'admin') {
        alert('🍌 나노바나나 모델 실험실은 오직 최고 관리자(Admin)만 이용할 수 있습니다.');
        return;
      }

      const promptText = prompt('🍌 [Admin 전용] 나노바나나 고화질 이미지 스탬프를 생성할 주제를 입력하세요:', '사이버펑크 네온 호랑이 스티커');
      if (!promptText || !promptText.trim()) return;

      showFeedback('🍌 나노바나나(Nano Banana) AI 스튜디오 생성 중... (약 2~4초 소요)');

      try {
        const res = await fetch('/api/ai/generate-stamp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            prompt: promptText.trim(),
            style: drawingStyle,
            modelTier: 'nano-banana'
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || '생성 실패');
        }

        const data = await res.json();
        saveBattleUndo();

        // 1. 실제 나노바나나 이미지 (PNG Base64) 반환된 경우
        if (data.isImage && data.dataUrl) {
          const img = new Image();
          img.onload = () => {
            // 자유 브러시 모드로 자동 전환하여 고화질 원본 블릿
            setDrawingStyle('smooth');
            bCtx.clearRect(0, 0, bCanvas.width, bCanvas.height);
            if (stampBgMode === 'dark') {
              bCtx.fillStyle = '#141726';
              bCtx.fillRect(0, 0, bCanvas.width, bCanvas.height);
            }
            bCtx.drawImage(img, 0, 0, bCanvas.width, bCanvas.height);
            showFeedback(`🍌 "${promptText.trim()}" 나노바나나 고화질 스탬프 로드 완료! (${data.modelUsed})`);
          };
          img.src = data.dataUrl;
          return;
        }

        // 2. 32x32 HD 픽셀 도트 매트릭스로 생성된 경우
        if (data.style === 'pixel' && data.lines) {
          const targetGridSize = data.gridSize || 32;
          setPixelGridSize(targetGridSize);
          const pal = data.palette || {};
          for (let r = 0; r < targetGridSize; r++) {
            const line = data.lines[r] || '';
            for (let c = 0; c < targetGridSize; c++) {
              const char = line[c] || '.';
              pixelGrid[r][c] = pal[char] || null;
            }
          }
          renderPixelCanvas();
          if (data.notice) {
            alert(data.notice);
          }
          showFeedback(`✨ "${promptText.trim()}" HD 픽셀 스탬프 로드 완료! (${data.modelUsed})`);
          return;
        }

        showFeedback(`✨ "${promptText.trim()}" 스탬프가 캔버스에 로드되었습니다.`);
      } catch (err) {
        console.error('nano-banana error:', err);
        alert('나노바나나 생성 실패: ' + err.message);
        showFeedback('❌ 나노바나나 스탬프 생성에 실패했습니다.');
      }
    }
