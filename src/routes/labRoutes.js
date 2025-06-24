const express = require('express');
const router = express.Router();
const { auth, checkRole, checkDepartmentAccess } = require('../middleware/auth.middleware');
const {
  getAllLabs,
  getLabById,
  createLab,
  updateLab,
  deleteLab
} = require('../controllers/labController');

// Get all labs (public)
router.get('/', getAllLabs);

// Protected routes
router.post('/', 
  auth, 
  checkRole(['admin', 'department_admin']), 
  checkDepartmentAccess,
  createLab
);

router.get('/:id', 
  auth, 
  checkRole(['admin', 'department_admin', 'lab_manager']), 
  checkDepartmentAccess,
  getLabById
);

router.put('/:id', 
  auth, 
  checkRole(['admin', 'department_admin']), 
  checkDepartmentAccess,
  updateLab
);

router.delete('/:id', 
  auth, 
  checkRole(['admin', 'department_admin']), 
  checkDepartmentAccess,
  deleteLab
);

module.exports = router; 