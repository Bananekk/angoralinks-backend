const express = require('express');
const { adminController } = require('../controllers/adminController');
const { contactController } = require('../controllers/contactController');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');

const router = express.Router();

// Wszystkie endpointy wymagają autoryzacji i uprawnień admina
router.use(authenticate);
router.use(isAdmin);

// Statystyki platformy
router.get('/stats', adminController.platformStats.bind(adminController));

// Zarządzanie użytkownikami
router.get('/users', adminController.listUsers.bind(adminController));
router.put('/users/:id', adminController.updateUser.bind(adminController));
router.delete('/users/:id', adminController.deleteUser.bind(adminController));

// Zarządzanie linkami
router.get('/links', adminController.listLinks.bind(adminController));
router.delete('/links/:id', adminController.deleteLink.bind(adminController));

// Zarządzanie wypłatami
router.get('/payouts', adminController.listPayouts.bind(adminController));
router.put('/payouts/:id', adminController.updatePayout.bind(adminController));

// Zarządzanie wiadomościami kontaktowymi
router.get('/messages', contactController.list.bind(contactController));
router.put('/messages/:id/read', contactController.markAsRead.bind(contactController));
router.delete('/messages/:id', contactController.delete.bind(contactController));

module.exports = router;