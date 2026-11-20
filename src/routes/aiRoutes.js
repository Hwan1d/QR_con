const express = require('express');
const { db, saveDb, canManageRoom, getSessionUser } = require('../services/dbService');
const { callGemini, getProceduralSketch } = require('../services/geminiService');
const { WORLD_WIDTH, WORLD_HEIGHT } = require('../config');

const router = express.Router();

// 1. 방별 AI 봇 상태 조회
router.get('/bot-status', (req, res) => {
  const code = (req.query.roomCode || 'LOBBY').toUpperCase();
  const roomAiBots = req.app.get('roomAiBots') || {};
  const count = roomAiBots[code]?.length || 0;
  res.json({ botCount: count });
});

// 2. 관리자/방장 AI 봇 수동 생성
router.post('/spawn-bot', (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];
  const roomAiBots = req.app.get('roomAiBots');

  if (!room) return res.status(404).json({ error: '방이 존재하지 않습니다.' });
  if (!canManageRoom(user, room)) {
    return res.status(403).json({ error: '방 주인 또는 관리자만 AI 봇을 생성할 수 있습니다.' });
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
    angle: 0,
    speed: 3.5,
    isDrawing: true,
    isAi: true,
    turnTimer: 0,
    prevX: null,
    prevY: null
  };
  roomAiBots[code].push(newBot);

  res.json({ message: `AI 봇 [${newBot.nickname}]이 방에 참여했습니다!`, botCount: roomAiBots[code].length });
});

// 3. 관리자/방장 AI 봇 수동 제거
router.post('/remove-bot', (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || '').toUpperCase();
  const room = db.rooms[code];
  const roomAiBots = req.app.get('roomAiBots');

  if (!room) return res.status(404).json({ error: '방이 존재하지 않습니다.' });
  if (!canManageRoom(user, room)) {
    return res.status(403).json({ error: '방 주인 또는 관리자만 AI 봇을 삭제할 수 있습니다.' });
  }

  if (!roomAiBots[code] || roomAiBots[code].length === 0) {
    return res.status(400).json({ error: '삭제할 AI 봇이 없습니다.' });
  }

  const removed = roomAiBots[code].pop();
  res.json({ message: `AI 봇 [${removed.nickname}]이 퇴장했습니다.`, botCount: roomAiBots[code].length });
});

// 4. AI 캔버스 도슨트 비평
router.post('/ask-critic', async (req, res) => {
  const user = getSessionUser(req);
  const { roomCode } = req.body;
  const code = (roomCode || 'LOBBY').toUpperCase();
  const room = db.rooms[code];
  const roomAiBots = req.app.get('roomAiBots');
  const roomPlayers = req.app.get('roomPlayers');

  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });

  if (!roomAiBots[code] || roomAiBots[code].length === 0) {
    roomAiBots[code] = [{
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
    }];
  }

  const bot = roomAiBots[code][0];
  const strokeCount = room.strokes.length;
  const activeUserNames = Object.values(roomPlayers[code] || {}).map(p => p.nickname).join(', ') || '익명의 아티스트들';

  const prompt = `당신은 스트리트 아트 캔버스에 참여 중인 위트 있고 힙한 AI 그래피티 아티스트 "${bot.nickname}"입니다.
현재 캔버스 상황:
- 활성 아티스트: ${activeUserNames}
- 총 그려진 획 수: ${strokeCount}개
캔버스의 예술적 분위기를 감상하고, 유저들에게 영감을 주거나 유머러스한 비평 멘트를 한국어로 1~2문장(60자 이내)으로 남겨주세요.`;

  let comment = '';
  try {
    comment = await callGemini(prompt);
  } catch (err) {
    console.warn(`⚠️ [Gemini Critic Fallback] (${err.message})`);
    const fallbackCritiques = [
      `현재 ${strokeCount}개의 네온 선들이 폭발적인 에너지를 뿜어내고 있네요! 거리의 바이브가 느껴집니다 🔥`,
      `선 하나하나에 아티스트들의 거침없는 자유와 개성이 묻어납니다. 캔버스가 숨을 쉬고 있군요! 🎨`,
      `색감의 조화가 아주 과감하군요! 정형화된 틀을 깨부수는 멋진 그래피티입니다 ✨`,
      `누구의 간섭도 없는 이 무한한 캔버스, 지금 이 순간이 가장 예술적입니다 🚀`,
      `선과 선이 만나는 교차점마다 새로운 이야기가 태어나고 있네요. 멋집니다! 🌌`
    ];
    comment = fallbackCritiques[Math.floor(Math.random() * fallbackCritiques.length)];
  }

  bot.bubbleText = comment;
  bot.bubbleTimer = 240;

  const io = req.app.get('io');
  if (io) {
    io.to(code).emit('ai-docent-broadcast', {
      author: bot.nickname,
      comment
    });
  }

  res.json({ ok: true, nickname: bot.nickname, comment });
});

// 5. AI 영감 벡터 드로잉 생성 (완성 후 자동 퇴장)
router.post('/request-drawing', async (req, res) => {
  const user = getSessionUser(req);
  const { roomCode, prompt } = req.body;
  const code = (roomCode || 'LOBBY').toUpperCase();
  const room = db.rooms[code];
  const roomAiBots = req.app.get('roomAiBots');
  const roomPlayers = req.app.get('roomPlayers');

  if (!room) return res.status(404).json({ error: '방을 찾을 수 없습니다.' });
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: '그릴 주제를 입력해주세요.' });

  const geminiPrompt = `주제: "${prompt.trim()}".
이 주제의 형태를 2D 캔버스에 그리기 위해 연결되는 2D 상대 벡터 좌표 리스트를 순수한 JSON 배열 포맷으로 작성하세요.
반드시 다른 텍스트 없이 [ {"dx": 숫자, "dy": 숫자}, ... ] 형식으로만 응답해야 합니다.
- dx, dy는 중심(0,0) 기준 -100 ~ 100 범위의 정수 좌표입니다.
- 점의 개수는 14개에서 26개 사이로, 순서대로 이어 그렸을 때 "${prompt.trim()}"의 뚜렷한 실루엣이나 특징적 외곽선이 표현되도록 세밀하게 배치하세요.`;

  let points = [];
  try {
    const raw = await callGemini(geminiPrompt, '', 'application/json');
    try {
      points = JSON.parse(raw);
    } catch (e) {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try { points = JSON.parse(jsonMatch[0]); } catch (err) {}
      }
    }
  } catch (err) {
    console.warn(`⚠️ [Gemini 429/Error Fallback] (${err.message}). Using procedural sketch for: "${prompt.trim()}"`);
    points = getProceduralSketch(prompt);
  }

  if (!Array.isArray(points) || points.length === 0) {
    points = getProceduralSketch(prompt);
  }

  const botNames = ['Cyber_Picasso', 'Pixel_Banksy', 'Neon_VanGogh', 'Digital_Warhol', 'Retro_Basquiat'];
  const botColors = ['#c084fc', '#00f5d4', '#f15bb5', '#fee440', '#00bbf9'];
  const chosenName = botNames[Math.floor(Math.random() * botNames.length)];
  const chosenColor = botColors[Math.floor(Math.random() * botColors.length)];

  if (!roomAiBots[code]) roomAiBots[code] = [];

  const playersInRoom = Object.values(roomPlayers[code] || {});
  let spawnX = 2000, spawnY = 1500;
  if (playersInRoom.length > 0) {
    const refP = playersInRoom[0];
    const offsetAngle = Math.random() * Math.PI * 2;
    spawnX = Math.max(400, Math.min(WORLD_WIDTH - 400, Math.round(refP.x + Math.cos(offsetAngle) * 350)));
    spawnY = Math.max(400, Math.min(WORLD_HEIGHT - 400, Math.round(refP.y + Math.sin(offsetAngle) * 350)));
  }

  const sequence = points.map(pt => ({
    x: Math.max(100, Math.min(WORLD_WIDTH - 100, spawnX + (pt.dx || 0) * 2.2)),
    y: Math.max(100, Math.min(WORLD_HEIGHT - 100, spawnY + (pt.dy || 0) * 2.2))
  }));

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
      speed: 7.2,
      isDrawing: true,
      isAi: true,
      isTemporary: true,
      isFinished: false,
      drawingSequence: sequence,
      bubbleText: `🎨 "${prompt.trim()}" 그리는 중!`,
      bubbleTimer: 350,
      requestedPrompt: prompt.trim(),
      exitCountdown: null,
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
    bot.isFinished = false;
    bot.color = chosenColor;
    bot.nickname = chosenName;
    bot.drawingSequence = sequence;
    bot.bubbleText = `🎨 "${prompt.trim()}" 그리는 중!`;
    bot.bubbleTimer = 350;
    bot.requestedPrompt = prompt.trim();
    bot.exitCountdown = null;
  }

  res.json({ ok: true, message: `봇 [${bot.nickname}]이 "${prompt.trim()}" 드로잉을 시작했습니다!`, strokeCount: points.length });
});

router.get('/runs', (req, res) => res.json(db.runs || []));

module.exports = router;
