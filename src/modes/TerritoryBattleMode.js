const BaseGameMode = require('./BaseGameMode');

/**
 * TerritoryBattleMode.js
 * ⚔️ 영역 점령전 모드: 중앙 원형 로비, 팀 잠금 락, 1000px 원형 경기장, 44px 페인트 롤러, 40px 그리드 점유율
 */
class TerritoryBattleMode extends BaseGameMode {
  constructor() {
    super('battle');
    this.ARENA_CX = 2000;
    this.ARENA_CY = 1500;
    this.ARENA_RADIUS = 1000;
    this.LOBBY_RADIUS = 360;

    // roomCode -> battleState
    this.roomBattles = {};
  }

  getOrCreateBattleState(roomCode) {
    if (!this.roomBattles[roomCode]) {
      this.roomBattles[roomCode] = {
        phase: 'waiting', // 'waiting' | 'countdown' | 'playing' | 'ended'
        countdown: 3,
        timer: 60,
        grid: {},         // "gx,gy" -> 'red' | 'blue'
        redCells: 0,
        blueCells: 0,
        redPercent: 50,
        bluePercent: 50,
        winner: null
      };
    }
    return this.roomBattles[roomCode];
  }

  onPlayerSpawn(data, room, context) {
    const { roomPlayers } = context;
    const roomCode = room.code;
    const bState = this.getOrCreateBattleState(roomCode);

    let spawnX, spawnY, spawnColor, spawnTeam;

    if (bState.phase === 'playing' || bState.phase === 'countdown') {
      // 게임 진행/카운트다운 중 난입: 적은 인원 팀으로 자동 고정 배정
      let redCount = 0;
      let blueCount = 0;
      for (const pl of Object.values(roomPlayers[roomCode] || {})) {
        if (pl.team === 'red') redCount++;
        else if (pl.team === 'blue') blueCount++;
      }
      spawnTeam = redCount <= blueCount ? 'red' : 'blue';
      spawnColor = spawnTeam === 'red' ? '#ff0055' : '#00bbf9';
      const side = spawnTeam === 'red' ? -1 : 1;
      spawnX = this.ARENA_CX + side * (100 + Math.random() * 200);
      spawnY = this.ARENA_CY + (Math.random() - 0.5) * 300;
    } else {
      // 대기 로비: 좌(RED) 또는 우(BLUE)로 스폰
      const side = Math.random() < 0.5 ? -1 : 1;
      spawnX = this.ARENA_CX + side * (80 + Math.random() * 120);
      spawnY = this.ARENA_CY + (Math.random() - 0.5) * 180;
      spawnTeam = spawnX < this.ARENA_CX ? 'red' : 'blue';
      spawnColor = spawnTeam === 'red' ? '#ff0055' : '#00bbf9';
    }

    return {
      spawnX,
      spawnY,
      spawnColor,
      spawnTeam,
      teamLocked: bState.phase !== 'waiting',
      isDrawing: true,
      trailStyle: 'solid'
    };
  }

  onPlayerControl(player, data, room) {
    // 영역 점령전: 색상은 무조건 팀 컬러로 고정, 지우개 불가, 이동 시 상시 드로잉
    player.color = player.team === 'red' ? '#ff0055' : '#00bbf9';
    player.isDrawing = true;
    player.isErasing = false;
    if (data.nickname) player.nickname = data.nickname;
  }

  onPhysicsTick(activePlayers, room, context) {
    const { io, db, addStroke, makeStrokeId } = context;
    const roomCode = room.code;
    const bState = this.getOrCreateBattleState(roomCode);

    for (const p of activePlayers) {
      if (p.speed > 0.1) {
        const nextX = p.x + Math.cos(p.angle) * p.speed;
        const nextY = p.y + Math.sin(p.angle) * p.speed;

        if (bState.phase === 'waiting') {
          // 중앙 원형 대기존(LOBBY_RADIUS) 안으로 이동 제한
          const distFromCenter = Math.hypot(nextX - this.ARENA_CX, nextY - this.ARENA_CY);
          if (distFromCenter > this.LOBBY_RADIUS) {
            const ang = Math.atan2(nextY - this.ARENA_CY, nextX - this.ARENA_CX);
            p.x = this.ARENA_CX + Math.cos(ang) * this.LOBBY_RADIUS;
            p.y = this.ARENA_CY + Math.sin(ang) * this.LOBBY_RADIUS;
          } else {
            p.x = nextX;
            p.y = nextY;
          }

          // 좌측 = RED, 우측 = BLUE 실시간 팀 배정 (대기실에서만 변경 가능)
          if (!p.teamLocked) {
            const newTeam = p.x < this.ARENA_CX ? 'red' : 'blue';
            if (p.team !== newTeam) {
              p.team = newTeam;
              p.color = newTeam === 'red' ? '#ff0055' : '#00bbf9';
              io.to(roomCode).emit('player-team-changed', { id: p.id, team: p.team, color: p.color, locked: false });
            }
          }
        } else if (bState.phase === 'countdown') {
          // 카운트다운 단계: 팀 확정 잠금 상태이며, 대기존 내 자기 팀 진영 안에서 대기
          const distFromCenter = Math.hypot(nextX - this.ARENA_CX, nextY - this.ARENA_CY);
          let targetX = nextX;
          let targetY = nextY;
          if (distFromCenter > this.LOBBY_RADIUS) {
            const ang = Math.atan2(nextY - this.ARENA_CY, nextX - this.ARENA_CX);
            targetX = this.ARENA_CX + Math.cos(ang) * this.LOBBY_RADIUS;
            targetY = this.ARENA_CY + Math.sin(ang) * this.LOBBY_RADIUS;
          }
          // RED 팀은 중앙선 왼쪽, BLUE 팀은 중앙선 오른쪽으로만 이동 제한
          if (p.team === 'red') {
            targetX = Math.min(targetX, this.ARENA_CX - 12);
          } else if (p.team === 'blue') {
            targetX = Math.max(targetX, this.ARENA_CX + 12);
          }
          p.x = targetX;
          p.y = targetY;
        } else if (bState.phase === 'playing') {
          // 원형 경기장(ARENA_RADIUS) 안으로 이동 제한
          const distFromCenter = Math.hypot(nextX - this.ARENA_CX, nextY - this.ARENA_CY);
          if (distFromCenter > this.ARENA_RADIUS - 22) {
            const ang = Math.atan2(nextY - this.ARENA_CY, nextX - this.ARENA_CX);
            p.x = this.ARENA_CX + Math.cos(ang) * (this.ARENA_RADIUS - 22);
            p.y = this.ARENA_CY + Math.sin(ang) * (this.ARENA_RADIUS - 22);
          } else {
            p.x = nextX;
            p.y = nextY;
          }

          // 오직 움직임만으로 영역 점령 (스플래툰 롤러 스타일)
          if (p.prevX !== null && p.prevY !== null) {
            const step = Math.hypot(p.x - p.prevX, p.y - p.prevY);
            if (step >= 4 && db.rooms[roomCode]) {
              const stroke = {
                id: makeStrokeId(),
                type: 'battle_paint',
                team: p.team,
                color: p.team === 'red' ? '#ff0055' : '#00bbf9',
                x1: Math.round(p.prevX),
                y1: Math.round(p.prevY),
                x2: Math.round(p.x),
                y2: Math.round(p.y),
                width: 44,
                authorId: p.userId,
                userId: p.userId,
                createdAt: Date.now()
              };
              addStroke(roomCode, stroke);
              io.to(roomCode).emit('live-stroke-drawn', stroke);

              // 점유 그리드 업데이트 (40px 그리드)
              const gx = Math.floor(p.x / 40);
              const gy = Math.floor(p.y / 40);
              const cellKey = `${gx},${gy}`;
              const oldTeam = bState.grid[cellKey];

              if (oldTeam !== p.team) {
                if (oldTeam === 'red') bState.redCells--;
                if (oldTeam === 'blue') bState.blueCells--;
                if (p.team === 'red') bState.redCells++;
                if (p.team === 'blue') bState.blueCells++;
                bState.grid[cellKey] = p.team;

                const totalClaimed = bState.redCells + bState.blueCells;
                if (totalClaimed > 0) {
                  bState.redPercent = Math.round((bState.redCells / totalClaimed) * 100);
                  bState.bluePercent = 100 - bState.redPercent;
                } else {
                  bState.redPercent = 50;
                  bState.bluePercent = 50;
                }
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

    // 대기 단계 팀 인원 카운트 브로드캐스트
    if (bState.phase === 'waiting') {
      let redCount = 0;
      let blueCount = 0;
      for (const p of activePlayers) {
        if (p.team === 'red') redCount++;
        else if (p.team === 'blue') blueCount++;
      }
      io.to(roomCode).emit('battle-teams-updated', { redCount, blueCount });
    }
  }

  onDirectDraw(player, stroke, room, context) {
    return false; // 점령전 모드에서는 직접 터치 패드 드로잉 차단
  }

  onStampPlace(player, stampStroke, room, context) {
    return false; // 점령전 모드에서는 스탬프 차단
  }

  onErase(player, eraseData, room, context) {
    return false; // 점령전 모드에서는 지우개 차단
  }

  onGameStart(room, context, socket) {
    const { io, db, roomPlayers } = context;
    const roomCode = room.code;
    const bState = this.getOrCreateBattleState(roomCode);
    if (bState.phase !== 'waiting') return;

    bState.phase = 'countdown';
    bState.countdown = 3;

    // 🔒 게임 시작 버튼이 눌리는 즉시 모든 플레이어의 팀 확정 & 락 (이후 팀 변경 절대 불가)
    if (roomPlayers[roomCode]) {
      for (const p of Object.values(roomPlayers[roomCode])) {
        p.team = p.x < this.ARENA_CX ? 'red' : 'blue';
        p.color = p.team === 'red' ? '#ff0055' : '#00bbf9';
        p.teamLocked = true;
        io.to(roomCode).emit('player-team-changed', { id: p.id, team: p.team, color: p.color, locked: true });
      }
    }

    io.to(roomCode).emit('battle-countdown', { count: 3, phase: 'countdown' });

    let cdCount = 3;
    const cdInterval = setInterval(() => {
      cdCount--;
      bState.countdown = cdCount;
      if (cdCount > 0) {
        io.to(roomCode).emit('battle-countdown', { count: cdCount, phase: 'countdown' });
      } else {
        clearInterval(cdInterval);
        bState.phase = 'playing';
        bState.timer = 60;
        bState.grid = {};
        bState.redCells = 0;
        bState.blueCells = 0;
        bState.redPercent = 50;
        bState.bluePercent = 50;
        bState.winner = null;

        if (db.rooms[roomCode]) db.rooms[roomCode].strokes = [];
        io.to(roomCode).emit('init-canvas-history', { strokes: [], room: roomCode });
        io.to(roomCode).emit('battle-started', {
          phase: 'playing',
          timer: 60,
          redPercent: 50,
          bluePercent: 50,
          redPct: 50,
          bluePct: 50
        });
      }
    }, 1000);
  }

  onGameReset(room, context, socket) {
    const { io, db, roomPlayers } = context;
    const roomCode = room.code;
    const bState = this.getOrCreateBattleState(roomCode);
    bState.phase = 'waiting';
    bState.timer = 60;
    bState.grid = {};
    bState.redCells = 0;
    bState.blueCells = 0;
    bState.redPercent = 50;
    bState.bluePercent = 50;
    bState.winner = null;

    if (db.rooms[roomCode]) db.rooms[roomCode].strokes = [];
    io.to(roomCode).emit('init-canvas-history', { strokes: [], room: roomCode });

    if (roomPlayers[roomCode]) {
      for (const p of Object.values(roomPlayers[roomCode])) {
        p.teamLocked = false; // 대기실 리셋 시 팀 락 해제
        const side = p.team === 'red' ? -1 : 1;
        p.x = this.ARENA_CX + side * (70 + Math.random() * 110);
        p.y = this.ARENA_CY + (Math.random() - 0.5) * 160;
        p.prevX = null;
        p.prevY = null;
        p.speed = 0;
      }
    }

    io.to(roomCode).emit('battle-reset', {
      ...bState,
      redPercent: 50,
      bluePercent: 50,
      redPct: 50,
      bluePct: 50
    });
  }

  onSecondTick(room, context) {
    const { io } = context;
    const roomCode = room.code;
    const bState = this.roomBattles[roomCode];
    if (!bState || bState.phase !== 'playing') return;

    bState.timer--;
    const rPct = Math.round(Number.isFinite(bState.redPercent) ? bState.redPercent : 50);
    const bPct = Math.round(Number.isFinite(bState.bluePercent) ? bState.bluePercent : (100 - rPct));

    io.to(roomCode).emit('battle-tick', {
      timer: bState.timer,
      redPercent: rPct,
      bluePercent: bPct,
      redPct: rPct,
      bluePct: bPct
    });

    if (bState.timer <= 0) {
      bState.phase = 'ended';
      let winner = 'draw';
      if (rPct > bPct) winner = 'red';
      else if (bPct > rPct) winner = 'blue';
      bState.winner = winner;

      io.to(roomCode).emit('battle-game-over', {
        winner,
        redPercent: rPct,
        bluePercent: bPct,
        redPct: rPct,
        bluePct: bPct
      });
    }
  }

  getHUDState(roomCode) {
    const bState = this.getOrCreateBattleState(roomCode);
    return {
      mode: 'battle',
      phase: bState.phase,
      timer: bState.timer,
      redPercent: bState.redPercent,
      bluePercent: bState.bluePercent,
      redPct: bState.redPercent,
      bluePct: bState.bluePercent,
      redCount: bState.redCells,
      blueCount: bState.blueCells,
      winner: bState.winner
    };
  }
}

module.exports = TerritoryBattleMode;
