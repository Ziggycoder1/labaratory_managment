const User = require('../models/User');
const Department = require('../models/Department');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { sendUserNotification } = require('../utils/notifications');

// Get all users with pagination and filters
const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Build filter object
    const filter = {};
    
    // Role-based filtering
    if (req.query.role) filter.role = req.query.role;
    
    // Department filtering
    if (req.user.role === 'department_admin') {
      // Department admins can only see users from their department
      filter.department = req.user.department._id;
    } else if (req.query.department_id) {
      // Other roles can filter by department if specified
      filter.department = req.query.department_id;
    }
    
    // Search filtering
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
        phone: user.phone || null,
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
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { full_name, email, role, department_id, ...otherFields } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Check department exists if provided
    if (department_id) {
      const department = await Department.findById(department_id).session(session);
      if (!department) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Department not found'
        });
      }
    }

    // Create user
    const newUser = new User({
      full_name,
      email,
      role: role || 'student',
      department: department_id,
      ...otherFields,
      created_by: req.user.id,
      updated_by: req.user.id
    });

    // If password is not provided, generate a temporary one
    if (!req.body.password) {
      const tempPassword = Math.random().toString(36).slice(-8);
      const salt = await bcrypt.genSalt(10);
      newUser.password = await bcrypt.hash(tempPassword, salt);
      newUser.temp_password = tempPassword; // Store plain text temp password for email
    } else {
      const salt = await bcrypt.genSalt(10);
      newUser.password = await bcrypt.hash(req.body.password, 10);
    }

    await newUser.save({ session });

    // Send notification about user creation
    await sendUserNotification(
      newUser,
      req.user,
      'created',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // In production, you would send an email with the temporary password here
    // await sendWelcomeEmail(newUser.email, newUser.full_name, newUser.temp_password);

    // Don't send password back in response
    const userResponse = newUser.toObject();
    delete userResponse.password;
    delete userResponse.temp_password;

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: userResponse
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Create user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Update user
const updateUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { full_name, email, role, department_id, status, ...otherFields } = req.body;

    // Check if user exists
    const user = await User.findById(id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if email is being changed and if it's already taken
    if (email && email !== user.email) {
      const emailExists = await User.findOne({ email }).session(session);
      if (emailExists) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
      }
      user.email = email;
    }

    // Check department exists if provided
    if (department_id && department_id !== user.department?.toString()) {
      const department = await Department.findById(department_id).session(session);
      if (!department) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Department not found'
        });
      }
      user.department = department_id;
    }

    // Update user fields
    if (full_name) user.full_name = full_name;
    if (role) user.role = role;
    if (status !== undefined) user.status = status;
    
    // Update other fields if provided
    Object.keys(otherFields).forEach(key => {
      user[key] = otherFields[key];
    });

    user.updated_by = req.user.id;
    user.updated_at = new Date();

    await user.save({ session });

    // Send notification about user update
    await sendUserNotification(
      user,
      req.user,
      'updated',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // Don't send password back in response
    const userResponse = user.toObject();
    delete userResponse.password;
    delete userResponse.temp_password;

    res.json({
      success: true,
      message: 'User updated successfully',
      data: userResponse
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Toggle user status
const toggleUserStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (status === undefined) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const user = await User.findById(id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldStatus = user.status;
    user.status = status;
    user.updated_by = req.user.id;
    user.updated_at = new Date();

    await user.save({ session });

    // Send notification about status change
    await sendUserNotification(
      user,
      req.user,
      'status_changed',
      { 
        oldStatus,
        newStatus: status,
        session 
      }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: `User ${status === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: {
        id: user._id,
        status: user.status
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Toggle user status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating user status',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Deactivate user (soft delete)
const deactivateUser = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;

    // Prevent deactivating own account
    if (id === req.user.id) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { is_active: false, deactivated_at: new Date() },
      { new: true, session }
    );

    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Send notification about user deactivation
    await sendUserNotification(
      user,
      req.user,
      'deactivated',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'User deactivated successfully',
      data: {
        id: user._id,
        email: user.email,
        is_active: user.is_active,
        deactivated_at: user.deactivated_at
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Deactivate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deactivating user',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Permanently delete a user (admin only)
const deleteUserPermanently = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;

    // Prevent deleting own account
    if (id === req.user.id) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    const user = await User.findById(id).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Store user data for notification before deletion
    const userData = {
      _id: user._id,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    };

    // Delete the user
    await User.findByIdAndDelete(id).session(session);

    // Send notification about user deletion
    await sendUserNotification(
      userData, // Pass the user data since the user is already deleted
      req.user,
      'deleted',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'User permanently deleted successfully'
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting user',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  deactivateUser,
  deleteUserPermanently
};