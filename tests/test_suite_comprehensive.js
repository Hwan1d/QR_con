const assert = require('assert');
const http = require('http');

// Start server or import server logic directly for testing
const serverProcess = require('../server.js');

async function runTests() {
  console.log('🧪 [테스트] 종합 기능 및 권한(RLS) 검증 시작...\n');

  const PORT = process.env.PORT || 3000;
  const BASE_URL = `http://localhost:${PORT}`;

  // Helper fetch
  async function request(endpoint, options = {}) {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
  }

  // 1. 로그인 (user_a: VIP/LOBBY 방장, user_b: 일반 유저)
  const loginA = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId: 'user_a', password: '1234' })
  });
  assert.strictEqual(loginA.status, 200, 'user_a 로그인 성공');
  const tokenA = loginA.body.token;

  const loginB = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId: 'user_b', password: '1234' })
  });
  assert.strictEqual(loginB.status, 200, 'user_b 로그인 성공');
  const tokenB = loginB.body.token;
  console.log('✅ 1. 유저 인증(user_a / user_b) 완료');

  // 2. 방 상세 정보 조회 및 방장 확인
  const roomRes = await request('/api/rooms/LOBBY');
  assert.strictEqual(roomRes.status, 200, 'LOBBY 방 조회 성공');
  assert.strictEqual(roomRes.body.owner, 'user_a', 'LOBBY 방장은 user_a');
  console.log('✅ 2. GET /api/rooms/:roomCode 방장 식별 완료 (owner: user_a)');

  // 3. 비밀방 잠금 및 코드 인증
  const secretFail = await request('/api/rooms/verify-entry', {
    method: 'POST',
    body: JSON.stringify({ roomCode: 'VIP-LOUNGE', secretCode: 'wrong_code' })
  });
  assert.strictEqual(secretFail.status, 403, '틀린 비밀코드 거부');

  const secretPass = await request('/api/rooms/verify-entry', {
    method: 'POST',
    body: JSON.stringify({ roomCode: 'VIP-LOUNGE', secretCode: '7777' })
  });
  assert.strictEqual(secretPass.status, 200, '올바른 비밀코드(7777) 승인');
  console.log('✅ 3. 비밀방 암호 해시 검증 완료');

  // 4. AI 봇 소환 권한 검증 (방장 전용 & 최대 2개 제한)
  // user_b(일반 유저)가 소환 시도 -> 403 차단
  const botSpawnByB = await request('/api/ai/spawn-bot', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(botSpawnByB.status, 403, '일반 유저는 AI 봇 소환 불가 (403)');

  // 초기화: 기존 봇 삭제
  await request('/api/ai/remove-bot', { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: JSON.stringify({ roomCode: 'LOBBY' }) });
  await request('/api/ai/remove-bot', { method: 'POST', headers: { Authorization: `Bearer ${tokenA}` }, body: JSON.stringify({ roomCode: 'LOBBY' }) });

  // user_a(방장)가 첫 번째 봇 소환 -> 200 성공
  const botSpawn1 = await request('/api/ai/spawn-bot', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(botSpawn1.status, 200, '방장의 AI 봇 1번 소환 성공');
  assert.strictEqual(botSpawn1.body.botCount, 1);

  // 두 번째 봇 소환 -> 200 성공
  const botSpawn2 = await request('/api/ai/spawn-bot', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(botSpawn2.status, 200, '방장의 AI 봇 2번 소환 성공');
  assert.strictEqual(botSpawn2.body.botCount, 2);

  // 세 번째 봇 소환 시도 -> 400 차단 (최대 2마리 제한)
  const botSpawn3 = await request('/api/ai/spawn-bot', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(botSpawn3.status, 400, '최대 2마리 초과 소환 차단');
  console.log('✅ 4. AI 봇 소환 방장 권한 및 최대 2마리 상한선 검증 완료');

  // 5. 소유권 기반 지우기 (RLS) 검증
  // 서버 메모리 DB에 모의 획 데이터 추가 (user_a 획 2개, user_b 획 2개)
  serverProcess.db.rooms['LOBBY'].strokes = [
    { x1: 10, y1: 10, x2: 20, y2: 20, color: '#00f5d4', authorId: 'user_a' },
    { x1: 20, y1: 20, x2: 30, y2: 30, color: '#00f5d4', authorId: 'user_a' },
    { x1: 50, y1: 50, x2: 60, y2: 60, color: '#ff007f', authorId: 'user_b' },
    { x1: 60, y1: 60, x2: 70, y2: 70, color: '#ff007f', authorId: 'user_b' },
  ];

  // user_b가 [내가 그린 그림만 지우기] 실행
  const clearMineRes = await request('/api/canvas/clear-mine', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(clearMineRes.status, 200, '내 그림 지우기 호출 성공');
  assert.strictEqual(clearMineRes.body.removedCount, 2, 'user_b의 획 2개만 삭제');

  // 잔여 획 검증 (user_a의 획 2개는 그대로 남아있어야 함)
  const remainingStrokes = serverProcess.db.rooms['LOBBY'].strokes;
  assert.strictEqual(remainingStrokes.length, 2, 'user_a의 획 2개 보존');
  assert(remainingStrokes.every(s => s.authorId === 'user_a'), '남은 획은 모두 user_a 소유');
  console.log('✅ 5. 유저 개별 그림 지우기 (소유권 RLS 보호) 정상 작동');

  // 6. 방장 전용 화면 전체 지우기 검증
  // user_b가 전체 지우기 시도 -> 403 차단
  const clearAllByB = await request('/api/canvas/clear-all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(clearAllByB.status, 403, '일반 유저 전체 지우기 차단');

  // user_a(방장)가 전체 지우기 실행 -> 200 성공
  const clearAllByA = await request('/api/canvas/clear-all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(clearAllByA.status, 200, '방장 전체 지우기 허용');

  assert.strictEqual(serverProcess.db.rooms['LOBBY'].strokes.length, 0, '캔버스 전체 깨끗하게 초기화');
  console.log('✅ 6. 방장 전용 캔버스 전체 지우기 권한 검증 완료');

  console.log('\n🎉 모든 기능 및 권한 검증 테스트 통과!\n');
  process.exit(0);
}

// Supabase 동기화 완료 대기 후 실행
setTimeout(runTests, 2500);
