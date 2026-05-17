-- Migration 006 — Cave : entrée distincte par date d'ajout
-- Supprimer la contrainte unique (user_id, cigar_id)
ALTER TABLE user_cave DROP CONSTRAINT IF EXISTS user_cave_user_id_cigar_id_key;

-- Nouvelle contrainte : unique par (user_id, cigar_id, date)
-- Permet d'avoir plusieurs entrées pour le même cigare à des dates différentes
CREATE UNIQUE INDEX IF NOT EXISTS user_cave_unique_per_date
  ON user_cave (user_id, cigar_id, (added_at::date));

-- Valeur par défaut reputation_score
ALTER TABLE users ALTER COLUMN reputation_score SET DEFAULT 0.50;
-- Corriger les utilisateurs avec score trop bas (valeur par défaut erronée)
UPDATE users SET reputation_score = 0.50
  WHERE reputation_score < 0.05 AND is_admin = FALSE;
