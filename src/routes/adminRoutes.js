const express = require('express');
const { db, SESSIONS, supabase, saveDb, getSessionUser } = require('../services/dbService');
const { hashPw } = require('../config');

const router = express.Router();

// 🛡️ 슈퍼 어드민 권한 검증 미들웨어
function requireAdmin(req, res, next) {
  const user = getSessionUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: '오직 슈퍼 관리자(Admin)만 접근할 수 있습니다.' });
  }
  req.adminUser = user;
  next();
}

// 1. 전체 현황 개요 (Overview)
router.get('/overview', requireAdmin, (req, res) => {
  const roomScreens = req.app.get('roomScreens') || {};
  const roomPlayers = req.app.get('roomPlayers') || {};
  const roomAiBots = req.app.get('roomAiBots') || {};

  const roomsList = Object.values(db.rooms).map(r => {
    const code = r.code.toUpperCase();
    const screens = roomScreens[code] ? roomScreens[code].size : 0;
    const players = roomPlayers[code] ? Object.keys(roomPlayers[code]).length : 0;
    const bots = roomAiBots[code] ? roomAiBots[code].length : 0;

    return {
      code: r.code,
      title: r.title,
      owner: r.owner,
      isSecret: !!r.isSecret,
      isClosed: !!r.isClosed,
      strokeCount: r.strokes ? r.strokes.length : 0,
      activeScreens: screens,
      activePlayers: players,
      activeBots: bots,
      createdAt: r.createdAt
    };
  });

  let totalStrokes = 0;
  Object.values(db.rooms).forEach(r => {
    if (r.strokes) totalStrokes += r.strokes.length;
  });

  let activeScreensTotal = 0;
  Object.values(roomScreens).forEach(set => activeScreensTotal += (set.size || 0));

  let activeControllersTotal = 0;
  Object.values(roomPlayers).forEach(map => activeControllersTotal += Object.keys(map).length);

  res.json({
    rooms: roomsList,
    stats: {
      totalUsers: Object.keys(db.users).length,
      totalRooms: Object.keys(db.rooms).length,
      totalStrokes,
      activeScreensTotal,
      activeControllersTotal
    }
  });
});

// 2. 전체 유저 목록 조회
router.get('/users', requireAdmin, (req, res) => {
  const roomPlayers = req.app.get('roomPlayers') || {};
  const onlineUserIds = new Set();

  Object.values(roomPlayers).forEach(pMap => {
    Object.values(pMap).forEach(p => {
      if (p.userId) onlineUserIds.add(p.userId);
    });
  });

  const usersList = Object.values(db.users).map(u => ({
    userId: u.userId,
    alias: u.alias,
    password: u.password,
    role: u.role || 'user',
    isOnline: onlineUserIds.has(u.userId),
    preferences: db.preferences ? db.preferences[u.userId] || null : null
  }));

  res.json(usersList);
});

// 3. 유저 권한(Role) 변경 (user, vip, admin)
router.post('/users/:userId/role', requireAdmin, async (req, res) => {
  const targetId = req.params.userId;
  const { role } = req.body;

  if (!['user', 'vip', 'admin'].includes(role)) {
    return res.status(400).json({ error: '유효한 권한이 아닙니다 (user, vip, admin).' });
  }

  const targetUser = db.users[targetId];
  if (!targetUser) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });

  // 기본 슈퍼 관리자 보호
  if (targetId === 'admin' && role !== 'admin') {
    return res.status(400).json({ error: '메인 슈퍼 관리자(admin)의 권한은 강등할 수 없습니다.' });
  }

  targetUser.role = role;

  // 활성 세션 토큰 권한 즉시 갱신
  Object.values(SESSIONS).forEach(sess => {
    if (sess.userId === targetId) sess.role = role;
  });

  saveDb(db);

  if (supabase) {
    try {
      await supabase.from('users').update({ role }).eq('user_id', targetId);
    } catch (e) {
      console.warn('Supabase role update error:', e.message);
    }
  }

  res.json({ ok: true, message: `[${targetUser.alias}]님의 권한이 [${role}]으로 변경되었습니다.`, userId: targetId, newRole: role });
});

// 4. 유저 비밀번호 강제 재설정
router.post('/users/:userId/reset-password', requireAdmin, (req, res) => {
  const targetId = req.params.userId;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.trim().length === 0) {
    return res.status(400).json({ error: '새 비밀번호를 입력해주세요.' });
  }

  const targetUser = db.users[targetId];
  if (!targetUser) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });

  const cleanPw = newPassword.trim();
  targetUser.password = cleanPw;
  targetUser.passwordHash = hashPw(cleanPw);
  saveDb(db);

  if (supabase) {
    supabase.from('users').update({ password: cleanPw }).eq('user_id', targetId).then(null, () => {});
  }

  res.json({ ok: true, message: `[${targetUser.alias}]님의 비밀번호가 재설정되었습니다.` });
});

// 5. 유저 계정 삭제
router.delete('/users/:userId', requireAdmin, (req, res) => {
  const targetId = req.params.userId;
  if (targetId === 'admin') {
    return res.status(400).json({ error: '기본 슈퍼 관리자 계정은 삭제할 수 없습니다.' });
  }

  const targetUser = db.users[targetId];
  if (!targetUser) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });

  delete db.users[targetId];
  if (db.preferences) delete db.preferences[targetId];

  // 세션 정리
  for (const [token, sess] of Object.entries(SESSIONS)) {
    if (sess.userId === targetId) delete SESSIONS[token];
  }

  saveDb(db);

  if (supabase) {
    supabase.from('users').delete().eq('user_id', targetId).then(null, () => {});
  }

  res.json({ ok: true, message: `[${targetUser.alias}] 유저 계정이 삭제되었습니다.` });
});

// 6. 유저 강제 퇴장 (Kick Socket)
router.post('/users/:userId/kick', requireAdmin, (req, res) => {
  const targetId = req.params.userId;
  const io = req.app.get('io');
  const roomPlayers = req.app.get('roomPlayers') || {};

  let kickedCount = 0;
  if (io && io.sockets && io.sockets.sockets) {
    for (const [room, pMap] of Object.entries(roomPlayers)) {
      for (const [socketId, p] of Object.entries(pMap)) {
        if (p.userId === targetId) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.emit('kicked-by-admin', { reason: '관리자에 의해 강제 퇴장(Kick) 처리되었습니다.' });
            socket.disconnect(true);
            kickedCount++;
          }
        }
      }
    }
  }

  res.json({ ok: true, message: `[${targetId}] 유저의 연결 ${kickedCount}개를 강제 종료했습니다.`, kickedCount });
});

// 7. 특정 유저의 낙서/도장 전역 일괄 삭제 (Troll Cleanup)
router.post('/users/:userId/cleanup-strokes', requireAdmin, (req, res) => {
  const targetId = req.params.userId;
  let totalRemoved = 0;
  const io = req.app.get('io');

  for (const [code, room] of Object.entries(db.rooms)) {
    if (room.strokes && room.strokes.length > 0) {
      const prevCount = room.strokes.length;
      room.strokes = room.strokes.filter(s => s.authorId !== targetId && s.userId !== targetId);
      const diff = prevCount - room.strokes.length;
      totalRemoved += diff;

      if (diff > 0 && io) {
        io.to(code).emit('init-canvas-history', { strokes: room.strokes, room: code });
      }
    }
  }

  saveDb(db);

  if (supabase) {
    supabase.from('canvas_strokes').delete().eq('user_id', targetId).then(null, () => {});
  }

  res.json({ ok: true, message: `[${targetId}] 유저가 작성한 획/도장 총 ${totalRemoved}개를 전역 삭제했습니다.`, totalRemoved });
});

// 8. 🚪 방 상태 강제 변경 (강제 닫기 / 다시 열기)
router.post('/rooms/:roomCode/toggle-status', requireAdmin, (req, res) => {
  const code = (req.params.roomCode || '').toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });

  room.isClosed = !room.isClosed;
  saveDb(db);

  const io = req.app.get('io');

  if (room.isClosed && io) {
    // 방 닫힘 시 방 안의 모든 유저에게 세션 종료 브로드캐스트
    io.to(code).emit('room-session-ended', {
      room: code,
      reason: '관리자에 의해 해당 방이 강제 종료/폐쇄되었습니다.'
    });
  }

  res.json({
    ok: true,
    code,
    isClosed: room.isClosed,
    message: room.isClosed ? `[${code}] 방이 강제 폐쇄(CLOSED)되었습니다.` : `[${code}] 방이 정상 오픈(OPEN)되었습니다.`
  });
});

// 9. 방 캔버스 강제 전체 초기화
router.post('/rooms/:roomCode/clear-canvas', requireAdmin, (req, res) => {
  const code = (req.params.roomCode || '').toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });

  const strokeCount = room.strokes ? room.strokes.length : 0;
  room.strokes = [];
  saveDb(db);

  const io = req.app.get('io');
  if (io) {
    io.to(code).emit('canvas-cleared-all');
    io.to(code).emit('init-canvas-history', { strokes: [], room: code });
  }

  if (supabase) {
    supabase.from('canvas_strokes').delete().eq('room_code', code).then(null, () => {});
  }

  res.json({ ok: true, code, message: `[${code}] 방의 캔버스 획 ${strokeCount}개가 전체 초기화되었습니다.` });
});

// 10. 전역 긴급 공지 송출 (Broadcast Ticker)
router.post('/broadcast', requireAdmin, (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: '송출할 공지 내용을 입력하세요.' });
  }

  const cleanMsg = message.trim();
  const io = req.app.get('io');
  if (io) {
    io.emit('admin-announcement-broadcast', {
      message: cleanMsg,
      timestamp: Date.now(),
      sender: req.adminUser.alias || '시스템 관리자'
    });
  }

  res.json({ ok: true, message: '전광판 및 모바일에 긴급 공지가 브로드캐스트되었습니다.' });
});

// 11. 🚨 방 영구 삭제 (Delete Room Completely)
router.delete('/rooms/:roomCode', requireAdmin, async (req, res) => {
  const code = (req.params.roomCode || '').toUpperCase();
  if (!db.rooms[code]) {
    return res.status(404).json({ error: '존재하지 않는 방입니다.' });
  }

  const io = req.app.get('io');
  const roomScreens = req.app.get('roomScreens') || {};
  const roomPlayers = req.app.get('roomPlayers') || {};
  const roomAiBots = req.app.get('roomAiBots') || {};

  // 접속자 모두 강제 퇴장 브로드캐스트
  if (io) {
    io.to(code).emit('room-session-ended', {
      room: code,
      isClosed: true,
      reason: `🚨 관리자에 의해 [${code}] 방이 영구 삭제되었습니다.`
    });
  }

  // 메모리 세션/소켓 룸 정리
  delete db.rooms[code];
  if (roomScreens[code]) delete roomScreens[code];
  if (roomPlayers[code]) delete roomPlayers[code];
  if (roomAiBots[code]) delete roomAiBots[code];

  saveDb(db);

  // Supabase 클라우드 동기화 삭제
  if (supabase) {
    supabase.from('canvas_strokes').delete().eq('room_code', code).then(null, () => {});
    supabase.from('rooms').delete().eq('code', code).then(null, () => {});
  }

  res.json({ ok: true, code, message: `[${code}] 방과 연관된 모든 캔버스 데이터가 영구 삭제되었습니다.` });
});

// 12. 🗄️ 유저 데이터베이스 원본 조회 (Raw DB JSON)
router.get('/users/raw', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    users: db.users,
    preferences: db.preferences || {}
  });
});

// 13. 💾 유저 데이터베이스 원본 전체 직접 저장 (Raw DB JSON Bulk Save)
router.put('/users/raw', requireAdmin, async (req, res) => {
  try {
    const { users, preferences } = req.body;
    if (!users || typeof users !== 'object' || Array.isArray(users)) {
      return res.status(400).json({ error: '유효한 users 객체가 필요합니다.' });
    }

    // 슈퍼 관리자(admin) 계정 안전 보호
    if (!users['admin']) {
      users['admin'] = {
        userId: 'admin',
        alias: '슈퍼 관리자 (Admin)',
        password: 'admin',
        passwordHash: hashPw('admin'),
        role: 'admin'
      };
    } else {
      users['admin'].role = 'admin';
    }

    // password 및 passwordHash 무결성 자동 보정
    for (const [uid, u] of Object.entries(users)) {
      if (!u.userId) u.userId = uid;
      if (u.password && !u.passwordHash) {
        u.passwordHash = hashPw(u.password);
      }
    }

    db.users = users;
    if (preferences && typeof preferences === 'object' && !Array.isArray(preferences)) {
      db.preferences = preferences;
    }

    saveDb(db);

    // Supabase 클라우드 유저 일괄 upsert
    if (supabase) {
      for (const u of Object.values(db.users)) {
        supabase.from('users').upsert({
          user_id: u.userId,
          alias: u.alias || u.userId,
          password: u.password,
          role: u.role || 'user'
        }).then(null, () => {});
      }
    }

    res.json({ ok: true, message: `총 ${Object.keys(db.users).length}명의 유저 데이터베이스가 성공적으로 저장되었습니다.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. ✏️ 특정 유저 전체 필드 직접 수정 (User Detail Inspector Update)
router.put('/users/:userId', requireAdmin, async (req, res) => {
  const targetId = req.params.userId;
  const { alias, role, password, preferences } = req.body;

  const u = db.users[targetId];
  if (!u) return res.status(404).json({ error: '해당 유저를 찾을 수 없습니다.' });

  if (targetId === 'admin' && role && role !== 'admin') {
    return res.status(400).json({ error: '슈퍼 관리자(admin) 계정의 권한은 강등할 수 없습니다.' });
  }

  if (alias !== undefined && alias.trim()) u.alias = alias.trim();
  if (role !== undefined) u.role = role;
  if (password !== undefined && password.trim()) {
    u.password = password.trim();
    u.passwordHash = hashPw(password.trim());
  }

  if (preferences && typeof preferences === 'object') {
    if (!db.preferences) db.preferences = {};
    db.preferences[targetId] = {
      ...(db.preferences[targetId] || {}),
      ...preferences,
      updatedAt: new Date().toISOString()
    };
  }

  saveDb(db);

  if (supabase) {
    supabase.from('users').update({
      alias: u.alias,
      role: u.role,
      password: u.password
    }).eq('user_id', targetId).then(null, () => {});
  }

  res.json({
    ok: true,
    user: u,
    preferences: db.preferences ? db.preferences[targetId] : null,
    message: `[${targetId}] 유저 정보가 성공적으로 업데이트되었습니다.`
  });
});

module.exports = router;
