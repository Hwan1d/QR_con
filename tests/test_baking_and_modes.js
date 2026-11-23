const assert = require('assert');
const { modeManager } = require('../src/modes');
const { checkAndBakeRoomStrokes } = require('../src/engine/canvasBaker');

const PORT = 3004;
process.env.PORT = PORT;
const { app, server } = require('../server');

async function runBakingAndModesTest() {
  console.log('🧪 Starting Game Mode Framework & Baking Optimization Tests...');

  // Ensure server is listening for test
  if (!server.listening) {
    await new Promise(resolve => server.listen(PORT, 'localhost', resolve));
  }

  // 1. Game Mode Registry Test
  console.log('1️⃣ Testing Game Mode Manager Registry...');
  const modes = modeManager.listModes();
  assert(modes.length >= 2, 'Must have at least 2 modes registered');
  assert(modes.some(m => m.id === 'free'), 'free mode must exist');
  assert(modes.some(m => m.id === 'battle'), 'battle mode must exist');

  const freeMode = modeManager.getMode('free');
  assert.strictEqual(freeMode.modeName, 'free');

  const battleMode = modeManager.getMode('battle');
  assert.strictEqual(battleMode.modeName, 'battle');
  console.log('✅ Mode registry & instances verified!');

  // 2. Battle Mode Spawn & Direct Draw Restrictions
  console.log('2️⃣ Testing Battle Mode Rules & Restrictions...');
  const dummyPlayer = { id: 'test_p1', team: 'red', color: '#ff0055' };
  const canDirectDraw = battleMode.onDirectDraw(dummyPlayer, {}, { code: 'TEST_ROOM' });
  assert.strictEqual(canDirectDraw, false, 'Direct draw must be blocked in battle mode');

  const canStamp = battleMode.onStampPlace(dummyPlayer, {}, { code: 'TEST_ROOM' });
  assert.strictEqual(canStamp, false, 'Stamp placement must be blocked in battle mode');

  const canErase = battleMode.onErase(dummyPlayer, {}, { code: 'TEST_ROOM' });
  assert.strictEqual(canErase, false, 'Eraser must be blocked in battle mode');
  console.log('✅ Battle mode control protections verified!');

  // 3. Canvas Baking Optimization Test
  console.log('3️⃣ Testing Canvas Baking Compression...');
  const testRoom = {
    code: 'BAKE_TEST',
    strokes: []
  };

  // Add 150 dummy strokes
  for (let i = 0; i < 150; i++) {
    testRoom.strokes.push({ id: `stroke_${i}`, x1: i, y1: i, x2: i + 5, y2: i + 5, color: '#00f5d4' });
  }
  assert.strictEqual(testRoom.strokes.length, 150);

  const result = checkAndBakeRoomStrokes(testRoom);
  assert.strictEqual(result.baked, true, 'Baking should trigger when over threshold');
  assert.strictEqual(result.bakedCount, 110, 'Should bake 150 - 40 = 110 strokes');
  assert.strictEqual(testRoom.strokes.length, 40, 'Remaining strokes buffer should be 40');
  assert.strictEqual(testRoom.bakingHistory.totalBakedCount, 110, 'History should track 110 baked strokes');
  console.log(`✅ Canvas baking compressed 150 strokes down to ${testRoom.strokes.length} recent strokes!`);

  // 4. Test REST API /api/canvas/bake
  console.log('4️⃣ Testing POST /api/canvas/bake endpoint...');
  const baseUrl = `http://localhost:${PORT}`;

  // Login as admin
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'admin', password: 'admin' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;

  // Create room
  const roomCode = 'BAKERM_' + Date.now().toString(36).toUpperCase();
  await fetch(`${baseUrl}/api/rooms/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ code: roomCode, title: '베이킹 테스트룸' })
  });

  const bakeRes = await fetch(`${baseUrl}/api/canvas/bake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ roomCode })
  });
  assert.strictEqual(bakeRes.status, 200, 'Bake endpoint should return 200');
  const bakeData = await bakeRes.json();
  assert(bakeData.message !== undefined, 'Bake response must have a message');
  console.log('✅ POST /api/canvas/bake endpoint verified!');

  console.log('🎉 ALL GAME MODE FRAMEWORK & BAKING TESTS PASSED PERFECTLY!');
  server.close(() => {
    process.exit(0);
  });
}

runBakingAndModesTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
