const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, '..', 'pbl04_qr_db.json');
const ENV_FILE = path.join(__dirname, '..', '.env');

// .env 로드
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

module.exports = {
  PORT,
  DB_FILE,
  GEMINI_API_KEY,
  SUPABASE_URL,
  SUPABASE_KEY,
  WORLD_WIDTH: 4000,
  WORLD_HEIGHT: 3000,
  hashPw,
  maskKey,
  makeStrokeId,
  distToSegment,
  getLocalIp
};
