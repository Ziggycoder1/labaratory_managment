const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth.middleware');
const {
  login,
  register,
  forgotPassword,
  resetPassword,
  logout,
  getCurrentUser,
  verifyToken,
  refreshToken,
  changePassword
} = require('../controllers/authController');

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/verify-token', verifyToken);
router.post('/refresh-token', refreshToken);

// Protected routes
router.post('/logout', auth, logout);
router.get('/me', auth, getCurrentUser);
router.post('/change-password', auth, changePassword);

module.exports = router;