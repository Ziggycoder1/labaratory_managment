const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const catalogueController = require('../controllers/catalogueController');
const { auth, checkRole } = require('../middleware/auth.middleware');

// Validation middleware for catalogue items
const validateCatalogueItem = [
    body('name').notEmpty().withMessage('Name is required'),
    body('description').optional().isString(),
    body('type').isIn(['consumable', 'non_consumable', 'fixed']).withMessage('Invalid item type'),
    body('category').optional().isString(),
    body('specifications').optional().isObject(),
    body('is_active').optional().isBoolean(),
    body('minimum_quantity').optional().isInt({ min: 0 })
];

// Validation for fixed asset specific fields
const validateFixedAssetFields = [
    body('specifications.model_number').if(body('type').equals('fixed'))
        .notEmpty().withMessage('Model number is required for fixed assets'),
    body('specifications.purchase_date').if(body('type').equals('fixed'))
        .optional().isISO8601().withMessage('Invalid purchase date format'),
    body('specifications.warranty_period').if(body('type').equals('fixed'))
        .optional().isObject().withMessage('Warranty period should be an object')
];

// GET /api/catalogue/items - Get all catalogue items with optional filters
router.get('/items',
    auth,
    query('type').optional().isIn(['consumable', 'non_consumable', 'fixed']),
    query('category').optional().isString(),
    query('search').optional().isString(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    catalogueController.getCatalogueItems
);

// GET /api/catalogue/item/:id - Get a single catalogue item by ID
router.get('/item/:id',
    auth,
    param('id').isMongoId().withMessage('Invalid catalogue item ID'),
    catalogueController.getCatalogueItem
);

// POST /api/catalogue - Create a new catalogue item
router.post('/',
    auth,
    checkRole(['admin', 'lab_manager']),
    [...validateCatalogueItem, ...validateFixedAssetFields],
    catalogueController.createCatalogueItem
);

// PUT /api/catalogue/:id - Update a catalogue item
router.put('/:id',
    auth,
    checkRole(['admin', 'lab_manager']),
    param('id').isMongoId().withMessage('Invalid catalogue item ID'),
    [...validateCatalogueItem, ...validateFixedAssetFields],
    catalogueController.updateCatalogueItem
);

// DELETE /api/catalogue/:id - Delete a catalogue item (soft delete)
router.delete('/:id',
    auth,
    checkRole(['admin']), // Only admin can delete catalogue items
    param('id').isMongoId().withMessage('Invalid catalogue item ID'),
    catalogueController.deleteCatalogueItem
);

// GET /api/catalogue/:id/inventory - Get inventory locations for a catalogue item
router.get('/:id/inventory',
    auth,
    param('id').isMongoId().withMessage('Invalid catalogue item ID'),
    query('lab_id').optional().isMongoId(),
    query('storage_type').optional().isIn(['lab', 'temporary']),
    catalogueController.getItemLocations
);

module.exports = router;
