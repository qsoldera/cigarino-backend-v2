const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  searchUsers, getPublicProfile, toggleFollow, getFeed,
  leaderboardTopCigars, leaderboardTopTasters, leaderboardByTerroir,
  getChallenges,
} = require('../controllers/communityController');

router.get('/search', searchUsers);
router.get('/profile/:username', auth, getPublicProfile);
router.post('/follow/:user_id', auth, toggleFollow);
router.get('/feed', auth, getFeed);
router.get('/leaderboard/cigars', leaderboardTopCigars);
router.get('/leaderboard/tasters', leaderboardTopTasters);
router.get('/leaderboard/terroir', leaderboardByTerroir);
router.get('/challenges', getChallenges);

module.exports = router;
