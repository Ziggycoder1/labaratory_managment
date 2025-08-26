const mongoose = require('mongoose');
const Department = require('../models/Department');
const Lab = require('../models/Lab');
const User = require('../models/User');
const { sendDepartmentNotification } = require('../utils/notifications');

// Get all departments with labs_count and users_count
const getAllDepartments = async (req, res) => {
  try {
    // Aggregate labs_count and users_count for each department
    const departments = await Department.aggregate([
      {
        $lookup: {
          from: 'labs',
          localField: '_id',
          foreignField: 'department',
          as: 'labs'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'department',
          as: 'users'
        }
      },
      {
        $addFields: {
          labs_count: { $size: '$labs' },
          users_count: { $size: '$users' }
        }
      },
      {
        $project: {
          labs: 0,
          users: 0
        }
      }
    ]);
    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching departments'
    });
  }
};

// Create new department
const createDepartment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { name, code, description, head_of_department, contact_email, contact_phone } = req.body;

    // Check if department with same name or code already exists
    const existingDept = await Department.findOne({
      $or: [
        { name: { $regex: new RegExp(`^${name}$`, 'i') } },
        { code: { $regex: new RegExp(`^${code}$`, 'i') } }
      ]
    }).session(session);

    if (existingDept) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Department with this name or code already exists'
      });
    }

    // Create new department
    const department = new Department({
      name,
      code: code.toUpperCase(),
      description,
      head_of_department,
      contact_email,
      contact_phone,
      created_by: req.user.id,
      updated_by: req.user.id
    });

    await department.save({ session });

    // Send notification about department creation
    await sendDepartmentNotification(
      department,
      req.user,
      'created',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: department
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Create department error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating department',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Get department by ID
const getDepartmentById = async (req, res) => {
  try {
    const department = await Department.findById(req.params.id);
    if (!department) {
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }
    res.json({
      success: true,
      data: department
    });
  } catch (error) {
    console.error('Error fetching department:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching department'
    });
  }
};

// Update department
const updateDepartment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { name, code, description, head_of_department, contact_email, contact_phone, is_active } = req.body;

    // Find the department
    const department = await Department.findById(id).session(session);
    if (!department) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    // Check for duplicate name or code if being updated
    if (name || code) {
      const query = {
        _id: { $ne: id },
        $or: []
      };
      
      if (name) query.$or.push({ name: { $regex: new RegExp(`^${name}$`, 'i') } });
      if (code) query.$or.push({ code: { $regex: new RegExp(`^${code}$`, 'i') } });
      
      if (query.$or.length > 0) {
        const existingDept = await Department.findOne(query).session(session);
        if (existingDept) {
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: 'Another department with this name or code already exists'
          });
        }
      }
    }

    // Update department fields
    if (name) department.name = name;
    if (code) department.code = code.toUpperCase();
    if (description !== undefined) department.description = description;
    if (head_of_department !== undefined) department.head_of_department = head_of_department;
    if (contact_email !== undefined) department.contact_email = contact_email;
    if (contact_phone !== undefined) department.contact_phone = contact_phone;
    if (is_active !== undefined) department.is_active = is_active;
    
    department.updated_by = req.user.id;
    department.updated_at = new Date();

    await department.save({ session });

    // Send notification about department update
    await sendDepartmentNotification(
      department,
      req.user,
      'updated',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'Department updated successfully',
      data: department
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Update department error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating department',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Delete department
const deleteDepartment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;

    // Find the department
    const department = await Department.findById(id).session(session);
    if (!department) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Department not found'
      });
    }

    // Check if department has associated labs
    const labCount = await Lab.countDocuments({ department: id, is_deleted: false }).session(session);
    if (labCount > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Cannot delete department with associated labs. Please reassign or delete the labs first.'
      });
    }

    // Check if department has associated users
    const userCount = await User.countDocuments({ department: id, status: 'active' }).session(session);
    if (userCount > 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Cannot delete department with associated users. Please reassign or deactivate the users first.'
      });
    }

    // Store department data for notification before deletion
    const departmentData = {
      _id: department._id,
      name: department.name,
      code: department.code
    };

    // Delete the department
    await Department.findByIdAndDelete(id).session(session);

    // Send notification about department deletion
    await sendDepartmentNotification(
      departmentData,
      req.user,
      'deleted',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'Department deleted successfully'
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Delete department error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting department',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

// Get all departments (public endpoint - no authentication required)
const getPublicDepartments = async (req, res) => {
  try {
    // Only return basic department info (no sensitive data)
    const departments = await Department.find({}, 'name code description')
      .sort({ name: 1 });
      
    res.json({
      success: true,
      data: departments
    });
  } catch (error) {
    console.error('Error fetching public departments:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching departments'
    });
  }
};

module.exports = {
  getAllDepartments,
  getPublicDepartments,
  createDepartment,
  getDepartmentById,
  updateDepartment,
  deleteDepartment
};