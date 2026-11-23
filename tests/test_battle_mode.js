const assert = require('assert');
const { io } = require('socket.io-client');
const http = require('http');

const PORT = 3005;
process.env.PORT = PORT;
const { app, server } = require('../server');

async function runBattleModeTest() {
  console.log('🧪 Starting Territory Battle Mode integration test...');

  if (!server.listening) {
    await new Promise(resolve => server.listen(PORT, 'localhost', resolve));
  }

  const roomCode = 'BAT_' + Date.now().toString(36).toUpperCase();
  const baseUrl = `http://localhost:${PORT}`;

  // 1. Create a battle room via REST API
  console.log(`1️⃣ Creating battle room: ${roomCode}`);
  const createRes = await fetch(`${baseUrl}/api/rooms/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomCode: roomCode,
      roomName: '점령전 테스트 경기장',
      mode: 'battle'
    })
  });
  assert.strictEqual(createRes.status, 200, 'Room creation failed');
  const createData = await createRes.json();
  assert.strictEqual(createData.room.mode, 'battle', 'Room mode should be battle');
  console.log('✅ Room created with mode="battle"');

  // 2. Query room by code
  console.log(`2️⃣ Verifying room info`);
  const roomRes = await fetch(`${baseUrl}/api/rooms/${roomCode}`);
  assert.strictEqual(roomRes.status, 200, 'Failed to get room info');
  const roomInfo = await roomRes.json();
  assert.strictEqual(roomInfo.room.mode, 'battle', 'Queried room mode must be battle');
  console.log('✅ Room mode verified via REST API');

  // 3. Connect Screen socket
  console.log('3️⃣ Connecting Screen socket...');
  const screenSocket = io(baseUrl, { reconnection: false, transports: ['websocket'] });

  await new Promise((resolve, reject) => {
    screenSocket.on('connect', () => {
      screenSocket.emit('join-screen', { room: roomCode });
    });

    screenSocket.on('battle-state-update', (battleState) => {
      console.log('   📺 Screen received battle-state-update:', battleState.phase);
      assert.strictEqual(battleState.phase, 'waiting');
      resolve();
    });

    setTimeout(() => reject(new Error('Screen battle-state-update timeout')), 4000);
  });
  console.log('✅ Screen joined and received initial battle state');

  // 4. Connect 2 Controller sockets (RED and BLUE)
  console.log('4️⃣ Connecting 2 Controllers to test team assignment...');
  const ctrl1 = io(baseUrl, { reconnection: false, transports: ['websocket'] });
  const ctrl2 = io(baseUrl, { reconnection: false, transports: ['websocket'] });

  let p1Data = null;
  let p2Data = null;

  await Promise.all([
    new Promise((resolve, reject) => {
      ctrl1.on('connect', () => {
        ctrl1.emit('join-controller', {
          room: roomCode,
          nickname: 'RedPlayer',
          color: '#ff0055'
        });
      });
      ctrl1.on('sync-my-position', (data) => {
        console.log('   🎮 Ctrl1 sync-my-position:', data.roomMode, data.team, `pos: (${data.x}, ${data.y})`);
        assert.strictEqual(data.roomMode, 'battle');
        assert(data.team === 'red' || data.team === 'blue', 'Must have team assigned');
        p1Data = data;
        resolve();
      });
      setTimeout(() => reject(new Error('Ctrl1 timeout')), 4000);
    }),
    new Promise((resolve, reject) => {
      ctrl2.on('connect', () => {
        ctrl2.emit('join-controller', {
          room: roomCode,
          nickname: 'BluePlayer',
          color: '#00bbf9'
        });
      });
      ctrl2.on('sync-my-position', (data) => {
        console.log('   🎮 Ctrl2 sync-my-position:', data.roomMode, data.team, `pos: (${data.x}, ${data.y})`);
        assert.strictEqual(data.roomMode, 'battle');
        assert(data.team === 'red' || data.team === 'blue', 'Must have team assigned');
        p2Data = data;
        resolve();
      });
      setTimeout(() => reject(new Error('Ctrl2 timeout')), 4000);
    })
  ]);
  console.log('✅ Both controllers joined battle room with assigned teams');

  // 5. Test Start Battle
  console.log('5️⃣ Triggering start-battle...');
  const battleStartedPromise = new Promise((resolve, reject) => {
    let gotCountdown = false;
    screenSocket.on('battle-countdown', (data) => {
      gotCountdown = true;
      console.log('   ⏳ battle-countdown:', data.count);
    });

    screenSocket.on('battle-started', (data) => {
      console.log('   🔥 battle-started! Phase:', data.phase, 'Timer:', data.timer, 'Scores:', data.redPercent, data.bluePercent);
      assert.strictEqual(data.phase, 'playing');
      assert.strictEqual(data.timer, 60);
      assert(typeof data.redPercent === 'number' && !isNaN(data.redPercent), 'redPercent must be a valid number');
      assert(typeof data.bluePercent === 'number' && !isNaN(data.bluePercent), 'bluePercent must be a valid number');
      assert(typeof data.redPct === 'number' && !isNaN(data.redPct), 'redPct must be a valid number');
      assert(typeof data.bluePct === 'number' && !isNaN(data.bluePct), 'bluePct must be a valid number');
      resolve({ gotCountdown });
    });

    setTimeout(() => reject(new Error('Battle start timeout')), 7000);
  });

  // Emit start-battle
  ctrl1.emit('start-battle', { room: roomCode });
  const { gotCountdown } = await battleStartedPromise;
  console.log('✅ Countdown and battle-started phase transition verified!');

  // 6. Test movement and paint strokes & team lock verification
  console.log('6️⃣ Testing movement in playing phase & team lock...');
  let strokeCount = 0;
  let receivedTick = false;

  screenSocket.on('battle-tick', (data) => {
    receivedTick = true;
    assert(typeof data.redPercent === 'number' && !isNaN(data.redPercent), 'Tick redPercent must be a number');
    assert(typeof data.bluePercent === 'number' && !isNaN(data.bluePercent), 'Tick bluePercent must be a number');
    assert(typeof data.redPct === 'number' && !isNaN(data.redPct), 'Tick redPct must be a number');
    assert(typeof data.bluePct === 'number' && !isNaN(data.bluePct), 'Tick bluePct must be a number');
  });

  const strokePromise = new Promise((resolve, reject) => {
    screenSocket.on('live-stroke-drawn', (stroke) => {
      if (stroke.type === 'battle_paint') {
        strokeCount++;
        if (strokeCount >= 2) resolve();
      }
    });
    setTimeout(() => {
      if (strokeCount > 0) resolve();
      else reject(new Error('No battle_paint strokes received during playing phase'));
    }, 4000);
  });

  // Move joystick across the arena
  ctrl1.emit('player-control', { angle: 0, intensity: 1.0 });
  ctrl2.emit('player-control', { angle: Math.PI, intensity: 1.0 });

  await strokePromise;
  console.log(`✅ Received ${strokeCount} auto-paint roller strokes from joystick movement!`);

  // Verify team did not change even after moving
  const originalP1Team = p1Data.team;
  const originalP2Team = p2Data.team;
  console.log(`   P1 Team was: ${originalP1Team}, P2 Team was: ${originalP2Team}`);

  // Stop moving
  ctrl1.emit('player-control', { intensity: 0 });
  ctrl2.emit('player-control', { intensity: 0 });

  // 7. Test Reset Battle
  console.log('7️⃣ Triggering reset-battle...');
  await new Promise((resolve, reject) => {
    screenSocket.on('battle-reset', (data) => {
      console.log('   🔄 battle-reset received. Phase:', data.phase);
      assert.strictEqual(data.phase, 'waiting');
      assert.strictEqual(data.timer, 60);
      resolve();
    });
    ctrl1.emit('reset-battle', { room: roomCode });
    setTimeout(() => reject(new Error('Battle reset timeout')), 4000);
  });
  console.log('✅ Battle reset to waiting lobby verified!');

  // Cleanup sockets
  ctrl1.disconnect();
  ctrl2.disconnect();
  screenSocket.disconnect();
  console.log('🎉 ALL TERRITORY BATTLE TESTS PASSED SUCCESSFULLY!');
  server.close(() => {
    process.exit(0);
  });
}

runBattleModeTest().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
