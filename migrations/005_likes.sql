-- Migration 005 — Likes/dislikes sur évaluations et posts de groupe

CREATE TABLE IF NOT EXISTS scan_likes (
  id SERIAL PRIMARY KEY,
  scan_id  INT NOT NULL REFERENCES user_scans(id) ON DELETE CASCADE,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_like  BOOLEAN NOT NULL, -- TRUE=like, FALSE=dislike
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scan_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_likes (
  id SERIAL PRIMARY KEY,
  post_id  INT NOT NULL REFERENCES group_posts(id) ON DELETE CASCADE,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);

-- Prix payé sur la cave (optionnel)
ALTER TABLE user_cave ADD COLUMN IF NOT EXISTS price_paid DECIMAL(8,2);
-- Prix payé sur les scans : déjà présent (price_paid)

CREATE INDEX IF NOT EXISTS idx_scan_likes_scan ON scan_likes(scan_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);

INSERT INTO migrations (filename) VALUES ('005_likes.sql')
ON CONFLICT (filename) DO NOTHING;
