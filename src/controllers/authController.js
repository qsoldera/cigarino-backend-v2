const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../config/database');

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '90d' });
}

async function register(req, res) {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Champs requis manquants' });

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({
      error: "Nom d'utilisateur invalide. Utilisez entre 3 et 20 caractères : lettres (a-z, A-Z), chiffres (0-9) ou underscore (_). Les espaces et caractères spéciaux ne sont pas autorisés.",
    });

  if (password.length < 8)
    return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });

  try {
    const emailExists = await db.query(
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (emailExists.rows.length)
      return res.status(409).json({ error: 'Cette adresse email est déjà utilisée' });

    const usernameExists = await db.query(
      'SELECT id FROM users WHERE username = $1', [username]);
    if (usernameExists.rows.length)
      return res.status(409).json({ error: "Ce nom d'utilisateur est déjà pris" });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      `INSERT INTO users (username, email, password_hash, reputation_score)
       VALUES ($1, $2, $3, 0.01)
       RETURNING id, username, email, is_admin, reputation_score, avatar_url, created_at`,
      [username, email.toLowerCase(), hash]
    );
    const token = generateToken(rows[0].id);
    res.status(201).json({ token, user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Champs requis manquants' });

  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR username = $1',
      [email.trim()]
    );

    if (!rows.length)
      return res.status(401).json({
        error: "Aucun compte trouvé avec cet identifiant. Vérifiez votre email ou nom d'utilisateur.",
      });

    const user  = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Mot de passe incorrect.' });

    const token = generateToken(user.id);
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur de connexion' });
  }
}

async function registerFcmToken(req, res) {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token FCM manquant' });
  try {
    await db.query(
      `INSERT INTO user_fcm_tokens (user_id, token) VALUES ($1, $2)
       ON CONFLICT (user_id, token) DO NOTHING`,
      [req.user.id, token]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur enregistrement token' });
  }
}

async function me(req, res) {
  const { password_hash, ...user } = req.user;
  res.json(user);
}

// ── Mot de passe oublié ───────────────────────────────────────────────────
// FIX v2.0.5 : génère un token, envoie l'email via Resend
async function forgotPassword(req, res) {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requis' });

  try {
    const { rows } = await db.query(
      'SELECT id, username FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    // Réponse identique qu'il existe ou non (sécurité — évite l'énumération)
    if (!rows.length) {
      return res.json({ message: 'Si un compte existe avec cet email, vous recevrez un lien de réinitialisation.' });
    }

    const user  = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Invalider les anciens tokens
    await db.query(
      'UPDATE password_reset_tokens SET used=TRUE WHERE user_id=$1 AND used=FALSE',
      [user.id]
    );

    // Insérer le nouveau token
    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, token, expiresAt]
    );

    // Envoi email via Resend
    const resetUrl = `${process.env.APP_URL || 'https://cigarino.app'}/reset-password?token=${token}`;
    await sendResetEmail(email.trim(), user.username, resetUrl);

    res.json({ message: 'Si un compte existe avec cet email, vous recevrez un lien de réinitialisation.' });
  } catch (e) {
    console.error('forgotPassword:', e);
    res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email' });
  }
}

async function sendResetEmail(to, username, resetUrl) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from:    'onboarding@resend.dev>',
      to:      [to],
      subject: 'Réinitialisation de votre mot de passe Cigarino',
      html: `
        <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #FAF7F3; border-radius: 12px;">
          <h2 style="color: #5C2D00; font-size: 22px; margin-bottom: 8px;">🚬 Cigarino</h2>
          <p style="color: #6B4C35;">Bonjour <strong>${username}</strong>,</p>
          <p style="color: #6B4C35;">Vous avez demandé la réinitialisation de votre mot de passe.</p>
          <p style="color: #6B4C35;">Cliquez sur le bouton ci-dessous. Ce lien expire dans <strong>15 minutes</strong>.</p>
          <a href="${resetUrl}" style="display: inline-block; margin: 24px 0; padding: 14px 28px; background: #8B4513; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
            Réinitialiser mon mot de passe
          </a>
          <p style="color: #9E8070; font-size: 12px;">Si vous n'avez pas fait cette demande, ignorez cet email. Votre mot de passe n'a pas changé.</p>
          <p style="color: #9E8070; font-size: 12px;">Lien direct : ${resetUrl}</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Resend error:', err);
    throw new Error('Erreur envoi email');
  }
}

// ── Réinitialisation du mot de passe ─────────────────────────────────────
async function resetPassword(req, res) {
  const { token, password } = req.body;
  if (!token || !password)
    return res.status(400).json({ error: 'Token et mot de passe requis' });

  if (password.length < 8)
    return res.status(400).json({ error: 'Mot de passe trop court (8 caractères minimum)' });

  try {
    const { rows } = await db.query(
      `SELECT * FROM password_reset_tokens
       WHERE token=$1 AND used=FALSE AND expires_at > NOW()`,
      [token]
    );

    if (!rows.length)
      return res.status(400).json({ error: 'Lien invalide ou expiré. Faites une nouvelle demande.' });

    const { user_id } = rows[0];
    const hash = await bcrypt.hash(password, 12);

    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user_id]);
    await db.query('UPDATE password_reset_tokens SET used=TRUE WHERE id=$1', [rows[0].id]);

    res.json({ success: true, message: 'Mot de passe mis à jour. Vous pouvez vous reconnecter.' });
  } catch (e) {
    console.error('resetPassword:', e);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation' });
  }
}

module.exports = { register, login, registerFcmToken, me, forgotPassword, resetPassword };
