const express = require('express');
const { profileController } = require('../controllers/profileController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Wszystkie endpointy wymagają autoryzacji
router.use(authenticate);

router.get('/', profileController.getProfile.bind(profileController));
router.put('/', profileController.updateProfile.bind(profileController));
router.put('/password', profileController.changePassword.bind(profileController));
router.delete('/', profileController.deleteAccount.bind(profileController));

module.exports = router;