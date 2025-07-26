const express = require('express');
const router = express.Router();
const { check } = require('express-validator');
const catalogueController = require('../controllers/catalogueController');
const { auth, authorize } = require('../middleware/auth');

// Validation rules
const catalogueItemValidation = [
  check('name', 'Name is required').not().isEmpty().trim(),
  check('type', 'Type is required').isIn(['consumable', 'non_consumable', 'fixed_asset']),
  check('specifications.unit', 'Unit is required').if(
    (value, { req }) => req.body.type !== 'fixed_asset'
  ).not().isEmpty(),
  check('specifications.default_minimum_quantity', 'Default minimum quantity is required')
    .isInt({ min: 0 })
];

// Fixed asset specific validation
const fixedAssetValidation = [
  check('specifications.model_number', 'Model number is required for fixed assets')
    .if((value, { req }) => req.body.type === 'fixed_asset')
    .not().isEmpty(),
  check('specifications.warranty_period', 'Warranty period is required for fixed assets')
    .if((value, { req }) => req.body.type === 'fixed_asset')
    .isInt({ min: 0 }),
  check('specifications.maintenance_interval', 'Maintenance interval is required for fixed assets')
    .if((value, { req }) => req.body.type === 'fixed_asset')
    .isInt({ min: 1 })
];

// Apply auth middleware to all routes
router.use(auth);

// @route   GET /api/catalogue
// @desc    Get all catalogue items (alias for /items for backward compatibility)
// @access  Private (Lab Manager, Admin)
router.get(
  '/',
  authorize(['lab_manager', 'admin']),
  catalogueController.getCatalogueItems
);

// @route   GET /api/catalogue/items
// @desc    Get all catalogue items
// @access  Private (Lab Manager, Admin)
router.get(
  '/items',
  authorize(['lab_manager', 'admin']),
  catalogueController.getCatalogueItems
);

// @route   GET /api/catalogue/:id
// @desc    Get single catalogue item with inventory
// @access  Private (Lab Manager, Admin)
router.get(
  '/:id',
  authorize(['lab_manager', 'admin']),
  (req, res, next) => {
    // Add validation to ensure the id is a valid ObjectId
    if (!require('mongoose').Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid catalogue item ID'
      });
    }
    next();
  },
  catalogueController.getCatalogueItem
);

// @route   POST /api/catalogue
// @desc    Create a new catalogue item
// @access  Private (Admin only)
router.post(
  '/',
  authorize(['admin']),
  [...catalogueItemValidation, ...fixedAssetValidation],
  catalogueController.createCatalogueItem
);

// @route   PUT /api/catalogue/:id
// @desc    Update a catalogue item
// @access  Private (Admin only)
router.put(
  '/:id',
  authorize(['admin']),
  [...catalogueItemValidation, ...fixedAssetValidation],
  catalogueController.updateCatalogueItem
);

// @route   DELETE /api/catalogue/:id
// @desc    Delete a catalogue item (soft delete)
// @access  Private (Admin only)
router.delete(
  '/:id',
  authorize(['admin']),
  catalogueController.deleteCatalogueItem
);

// @route   GET /api/catalogue/:id/locations
// @desc    Get all inventory locations for a catalogue item
// @access  Private (Lab Manager, Admin)
router.get(
  '/:id/locations',
  authorize(['lab_manager', 'admin']),
  catalogueController.getItemLocations
);

module.exports = router;
