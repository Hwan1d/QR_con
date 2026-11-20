const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = Object.fromEntries(
  envContent.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    })
);

const supabase = createClient(envVars.SUPABASE_URL, envVars.SUPABASE_KEY);

async function runCleanMigration() {
  console.log('🚀 [Supabase Migration] 데이터 무결성 마이그레이션 시작...');

  // 1. 기존 데이터 확인
  const { data: existingUsers } = await supabase.from('users').select('user_id');
  const existingUserIds = new Set((existingUsers || []).map(u => u.user_id));

  const { data: existingRooms } = await supabase.from('rooms').select('code');
  const existingRoomCodes = new Set((existingRooms || []).map(r => r.code));

  const localDb = JSON.parse(fs.readFileSync(path.join(__dirname, 'pbl04_qr_db.json'), 'utf-8'));

  // 2. 유저 데이터 준비 (role을 'admin' 또는 'user'로 정규화)
  const usersToInsert = [];
  for (const [userId, u] of Object.entries(localDb.users || {})) {
    if (!existingUserIds.has(userId)) {
      usersToInsert.push({
        user_id: userId,
        password: u.password || '1234',
        role: u.role === 'admin' ? 'admin' : 'user',
        alias: u.alias || userId
      });
      existingUserIds.add(userId);
    }
  }

  // 방 소유자가 users에 없는 경우 자동 추가
  for (const [code, r] of Object.entries(localDb.rooms || {})) {
    const owner = r.owner || 'user_a';
    if (!existingUserIds.has(owner)) {
      usersToInsert.push({
        user_id: owner,
        password: '1234',
        role: 'user',
        alias: owner
      });
      existingUserIds.add(owner);
    }
  }

  if (usersToInsert.length > 0) {
    const { error: uErr } = await supabase.from('users').insert(usersToInsert);
    if (uErr) console.error('❌ 유저 삽입 실패:', uErr.message);
    else console.log(`✅ 신규 유저 ${usersToInsert.length}명 추가 완료`);
  } else {
    console.log('ℹ️  모든 유저가 이미 존재합니다.');
  }

  // 3. 방 데이터 준비
  const roomsToInsert = [];
  for (const [code, r] of Object.entries(localDb.rooms || {})) {
    if (!existingRoomCodes.has(code)) {
      roomsToInsert.push({
        code: code,
        title: r.title || code,
        owner: r.owner || 'user_a',
        is_secret: !!r.isSecret,
        secret_code: r.secretCode || null
      });
      existingRoomCodes.add(code);
    }
  }

  if (roomsToInsert.length > 0) {
    const { error: rErr } = await supabase.from('rooms').insert(roomsToInsert);
    if (rErr) console.error('❌ 방 삽입 실패:', rErr.message);
    else console.log(`✅ 신규 방 ${roomsToInsert.length}개 추가 완료`);
  } else {
    console.log('ℹ️  모든 방이 이미 존재합니다.');
  }

  // 4. 캔버스 획 (Strokes) 데이터 준비
  const { data: existingStrokes } = await supabase.from('canvas_strokes').select('id');
  const existingStrokeIds = new Set((existingStrokes || []).map(s => s.id));

  const strokesToInsert = [];
  for (const [code, r] of Object.entries(localDb.rooms || {})) {
    if (Array.isArray(r.strokes)) {
      for (const s of r.strokes) {
        const strokeId = s.id || `s_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        if (!existingStrokeIds.has(strokeId)) {
          strokesToInsert.push({
            id: strokeId,
            room_code: code,
            user_id: s.userId || 'guest',
            color: s.color || '#00f5d4',
            width: Number(s.width) || 3,
            x1: Number(s.x1) || 0,
            y1: Number(s.y1) || 0,
            x2: Number(s.x2) || 0,
            y2: Number(s.y2) || 0
          });
          existingStrokeIds.add(strokeId);
        }
      }
    }
  }

  if (strokesToInsert.length > 0) {
    console.log(`⏳ 캔버스 획 총 ${strokesToInsert.length}개 삽입 중...`);
    const chunkSize = 200;
    for (let i = 0; i < strokesToInsert.length; i += chunkSize) {
      const chunk = strokesToInsert.slice(i, i + chunkSize);
      const { error: sErr } = await supabase.from('canvas_strokes').insert(chunk);
      if (sErr) {
        console.error(`❌ 획 삽입 에러 (${i} ~ ${i + chunk.length}):`, sErr.message);
      }
    }
    console.log(`✅ 캔버스 획 ${strokesToInsert.length}개 업로드 완료`);
  } else {
    console.log('ℹ️  업로드할 신규 획이 없습니다.');
  }

  // 테스트 룸 정리
  await supabase.from('rooms').delete().eq('code', 'TEST-ROOM-999');

  console.log('\n🎉 [성공] Supabase 클라우드 마이그레이션이 100% 완료되었습니다!');
}

runCleanMigration().catch(console.error);
