const express = require('express');
const { authController } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Publiczne
router.post('/register', authController.register.bind(authController));
router.post('/verify', authController.verify.bind(authController));
router.post('/resend-code', authController.resendCode.bind(authController));
router.post('/login', authController.login.bind(authController));
router.post('/logout', authController.logout.bind(authController));

// Chronione
router.get('/me', authenticate, authController.me.bind(authController));

module.exports = router;