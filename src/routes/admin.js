const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const { uploadAdmin } = require('../config/cloudinary');
const { getReports, getPendingCount, resolveReport, editCigar, deleteCigar, createChallenge } = require('../controllers/adminController');

router.get('/reports', adminAuth, getReports);
router.get('/reports/count', adminAuth, getPendingCount);
router.post('/reports/:id/resolve', adminAuth, resolveReport);
router.patch('/cigars/:id', adminAuth, uploadAdmin.single('photo'), editCigar);
router.delete('/cigars/:id', adminAuth, deleteCigar);
router.post('/challenges', adminAuth, createChallenge);

module.exports = router;
