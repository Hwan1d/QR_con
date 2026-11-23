const ioClient = require('socket.io-client');
const http = require('http');

const PORT = process.env.PORT || 3003;
process.env.PORT = PORT;

const { app, server, db } = require('../server');

function makeRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runAdminTests() {
  console.log('🚀 Starting Comprehensive Admin System Test Suite on PORT:', PORT);

  let adminToken = '';
  let normalToken = '';

  // 1. Admin Login Verification (ID: admin, PW: admin)
  console.log('\n[TEST 1] Admin Authentication Verification');
  const loginRes = await makeRequest('POST', '/api/auth/login', { userId: 'admin', password: 'admin' });
  if (loginRes.status === 200 && loginRes.data.token && loginRes.data.user.role === 'admin') {
    adminToken = loginRes.data.token;
    console.log('✅ Admin login succeeded! Role:', loginRes.data.user.role, 'Token received.');
  } else {
    throw new Error(`Admin login failed: ${JSON.stringify(loginRes)}`);
  }

  // Register a normal test user
  const regUser = await makeRequest('POST', '/api/auth/register', { userId: 'test_user_adm', password: 'password123', alias: '테스터' });
  const loginNormal = await makeRequest('POST', '/api/auth/login', { userId: 'test_user_adm', password: 'password123' });
  normalToken = loginNormal.data.token;

  // 2. Non-admin forbidden check
  console.log('\n[TEST 2] Access Control: Non-admin trying to access admin endpoints');
  const forbiddenRes = await makeRequest('GET', '/api/admin/overview', null, normalToken);
  if (forbiddenRes.status === 403) {
    console.log('✅ Non-admin properly blocked (HTTP 403):', forbiddenRes.data.error);
  } else {
    throw new Error(`Expected 403 for non-admin, got: ${forbiddenRes.status}`);
  }

  // 3. Admin Overview KPI
  console.log('\n[TEST 3] GET /api/admin/overview');
  const overviewRes = await makeRequest('GET', '/api/admin/overview', null, adminToken);
  if (overviewRes.status === 200 && Array.isArray(overviewRes.data.rooms)) {
    console.log('✅ Overview API returned successfully!');
    console.log('   - Stats:', overviewRes.data.stats);
    console.log('   - Rooms count:', overviewRes.data.rooms.length);
  } else {
    throw new Error(`Admin overview failed: ${JSON.stringify(overviewRes)}`);
  }

  // 4. Admin Users List
  console.log('\n[TEST 4] GET /api/admin/users');
  const usersRes = await makeRequest('GET', '/api/admin/users', null, adminToken);
  if (usersRes.status === 200 && Array.isArray(usersRes.data)) {
    const adminInList = usersRes.data.find(u => u.userId === 'admin');
    console.log('✅ Users list returned! Count:', usersRes.data.length, 'Admin found with role:', adminInList.role);
  } else {
    throw new Error(`Admin users list failed: ${JSON.stringify(usersRes)}`);
  }

  // 5. Role Update & Admin Demotion Protection
  console.log('\n[TEST 5] Role Update & Admin Protection');
  // Attempt to demote admin (must be rejected)
  const demoteAdminRes = await makeRequest('POST', '/api/admin/users/admin/role', { role: 'user' }, adminToken);
  if (demoteAdminRes.status === 400) {
    console.log('✅ Admin demotion prevented:', demoteAdminRes.data.error);
  } else {
    throw new Error(`Admin demotion was not rejected!`);
  }

  // Promote normal test user to VIP
  const promoteRes = await makeRequest('POST', '/api/admin/users/test_user_adm/role', { role: 'vip' }, adminToken);
  if (promoteRes.status === 200 && promoteRes.data.ok) {
    console.log('✅ test_user_adm promoted to VIP:', promoteRes.data.message);
  } else {
    throw new Error(`Failed to promote user to VIP: ${JSON.stringify(promoteRes)}`);
  }

  // 6. Room Force Close & Force Open Lifecycle
  console.log('\n[TEST 6] Room Force Close & Re-open');
  // Create a room first
  const testRoomCode = 'ADM_RM_' + Date.now().toString(36).toUpperCase();
  const createRoomRes = await makeRequest('POST', '/api/rooms/create', { code: testRoomCode, title: '관리자 테스트 캔버스' }, adminToken);
  const roomCode = createRoomRes.data.room.code;
  console.log('   - Created room:', roomCode);

  // Connect a screen socket to this room
  const socketScreen = ioClient(`http://localhost:${PORT}`);
  await new Promise(r => socketScreen.on('connect', r));
  socketScreen.emit('join-screen', { room: roomCode });

  // Toggle close room
  const closeRes = await makeRequest('POST', `/api/admin/rooms/${roomCode}/toggle-status`, {}, adminToken);
  console.log('   - Room closed state:', closeRes.data.isClosed);

  // Now a controller tries to join this closed room -> should receive room-session-ended
  const socketCtrl = ioClient(`http://localhost:${PORT}`);
  await new Promise(r => socketCtrl.on('connect', r));

  const sessionEndedPromise = new Promise((resolve) => {
    socketCtrl.on('room-session-ended', (data) => {
      resolve(data);
    });
  });

  socketCtrl.emit('join-controller', { room: roomCode, token: normalToken });
  const endedData = await sessionEndedPromise;
  console.log('✅ Controller was blocked from closed room:', endedData.reason);

  // Re-open room
  const reopenRes = await makeRequest('POST', `/api/admin/rooms/${roomCode}/toggle-status`, {}, adminToken);
  console.log('   - Room reopened state:', reopenRes.data.isClosed);
  if (!reopenRes.data.isClosed) {
    console.log('✅ Room successfully reopened by admin!');
  }

  // 7. Troll Cleanup
  console.log('\n[TEST 7] Troll Cleanup (Wiping strokes by specific user)');
  // Add fake strokes
  db.rooms[roomCode].strokes.push(
    { id: 's1', userId: 'test_user_adm', path: [{ x: 10, y: 10 }, { x: 20, y: 20 }], color: '#ff0000' },
    { id: 's2', userId: 'admin', path: [{ x: 50, y: 50 }, { x: 60, y: 60 }], color: '#00ff00' }
  );
  console.log('   - Initial strokes count in room:', db.rooms[roomCode].strokes.length);

  const cleanupRes = await makeRequest('POST', '/api/admin/users/test_user_adm/cleanup-strokes', {}, adminToken);
  console.log('✅ Troll strokes deleted:', cleanupRes.data.message);
  console.log('   - Remaining strokes in room:', db.rooms[roomCode].strokes.length);
  if (db.rooms[roomCode].strokes.length === 1 && db.rooms[roomCode].strokes[0].userId === 'admin') {
    console.log('✅ Only test_user_adm strokes were cleanly removed!');
  } else {
    throw new Error('Strokes cleanup did not work properly');
  }

  // 8. Emergency Broadcast
  console.log('\n[TEST 8] Emergency Broadcast to all clients');
  const broadcastMsg = '🚨 서버 정기 점검 10분 전입니다.';
  const broadcastPromise = new Promise((resolve) => {
    socketScreen.on('admin-announcement-broadcast', (data) => {
      resolve(data);
    });
  });

  const bcRes = await makeRequest('POST', '/api/admin/broadcast', { message: broadcastMsg }, adminToken);
  const receivedBc = await broadcastPromise;
  console.log('✅ Broadcast received by socket screen:', receivedBc.message);

  // 9. Closed room blocking on REST APIs
  console.log('\n[TEST 9] Closed room REST API access block for normal users');
  // Re-close the room
  await makeRequest('POST', `/api/admin/rooms/${roomCode}/toggle-status`, {}, adminToken);
  // Normal user tries to GET /api/rooms/:roomCode
  const normalGetRoomRes = await makeRequest('GET', `/api/rooms/${roomCode}`, null, normalToken);
  if (normalGetRoomRes.status === 403) {
    console.log('✅ Normal user blocked from GET /api/rooms/:roomCode (HTTP 403):', normalGetRoomRes.data.error);
  } else {
    throw new Error(`Expected 403 for closed room access, got: ${normalGetRoomRes.status}`);
  }
  // Admin CAN access closed room
  const adminGetRoomRes = await makeRequest('GET', `/api/rooms/${roomCode}`, null, adminToken);
  if (adminGetRoomRes.status === 200 && adminGetRoomRes.data.isClosed === true) {
    console.log('✅ Admin successfully inspected closed room!');
  } else {
    throw new Error(`Admin failed to inspect closed room: ${adminGetRoomRes.status}`);
  }

  // 10. Raw DB JSON Read & Write
  console.log('\n[TEST 10] Raw DB JSON Read & Direct Modification');
  const rawDbRes = await makeRequest('GET', '/api/admin/users/raw', null, adminToken);
  if (rawDbRes.status === 200 && rawDbRes.data.ok && rawDbRes.data.users) {
    console.log('✅ Raw DB JSON fetched! Total users in DB:', Object.keys(rawDbRes.data.users).length);
  } else {
    throw new Error(`Failed to get raw DB: ${JSON.stringify(rawDbRes)}`);
  }

  // 11. Specific User Modification (Inspector Update)
  console.log('\n[TEST 11] PUT /api/admin/users/:userId (Direct user data editing)');
  const updateNormalUserRes = await makeRequest('PUT', '/api/admin/users/test_user_adm', {
    alias: '천재_아티스트_개명',
    role: 'vip',
    password: 'super_secret_pw',
    preferences: {
      color: '#ff0055',
      nickname: 'HotPinkNinja',
      brushSize: 24,
      controllerTheme: 'retro_arcade'
    }
  }, adminToken);
  if (updateNormalUserRes.status === 200 && updateNormalUserRes.data.ok) {
    console.log('✅ User updated successfully:', updateNormalUserRes.data.message);
    const updatedUser = updateNormalUserRes.data.user;
    if (updatedUser.alias === '천재_아티스트_개명' && updatedUser.password === 'super_secret_pw') {
      console.log('✅ Alias and Password confirmed updated!');
    } else {
      throw new Error('Updated fields do not match');
    }
  } else {
    throw new Error(`Failed to update user: ${JSON.stringify(updateNormalUserRes)}`);
  }

  // 12. Permanent Room Deletion
  console.log('\n[TEST 12] DELETE /api/admin/rooms/:roomCode (Permanent Room & Canvas Deletion)');
  const deleteRoomRes = await makeRequest('DELETE', `/api/admin/rooms/${roomCode}`, null, adminToken);
  if (deleteRoomRes.status === 200 && deleteRoomRes.data.ok) {
    console.log('✅ Room permanently deleted:', deleteRoomRes.data.message);
    if (!db.rooms[roomCode]) {
      console.log('✅ Verified room removed from db.rooms memory!');
    } else {
      throw new Error('Room still exists in db.rooms');
    }
  } else {
    throw new Error(`Failed to delete room: ${JSON.stringify(deleteRoomRes)}`);
  }

  // Clean up sockets
  socketScreen.disconnect();
  socketCtrl.disconnect();

  console.log('\n🎉 ALL ADMIN SUITE TESTS PASSED PERFECTLY!\n');
  process.exit(0);
}

server.listen(PORT, '0.0.0.0', () => {
  runAdminTests().catch(err => {
    console.error('❌ Test suite error:', err);
    process.exit(1);
  });
});
