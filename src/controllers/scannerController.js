const db = require('../config/database');
const { cloudinary } = require('../config/cloudinary');
const crypto = require('crypto');

function computeHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function scan(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });

  const imageUrl = req.file.path;

  try {
    // Recherche par labels (hash-based, best-effort)
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
      ORDER BY sl.confidence DESC
      LIMIT 5
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
  const userId = req.user.id;

  if (!brand_name || !model_name) return res.status(400).json({ error: 'Marque et modèle requis' });

  const imageUrl = req.file?.path || null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Marque (upsert)
    let brandId;
    const brandRes = await client.query('SELECT id FROM brands WHERE name ILIKE $1', [brand_name]);
    if (brandRes.rows.length) {
      brandId = brandRes.rows[0].id;
    } else {
      const b = await client.query('INSERT INTO brands (name) VALUES ($1) RETURNING id', [brand_name]);
      brandId = b.rows[0].id;
    }

    // Cigare
    const { rows } = await client.query(
      `INSERT INTO cigars (brand_id, name, country_id, strength, avg_price, length_mm, ring_gauge, description, image_url, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [brandId, model_name, country_id || null, strength || null, avg_price || null,
        length_mm || null, ring_gauge || null, description || null, imageUrl, userId]
    );
    const cigarId = rows[0].id;

    // Action selon destination
    if (destination === 'cave') {
      await client.query(
        'INSERT INTO user_cave (user_id, cigar_id, quantity) VALUES ($1,$2,1) ON CONFLICT (user_id, cigar_id) DO UPDATE SET quantity = user_cave.quantity + 1',
        [userId, cigarId]
      );
    } else if (destination === 'wishlist') {
      await client.query(
        'INSERT INTO user_wishlist (user_id, cigar_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [userId, cigarId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ cigar_id: cigarId, success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Erreur soumission cigare' });
  } finally {
    client.release();
  }
}

module.exports = { scan, submitNewCigar };
