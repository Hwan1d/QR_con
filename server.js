const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'pbl04_qr_db.json');
const ENV_FILE = path.join(__dirname, '.env');

// .env 및 환경 변수 로드
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
let SUPABASE_URL = process.env.SUPABASE_URL || '';
let SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (fs.existsSync(ENV_FILE)) {
  const envContent = fs.readFileSync(ENV_FILE, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (k === 'GEMINI_API_KEY' && !GEMINI_API_KEY) GEMINI_API_KEY = v;
      if (k === 'SUPABASE_URL' && !SUPABASE_URL) SUPABASE_URL = v;
      if (k === 'SUPABASE_KEY' && !SUPABASE_KEY) SUPABASE_KEY = v;
    }
  }
}

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('🔗 [Supabase] Connected to Cloud Database:', SUPABASE_URL);
  } catch (e) {
    console.warn('⚠️ Supabase client init warning:', e.message);
  }
}

function hashPw(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function maskKey(text) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.length < 6) return text;
  return text.split(GEMINI_API_KEY).join('***[SECRET_API_KEY]***');
}

function makeStrokeId() {
  return 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const minX = Math.min(x1, x2) - 100;
  const maxX = Math.max(x1, x2) + 100;
  const minY = Math.min(y1, y2) - 100;
  const maxY = Math.max(y1, y2) + 100;
  if (px < minX || px > maxX || py < minY || py > maxY) return 999999;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

async function callGemini(prompt, systemInstruction = '', responseMimeType = null) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
  const contents = [];
  if (systemInstruction) {
    contents.push({ role: 'user', parts: [{ text: systemInstruction }] });
    contents.push({ role: 'model', parts: [{ text: '네, 알겠습니다. 지침에 따라 답변하겠습니다.' }] });
  }
  contents.push({ role: 'user', parts: [{ text: prompt }] });

  const generationConfig = {
    maxOutputTokens: 2500,
    temperature: 0.7,
    thinkingConfig: { thinkingBudget: 0 } // 생각 토큰으로 인한 JSON 잘림 방지
  };
  if (responseMimeType) {
    generationConfig.responseMimeType = responseMimeType;
  }

  const payload = {
    contents,
    generationConfig
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API Error (${resp.status}): ${maskKey(errText)}`);
  }

  const data = await resp.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  let reply = '';
  for (const part of parts) {
    if (part.text) reply += part.text;
  }
  return reply.trim();
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initialDb = {
      users: {
        user_a: { userId: 'user_a', alias: '플레이어 A (VIP 아티스트)', passwordHash: hashPw('1234'), role: 'vip' },
        user_b: { userId: 'user_b', alias: '플레이어 B (일반 낙서꾼)', passwordHash: hashPw('1234'), role: 'standard' }
      },
      preferences: {
        user_a: { color: '#00f5d4', nickname: 'CyberArtist_A', brushSize: 10, updatedAt: new Date().toISOString() },
        user_b: { color: '#ff007f', nickname: 'Doodle_B', brushSize: 8, updatedAt: new Date().toISOString() }
      },
      permissions: {
        vip: { ai_ghost: 1 },
        standard: { ai_ghost: 0 }
      },
      rooms: {
        'LOBBY': {
          code: 'LOBBY',
          title: '열린 광장 캔버스 (공개)',
          owner: 'user_a', // 기본 로비 방장: user_a
          isSecret: false,
          secretCodeHash: null,
          strokes: [],
          createdAt: new Date().toISOString()
        },
        'VIP-LOUNGE': {
          code: 'VIP-LOUNGE',
          title: 'VIP 비밀 아틀리에 (비밀방)',
          owner: 'user_a',
          isSecret: true,
          secretCodeHash: hashPw('7777'),
          strokes: [],
          createdAt: new Date().toISOString()
        }
      },
      runs: []
    };
    saveDb(initialDb);
    return initialDb;
  }
  const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  if (!data.rooms) data.rooms = {};
  for (const r of Object.values(data.rooms)) {
    if (r.strokes) {
      r.strokes.forEach(s => {
        if (!s.id) s.id = makeStrokeId();
      });
    }
  }
  return data;
}

function saveDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

let db = loadDb();

function addStrokeToRoom(roomCode, stroke) {
  if (!db.rooms[roomCode]) return;
  if (!db.rooms[roomCode].strokes) db.rooms[roomCode].strokes = [];
  db.rooms[roomCode].strokes.push(stroke);
  if (db.rooms[roomCode].strokes.length > 5000) db.rooms[roomCode].strokes.shift();

  if (supabase) {
    const uid = stroke.authorId || stroke.userId || 'guest';
    supabase.from('canvas_strokes').insert({
      id: stroke.id || makeStrokeId(),
      room_code: roomCode,
      user_id: uid,
      color: stroke.color,
      width: Number(stroke.width) || 3,
      x1: Math.round(stroke.x1),
      y1: Math.round(stroke.y1),
      x2: Math.round(stroke.x2),
      y2: Math.round(stroke.y2)
    }).then(({ error }) => {
      if (error) console.error('Supabase stroke insert error:', error.message);
    });
  }
}

async function syncFromSupabase() {
  if (!supabase) return;
  try {
    console.log('🔄 [Supabase] Syncing cloud DB into server memory...');
    const { data: users, error: uErr } = await supabase.from('users').select('*');
    if (!uErr && users) {
      users.forEach(u => {
        db.users[u.user_id] = {
          userId: u.user_id,
          alias: u.alias || u.user_id,
          password: u.password,
          passwordHash: hashPw(u.password),
          role: u.role || 'user'
        };
      });
    }

    const { data: rooms, error: rErr } = await supabase.from('rooms').select('*');
    if (!rErr && rooms) {
      for (const r of rooms) {
        if (!db.rooms[r.code]) {
          db.rooms[r.code] = {
            code: r.code,
            title: r.title,
            owner: r.owner,
            isSecret: !!r.is_secret,
            secretCodeHash: r.secret_code ? hashPw(r.secret_code) : null,
            secretCode: r.secret_code,
            strokes: [],
            createdAt: r.created_at
          };
        }
      }
    }

    const { data: strokes, error: sErr } = await supabase.from('canvas_strokes').select('*').order('created_at', { ascending: true });
    if (!sErr && strokes) {
      for (const r of Object.values(db.rooms)) {
        r.strokes = [];
      }
      strokes.forEach(s => {
        if (db.rooms[s.room_code]) {
          db.rooms[s.room_code].strokes.push({
            id: s.id,
            room: s.room_code,
            userId: s.user_id,
            authorId: s.user_id,
            color: s.color,
            width: Number(s.width) || 3,
            x1: Number(s.x1),
            y1: Number(s.y1),
            x2: Number(s.x2),
            y2: Number(s.y2)
          });
        }
      });
      console.log(`✅ [Supabase] Synced ${users?.length || 0} users, ${rooms?.length || 0} rooms, ${strokes.length} canvas strokes!`);
    }
  } catch (err) {
    console.error('❌ [Supabase] Sync error:', err.message);
  }
}

syncFromSupabase();
const SESSIONS = {}; // token -> { userId, alias, role }

// 방별 플레이어 메모리 상태: roomCode -> { socketId: playerObj }
const roomPlayers = {};
// 방별 AI 봇 상태: roomCode -> [ { id, nickname, color, x, y, angle, speed, isAi: true, ... } ]
const roomAiBots = {};

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 3000;

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. 방 전용 QR 코드 생성 API
app.get('/api/qr', async (req, res) => {
  try {
    const room = (req.query.room || 'LOBBY').toUpperCase();
    const localIp = getLocalIp();
    const host = req.hostname === 'localhost' || req.hostname === '127.0.0.1'
      ? `${localIp}:${PORT}`
      : req.get('host');
    const protocol = req.protocol;
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

// 2. 인증(Auth) API
app.post('/api/auth/register', (req, res) => {
  const { userId, alias, password, role } = req.body;
  if (!userId || !alias || !password) {
    return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  }
  const cleanId = userId.trim();
  const cleanAlias = alias.trim();
  if (db.users[cleanId]) {
    return res.status(409).json({ error: '이미 존재하는 아티스트 아이디입니다.' });
  }

  const assignedRole = (role === 'vip') ? 'vip' : 'standard';
  db.users[cleanId] = {
    userId: cleanId,
    alias: cleanAlias,
    passwordHash: hashPw(password),
    role: assignedRole
  };
  db.preferences[cleanId] = {
    color: assignedRole === 'vip' ? '#00f5d4' : '#f15bb5',
    nickname: cleanAlias,
    brushSize: 10,
    updatedAt: new Date().toISOString()
  };
  saveDb(db);
  if (supabase) {
    supabase.from('users').insert({
      user_id: cleanId,
      password: password,
      alias: cleanAlias,
      role: (role === 'admin') ? 'admin' : 'user'
    }).then(({ error }) => {
      if (error) console.error('Supabase user insert error:', error.message);
    });
  }

  const token = crypto.randomUUID();
  SESSIONS[token] = {
    userId: cleanId,
    alias: cleanAlias,
    role: assignedRole
  };

  res.json({ message: '회원가입이 완료되었습니다!', token, user: SESSIONS[token] });
});

app.post('/api/auth/login', (req, res) => {
  const { userId, password } = req.body;
  const cleanId = (userId || '').trim();
  const user = db.users[cleanId];
  if (!user || (user.passwordHash !== hashPw(password) && user.password !== password)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  const token = crypto.randomUUID();
  SESSIONS[token] = {
    userId: user.userId,
    alias: user.alias,
    role: user.role
  };
  res.json({ token, user: SESSIONS[token] });
});

app.post('/api/auth/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7);
    delete SESSIONS[token];
  }
  res.json({ ok: true, message: '로그아웃되었습니다.' });
});

function getSessionUser(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return SESSIONS[auth.substring(7)];
  }
  return null;
}

app.get('/api/auth/me', (req, res) => {
  const user = getSessionUser(req);
  res.json({ loggedIn: !!user, user });
});

// 3. 내 설정(RLS) API
app.get('/api/preferences', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const pref = db.preferences[user.userId] || { color: '#00f5d4', nickname: user.alias, brushSize: 10 };
  res.json({ userId: user.userId, ...pref });
});

app.post('/api/preferences', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const { color, nickname, brushSize } = req.body;
  db.preferences[user.userId] = {
    color: color || '#00f5d4',
    nickname: nickname || user.alias,
    brushSize: brushSize || 10,
    updatedAt: new Date().toISOString()
  };
  saveDb(db);
  res.json({ message: '설정이 저장되었습니다.' });
});

// 4. 방(Room) 목록 및 방 생성
app.get('/api/rooms', (req, res) => {
  const list = Object.values(db.rooms).map(r => ({
    code: r.code,
    title: r.title,
    owner: r.owner,
    isSecret: !!r.isSecret,
    strokeCount: r.strokes.length,
    createdAt: r.createdAt
  }));
  res.json(list);
});

app.get('/api/rooms/:roomCode', (req, res) => {
  const code = (req.params.roomCode || '').toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  res.json({
    code: room.code,
    title: room.title,
    owner: room.owner,
    isSecret: !!room.isSecret,
    strokeCount: room.strokes.length,
    createdAt: room.createdAt
  });
});

app.post('/api/rooms/verify-entry', (req, res) => {
  const { roomCode, secretCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];

  if (!room) return res.status(404).json({ error: '존재하지 않는 방입니다.' });
  if (room.isSecret) {
    if (!secretCode || hashPw(secretCode) !== room.secretCodeHash) {
      return res.status(403).json({ error: '비밀방 코드가 일치하지 않습니다.' });
    }
  }
  res.json({ ok: true, room: { code: room.code, title: room.title, owner: room.owner } });
});

app.post('/api/rooms/create', (req, res) => {
  const user = getSessionUser(req);
  const { code, title, isSecret, secretCode } = req.body;
  const roomCode = (code || '').trim().toUpperCase();

  if (!roomCode) return res.status(400).json({ error: '방 코드를 입력하세요.' });
  if (db.rooms[roomCode]) return res.status(409).json({ error: '이미 존재하는 방 코드입니다.' });

  if (isSecret && (!secretCode || secretCode.trim().length === 0)) {
    return res.status(400).json({ error: '비밀방 코드를 입력하세요.' });
  }

  db.rooms[roomCode] = {
    code: roomCode,
    title: title || `${roomCode} 벽화 갤러리`,
    owner: user ? user.userId : 'anonymous',
    isSecret: !!isSecret,
    secretCodeHash: isSecret ? hashPw(secretCode.trim()) : null,
    strokes: [],
    createdAt: new Date().toISOString()
  };
  saveDb(db);
  if (supabase) {
    supabase.from('rooms').insert({
      code: roomCode,
      title: title || `${roomCode} 벽화 갤러리`,
      owner: user ? user.userId : 'user_a',
      is_secret: !!isSecret,
      secret_code: isSecret ? secretCode.trim() : null
    }).then(({ error }) => {
      if (error) console.error('Supabase room insert error:', error.message);
    });
  }
  res.json({ message: '방이 생성되었습니다.', room: db.rooms[roomCode] });
});

// 방 관리 권한 판별: 최고 관리자(admin)이거나 해당 방의 방 주인(owner)인 경우에만 관리 가능!
function canManageRoom(user, room) {
  if (!user || !room) return false;
  if (user.role === 'admin') return true;
  if (room.owner && room.owner === user.userId) return true;
  return false;
}

// 5. 방장/관리자 권한 및 지우기 API (전체 지우기 vs 내 그림만 지우기 RLS)
// 5-0. 방별 현재 유저의 역할 및 관리 권한 조회 API
app.get('/api/rooms/:roomCode/my-role', (req, res) => {
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

// 5-1. 방장/관리자 전용: 화면 전체 지우기
app.post('/api/canvas/clear-all', (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];

  if (!room) return res.status(404).json({ error: '방이 존재하지 않습니다.' });
  if (!canManageRoom(user, room)) {
    return res.status(403).json({ error: '해당 방의 방 주인 또는 시스템 관리자(admin)만 전체 지우기를 할 수 있습니다.' });
  }

  room.strokes = [];
  saveDb(db);
  if (supabase) {
    supabase.from('canvas_strokes').delete().eq('room_code', code).then(({ error }) => {
      if (error) console.error('Supabase clear-all error:', error.message);
    });
  }
  io.to(code).emit('canvas-cleared-all');
  res.json({ message: '캔버스 전체가 초기화되었습니다.' });
});

// 5-2. 일반 유저 권한: 내가 그린 그림만 지우기 (소유권 RLS 검증)
app.post('/api/canvas/clear-mine', (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];

  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (!room) return res.status(404).json({ error: '방이 존재하지 않습니다.' });

  const initialCount = room.strokes.length;
  // 내 userId(소유자)가 아닌 획들만 남김
  room.strokes = room.strokes.filter(s => s.authorId !== user.userId && s.userId !== user.userId);
  const removedCount = initialCount - room.strokes.length;
  saveDb(db);
  if (supabase) {
    supabase.from('canvas_strokes').delete()
      .eq('room_code', code)
      .eq('user_id', user.userId)
      .then(({ error }) => {
        if (error) console.error('Supabase clear-mine error:', error.message);
      });
  }

  // 방 전체에 갱신된 캔버스 히스토리 재발송
  io.to(code).emit('init-canvas-history', { strokes: room.strokes, room: code });
  res.json({ message: `내가 그린 획 ${removedCount}개가 지워졌습니다.`, removedCount });
});

// 6. 방장/관리자 전용: AI 잠입 봇 관리 (최대 2개 생성 / 삭제)
app.post('/api/ai/spawn-bot', (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];

  if (!room) return res.status(404).json({ error: '방이 존재하지 않습니다.' });
  if (!canManageRoom(user, room)) {
    return res.status(403).json({ error: '해당 방의 방 주인 또는 시스템 관리자(admin)만 AI 봇을 생성할 수 있습니다.' });
  }

  if (!roomAiBots[code]) roomAiBots[code] = [];
  if (roomAiBots[code].length >= 2) {
    return res.status(400).json({ error: 'AI 봇은 방당 최대 2마리까지만 소환 가능합니다.' });
  }

  const botIndex = roomAiBots[code].length + 1;
  const botColors = ['#ff0055', '#7928ca', '#f5a623'];
  const botNames = ['Ghost_MonaLisa', 'Cyber_Picasso', 'Pixel_Banksy'];

  const newBot = {
    id: `ai-bot-${Date.now()}-${botIndex}`,
    room: code,
    nickname: botNames[botIndex - 1] || `AI_Ghost_${botIndex}`,
    color: botColors[botIndex - 1] || '#7928ca',
    x: Math.random() * (WORLD_WIDTH - 800) + 400,
    y: Math.random() * (WORLD_HEIGHT - 800) + 400,
    angle: Math.random() * Math.PI * 2,
    speed: 3.8,
    isDrawing: true,
    isAi: true,
    turnTimer: 0,
    prevX: null,
    prevY: null
  };

  roomAiBots[code].push(newBot);

  // 운영 로그 기록
  const now = new Date().toTimeString().split(' ')[0];
  const run = {
    runId: db.runs.length + 1,
    timestamp: now,
    userAlias: user.alias,
    action: 'AI 잠입 봇 소환',
    decision: '관리 권한 승인 · 소환 완료',
    outboundCalls: 0,
    note: `방 [${code}]에 AI 봇 [${newBot.nickname}] 소환`
  };
  db.runs.unshift(run);
  saveDb(db);
  io.emit('audit-run-created', run);

  res.json({ message: `AI 봇 [${newBot.nickname}]이 방에 잠입했습니다!`, botCount: roomAiBots[code].length });
});

app.post('/api/ai/remove-bot', (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];

  if (!room) return res.status(404).json({ error: '방이 존재하지 않습니다.' });
  if (!canManageRoom(user, room)) {
    return res.status(403).json({ error: '해당 방의 방 주인 또는 시스템 관리자(admin)만 AI 봇을 삭제할 수 있습니다.' });
  }

  if (!roomAiBots[code] || roomAiBots[code].length === 0) {
    return res.status(400).json({ error: '삭제할 AI 봇이 없습니다.' });
  }

  const removed = roomAiBots[code].pop();
  res.json({ message: `AI 봇 [${removed.nickname}]이 퇴장했습니다.`, botCount: roomAiBots[code].length });
});

app.get('/api/ai/bot-status', (req, res) => {
  const code = (req.query.roomCode || 'LOBBY').toUpperCase();
  const count = roomAiBots[code]?.length || 0;
  res.json({ botCount: count });
});

// [Gemini 3.5 Flash] 1. AI 봇 스트리트 아트 비평 & 위트 코멘터리 생성
app.post('/api/ai/ask-critic', async (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || 'LOBBY').toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });

  // 봇이 방에 없으면 자동 하나 소환
  if (!roomAiBots[code] || roomAiBots[code].length === 0) {
    const defaultBot = {
      id: `ai-bot-${Date.now()}-1`,
      room: code,
      nickname: 'Cyber_Picasso',
      color: '#7928ca',
      x: 2000,
      y: 1500,
      angle: 0,
      speed: 3.5,
      isDrawing: true,
      isAi: true,
      turnTimer: 0,
      prevX: null,
      prevY: null
    };
    if (!roomAiBots[code]) roomAiBots[code] = [];
    roomAiBots[code].push(defaultBot);
  }

  const bot = roomAiBots[code][0];
  const strokeCount = room.strokes.length;
  const activeUserNames = Object.values(roomPlayers[code] || {}).map(p => p.nickname).join(', ') || '익명의 아티스트들';

  const prompt = `당신은 스트리트 아트 캔버스에 참여 중인 위트 있고 힙한 AI 그래피티 아티스트 "${bot.nickname}"입니다.
현재 캔버스 상황:
- 활성 아티스트: ${activeUserNames}
- 총 그려진 획 수: ${strokeCount}개
캔버스의 예술적 분위기를 감상하고, 유저들에게 영감을 주거나 유머러스한 비평 멘트를 한국어로 1~2문장(60자 이내)으로 남겨주세요.`;

  try {
    const comment = await callGemini(prompt);
    bot.bubbleText = comment;
    bot.bubbleTimer = 240; // 약 6초간 화면 말풍선 표시

    // PBL 04 감사 로그 기록
    const now = new Date().toTimeString().split(' ')[0];
    const run = {
      runId: db.runs.length + 1,
      timestamp: now,
      userAlias: user ? user.alias : '방 방문자',
      action: 'AI 캔버스 도슨트 비평',
      decision: 'Gemini 3.5 Flash 호출 성공',
      outboundCalls: 1,
      note: `봇 [${bot.nickname}]: "${comment.slice(0, 30)}..."`
    };
    db.runs.unshift(run);
    saveDb(db);
    io.emit('audit-run-created', run);

    // 스크린 화면에 브로드캐스트
    io.to(code).emit('ai-docent-broadcast', {
      author: bot.nickname,
      comment,
      runId: run.runId
    });

    res.json({ ok: true, nickname: bot.nickname, comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// [Gemini 3.5 Flash] 2. AI 영감 벡터 드로잉 생성 (프롬프트를 분석하여 직접 그리기)
app.post('/api/ai/request-drawing', async (req, res) => {
  const user = getSessionUser(req);
  const { roomCode, prompt } = req.body;
  const code = (roomCode || 'LOBBY').toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: '그릴 주제를 입력해주세요.' });

  // AI 아티스트 봇 소환/준비
  const botNames = ['Cyber_Picasso', 'Pixel_Banksy', 'Neon_VanGogh', 'Digital_Warhol', 'Retro_Basquiat'];
  const botColors = ['#c084fc', '#00f5d4', '#f15bb5', '#fee440', '#00bbf9'];
  const chosenName = botNames[Math.floor(Math.random() * botNames.length)];
  const chosenColor = botColors[Math.floor(Math.random() * botColors.length)];

  if (!roomAiBots[code]) roomAiBots[code] = [];

  // 스폰 위치: 유저의 현재 위치 근처에 자연스럽게 등장
  const playersInRoom = Object.values(roomPlayers[code] || {});
  let spawnX = 2000, spawnY = 1500;
  if (playersInRoom.length > 0) {
    const refP = playersInRoom[0];
    const offsetAngle = Math.random() * Math.PI * 2;
    spawnX = Math.max(400, Math.min(WORLD_WIDTH - 400, Math.round(refP.x + Math.cos(offsetAngle) * 350)));
    spawnY = Math.max(400, Math.min(WORLD_HEIGHT - 400, Math.round(refP.y + Math.sin(offsetAngle) * 350)));
  }

  let bot = roomAiBots[code].find(b => b.isAi);
  if (!bot) {
    bot = {
      id: `ai-artist-${Date.now()}`,
      room: code,
      nickname: chosenName,
      color: chosenColor,
      x: spawnX,
      y: spawnY,
      angle: 0,
      speed: 6.8,
      isDrawing: true,
      isAi: true,
      isTemporary: true, // 그림 완성 후 자동 퇴장 플래그
      turnTimer: 0,
      prevX: spawnX,
      prevY: spawnY
    };
    roomAiBots[code].push(bot);
  } else {
    bot.x = spawnX;
    bot.y = spawnY;
    bot.prevX = spawnX;
    bot.prevY = spawnY;
    bot.isTemporary = true;
    bot.color = chosenColor;
    bot.nickname = chosenName;
  }

  const geminiPrompt = `주제: "${prompt.trim()}".
이 주제의 형태를 2D 캔버스에 그리기 위해 연결되는 2D 상대 벡터 좌표 리스트를 순수한 JSON 배열 포맷으로 작성하세요.
반드시 다른 텍스트 없이 [ {"dx": 숫자, "dy": 숫자}, ... ] 형식으로만 응답해야 합니다.
- dx, dy는 중심(0,0) 기준 -100 ~ 100 범위의 정수 좌표입니다.
- 점의 개수는 14개에서 26개 사이로, 순서대로 이어 그렸을 때 "${prompt.trim()}"의 뚜렷한 실루엣이나 특징적 외곽선이 표현되도록 세밀하게 배치하세요.`;

  try {
    const raw = await callGemini(geminiPrompt, '', 'application/json');
    let points = [];
    try {
      points = JSON.parse(raw);
    } catch (e) {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try { points = JSON.parse(jsonMatch[0]); } catch (err) {}
      }
    }

    if (!Array.isArray(points) || points.length === 0) {
      // 파싱 실패 시에만 유려한 하트 모양 폴백
      points = [
        { dx: 0, dy: -20 }, { dx: 25, dy: -45 }, { dx: 50, dy: -35 },
        { dx: 55, dy: -10 }, { dx: 40, dy: 20 }, { dx: 0, dy: 60 },
        { dx: -40, dy: 20 }, { dx: -55, dy: -10 }, { dx: -50, dy: -35 },
        { dx: -25, dy: -45 }, { dx: 0, dy: -20 }
      ];
    }

    // 봇에게 해당 드로잉 목표 지점들 부여 (캔버스 가시성을 위해 적절히 2배 스케일링)
    const startX = bot.x;
    const startY = bot.y;
    bot.drawingSequence = points.map(pt => ({
      x: Math.max(100, Math.min(WORLD_WIDTH - 100, startX + (pt.dx || 0) * 2.2)),
      y: Math.max(100, Math.min(WORLD_HEIGHT - 100, startY + (pt.dy || 0) * 2.2))
    }));
    bot.bubbleText = `🎨 "${prompt.trim()}" 그리는 중!`;
    bot.bubbleTimer = 350;
    bot.requestedPrompt = prompt.trim();
    bot.exitCountdown = null;

    // PBL 04 감사 로그 기록
    const now = new Date().toTimeString().split(' ')[0];
    const run = {
      runId: db.runs.length + 1,
      timestamp: now,
      userAlias: user ? user.alias : '방 방문자',
      action: `AI 자동 드로잉: ${prompt.trim()}`,
      decision: 'Gemini 3.5 Flash 벡터 생성 완료',
      outboundCalls: 1,
      note: `선분 ${points.length}개 생성됨`
    };
    db.runs.unshift(run);
    saveDb(db);
    io.emit('audit-run-created', run);

    res.json({ ok: true, message: `봇 [${bot.nickname}]이 "${prompt.trim()}" 드로잉을 시작했습니다!`, strokeCount: points.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/runs', (req, res) => res.json(db.runs));

// 7. Socket.io 실시간 통신
const roomScreens = {}; // roomCode -> Set of socketId (활성 대형 화면 추적)

io.on('connection', (socket) => {
  // 스크린 입장
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

  // 스크린이 로비로 퇴장할 때 (컨트롤러 세션 자동 종료 트리거)
  socket.on('screen-leave-room', (data) => {
    const room = (data?.room || socket.room || '').toUpperCase();
    if (room && roomScreens[room]) {
      roomScreens[room].delete(socket.id);
      if (roomScreens[room].size === 0) {
        // 대형 화면이 로비로 나갔으므로 연결된 컨트롤러들에게 종료 알림 브로드캐스트
        io.to(room).emit('room-session-ended', {
          room,
          reason: '대형 화면이 로비로 나가 방 세션이 종료되었습니다.'
        });
      }
    }
    socket.leave(room);
  });

  // 컨트롤러 입장
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

  // 조이스틱 조작
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

  // 터치 패드 지우개 이벤트 (내 위치 기준 오프셋 획 삭제 - RLS 검증)
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
      if (s.authorId === p.userId && distToSegment(ex, ey, s.x1, s.y1, s.x2, s.y2) <= (radius + (s.width || 8) / 2)) {
        removedIds.push(s.id);
        return false;
      }
      return true;
    });
    if (removedIds.length > 0) {
      io.to(room).emit('strokes-erased', { removedIds, room });
    }
  });

  // 모바일 터치 패드 드로잉 (내 위치 중심 오프셋에 authorId 태깅!)
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
        authorId: p ? p.userId : 'guest' // 소유권 메타데이터 부여!
      };

      addStrokeToRoom(room, worldStroke);
      io.to(room).emit('live-stroke-drawn', worldStroke);
    }
  });

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

setInterval(() => saveDb(db), 10000);

// 서버 물리 틱 (40 FPS): 유저 이동 + AI 잠입 봇 자율 주행 및 낙서!
setInterval(() => {
  for (const [room, playersMap] of Object.entries(roomPlayers)) {
    const activePlayers = Object.values(playersMap);
    const aiBots = roomAiBots[room] || [];

    // 1. 유저 지렁이 이동 & 선 긋기 & 지우개 충돌
    for (const p of activePlayers) {
      if (p.speed > 0.1) {
        const nextX = p.x + Math.cos(p.angle) * p.speed;
        const nextY = p.y + Math.sin(p.angle) * p.speed;

        p.x = Math.max(20, Math.min(WORLD_WIDTH - 20, nextX));
        p.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, nextY));

        // 지우개 모드: 이동하면서 지나간 위치의 "내 그림"만 실시간 삭제 (RLS 적용)
        if (p.isErasing && p.eraserRadius > 0 && db.rooms[room]) {
          const radius = p.eraserRadius;
          const roomStrokes = db.rooms[room].strokes;
          const removedIds = [];
          db.rooms[room].strokes = roomStrokes.filter(s => {
            if (s.authorId === p.userId && distToSegment(p.x, p.y, s.x1, s.y1, s.x2, s.y2) <= (radius + (s.width || 8) / 2)) {
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
              authorId: p.userId // 내 소유권 태그
            };
            addStrokeToRoom(room, stroke);
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
            bot.bubbleTimer = 100;
            if (bot.isTemporary) {
              bot.exitCountdown = 60; // 약 1.5초간 완성작 감상 후 퇴장
            }
          }
        } else {
          bot.angle = Math.atan2(tdy, tdx);
          bot.speed = 6.8;
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
        // 할 일을 마친 임시 봇 퇴장
        roomAiBots[room] = roomAiBots[room].filter(b => b.id !== bot.id);
        continue;
      } else {
        // 일반 자율 배회 (관리자 소환 봇)
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
            authorId: bot.id // AI 소유권 태그
          };
          addStrokeToRoom(room, aiStroke);
          io.to(room).emit('live-stroke-drawn', aiStroke);
        }
      }
      bot.prevX = bot.x;
      bot.prevY = bot.y;
    }

    // 모든 사람 플레이어 + AI 봇을 함께 스크린에 브로드캐스트
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

// 주기적 AI 봇 자율 비평 및 말풍선 (35초마다 1회 - Gemini 3.5 Flash)
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
        // 백그라운드 주기 호출 에러 무시
      }
    }
  }
}, 35000);

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log('====================================================');
  console.log(`🎨 Infinite Canvas Platform Running!`);
  console.log(`🖥️  대형 화면 (메인): http://localhost:${PORT}`);
  console.log(`📱 스마트폰 컨트롤러: http://${ip}:${PORT}/controller.html`);
  console.log('====================================================');
});

module.exports = { app, server, db };
