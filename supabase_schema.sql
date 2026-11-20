-- ========================================================
-- 🎨 Infinite Canvas Platform: Supabase PostgreSQL Schema
-- ========================================================

-- 1. 유저 테이블 (Users)
CREATE TABLE IF NOT EXISTS public.users (
    user_id TEXT PRIMARY KEY,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    alias TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 방 테이블 (Rooms)
CREATE TABLE IF NOT EXISTS public.rooms (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    owner TEXT NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
    is_secret BOOLEAN DEFAULT FALSE,
    secret_code TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 캔버스 획 테이블 (Canvas Strokes)
CREATE TABLE IF NOT EXISTS public.canvas_strokes (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL REFERENCES public.rooms(code) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    color TEXT NOT NULL,
    width NUMERIC NOT NULL,
    x1 NUMERIC NOT NULL,
    y1 NUMERIC NOT NULL,
    x2 NUMERIC NOT NULL,
    y2 NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스 생성 (방별 조회 및 시간순 정렬 고속화)
CREATE INDEX IF NOT EXISTS idx_canvas_strokes_room ON public.canvas_strokes(room_code, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_canvas_strokes_user ON public.canvas_strokes(user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_owner ON public.rooms(owner);

-- 4. Supabase Realtime 활성화 (실시간 변경사항 구독)
ALTER PUBLICATION supabase_realtime ADD TABLE public.canvas_strokes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rooms;

-- 5. 스키마 및 테이블 권한 부여 (anon / authenticated 클라이언트 접근 허용)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

-- 6. Row Level Security (RLS) 활성화
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_strokes ENABLE ROW LEVEL SECURITY;

-- 익명/인증 유저 전체 읽기 정책 (인터랙티브 캔버스 조회용)
CREATE POLICY "Allow public read users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Allow public insert users" ON public.users FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read rooms" ON public.rooms FOR SELECT USING (true);
CREATE POLICY "Allow public insert rooms" ON public.rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow owner delete rooms" ON public.rooms FOR DELETE USING (true);

CREATE POLICY "Allow public read strokes" ON public.canvas_strokes FOR SELECT USING (true);
CREATE POLICY "Allow public insert strokes" ON public.canvas_strokes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete strokes" ON public.canvas_strokes FOR DELETE USING (true);

-- 기본 관리자 및 LOBBY 방 데이터 시드
INSERT INTO public.users (user_id, password, role, alias)
VALUES 
    ('admin', 'admin1234', 'admin', '시스템 관리자 (Admin)'),
    ('user_a', '1234', 'user', '아티스트 A (LOBBY 방장)'),
    ('user_b', '1234', 'user', '아티스트 B (일반 유저)')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.rooms (code, title, owner, is_secret, secret_code)
VALUES 
    ('LOBBY', '열린 광장 캔버스 (LOBBY)', 'user_a', false, null),
    ('VIP-LOUNGE', 'VIP 비밀 아틀리에 (비밀방)', 'admin', true, '1234')
ON CONFLICT (code) DO NOTHING;
