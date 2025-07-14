const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { auth, checkRole } = require('../middleware/auth.middleware');

// Apply auth middleware to all routes
router.use(auth);

// System Overview - Accessible to all authenticated users
router.get('/overview', analyticsController.getSystemOverview);

// Booking Analytics - Accessible to admin, lab_manager, and department_admin
router.get(
  '/bookings',
  checkRole(['admin', 'lab_manager', 'department_admin']),
  analyticsController.getBookingAnalytics
);

// Inventory Analytics - Accessible to admin, lab_manager, and department_admin
router.get(
  '/inventory',
  checkRole(['admin', 'lab_manager', 'department_admin']),
  analyticsController.getInventoryAnalytics
);

// User Activity Analytics - Accessible to admin only
router.get(
  '/user-activity',
  checkRole(['admin']),
  analyticsController.getUserActivityAnalytics
);

module.exports = router;
