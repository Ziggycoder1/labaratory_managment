const User = require('../models/User');
const Department = require('../models/Department');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/sendEmail');

// Login user
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email }).populate('department');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        errors: []
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        errors: []
      });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    user.last_login = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.full_name,
          role: user.role,
          department_id: user.department?._id,
          department_name: user.department?.name,
          created_at: user.created_at
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during login',
      errors: []
    });
  }
};

// Forgot password
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        errors: []
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    user.reset_token = resetToken;
    user.reset_token_expiry = resetTokenExpiry;
    await user.save();

    // Send reset email (assume sendPasswordResetEmail is implemented elsewhere)
    const emailSent = await sendPasswordResetEmail(email, resetToken);
    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: 'Error sending reset email',
        errors: []
      });
    }

    res.json({
      success: true,
      message: 'Password reset link sent to email'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing request',
      errors: []
    });
  }
};

// Reset password
const resetPassword = async (req, res) => {
  const { token, password, password_confirmation } = req.body;

  if (password !== password_confirmation) {
    return res.status(400).json({
      success: false,
      message: 'Passwords do not match',
      errors: []
    });
  }

  try {
    const user = await User.findOne({ reset_token: token, reset_token_expiry: { $gt: new Date() } });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
        errors: []
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.reset_token = undefined;
    user.reset_token_expiry = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successful'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting password',
      errors: []
    });
  }
};

// Logout
const logout = async (req, res) => {
  // Since we're using JWT, we don't need to do anything server-side
  // The client should remove the token
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

// Get current user profile
const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('department');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        errors: []
      });
    }

    // Get user permissions based on role
    const permissions = getPermissionsByRole(user.role);

    res.json({
      success: true,
      data: {
        id: user._id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        department_id: user.department?._id,
        department: {
          id: user.department?._id,
          name: user.department?.name,
          code: user.department?.code
        },
        permissions
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user profile',
      errors: []
    });
  }
};

// Helper function to get permissions by role
const getPermissionsByRole = (role) => {
  const permissions = {
    admin: ['manage_users', 'manage_departments', 'manage_labs', 'manage_items', 'view_reports'],
    lab_manager: ['manage_labs', 'manage_items', 'view_reports'],
    teacher: ['book_lab', 'request_consumables', 'borrow_tools', 'view_reports'],
    student: ['book_lab', 'request_consumables', 'borrow_tools'],
    external: ['book_lab', 'request_consumables']
  };
  return permissions[role] || [];
};

// Register new user (only student and external roles allowed)
const register = async (req, res) => {
  const { name, email, password, role, department_id } = req.body;

  try {
    // Validate required fields
    if (!name || !email || !password || !role || !department_id) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: name, email, password, role, department_id',
        errors: []
      });
    }

    // Validate allowed roles - only student and external are allowed for registration
    const allowedRoles = ['student', 'external'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Only "student" and "external" roles are allowed for registration',
        errors: []
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
        errors: []
      });
    }

    // Validate password strength (minimum 6 characters)
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long',
        errors: []
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists',
        errors: []
      });
    }

    // Validate department exists
    const department = await Department.findById(department_id);
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department not found',
        errors: []
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const user = new User({
      full_name: name,
      email,
      password: hashedPassword,
      role,
      department: department_id,
      is_active: true
    });

    await user.save();

    // Populate department for response
    await user.populate('department');

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        id: user._id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        department_id: user.department._id
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during registration',
      errors: []
    });
  }
};

module.exports = {
  login,
  forgotPassword,
  resetPassword,
  logout,
  getCurrentUser,
  register
}; 