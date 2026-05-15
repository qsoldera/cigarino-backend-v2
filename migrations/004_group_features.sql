-- Migration 004 — Posts, messages et rôles de groupe
ALTER TABLE cigar_group_members 
  DROP CONSTRAINT IF EXISTS cigar_group_members_role_check,
  ADD CONSTRAINT cigar_group_members_role_check 
    CHECK (role IN ('admin','moderator','member'));

-- Posts de groupe (actualités : texte/photo + partage d'évaluation)
CREATE TABLE IF NOT EXISTS group_posts (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL REFERENCES cigar_groups(id) ON DELETE CASCADE,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content  TEXT,
  image_url TEXT,
  scan_id  INT REFERENCES user_scans(id) ON DELETE SET NULL, -- partage d'évaluation
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages de conversation de groupe
CREATE TABLE IF NOT EXISTS group_messages (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL REFERENCES cigar_groups(id) ON DELETE CASCADE,
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_posts_group    ON group_posts(group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id, created_at DESC);

INSERT INTO migrations (filename) VALUES ('004_group_features.sql')
ON CONFLICT (filename) DO NOTHING;
