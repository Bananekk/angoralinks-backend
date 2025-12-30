// routes/referralRoutes.js
const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { verifyToken, isAdmin } = require('../middleware/auth');

// ============ PUBLICZNE ============
router.get('/validate/:code', referralController.validateCode);
router.get('/settings', referralController.getPublicSettings);

// ============ ZALOGOWANY UŻYTKOWNIK ============
router.get('/stats', verifyToken, referralController.getMyStats);
router.get('/commissions', verifyToken, referralController.getMyCommissions);

// ============ ADMIN ============
router.get('/admin/stats', verifyToken, isAdmin, referralController.getAdminStats);
router.get('/admin/all', verifyToken, isAdmin, referralController.getAllReferrals);
router.put('/admin/settings', verifyToken, isAdmin, referralController.updateSettings);

// 🆕 Fraud alerts
router.get('/admin/fraud-alerts', verifyToken, isAdmin, referralController.getFraudAlerts);
router.post('/admin/fraud-alerts/:userId/resolve', verifyToken, isAdmin, referralController.resolveFraudAlert);

module.exports = router;