const express = require('express');
const router = express.Router();
const {
  stats, newArrivals, trending, topRated, bestValue, quickSearch,
  getAllBrands, getAllCigars,
} = require('../controllers/homeController');

router.get('/stats',        stats);
router.get('/new-arrivals', newArrivals);
router.get('/trending',     trending);
router.get('/top-rated',    topRated);
router.get('/best-value',   bestValue);
router.get('/quick-search', quickSearch);
// FIX v2.0.4 : bandeau stats cliquable
router.get('/brands',       getAllBrands);
router.get('/cigars',       getAllCigars);

module.exports = router;
