const db = require('../config/database');
const { notifyAdmins } = require('../utils/firebase');

async function getCigar(req, res) {
  const { id } = req.params;
  const userId = req.user?.id;

  try {
    // Fiche principale
    const { rows: cigarRows } = await db.query(`
      SELECT c.*,
        COALESCE(c.admin_image_url, c.image_url) as display_image,
        COALESCE(c.admin_country_id, c.country_id) as display_country_id,
        COALESCE(c.admin_strength, c.strength) as display_strength,
        COALESCE(c.admin_description, c.description) as display_description,
        COALESCE(c.admin_ring_gauge, c.ring_gauge) as display_ring_gauge,
        COALESCE(c.admin_length_mm, c.length_mm) as display_length_mm,
        COALESCE(c.admin_avg_price, c.avg_price) as display_avg_price,
        b.name as brand_name,
        co.name as country_name, co.code as country_code,
        CASE WHEN SUM(u.reputation_score) > 0
          THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
          ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
        END as avg_rating,
        COUNT(us.id) as rating_count
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      WHERE c.id = $1
      GROUP BY c.id, b.name, co.name, co.code
    `, [id]);

    if (!cigarRows.length) return res.status(404).json({ error: 'Cigare introuvable' });
    const cigar = cigarRows[0];

    // Distribution des notes
    const { rows: distRows } = await db.query(`
      SELECT rating, COUNT(*) as count
      FROM user_scans WHERE cigar_id = $1 AND rating IS NOT NULL
      GROUP BY rating ORDER BY rating
    `, [id]);

    // Top 4 saveurs (pondérées)
    const { rows: flavorsRows } = await db.query(`
      SELECT flavor, SUM(u.reputation_score) as weight
      FROM scan_flavors sf
      JOIN user_scans us ON sf.scan_id = us.id
      JOIN users u ON us.user_id = u.id
      WHERE us.cigar_id = $1
      GROUP BY flavor ORDER BY weight DESC LIMIT 4
    `, [id]);

    // Top 4 accords
    const { rows: pairingsRows } = await db.query(`
      SELECT pairing, SUM(u.reputation_score) as weight
      FROM user_scans us
      JOIN users u ON us.user_id = u.id
      WHERE us.cigar_id = $1 AND pairing IS NOT NULL
      GROUP BY pairing ORDER BY weight DESC LIMIT 4
    `, [id]);

    // Top 4 moments
    const { rows: momentsRows } = await db.query(`
      SELECT moment, SUM(u.reputation_score) as weight
      FROM scan_moments sm
      JOIN user_scans us ON sm.scan_id = us.id
      JOIN users u ON us.user_id = u.id
      WHERE us.cigar_id = $1
      GROUP BY moment ORDER BY weight DESC LIMIT 4
    `, [id]);

    // Top 5 avis publics
    const { rows: reviewsRows } = await db.query(`
      SELECT us.id, us.rating, us.public_review, us.created_at,
        u.username, u.reputation_score, u.avatar_url
      FROM user_scans us
      JOIN users u ON us.user_id = u.id
      WHERE us.cigar_id = $1 AND us.public_review IS NOT NULL AND us.public_review != ''
      ORDER BY u.reputation_score DESC, us.created_at DESC
      LIMIT 5
    `, [id]);

    // Données personnelles
    let personalData = { is_favorite: false, is_wishlist: false, my_scans: [] };
    if (userId) {
      const [favRes, wishRes, myScansRes] = await Promise.all([
        db.query('SELECT id FROM user_favorites WHERE user_id=$1 AND cigar_id=$2', [userId, id]),
        db.query('SELECT id FROM user_wishlist WHERE user_id=$1 AND cigar_id=$2', [userId, id]),
        db.query(`
          SELECT us.id, us.rating, us.created_at, us.public_review
          FROM user_scans us WHERE us.user_id=$1 AND us.cigar_id=$2
          ORDER BY us.created_at DESC
        `, [userId, id]),
      ]);
      personalData = {
        is_favorite: !!favRes.rows.length,
        is_wishlist: !!wishRes.rows.length,
        my_scans: myScansRes.rows,
      };
    }

    res.json({
      ...cigar,
      rating_distribution: distRows,
      top_flavors: flavorsRows,
      top_pairings: pairingsRows,
      top_moments: momentsRows,
      top_reviews: reviewsRows,
      ...personalData,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur fiche cigare' });
  }
}

async function toggleFavorite(req, res) {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await db.query(
      'SELECT id FROM user_favorites WHERE user_id=$1 AND cigar_id=$2',
      [userId, id]
    );
    if (existing.rows.length) {
      await db.query('DELETE FROM user_favorites WHERE user_id=$1 AND cigar_id=$2', [userId, id]);
      res.json({ is_favorite: false });
    } else {
      await db.query('INSERT INTO user_favorites (user_id, cigar_id) VALUES ($1,$2)', [userId, id]);
      res.json({ is_favorite: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Erreur favori' });
  }
}

async function toggleWishlist(req, res) {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await db.query(
      'SELECT id FROM user_wishlist WHERE user_id=$1 AND cigar_id=$2',
      [userId, id]
    );
    if (existing.rows.length) {
      await db.query('DELETE FROM user_wishlist WHERE user_id=$1 AND cigar_id=$2', [userId, id]);
      res.json({ is_wishlist: false });
    } else {
      await db.query('INSERT INTO user_wishlist (user_id, cigar_id) VALUES ($1,$2)', [userId, id]);
      res.json({ is_wishlist: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Erreur wishlist' });
  }
}

async function reportCigar(req, res) {
  const { id } = req.params;
  const { reason, detail } = req.body;
  const userId = req.user.id;
  const VALID_REASONS = ['doublon', 'erreur_identification', 'mauvaise_photo', 'infos_incorrectes', 'cigare_inexistant', 'autre'];
  if (!VALID_REASONS.includes(reason))
    return res.status(400).json({ error: 'Motif invalide' });

  try {
    await db.query(
      `INSERT INTO reports (cigar_id, reported_by, reason, detail, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [id, userId, reason, detail || null]
    );
    const cigarRow = await db.query('SELECT c.name, b.name as brand FROM cigars c JOIN brands b ON c.brand_id=b.id WHERE c.id=$1', [id]);
    const cigar = cigarRow.rows[0];
    await notifyAdmins(db, '🚨 Nouveau signalement', `${cigar?.brand} ${cigar?.name} — ${reason}`);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur signalement' });
  }
}

async function submitScan(req, res) {
  const { cigar_id, rating, intensity, complexity, draw, duration,
    raw_flavors, mouth_flavors, nose_flavors, finish_note, ash_color,
    smoke_consistency, pairing, moments, price_paid, private_notes, public_review } = req.body;
  const userId = req.user.id;

  if (!cigar_id || !rating) return res.status(400).json({ error: 'cigar_id et rating requis' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO user_scans (user_id, cigar_id, rating, intensity, complexity, draw,
        duration, finish_note, ash_color, smoke_consistency, pairing, price_paid,
        private_notes, public_review)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [userId, cigar_id, rating, intensity || null, complexity || null, draw || null,
        duration || null, finish_note || null, ash_color || null,
        smoke_consistency || null, pairing || null, price_paid || null,
        private_notes || null, public_review || null]
    );
    const scanId = rows[0].id;

    // Saveurs (catégorisées)
    const allFlavors = [
      ...(raw_flavors || []).map(f => ({ scan_id: scanId, flavor: f, category: 'raw' })),
      ...(mouth_flavors || []).map(f => ({ scan_id: scanId, flavor: f, category: 'mouth' })),
      ...(nose_flavors || []).map(f => ({ scan_id: scanId, flavor: f, category: 'nose' })),
    ];
    for (const { scan_id, flavor, category } of allFlavors) {
      await client.query(
        'INSERT INTO scan_flavors (scan_id, flavor, category) VALUES ($1,$2,$3)',
        [scan_id, flavor, category]
      );
    }

    // Moments
    for (const moment of (moments || [])) {
      await client.query(
        'INSERT INTO scan_moments (scan_id, moment) VALUES ($1,$2)',
        [scanId, moment]
      );
    }

    // Incrémenter scan_count
    await client.query('UPDATE cigars SET scan_count = scan_count + 1 WHERE id=$1', [cigar_id]);

    // Retirer de la wishlist si présent
    await client.query('DELETE FROM user_wishlist WHERE user_id=$1 AND cigar_id=$2', [userId, cigar_id]);

    // Règle de convergence des saveurs (réputation)
    const countRes = await client.query('SELECT COUNT(*) FROM user_scans WHERE cigar_id=$1', [cigar_id]);
    if (parseInt(countRes.rows[0].count) >= 3) {
      const communityFlavors = await client.query(`
        SELECT sf.flavor FROM scan_flavors sf
        JOIN user_scans us ON sf.scan_id = us.id
        WHERE us.cigar_id=$1 AND us.id != $2
        GROUP BY sf.flavor
        ORDER BY COUNT(*) DESC LIMIT 10
      `, [cigar_id, scanId]);
      const communitySet = new Set(communityFlavors.rows.map(r => r.flavor));
      const userFlavors = [...new Set([...(raw_flavors || []), ...(mouth_flavors || []), ...(nose_flavors || [])])];
      const matches = userFlavors.filter(f => communitySet.has(f)).length;
      if (matches > 0) {
        const delta = Math.min(matches * 0.005, 1.0);
        await client.query(
          'UPDATE users SET reputation_score = LEAST(1.0, reputation_score + $1) WHERE id=$2 AND is_admin=FALSE',
          [delta, userId]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ scan_id: scanId, success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Erreur enregistrement dégustation' });
  } finally {
    client.release();
  }
}


// ── Modifier une dégustation existante ───────────────────────────────────────
async function updateScan(req, res) {
  const { scan_id } = req.params;
  const userId = req.user.id;
  const {
    rating, intensity, complexity, draw, duration,
    raw_flavors, mouth_flavors, nose_flavors, finish_note, ash_color,
    smoke_consistency, pairing, moments, price_paid, private_notes, public_review,
  } = req.body;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Vérifier que le scan appartient bien à l'utilisateur
    const check = await client.query(
      'SELECT id FROM user_scans WHERE id=$1 AND user_id=$2', [scan_id, userId]);
    if (!check.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Dégustation introuvable' });
    }

    // Mise à jour des champs scalaires
    await client.query(
      `UPDATE user_scans SET
        rating=$1, intensity=$2, complexity=$3, draw=$4, duration=$5,
        finish_note=$6, ash_color=$7, smoke_consistency=$8, pairing=$9,
        price_paid=$10, private_notes=$11, public_review=$12
       WHERE id=$13`,
      [rating, intensity||null, complexity||null, draw||null, duration||null,
       finish_note||null, ash_color||null, smoke_consistency||null, pairing||null,
       price_paid||null, private_notes||null, public_review||null, scan_id]
    );

    // Reconstruire les saveurs
    await client.query('DELETE FROM scan_flavors WHERE scan_id=$1', [scan_id]);
    const allFlavors = [
      ...(raw_flavors||[]).map(f => ({ flavor: f, category: 'raw' })),
      ...(mouth_flavors||[]).map(f => ({ flavor: f, category: 'mouth' })),
      ...(nose_flavors||[]).map(f => ({ flavor: f, category: 'nose' })),
    ];
    for (const { flavor, category } of allFlavors) {
      await client.query(
        'INSERT INTO scan_flavors (scan_id, flavor, category) VALUES ($1,$2,$3)',
        [scan_id, flavor, category]);
    }

    // Reconstruire les moments
    await client.query('DELETE FROM scan_moments WHERE scan_id=$1', [scan_id]);
    for (const moment of (moments||[])) {
      await client.query('INSERT INTO scan_moments (scan_id, moment) VALUES ($1,$2)',
        [scan_id, moment]);
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('updateScan error:', e);
    res.status(500).json({ error: 'Erreur mise à jour dégustation' });
  } finally {
    client.release();
  }
}

// ── Ajouter/remplacer photo (utilisateur) ─────────────────────────────────────
async function addUserPhoto(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });
  const { id } = req.params;
  const isAdmin = req.user.is_admin;
  try {
    if (isAdmin) {
      await db.query(
        'UPDATE cigars SET admin_image_url=$1, admin_verified=TRUE WHERE id=$2',
        [req.file.path, id]);
    } else {
      // Utilisateur : ne complète que si aucune image admin n'existe
      await db.query(
        'UPDATE cigars SET image_url=$1 WHERE id=$2 AND admin_image_url IS NULL',
        [req.file.path, id]);
    }
    res.json({ image_url: req.file.path, success: true });
  } catch (e) {
    console.error('addUserPhoto error:', e);
    res.status(500).json({ error: 'Erreur upload photo' });
  }
}

module.exports = { getCigar, toggleFavorite, toggleWishlist, reportCigar, submitScan, updateScan, addUserPhoto };
