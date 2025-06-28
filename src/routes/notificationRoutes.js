const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth.middleware');
const notificationController = require('../controllers/notificationController');

router.get('/', auth, notificationController.getNotifications);
router.patch('/:id/read', auth, notificationController.markAsRead);
router.patch('/mark-all-read', auth, notificationController.markAllAsRead);
router.get('/settings', auth, notificationController.getSettings);
router.put('/settings', auth, notificationController.updateSettings);

module.exports = router; 