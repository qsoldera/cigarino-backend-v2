const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  searchUsers, getPublicProfile, toggleFollow, getFeed,
  leaderboardTopCigars, leaderboardTopTasters,
  getMyGroups, createGroup, getGroupMembers, joinGroup, leaveGroup,
  getNearbyGroups, getMyFollowees,
} = require('../controllers/communityController');

const optAuth = async (req, res, next) => {
  try { await auth(req, res, next); } catch { next(); }
};

router.get('/search',             searchUsers);
router.get('/profile/:username',  optAuth, getPublicProfile);
router.post('/follow/:user_id',   auth, toggleFollow);
router.get('/feed',               auth, getFeed);
router.get('/followees',          auth, getMyFollowees);

router.get('/leaderboard/cigars',  leaderboardTopCigars);
router.get('/leaderboard/tasters', leaderboardTopTasters);

router.get('/groups',              auth, getMyGroups);
router.post('/groups',             auth, createGroup);
router.get('/groups/nearby',       auth, getNearbyGroups);
router.get('/groups/:group_id/members', auth, getGroupMembers);
router.post('/groups/:group_id/join',   auth, joinGroup);
router.delete('/groups/:group_id/leave', auth, leaveGroup);

module.exports = router;
