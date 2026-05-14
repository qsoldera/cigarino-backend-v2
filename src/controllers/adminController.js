const db = require('../config/database');

async function getReports(req, res) {
  const { status = 'pending' } = req.query;
  try {
    const { rows } = await db.query(`
      SELECT r.id, r.reason, r.detail, r.status, r.created_at,
        r.cigar_id, b.name as brand, c.name as model,
        COALESCE(c.admin_image_url, c.image_url) as image_url,
        u.username as reporter_username
      FROM reports r
      JOIN cigars c ON r.cigar_id = c.id
      JOIN brands b ON c.brand_id = b.id
      JOIN users u ON r.reported_by = u.id
      WHERE r.status = $1
      ORDER BY r.created_at DESC
    `, [status]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur signalements' });
  }
}

async function getPendingCount(req, res) {
  try {
    const { rows } = await db.query("SELECT COUNT(*) FROM reports WHERE status='pending'");
    res.json({ count: parseInt(rows[0].count) });
  } catch (e) {
    res.status(500).json({ error: 'Erreur count' });
  }
}

async function resolveReport(req, res) {
  const { id } = req.params;
  const { action, penalize_submitter } = req.body;
  const VALID = ['resolved', 'dismissed'];
  if (!VALID.includes(action)) return res.status(400).json({ error: 'Action invalide' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'UPDATE reports SET status=$1, resolved_at=NOW(), resolved_by=$2 WHERE id=$3 RETURNING *',
      [action, req.user.id, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Signalement introuvable' });

    const report = rows[0];

    if (action === 'resolved') {
      // Pénaliser le soumetteur du cigare si demandé
      if (penalize_submitter) {
        const cigar = await client.query('SELECT submitted_by FROM cigars WHERE id=$1', [report.cigar_id]);
        if (cigar.rows[0]?.submitted_by) {
          await client.query(
            'UPDATE users SET reputation_score = GREATEST(0.0, reputation_score - 0.05) WHERE id=$1 AND is_admin=FALSE',
            [cigar.rows[0].submitted_by]
          );
        }
      }
      // Récompenser le signalant
      await client.query(
        'UPDATE users SET reputation_score = LEAST(1.0, reputation_score + 0.02) WHERE id=$1 AND is_admin=FALSE',
        [report.reported_by]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Erreur résolution' });
  } finally {
    client.release();
  }
}

async function editCigar(req, res) {
  const { id } = req.params;
  const {
    admin_country_id, admin_strength, admin_avg_price,
    admin_ring_gauge, admin_length_mm, admin_description
  } = req.body;

  const imageUrl = req.file?.path;

  try {
    const updates = [];
    const params = [];
    let idx = 1;

    if (admin_country_id !== undefined) { updates.push(`admin_country_id=$${idx++}`); params.push(admin_country_id); }
    if (admin_strength !== undefined) { updates.push(`admin_strength=$${idx++}`); params.push(admin_strength); }
    if (admin_avg_price !== undefined) { updates.push(`admin_avg_price=$${idx++}`); params.push(admin_avg_price); }
    if (admin_ring_gauge !== undefined) { updates.push(`admin_ring_gauge=$${idx++}`); params.push(admin_ring_gauge); }
    if (admin_length_mm !== undefined) { updates.push(`admin_length_mm=$${idx++}`); params.push(admin_length_mm); }
    if (admin_description !== undefined) { updates.push(`admin_description=$${idx++}`); params.push(admin_description); }
    if (imageUrl) { updates.push(`admin_image_url=$${idx++}`); params.push(imageUrl); }

    updates.push(`admin_verified=TRUE`);

    if (!updates.length) return res.status(400).json({ error: 'Aucune donnée à modifier' });

    params.push(id);
    await db.query(`UPDATE cigars SET ${updates.join(',')} WHERE id=$${idx}`, params);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur édition cigare' });
  }
}

async function deleteCigar(req, res) {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM cigars WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur suppression cigare' });
  }
}

async function createChallenge(req, res) {
  const { title, description, cigar_id, ends_at } = req.body;
  if (!title || !cigar_id || !ends_at) return res.status(400).json({ error: 'Champs requis manquants' });
  try {
    const { rows } = await db.query(
      'INSERT INTO challenges (title, description, cigar_id, created_by, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [title, description || null, cigar_id, req.user.id, ends_at]
    );
    res.status(201).json({ challenge_id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: 'Erreur création challenge' });
  }
}

module.exports = { getReports, getPendingCount, resolveReport, editCigar, deleteCigar, createChallenge };
