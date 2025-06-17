const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser
} = require('../controllers/userController');

// Create new user (no auth required for testing)
router.post('/register', createUser);

// Protected routes
router.get('/', auth, checkRole(['admin', 'lab_manager']), getAllUsers);
router.get('/:id', auth, checkRole(['admin', 'lab_manager']), getUserById);
router.put('/:id', auth, checkRole(['admin']), updateUser);
router.delete('/:id', auth, checkRole(['admin']), deactivateUser);

module.exports = router; 