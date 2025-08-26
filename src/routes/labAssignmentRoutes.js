const express = require('express');
const router = express.Router({ mergeParams: true });
const { body } = require('express-validator');
const { assignUser, removeUser, updateUserRole, getAssignedUsers } = require('../controllers/labAssignmentController');
const { auth, checkRole } = require('../middleware/auth.middleware');

// Apply authentication middleware to all routes
router.use(auth);

// Validation rules
const assignmentValidationRules = [
  body('userId')
    .notEmpty().withMessage('User ID is required')
    .isMongoId().withMessage('Invalid user ID'),
  body('role')
    .optional()
    .isIn(['manager', 'technician', 'instructor'])
    .withMessage('Invalid role'),
  body('notes').optional().trim()
];

// Routes
router.route('/')
  .get(getAssignedUsers)
  .post(
    [
      ...assignmentValidationRules,
      body('role').optional().default('technician')
    ],
    assignUser
  );

router.route('/:userId')
  .put(
    assignmentValidationRules,
    updateUserRole
  )
  .delete(removeUser);

module.exports = router;
