const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth.middleware');
const permissionController = require('../controllers/permissionController');

router.get('/', auth, permissionController.getAllPermissions);

module.exports = router; 