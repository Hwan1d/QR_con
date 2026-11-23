const BaseGameMode = require('./BaseGameMode');

/**
 * FreeGraffitiMode.js
 * 🎨 자유 그래피티 모드: 4000x3000 전역 캔버스 자유 이동, 4종 트레일, 터치 패드, 스탬프 도장, RLS 지우개
 */
class FreeGraffitiMode extends BaseGameMode {
  constructor() {
    super('free');
  }

  onPlayerSpawn(data, room, context) {
    const { WORLD_WIDTH, WORLD_HEIGHT } = context;
    const spawnX = Math.random() * (WORLD_WIDTH - 800) + 400;
    const spawnY = Math.random() * (WORLD_HEIGHT - 800) + 400;

    return {
      spawnX,
      spawnY,
      spawnColor: data.color || '#00f5d4',
      spawnTeam: null,
      teamLocked: false,
      isDrawing: false, // 기본은 선 없는 이동 전용
      trailStyle: 'solid'
    };
  }

  onPlayerControl(player, data, room) {
    super.onPlayerControl(player, data, room);
  }

  onPhysicsTick(activePlayers, room, context) {
    const { WORLD_WIDTH, WORLD_HEIGHT, io, db, addStroke, makeStrokeId, distToSegment } = context;
    const roomCode = room.code;

    for (const p of activePlayers) {
      if (p.speed > 0.1) {
        const nextX = p.x + Math.cos(p.angle) * p.speed;
        const nextY = p.y + Math.sin(p.angle) * p.speed;

        // 캔버스 외곽 경계 제한
        p.x = Math.max(20, Math.min(WORLD_WIDTH - 20, nextX));
        p.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, nextY));

        // 지우개 모드: 이동하면서 내 그림만 실시간 삭제 (소유권 RLS 검증)
        if (p.isErasing && p.eraserRadius > 0 && db.rooms[roomCode]) {
          const radius = p.eraserRadius;
          const roomStrokes = db.rooms[roomCode].strokes;
          const removedIds = [];
          db.rooms[roomCode].strokes = roomStrokes.filter(s => {
            const sx1 = s.x1 !== undefined ? s.x1 : s.x;
            const sy1 = s.y1 !== undefined ? s.y1 : s.y;
            const sx2 = s.x2 !== undefined ? s.x2 : s.x;
            const sy2 = s.y2 !== undefined ? s.y2 : s.y;
            if ((s.authorId === p.userId || s.userId === p.userId) && distToSegment(p.x, p.y, sx1, sy1, sx2, sy2) <= (radius + (s.width || s.radius || 8) / 2)) {
              removedIds.push(s.id);
              return false;
            }
            return true;
          });
          if (removedIds.length > 0) {
            io.to(roomCode).emit('strokes-erased', { removedIds, room: roomCode });
          }
        }

        // 그리기 (자국 남기기) 모드
        if (p.isDrawing && !p.isErasing && p.color !== 'transparent' && p.color !== 'eraser' && p.prevX !== null && p.prevY !== null) {
          const dist = Math.hypot(p.x - p.prevX, p.y - p.prevY);
          if (dist > 2 && dist < 120 && db.rooms[roomCode]) {
            const currentStyle = p.trailStyle || 'solid';

            if (currentStyle === 'footprints') {
              // 🐾 발자국 스타일: 26px마다 좌/우 교차
              p.stepDist = (p.stepDist || 0) + dist;
              if (p.stepDist >= 26) {
                p.footSide = (p.footSide || 1) * -1;
                const perpAngle = p.angle + Math.PI / 2;
                const fx = Math.round(p.x + Math.cos(perpAngle) * 8 * p.footSide);
                const fy = Math.round(p.y + Math.sin(perpAngle) * 8 * p.footSide);
                const stroke = {
                  id: makeStrokeId(),
                  type: 'trail_footprint',
                  trailStyle: 'footprints',
                  x: fx,
                  y: fy,
                  angle: p.angle,
                  color: p.color,
                  authorId: p.userId,
                  userId: p.userId,
                  createdAt: Date.now()
                };
                addStroke(roomCode, stroke);
                io.to(roomCode).emit('live-stroke-drawn', stroke);
                p.stepDist = 0;
              }
            } else if (currentStyle === 'dots') {
              // ✨ 네온 점선 스타일: 20px마다 점 찍기
              p.dotDist = (p.dotDist || 0) + dist;
              if (p.dotDist >= 20) {
                const stroke = {
                  id: makeStrokeId(),
                  type: 'trail_dot',
                  trailStyle: 'dots',
                  x: Math.round(p.x),
                  y: Math.round(p.y),
                  color: p.color,
                  radius: 6,
                  authorId: p.userId,
                  userId: p.userId,
                  createdAt: Date.now()
                };
                addStroke(roomCode, stroke);
                io.to(roomCode).emit('live-stroke-drawn', stroke);
                p.dotDist = 0;
              }
            } else if (currentStyle === 'spray') {
              // 💨 스프레이 분사 스타일: 14px마다 분사
              p.sprayDist = (p.sprayDist || 0) + dist;
              if (p.sprayDist >= 14) {
                const stroke = {
                  id: makeStrokeId(),
                  type: 'trail_spray',
                  trailStyle: 'spray',
                  x: Math.round(p.x),
                  y: Math.round(p.y),
                  color: p.color,
                  authorId: p.userId,
                  userId: p.userId,
                  createdAt: Date.now()
                };
                addStroke(roomCode, stroke);
                io.to(roomCode).emit('live-stroke-drawn', stroke);
                p.sprayDist = 0;
              }
            } else {
              // 〰️ 기본 네온 실선 (solid)
              if (dist > 4) {
                const stroke = {
                  id: makeStrokeId(),
                  type: 'line',
                  x1: Math.round(p.prevX),
                  y1: Math.round(p.prevY),
                  x2: Math.round(p.x),
                  y2: Math.round(p.y),
                  color: p.color,
                  width: 8,
                  authorId: p.userId,
                  userId: p.userId,
                  createdAt: Date.now()
                };
                addStroke(roomCode, stroke);
                io.to(roomCode).emit('live-stroke-drawn', stroke);
              }
            }
          }
        }
        p.prevX = p.x;
        p.prevY = p.y;
      } else {
        p.prevX = null;
        p.prevY = null;
      }
    }
  }

  onDirectDraw(player, stroke, room, context) {
    return true; // 허용
  }

  onStampPlace(player, stampStroke, room, context) {
    return true; // 허용
  }

  onErase(player, eraseData, room, context) {
    return true; // 허용
  }
}

module.exports = FreeGraffitiMode;
