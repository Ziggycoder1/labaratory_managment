const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth.middleware');
const systemController = require('../controllers/systemController');

router.get('/settings', auth, systemController.getSettings);
router.put('/settings', auth, systemController.updateSettings);
router.get('/logs', auth, systemController.getLogs);

module.exports = router; 