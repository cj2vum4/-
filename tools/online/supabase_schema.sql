-- ══════════════════════════════════════════════════════
-- 初次建立（新專案執行這段）
-- Dashboard → SQL Editor → New Query → 貼上 → Run
-- ══════════════════════════════════════════════════════

-- 主資料表
CREATE TABLE IF NOT EXISTS cards (
    id          BIGSERIAL PRIMARY KEY,
    script      TEXT        NOT NULL DEFAULT '',   -- 劇本識別碼，例如 'fengtuz' / 'tiancai'
    filename    TEXT        NOT NULL,
    folder      TEXT        NOT NULL DEFAULT '',
    page_num    INT         NOT NULL DEFAULT 0,
    text        TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS cards_script_idx   ON cards (script);
CREATE INDEX IF NOT EXISTS cards_filename_idx ON cards (filename);
CREATE INDEX IF NOT EXISTS cards_folder_idx   ON cards (folder);
CREATE INDEX IF NOT EXISTS cards_text_fts
    ON cards USING GIN (to_tsvector('simple', text));

-- 開放匿名讀取（GitHub Pages 靜態網站需要）
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read-only"
    ON cards FOR SELECT
    USING (true);

-- ══════════════════════════════════════════════════════
-- 若資料表已存在（舊專案 Migration）執行這段
-- ══════════════════════════════════════════════════════
-- ALTER TABLE cards ADD COLUMN IF NOT EXISTS script TEXT NOT NULL DEFAULT '';
-- CREATE INDEX IF NOT EXISTS cards_script_idx ON cards (script);
-- 舊資料若屬於天才在左，執行：
-- UPDATE cards SET script = 'tiancai' WHERE script = '';

-- ══════════════════════════════════════════════════════
-- 清除特定劇本資料（重新匯入時用）
-- ══════════════════════════════════════════════════════
-- DELETE FROM cards WHERE script = 'fengtuz';
-- DELETE FROM cards WHERE script = 'tiancai';

-- ══════════════════════════════════════════════════════
-- 線上主持搬到 Node 伺服器之後（2026-09）
-- ══════════════════════════════════════════════════════
-- 瘋兔子的線索改由伺服器讀取，玩家瀏覽器不再直接連 Supabase。
-- 在 Render 設好 SUPABASE_SECRET_KEY（Supabase → Project Settings → API Keys → secret）
-- 並確認主持台讀得到線索之後，執行下面兩行關掉匿名讀取，
-- 整本 OCR 內容就不能再被任何人用 publishable key 下載：
--
-- DROP POLICY IF EXISTS "Public read-only" ON cards;
-- （secret key 會略過 RLS，所以不需要另外建政策）
--
-- 舊版前端用過的 game_state / player_state 兩張表已不再使用，
-- 場次狀態改存在九爺同一份 Google Sheet 的「線上場次」分頁。確認不需要舊紀錄後可以刪除。
