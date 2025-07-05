const express = require('express');
const { body, query, param } = require('express-validator');
const stockLogController = require('../controllers/stockLogController');
const { auth, checkRole } = require('../middleware/auth.middleware');
const router = express.Router();

// Validation middleware
const validateStockLog = [
  body('item_id').isMongoId().withMessage('Item ID must be a valid MongoDB ID'),
  body('change_quantity').isNumeric().withMessage('Change quantity must be a number'),
  body('reason').isString().notEmpty().withMessage('Reason is required and must be a string')
];

// Routes
// Get all stock logs (admin, lab_manager)
router.get('/', 
  auth,
  checkRole(['admin', 'lab_manager']),
  stockLogController.getAllStockLogs
);

// Movement data endpoint - must come before :id route
router.get('/movement-data',
  auth,
  checkRole(['admin', 'lab_manager']),
  query('item_ids').isString().withMessage('Item IDs must be a comma-separated string of valid MongoDB IDs'),
  stockLogController.getItemsMovementData
);

// Get stock logs by item
router.get('/item/:item_id',
  auth,
  checkRole(['admin', 'lab_manager']),
  param('item_id').isMongoId().withMessage('Item ID must be a valid MongoDB ID'),
  stockLogController.getStockLogsByItem
);

// Create stock log (add/remove stock)
router.post('/',
  auth,
  checkRole(['admin', 'lab_manager']),
  validateStockLog,
  stockLogController.createStockLog
);

// Get specific stock log - must come after all other GET routes
router.get('/:id',
  auth,
  checkRole(['admin', 'lab_manager']),
  param('id').isMongoId().withMessage('Stock log ID must be a valid MongoDB ID'),
  stockLogController.getStockLogById
);

// Get stock logs by user
router.get('/user/:user_id',
  auth,
  checkRole(['admin', 'lab_manager']),
  param('user_id').isMongoId().withMessage('User ID must be a valid MongoDB ID'),
  stockLogController.getStockLogsByUser
);

// Get stock summary (dashboard)
router.get('/summary/dashboard',
  auth,
  checkRole(['admin', 'lab_manager']),
  stockLogController.getStockSummary
);

module.exports = router;