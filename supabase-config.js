// ========================================================
// 🎨 Supabase Client Configuration
// ========================================================
const SUPABASE_URL = 'https://nflvlxalqyyqnlvzqcsy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0QsGDAtT_I5icqpebayF6w_P2MkQr8M';

// window.supabase는 CDN에서 로드된 @supabase/supabase-js 라이브러리
window.sbClient = (typeof supabase !== 'undefined' && supabase.createClient)
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

console.log('⚡ Supabase Client initialized:', SUPABASE_URL);
