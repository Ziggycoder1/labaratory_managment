const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const stockController = require('../controllers/stockController');
const { auth, checkRole, checkDepartmentAccess } = require('../middleware/auth.middleware');

// Validation middleware
const validateStockOperation = [
  body('quantity')
    .isFloat({ min: 0.01 })
    .withMessage('Quantity must be a positive number'),
  body('reason')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 3 })
    .withMessage('Reason must be at least 3 characters long'),
  body('notes')
    .optional()
    .isString()
    .trim()
];

// Add stock to item
router.post(
  '/:itemId/add',
  auth,
  checkRole(['admin', 'lab_manager']),
  checkDepartmentAccess,
  [
    param('itemId').isMongoId().withMessage('Invalid item ID'),
    ...validateStockOperation
  ],
  stockController.addStock
);

// Remove stock from item
router.post(
  '/:itemId/remove',
  auth,
  checkRole(['admin', 'lab_manager']),
  checkDepartmentAccess,
  [
    param('itemId').isMongoId().withMessage('Invalid item ID'),
    ...validateStockOperation
  ],
  stockController.removeStock
);

// Move stock between labs
router.post(
  '/:itemId/move',
  auth,
  checkRole(['admin', 'lab_manager']),
  checkDepartmentAccess,
  [
    param('itemId').isMongoId().withMessage('Invalid item ID'),
    body('target_lab_id')
      .isMongoId()
      .withMessage('Valid target lab ID is required'),
    body('source_lab_id')
      .optional()
      .isMongoId()
      .withMessage('Valid source lab ID is required'),
    ...validateStockOperation
  ],
  stockController.moveStock
);

// Adjust stock (manual correction)
router.post(
  '/:itemId/adjust',
  auth,
  checkRole(['admin', 'lab_manager']),
  checkDepartmentAccess,
  [
    param('itemId').isMongoId().withMessage('Invalid item ID'),
    body('new_quantity')
      .isFloat({ min: 0 })
      .withMessage('New quantity must be a positive number'),
    body('reason')
      .isString()
      .trim()
      .isLength({ min: 3 })
      .withMessage('Reason is required and must be at least 3 characters long'),
    body('notes').optional().isString().trim()
  ],
  stockController.adjustStock
);

// Get stock history for an item
router.get(
  '/:itemId/history',
  auth,
  [
    param('itemId').isMongoId().withMessage('Invalid item ID'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100')
  ],
  stockController.getStockHistory
);

// Get low stock items
router.get(
  '/low-stock',
  auth,
  checkRole(['admin', 'lab_manager']),
  checkDepartmentAccess,
  [
    query('lab_id')
      .optional()
      .isMongoId()
      .withMessage('Valid lab ID is required')
  ],
  stockController.getLowStockItems
);

// Get expiring items
router.get(
  '/expiring',
  auth,
  checkRole(['admin', 'lab_manager']),
  checkDepartmentAccess,
  [
    query('lab_id')
      .optional()
      .isMongoId()
      .withMessage('Valid lab ID is required'),
    query('days')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Days must be a positive integer')
  ],
  stockController.getExpiringItems
);

module.exports = router;
