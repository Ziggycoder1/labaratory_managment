const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const { getAllDepartments, createDepartment } = require('../controllers/departmentController');


router.get('/', getAllDepartments);

router.post('/add', createDepartment);

module.exports = router; 