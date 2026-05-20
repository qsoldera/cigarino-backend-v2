const { sendToUser, notifyAdmins } = require('../utils/firebase');
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
    // FIX v2.0.5 : filtre is_public au lieu de public_review IS NOT NULL
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
      WHERE us.user_id=$1
        AND (us.is_public = TRUE OR us.public_review IS NOT NULL)
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
      const actor = await db.query('SELECT username FROM users WHERE id=$1', [followerId]);
      await sendToUser(db, parseInt(user_id),
        '👤 Nouvel abonné',
        `${actor.rows[0]?.username || 'Un membre'} s'est abonné à votre profil`);
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
      AND (us.is_public = TRUE OR us.public_review IS NOT NULL)
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

    await client.query(
      'INSERT INTO cigar_group_members (group_id, user_id, role) VALUES ($1,$2,$3)',
      [groupId, userId, 'admin']);

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

// FIX v2.0.4 : protection dernier admin
async function leaveGroup(req, res) {
  const { group_id } = req.params;
  const userId = req.user.id;
  try {
    const member = await db.query(
      'SELECT role FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, userId]);
    if (!member.rows.length)
      return res.status(404).json({ error: "Vous n'êtes pas membre de ce groupe" });

    if (member.rows[0].role === 'admin') {
      const { rows: admins } = await db.query(
        "SELECT id FROM cigar_group_members WHERE group_id=$1 AND role='admin'",
        [group_id]);
      if (admins.length <= 1) {
        const { rows: others } = await db.query(
          'SELECT id FROM cigar_group_members WHERE group_id=$1 AND user_id!=$2',
          [group_id, userId]);
        if (others.length > 0) {
          return res.status(400).json({
            error: 'Vous êtes le seul admin. Transférez le rôle admin à un autre membre avant de quitter, ou supprimez le groupe.',
          });
        }
        await db.query('DELETE FROM cigar_groups WHERE id=$1', [group_id]);
        return res.json({ success: true, group_deleted: true });
      }
    }

    await db.query(
      'DELETE FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, userId]);
    res.json({ success: true });
  } catch (e) {
    console.error('leaveGroup:', e);
    res.status(500).json({ error: 'Erreur quitter groupe' });
  }
}

// FIX v2.0.4 : inviter un membre (admin uniquement)
async function inviteMember(req, res) {
  const { group_id } = req.params;
  const { user_id }  = req.body;
  const requesterId  = req.user.id;
  if (!user_id) return res.status(400).json({ error: 'user_id requis' });
  try {
    const requester = await db.query(
      "SELECT role FROM cigar_group_members WHERE group_id=$1 AND user_id=$2",
      [group_id, requesterId]);
    if (!requester.rows.length || requester.rows[0].role !== 'admin')
      return res.status(403).json({ error: 'Réservé aux admins du groupe' });

    const target = await db.query('SELECT id, username FROM users WHERE id=$1', [user_id]);
    if (!target.rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const result = await db.query(
      `INSERT INTO cigar_group_members (group_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (group_id, user_id) DO NOTHING RETURNING id`,
      [group_id, user_id]);
    if (result.rowCount === 0)
      return res.status(409).json({ error: 'Cet utilisateur est déjà membre du groupe' });

    const group = await db.query('SELECT name FROM cigar_groups WHERE id=$1', [group_id]);
    await sendToUser(db, user_id, '👥 Invitation à un club',
      `${req.user.username} vous a invité à rejoindre "${group.rows[0]?.name}"`);
    res.status(201).json({ success: true, message: `${target.rows[0].username} a été ajouté au groupe` });
  } catch (e) {
    console.error('inviteMember:', e);
    res.status(500).json({ error: "Erreur lors de l'invitation" });
  }
}

// FIX v2.0.4 : expulser un membre
async function removeMember(req, res) {
  const { group_id, user_id } = req.params;
  const requesterId = req.user.id;
  try {
    const requester = await db.query(
      "SELECT role FROM cigar_group_members WHERE group_id=$1 AND user_id=$2",
      [group_id, requesterId]);
    if (!requester.rows.length || requester.rows[0].role === 'member')
      return res.status(403).json({ error: 'Réservé aux admins et modérateurs' });

    const target = await db.query(
      'SELECT role FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, user_id]);
    if (!target.rows.length)
      return res.status(404).json({ error: 'Membre introuvable' });

    if (requester.rows[0].role === 'moderator' && target.rows[0].role === 'admin')
      return res.status(403).json({ error: 'Un modérateur ne peut pas expulser un admin' });

    if (parseInt(user_id) === requesterId)
      return res.status(400).json({ error: 'Utilisez "Quitter le groupe" pour vous retirer' });

    await db.query(
      'DELETE FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, user_id]);
    res.json({ success: true });
  } catch (e) {
    console.error('removeMember:', e);
    res.status(500).json({ error: 'Erreur expulsion' });
  }
}

async function getNearbyGroups(req, res) {
  const { lat, lng, radius = 100 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat et lng requis' });
  try {
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
      WHERE g.is_geo = TRUE AND g.latitude IS NOT NULL AND g.longitude IS NOT NULL
      GROUP BY g.id, u.username
      HAVING (6371 * acos(
        cos(radians($1)) * cos(radians(g.latitude)) *
        cos(radians(g.longitude) - radians($2)) +
        sin(radians($1)) * sin(radians(g.latitude))
      )) <= $3
      ORDER BY distance_km ASC LIMIT 20
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

// ── Posts de groupe ───────────────────────────────────────────────────────────
async function getGroupPosts(req, res) {
  const { group_id } = req.params;
  const userId = req.user.id;
  try {
    const member = await db.query(
      'SELECT id FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, userId]);
    if (!member.rows.length) return res.status(403).json({ error: 'Non membre du groupe' });

    const { rows } = await db.query(`
      SELECT gp.id, gp.content, gp.image_url, gp.created_at,
        u.username, u.avatar_url, u.id as user_id,
        us.id as scan_id, us.rating, us.public_review,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(us.scan_image_url, c.admin_image_url, c.image_url) as cigar_image
      FROM group_posts gp
      JOIN users u ON gp.user_id = u.id
      LEFT JOIN user_scans us ON gp.scan_id = us.id
      LEFT JOIN cigars c ON us.cigar_id = c.id
      LEFT JOIN brands b ON c.brand_id = b.id
      WHERE gp.group_id = $1
      ORDER BY gp.created_at DESC LIMIT 50
    `, [group_id]);
    res.json(rows);
  } catch (e) {
    console.error('getGroupPosts:', e);
    res.status(500).json({ error: 'Erreur posts' });
  }
}

async function createGroupPost(req, res) {
  const { group_id } = req.params;
  const { content, scan_id } = req.body;
  const userId = req.user.id;
  const imageUrl = req.file?.path || null;
  if (!content && !imageUrl && !scan_id)
    return res.status(400).json({ error: 'Contenu, image ou évaluation requis' });
  try {
    const member = await db.query(
      'SELECT id FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, userId]);
    if (!member.rows.length) return res.status(403).json({ error: 'Non membre du groupe' });
    const { rows } = await db.query(
      'INSERT INTO group_posts (group_id, user_id, content, image_url, scan_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [group_id, userId, content||null, imageUrl, scan_id||null]);
    res.status(201).json({ post_id: rows[0].id });
  } catch (e) {
    console.error('createGroupPost:', e);
    res.status(500).json({ error: 'Erreur création post' });
  }
}

// ── Messages de groupe ────────────────────────────────────────────────────────
async function getGroupMessages(req, res) {
  const { group_id } = req.params;
  const userId = req.user.id;
  try {
    const member = await db.query(
      'SELECT id FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, userId]);
    if (!member.rows.length) return res.status(403).json({ error: 'Non membre' });
    const { rows } = await db.query(`
      SELECT gm.id, gm.content, gm.created_at, u.id as user_id, u.username, u.avatar_url
      FROM group_messages gm
      JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = $1
      ORDER BY gm.created_at ASC LIMIT 100
    `, [group_id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur messages' }); }
}

async function sendGroupMessage(req, res) {
  const { group_id } = req.params;
  const { content } = req.body;
  const userId = req.user.id;
  if (!content?.trim()) return res.status(400).json({ error: 'Message vide' });
  try {
    const member = await db.query(
      'SELECT id FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, userId]);
    if (!member.rows.length) return res.status(403).json({ error: 'Non membre' });
    const { rows } = await db.query(
      'INSERT INTO group_messages (group_id, user_id, content) VALUES ($1,$2,$3) RETURNING id',
      [group_id, userId, content.trim()]);
    res.status(201).json({ message_id: rows[0].id });
  } catch (e) { res.status(500).json({ error: 'Erreur envoi message' }); }
}

// ── Évaluations agrégées du groupe ────────────────────────────────────────────
async function getGroupScans(req, res) {
  const { group_id } = req.params;
  const userId = req.user.id;
  try {
    const member = await db.query(
      'SELECT id FROM cigar_group_members WHERE group_id=$1 AND user_id=$2',
      [group_id, userId]);
    if (!member.rows.length) return res.status(403).json({ error: 'Non membre' });
    const { rows } = await db.query(`
      SELECT DISTINCT ON (us.id)
        us.id, us.rating, us.public_review, us.created_at,
        u.username, u.avatar_url,
        c.id as cigar_id, b.name as brand, c.name as model,
        COALESCE(us.scan_image_url, c.admin_image_url, c.image_url) as image_url,
        ROUND((
          SELECT AVG(us2.rating) FROM user_scans us2
          WHERE us2.cigar_id = c.id
            AND us2.user_id IN (SELECT user_id FROM cigar_group_members WHERE group_id=$1)
        )::numeric, 2) as group_avg
      FROM cigar_group_members gm
      JOIN users u ON gm.user_id = u.id
      JOIN user_scans us ON us.user_id = u.id
      JOIN cigars c ON us.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      WHERE gm.group_id = $1
      ORDER BY us.id, us.created_at DESC LIMIT 50
    `, [group_id]);
    res.json(rows);
  } catch (e) {
    console.error('getGroupScans:', e);
    res.status(500).json({ error: 'Erreur évaluations groupe' });
  }
}

// ── Gestion des rôles ────────────────────────────────────────────────────────
async function updateMemberRole(req, res) {
  const { group_id, user_id } = req.params;
  const { role } = req.body;
  const requesterId = req.user.id;
  const VALID_ROLES = ['admin', 'moderator', 'member'];
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  try {
    const requester = await db.query(
      "SELECT role FROM cigar_group_members WHERE group_id=$1 AND user_id=$2",
      [group_id, requesterId]);
    if (!requester.rows.length || requester.rows[0].role !== 'admin')
      return res.status(403).json({ error: 'Réservé aux admins du groupe' });
    await db.query(
      'UPDATE cigar_group_members SET role=$1 WHERE group_id=$2 AND user_id=$3',
      [role, group_id, user_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur mise à jour rôle' }); }
}

async function togglePostLike(req, res) {
  const { post_id } = req.params;
  const userId = req.user.id;
  try {
    const existing = await db.query(
      'SELECT id FROM post_likes WHERE post_id=$1 AND user_id=$2', [post_id, userId]);
    let liked;
    const post = await db.query('SELECT user_id FROM group_posts WHERE id=$1', [post_id]);
    const authorId = post.rows[0]?.user_id;
    if (existing.rows.length) {
      await db.query('DELETE FROM post_likes WHERE post_id=$1 AND user_id=$2', [post_id, userId]);
      liked = false;
      if (authorId && authorId !== userId)
        await db.query('UPDATE users SET reputation_score=GREATEST(0,reputation_score-0.01) WHERE id=$1 AND is_admin=FALSE', [authorId]);
    } else {
      await db.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2)', [post_id, userId]);
      liked = true;
      if (authorId && authorId !== userId)
        await db.query('UPDATE users SET reputation_score=LEAST(1,reputation_score+0.01) WHERE id=$1 AND is_admin=FALSE', [authorId]);
    }
    const { rows } = await db.query('SELECT COUNT(*) as likes FROM post_likes WHERE post_id=$1', [post_id]);
    res.json({ likes: parseInt(rows[0].likes), liked });
  } catch (e) { res.status(500).json({ error: 'Erreur like post' }); }
}

async function deleteGroupPost(req, res) {
  const { group_id, post_id } = req.params;
  const userId = req.user.id;
  try {
    const member = await db.query(
      "SELECT role FROM cigar_group_members WHERE group_id=$1 AND user_id=$2",
      [group_id, userId]);
    const post = await db.query('SELECT user_id FROM group_posts WHERE id=$1', [post_id]);
    if (!post.rows.length) return res.status(404).json({ error: 'Post introuvable' });
    const isAdmin = member.rows.length && member.rows[0].role === 'admin';
    const isAuthor = post.rows[0].user_id === userId;
    if (!isAdmin && !isAuthor) return res.status(403).json({ error: 'Non autorisé' });
    await db.query('DELETE FROM group_posts WHERE id=$1', [post_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur suppression post' }); }
}

async function deleteGroup(req, res) {
  const { group_id } = req.params;
  const userId = req.user.id;
  try {
    const member = await db.query(
      "SELECT role FROM cigar_group_members WHERE group_id=$1 AND user_id=$2",
      [group_id, userId]);
    if (!member.rows.length || member.rows[0].role !== 'admin')
      return res.status(403).json({ error: "Réservé à l'admin du club" });
    await db.query('DELETE FROM cigar_groups WHERE id=$1', [group_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Erreur suppression club' }); }
}

// FIX v2.0.4 : signalement utilisateur
async function reportUser(req, res) {
  const { user_id } = req.params;
  const { reason, detail } = req.body;
  const reporterId = req.user.id;
  const VALID_REASONS = ['spam', 'inappropriate', 'harassment', 'fake', 'other'];
  if (!reason || !VALID_REASONS.includes(reason))
    return res.status(400).json({ error: 'Motif invalide' });
  if (parseInt(user_id) === reporterId)
    return res.status(400).json({ error: 'Vous ne pouvez pas vous signaler vous-même' });
  try {
    const target = await db.query('SELECT id, username FROM users WHERE id=$1', [user_id]);
    if (!target.rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const existing = await db.query(
      "SELECT id FROM user_reports WHERE reported_user_id=$1 AND reporter_id=$2 AND status='pending'",
      [user_id, reporterId]);
    if (existing.rows.length)
      return res.status(409).json({ error: 'Vous avez déjà signalé cet utilisateur' });
    await db.query(
      'INSERT INTO user_reports (reported_user_id, reporter_id, reason, detail) VALUES ($1,$2,$3,$4)',
      [user_id, reporterId, reason, detail || null]);
    res.json({ success: true });
  } catch (e) {
    console.error('reportUser:', e);
    res.status(500).json({ error: 'Erreur signalement' });
  }
}

async function sanctionUser(req, res) {
  const { user_id } = req.params;
  const { type, reason, duration_days } = req.body;
  const VALID_TYPES = ['warning', 'suspension', 'ban', 'reputation_reset'];
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Type invalide' });
  try {
    const expires_at = (type === 'suspension' && duration_days)
      ? new Date(Date.now() + duration_days * 86400000) : null;
    await db.query(
      'INSERT INTO user_sanctions (user_id, type, reason, expires_at, applied_by) VALUES ($1,$2,$3,$4,$5)',
      [user_id, type, reason || null, expires_at, req.user.id]);
    if (type === 'reputation_reset')
      await db.query('UPDATE users SET reputation_score=0.01 WHERE id=$1', [user_id]);
    await db.query(
      "UPDATE user_reports SET status='resolved', resolved_by=$1 WHERE reported_user_id=$2 AND status='pending'",
      [req.user.id, user_id]);
    res.json({ success: true });
  } catch (e) {
    console.error('sanctionUser:', e);
    res.status(500).json({ error: 'Erreur sanction' });
  }
}

async function getUserReports(req, res) {
  const { status = 'pending' } = req.query;
  try {
    const { rows } = await db.query(`
      SELECT ur.*,
        u1.username AS reported_username, u1.avatar_url AS reported_avatar,
        u2.username AS reporter_username
      FROM user_reports ur
      JOIN users u1 ON ur.reported_user_id = u1.id
      JOIN users u2 ON ur.reporter_id = u2.id
      WHERE ur.status = $1
      ORDER BY ur.created_at DESC
    `, [status]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Erreur signalements' }); }
}

module.exports = {
  searchUsers, getPublicProfile, toggleFollow, getFeed,
  leaderboardTopCigars, leaderboardTopTasters,
  getMyGroups, createGroup, getGroupMembers, joinGroup, leaveGroup,
  getNearbyGroups, getMyFollowees,
  getGroupPosts, createGroupPost, deleteGroupPost,
  getGroupMessages, sendGroupMessage,
  getGroupScans, updateMemberRole,
  togglePostLike, deleteGroup,
  inviteMember, removeMember,
  reportUser, sanctionUser, getUserReports,
};
