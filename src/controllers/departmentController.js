const Department = require('../models/Department');
const Lab = require('../models/Lab');
const User = require('../models/User');

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
  const { name, code, description } = req.body;
  try {
    const department = await Department.create({ name, code, description });
    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: department
    });
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating department'
    });
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
  const { name, code, description } = req.body;
  try {
    console.log('Updating department with ID:', req.params.id);
    console.log('Update data:', { name, code, description });
    
    const department = await Department.findByIdAndUpdate(
      req.params.id,
      { name, code, description },
      { new: true, runValidators: true }
    );

    if (!department) {
      console.log('Department not found with ID:', req.params.id);
      return res.status(404).json({
        status: 'error',
        message: 'Department not found',
        success: false
      });
    }

    console.log('Department updated successfully:', department);
    res.json({
      status: 'success',
      message: 'Department updated successfully',
      success: true,
      data: department
    });
  } catch (error) {
    console.error('Error updating department:', error);
    res.status(500).json({
      status: 'error',
      success: false,
      message: 'Error updating department',
      error: error.message
    });
  }
};

// Delete department
const deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Attempting to delete department with ID:', id);
    
    // Check if department exists
    const department = await Department.findById(id);
    if (!department) {
      console.log('Department not found with ID:', id);
      return res.status(404).json({
        status: 'error',
        success: false,
        message: 'Department not found'
      });
    }

    // Check if department has associated labs or users
    const [labsCount, usersCount] = await Promise.all([
      Lab.countDocuments({ department: id }),
      User.countDocuments({ department: id })
    ]);

    if (labsCount > 0 || usersCount > 0) {
      console.log(`Cannot delete department: ${labsCount} labs and ${usersCount} users are associated`);
      return res.status(400).json({
        status: 'error',
        success: false,
        message: 'Cannot delete department with associated labs or users',
        data: {
          hasLabs: labsCount > 0,
          hasUsers: usersCount > 0
        }
      });
    }

    // Delete the department
    await Department.findByIdAndDelete(id);
    console.log('Department deleted successfully:', id);

    res.json({
      status: 'success',
      success: true,
      message: 'Department deleted successfully',
      data: { id }
    });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({
      status: 'error',
      success: false,
      message: 'Error deleting department',
      error: error.message
    });
  }
};

module.exports = {
  getAllDepartments,
  createDepartment,
  getDepartmentById,
  updateDepartment,
  deleteDepartment
};