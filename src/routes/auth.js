const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
  register, login, registerFcmToken, me,
  forgotPassword, resetPassword,
} = require('../controllers/authController');

router.post('/register',        register);
router.post('/login',           login);
router.get('/me',               auth, me);
router.post('/fcm-token',       auth, registerFcmToken);
// FIX v2.0.5 : mot de passe oublié
router.post('/forgot-password', forgotPassword);
router.post('/reset-password',  resetPassword);

module.exports = router;
