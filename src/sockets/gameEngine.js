const { db, SESSIONS, saveDb, addStroke } = require('../services/dbService');
const { callGemini } = require('../services/geminiService');
const { WORLD_WIDTH, WORLD_HEIGHT, makeStrokeId, distToSegment } = require('../config');
const { modeManager } = require('../modes');
const { checkAndBakeRoomStrokes } = require('../engine/canvasBaker');

// 실시간 룸/엔티티 상태 메모리
const roomScreens = {}; // roomCode -> Set of socketId (대형 화면 추적)
const roomPlayers = {}; // roomCode -> { socketId: player }
const roomAiBots = {};  // roomCode -> [ bot, ... ]

// 안전 래퍼: 스트로크 추가 시 캔버스 백그라운드 베이킹 자동 검사
function addStrokeWithBake(roomCode, stroke) {
  addStroke(roomCode, stroke);
  if (db.rooms[roomCode]) {
    checkAndBakeRoomStrokes(db.rooms[roomCode]);
  }
}

function initGameEngine(io, app) {
  // 라우트 핸들러에서 접근할 수 있도록 Express app 변수에 등록
  app.set('io', io);
  app.set('roomPlayers', roomPlayers);
  app.set('roomAiBots', roomAiBots);
  app.set('roomScreens', roomScreens);
  app.set('modeManager', modeManager);

  io.on('connection', (socket) => {
    // 1. 대형 화면(스크린) 입장
    socket.on('join-screen', (data) => {
      const room = (typeof data === 'string' ? data : data.room || 'LOBBY').toUpperCase();
      const token = typeof data === 'object' ? data.token : null;
      const user = token ? SESSIONS[token] : null;
      const isAdmin = user && user.role === 'admin';
      const rData = db.rooms[room];

      // 관리자가 폐쇄(CLOSED)한 방은 일반 유저 완전 차단
      if (rData && rData.isClosed && !isAdmin) {
        socket.emit('room-session-ended', {
          room,
          isClosed: true,
          reason: '⛔ 관리자에 의해 폐쇄(CLOSED)된 방입니다. 일반 유저는 이용할 수 없습니다.'
        });
        return;
      }

      socket.join(room);
      socket.room = room;
      socket.role = isAdmin ? 'admin-screen' : 'screen';

      if (!roomScreens[room]) roomScreens[room] = new Set();
      roomScreens[room].add(socket.id);

      const rInit = rData || { strokes: [] };
      socket.emit('init-canvas-history', { strokes: rInit.strokes, room });

      // 모드 전용 HUD 상태 동기화
      const mode = modeManager.getMode(rData?.mode);
      if (rData && rData.mode === 'battle') {
        socket.emit('battle-state-update', mode.getHUDState(room));
      }
      console.log(`[SCREEN] Joined Room [${room}] (Active screens: ${roomScreens[room].size})`);
    });

    // 2. 대형 화면이 로비로 퇴장할 때 (컨트롤러 세션 자동 종료 트리거)
    socket.on('screen-leave-room', (data) => {
      const room = (data?.room || socket.room || '').toUpperCase();
      if (room && roomScreens[room]) {
        roomScreens[room].delete(socket.id);
        if (roomScreens[room].size === 0) {
          io.to(room).emit('room-session-ended', {
            room,
            reason: '대형 화면이 로비로 나가 방 세션이 종료되었습니다.'
          });
        }
      }
      socket.leave(room);
    });

    // 3. 모바일 컨트롤러 입장
    socket.on('join-controller', (data) => {
      const room = (data.room || 'LOBBY').toUpperCase();
      const token = data.token;
      const user = token ? SESSIONS[token] : (data.userId ? db.users[data.userId] : null);
      const isAdmin = user && user.role === 'admin';
      const rData = db.rooms[room];

      // 관리자가 닫은 방은 일반 유저 완전 차단
      if (rData && rData.isClosed && !isAdmin) {
        socket.emit('room-session-ended', {
          room,
          isClosed: true,
          reason: '⛔ 관리자에 의해 폐쇄(CLOSED)된 방입니다. 일반 유저는 이용할 수 없습니다.'
        });
        return;
      }

      // 만약 해당 방에 활성 대형 화면이 열려있지 않다면 컨트롤러 연결 차단 및 안내
      if (!roomScreens[room] || roomScreens[room].size === 0) {
        socket.emit('room-session-ended', {
          room,
          reason: '현재 이 방에는 활성화된 대형 화면이 없습니다. 대형 화면에서 먼저 방에 입장한 후 해당 방의 새로운 QR 코드로 컨트롤러를 연결하세요.'
        });
        return;
      }

      socket.join(room);
      socket.room = room;
      socket.role = isAdmin ? 'admin-controller' : 'controller';
      socket.userId = data.userId || 'guest';
      socket.isAdmin = isAdmin;

      if (!roomPlayers[room]) roomPlayers[room] = {};

      const mode = modeManager.getMode(rData?.mode);
      const spawnInfo = mode.onPlayerSpawn(data, rData || { code: room, mode: 'free' }, {
        WORLD_WIDTH,
        WORLD_HEIGHT,
        roomPlayers,
        io
      });

      const initialPlayer = {
        id: socket.id,
        room,
        userId: data.userId || 'guest',
        nickname: data.nickname || 'Artist',
        color: spawnInfo.spawnColor,
        team: spawnInfo.spawnTeam,
        teamLocked: spawnInfo.teamLocked,
        x: spawnInfo.spawnX,
        y: spawnInfo.spawnY,
        angle: 0,
        speed: 0,
        intensity: 0,
        isDrawing: spawnInfo.isDrawing,
        trailStyle: spawnInfo.trailStyle || 'solid',
        isErasing: false,
        eraserRadius: data.eraserRadius || 30,
        prevX: null,
        prevY: null,
        stepDist: 0,
        footSide: 1,
        dotDist: 0,
        sprayDist: 0
      };
      roomPlayers[room][socket.id] = initialPlayer;

      socket.emit('sync-my-position', {
        x: initialPlayer.x,
        y: initialPlayer.y,
        team: initialPlayer.team,
        roomMode: rData ? (rData.mode || 'free') : 'free'
      });
      io.to(room).emit('player-spawned', initialPlayer);

      if (rData && rData.mode === 'battle') {
        socket.emit('battle-state-update', mode.getHUDState(room));
      }
    });

    // 4. 조이스틱 조작
    socket.on('player-control', (data) => {
      const room = socket.room;
      if (room && roomPlayers[room]?.[socket.id]) {
        const p = roomPlayers[room][socket.id];
        const intensity = Math.min(Math.max(data.intensity || 0, 0), 1);
        p.intensity = intensity;

        if (intensity > 0.05) {
          p.angle = data.angle !== undefined ? data.angle : p.angle;
          p.speed = intensity * 7.0;
          if (data.boosting) p.speed *= 1.6;
        } else {
          p.speed = 0; // 정지
        }

        const mode = modeManager.getMode(db.rooms[room]?.mode);
        mode.onPlayerControl(p, data, db.rooms[room] || { code: room });
      }
    });

    // 5. 터치 패드 지우개 이벤트 (소유권 RLS 검증)
    socket.on('erase-stroke-at', (data) => {
      const room = socket.room;
      if (!room || !db.rooms[room]) return;
      if (db.rooms[room].isClosed && !socket.isAdmin) {
        socket.emit('room-session-ended', { room, isClosed: true, reason: '⛔ 관리자에 의해 폐쇄(CLOSED)된 방입니다.' });
        return;
      }
      const p = roomPlayers[room]?.[socket.id];
      if (!p) return;

      const mode = modeManager.getMode(db.rooms[room]?.mode);
      if (!mode.onErase(p, data, db.rooms[room])) return;

      const ex = p.x + (data.dx || 0);
      const ey = p.y + (data.dy || 0);
      const radius = data.radius || p.eraserRadius || 30;

      const roomStrokes = db.rooms[room].strokes;
      const removedIds = [];
      db.rooms[room].strokes = roomStrokes.filter(s => {
        if ((s.authorId === p.userId || s.userId === p.userId) && distToSegment(ex, ey, s.x1, s.y1, s.x2, s.y2) <= (radius + (s.width || 8) / 2)) {
          removedIds.push(s.id);
          return false;
        }
        return true;
      });
      if (removedIds.length > 0) {
        io.to(room).emit('strokes-erased', { removedIds, room });
      }
    });

    // 6. 모바일 터치 패드 직접 드로잉
    socket.on('direct-draw-stroke', (stroke) => {
      const room = socket.room;
      if (room && db.rooms[room]) {
        if (db.rooms[room].isClosed && !socket.isAdmin) {
          socket.emit('room-session-ended', { room, isClosed: true, reason: '⛔ 관리자에 의해 폐쇄(CLOSED)된 방입니다.' });
          return;
        }
        const p = roomPlayers[room]?.[socket.id];
        const mode = modeManager.getMode(db.rooms[room]?.mode);
        if (!mode.onDirectDraw(p, stroke, db.rooms[room])) return;

        const originX = p ? p.x : 2000;
        const originY = p ? p.y : 1500;

        const worldStroke = {
          id: makeStrokeId(),
          x1: originX + (stroke.dx1 || 0),
          y1: originY + (stroke.dy1 || 0),
          x2: originX + (stroke.dx2 || 0),
          y2: originY + (stroke.dy2 || 0),
          color: stroke.color,
          width: stroke.width || 8,
          authorId: p ? p.userId : 'guest',
          userId: p ? p.userId : 'guest'
        };

        addStrokeWithBake(room, worldStroke);
        io.to(room).emit('live-stroke-drawn', worldStroke);
      }
    });

    // 7. 🎨 스탬프 도장 찍기
    socket.on('stamp-place', (data) => {
      const room = socket.room;
      if (!room || !db.rooms[room]) return;
      if (db.rooms[room].isClosed && !socket.isAdmin) {
        socket.emit('room-session-ended', { room, isClosed: true, reason: '⛔ 관리자에 의해 폐쇄(CLOSED)된 방입니다.' });
        return;
      }
      const p = roomPlayers[room]?.[socket.id];
      if (!p) return;

      const mode = modeManager.getMode(db.rooms[room]?.mode);
      if (!mode.onStampPlace(p, data, db.rooms[room])) return;

      const size = Math.max(60, Math.min(500, parseInt(data.size) || 180));
      const posX = (data.x !== undefined && data.x !== null) ? data.x : p.x;
      const posY = (data.y !== undefined && data.y !== null) ? data.y : p.y;

      const stampStroke = {
        id: makeStrokeId(),
        type: 'stamp',
        x: Math.round(posX - size / 2),
        y: Math.round(posY - size / 2),
        width: size,
        height: size,
        dataUrl: data.dataUrl,
        authorId: p.userId || 'guest',
        userId: p.userId || 'guest',
        nickname: p.nickname || 'Artist',
        color: p.color || '#00f5d4',
        createdAt: Date.now()
      };

      addStrokeWithBake(room, stampStroke);
      io.to(room).emit('live-stamp-placed', stampStroke);
      console.log(`🎨 [Stamp Placed] by [${p.nickname}] in Room [${room}] at (${posX}, ${posY}) size: ${size}px`);
    });

    // 8. ⚔️ 영역 점령전(Battle Mode) 게임 시작
    socket.on('start-battle', () => {
      const room = socket.room;
      if (!room || !db.rooms[room]) return;
      const mode = modeManager.getMode('battle');
      mode.onGameStart(db.rooms[room], { io, db, roomPlayers }, socket);
    });

    // 9. ⚔️ 영역 점령전(Battle Mode) 로비 리셋
    socket.on('reset-battle', () => {
      const room = socket.room;
      if (!room || !db.rooms[room]) return;
      const mode = modeManager.getMode('battle');
      mode.onGameReset(db.rooms[room], { io, db, roomPlayers }, socket);
    });

    // 10. 연결 종료
    socket.on('disconnect', () => {
      const room = socket.room;
      if (socket.role === 'screen' && room && roomScreens[room]) {
        roomScreens[room].delete(socket.id);
        if (roomScreens[room].size === 0) {
          io.to(room).emit('room-session-ended', {
            room,
            reason: '대형 화면 연결이 해제되어 방 세션이 종료되었습니다.'
          });
        }
      }
      if (room && roomPlayers[room]?.[socket.id]) {
        delete roomPlayers[room][socket.id];
        io.to(room).emit('player-left', socket.id);
      }
    });
  });

  // 로컬 백업 저장 (10초 주기)
  setInterval(() => saveDb(db), 10000);

  // 서버 물리 틱 (40 FPS): 유저 이동 + AI 아티스트 자율 주행 및 드로잉
  setInterval(() => {
    for (const [room, playersMap] of Object.entries(roomPlayers)) {
      const activePlayers = Object.values(playersMap);
      const aiBots = roomAiBots[room] || [];
      const roomData = db.rooms[room] || { code: room, mode: 'free' };
      const mode = modeManager.getMode(roomData.mode);

      // 1. 유저 물리/이동 및 모드별 연산
      mode.onPhysicsTick(activePlayers, roomData, {
        WORLD_WIDTH,
        WORLD_HEIGHT,
        io,
        db,
        addStroke: addStrokeWithBake,
        makeStrokeId,
        distToSegment
      });

      // 2. AI 봇 아티스트 물리/이동 및 그림 그리기
      for (const bot of aiBots) {
        if (!bot.waypoints || bot.waypoints.length === 0) continue;

        const target = bot.waypoints[bot.targetIndex || 0];
        const dx = target.x - bot.x;
        const dy = target.y - bot.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 10) {
          bot.targetIndex = (bot.targetIndex || 0) + 1;
          if (bot.targetIndex >= bot.waypoints.length) {
            bot.waypoints = [];
            bot.targetIndex = 0;
            bot.isDrawing = false;
            bot.bubbleText = '✨ 작품 완성!';
            bot.bubbleTimer = 160;
            io.to(room).emit('ai-bot-completed-art', {
              botId: bot.id,
              nickname: bot.nickname,
              prompt: bot.currentPrompt
            });
            continue;
          }
        }

        const angle = Math.atan2(dy, dx);
        const speed = 6.0;
        const nextX = bot.x + Math.cos(angle) * speed;
        const nextY = bot.y + Math.sin(angle) * speed;

        if (bot.isDrawing && bot.prevX !== null && bot.prevY !== null) {
          const moveDist = Math.hypot(nextX - bot.prevX, nextY - bot.prevY);
          if (moveDist > 5 && db.rooms[room]) {
            const aiStroke = {
              id: makeStrokeId(),
              type: 'line',
              x1: Math.round(bot.prevX),
              y1: Math.round(bot.prevY),
              x2: Math.round(nextX),
              y2: Math.round(nextY),
              color: bot.color,
              width: 8,
              authorId: bot.id,
              userId: bot.id,
              nickname: bot.nickname,
              isAi: true,
              createdAt: Date.now()
            };
            addStrokeWithBake(room, aiStroke);
            io.to(room).emit('live-stroke-drawn', aiStroke);
          }
        }

        bot.prevX = bot.x;
        bot.prevY = bot.y;
        bot.x = nextX;
        bot.y = nextY;
        bot.angle = angle;
      }

      // 3. 월드 틱 브로드캐스트 (플레이어 및 AI 봇 통합 좌표 전송)
      const allEntities = [...activePlayers, ...aiBots];
      if (allEntities.length > 0 || Object.keys(playersMap).length > 0) {
        io.to(room).emit('world-tick', {
          players: allEntities.map(p => ({
            id: p.id,
            userId: p.userId,
            nickname: p.nickname,
            x: Math.round(p.x),
            y: Math.round(p.y),
            angle: p.angle,
            color: p.color,
            team: p.team || null,
            isDrawing: p.isDrawing,
            trailStyle: p.trailStyle || 'solid',
            isErasing: p.isErasing,
            eraserRadius: p.eraserRadius || 30,
            isAi: !!p.isAi,
            bubbleText: p.bubbleText || null
          })),
          worldWidth: WORLD_WIDTH,
          worldHeight: WORLD_HEIGHT
        });
      }
    }
  }, 25);

  // 주기적 AI 봇 자율 비평 (35초마다)
  setInterval(async () => {
    for (const [code, bots] of Object.entries(roomAiBots)) {
      if (bots && bots.length > 0 && roomPlayers[code] && Object.keys(roomPlayers[code]).length > 0) {
        const bot = bots[0];
        const room = db.rooms[code];
        if (!room || bot.bubbleTimer > 0) continue;
        try {
          const strokeCount = room.strokes.length;
          const prompt = `AI 그래피티 아티스트 "${bot.nickname}"로서 현재 캔버스(획 수: ${strokeCount})를 둘러보고, 짧고 재치 있는 한마디(30자 내외)를 한국어로 말해주세요.`;
          const comment = await callGemini(prompt);
          bot.bubbleText = comment;
          bot.bubbleTimer = 200;
          io.to(code).emit('ai-bot-spoke', {
            botId: bot.id,
            nickname: bot.nickname,
            comment
          });
        } catch (e) {
          // background failover handled quietly
        }
      }
    }
  }, 35000);

  // 1초 주기 타이머 루프: 각 활성 방의 모드별 타이머 및 점수 틱 실행
  setInterval(() => {
    for (const [roomCode, rData] of Object.entries(db.rooms)) {
      const mode = modeManager.getMode(rData.mode);
      mode.onSecondTick(rData, { io, db });
    }
  }, 1000);
}

module.exports = {
  initGameEngine,
  roomPlayers,
  roomAiBots,
  roomScreens,
  modeManager
};
