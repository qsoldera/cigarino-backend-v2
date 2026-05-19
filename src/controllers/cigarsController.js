const db = require('../config/database');
const { sendToUser, notifyAdmins } = require('../utils/firebase');

// Moments valides — doit correspondre à AppConstants.moments côté Flutter
const VALID_MOMENTS = ['Après-repas', 'Apéritif', 'Célébration', 'Détente', 'Travail', 'Plein air'];

// ── Fiche cigare ──────────────────────────────────────────────────────────────
async function getCigar(req, res) {
  const { id } = req.params;
  const userId = req.user?.id;
  try {
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

    const { rows: distRows } = await db.query(
      'SELECT rating, COUNT(*) as count FROM user_scans WHERE cigar_id=$1 AND rating IS NOT NULL GROUP BY rating ORDER BY rating',
      [id]);
    const { rows: flavorsRows } = await db.query(
      'SELECT flavor, SUM(u.reputation_score) as weight FROM scan_flavors sf JOIN user_scans us ON sf.scan_id=us.id JOIN users u ON us.user_id=u.id WHERE us.cigar_id=$1 GROUP BY flavor ORDER BY weight DESC LIMIT 4',
      [id]);
    const { rows: pairingsRows } = await db.query(
      'SELECT pairing, SUM(u.reputation_score) as weight FROM user_scans us JOIN users u ON us.user_id=u.id WHERE us.cigar_id=$1 AND pairing IS NOT NULL GROUP BY pairing ORDER BY weight DESC LIMIT 4',
      [id]);

    // FIX v2.0.2 : filtre sur les moments valides pour éviter l'affichage de
    // caractères parasites ('i', 'P', 'a', 'e'…) issus d'anciennes insertions incorrectes
    const { rows: momentsRows } = await db.query(
      `SELECT moment, SUM(u.reputation_score) as weight
       FROM scan_moments sm
       JOIN user_scans us ON sm.scan_id = us.id
       JOIN users u ON us.user_id = u.id
       WHERE us.cigar_id = $1
         AND sm.moment = ANY($2::text[])
       GROUP BY moment
       ORDER BY weight DESC LIMIT 4`,
      [id, VALID_MOMENTS]);

    const { rows: reviewsRows } = await db.query(`
      SELECT us.id, us.rating, us.public_review, us.created_at,
        u.username, u.reputation_score, u.avatar_url,
        (SELECT COUNT(*) FROM scan_likes sl WHERE sl.scan_id=us.id AND sl.is_like=TRUE) as like_count,
        CASE WHEN $2::int IS NOT NULL THEN
          (SELECT is_like FROM scan_likes WHERE scan_id=us.id AND user_id=$2)
        END as my_reaction
      FROM user_scans us
      JOIN users u ON us.user_id = u.id
      WHERE us.cigar_id=$1
        AND us.public_review IS NOT NULL AND us.public_review != ''
        AND ($2::int IS NULL OR us.user_id != $2)
      ORDER BY like_count DESC, u.reputation_score DESC, us.created_at DESC
      LIMIT 10
    `, [id, userId || null]);

    let personalData = { is_favorite: false, is_wishlist: false, my_scans: [] };
    if (userId) {
      const [favRes, wishRes, myScansRes] = await Promise.all([
        db.query('SELECT id FROM user_favorites WHERE user_id=$1 AND cigar_id=$2', [userId, id]),
        db.query('SELECT id FROM user_wishlist WHERE user_id=$1 AND cigar_id=$2', [userId, id]),
        db.query(`
          SELECT us.id, us.rating, us.created_at, us.public_review,
            us.intensity, us.complexity, us.draw, us.duration, us.pairing,
            us.ash_color, us.smoke_consistency, us.finish_note,
            us.scan_image_url, us.price_paid,
            array_agg(DISTINCT sf.flavor) FILTER (WHERE sf.flavor IS NOT NULL AND sf.category='raw') as raw_flavors,
            array_agg(DISTINCT sf.flavor) FILTER (WHERE sf.flavor IS NOT NULL AND sf.category='mouth') as mouth_flavors,
            array_agg(DISTINCT sf.flavor) FILTER (WHERE sf.flavor IS NOT NULL AND sf.category='nose') as nose_flavors,
            array_agg(DISTINCT sm.moment) FILTER (WHERE sm.moment IS NOT NULL AND sm.moment = ANY($3::text[])) as moments
          FROM user_scans us
          LEFT JOIN scan_flavors sf ON sf.scan_id = us.id
          LEFT JOIN scan_moments sm ON sm.scan_id = us.id
          WHERE us.user_id=$1 AND us.cigar_id=$2
          GROUP BY us.id
          ORDER BY us.created_at DESC
        `, [userId, id, VALID_MOMENTS]),
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
    console.error('getCigar:', e);
    res.status(500).json({ error: 'Erreur fiche cigare' });
  }
}

async function toggleFavorite(req, res) {
  const { id } = req.params;
  try {
    const existing = await db.query('SELECT id FROM user_favorites WHERE user_id=$1 AND cigar_id=$2', [req.user.id, id]);
    if (existing.rows.length) {
      await db.query('DELETE FROM user_favorites WHERE user_id=$1 AND cigar_id=$2', [req.user.id, id]);
      res.json({ is_favorite: false });
    } else {
      await db.query('INSERT INTO user_favorites (user_id, cigar_id) VALUES ($1,$2)', [req.user.id, id]);
      res.json({ is_favorite: true });
    }
  } catch (e) { res.status(500).json({ error: 'Erreur favoris' }); }
}

async function toggleWishlist(req, res) {
  const { id } = req.params;
  try {
    const existing = await db.query('SELECT id FROM user_wishlist WHERE user_id=$1 AND cigar_id=$2', [req.user.id, id]);
    if (existing.rows.length) {
      await db.query('DELETE FROM user_wishlist WHERE user_id=$1 AND cigar_id=$2', [req.user.id, id]);
      res.json({ is_wishlist: false });
    } else {
      await db.query('INSERT INTO user_wishlist (user_id, cigar_id) VALUES ($1,$2)', [req.user.id, id]);
      res.json({ is_wishlist: true });
    }
  } catch (e) { res.status(500).json({ error: 'Erreur wishlist' }); }
}

async function reportCigar(req, res) {
  const { id } = req.params;
  const { reason, detail } = req.body;
  if (!reason) return res.status(400).json({ error: 'Motif requis' });
  try {
    const existing = await db.query(
      "SELECT id FROM reports WHERE cigar_id=$1 AND reported_by=$2 AND status='pending'",
      [id, req.user.id]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'Vous avez déjà signalé ce cigare' });

    await db.query(
      'INSERT INTO reports (cigar_id, reported_by, reason, detail) VALUES ($1,$2,$3,$4)',
      [id, req.user.id, reason, detail || null]);

    await notifyAdmins(db, '🚩 Nouveau signalement', `${req.user.username} a signalé un cigare`);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur signalement' }); }
}

async function submitScan(req, res) {
  const {
    cigar_id, rating, intensity, complexity, draw,
    duration, raw_flavors, mouth_flavors, nose_flavors,
    finish_note, ash_color, smoke_consistency, pairing, moments,
    private_notes, public_review,
  } = req.body;

  if (!cigar_id) return res.status(400).json({ error: 'cigar_id requis' });

  // FIX v2.0.2 : validation stricte du rating côté backend
  const ratingNum = Number(rating);
  if (!rating || isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return res.status(400).json({ error: 'La note est requise et doit être comprise entre 1 et 5' });
  }

  const imageUrl = req.file?.path || null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO user_scans
        (user_id, cigar_id, rating, intensity, complexity, draw,
         duration, finish_note, ash_color, smoke_consistency,
         pairing, private_notes, public_review, scan_image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [req.user.id, cigar_id, ratingNum,
       intensity || null, complexity || null, draw || null,
       duration || null, finish_note || null, ash_color || null, smoke_consistency || null,
       pairing || null, private_notes || null, public_review || null, imageUrl]);

    const scanId = rows[0].id;

    const allFlavors = [
      ...((raw_flavors || []).map(f => [scanId, f, 'raw'])),
      ...((mouth_flavors || []).map(f => [scanId, f, 'mouth'])),
      ...((nose_flavors || []).map(f => [scanId, f, 'nose'])),
    ];
    for (const [sid, flavor, cat] of allFlavors) {
      await client.query(
        'INSERT INTO scan_flavors (scan_id, flavor, category) VALUES ($1,$2,$3)',
        [sid, flavor, cat]);
    }

    // FIX v2.0.2 : n'insère que les moments valides pour éviter les caractères parasites
    for (const moment of (moments || [])) {
      if (VALID_MOMENTS.includes(moment)) {
        await client.query('INSERT INTO scan_moments (scan_id, moment) VALUES ($1,$2)', [scanId, moment]);
      }
    }

    await client.query(
      'UPDATE cigars SET scan_count = scan_count + 1 WHERE id=$1', [cigar_id]);

    // Réputation : convergence de saveurs
    const allFlavNames = [...(raw_flavors||[]), ...(mouth_flavors||[]), ...(nose_flavors||[])];
    if (allFlavNames.length > 0 && public_review) {
      const { rows: communityFlavs } = await client.query(
        'SELECT flavor FROM scan_flavors sf JOIN user_scans us ON sf.scan_id=us.id WHERE us.cigar_id=$1',
        [cigar_id]);
      const communitySet = new Set(communityFlavs.map(r => r.flavor));
      const matches = allFlavNames.filter(f => communitySet.has(f)).length;
      if (matches > 0) {
        await client.query(
          'UPDATE users SET reputation_score = LEAST(1.0, reputation_score + $1) WHERE id=$2',
          [matches * 0.005, req.user.id]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ scan_id: scanId, success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('submitScan:', e);
    res.status(500).json({ error: 'Erreur enregistrement dégustation' });
  } finally { client.release(); }
}

async function updateScan(req, res) {
  const { scan_id } = req.params;
  const {
    rating, intensity, complexity, draw,
    duration, raw_flavors, mouth_flavors, nose_flavors,
    finish_note, ash_color, smoke_consistency, pairing, moments,
    private_notes, public_review,
  } = req.body;

  // FIX v2.0.2 : validation rating dans updateScan également
  if (rating !== undefined) {
    const ratingNum = Number(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'La note doit être comprise entre 1 et 5' });
    }
  }

  const imageUrl = req.file?.path || null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const sets = [], params = [];
    let idx = 1;
    const addField = (col, val) => { if (val !== undefined) { sets.push(`${col}=$${idx++}`); params.push(val ?? null); }};

    addField('rating',           rating !== undefined ? Number(rating) : undefined);
    addField('intensity',        intensity);
    addField('complexity',       complexity);
    addField('draw',             draw);
    addField('duration',         duration);
    addField('finish_note',      finish_note);
    addField('ash_color',        ash_color);
    addField('smoke_consistency',smoke_consistency);
    addField('pairing',          pairing);
    addField('private_notes',    private_notes);
    addField('public_review',    public_review);
    if (imageUrl) { sets.push(`scan_image_url=$${idx++}`); params.push(imageUrl); }

    if (sets.length) {
      params.push(req.user.id, scan_id);
      const { rowCount } = await client.query(
        `UPDATE user_scans SET ${sets.join(',')} WHERE user_id=$${idx} AND id=$${idx+1}`,
        params);
      if (rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Scan introuvable' });
      }
    }

    if (raw_flavors !== undefined || mouth_flavors !== undefined || nose_flavors !== undefined) {
      await client.query('DELETE FROM scan_flavors WHERE scan_id=$1', [scan_id]);
      const allFlavors = [
        ...((raw_flavors||[]).map(f => [scan_id, f, 'raw'])),
        ...((mouth_flavors||[]).map(f => [scan_id, f, 'mouth'])),
        ...((nose_flavors||[]).map(f => [scan_id, f, 'nose'])),
      ];
      for (const [sid, flavor, cat] of allFlavors) {
        await client.query('INSERT INTO scan_flavors (scan_id, flavor, category) VALUES ($1,$2,$3)', [sid, flavor, cat]);
      }
    }

    if (moments !== undefined) {
      await client.query('DELETE FROM scan_moments WHERE scan_id=$1', [scan_id]);
      // FIX v2.0.2 : validation moments dans updateScan
      for (const moment of moments) {
        if (VALID_MOMENTS.includes(moment)) {
          await client.query('INSERT INTO scan_moments (scan_id, moment) VALUES ($1,$2)', [scan_id, moment]);
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('updateScan:', e);
    res.status(500).json({ error: 'Erreur mise à jour scan' });
  } finally { client.release(); }
}

async function addUserPhoto(req, res) {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });
  try {
    await db.query('UPDATE cigars SET image_url=$1 WHERE id=$2', [req.file.path, id]);
    res.json({ image_url: req.file.path });
  } catch (e) { res.status(500).json({ error: 'Erreur photo' }); }
}

async function addScanPhoto(req, res) {
  const { scan_id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'Photo requise' });
  try {
    const { rowCount } = await db.query(
      'UPDATE user_scans SET scan_image_url=$1 WHERE id=$2 AND user_id=$3',
      [req.file.path, scan_id, req.user.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Scan introuvable' });
    res.json({ scan_image_url: req.file.path });
  } catch (e) { res.status(500).json({ error: 'Erreur photo scan' }); }
}

async function toggleScanLike(req, res) {
  const { scan_id } = req.params;
  const { is_like } = req.body;
  if (is_like === undefined) return res.status(400).json({ error: 'is_like requis' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      'SELECT is_like FROM scan_likes WHERE scan_id=$1 AND user_id=$2',
      [scan_id, req.user.id]);

    const scan = await client.query(
      'SELECT user_id FROM user_scans WHERE id=$1', [scan_id]);
    if (!scan.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Scan introuvable' });
    }
    const scanOwnerId = scan.rows[0].user_id;

    let delta = 0;
    if (existing.rows.length) {
      const oldLike = existing.rows[0].is_like;
      if (oldLike === is_like) {
        await client.query('DELETE FROM scan_likes WHERE scan_id=$1 AND user_id=$2', [scan_id, req.user.id]);
        delta = is_like ? -0.01 : 0.005;
      } else {
        await client.query('UPDATE scan_likes SET is_like=$1 WHERE scan_id=$2 AND user_id=$3', [is_like, scan_id, req.user.id]);
        delta = is_like ? 0.015 : -0.015;
      }
    } else {
      await client.query('INSERT INTO scan_likes (scan_id, user_id, is_like) VALUES ($1,$2,$3)', [scan_id, req.user.id, is_like]);
      delta = is_like ? 0.01 : -0.005;
      if (is_like && scanOwnerId !== req.user.id) {
        await sendToUser(db, scanOwnerId, '👍 Nouveau j\'aime', `${req.user.username} a aimé votre dégustation`);
      }
    }

    if (delta !== 0 && scanOwnerId !== req.user.id) {
      await client.query(
        'UPDATE users SET reputation_score = LEAST(1.0, GREATEST(0.0, reputation_score + $1)) WHERE id=$2 AND is_admin=FALSE',
        [delta, scanOwnerId]);
    }

    const { rows: countRows } = await client.query(
      'SELECT COUNT(*) FROM scan_likes WHERE scan_id=$1 AND is_like=TRUE', [scan_id]);

    await client.query('COMMIT');
    res.json({ likes: parseInt(countRows[0].count) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('toggleScanLike:', e);
    res.status(500).json({ error: 'Erreur like' });
  } finally { client.release(); }
}

module.exports = {
  getCigar, toggleFavorite, toggleWishlist, reportCigar,
  submitScan, updateScan, addUserPhoto, addScanPhoto, toggleScanLike,
};
