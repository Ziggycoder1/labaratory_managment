const express = require('express');
const { body, query, param } = require('express-validator');
const borrowLogController = require('../controllers/borrowLogController');
const { auth, checkRole } = require('../middleware/auth.middleware');
const router = express.Router();

// Validation middleware
const validateBorrowRequest = [
  body('item_id').isMongoId().withMessage('Item ID must be a valid MongoDB ID'),
  body('lab_id').isMongoId().withMessage('Lab ID must be a valid MongoDB ID'),
  body('expected_return_date')
    .isISO8601()
    .withMessage('Expected return date must be a valid date')
    .custom((value) => {
      const selectedDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return selectedDate > today;
    })
    .withMessage('Expected return date must be in the future'),
  body('condition_before')
    .isIn(['excellent', 'good', 'fair', 'poor'])
    .withMessage('Invalid condition value'),
  body('notes').optional().isString().withMessage('Notes must be a string')
];

const validateApproveRequest = [
  body('notes').optional().isString().withMessage('Notes must be a string')
];

const validateRejectRequest = [
  body('reason').notEmpty().withMessage('Rejection reason is required')
];

const validateReturnItem = [
  body('condition_after')
    .isIn(['excellent', 'good', 'fair', 'poor'])
    .withMessage('Invalid condition value'),
  body('damage_notes').optional().isString().withMessage('Damage notes must be a string')
];

// Public routes (no auth required for these)

// Get active borrows (currently borrowed items)
router.get('/active/borrows',
  [
    query('lab_id').optional().isMongoId().withMessage('Lab ID must be a valid MongoDB ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  borrowLogController.getActiveBorrows
);

// Protected routes (require authentication)
router.use(auth);

// Get all borrow logs (admin, lab_manager, department_admin)
router.get(
  '/',
  checkRole(['admin', 'lab_manager', 'department_admin']),
  [
    query('item_id').optional().isMongoId().withMessage('Item ID must be a valid MongoDB ID'),
    query('user_id').optional().isMongoId().withMessage('User ID must be a valid MongoDB ID'),
    query('lab_id').optional().isMongoId().withMessage('Lab ID must be a valid MongoDB ID'),
    query('status')
      .optional()
      .isIn(['pending', 'approved', 'rejected', 'borrowed', 'returned', 'overdue'])
      .withMessage('Invalid status value'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  borrowLogController.getAllBorrowLogs
);

// Get specific borrow log
router.get(
  '/:id',
  param('id').isMongoId().withMessage('Borrow log ID must be a valid MongoDB ID'),
  borrowLogController.getBorrowLogById
);

// Request to borrow an item
router.post(
  '/request',
  validateBorrowRequest,
  borrowLogController.borrowItem
);

// Approve a borrow request (lab_manager, admin)
router.put(
  '/:id/approve',
  checkRole(['admin', 'lab_manager']),
  [
    param('id').isMongoId().withMessage('Borrow log ID must be a valid MongoDB ID'),
    ...validateApproveRequest
  ],
  borrowLogController.approveBorrowRequest
);

// Reject a borrow request (lab_manager, admin)
router.put(
  '/:id/reject',
  checkRole(['admin', 'lab_manager']),
  [
    param('id').isMongoId().withMessage('Borrow log ID must be a valid MongoDB ID'),
    ...validateRejectRequest
  ],
  borrowLogController.rejectBorrowRequest
);

// Return an item
router.put(
  '/:id/return',
  [
    param('id').isMongoId().withMessage('Borrow log ID must be a valid MongoDB ID'),
    ...validateReturnItem
  ],
  borrowLogController.returnItem
);

// Get my borrows (current user)
router.get(
  '/my/borrows',
  [
    query('status')
      .optional()
      .isIn(['pending', 'approved', 'rejected', 'borrowed', 'returned', 'overdue'])
      .withMessage('Invalid status value'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  borrowLogController.getMyBorrows
);

// Get pending borrow requests (lab_manager, admin, department_admin)
router.get(
  '/pending/requests',
  checkRole(['admin', 'lab_manager', 'department_admin']),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  borrowLogController.getPendingRequests
);

// Get overdue items (lab_manager, admin, department_admin)
router.get(
  '/overdue/items',
  checkRole(['admin', 'lab_manager', 'department_admin']),
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  borrowLogController.getOverdueItems
);

module.exports = router;