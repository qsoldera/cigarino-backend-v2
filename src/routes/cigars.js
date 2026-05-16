const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadCigar } = require('../config/cloudinary');
const {
  getCigar, toggleFavorite, toggleWishlist, reportCigar,
  submitScan, updateScan, addUserPhoto, addScanPhoto, toggleScanLike,
} = require('../controllers/cigarsController');

const optAuth = async (req, res, next) => {
  try { await auth(req, res, next); } catch { next(); }
};

const optPhoto = (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('multipart/form-data')) return next();
  const [multerMw, cloudMw] = uploadCigar.single('photo');
  multerMw(req, res, (err) => { if (err) return next(err); cloudMw(req, res, next); });
};

router.get('/:id',               optAuth, getCigar);
router.post('/:id/favorite',     auth, toggleFavorite);
router.post('/:id/wishlist',     auth, toggleWishlist);
router.post('/:id/report',       auth, reportCigar);
router.post('/:id/photo',        auth, ...uploadCigar.single('photo'), addUserPhoto);
router.post('/scans',            auth, optPhoto, submitScan);
router.patch('/scans/:scan_id',  auth, optPhoto, updateScan);
router.post('/scans/:scan_id/photo', auth, ...uploadCigar.single('photo'), addScanPhoto);
router.post('/scans/:scan_id/like',  auth, toggleScanLike);

module.exports = router;
