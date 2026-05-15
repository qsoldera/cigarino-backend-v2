const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadCigar } = require('../config/cloudinary');
const {
  getCigar, toggleFavorite, toggleWishlist, reportCigar,
  submitScan, updateScan, addUserPhoto,
} = require('../controllers/cigarsController');

const optionalAuth = async (req, res, next) => {
  try { await auth(req, res, next); } catch { next(); }
};

router.get('/:id',              optionalAuth, getCigar);
router.post('/:id/favorite',    auth, toggleFavorite);
router.post('/:id/wishlist',    auth, toggleWishlist);
router.post('/:id/report',      auth, reportCigar);
router.post('/:id/photo',       auth, ...uploadCigar.single('photo'), addUserPhoto);
router.post('/scans',           auth, ...uploadCigar.single('photo'), submitScan);
router.patch('/scans/:scan_id', auth, ...uploadCigar.single('photo'), updateScan);

module.exports = router;
