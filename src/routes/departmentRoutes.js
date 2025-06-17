const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const { getAllDepartments, createDepartment } = require('../controllers/departmentController');

// GET /api/departments - Get all departments
router.get('/', getAllDepartments);

// POST /api/departments - Create new department (Admin only)
router.post('/add', createDepartment);

module.exports = router; 