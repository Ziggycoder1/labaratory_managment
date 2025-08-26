const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');

// Dashboard statistics
router.get('/dashboard', reportsController.getDashboardReport);

// Booking reports
router.get('/bookings', reportsController.getBookingReport);

// Stock reports
router.get('/stock', reportsController.getStockReport);

// User activity reports
router.get('/users', reportsController.getUserReport);

// Export reports
router.post('/export', reportsController.exportReport);

module.exports = router; 