const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { PORT, getLocalIp } = require('./src/config');
const { db, syncFromSupabase } = require('./src/services/dbService');
const { initGameEngine } = require('./src/sockets/gameEngine');

// 모듈화된 라우트 등록
const authRoutes = require('./src/routes/authRoutes');
const roomRoutes = require('./src/routes/roomRoutes');
const canvasRoutes = require('./src/routes/canvasRoutes');
const aiRoutes = require('./src/routes/aiRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// 미들웨어 설정
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // 루트 레벨 html 파일 호환성 지원

// Socket.io 게임 엔진 & 물리 틱 초기화
initGameEngine(io, app);

// API 라우터 마운트
app.use('/api/auth', authRoutes);
app.use('/api', authRoutes); // /api/preferences 호환 지원
app.use('/api', roomRoutes); // /api/qr, /api/rooms
app.use('/api', canvasRoutes); // /api/canvas
app.use('/api/ai', aiRoutes); // /api/ai/spawn-bot, /api/ai/ask-critic 등
app.use('/api/admin', adminRoutes); // 관리자 관제 센터 API
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/api/runs', (req, res) => res.json(db.runs || []));

// Supabase 클라우드 데이터 서버 메모리로 동기화
syncFromSupabase();

// 서버 기동
if (!server.listening) {
  server.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIp();
    console.log('====================================================');
    console.log(`🎨 Infinite Canvas Platform Running! (Modular v2.0)`);
    console.log(`🖥️  대형 화면 (메인): http://localhost:${PORT}`);
    console.log(`📱 스마트폰 컨트롤러: http://${ip}:${PORT}/controller.html`);
    console.log('====================================================');
  });
}

module.exports = { app, server, db };
