const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const itemController = require('../controllers/itemController');
const { auth, checkRole, checkDepartmentAccess } = require('../middleware/auth.middleware');

// Validation middleware
const validateItem = [
    body('name')
        .if((value, { req }) => !req.body.catalogue_item_id)
        .notEmpty()
        .withMessage('Name is required when not using a catalogue item'),
    body('type')
        .if((value, { req }) => !req.body.catalogue_item_id)
        .isIn(['consumable', 'non_consumable', 'fixed'])
        .withMessage('Invalid item type'),
    body('catalogue_item_id')
        .optional()
        .isMongoId()
        .withMessage('Valid catalogue item ID is required'),
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

const validateTransferItem = [
    body('item_id').isMongoId().withMessage('Valid item ID is required'),
    body('from_lab_id').isMongoId().withMessage('Valid source lab ID is required'),
    body('to_lab_id').isMongoId().withMessage('Valid target lab ID is required'),
    body('from_storage_type').optional().isIn(['lab', 'temporary']).withMessage('Invalid source storage type'),
    body('to_storage_type').optional().isIn(['lab', 'temporary']).withMessage('Invalid target storage type'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be a positive number'),
    body('reason').optional().isString(),
    body('notes').optional().isString()
];

// GET /api/items - Get all items with pagination and filters
router.get('/',
    auth,
    checkDepartmentAccess,
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
    checkDepartmentAccess,
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
    checkDepartmentAccess,
    query('lab_id').optional().isMongoId(),
    itemController.getLowStockItems
);

// GET /api/items/expiring - Get expiring items
router.get('/expiring',
    auth,
    checkDepartmentAccess,
    query('days').optional().isInt({ min: 1 }),
    query('lab_id').optional().isMongoId(),
    itemController.getExpiringItems
);

// GET /api/items/:id - Get item by ID
router.get('/:id',
    auth,
    checkDepartmentAccess,
    param('id').isMongoId().withMessage('Invalid item ID'),
    itemController.getItemById
);

// POST /api/items - Create new item
router.post('/',
    auth,
    checkRole(['admin', 'lab_manager']),
    checkDepartmentAccess,
    validateItem,
    itemController.createItem
);

// PUT /api/items/:id - Update item
router.put('/:id',
    auth,
    checkRole(['admin', 'lab_manager']),
    checkDepartmentAccess,
    param('id').isMongoId().withMessage('Invalid item ID'),
    validateItem,
    itemController.updateItem
);

// DELETE /api/items/:id - Soft delete item (set deleted_at)
router.delete('/:id',
    auth,
    checkRole(['admin', 'lab_manager']),
    checkDepartmentAccess,
    param('id').isMongoId().withMessage('Invalid item ID'),
    itemController.softDeleteItem
);

// DELETE /api/items/:id/permanent - Permanently delete item
router.delete('/:id/permanent',
    auth,
    checkRole(['admin']), // Only admin can permanently delete
    checkDepartmentAccess,
    param('id').isMongoId().withMessage('Invalid item ID'),
    itemController.permanentDeleteItem
);

// POST /api/items/:id/adjust - Adjust stock
router.post('/:id/adjust',
    auth,
    checkRole(['admin', 'lab_manager']),
    checkDepartmentAccess,
    param('id').isMongoId().withMessage('Invalid item ID'),
    validateStockAdjustment,
    itemController.adjustStock
);

// POST /api/items/transfer - Transfer items between storage locations (lab to lab, lab to temp, etc.)
router.post('/transfer',
    auth,
    checkRole(['admin', 'lab_manager', 'department_admin']),
    checkDepartmentAccess,
    validateTransferItem,
    itemController.transferItem
);

// POST /api/items/:id/move - Move item between labs (legacy, consider using /transfer instead)
router.post('/:id/move',
    auth,
    checkRole(['admin', 'lab_manager', 'department_admin']),
    checkDepartmentAccess,
    param('id').isMongoId().withMessage('Invalid item ID'),
    validateMoveItem,
    itemController.moveItem
);

module.exports = router;