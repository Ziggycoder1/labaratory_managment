const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth.middleware');
const maintenanceController = require('../controllers/maintenanceController');

router.get('/schedules', auth, maintenanceController.getSchedules);
router.post('/schedules', auth, maintenanceController.createSchedule);
router.patch('/schedules/:id/complete', auth, maintenanceController.completeSchedule);

module.exports = router; 