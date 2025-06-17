const pool = require('../config/database');

// Get all departments
const getAllDepartments = async (req, res) => {
  try {
    const [departments] = await pool.query(`
      SELECT 
        d.*,
        COUNT(DISTINCT l.id) as labs_count,
        COUNT(DISTINCT u.id) as users_count
      FROM departments d
      LEFT JOIN labs l ON d.id = l.department_id
      LEFT JOIN users u ON d.id = u.department_id
      GROUP BY d.id
    `);

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
    const [result] = await pool.query(
      'INSERT INTO departments (name, code, description) VALUES (?, ?, ?)',
      [name, code, description]
    );

    const [newDepartment] = await pool.query(
      'SELECT * FROM departments WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      data: newDepartment[0]
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