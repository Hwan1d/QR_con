const express = require('express');
const crypto = require('crypto');
const { db, SESSIONS, supabase, saveDb } = require('../services/dbService');
const { hashPw } = require('../config');

const router = express.Router();

router.post('/register', (req, res) => {
  const { userId, alias, password, role } = req.body;
  if (!userId || !alias || !password) {
    return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  }
  const cleanId = userId.trim();
  const cleanAlias = alias.trim();
  if (db.users[cleanId]) {
    return res.status(409).json({ error: '이미 존재하는 아티스트 아이디입니다.' });
  }

  const assignedRole = (role === 'admin') ? 'admin' : 'user';
  db.users[cleanId] = {
    userId: cleanId,
    alias: cleanAlias,
    password: password,
    passwordHash: hashPw(password),
    role: assignedRole
  };
  if (!db.preferences) db.preferences = {};
  db.preferences[cleanId] = {
    color: '#00f5d4',
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
      role: assignedRole
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

router.post('/login', (req, res) => {
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

router.post('/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.substring(7);
    delete SESSIONS[token];
  }
  res.json({ ok: true, message: '로그아웃되었습니다.' });
});

router.get('/me', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const user = SESSIONS[auth.substring(7)];
    if (user) return res.json({ loggedIn: true, user });
  }
  res.status(401).json({ loggedIn: false, error: '인증 필요' });
});

router.get('/preferences', (req, res) => {
  const auth = req.headers.authorization;
  const user = (auth && auth.startsWith('Bearer ')) ? SESSIONS[auth.substring(7)] : null;
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const pref = db.preferences[user.userId] || { color: '#00f5d4', nickname: user.alias, brushSize: 10 };
  res.json({ userId: user.userId, ...pref });
});

router.post('/preferences', (req, res) => {
  const auth = req.headers.authorization;
  const user = (auth && auth.startsWith('Bearer ')) ? SESSIONS[auth.substring(7)] : null;
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });

  const { color, nickname, brushSize } = req.body;
  if (!db.preferences) db.preferences = {};
  db.preferences[user.userId] = {
    color: color || '#00f5d4',
    nickname: nickname || user.alias,
    brushSize: brushSize || 10,
    updatedAt: new Date().toISOString()
  };
  saveDb(db);
  res.json({ message: '설정이 저장되었습니다.' });
});

module.exports = router;
