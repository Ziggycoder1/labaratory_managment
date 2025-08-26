const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth.middleware');
const notificationController = require('../controllers/notificationController');

// Get all notifications with pagination
router.get('/', auth, notificationController.getNotifications);

// Get unread notifications count
router.get('/unread-count', auth, notificationController.getUnreadCount);

// Mark a notification as read
router.patch('/:id/read', auth, notificationController.markAsRead);

// Mark all notifications as read
router.patch('/mark-all-read', auth, notificationController.markAllAsRead);

// Get notification settings
router.get('/settings', auth, notificationController.getSettings);

// Update notification settings
router.put('/settings', auth, notificationController.updateSettings);

module.exports = router;