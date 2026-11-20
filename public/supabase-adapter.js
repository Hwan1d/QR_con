// ========================================================
// 🎨 Supabase Serverless Adapter & Realtime Engine
// ========================================================
(function() {
  const SB_CONFIG = {
    url: 'https://nflvlxalqyyqnlvzqcsy.supabase.co',
    key: 'sb_publishable_0QsGDAtT_I5icqpebayF6w_P2MkQr8M',
    geminiKey: localStorage.getItem('gemini_api_key') || ''
  };

  const sb = (typeof supabase !== 'undefined' && supabase.createClient)
    ? supabase.createClient(SB_CONFIG.url, SB_CONFIG.key)
    : null;

  window.sbClient = sb;

  // 인메모리 세션 캐시 (서버리스 환경)
  let currentToken = localStorage.getItem('qr_auth_token') || '';
  let cachedUser = null;
  const activeBots = {}; // { roomCode: [bot1, bot2] }

  // 1. 순수 클라이언트 QR 코드 생성 헬퍼
  function generateQrDataUrl(text) {
    if (typeof QRCode !== 'undefined' && QRCode.toDataURL) {
      return QRCode.toDataURL(text, { width: 300, margin: 2, color: { dark: '#00f5d4', light: '#0d1117' } });
    }
    // QRCode 라이브러리가 없을 때 기본 SVG 데이터 URL
    return Promise.resolve('https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(text));
  }

  // 2. Gemini 3.5 Flash 호출 헬퍼 (서버리스 직접 호출)
  async function callGeminiClient(prompt, isJson = false) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${SB_CONFIG.geminiKey}`;
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2000,
          thinkingConfig: { thinkingBudget: 0 }
        }
      };
      if (isJson) {
        body.generationConfig.responseMimeType = 'application/json';
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    } catch (e) {
      console.warn('Gemini client call error:', e);
      return '';
    }
  }

  // 3. Supabase Realtime 기반 가상 Socket 클래스
  class SupabaseSocketEmulator {
    constructor() {
      this.listeners = {};
      this.channel = null;
      this.currentRoom = null;
      this.role = null;
      this.playerId = 'p_' + Math.random().toString(36).substr(2, 7);
      this.screenActive = false;
    }

    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
      return this;
    }

    emit(event, data) {
      if (event === 'join-screen') {
        this.joinRoom(data.room, 'screen', data);
      } else if (event === 'join-controller') {
        this.joinRoom(data.room, 'controller', data);
      } else if (event === 'screen-leave-room') {
        if (this.channel) {
          this.channel.send({
            type: 'broadcast',
            event: 'room-session-ended',
            payload: { room: this.currentRoom, reason: '대형 화면이 로비로 나가 방 세션이 종료되었습니다.' }
          });
          this.channel.unsubscribe();
        }
      } else if (event === 'controller-input') {
        if (this.channel) {
          this.channel.send({
            type: 'broadcast',
            event: 'controller-input',
            payload: { ...data, id: this.playerId }
          });
        }
      } else if (event === 'canvas-draw-stroke') {
        if (this.channel) {
          this.channel.send({
            type: 'broadcast',
            event: 'canvas-draw-stroke',
            payload: { ...data, id: this.playerId }
          });
        }
      }
    }

    joinRoom(room, role, data) {
      const roomCode = (room || 'LOBBY').toUpperCase();
      this.currentRoom = roomCode;
      this.role = role;

      if (!sb) return;

      const channelName = 'canvas-room-' + roomCode;
      this.channel = sb.channel(channelName, {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: this.playerId }
        }
      });

      // 브로드캐스트 이벤트 수신
      this.channel.on('broadcast', { event: '*' }, ({ event, payload }) => {
        this.trigger(event, payload);
      });

      // 화면 Presence 동기화 (화면 퇴장 시 컨트롤러 자동 종료)
      this.channel.on('presence', { event: 'sync' }, () => {
        const state = this.channel.presenceState();
        const screenPresent = Object.values(state).flat().some(p => p.role === 'screen');
        this.screenActive = screenPresent;

        if (this.role === 'controller' && !screenPresent) {
          this.trigger('room-session-ended', {
            room: roomCode,
            reason: '현재 이 방에는 활성화된 대형 화면이 없습니다. 대형 화면에서 먼저 방에 입장한 후 해당 방의 새로운 QR 코드로 컨트롤러를 연결하세요.'
          });
        }
      });

      this.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (this.role === 'controller') {
          const screenLeft = leftPresences.some(p => p.role === 'screen');
          if (screenLeft) {
            this.trigger('room-session-ended', {
              room: roomCode,
              reason: '대형 화면이 로비로 나가 방 세션이 종료되었습니다.'
            });
          }
        }
      });

      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track({
            id: this.playerId,
            role: this.role,
            room: roomCode,
            joinedAt: Date.now()
          });
        }
      });
    }

    trigger(event, payload) {
      const handlers = this.listeners[event] || [];
      for (const h of handlers) {
        try { h(payload); } catch (e) { console.error('Socket handler error:', e); }
      }
    }

    disconnect() {
      if (this.channel) {
        this.channel.unsubscribe();
        this.channel = null;
      }
    }
  }

  // 4. 전역 소켓 에뮬레이터 초기화
  window.supabaseSocket = new SupabaseSocketEmulator();

  // 기존 io() 함수 대체 (서버리스 환경에서 소켓 클라이언트 대체)
  if (typeof window.io === 'undefined') {
    window.io = function() {
      return window.supabaseSocket;
    };
  }

  // 5. 서버리스 투명 fetch 가로채기 (Supabase Cloud API 연결)
  const originalFetch = window.fetch;
  window.fetch = async function(url, options = {}) {
    const urlStr = typeof url === 'string' ? url : (url?.url || '');
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    let body = {};
    if (typeof options.body === 'string') {
      try { body = JSON.parse(options.body); } catch (_) {}
    }

    // 5-1. /api/rooms
    if (urlStr.startsWith('/api/rooms')) {
      if (urlStr === '/api/rooms' && method === 'GET') {
        const { data, error } = await sb.from('rooms').select('*, canvas_strokes(count)').order('created_at', { ascending: false });
        if (!error && data) {
          const list = data.map(r => ({
            code: r.code,
            title: r.title,
            owner: r.owner,
            isSecret: !!r.is_secret,
            strokeCount: r.canvas_strokes?.[0]?.count || 0,
            createdAt: r.created_at
          }));
          return new Response(JSON.stringify(list), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }

      if (urlStr === '/api/rooms/create' && method === 'POST') {
        const token = headers['Authorization']?.replace('Bearer ', '') || currentToken;
        const user = token.startsWith('sb_token_') ? { userId: token.replace('sb_token_', '') } : { userId: 'guest' };
        const { code, title, isSecret, secretCode } = body;
        const { data, error } = await sb.from('rooms').insert({
          code: (code || '').toUpperCase(),
          title: title || code,
          owner: user.userId,
          is_secret: !!isSecret,
          secret_code: secretCode || null
        }).select().single();
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 400 });
        }
        return new Response(JSON.stringify({ ok: true, room: data }), { status: 200 });
      }

      if (urlStr === '/api/rooms/verify-entry' && method === 'POST') {
        const { roomCode, password } = body;
        const { data, error } = await sb.from('rooms').select('*').eq('code', (roomCode || '').toUpperCase()).single();
        if (error || !data) {
          return new Response(JSON.stringify({ error: '방을 찾을 수 없습니다.' }), { status: 404 });
        }
        if (data.is_secret && data.secret_code && data.secret_code !== password) {
          return new Response(JSON.stringify({ error: '비밀번호가 올바르지 않습니다.' }), { status: 403 });
        }
        return new Response(JSON.stringify({ ok: true, roomCode: data.code }), { status: 200 });
      }

      if (urlStr.includes('/my-role') && method === 'GET') {
        const parts = urlStr.split('/api/rooms/')[1].split('/my-role')[0];
        const roomCode = decodeURIComponent(parts).toUpperCase();
        const token = headers['Authorization']?.replace('Bearer ', '') || currentToken;
        const userId = token.startsWith('sb_token_') ? token.replace('sb_token_', '') : 'guest';

        const { data: user } = await sb.from('users').select('*').eq('user_id', userId).single();
        const { data: room } = await sb.from('rooms').select('*').eq('code', roomCode).single();

        const role = user?.role || 'user';
        const isOwner = room?.owner === userId;
        const isAdmin = role === 'admin';
        const canManage = isAdmin || isOwner;

        return new Response(JSON.stringify({
          roomCode,
          userId,
          role,
          isOwner,
          isAdmin,
          canManage,
          roomOwner: room?.owner || null
        }), { status: 200 });
      }
    }

    // 5-2. /api/auth
    if (urlStr.startsWith('/api/auth')) {
      if (urlStr === '/api/auth/login' && method === 'POST') {
        const { userId, password } = body;
        const { data, error } = await sb.from('users').select('*').eq('user_id', userId).eq('password', password).single();
        if (error || !data) {
          return new Response(JSON.stringify({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }), { status: 401 });
        }
        const token = 'sb_token_' + data.user_id;
        currentToken = token;
        localStorage.setItem('qr_auth_token', token);
        return new Response(JSON.stringify({
          token,
          user: { userId: data.user_id, role: data.role, alias: data.alias }
        }), { status: 200 });
      }

      if (urlStr === '/api/auth/register' && method === 'POST') {
        const { userId, password, alias, role } = body;
        const { data, error } = await sb.from('users').insert({
          user_id: userId,
          password: password,
          alias: alias || userId,
          role: role === 'admin' ? 'admin' : 'user'
        }).select().single();
        if (error) {
          return new Response(JSON.stringify({ error: '이미 사용 중인 아이디이거나 생성에 실패했습니다.' }), { status: 400 });
        }
        const token = 'sb_token_' + data.user_id;
        currentToken = token;
        localStorage.setItem('qr_auth_token', token);
        return new Response(JSON.stringify({
          token,
          user: { userId: data.user_id, role: data.role, alias: data.alias }
        }), { status: 200 });
      }

      if (urlStr === '/api/auth/me' && method === 'GET') {
        const token = headers['Authorization']?.replace('Bearer ', '') || currentToken;
        if (!token || !token.startsWith('sb_token_')) {
          return new Response(JSON.stringify({ error: '인증 필요' }), { status: 401 });
        }
        const userId = token.replace('sb_token_', '');
        const { data, error } = await sb.from('users').select('*').eq('user_id', userId).single();
        if (error || !data) {
          return new Response(JSON.stringify({ error: '유저를 찾을 수 없음' }), { status: 401 });
        }
        return new Response(JSON.stringify({
          user: { userId: data.user_id, role: data.role, alias: data.alias }
        }), { status: 200 });
      }

      if (urlStr === '/api/auth/logout') {
        currentToken = '';
        localStorage.removeItem('qr_auth_token');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }

    // 5-3. /api/canvas
    if (urlStr.startsWith('/api/canvas')) {
      if (urlStr.startsWith('/api/canvas/') && method === 'GET') {
        const roomCode = decodeURIComponent(urlStr.replace('/api/canvas/', '')).toUpperCase();
        const { data, error } = await sb.from('canvas_strokes')
          .select('*')
          .eq('room_code', roomCode)
          .order('created_at', { ascending: true });
        const strokes = (data || []).map(s => ({
          id: s.id,
          roomCode: s.room_code,
          userId: s.user_id,
          color: s.color,
          width: Number(s.width),
          x1: Number(s.x1),
          y1: Number(s.y1),
          x2: Number(s.x2),
          y2: Number(s.y2)
        }));
        return new Response(JSON.stringify({ strokes }), { status: 200 });
      }

      if (urlStr === '/api/canvas/clear-mine' && method === 'POST') {
        const { roomCode, userId } = body;
        const { data } = await sb.from('canvas_strokes')
          .delete()
          .eq('room_code', (roomCode || '').toUpperCase())
          .eq('user_id', userId)
          .select('id');
        const deletedIds = (data || []).map(d => d.id);
        if (window.supabaseSocket?.channel) {
          window.supabaseSocket.channel.send({
            type: 'broadcast',
            event: 'canvas-clear-mine',
            payload: { room: roomCode, userId, deletedIds }
          });
        }
        return new Response(JSON.stringify({ ok: true, deletedCount: deletedIds.length }), { status: 200 });
      }

      if (urlStr === '/api/canvas/clear-all' && method === 'POST') {
        const { roomCode } = body;
        await sb.from('canvas_strokes').delete().eq('room_code', (roomCode || '').toUpperCase());
        if (window.supabaseSocket?.channel) {
          window.supabaseSocket.channel.send({
            type: 'broadcast',
            event: 'canvas-clear-all',
            payload: { room: roomCode }
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }

    // 5-4. /api/qr
    if (urlStr.startsWith('/api/qr')) {
      const urlObj = new URL(urlStr, window.location.origin);
      const room = urlObj.searchParams.get('room') || 'LOBBY';
      const basePath = window.location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
      const controllerUrl = `${window.location.origin}${basePath}/controller.html?room=${encodeURIComponent(room)}`;
      const qrDataUrl = await generateQrDataUrl(controllerUrl);
      return new Response(JSON.stringify({ qrDataUrl, controllerUrl }), { status: 200 });
    }

    // 5-5. /api/ai
    if (urlStr.startsWith('/api/ai')) {
      if (urlStr === '/api/ai/ask-critic' && method === 'POST') {
        const prompt = '당신은 스트리트 아트 캔버스에 참여 중인 위트 있고 힙한 AI 그래피티 아티스트입니다. 캔버스의 예술적 분위기를 감상하고 유저들에게 유머러스한 비평 멘트를 한국어로 1~2문장(60자 이내)으로 남겨주세요.';
        const comment = await callGeminiClient(prompt);
        return new Response(JSON.stringify({ ok: true, comment: comment || '다채로운 색감의 에너지가 넘쳐나는군요!' }), { status: 200 });
      }

      if (urlStr === '/api/ai/request-drawing' && method === 'POST') {
        const { prompt: userPrompt } = body;
        const aiPrompt = `2D 캔버스에 그릴 "${userPrompt || '고양이'}"의 기하학적 벡터 선(stroke) 좌표 목록을 생성하세요. JSON 형식: {"strokes":[{"dx1":0,"dy1":0,"dx2":20,"dy2":20}]}`;
        const rawJson = await callGeminiClient(aiPrompt, true);
        let strokes = [];
        try { strokes = JSON.parse(rawJson).strokes || []; } catch (_) {}
        return new Response(JSON.stringify({ ok: true, prompt: userPrompt, strokeCount: strokes.length }), { status: 200 });
      }

      if (urlStr === '/api/ai/spawn-bot' || urlStr === '/api/ai/remove-bot' || urlStr.startsWith('/api/ai/bot-status')) {
        return new Response(JSON.stringify({ ok: true, bots: [] }), { status: 200 });
      }
    }

    // 기본 fetch fallback
    try {
      return await originalFetch(url, options);
    } catch (e) {
      console.warn('Fetch fallback bypassed:', urlStr);
      return new Response(JSON.stringify({ error: 'Network error' }), { status: 500 });
    }
  };

  console.log('⚡ [Supabase Serverless Engine] 활성화 완료: 100% 서버리스 구동 준비됨');
})();
