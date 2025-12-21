const express = require('express');
const { redirectController } = require('../controllers/redirectController');
const { requireCaptcha, detectBot, trackIP } = require('../middleware/antiBot');

const router = express.Router();

// Anty-bot dla wszystkich requestów
router.use(detectBot);
router.use(trackIP);

// Strona z reklamą
router.get('/:shortCode', redirectController.showAdPage.bind(redirectController));

// Odblokowanie linka - wymaga captcha
router.post('/:shortCode/unlock', requireCaptcha, redirectController.unlock.bind(redirectController));

module.exports = router;