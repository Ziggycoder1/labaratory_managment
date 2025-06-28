const express = require('express');
const router = express.Router();
const { auth, checkRole, checkDepartmentAccess } = require('../middleware/auth.middleware');
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser,
  toggleUserStatus,
  deleteUserPermanently
} = require('../controllers/userController');

// Create new user (no auth required for testing)
router.post('/register', createUser);

// Protected routes
router.get('/', 
  auth, 
  checkRole(['admin', 'department_admin', 'lab_manager']), 
  checkDepartmentAccess,
  getAllUsers
);

router.get('/:id', 
  auth, 
  checkRole(['admin', 'department_admin', 'lab_manager']), 
  checkDepartmentAccess,
  getUserById
);

router.post('/', 
  auth, 
  checkRole(['admin', 'department_admin']), 
  checkDepartmentAccess,
  createUser
);

router.put('/:id', 
  auth, 
  checkRole(['admin', 'department_admin']), 
  checkDepartmentAccess,
  updateUser
);

router.patch('/:id', auth, checkRole(['admin']), toggleUserStatus);

// Deactivate user (soft delete)
router.delete('/:id', 
  auth, 
  checkRole(['admin', 'department_admin']), 
  checkDepartmentAccess,
  deactivateUser
);

// Permanently delete user (admin only)
router.delete('/:id/permanent', 
  auth, 
  checkRole(['admin']), 
  deleteUserPermanently
);

module.exports = router;