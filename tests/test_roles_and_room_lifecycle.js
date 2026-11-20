const assert = require('assert');
const serverModule = require('../server.js');

async function runTests() {
  console.log('🧪 [테스트] 역할(Admin / 방주인 / User) 권한 격리 및 컨트롤러 자동 연결 해제 라이프사이클 검증 시작...\n');

  const BASE_URL = 'http://localhost:3000';

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

  // 1. 로그인 (admin, user_a, user_b)
  const loginAdmin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId: 'admin', password: 'admin1234' })
  });
  assert.strictEqual(loginAdmin.status, 200, 'admin 로그인 성공');
  const tokenAdmin = loginAdmin.body.token;

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

  console.log('✅ 1. 세 역할(Admin, user_a, user_b) 로그인 완료');

  // 2. 권한 검증: LOBBY 방 (방주인: user_a)
  // 2-1. Admin -> LOBBY 관리 권한 허용 (canManage: true)
  const roleAdminInLobby = await request('/api/rooms/LOBBY/my-role', {
    headers: { Authorization: `Bearer ${tokenAdmin}` }
  });
  assert.strictEqual(roleAdminInLobby.body.isAdmin, true);
  assert.strictEqual(roleAdminInLobby.body.canManage, true, 'Admin은 LOBBY 관리 가능');

  // 2-2. user_a (방주인) -> LOBBY 관리 권한 허용 (canManage: true)
  const roleAInLobby = await request('/api/rooms/LOBBY/my-role', {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(roleAInLobby.body.isOwner, true);
  assert.strictEqual(roleAInLobby.body.canManage, true, 'user_a는 LOBBY의 방주인이므로 관리 가능');

  // 2-3. user_b (일반 참여자) -> LOBBY 관리 권한 차단 (canManage: false)
  const roleBInLobby = await request('/api/rooms/LOBBY/my-role', {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(roleBInLobby.body.isOwner, false);
  assert.strictEqual(roleBInLobby.body.canManage, false, 'user_b는 LOBBY의 방주인이 아니므로 관리 불가');

  // user_b가 LOBBY에서 AI 봇 생성 시도 -> 403 차단
  const failSpawnB = await request('/api/ai/spawn-bot', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(failSpawnB.status, 403, 'user_b의 LOBBY AI 봇 생성 차단(403)');

  // user_b가 LOBBY에서 전체 지우기 시도 -> 403 차단
  const failClearB = await request('/api/canvas/clear-all', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ roomCode: 'LOBBY' })
  });
  assert.strictEqual(failClearB.status, 403, 'user_b의 LOBBY 전체 지우기 차단(403)');
  console.log('✅ 2. LOBBY 방 관리 권한 격리 (Admin O, 방주인 user_a O, 타인 user_b X) 검증 완료');

  // 3. 권한 검증: 타인의 방 (VIP-LOUNGE, 방주인: admin)
  // user_a가 VIP-LOUNGE에서 AI 생성 시도 -> 403 차단! (user_a는 LOBBY 방장일 뿐, VIP-LOUNGE의 주인이 아님)
  const roleAInVip = await request('/api/rooms/VIP-LOUNGE/my-role', {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(roleAInVip.body.canManage, false, 'user_a는 타인의 방(VIP-LOUNGE) 관리 불가');

  const failSpawnAInVip = await request('/api/ai/spawn-bot', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}` },
    body: JSON.stringify({ roomCode: 'VIP-LOUNGE' })
  });
  assert.strictEqual(failSpawnAInVip.status, 403, 'user_a가 타인의 방에서 AI 생성 시도 차단(403)');
  console.log('✅ 3. 방장이라도 타인의 방에서는 관리자 권한 차단 확인 완료');

  // 4. user_b가 자신이 직접 새 방(ROOM_B) 생성 시, 그 방의 방주인으로 인정되는지 검증
  const roomBCode = 'ROOM-B-' + Date.now().toString(36).toUpperCase();
  const createRes = await request('/api/rooms/create', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenB}` },
    body: JSON.stringify({ code: roomBCode, title: 'B의 개인 아틀리에', isSecret: false })
  });
  assert.strictEqual(createRes.status, 200, 'user_b 방 생성 성공');

  // user_b가 자신이 만든 방에서는 canManage: true
  const roleBInOwnRoom = await request(`/api/rooms/${roomBCode}/my-role`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(roleBInOwnRoom.body.isOwner, true, 'user_b가 자신이 개설한 방의 주인');
  assert.strictEqual(roleBInOwnRoom.body.canManage, true, 'user_b는 자신의 방 관리 가능');

  // 반대로 user_a가 user_b의 방에서는 canManage: false
  const roleAInRoomB = await request(`/api/rooms/${roomBCode}/my-role`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(roleAInRoomB.body.canManage, false, 'user_a는 user_b의 방 관리 불가');
  console.log('✅ 4. 새 방 개설자(user_b)의 방주인 권한 자동 부여 및 타인(user_a) 차단 확인');

  // 5. 컨트롤러 연결 라이프사이클: 열려있지 않은 방에 컨트롤러 연결 시도 시 차단 이벤트 검증
  const ioClient = require('socket.io-client');
  const controllerSocket = ioClient(BASE_URL, { forceNew: true });

  await new Promise((resolve) => {
    controllerSocket.on('connect', () => {
      // 스크린이 열려있지 않은 가상의 방으로 컨트롤러 입장 시도
      controllerSocket.emit('join-controller', { room: 'NON_EXISTENT_SCREEN_ROOM', nickname: 'TestUser' });
    });

    controllerSocket.on('room-session-ended', (data) => {
      assert(data.reason && (data.reason.includes('대형 화면') || data.reason.includes('종료')), '화면 없는 방 접속 차단 사유 확인');
      controllerSocket.disconnect();
      resolve();
    });
  });
  console.log('✅ 5. 대형 화면이 없는 방에 컨트롤러 접속 시 자동 차단(room-session-ended) 검증 완료');

  console.log('\n🎉 역할(Admin/방주인/User) 분리 및 컨트롤러 연결 해제 라이프사이클 100% 통과!\n');
  process.exit(0);
}

setTimeout(runTests, 1000);
