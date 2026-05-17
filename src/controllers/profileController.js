const db = require('../config/database');

async function getProfile(req, res) {
  const userId = req.user.id;
  try {
    const [scanRes, avgRes, favRes, caveRes, wishRes] = await Promise.all([
      db.query('SELECT COUNT(*) FROM user_scans WHERE user_id=$1', [userId]),
      db.query('SELECT ROUND(AVG(rating)::numeric,2) as avg FROM user_scans WHERE user_id=$1', [userId]),
      db.query('SELECT COUNT(*) FROM user_favorites WHERE user_id=$1', [userId]),
      db.query(`
        SELECT
          COUNT(*)::int          AS cave_references,
          COALESCE(SUM(quantity),0)::int AS cave_total
        FROM user_cave WHERE user_id=$1
      `, [userId]),
      db.query('SELECT COUNT(*) FROM user_wishlist WHERE user_id=$1', [userId]),
    ]);
    const { password_hash, ...user } = req.user;
    res.json({
      ...user,
      total_scans:       parseInt(scanRes.rows[0].count),
      avg_rating:        parseFloat(avgRes.rows[0].avg) || 0,
      total_favorites:   parseInt(favRes.rows[0].count),
      cave_references:   caveRes.rows[0].cave_references,
      cave_total_cigars: caveRes.rows[0].cave_total,
      wishlist_count:    parseInt(wishRes.rows[0].count),
    });
  } catch (e) {
    console.error('getProfile error:', e);
    res.status(500).json({ error: 'Erreur profil' });
  }
}

async function updateAvatar(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });
  try {
    const { rows } = await db.query(
      'UPDATE users SET avatar_url=$1 WHERE id=$2 RETURNING avatar_url',
      [req.file.path, req.user.id]
    );
    res.json({ avatar_url: rows[0].avatar_url });
  } catch (e) { res.status(500).json({ error: 'Erreur avatar' }); }
}

// ── Cave ──────────────────────────────────────────────────────────────────────
async function getCave(req, res) {
  const { sort = 'date' } = req.query;
  const order = {
    date:   'MIN(uc.added_at) DESC',
    brand:  'b.name ASC',
    rating: 'avg_rating DESC NULLS LAST',
    price:  'COALESCE(c.admin_avg_price,c.avg_price) ASC NULLS LAST',
  }[sort] || 'MIN(uc.added_at) DESC';
  try {
    // Regrouper par cigare, agréger les entrées (dates distinctes)
    const { rows } = await db.query(`
      SELECT
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        COALESCE(c.admin_avg_price, c.avg_price) as avg_price,
        cave.total_quantity,
        cave.entries,
        COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0) as avg_rating
      FROM (
        -- Sous-requête isolée sur user_cave uniquement, sans JOIN user_scans
        SELECT
          cigar_id,
          SUM(quantity)::int as total_quantity,
          json_agg(
            json_build_object('id', id, 'quantity', quantity, 'added_at', added_at)
            ORDER BY added_at ASC
          ) as entries,
          MIN(added_at) as first_added_at
        FROM user_cave
        WHERE user_id=$1
        GROUP BY cigar_id
      ) cave
      JOIN cigars c ON c.id = cave.cigar_id
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      GROUP BY c.id, b.name, cave.total_quantity, cave.entries, cave.first_added_at
      ORDER BY ${order.replace('MIN(uc.added_at)', 'cave.first_added_at').replace('uc.', 'cave.')}
    `, [req.user.id]);
    res.json(rows);
  } catch (e) {
    console.error('getCave:', e);
    res.status(500).json({ error: 'Erreur cave' });
  }
}

async function addToCave(req, res) {
  const { cigar_id, quantity = 1, price_paid } = req.body;
  console.log(`[addToCave] user=${req.user.id} cigar=${cigar_id} qty=${quantity} at=${new Date().toISOString()}`);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock($1)',
      [parseInt(req.user.id) * 1000000 + parseInt(cigar_id)]);

    // Chercher N'IMPORTE QUELLE entrée existante (pas seulement aujourd'hui)
    // L'entrée par date distincte ne s'applique qu'aux entrées créées manuellement
    // via le gestionnaire de stock, pas via le bouton "Ajouter à ma cave"
    const existing = await client.query(
      `SELECT id FROM user_cave
       WHERE user_id=$1 AND cigar_id=$2
       ORDER BY added_at DESC LIMIT 1`,
      [req.user.id, cigar_id]);

    if (existing.rows.length) {
      // Incrémenter la dernière entrée existante
      await client.query(
        `UPDATE user_cave SET quantity = quantity + $1,
           price_paid = COALESCE($2, price_paid)
         WHERE id = $3`,
        [quantity, price_paid||null, existing.rows[0].id]);
    } else {
      // Aucune entrée → créer la première
      await client.query(
        `INSERT INTO user_cave (user_id, cigar_id, quantity, price_paid)
         VALUES ($1,$2,$3,$4)`,
        [req.user.id, cigar_id, quantity, price_paid||null]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('addToCave:', e.message);
    res.status(500).json({ error: 'Erreur ajout cave' });
  } finally { client.release(); }
}

async function removeFromCave(req, res) {
  const { cave_entry_id } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM user_cave WHERE id=$1 AND user_id=$2 RETURNING id',
      [cave_entry_id, req.user.id]);
    if (result.rowCount === 0)
      return res.status(404).json({ error: 'Entrée introuvable' });
    res.json({ success: true });
  } catch (e) {
    console.error('removeFromCave:', e.message);
    res.status(500).json({ error: 'Erreur suppression' });
  }
}

async function decrementCave(req, res) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE user_cave SET quantity = quantity - 1
       WHERE id = (
         SELECT id FROM user_cave WHERE user_id=$1 AND cigar_id=$2
         ORDER BY added_at DESC LIMIT 1
       ) RETURNING id, quantity`,
      [req.user.id, req.params.cigar_id]);
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Non trouvé en cave' });
    }
    const { id, quantity: qty } = rows[0];
    if (qty <= 0) await client.query('DELETE FROM user_cave WHERE id=$1', [id]);
    await client.query('COMMIT');
    res.json({ quantity: Math.max(0, qty), removed: qty <= 0 });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('decrementCave:', e.message);
    res.status(500).json({ error: 'Erreur décrémentation' });
  } finally { client.release(); }
}

async function updateCaveItem(req, res) {
  const entryId = req.params.cave_entry_id;
  const userId  = req.user.id;
  const qty     = req.body.quantity !== undefined ? Number(req.body.quantity) : undefined;
  const addedAt = req.body.added_at;

  console.log('[updateCaveItem] entryId:', entryId, 'qty:', qty, 'addedAt:', addedAt);

  if (qty !== undefined && qty <= 0) {
    await db.query('DELETE FROM user_cave WHERE id=$1 AND user_id=$2', [entryId, userId]);
    return res.json({ removed: true });
  }

  const sets = [], params = [];
  let idx = 1;
  if (qty !== undefined && !isNaN(qty) && qty > 0) {
    sets.push(`quantity=$${idx++}`); params.push(Math.round(qty));
  }
  if (addedAt) {
    sets.push(`added_at=$${idx++}`); params.push(new Date(addedAt));
  }
  if (!sets.length) return res.status(400).json({ error: 'Rien à modifier' });

  params.push(userId, entryId);
  try {
    const { rowCount, rows } = await db.query(
      `UPDATE user_cave SET ${sets.join(',')}
       WHERE user_id=$${idx} AND id=$${idx+1} RETURNING id, quantity`,
      params);
    if (rowCount === 0) return res.status(404).json({ error: 'Entrée introuvable' });
    res.json({ success: true, row: rows[0] });
  } catch (e) {
    console.error('updateCaveItem error:', e.message);
    res.status(500).json({ error: 'Erreur mise à jour cave' });
  }
}


async function getCarnet(req, res) {
  const { sort = 'date' } = req.query;
  const order = {
    date:   'us.created_at DESC',
    rating: 'us.rating DESC',
    brand:  'b.name ASC',
  }[sort] || 'us.created_at DESC';
  try {
    const { rows } = await db.query(`
      SELECT us.id, us.rating, us.created_at, us.public_review, us.finish_note,
        us.intensity, us.complexity, us.draw, us.duration, us.pairing,
        us.ash_color, us.smoke_consistency,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        array_agg(DISTINCT sf.flavor) FILTER (WHERE sf.flavor IS NOT NULL) as flavors,
        array_agg(DISTINCT sm.moment) FILTER (WHERE sm.moment IS NOT NULL) as moments
      FROM user_scans us
      JOIN cigars c ON us.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN scan_flavors sf ON sf.scan_id = us.id
      LEFT JOIN scan_moments sm ON sm.scan_id = us.id
      WHERE us.user_id=$1
      GROUP BY us.id, c.id, b.name
      ORDER BY ${order}
    `, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur carnet' }); }
}

async function deleteScan(req, res) {
  try {
    const { rows } = await db.query(
      'DELETE FROM user_scans WHERE id=$1 AND user_id=$2 RETURNING cigar_id',
      [req.params.scan_id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Scan introuvable' });
    await db.query('UPDATE cigars SET scan_count = GREATEST(0, scan_count - 1) WHERE id=$1',
      [rows[0].cigar_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur suppression scan' }); }
}

// ── Favoris ───────────────────────────────────────────────────────────────────
async function getFavorites(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT uf.created_at as favorited_at,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        COALESCE(c.admin_avg_price, c.avg_price) as avg_price,
        CASE WHEN SUM(u.reputation_score) > 0
          THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
          ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
        END as avg_rating,
        COUNT(us.id) as my_tastings
      FROM user_favorites uf
      JOIN cigars c ON uf.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id AND us.user_id = $1
      LEFT JOIN users u ON us.user_id = u.id
      WHERE uf.user_id=$1
      GROUP BY uf.created_at, c.id, b.name
      ORDER BY avg_rating DESC NULLS LAST
    `, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur favoris' }); }
}

// ── Wishlist ──────────────────────────────────────────────────────────────────
async function getWishlist(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT uw.created_at as added_at,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        COALESCE(c.admin_avg_price, c.avg_price) as avg_price,
        co.name as country,
        CASE WHEN SUM(u.reputation_score) > 0
          THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
          ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
        END as avg_rating
      FROM user_wishlist uw
      JOIN cigars c ON uw.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      WHERE uw.user_id=$1
      GROUP BY uw.created_at, c.id, b.name, co.name
      ORDER BY uw.created_at DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur wishlist' }); }
}

async function removeFromWishlist(req, res) {
  try {
    await db.query('DELETE FROM user_wishlist WHERE user_id=$1 AND cigar_id=$2',
      [req.user.id, req.params.cigar_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur suppression wishlist' }); }
}

module.exports = {
  getProfile, updateAvatar,
  getCave, addToCave, removeFromCave, decrementCave, updateCaveItem,
  getCarnet, deleteScan,
  getFavorites,
  getWishlist, removeFromWishlist,
  getStats,
};

// ── Statistiques détaillées ───────────────────────────────────────────────────
async function getStats(req, res) {
  const userId = req.user.id;
  try {
    const [flavorsRes, countriesRes, monthlyRes, strengthRes, momentsRes] = await Promise.all([
      // Top saveurs — ORDER BY 2 pour éviter ambiguïté avec alias "count"
      db.query(`
        SELECT sf.flavor, COUNT(*)::int as count
        FROM scan_flavors sf
        JOIN user_scans us ON sf.scan_id = us.id
        WHERE us.user_id = $1
        GROUP BY sf.flavor
        ORDER BY 2 DESC LIMIT 8
      `, [userId]),
      // Pays dégustés
      db.query(`
        SELECT co.name as country, COUNT(*)::int as count
        FROM user_scans us
        JOIN cigars c ON us.cigar_id = c.id
        LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
        WHERE us.user_id = $1 AND co.name IS NOT NULL
        GROUP BY co.name
        ORDER BY 2 DESC
      `, [userId]),
      // Dégustations par mois (12 derniers mois)
      db.query(`
        SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*)::int as count
        FROM user_scans
        WHERE user_id = $1
          AND created_at > NOW() - INTERVAL '12 months'
        GROUP BY 1 ORDER BY 1
      `, [userId]),
      // Distribution des forces
      db.query(`
        SELECT COALESCE(c.admin_strength, c.strength)::int as strength, COUNT(*)::int as count
        FROM user_scans us
        JOIN cigars c ON us.cigar_id = c.id
        WHERE us.user_id = $1
          AND COALESCE(c.admin_strength, c.strength) IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `, [userId]),
      // Moments préférés
      db.query(`
        SELECT sm.moment, COUNT(*)::int as count
        FROM scan_moments sm
        JOIN user_scans us ON sm.scan_id = us.id
        WHERE us.user_id = $1
        GROUP BY sm.moment
        ORDER BY 2 DESC LIMIT 5
      `, [userId]),
    ]);

    res.json({
      top_flavors:    flavorsRes.rows,
      countries:      countriesRes.rows,
      monthly:        monthlyRes.rows,
      strength_dist:  strengthRes.rows,
      top_moments:    momentsRes.rows,
    });
  } catch (e) {
    console.error('getStats:', e);
    res.status(500).json({ error: 'Erreur statistiques' });
  }
}
