const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const {
  getAllFields,
  getFieldById,
  createField,
  updateField,
  deleteField,
  searchFields
} = require('../controllers/fieldController');

// Public routes
router.get('/', getAllFields);
router.get('/search', searchFields);
router.get('/:id', getFieldById);

// Protected routes (Admin only)
router.post('/', auth, checkRole(['admin']), createField);
router.put('/:id', auth, checkRole(['admin']), updateField);
router.delete('/:id', auth, checkRole(['admin']), deleteField);

module.exports = router;