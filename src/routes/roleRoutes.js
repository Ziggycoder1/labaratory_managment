const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth.middleware');
const roleController = require('../controllers/roleController');

router.get('/', auth, roleController.getAllRoles);

module.exports = router; 