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

module.exports = {
  getAllDepartments,
  createDepartment
}; 