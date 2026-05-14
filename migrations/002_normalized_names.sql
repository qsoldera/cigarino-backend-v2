-- ============================================================
-- Migration 002 — Colonnes name_normalized pour dédoublonnage
-- À exécuter dans Neon SQL Editor
-- ============================================================

-- Ajouter les colonnes
ALTER TABLE brands ADD COLUMN IF NOT EXISTS name_normalized TEXT;
ALTER TABLE cigars ADD COLUMN IF NOT EXISTS name_normalized TEXT;

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_brands_name_normalized ON brands(name_normalized);
CREATE INDEX IF NOT EXISTS idx_cigars_name_brand      ON cigars(brand_id, name_normalized);

-- Backfill : normalisation minimale en SQL (accents non gérés ici,
-- le vrai fingerprint est calculé par Node.js à chaque écriture)
UPDATE brands
SET name_normalized = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g'))
WHERE name_normalized IS NULL;

UPDATE cigars
SET name_normalized = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g'))
WHERE name_normalized IS NULL;

INSERT INTO migrations (filename) VALUES ('002_normalized_names.sql')
ON CONFLICT (filename) DO NOTHING;
