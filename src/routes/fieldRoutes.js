const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const {
  getAllFields,
  createField
} = require('../controllers/fieldController');

// Public routes
router.get('/', getAllFields);

// Protected routes (Admin only)
router.post('/', auth, checkRole(['admin']), createField);

module.exports = router; 