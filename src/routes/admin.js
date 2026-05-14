const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const auth = require('../middleware/auth');
const { uploadAdmin } = require('../config/cloudinary');
const {
  getReports, getPendingCount, resolveReport,
  editCigar, deleteCigar, createChallenge,
} = require('../controllers/adminController');
const db = require('../config/database');

router.get('/reports',              adminAuth, getReports);
router.get('/reports/count',        adminAuth, getPendingCount);
router.post('/reports/:id/resolve', adminAuth, resolveReport);
router.patch('/cigars/:id',         adminAuth, ...uploadAdmin.single('photo'), editCigar);
router.delete('/cigars/:id',        adminAuth, deleteCigar);
router.post('/challenges',          adminAuth, createChallenge);

// Diagnostic : vérifier les champs image dans la DB (admin seulement)
router.get('/debug/images', adminAuth, async (req, res) => {
  const { rows } = await db.query(`
    SELECT id, name, image_url, admin_image_url,
      COALESCE(admin_image_url, image_url) as display_url
    FROM cigars ORDER BY created_at DESC LIMIT 20
  `);
  res.json(rows);
});

module.exports = router;
