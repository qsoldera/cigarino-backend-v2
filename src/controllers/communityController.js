const db = require('../config/database');

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
  } catch (e) {
    res.status(500).json({ error: 'Erreur recherche utilisateurs' });
  }
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
      const f = await db.query('SELECT id FROM user_follows WHERE follower_id=$1 AND following_id=$2', [viewerId, user.id]);
      is_following = !!f.rows.length;
    }

    // Dernières dégustations publiques
    const { rows: scans } = await db.query(`
      SELECT us.id, us.rating, us.created_at, us.public_review,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url
      FROM user_scans us
      JOIN cigars c ON us.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      WHERE us.user_id=$1 AND us.public_review IS NOT NULL
      ORDER BY us.created_at DESC LIMIT 10
    `, [user.id]);

    res.json({ ...user, is_following, recent_scans: scans });
  } catch (e) {
    res.status(500).json({ error: 'Erreur profil public' });
  }
}

async function toggleFollow(req, res) {
  const followerId = req.user.id;
  const { user_id } = req.params;
  if (followerId === parseInt(user_id)) return res.status(400).json({ error: 'Impossible de se suivre soi-même' });
  try {
    const existing = await db.query('SELECT id FROM user_follows WHERE follower_id=$1 AND following_id=$2', [followerId, user_id]);
    if (existing.rows.length) {
      await db.query('DELETE FROM user_follows WHERE follower_id=$1 AND following_id=$2', [followerId, user_id]);
      res.json({ is_following: false });
    } else {
      await db.query('INSERT INTO user_follows (follower_id, following_id) VALUES ($1,$2)', [followerId, user_id]);
      res.json({ is_following: true });
    }
  } catch (e) {
    res.status(500).json({ error: 'Erreur follow' });
  }
}

async function getFeed(req, res) {
  const userId = req.user.id;
  try {
    const { rows } = await db.query(`
      SELECT 'tasting' as type, us.id, us.rating, us.created_at, us.public_review,
        u.username, u.avatar_url, u.reputation_score,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url
      FROM user_scans us
      JOIN users u ON us.user_id = u.id
      JOIN cigars c ON us.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      WHERE us.user_id IN (
        SELECT following_id FROM user_follows WHERE follower_id=$1
      )
      ORDER BY us.created_at DESC LIMIT 30
    `, [userId]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur feed' });
  }
}

// --- Classements ---
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
      HAVING COUNT(us.id) >= 2
      ORDER BY avg_rating DESC, rating_count DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur classement' });
  }
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
      ORDER BY scans_this_month DESC, u.reputation_score DESC
      LIMIT 10
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur classement évaluateurs' });
  }
}

async function leaderboardByTerroir(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT co.name as country, co.code,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        CASE WHEN SUM(u.reputation_score) > 0
          THEN ROUND(SUM(us.rating * u.reputation_score)::numeric / SUM(u.reputation_score), 2)
          ELSE COALESCE(ROUND(AVG(us.rating)::numeric, 2), 0)
        END as avg_rating
      FROM cigars c
      JOIN brands b ON c.brand_id = b.id
      JOIN countries co ON COALESCE(c.admin_country_id, c.country_id) = co.id
      LEFT JOIN user_scans us ON us.cigar_id = c.id
      LEFT JOIN users u ON us.user_id = u.id
      GROUP BY co.name, co.code, c.id, b.name
      HAVING COUNT(us.id) >= 1
      ORDER BY co.name, avg_rating DESC
    `);

    // Grouper par pays, garder le meilleur
    const byCountry = {};
    for (const row of rows) {
      if (!byCountry[row.country]) byCountry[row.country] = row;
    }
    res.json(Object.values(byCountry));
  } catch (e) {
    res.status(500).json({ error: 'Erreur classement terroir' });
  }
}

// --- Challenges ---
async function getChallenges(req, res) {
  try {
    const { rows } = await db.query(`
      SELECT ch.*, c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        COUNT(cp.id) as participants
      FROM challenges ch
      JOIN cigars c ON ch.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      LEFT JOIN challenge_participations cp ON cp.challenge_id = ch.id
      WHERE ch.ends_at > NOW()
      GROUP BY ch.id, c.id, b.name
      ORDER BY ch.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur challenges' });
  }
}

module.exports = {
  searchUsers, getPublicProfile, toggleFollow, getFeed,
  leaderboardTopCigars, leaderboardTopTasters, leaderboardByTerroir,
  getChallenges,
};
