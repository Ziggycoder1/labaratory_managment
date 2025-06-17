const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const {
    addFieldToLab,
    removeFieldFromLab,
    getLabFields,
    getFieldLabs
} = require('../controllers/labFieldController');

// Public routes
router.get('/lab/:lab_id/fields', getLabFields);
router.get('/field/:field_id/labs', getFieldLabs);

// Protected routes (admin only)
router.post('/', auth, checkRole(['admin']), addFieldToLab);
router.delete('/:lab_id/:field_id', auth, checkRole(['admin']), removeFieldFromLab);

module.exports = router; 