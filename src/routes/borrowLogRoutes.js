const express = require('express');
const { body, query, param } = require('express-validator');
const borrowLogController = require('../controllers/borrowLogController');
const { auth, checkRole } = require('../middleware/auth.middleware');
const router = express.Router();

// Validation middleware
const validateBorrow = [
  body('item_id').isMongoId().withMessage('Item ID must be a valid MongoDB ID'),
  body('lab_id').isMongoId().withMessage('Lab ID must be a valid MongoDB ID'),
  body('notes').optional().isString().withMessage('Notes must be a string')
];

// Routes
// Get all borrow logs (admin, lab_manager)
router.get('/', 
  auth,
  checkRole(['admin', 'lab_manager']),
  borrowLogController.getAllBorrowLogs
);

// Get specific borrow log
router.get('/:id',
  auth,
  param('id').isMongoId().withMessage('Borrow log ID must be a valid MongoDB ID'),
  borrowLogController.getBorrowLogById
);

// Borrow an item
router.post('/',
  auth,
  validateBorrow,
  borrowLogController.borrowItem
);

// Return an item
router.put('/:id/return',
  auth,
  param('id').isMongoId().withMessage('Borrow log ID must be a valid MongoDB ID'),
  borrowLogController.returnItem
);

// Get my borrows (current user)
router.get('/my/borrows',
  auth,
  borrowLogController.getMyBorrows
);

// Get active borrows (currently borrowed items)
router.get('/active/borrows',
  auth,
  checkRole(['admin', 'lab_manager']),
  borrowLogController.getActiveBorrows
);

module.exports = router; 