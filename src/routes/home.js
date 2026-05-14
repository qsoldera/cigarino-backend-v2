const express = require('express');
const router = express.Router();
const { stats, newArrivals, trending, topRated, bestValue, quickSearch } = require('../controllers/homeController');

router.get('/stats', stats);
router.get('/new-arrivals', newArrivals);
router.get('/trending', trending);
router.get('/top-rated', topRated);
router.get('/best-value', bestValue);
router.get('/quick-search', quickSearch);

module.exports = router;
