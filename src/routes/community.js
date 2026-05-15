const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadCigar } = require('../config/cloudinary');
const {
  searchUsers, getPublicProfile, toggleFollow, getFeed,
  leaderboardTopCigars, leaderboardTopTasters,
  getMyGroups, createGroup, getGroupMembers, joinGroup, leaveGroup,
  getNearbyGroups, getMyFollowees,
  getGroupPosts, createGroupPost,
  getGroupMessages, sendGroupMessage,
  getGroupScans, updateMemberRole,
} = require('../controllers/communityController');

const optAuth = async (req, res, next) => {
  try { await auth(req, res, next); } catch { next(); }
};

router.get('/search',            searchUsers);
router.get('/profile/:username', optAuth, getPublicProfile);
router.post('/follow/:user_id',  auth, toggleFollow);
router.get('/feed',              auth, getFeed);
router.get('/followees',         auth, getMyFollowees);
router.get('/leaderboard/cigars',  leaderboardTopCigars);
router.get('/leaderboard/tasters', leaderboardTopTasters);

// Groupes
router.get('/groups',                  auth, getMyGroups);
router.post('/groups',                 auth, createGroup);
router.get('/groups/nearby',           auth, getNearbyGroups);
router.get('/groups/:group_id/members',       auth, getGroupMembers);
router.post('/groups/:group_id/join',         auth, joinGroup);
router.delete('/groups/:group_id/leave',      auth, leaveGroup);
router.patch('/groups/:group_id/members/:user_id/role', auth, updateMemberRole);

// Posts
router.get('/groups/:group_id/posts',  auth, getGroupPosts);
router.post('/groups/:group_id/posts', auth, ...uploadCigar.single('photo'), createGroupPost);

// Messages
router.get('/groups/:group_id/messages',  auth, getGroupMessages);
router.post('/groups/:group_id/messages', auth, sendGroupMessage);

// Évaluations agrégées
router.get('/groups/:group_id/scans', auth, getGroupScans);

module.exports = router;
