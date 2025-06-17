const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const {
  getAllLabs,
  getLabById,
  checkLabAvailability,
  createLab
} = require('../controllers/labController');

// Public routes
router.get('/', getAllLabs);
router.get('/:id', getLabById);
router.get('/:id/availability', checkLabAvailability);

// Protected routes (Admin only)
router.post('/', auth, checkRole(['admin']), createLab);

module.exports = router; 