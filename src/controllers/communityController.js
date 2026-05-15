const db = require('../config/database');

// ── Recherche utilisateurs ────────────────────────────────────────────────────
async function searchUsers(req, res) {
  const { q } = req.query;
  if (!q) return res.json([]);
  try {
    const { rows } = await db.query(`
      SELECT id, username, avatar_url, reputation_score,
        (SELECT COUNT(*) FROM user_scans WHERE user_id=u.id) as scan_count,
        (SELECT COUNT(*) FROM user_follows WHERE following_id=u.id) as followers_count
      FROM users u
      WHERE username ILIKE $1
      ORDER BY reputation_score DESC LIMIT 20
    `, [`%${q}%`]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur recherche' }); }
}

async function getPublicProfile(req, res) {
  const { username } = req.params;
  const viewerId = req.user?.id;
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.avatar_url, u.reputation_score, u.bio, u.created_at,
        (SELECT COUNT(*) FROM user_scans WHERE user_id=u.id) as scan_count,
        (SELECT COUNT(*) FROM user_follows WHERE following_id=u.id) as followers_count,
        (SELECT COUNT(*) FROM user_follows WHERE follower_id=u.id) as following_count,
        ROUND(AVG(us.rating)::numeric,2) as avg_rating
      FROM users u
      LEFT JOIN user_scans us ON us.user_id = u.id
      WHERE u.username=$1
      GROUP BY u.id
    `, [username]);
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = rows[0];
    let is_following = false;
    if (viewerId) {
      const f = await db.query(
        'SELECT id FROM user_follows WHERE follower_id=$1 AND following_id=$2',
        [viewerId, user.id]);
      is_following = !!f.rows.length;
    }
    const { rows: scans } = await db.query(`
      SELECT us.id, us.rating, us.created_at, us.public_review,
        us.scan_image_url,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(us.scan_image_url, c.admin_image_url, c.image_url) as image_url,
        array_agg(DISTINCT sf.flavor) FILTER (WHERE sf.flavor IS NOT NULL) as flavors
      FROM user_scans us
      JOIN cigars c ON us.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN scan_flavors sf ON sf.scan_id = us.id
      WHERE us.user_id=$1 AND us.public_review IS NOT NULL
      GROUP BY us.id, c.id, b.name
      ORDER BY us.created_at DESC LIMIT 20
    `, [user.id]);
    res.json({ ...user, is_following, recent_scans: scans });
  } catch (e) {
    console.error('getPublicProfile:', e);
    res.status(500).json({ error: 'Erreur profil public' });
  }
}

async function toggleFollow(req, res) {
  const followerId = req.user.id;
  const { user_id } = req.params;
  if (followerId === parseInt(user_id))
    return res.status(400).json({ error: 'Impossible de se suivre soi-même' });
  try {
    const existing = await db.query(
      'SELECT id FROM user_follows WHERE follower_id=$1 AND following_id=$2',
      [followerId, user_id]);
    if (existing.rows.length) {
      await db.query('DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2',
        [followerId, user_id]);
      res.json({ is_following: false });
    } else {
      await db.query('INSERT INTO user_follows (follower_id, following_id) VALUES ($1,$2)',
        [followerId, user_id]);
      res.json({ is_following: true });
    }
  } catch (e) { res.status(500).json({ error: 'Erreur follow' }); }
}

// ── Feed ─────────────────────────────────────────────────────────────────────
async function getFeed(req, res) {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(`
      SELECT
        us.id, us.rating, us.created_at, us.public_review,
        us.intensity, us.complexity, us.duration, us.pairing,
        us.scan_image_url,
        u.id as user_id, u.username, u.avatar_url, u.reputation_score,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(us.scan_image_url, c.admin_image_url, c.image_url) as image_url,
        COALESCE(c.admin_avg_price, c.avg_price) as avg_price,
        co.name as country,
        array_agg(DISTINCT sf.flavor) FILTER (WHERE sf.flavor IS NOT NULL) as flavors,
        array_agg(DISTINCT sm.moment) FILTER (WHERE sm.moment IS NOT NULL) as moments
      FROM user_scans us
      JOIN users u ON us.user_id = u.id
      JOIN cigars c ON us.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN scan_flavors sf ON sf.scan_id = us.id
      LEFT JOIN scan_moments sm ON sm.scan_id = us.id
      WHERE us.user_id IN (
        SELECT following_id FROM user_follows WHERE follower_id=$1
      )
      GROUP BY us.id, u.id, c.id, b.name, co.name
      ORDER BY us.created_at DESC LIMIT 50
    `, [userId]);
    res.json(rows);
  } catch (e) {
    console.error('getFeed:', e);
    res.status(500).json({ error: 'Erreur feed' });
  }
}

// ── Classements ───────────────────────────────────────────────────────────────
async function leaderboardTopCigars(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT c.id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        COALESCE(c.admin_avg_price, c.avg_price) as avg_price,
        CASE WHEN SUM(u.reputation_score) > 0
          THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
          ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
        END as avg_rating,
        COUNT(us.id) as rating_count
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
        AND us.created_at > NOW() - INTERVAL '30 days'
      LEFT JOIN users u ON us.user_id = u.id
      GROUP BY c.id, b.name
      HAVING COUNT(us.id) >= 1
      ORDER BY avg_rating DESC, rating_count DESC LIMIT 10
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur classement' }); }
}

async function leaderboardTopTasters(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.avatar_url, u.reputation_score,
        COUNT(us.id) as scans_this_month
      FROM users u
      JOIN user_scans us ON us.user_id = u.id
        AND us.created_at > NOW() - INTERVAL '30 days'
      GROUP BY u.id
      ORDER BY scans_this_month DESC, u.reputation_score DESC LIMIT 10
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur classement évaluateurs' }); }
}

// ── Groupes cigares ───────────────────────────────────────────────────────────
async function getMyGroups(req, res) {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(`
      SELECT g.*, u.username as creator_name,
        COUNT(gm2.id) as member_count,
        gm.role
      FROM cigar_groups g
      JOIN users u ON g.created_by = u.id
      JOIN cigar_group_members gm ON gm.group_id = g.id AND gm.user_id = $1
      LEFT JOIN cigar_group_members gm2 ON gm2.group_id = g.id
      GROUP BY g.id, u.username, gm.role
      ORDER BY g.created_at DESC
    `, [userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur groupes' }); }
}

async function createGroup(req, res) {
  const { name, description, is_geo, latitude, longitude, radius_km, member_ids } = req.body;
  const userId = req.user.id;
  if (!name) return res.status(400).json({ error: 'Nom du groupe requis' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO cigar_groups (name, description, created_by, is_geo, latitude, longitude, radius_km)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, description||null, userId, is_geo||false,
       latitude||null, longitude||null, radius_km||50]);
    const groupId = rows[0].id;

    // Ajouter le créateur comme admin
    await client.query(
      'INSERT INTO cigar_group_members (group_id, user_id, role) VALUES ($1,$2,$3)',
      [groupId, userId, 'admin']);

    // Ajouter les membres invités (abonnés)
    for (const memberId of (member_ids || [])) {
      if (memberId !== userId) {
        await client.query(
          'INSERT INTO cigar_group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [groupId, memberId]);
      }
    }
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('createGroup:', e);
    res.status(500).json({ error: 'Erreur création groupe' });
  } finally { client.release(); }
}

async function getGroupMembers(req, res) {
  const { group_id } = req.params;
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.avatar_url, u.reputation_score, gm.role, gm.joined_at
      FROM cigar_group_members gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
      ORDER BY gm.role DESC, gm.joined_at
    `, [group_id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur membres' }); }
}

async function joinGroup(req, res) {
  const { group_id } = req.params;
  const userId = req.user.id;
  try {
    await db.query(
      'INSERT INTO cigar_group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [group_id, userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur rejoindre groupe' }); }
}

async function leaveGroup(req, res) {
  const { group_id } = req.params;
  const userId = req.user.id;
  try {
    await db.query(
      'DELETE FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, userId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur quitter groupe' }); }
}

async function getNearbyGroups(req, res) {
  const { lat, lng, radius = 100 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat et lng requis' });
  try {
    // Calcul distance approximatif (Haversine simplifié)
    const { rows } = await db.query(`
      SELECT g.*, u.username as creator_name,
        COUNT(gm.id) as member_count,
        ROUND((
          6371 * acos(
            cos(radians($1)) * cos(radians(g.latitude)) *
            cos(radians(g.longitude) - radians($2)) +
            sin(radians($1)) * sin(radians(g.latitude))
          )
        )::numeric, 1) as distance_km
      FROM cigar_groups g
      JOIN users u ON g.created_by = u.id
      LEFT JOIN cigar_group_members gm ON gm.group_id = g.id
      WHERE g.is_geo = TRUE
        AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL
      GROUP BY g.id, u.username
      HAVING (
        6371 * acos(
          cos(radians($1)) * cos(radians(g.latitude)) *
          cos(radians(g.longitude) - radians($2)) +
          sin(radians($1)) * sin(radians(g.latitude))
        )
      ) <= $3
      ORDER BY distance_km ASC
      LIMIT 20
    `, [parseFloat(lat), parseFloat(lng), parseFloat(radius)]);
    res.json(rows);
  } catch (e) {
    console.error('getNearbyGroups:', e);
    res.status(500).json({ error: 'Erreur groupes à proximité' });
  }
}

async function getMyFollowees(req, res) {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(`
      SELECT u.id, u.username, u.avatar_url
      FROM user_follows f
      JOIN users u ON f.following_id = u.id
      WHERE f.follower_id = $1
      ORDER BY u.username
    `, [userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur abonnements' }); }
}

module.exports = {
  searchUsers, getPublicProfile, toggleFollow, getFeed,
  leaderboardTopCigars, leaderboardTopTasters,
  getMyGroups, createGroup, getGroupMembers, joinGroup, leaveGroup,
  getNearbyGroups, getMyFollowees,
};
