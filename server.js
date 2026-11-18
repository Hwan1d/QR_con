const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

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

app.use(express.static(path.join(__dirname, 'public')));

// API to generate QR Code dynamically based on network IP
app.get('/api/qr', async (req, res) => {
  try {
    const room = req.query.room || 'default';
    const localIp = getLocalIp();
    const host = req.hostname === 'localhost' || req.hostname === '127.0.0.1'
      ? `${localIp}:${PORT}`
      : req.get('host');
    const protocol = req.protocol;
    const controllerUrl = `${protocol}://${host}/controller.html?room=${encodeURIComponent(room)}`;

    const qrDataUrl = await QRCode.toDataURL(controllerUrl, {
      width: 340,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.json({ qrDataUrl, controllerUrl, localIp, port: PORT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  // Screen joins room
  socket.on('join-screen', (room) => {
    socket.join(room);
    socket.room = room;
    socket.role = 'screen';
    console.log(`[SCREEN] Joined room: ${room}`);
  });

  // Controller joins room (Triggered when QR is scanned!)
  socket.on('join-controller', (data) => {
    const { room, nickname, color } = data;
    socket.join(room);
    socket.room = room;
    socket.role = 'controller';
    socket.nickname = nickname || 'Player 1';
    socket.color = color || '#00f5d4';

    console.log(`[CONTROLLER] Scanned & joined room: ${room} (${socket.nickname})`);

    // Notify the big screen immediately to transform!
    io.to(room).emit('qr-triggered', {
      controllerId: socket.id,
      nickname: socket.nickname,
      color: socket.color,
      timestamp: Date.now()
    });
  });

  // Mode switch (Canvas <-> Brick Breaker Arcade <-> Rhythm Fireworks)
  socket.on('switch-mode', (data) => {
    if (socket.room) {
      io.to(socket.room).emit('mode-switched', data);
    }
  });

  // Controller actions (joystick, paint splat, firework launch, emoji bomb, shake, etc.)
  socket.on('controller-action', (payload) => {
    if (socket.room) {
      io.to(socket.room).emit('screen-action', {
        ...payload,
        controllerId: socket.id,
        color: payload.color || socket.color
      });
    }
  });

  // Reset back to lonely QR page
  socket.on('reset-to-qr', () => {
    if (socket.room) {
      io.to(socket.room).emit('reset-screen');
    }
  });

  socket.on('disconnect', () => {
    if (socket.room && socket.role === 'controller') {
      io.to(socket.room).emit('controller-disconnected', {
        controllerId: socket.id
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  console.log('====================================================');
  console.log(`🚀 QR Interactive Arcade Server Running!`);
  console.log(`🖥️  PC Screen (Main):   http://localhost:${PORT}`);
  console.log(`📱 Network Screen URL: http://${ip}:${PORT}`);
  console.log('====================================================');
});
