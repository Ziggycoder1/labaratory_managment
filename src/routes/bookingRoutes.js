const express = require('express');
const { body, query, param } = require('express-validator');
const bookingController = require('../controllers/bookingController');
const { auth, checkRole } = require('../middleware/auth.middleware');
const router = express.Router();

// Validation middleware
const validateBooking = [
  body('lab_id').isMongoId().withMessage('Lab ID must be a valid MongoDB ID'),
  body('field_id').isMongoId().withMessage('Field ID must be a valid MongoDB ID'),
  body('start_time').isISO8601().withMessage('Start time must be a valid date'),
  body('end_time').isISO8601().withMessage('End time must be a valid date'),
  body('purpose').isString().notEmpty().withMessage('Purpose is required'),
  body('booking_type').optional().isIn(['research', 'teaching', 'practical', 'maintenance', 'other']).withMessage('Invalid booking type'),
  body('participants_count').optional().isInt({ min: 1 }).withMessage('Participants count must be at least 1'),
  body('equipment_needed').optional().isString().withMessage('Equipment needed must be a string'),
  body('special_instructions').optional().isString().withMessage('Special instructions must be a string'),
  body('setup_time_needed').optional().isInt({ min: 0 }).withMessage('Setup time must be a non-negative integer'),
  body('cleanup_time_needed').optional().isInt({ min: 0 }).withMessage('Cleanup time must be a non-negative integer'),
  body('item_requirements').optional().isArray().withMessage('Item requirements must be an array'),
  body('item_requirements.*.item').optional().isMongoId().withMessage('Item ID must be a valid MongoDB ID'),
  body('item_requirements.*.quantity_needed').optional().isInt({ min: 1 }).withMessage('Quantity needed must be at least 1'),
  body('item_requirements.*.notes').optional().isString().withMessage('Item notes must be a string'),
  body('is_recurring').optional().isBoolean().withMessage('Is recurring must be a boolean'),
  body('recurring_pattern.frequency').optional().isIn(['daily', 'weekly', 'monthly']).withMessage('Invalid recurring frequency'),
  body('recurring_pattern.end_date').optional().isISO8601().withMessage('Recurring end date must be a valid date'),
  body('recurring_pattern.days_of_week').optional().isArray().withMessage('Days of week must be an array')
];

const validateApprove = [
  body('notes').optional().isString().withMessage('Notes must be a string'),
  body('allocated_consumables').optional().isArray().withMessage('Allocated consumables must be an array'),
  body('allocated_consumables.*.item_id').optional().isMongoId().withMessage('Item ID must be a valid MongoDB ID'),
  body('allocated_consumables.*.quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be at least 1')
];

const validateReject = [
  body('reason').isString().notEmpty().withMessage('Rejection reason is required')
];

const validateStatus = [
  body('status').isIn(['approved', 'rejected']).withMessage('Status must be approved or rejected'),
  body('rejection_reason').optional().isString().withMessage('Rejection reason must be a string')
];

const validateAvailability = [
  query('lab_id').isMongoId().withMessage('Lab ID must be a valid MongoDB ID'),
  query('start_time').isISO8601().withMessage('Start time must be a valid date'),
  query('end_time').isISO8601().withMessage('End time must be a valid date'),
  query('exclude_booking_id').optional().isMongoId().withMessage('Exclude booking ID must be a valid MongoDB ID')
];

// Routes
// Get all bookings with role-based access and pagination
router.get('/', 
  auth,
  checkRole(['admin', 'department_admin', 'lab_manager', 'teacher', 'student', 'external']),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('populate').optional().isString().withMessage('Populate must be a string'),
  bookingController.getAllBookings
);

// Get booking statistics (admin, lab_manager)
router.get('/stats',
  auth,
  checkRole(['admin', 'lab_manager']),
  bookingController.getBookingStats
);

// Get booking calendar view
router.get('/calendar',
  auth,
  bookingController.getBookingCalendar
);

// Get pending bookings count (for admin dashboard)
router.get('/pending/count',
  auth,
  checkRole(['admin', 'lab_manager']),
  bookingController.getPendingBookingsCount
);

// Get today's bookings
router.get('/today',
  auth,
  bookingController.getTodayBookings
);

// Get upcoming bookings (next 7 days)
router.get('/upcoming',
  auth,
  bookingController.getUpcomingBookings
);

// Get lab utilization report
router.get('/utilization/report',
  auth,
  checkRole(['admin', 'lab_manager']),
  bookingController.getLabUtilizationReport
);

// Get specific booking
router.get('/:id',
  auth,
  param('id').isMongoId().withMessage('Booking ID must be a valid MongoDB ID'),
  bookingController.getBookingById
);

// Create new booking
router.post('/',
  auth,
  validateBooking,
  bookingController.createBooking
);

// Approve booking (Lab Manager only)
router.patch('/:id/approve',
  auth,
  checkRole(['admin', 'lab_manager']),
  param('id').isMongoId().withMessage('Booking ID must be a valid MongoDB ID'),
  validateApprove,
  bookingController.approveBooking
);

// Reject booking (Lab Manager only)
router.patch('/:id/reject',
  auth,
  checkRole(['admin', 'lab_manager']),
  param('id').isMongoId().withMessage('Booking ID must be a valid MongoDB ID'),
  validateReject,
  bookingController.rejectBooking
);

// Update booking status (approve/reject) - admin, lab_manager (legacy endpoint)
router.put('/:id/status',
  auth,
  checkRole(['admin', 'lab_manager']),
  param('id').isMongoId().withMessage('Booking ID must be a valid MongoDB ID'),
  validateStatus,
  bookingController.updateBookingStatus
);

// Cancel booking
router.patch('/:id/cancel',
  auth,
  param('id').isMongoId().withMessage('Booking ID must be a valid MongoDB ID'),
  bookingController.cancelBooking
);

// Complete booking (admin/lab_manager only)
router.patch('/:id/complete',
  auth,
  checkRole(['admin', 'lab_manager']),
  param('id').isMongoId().withMessage('Booking ID must be a valid MongoDB ID'),
  bookingController.completeBooking
);

// Check lab availability
router.get('/availability/check',
  auth,
  validateAvailability,
  bookingController.checkLabAvailability
);

// Get my bookings (current user)
router.get('/my/bookings',
  auth,
  bookingController.getMyBookings
);

module.exports = router; 