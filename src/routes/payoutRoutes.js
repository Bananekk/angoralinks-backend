const express = require('express');
const router = express.Router();
const { payoutController } = require('../controllers/payoutController');
const { authenticate } = require('../middleware/auth');

// GET /api/payouts - lista wypłat użytkownika
router.get('/', authenticate, payoutController.list.bind(payoutController));

// POST /api/payouts - nowy wniosek o wypłatę
router.post('/', authenticate, payoutController.create.bind(payoutController));

module.exports = router;