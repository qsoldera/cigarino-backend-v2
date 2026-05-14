const auth = require('./auth');

async function adminAuth(req, res, next) {
  await auth(req, res, async () => {
    if (!req.user?.is_admin) {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    next();
  });
}

module.exports = adminAuth;
