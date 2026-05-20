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

// FIX v2.0.4 : liste de toutes les marques (bandeau stats accueil)
async function getAllBrands(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT b.id, b.name,
        COUNT(c.id)::int AS cigar_count,
        co.name AS main_country
      FROM brands b
      LEFT JOIN cigars c ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      GROUP BY b.id, b.name, co.name
      ORDER BY b.name ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur liste marques' });
  }
}

// FIX v2.0.4 : liste de tous les cigares (bandeau stats accueil)
async function getAllCigars(req, res) {
  const { page = 1, per_page = 30, sort = 'name' } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(per_page);

  const orderMap = {
    name:   'c.name ASC',
    brand:  'b.name ASC, c.name ASC',
    rating: 'avg_rating DESC NULLS LAST',
    newest: 'c.created_at DESC',
  };
  const order = orderMap[sort] || orderMap.name;

  try {
    const { rows } = await db.query(`
      SELECT c.id, b.name AS brand, c.name AS model,
        COALESCE(c.admin_image_url, c.image_url) AS image_url,
        COALESCE(c.admin_avg_price, c.avg_price) AS avg_price,
        COALESCE(c.admin_strength, c.strength) AS strength,
        co.name AS country, c.admin_verified, c.scan_count,
        CASE WHEN SUM(u.reputation_score) > 0
          THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
          ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
        END AS avg_rating
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      GROUP BY c.id, b.name, co.name
      ORDER BY ${order}
      LIMIT $1 OFFSET $2
    `, [parseInt(per_page), offset]);

    const { rows: countRows } = await db.query('SELECT COUNT(*) FROM cigars');
    res.json({
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      per_page: parseInt(per_page),
      results: rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur liste cigares' });
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
          ) / COALESCE(c.admin_avg_price, c.avg_price) * 10, 2)
          ELSE 0
        END as value_score
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      GROUP BY c.id, b.name, co.name
      HAVING COUNT(us.id) >= 1 AND COALESCE(c.admin_avg_price, c.avg_price) > 0
      ORDER BY value_score DESC LIMIT 6
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur best value' }); }
}

async function quickSearch(req, res) {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const fp = fingerprint(q);
  try {
    const { rows } = await db.query(`
      SELECT c.id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        co.name as country,
        COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0) as avg_rating
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      WHERE c.fingerprint ILIKE $1 OR b.fingerprint ILIKE $1
         OR c.name ILIKE $2 OR b.name ILIKE $2
      GROUP BY c.id, b.name, co.name
      ORDER BY c.admin_verified DESC, c.scan_count DESC
      LIMIT 8
    `, [`%${fp}%`, `%${q}%`]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur recherche rapide' }); }
}

module.exports = {
  stats, newArrivals, trending, topRated, bestValue, quickSearch,
  getAllBrands, getAllCigars,
};
