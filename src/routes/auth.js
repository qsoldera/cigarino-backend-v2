// routes/auth.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { register, login, registerFcmToken, me } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.get('/me', auth, me);
router.post('/fcm-token', auth, registerFcmToken);

module.exports = router;
