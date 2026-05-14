const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const optionalAuth = async (req, res, next) => {
  try { await auth(req, res, next); } catch { next(); }
};
const { getCigar, toggleFavorite, toggleWishlist, reportCigar, submitScan } = require('../controllers/cigarsController');

router.get('/:id', optionalAuth, getCigar);
router.post('/:id/favorite', auth, toggleFavorite);
router.post('/:id/wishlist', auth, toggleWishlist);
router.post('/:id/report', auth, reportCigar);
router.post('/scans', auth, submitScan);

module.exports = router;
