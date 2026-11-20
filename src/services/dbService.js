const fs = require('fs');
const { DB_FILE, SUPABASE_URL, SUPABASE_KEY, hashPw, makeStrokeId } = require('../config');

// 1. Supabase 클라이언트 초기화
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

// 2. 인메모리 DB 초기화 및 로컬 백업 로드
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const initialDb = {
      users: {
        admin: { userId: 'admin', alias: '시스템 관리자 (Admin)', passwordHash: hashPw('admin1234'), role: 'admin' },
        user_a: { userId: 'user_a', alias: '아티스트 A (LOBBY 방장)', passwordHash: hashPw('1234'), role: 'user' },
        user_b: { userId: 'user_b', alias: '아티스트 B (일반 유저)', passwordHash: hashPw('1234'), role: 'user' }
      },
      preferences: {},
      permissions: { admin: {}, user: {} },
      rooms: {
        'LOBBY': {
          code: 'LOBBY',
          title: '열린 광장 캔버스 (LOBBY)',
          owner: 'user_a',
          isSecret: false,
          secretCodeHash: null,
          strokes: [],
          createdAt: new Date().toISOString()
        },
        'VIP-LOUNGE': {
          code: 'VIP-LOUNGE',
          title: 'VIP 비밀 아틀리에 (비밀방)',
          owner: 'admin',
          isSecret: true,
          secretCodeHash: hashPw('1234'),
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
  return data;
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️ Local DB save error:', e.message);
  }
}

const db = loadDb();
const SESSIONS = {}; // token -> { userId, alias, role }

// 3. [리팩토링 4번] ⚡ Supabase DB 쓰기 배치(Batching / Throttling) 큐 엔진
// 1획마다 개별 INSERT 요청을 날리지 않고, 800ms 주기로 묶어서 벌크 삽입!
let strokeBatchQueue = [];
let batchFlushTimer = null;

function flushStrokeBatch() {
  if (!supabase || strokeBatchQueue.length === 0) return;
  const chunk = strokeBatchQueue.splice(0, 150); // 최대 150개씩 청크 분할

  supabase.from('canvas_strokes').insert(chunk).then(({ error }) => {
    if (error) {
      console.warn('⚠️ [Supabase Bulk Insert] Batch write error:', error.message);
    }
  });
}

// 800ms마다 배치 큐 자동 플러시
setInterval(flushStrokeBatch, 800);

function addStroke(roomCode, stroke) {
  if (!db.rooms[roomCode]) return;
  if (!db.rooms[roomCode].strokes) db.rooms[roomCode].strokes = [];
  db.rooms[roomCode].strokes.push(stroke);
  if (db.rooms[roomCode].strokes.length > 5000) db.rooms[roomCode].strokes.shift();

  if (supabase) {
    const uid = stroke.authorId || stroke.userId || 'guest';
    strokeBatchQueue.push({
      id: stroke.id || makeStrokeId(),
      room_code: roomCode,
      user_id: uid,
      color: stroke.color,
      width: Number(stroke.width) || 3,
      x1: Math.round(stroke.x1),
      y1: Math.round(stroke.y1),
      x2: Math.round(stroke.x2),
      y2: Math.round(stroke.y2)
    });
  }
}

// 4. Supabase 클라우드 데이터 동기화
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

// 5. 헬퍼 함수
function canManageRoom(user, room) {
  if (!user || !room) return false;
  if (user.role === 'admin') return true;
  if (room.owner && room.owner === user.userId) return true;
  return false;
}

function getSessionUser(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return SESSIONS[auth.substring(7)];
  }
  return null;
}

module.exports = {
  db,
  SESSIONS,
  supabase,
  saveDb,
  addStroke,
  flushStrokeBatch,
  syncFromSupabase,
  canManageRoom,
  getSessionUser
};
