const pool = require('../config/database');
const bcrypt = require('bcryptjs');

// Get all users with pagination and filters
const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT u.*, d.name as department_name
      FROM users u
      LEFT JOIN departments d ON u.department_id = d.id
      WHERE 1=1
    `;
    const queryParams = [];

    // Apply filters
    if (req.query.role) {
      query += ' AND u.role = ?';
      queryParams.push(req.query.role);
    }
    if (req.query.department_id) {
      query += ' AND u.department_id = ?';
      queryParams.push(req.query.department_id);
    }
    if (req.query.search) {
      query += ' AND (u.full_name LIKE ? OR u.email LIKE ?)';
      const searchTerm = `%${req.query.search}%`;
      queryParams.push(searchTerm, searchTerm);
    }

    // Get total count
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM (${query}) as filtered`,
      queryParams
    );
    const totalCount = countResult[0].total;

    // Get paginated results
    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    const [users] = await pool.query(query, queryParams);

    res.json({
      success: true,
      data: {
        users: users.map(user => ({
          id: user.id,
          name: user.full_name,
          email: user.email,
          role: user.role,
          department_id: user.department_id,
          department_name: user.department_name,
          is_active: user.is_active,
          created_at: user.created_at,
          last_login: user.last_login
        })),
        pagination: {
          current_page: page,
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: limit
        }
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users',
      errors: []
    });
  }
};

// Get specific user
const getUserById = async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT u.*, d.name as department_name
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       WHERE u.id = ?`,
      [req.params.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        errors: []
      });
    }

    const user = users[0];

    // Get user statistics
    const [stats] = await pool.query(
      `SELECT 
        COUNT(DISTINCT b.id) as total_bookings,
        COUNT(DISTINCT CASE WHEN bl.status = 'borrowed' THEN bl.id END) as active_borrowings,
        COUNT(DISTINCT CASE WHEN b.status = 'approved' THEN b.id END) as completed_sessions
       FROM users u
       LEFT JOIN bookings b ON u.id = b.user_id
       LEFT JOIN borrow_logs bl ON u.id = bl.user_id
       WHERE u.id = ?`,
      [req.params.id]
    );

    // Get recent bookings
    const [recentBookings] = await pool.query(
      `SELECT id, lab_id, start_time, end_time, status
       FROM bookings
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 5`,
      [req.params.id]
    );

    // Get borrowed items
    const [borrowedItems] = await pool.query(
      `SELECT bl.*, i.name as item_name
       FROM borrow_logs bl
       JOIN items i ON bl.item_id = i.id
       WHERE bl.user_id = ? AND bl.status = 'borrowed'
       ORDER BY bl.borrow_date DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        department_id: user.department_id,
        department: {
          id: user.department_id,
          name: user.department_name
        },
        is_active: user.is_active,
        created_at: user.created_at,
        recent_bookings: recentBookings,
        borrowed_items: borrowedItems,
        statistics: stats[0]
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      errors: []
    });
  }
};

// Create new user
const createUser = async (req, res) => {
  const { full_name, email, password, role, department_id } = req.body;

  // Validate required fields
  if (!full_name || !email || !password || !role || !department_id) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required',
      errors: []
    });
  }

  // Validate role
  const validRoles = ['admin', 'lab_manager', 'teacher', 'student', 'external'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid role',
      errors: []
    });
  }

  try {
    // Check if email exists
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
        errors: []
      });
    }

    // Check if department exists
    const [departments] = await pool.query('SELECT id FROM departments WHERE id = ?', [department_id]);
    if (departments.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Department not found',
        errors: []
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user with all schema fields
    const [result] = await pool.query(
      `INSERT INTO users (
        full_name, 
        email, 
        password, 
        role, 
        department_id, 
        is_active,
        reset_token,
        reset_token_expiry,
        last_login
      ) VALUES (?, ?, ?, ?, ?, true, NULL, NULL, NULL)`,
      [full_name, email, hashedPassword, role, department_id]
    );

    // Get the created user with department info
    const [newUser] = await pool.query(
      `SELECT u.*, d.name as department_name 
       FROM users u 
       LEFT JOIN departments d ON u.department_id = d.id 
       WHERE u.id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: newUser[0].id,
        full_name: newUser[0].full_name,
        email: newUser[0].email,
        role: newUser[0].role,
        department_id: newUser[0].department_id,
        department_name: newUser[0].department_name,
        is_active: newUser[0].is_active,
        reset_token: newUser[0].reset_token,
        reset_token_expiry: newUser[0].reset_token_expiry,
        last_login: newUser[0].last_login,
        created_at: newUser[0].created_at,
        updated_at: newUser[0].updated_at
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user',
      errors: []
    });
  }
};

// Update user
const updateUser = async (req, res) => {
  const { name, email, role, department_id, is_active } = req.body;
  const userId = req.params.id;

  try {
    // Check if email exists for other users
    const [existingUsers] = await pool.query(
      'SELECT id FROM users WHERE email = ? AND id != ?',
      [email, userId]
    );
    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
        errors: []
      });
    }

    // Update user
    await pool.query(
      `UPDATE users 
       SET full_name = ?, email = ?, role = ?, department_id = ?, is_active = ?
       WHERE id = ?`,
      [name, email, role, department_id, is_active, userId]
    );

    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        id: userId,
        name,
        email,
        role,
        department_id
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      errors: []
    });
  }
};

// Deactivate user
const deactivateUser = async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET is_active = false WHERE id = ?',
      [req.params.id]
    );

    res.json({
      success: true,
      message: 'User deactivated successfully'
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deactivating user',
      errors: []
    });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deactivateUser
}; 