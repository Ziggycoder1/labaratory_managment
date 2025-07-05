const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const itemController = require('../controllers/itemController');
const { auth, checkRole } = require('../middleware/auth.middleware');

// Validation middleware
const validateItem = [
    body('name').notEmpty().withMessage('Name is required'),
    body('type').isIn(['consumable', 'non_consumable', 'fixed']).withMessage('Invalid item type'),
    body('lab').optional().isMongoId().withMessage('Valid lab ID is required'),
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

const validateMoveItem = [
    body('target_lab_id').isMongoId().withMessage('Valid target lab ID is required'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive number'),
    body('reason').notEmpty().withMessage('Reason is required'),
    body('notes').optional().isString()
];

// GET /api/items - Get all items with pagination and filters
router.get('/',
    auth,
    query('lab_id').optional().isMongoId(),
    query('type').optional().isIn(['consumable', 'non_consumable', 'fixed']),
    query('low_stock').optional().isBoolean(),
    query('expiring_soon').optional().isBoolean(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('search').optional().isString(),
    itemController.getAllItems
);

// GET /api/items/search - Search items with advanced filters
router.get('/search',
    auth,
    query('q').optional().isString(),
    query('name').optional().isString(),
    query('type').optional().isString(),
    query('lab_id').optional().isMongoId(),
    query('low_stock').optional().isBoolean(),
    query('expiring_soon').optional().isBoolean(),
    itemController.searchItems
);

// GET /api/items/low-stock - Get low stock items
router.get('/low-stock',
    auth,
    query('lab_id').optional().isMongoId(),
    itemController.getLowStockItems
);

// GET /api/items/expiring - Get expiring items
router.get('/expiring',
    auth,
    query('days').optional().isInt({ min: 1 }),
    query('lab_id').optional().isMongoId(),
    itemController.getExpiringItems
);

// GET /api/items/:id - Get item by ID
router.get('/:id',
    auth,
    param('id').isMongoId().withMessage('Invalid item ID'),
    itemController.getItemById
);

// POST /api/items - Create new item
router.post('/',
    auth,
    checkRole(['admin', 'lab_manager']),
    validateItem,
    itemController.createItem
);

// PUT /api/items/:id - Update item
router.put('/:id',
    auth,
    checkRole(['admin', 'lab_manager']),
    param('id').isMongoId().withMessage('Invalid item ID'),
    validateItem,
    itemController.updateItem
);

// DELETE /api/items/:id - Soft delete item (set deleted_at)
router.delete('/:id',
    auth,
    checkRole(['admin', 'lab_manager']),
    param('id').isMongoId().withMessage('Invalid item ID'),
    itemController.softDeleteItem
);

// DELETE /api/items/:id/permanent - Permanently delete item
router.delete('/:id/permanent',
    auth,
    checkRole(['admin']), // Only admin can permanently delete
    param('id').isMongoId().withMessage('Invalid item ID'),
    itemController.permanentDeleteItem
);

// POST /api/items/:id/adjust - Adjust stock
router.post('/:id/adjust',
    auth,
    checkRole(['admin', 'lab_manager']),
    param('id').isMongoId().withMessage('Invalid item ID'),
    validateStockAdjustment,
    itemController.adjustStock
);

// POST /api/items/:id/move - Move item to another lab
router.post('/:id/move',
    auth,
    checkRole(['admin', 'lab_manager']),
    param('id').isMongoId().withMessage('Invalid item ID'),
    validateMoveItem,
    itemController.moveItem
);

module.exports = router;