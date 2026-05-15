-- Migration 003 — Groupes cigares
ALTER TABLE user_scans ADD COLUMN IF NOT EXISTS scan_image_url TEXT;

CREATE TABLE IF NOT EXISTS cigar_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  created_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_geo BOOLEAN DEFAULT FALSE,       -- groupe de proximité
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  radius_km INT DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cigar_group_members (
  id SERIAL PRIMARY KEY,
  group_id INT NOT NULL REFERENCES cigar_groups(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_group ON cigar_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON cigar_group_members(user_id);

INSERT INTO migrations (filename) VALUES ('003_cigar_groups.sql')
ON CONFLICT (filename) DO NOTHING;
