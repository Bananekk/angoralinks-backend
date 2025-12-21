const express = require('express');
const { contactController } = require('../controllers/contactController');

const router = express.Router();

// POST /api/contact - wyślij wiadomość (publiczny endpoint)
router.post('/', contactController.send.bind(contactController));

module.exports = router;