const pool = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');


// Login user
const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const [users] = await pool.query(
      `SELECT u.*, d.name as department_name 
       FROM users u 
       LEFT JOIN departments d ON u.department_id = d.id 
       WHERE u.email = ?`,
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        errors: []
      });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        errors: []
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Update last login
    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.full_name,
          role: user.role,
          department_id: user.department_id,
          department_name: user.department_name,
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
    const [users] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        errors: []
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour

    await pool.query(
      'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
      [resetToken, resetTokenExpiry, users[0].id]
    );

    // Send reset email
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
    const [users] = await pool.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token',
        errors: []
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await pool.query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
      [hashedPassword, users[0].id]
    );

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
    const [users] = await pool.query(
      `SELECT u.*, d.name as department_name, d.code as department_code
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        errors: []
      });
    }

    const user = users[0];
    
    // Get user permissions based on role
    const permissions = getPermissionsByRole(user.role);

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        department_id: user.department_id,
        department: {
          id: user.department_id,
          name: user.department_name,
          code: user.department_code
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

module.exports = {
  login,
  forgotPassword,
  resetPassword,
  logout,
  getCurrentUser
}; 