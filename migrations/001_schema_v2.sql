-- ============================================================
-- CIGARINO v2.0 — Schema SQL complet
-- À exécuter dans Neon SQL Editor après DROP de toutes les tables
-- ============================================================

-- Table de versioning des migrations
CREATE TABLE migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pays
CREATE TABLE countries (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  code CHAR(2) NOT NULL
);

INSERT INTO countries (name, code) VALUES
  ('Cuba', 'CU'), ('Nicaragua', 'NI'), ('Honduras', 'HN'),
  ('République Dominicaine', 'DO'), ('Équateur', 'EC'),
  ('Indonésie', 'ID'), ('Mexique', 'MX'), ('Cameroun', 'CM'),
  ('USA', 'US'), ('Europe', 'EU'), ('Multiple', 'XX');

-- Marques
CREATE TABLE brands (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Utilisateurs
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  is_admin BOOLEAN DEFAULT FALSE,
  reputation_score DECIMAL(4,3) DEFAULT 0.500 CHECK (reputation_score >= 0 AND reputation_score <= 1),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tokens FCM
CREATE TABLE user_fcm_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);

-- Cigares
CREATE TABLE cigars (
  id SERIAL PRIMARY KEY,
  brand_id INT NOT NULL REFERENCES brands(id),
  name VARCHAR(255) NOT NULL,
  -- Données communautaires
  country_id INT REFERENCES countries(id),
  strength SMALLINT CHECK (strength BETWEEN 1 AND 5),
  description TEXT,
  ring_gauge DECIMAL(5,2),
  length_mm INT,
  avg_price DECIMAL(8,2),
  image_url TEXT,
  -- Données admin (prioritaires)
  admin_country_id INT REFERENCES countries(id),
  admin_strength SMALLINT CHECK (admin_strength BETWEEN 1 AND 5),
  admin_description TEXT,
  admin_ring_gauge DECIMAL(5,2),
  admin_length_mm INT,
  admin_avg_price DECIMAL(8,2),
  admin_image_url TEXT,
  admin_verified BOOLEAN DEFAULT FALSE,
  -- Méta
  submitted_by INT REFERENCES users(id),
  scan_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Labels de scan (pour la reconnaissance photo)
CREATE TABLE scan_labels (
  id SERIAL PRIMARY KEY,
  cigar_id INT NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
  label_hash TEXT NOT NULL,
  confidence DECIMAL(5,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dégustations / scans
CREATE TABLE user_scans (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cigar_id INT NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  intensity SMALLINT CHECK (intensity BETWEEN 1 AND 5),
  complexity SMALLINT CHECK (complexity BETWEEN 1 AND 5),
  draw SMALLINT CHECK (draw BETWEEN 1 AND 5),
  duration VARCHAR(20), -- '<30min', '30-60min', '60-90min', '>90min'
  finish_note TEXT,
  ash_color VARCHAR(30), -- 'blanche', 'grise_clair', 'grise_foncee', 'noire'
  smoke_consistency VARCHAR(20), -- 'legere', 'moyenne', 'dense', 'tres_dense'
  pairing VARCHAR(50),
  price_paid DECIMAL(8,2),
  private_notes TEXT,
  public_review TEXT,
  scan_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saveurs des dégustations (catégorisées)
CREATE TABLE scan_flavors (
  id SERIAL PRIMARY KEY,
  scan_id INT NOT NULL REFERENCES user_scans(id) ON DELETE CASCADE,
  flavor VARCHAR(50) NOT NULL,
  category VARCHAR(10) NOT NULL CHECK (category IN ('raw', 'mouth', 'nose'))
);

-- Moments des dégustations
CREATE TABLE scan_moments (
  id SERIAL PRIMARY KEY,
  scan_id INT NOT NULL REFERENCES user_scans(id) ON DELETE CASCADE,
  moment VARCHAR(30) NOT NULL
);

-- Favoris
CREATE TABLE user_favorites (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cigar_id INT NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, cigar_id)
);

-- Wishlist
CREATE TABLE user_wishlist (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cigar_id INT NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, cigar_id)
);

-- Cave personnelle
CREATE TABLE user_cave (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cigar_id INT NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
  quantity INT DEFAULT 1 CHECK (quantity > 0),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, cigar_id)
);

-- Signalements
CREATE TABLE reports (
  id SERIAL PRIMARY KEY,
  cigar_id INT NOT NULL REFERENCES cigars(id) ON DELETE CASCADE,
  reported_by INT NOT NULL REFERENCES users(id),
  reason VARCHAR(50) NOT NULL,
  detail TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','resolved','dismissed')),
  resolved_by INT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Abonnements
CREATE TABLE user_follows (
  id SERIAL PRIMARY KEY,
  follower_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(follower_id, following_id),
  CHECK (follower_id != following_id)
);

-- Clubs cigare
CREATE TABLE clubs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  city VARCHAR(100),
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  is_public BOOLEAN DEFAULT TRUE,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE club_members (
  id SERIAL PRIMARY KEY,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('admin','member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(club_id, user_id)
);

CREATE TABLE club_events (
  id SERIAL PRIMARY KEY,
  club_id INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  location VARCHAR(200),
  event_at TIMESTAMPTZ NOT NULL,
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Challenges mensuels
CREATE TABLE challenges (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  cigar_id INT NOT NULL REFERENCES cigars(id),
  created_by INT NOT NULL REFERENCES users(id),
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE challenge_participations (
  id SERIAL PRIMARY KEY,
  challenge_id INT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id INT REFERENCES user_scans(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(challenge_id, user_id)
);

-- Index de performance
CREATE INDEX idx_user_scans_cigar ON user_scans(cigar_id);
CREATE INDEX idx_user_scans_user ON user_scans(user_id);
CREATE INDEX idx_cigars_brand ON cigars(brand_id);
CREATE INDEX idx_scan_flavors_scan ON scan_flavors(scan_id);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON user_follows(following_id);

-- Traçage des migrations appliquées
INSERT INTO migrations (filename) VALUES ('001_schema_v2.sql');
