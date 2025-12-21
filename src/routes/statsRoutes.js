const express = require('express');
const { statsController } = require('../controllers/statsController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// PUBLICZNY endpoint - statystyki dla strony głównej (BEZ autoryzacji)
router.get('/public', statsController.publicStats.bind(statsController));

// Pozostałe endpointy wymagają autoryzacji
router.use(authenticate);

router.get('/overview', statsController.overview.bind(statsController));
router.get('/countries', statsController.countries.bind(statsController));
router.get('/devices', statsController.devices.bind(statsController));
router.get('/links', statsController.links.bind(statsController));

module.exports = router;