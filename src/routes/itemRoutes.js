const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const itemController = require('../controllers/itemController');
const { auth, checkRole } = require('../middleware/auth.middleware');


// Validation middleware
const validateItem = [
    body('name').notEmpty().withMessage('Name is required'),
    body('type').isIn(['consumable', 'non_consumable', 'fixed']).withMessage('Invalid item type'),
    body('lab').isMongoId().withMessage('Valid lab ID is required'),
    body('quantity').isInt({ min: 0 }).withMessage('Quantity must be a positive number'),
    body('unit').optional().isString(),
    body('expiry_date').optional().isISO8601().withMessage('Invalid expiry date'),
    body('minimum_quantity').optional().isInt({ min: 0 }).withMessage('Minimum quantity must be a positive number'),
    body('description').optional().isString()
];

const validateStockAdjustment = [
    body('adjustment_type').isIn(['add', 'remove']).withMessage('Invalid adjustment type'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive number'),
    body('reason').notEmpty().withMessage('Reason is required'),
    body('notes').optional().isString(),
    body('unit_cost').optional().isFloat({ min: 0 }).withMessage('Unit cost must be a positive number'),
    body('supplier').optional().isString(),
    body('batch_number').optional().isString(),
    body('expiry_date').optional().isISO8601().withMessage('Invalid expiry date')
];

// Routes
router.get('/items',
    query('lab_id').optional().isMongoId(),
    query('type').optional().isIn(['consumable', 'non_consumable', 'fixed']),
    query('low_stock').optional().isBoolean(),
    query('expiring_soon').optional().isBoolean(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    itemController.getAllItems
);

router.get('/items/:id',
    param('id').isMongoId().withMessage('Invalid item ID'),
    itemController.getItemById
);

router.post('/items',
    auth,
    checkRole(['admin', 'lab_manager']),
    validateItem,
    itemController.createItem
);

router.put('/items/:id',
    auth,
    checkRole(['admin', 'lab_manager']),
    param('id').isMongoId().withMessage('Invalid item ID'),
    validateItem,
    itemController.updateItem
);

router.post('/items/:id/adjust',
    auth,
    checkRole(['admin', 'lab_manager']),
    param('id').isMongoId().withMessage('Invalid item ID'),
    validateStockAdjustment,
    itemController.adjustStock
);

router.get('/alerts',
    query('type').optional().isIn(['low_stock', 'expiring_soon', 'expired']),
    query('lab_id').optional().isMongoId(),
    itemController.getAlerts
);

module.exports = router; 