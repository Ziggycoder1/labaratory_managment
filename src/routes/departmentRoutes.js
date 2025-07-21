const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const { 
  getAllDepartments, 
  getPublicDepartments,
  createDepartment, 
  getDepartmentById, 
  updateDepartment, 
  deleteDepartment 
} = require('../controllers/departmentController');

// Public endpoint - no authentication required
router.get('/public', getPublicDepartments);

// Get all departments
router.get('/', auth, checkRole(['admin', 'lab_manager']), getAllDepartments);

// Get single department
router.get('/:id', auth, checkRole(['admin', 'lab_manager']), getDepartmentById);

// Create new department
router.post('/', auth, checkRole(['admin']), createDepartment);

// Update department
router.put('/:id', auth, checkRole(['admin']), updateDepartment);

// Delete department
router.delete('/:id', auth, checkRole(['admin']), deleteDepartment);

module.exports = router;