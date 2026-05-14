const db = require('../config/database');
const { fingerprint } = require('../utils/normalize');

async function scan(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });
  const imageUrl = req.file.path;
  try {
    const { rows: labels } = await db.query(`
      SELECT sl.cigar_id, sl.confidence,
        c.id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        COALESCE(c.admin_avg_price, c.avg_price) as avg_price,
        c.scan_count,
        CASE WHEN SUM(u.reputation_score) > 0
          THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
          ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
        END as avg_rating
      FROM scan_labels sl
      JOIN cigars c ON sl.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      GROUP BY sl.cigar_id, sl.confidence, c.id, b.name
      ORDER BY sl.confidence DESC LIMIT 5
    `);
    res.json({ image_url: imageUrl, results: labels });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur analyse' });
  }
}

async function submitNewCigar(req, res) {
  const { brand_name, model_name, country_id, strength, avg_price,
    length_mm, ring_gauge, description, destination } = req.body;

  const userId   = req.user.id;
  const isAdmin  = req.user.is_admin;
  const imageUrl = req.file?.path || null;

  if (!brand_name || !model_name)
    return res.status(400).json({ error: 'Marque et modèle requis' });

  const brandFP = fingerprint(brand_name);
  const cigarFP = fingerprint(model_name);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // ── Marque ────────────────────────────────────────────────────────────
    let brandId;
    const byFP = await client.query(
      'SELECT id FROM brands WHERE name_normalized = $1', [brandFP]);
    if (byFP.rows.length) {
      brandId = byFP.rows[0].id;
    } else {
      const byName = await client.query(
        'SELECT id FROM brands WHERE LOWER(name) = LOWER($1)', [brand_name]);
      if (byName.rows.length) {
        brandId = byName.rows[0].id;
        await client.query(
          'UPDATE brands SET name_normalized = $1 WHERE id = $2 AND name_normalized IS NULL',
          [brandFP, brandId]);
      } else {
        const b = await client.query(
          'INSERT INTO brands (name, name_normalized) VALUES ($1, $2) RETURNING id',
          [brand_name.trim(), brandFP]);
        brandId = b.rows[0].id;
      }
    }

    // ── Cigare existant ? ─────────────────────────────────────────────────
    const existing = await client.query(
      'SELECT id FROM cigars WHERE brand_id = $1 AND name_normalized = $2',
      [brandId, cigarFP]);

    let cigarId, merged = false;

    if (existing.rows.length) {
      // Cigare trouvé → réutiliser la fiche
      cigarId = existing.rows[0].id;
      merged  = true;

      // Mise à jour image si absente
      if (imageUrl) {
        if (isAdmin) {
          // L'admin écrase toujours l'image et valide
          await client.query(
            `UPDATE cigars
             SET admin_image_url = $1, admin_verified = TRUE
             WHERE id = $2`,
            [imageUrl, cigarId]);
        } else {
          // Utilisateur : ne complète que si aucune image n'existe encore
          await client.query(
            `UPDATE cigars
             SET image_url = COALESCE(image_url, $1)
             WHERE id = $2 AND admin_image_url IS NULL`,
            [imageUrl, cigarId]);
        }
      } else if (isAdmin) {
        // Admin sans photo → au moins vérifier
        await client.query(
          'UPDATE cigars SET admin_verified = TRUE WHERE id = $1',
          [cigarId]);
      }
    } else {
      // ── Nouveau cigare ────────────────────────────────────────────────
      let q, p;
      if (isAdmin) {
        q = `INSERT INTO cigars
              (brand_id, name, name_normalized,
               admin_country_id, admin_strength, admin_avg_price,
               admin_length_mm, admin_ring_gauge, admin_description,
               admin_image_url, admin_verified, submitted_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11)
             RETURNING id`;
        p = [brandId, model_name.trim(), cigarFP,
             country_id||null, strength||null, avg_price||null,
             length_mm||null, ring_gauge||null, description||null,
             imageUrl, userId];
      } else {
        q = `INSERT INTO cigars
              (brand_id, name, name_normalized,
               country_id, strength, avg_price,
               length_mm, ring_gauge, description,
               image_url, submitted_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
             RETURNING id`;
        p = [brandId, model_name.trim(), cigarFP,
             country_id||null, strength||null, avg_price||null,
             length_mm||null, ring_gauge||null, description||null,
             imageUrl, userId];
      }
      const { rows } = await client.query(q, p);
      cigarId = rows[0].id;
    }

    // ── Destination ───────────────────────────────────────────────────────
    if (destination === 'cave') {
      await client.query(
        `INSERT INTO user_cave (user_id, cigar_id, quantity) VALUES ($1,$2,1)
         ON CONFLICT (user_id, cigar_id) DO UPDATE SET quantity = user_cave.quantity + 1`,
        [userId, cigarId]);
    } else if (destination === 'wishlist') {
      await client.query(
        'INSERT INTO user_wishlist (user_id, cigar_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, cigarId]);
    }

    await client.query('COMMIT');
    res.status(201).json({ cigar_id: cigarId, success: true, merged });

  } catch (e) {
    await client.query('ROLLBACK');
    console.error('submitNewCigar error:', e);
    res.status(500).json({ error: 'Erreur soumission cigare' });
  } finally {
    client.release();
  }
}

module.exports = { scan, submitNewCigar };
