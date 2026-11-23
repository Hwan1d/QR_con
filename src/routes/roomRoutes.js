const express = require('express');
const QRCode = require('qrcode');
const { db, supabase, saveDb, canManageRoom, getSessionUser } = require('../services/dbService');
const { PORT, hashPw, getLocalIp } = require('../config');

const router = express.Router();

// 1. 방 전용 QR 코드 생성
router.get('/qr', async (req, res) => {
  try {
    const room = (req.query.room || 'LOBBY').toUpperCase();
    const localIp = getLocalIp();
    const host = req.hostname === 'localhost' || req.hostname === '127.0.0.1'
      ? `${localIp}:${PORT}`
      : req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const controllerUrl = `${protocol}://${host}/controller.html?room=${encodeURIComponent(room)}`;

    const qrDataUrl = await QRCode.toDataURL(controllerUrl, {
      width: 320,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    res.json({ qrDataUrl, controllerUrl, room, localIp, port: PORT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. 방 목록 조회
router.get('/rooms', (req, res) => {
  const list = Object.values(db.rooms).map(r => ({
    code: r.code,
    title: r.title,
    owner: r.owner,
    mode: r.mode || 'free',
    isSecret: !!r.isSecret,
    isClosed: !!r.isClosed,
    strokeCount: r.strokes ? r.strokes.length : 0,
    createdAt: r.createdAt
  }));
  res.json(list);
});

// 3. 특정 방 단건 조회
router.get('/rooms/:roomCode', (req, res) => {
  const code = (req.params.roomCode || '').toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });

  // 관리자가 닫은 방은 일반 유저 접근 금지
  const user = getSessionUser(req);
  if (room.isClosed && (!user || user.role !== 'admin')) {
    return res.status(403).json({ error: '⛔ 관리자에 의해 폐쇄(CLOSED)된 방입니다. 일반 유저는 접근할 수 없습니다.', isClosed: true });
  }

  const roomData = {
    code: room.code,
    title: room.title,
    owner: room.owner,
    mode: room.mode || 'free',
    isSecret: !!room.isSecret,
    isClosed: !!room.isClosed,
    strokeCount: room.strokes ? room.strokes.length : 0,
    createdAt: room.createdAt
  };
  res.json({ ...roomData, room: roomData });
});

// 4. 비밀방 암호 검증
router.post('/rooms/verify-entry', (req, res) => {
  const { roomCode, secretCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];

  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' });

  // 관리자가 닫은 방은 일반 유저 입장 차단
  const user = getSessionUser(req);
  if (room.isClosed && (!user || user.role !== 'admin')) {
    return res.status(403).json({ error: '⛔ 관리자에 의해 폐쇄(CLOSED)된 방입니다. 일반 유저는 입장할 수 없습니다.' });
  }

  if (room.isSecret) {
    if (!secretCode || (hashPw(secretCode) !== room.secretCodeHash && secretCode !== room.secretCode)) {
      return res.status(403).json({ error: '비밀방 코드가 일치하지 않습니다.' });
    }
  }
  res.json({ ok: true, room: { code: room.code, title: room.title, owner: room.owner, mode: room.mode || 'free', isClosed: !!room.isClosed } });
});

// 5. 방 생성
router.post('/rooms/create', (req, res) => {
  const user = getSessionUser(req);
  const { code, title, isSecret, secretCode, mode } = req.body;
  const roomCode = (code || req.body.roomCode || '').trim().toUpperCase();
  const roomTitle = title || req.body.roomTitle || req.body.roomName;

  if (!roomCode) return res.status(400).json({ error: '방 코드를 입력하세요.' });
  if (db.rooms[roomCode]) return res.status(409).json({ error: '이미 존재하는 방 코드입니다.' });

  if (isSecret && (!secretCode || secretCode.trim().length === 0)) {
    return res.status(400).json({ error: '비밀방 코드를 입력하세요.' });
  }

  db.rooms[roomCode] = {
    code: roomCode,
    title: roomTitle || `${roomCode} 캔버스`,
    owner: user ? user.userId : 'user_a',
    mode: mode === 'battle' ? 'battle' : 'free',
    isSecret: !!isSecret,
    secretCodeHash: isSecret ? hashPw(secretCode.trim()) : null,
    secretCode: isSecret ? secretCode.trim() : null,
    strokes: [],
    createdAt: new Date().toISOString()
  };
  saveDb(db);

  if (supabase) {
    supabase.from('rooms').insert({
      code: roomCode,
      title: roomTitle || `${roomCode} 벽화 갤러리`,
      owner: user ? user.userId : 'user_a',
      is_secret: !!isSecret,
      secret_code: isSecret ? secretCode.trim() : null
    }).then(({ error }) => {
      if (error) console.error('Supabase room insert error:', error.message);
    });
  }

  res.json({ message: '방이 생성되었습니다.', room: db.rooms[roomCode] });
});

// 6. 방별 내 역할/권한 확인
router.get('/rooms/:roomCode/my-role', (req, res) => {
  const user = getSessionUser(req);
  const code = (req.params.roomCode || '').toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: '방이 존재하지 않습니다.' });

  const isOwner = !!(user && room.owner === user.userId);
  const isAdmin = !!(user && user.role === 'admin');
  const canManage = canManageRoom(user, room);

  res.json({
    roomCode: code,
    userId: user ? user.userId : null,
    role: user ? user.role : 'guest',
    isOwner,
    isAdmin,
    canManage,
    roomOwner: room.owner
  });
});

module.exports = router;
