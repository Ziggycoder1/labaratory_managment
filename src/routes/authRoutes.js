const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const {
  login,
  forgotPassword,
  resetPassword,
  logout,
  getCurrentUser
} = require('../controllers/authController');

// Public routes
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Protected routes
router.post('/logout', auth, logout);
router.get('/me', auth, getCurrentUser);

module.exports = router; 