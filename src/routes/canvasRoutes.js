const express = require('express');
const { db, supabase, saveDb, canManageRoom, getSessionUser, flushStrokeBatch } = require('../services/dbService');

const router = express.Router();

// 1. 방 캔버스 획 히스토리 조회
router.get('/canvas/:roomCode', (req, res) => {
  const code = (req.params.roomCode || '').toUpperCase();
  const room = db.rooms[code];
  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  res.json({ strokes: room.strokes, roomCode: code });
});

// 2. 전체 지우기 (방장 또는 Admin)
router.post('/canvas/clear-all', (req, res) => {
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
  flushStrokeBatch();

  if (supabase) {
    supabase.from('canvas_strokes').delete().eq('room_code', code).then(({ error }) => {
      if (error) console.error('Supabase clear-all error:', error.message);
    });
  }

  // Socket 브로드캐스트는 req.app.get('io') 활용
  const io = req.app.get('io');
  if (io) io.to(code).emit('canvas-cleared-all');

  res.json({ message: '캔버스 전체가 초기화되었습니다.' });
});

// 3. 내 그림만 지우기 (소유권 RLS 검증)
router.post('/canvas/clear-mine', (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];

  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (!room) return res.status(404).json({ error: '방이 존재하지 않습니다.' });

  const initialCount = room.strokes.length;
  room.strokes = room.strokes.filter(s => s.authorId !== user.userId && s.userId !== user.userId);
  const removedCount = initialCount - room.strokes.length;
  saveDb(db);
  flushStrokeBatch();

  if (supabase) {
    supabase.from('canvas_strokes').delete()
      .eq('room_code', code)
      .eq('user_id', user.userId)
      .then(({ error }) => {
        if (error) console.error('Supabase clear-mine error:', error.message);
      });
  }

  const io = req.app.get('io');
  if (io) io.to(code).emit('init-canvas-history', { strokes: room.strokes, room: code });

  res.json({ message: `내가 그린 획 ${removedCount}개가 지워졌습니다.`, removedCount });
});

module.exports = router;
