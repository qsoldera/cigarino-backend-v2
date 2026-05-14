const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { uploadCigar } = require('../config/cloudinary');
const { scan, submitNewCigar } = require('../controllers/scannerController');

router.post('/scan', auth, uploadCigar.single('photo'), scan);
router.post('/submit', auth, uploadCigar.single('photo'), submitNewCigar);

module.exports = router;
