const User = require('../models/User');
const Department = require('../models/Department');
const bcrypt = require('bcryptjs');

// Get all users with pagination and filters
const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const filter = {};
    if (req.query.role) filter.role = req.query.role;
    if (req.query.department_id) filter.department = req.query.department_id;
    if (req.query.search) {
      filter.$or = [
        { full_name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    }
    const totalCount = await User.countDocuments(filter);
    const users = await User.find(filter)
      .populate('department', 'name')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    res.json({
      success: true,
      data: {
        users: users.map(user => ({
          id: user._id,
          name: user.full_name,
          email: user.email,
          role: user.role,
          department_id: user.department?._id,
          department_name: user.department?.name,
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
    const user = await User.findById(req.params.id).populate('department', 'name');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        errors: []
      });
    }
    // For statistics, bookings, and borrowed items, you would need to implement those collections/models in MongoDB
    res.json({
      success: true,
      data: {
        id: user._id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        department_id: user.department?._id,
        department: {
          id: user.department?._id,
          name: user.department?.name
        },
        is_active: user.is_active,
        created_at: user.created_at,
        recent_bookings: [], // Placeholder
        borrowed_items: [], // Placeholder
        statistics: {} // Placeholder
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
  if (!full_name || !email || !password || !role || !department_id) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required',
      errors: []
    });
  }
  const validRoles = ['admin', 'lab_manager', 'teacher', 'student', 'external'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid role',
      errors: []
    });
  }
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
        errors: []
      });
    }
    const department = await Department.findById(department_id);
    if (!department) {
      return res.status(400).json({
        success: false,
        message: 'Department not found',
        errors: []
      });
    }
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = await User.create({
      full_name,
      email,
      password: hashedPassword,
      role,
      department: department_id
    });
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: user._id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        department_id: user.department
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
    const existingUser = await User.findOne({ email, _id: { $ne: userId } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
        errors: []
      });
    }
    await User.findByIdAndUpdate(userId, {
      full_name: name,
      email,
      role,
      department: department_id,
      is_active
    });
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
  const userId = req.params.id;
  try {
    await User.findByIdAndUpdate(userId, { is_active: false });
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