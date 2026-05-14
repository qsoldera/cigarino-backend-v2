const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadAvatar } = require('../config/cloudinary');
const {
  getProfile, updateAvatar,
  getCave, addToCave, removeFromCave,
  getCarnet, deleteScan,
  getFavorites,
  getWishlist, removeFromWishlist,
} = require('../controllers/profileController');

router.get('/', auth, getProfile);
router.post('/avatar', auth, uploadAvatar.single('avatar'), updateAvatar);

router.get('/cave', auth, getCave);
router.post('/cave', auth, addToCave);
router.delete('/cave/:cigar_id', auth, removeFromCave);

router.get('/carnet', auth, getCarnet);
router.delete('/carnet/:scan_id', auth, deleteScan);

router.get('/favorites', auth, getFavorites);

router.get('/wishlist', auth, getWishlist);
router.delete('/wishlist/:cigar_id', auth, removeFromWishlist);

module.exports = router;
