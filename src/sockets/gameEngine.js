const { db, saveDb, addStroke } = require('../services/dbService');
const { callGemini } = require('../services/geminiService');
const { WORLD_WIDTH, WORLD_HEIGHT, makeStrokeId, distToSegment } = require('../config');

// 실시간 룸/엔티티 상태 메모리
const roomScreens = {}; // roomCode -> Set of socketId (대형 화면 추적)
const roomPlayers = {}; // roomCode -> { socketId: player }
const roomAiBots = {};  // roomCode -> [ bot, ... ]

function initGameEngine(io, app) {
  // 라우트 핸들러에서 접근할 수 있도록 Express app 변수에 등록
  app.set('io', io);
  app.set('roomPlayers', roomPlayers);
  app.set('roomAiBots', roomAiBots);
  app.set('roomScreens', roomScreens);

  io.on('connection', (socket) => {
    // 1. 대형 화면(스크린) 입장
    socket.on('join-screen', (data) => {
      const room = (typeof data === 'string' ? data : data.room || 'LOBBY').toUpperCase();
      socket.join(room);
      socket.room = room;
      socket.role = 'screen';

      if (!roomScreens[room]) roomScreens[room] = new Set();
      roomScreens[room].add(socket.id);

      const rData = db.rooms[room] || { strokes: [] };
      socket.emit('init-canvas-history', { strokes: rData.strokes, room });
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
      socket.role = 'controller';
      socket.userId = data.userId || 'guest';

      if (!roomPlayers[room]) roomPlayers[room] = {};

      const initialPlayer = {
        id: socket.id,
        room,
        userId: data.userId || 'guest',
        nickname: data.nickname || 'Artist',
        color: data.color || '#00f5d4',
        x: Math.random() * (WORLD_WIDTH - 800) + 400,
        y: Math.random() * (WORLD_HEIGHT - 800) + 400,
        angle: 0,
        speed: 0,
        intensity: 0,
        isDrawing: data.color !== 'transparent' && data.color !== 'eraser',
        isErasing: data.color === 'eraser' || !!data.isErasing,
        eraserRadius: data.eraserRadius || 30,
        prevX: null,
        prevY: null
      };
      roomPlayers[room][socket.id] = initialPlayer;

      socket.emit('sync-my-position', { x: initialPlayer.x, y: initialPlayer.y });
      io.to(room).emit('player-spawned', initialPlayer);
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

        if (data.isErasing !== undefined) {
          p.isErasing = !!data.isErasing;
        }
        if (data.eraserRadius !== undefined) {
          p.eraserRadius = data.eraserRadius;
        }
        if (data.color !== undefined) {
          p.color = data.color;
          if (data.color === 'eraser') {
            p.isErasing = true;
            p.isDrawing = false;
          } else if (data.color === 'transparent') {
            p.isErasing = false;
            p.isDrawing = false;
          } else {
            p.isErasing = false;
            p.isDrawing = true;
          }
        }
        if (data.nickname) p.nickname = data.nickname;
      }
    });

    // 5. 터치 패드 지우개 이벤트 (소유권 RLS 검증)
    socket.on('erase-stroke-at', (data) => {
      const room = socket.room;
      if (!room || !db.rooms[room]) return;
      const p = roomPlayers[room]?.[socket.id];
      if (!p) return;
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

    // 6. 모바일 터치 패드 드로잉
    socket.on('direct-draw-stroke', (stroke) => {
      const room = socket.room;
      if (room && db.rooms[room]) {
        const p = roomPlayers[room]?.[socket.id];
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

        addStroke(room, worldStroke);
        io.to(room).emit('live-stroke-drawn', worldStroke);
      }
    });

    // 7. 연결 종료
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
        const p = roomPlayers[room][socket.id];
        delete roomPlayers[room][socket.id];
        io.to(room).emit('player-left', { id: socket.id, nickname: p.nickname });
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

      // 1. 유저 이동 & 드로잉 & 지우개
      for (const p of activePlayers) {
        if (p.speed > 0.1) {
          const nextX = p.x + Math.cos(p.angle) * p.speed;
          const nextY = p.y + Math.sin(p.angle) * p.speed;

          p.x = Math.max(20, Math.min(WORLD_WIDTH - 20, nextX));
          p.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, nextY));

          // 지우개 모드: 이동하면서 내 그림만 실시간 삭제 (소유권 RLS 검증)
          if (p.isErasing && p.eraserRadius > 0 && db.rooms[room]) {
            const radius = p.eraserRadius;
            const roomStrokes = db.rooms[room].strokes;
            const removedIds = [];
            db.rooms[room].strokes = roomStrokes.filter(s => {
              if ((s.authorId === p.userId || s.userId === p.userId) && distToSegment(p.x, p.y, s.x1, s.y1, s.x2, s.y2) <= (radius + (s.width || 8) / 2)) {
                removedIds.push(s.id);
                return false;
              }
              return true;
            });
            if (removedIds.length > 0) {
              io.to(room).emit('strokes-erased', { removedIds, room });
            }
          }

          // 그리기 모드
          if (p.isDrawing && !p.isErasing && p.color !== 'transparent' && p.color !== 'eraser' && p.prevX !== null && p.prevY !== null) {
            const dist = Math.hypot(p.x - p.prevX, p.y - p.prevY);
            if (dist > 4 && dist < 120 && db.rooms[room]) {
              const stroke = {
                id: makeStrokeId(),
                x1: p.prevX,
                y1: p.prevY,
                x2: p.x,
                y2: p.y,
                color: p.color,
                width: 8,
                authorId: p.userId,
                userId: p.userId
              };
              addStroke(room, stroke);
              io.to(room).emit('live-stroke-drawn', stroke);
            }
          }
          p.prevX = p.x;
          p.prevY = p.y;
        } else {
          p.prevX = p.x;
          p.prevY = p.y;
        }
      }

      // 2. 🤖 AI 잠입 봇 자율 주행 & Gemini 벡터 드로잉
      for (const bot of aiBots) {
        if (bot.bubbleTimer > 0) {
          bot.bubbleTimer--;
          if (bot.bubbleTimer <= 0) bot.bubbleText = null;
        }

        // Gemini가 생성한 벡터 드로잉 시퀀스가 있는 경우 우선 추적
        if (bot.drawingSequence && bot.drawingSequence.length > 0) {
          const target = bot.drawingSequence[0];
          const tdx = target.x - bot.x;
          const tdy = target.y - bot.y;
          const dist = Math.hypot(tdx, tdy);
          if (dist < 22) {
            bot.drawingSequence.shift();
            if (bot.drawingSequence.length === 0) {
              bot.bubbleText = `✨ "${bot.requestedPrompt || '작품'}" 완성! 안녕! 👋`;
              bot.bubbleTimer = 180;
              bot.isDrawing = false;
              bot.isFinished = true;
              if (bot.isTemporary) {
                bot.exitCountdown = 90; // 약 1.5초간 완성작 감상 후 퇴장
              }
            }
          } else {
            bot.angle = Math.atan2(tdy, tdx);
            bot.speed = 7.0;
          }
        } else if (bot.exitCountdown !== null && bot.exitCountdown !== undefined) {
          bot.exitCountdown--;
          bot.speed = 0.5;
          if (bot.exitCountdown <= 0) {
            console.log(`👋 [AI Artist] ${bot.nickname} finished drawing and exited room [${room}]`);
            roomAiBots[room] = roomAiBots[room].filter(b => b.id !== bot.id);
            continue;
          }
        } else if (bot.isTemporary) {
          // 이미 완성했으나 exitCountdown이 지난 임시 봇만 퇴장
          if (bot.isFinished) {
            roomAiBots[room] = roomAiBots[room].filter(b => b.id !== bot.id);
            continue;
          }
        } else {
          // 일반 자율 배회 (관리자 소환 영구 봇)
          bot.turnTimer = (bot.turnTimer || 0) + 1;
          if (bot.turnTimer > 30) {
            bot.angle += (Math.random() - 0.5) * 0.8;
            bot.turnTimer = 0;
          }
          bot.speed = 3.8;
        }

        bot.x += Math.cos(bot.angle) * bot.speed;
        bot.y += Math.sin(bot.angle) * bot.speed;

        // 벽 튕기기
        if (bot.x < 100 || bot.x > WORLD_WIDTH - 100) bot.angle = Math.PI - bot.angle;
        if (bot.y < 100 || bot.y > WORLD_HEIGHT - 100) bot.angle = -bot.angle;

        // AI 봇이 남기는 네온 획
        if (bot.prevX !== null && bot.prevY !== null && db.rooms[room]) {
          const dist = Math.hypot(bot.x - bot.prevX, bot.y - bot.prevY);
          if (dist > 4 && dist < 80) {
            const aiStroke = {
              id: makeStrokeId(),
              x1: bot.prevX,
              y1: bot.prevY,
              x2: bot.x,
              y2: bot.y,
              color: bot.color,
              width: 7,
              authorId: bot.id,
              userId: bot.id
            };
            addStroke(room, aiStroke);
            io.to(room).emit('live-stroke-drawn', aiStroke);
          }
        }
        bot.prevX = bot.x;
        bot.prevY = bot.y;
      }

      // 스크린에 엔티티 동기화 브로드캐스트
      const allEntities = [...activePlayers, ...aiBots];
      if (allEntities.length > 0) {
        io.to(room).emit('world-tick', {
          players: allEntities,
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
}

module.exports = {
  initGameEngine,
  roomPlayers,
  roomAiBots,
  roomScreens
};
