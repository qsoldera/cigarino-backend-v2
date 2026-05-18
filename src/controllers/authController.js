const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '90d' });
}

async function register(req, res) {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Champs requis manquants' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ error: "Nom d'utilisateur invalide (3-20 caractères, alphanumérique)" });
  if (password.length < 8)
    return res.status(400).json({ error: 'Mot de passe trop court (8 caractères min)' });

  try {
    const exists = await db.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username]
    );
    if (exists.rows.length) {
      return res.status(409).json({ error: "Email ou nom d'utilisateur déjà utilisé" });
    }

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      // FIX v2.0.1 : score de départ 0.01 (1%) au lieu de 0.5 (50%)
      `INSERT INTO users (username, email, password_hash, reputation_score)
       VALUES ($1, $2, $3, 0.01) RETURNING id, username, email, is_admin, reputation_score, avatar_url, created_at`,
      [username, email.toLowerCase(), hash]
    );

    const user = rows[0];
    const token = generateToken(user.id);
    res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
}

async function login(req, res) {
  // FIX v2.0.1 : le champ s'appelle "email" dans la requête Flutter
  // mais accepte désormais email OU nom d'utilisateur
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Champs requis manquants' });

  try {
    // Recherche par email (insensible à la casse) OU par username (exact)
    const { rows } = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) OR username = $1',
      [email.trim()]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });

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

module.exports = { register, login, registerFcmToken, me };
