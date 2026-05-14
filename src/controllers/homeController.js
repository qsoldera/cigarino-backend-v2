const db = require('../config/database');
const { fingerprint } = require('../utils/normalize');

async function stats(req, res) {
  try {
    const [cigarsRes, brandsRes, scansRes, usersRes] = await Promise.all([
      db.query('SELECT COUNT(*) FROM cigars'),
      db.query('SELECT COUNT(*) FROM brands'),
      db.query('SELECT COUNT(*) FROM user_scans'),
      db.query('SELECT COUNT(*) FROM users'),
    ]);
    res.json({
      total_cigars: parseInt(cigarsRes.rows[0].count),
      total_brands: parseInt(brandsRes.rows[0].count),
      total_scans:  parseInt(scansRes.rows[0].count),
      total_users:  parseInt(usersRes.rows[0].count),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur stats' });
  }
}

const CIGAR_FIELDS = `
  c.id,
  COALESCE(c.admin_image_url, c.image_url) as image_url,
  b.name as brand, c.name as model,
  COALESCE(c.admin_strength, c.strength) as strength,
  COALESCE(c.admin_avg_price, c.avg_price) as avg_price,
  co.name as country,
  c.admin_verified, c.scan_count,
  CASE WHEN SUM(u.reputation_score) > 0
    THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
    ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
  END as avg_rating,
  COUNT(us.id) as rating_count
`;

async function newArrivals(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT ${CIGAR_FIELDS}
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      WHERE c.admin_verified = TRUE
      GROUP BY c.id, b.name, co.name
      ORDER BY c.created_at DESC LIMIT 6
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur nouveautés' }); }
}

async function trending(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT ${CIGAR_FIELDS}
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      GROUP BY c.id, b.name, co.name
      ORDER BY c.scan_count DESC, c.created_at DESC LIMIT 6
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur tendances' }); }
}

async function topRated(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT ${CIGAR_FIELDS}
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      GROUP BY c.id, b.name, co.name
      HAVING COUNT(us.id) >= 1
      ORDER BY avg_rating DESC, rating_count DESC LIMIT 6
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur top rated' }); }
}

async function bestValue(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT ${CIGAR_FIELDS},
        CASE WHEN COALESCE(c.admin_avg_price, c.avg_price) > 0
          THEN ROUND((
            CASE WHEN SUM(u.reputation_score) > 0
              THEN SUM(us.rating * u.reputation_score) / SUM(u.reputation_score)
              ELSE AVG(us.rating)
            END
          ) / COALESCE(c.admin_avg_price, c.avg_price), 4)
          ELSE 0
        END as qp_ratio
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      WHERE COALESCE(c.admin_avg_price, c.avg_price) >= 3.50
      GROUP BY c.id, b.name, co.name
      HAVING COUNT(us.id) >= 1
      ORDER BY qp_ratio DESC LIMIT 6
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur rapport Q/P' }); }
}

// Recherche rapide : cherche par nom exact ET par fingerprint normalisé
async function quickSearch(req, res) {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);

  const fp = fingerprint(q);
  const pattern = `%${q}%`;

  try {
    const { rows } = await db.query(`
      SELECT c.id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        -- Priorité : correspondance exacte > fingerprint > ILIKE
        CASE
          WHEN LOWER(b.name || ' ' || c.name) LIKE LOWER($2) THEN 1
          WHEN (b.name_normalized || c.name_normalized) LIKE '%' || $3 || '%' THEN 2
          ELSE 3
        END as relevance
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      WHERE
        b.name ILIKE $2 OR c.name ILIKE $2
        OR (b.name_normalized || c.name_normalized) LIKE '%' || $3 || '%'
      ORDER BY relevance, c.scan_count DESC
      LIMIT 10
    `, [q, pattern, fp]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur recherche rapide' });
  }
}

module.exports = { stats, newArrivals, trending, topRated, bestValue, quickSearch };
