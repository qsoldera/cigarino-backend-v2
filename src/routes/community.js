const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadCigar } = require('../config/cloudinary');
const {
  searchUsers, getPublicProfile, toggleFollow, getFeed,
  leaderboardTopCigars, leaderboardTopTasters,
  getMyGroups, createGroup, getGroupMembers, joinGroup, leaveGroup,
  getNearbyGroups, getMyFollowees,
  getGroupPosts, createGroupPost, deleteGroupPost,
  getGroupMessages, sendGroupMessage,
  getGroupScans, updateMemberRole, togglePostLike,
  deleteGroup,
  inviteMember, removeMember,
  reportUser, sanctionUser, getUserReports,
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

// FIX v2.0.4 : gestion membres
router.post('/groups/:group_id/members',              auth, inviteMember);
router.delete('/groups/:group_id/members/:user_id',   auth, removeMember);

// Posts
router.get('/groups/:group_id/posts',  auth, getGroupPosts);
router.post('/groups/:group_id/posts', auth, ...uploadCigar.single('photo'), createGroupPost);
router.delete('/groups/:group_id/posts/:post_id', auth, deleteGroupPost);
router.delete('/groups/:group_id', auth, deleteGroup);

// Messages
router.get('/groups/:group_id/messages',  auth, getGroupMessages);
router.post('/groups/:group_id/messages', auth, sendGroupMessage);

// Évaluations agrégées
router.get('/groups/:group_id/scans', auth, getGroupScans);
router.post('/groups/posts/:post_id/like', auth, togglePostLike);

// FIX v2.0.4 : signalement utilisateur
router.post('/users/:user_id/report', auth, reportUser);

module.exports = router;
