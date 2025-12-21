const express = require('express');
const { linkController } = require('../controllers/linkController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Wszystkie endpointy wymagają autoryzacji
router.use(authenticate);

// CRUD operacje
router.post('/', linkController.create.bind(linkController));
router.get('/', linkController.list.bind(linkController));
router.get('/:id', linkController.get.bind(linkController));
router.put('/:id', linkController.update.bind(linkController));
router.delete('/:id', linkController.delete.bind(linkController));

module.exports = router;