const db = require('../config/database');

// FIX v2.0.2 : durées unifiées avec constants.dart côté Flutter
// Liste unique : '<30min', '30-60min', '60-90min', '>90min'
const DURATION_ORDER = ['<30min', '30-60min', '60-90min', '>90min'];

async function advancedSearch(req, res) {
  const {
    countries, flavors, moments,
    strength_value, strength_mode,
    price_min, price_max,
    duration_max,
  } = req.body;

  let conditions = [];
  let params = [];
  let idx = 1;

  if (countries?.length) {
    conditions.push(`co.name = ANY($${idx})`);
    params.push(countries);
    idx++;
  }

  if (strength_value && strength_mode) {
    const ops = { 'exact': '=', 'gte': '>=', 'lte': '<=' };
    const op = ops[strength_mode] || '=';
    conditions.push(`COALESCE(c.admin_strength, c.strength) ${op} $${idx}`);
    params.push(strength_value);
    idx++;
  }

  if (price_min !== undefined && price_min !== null) {
    conditions.push(`COALESCE(c.admin_avg_price, c.avg_price) >= $${idx}`);
    params.push(price_min);
    idx++;
  }

  if (price_max !== undefined && price_max !== null) {
    const maxVal = price_max >= 100 ? 999999 : price_max;
    conditions.push(`COALESCE(c.admin_avg_price, c.avg_price) <= $${idx}`);
    params.push(maxVal);
    idx++;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const havingParts = [];

  if (flavors?.length) {
    havingParts.push(`array_agg(DISTINCT sf.flavor::text) FILTER (WHERE sf.flavor IS NOT NULL) @> $${idx}::text[]`);
    params.push(flavors);
    idx++;
  }

  if (moments?.length) {
    havingParts.push(`array_agg(DISTINCT sm.moment::text) FILTER (WHERE sm.moment IS NOT NULL) @> $${idx}::text[]`);
    params.push(moments);
    idx++;
  }

  if (duration_max) {
    // FIX v2.0.2 : utilise la liste unifiée DURATION_ORDER
    const maxIdx = DURATION_ORDER.indexOf(duration_max);
    if (maxIdx !== -1) {
      const allowed = DURATION_ORDER.slice(0, maxIdx + 1);
      havingParts.push(`(mode() WITHIN GROUP (ORDER BY us.duration) IS NULL OR mode() WITHIN GROUP (ORDER BY us.duration) = ANY($${idx}::text[]))`);
      params.push(allowed);
      idx++;
    }
  }

  const havingClause = havingParts.length ? `HAVING ${havingParts.join(' AND ')}` : '';

  try {
    const { rows } = await db.query(`
      SELECT c.id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        COALESCE(c.admin_strength, c.strength) as strength,
        COALESCE(c.admin_avg_price, c.avg_price) as avg_price,
        co.name as country,
        c.admin_verified, c.scan_count,
        CASE WHEN SUM(u.reputation_score) > 0
          THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
          ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
        END as avg_rating,
        COUNT(DISTINCT us.id) as rating_count,
        CASE WHEN COUNT(DISTINCT us.id) > 0
          THEN (
            CASE WHEN SUM(u.reputation_score) > 0
              THEN SUM(us.rating * u.reputation_score) / SUM(u.reputation_score)
              ELSE AVG(us.rating)
            END
          ) * COUNT(DISTINCT us.id) / (COUNT(DISTINCT us.id) + 5.0)
          ELSE 0
        END as bayesian_score
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      LEFT JOIN scan_flavors sf ON sf.scan_id = us.id
      LEFT JOIN scan_moments sm ON sm.scan_id = us.id
      ${whereClause}
      GROUP BY c.id, b.name, co.name
      ${havingClause}
      ORDER BY bayesian_score DESC
      LIMIT 50
    `, params);

    res.json({ count: rows.length, results: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur recherche avancée' });
  }
}

async function getCountries(req, res) {
  try {
    const { rows } = await db.query('SELECT * FROM countries ORDER BY name');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur pays' });
  }
}

module.exports = { advancedSearch, getCountries };
