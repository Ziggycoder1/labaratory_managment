const Lab = require('../models/Lab');
const Department = require('../models/Department');
const Field = require('../models/Field');

// Get all labs with filters
const getAllLabs = async (req, res) => {
  try {
    const { department_id, available_only } = req.query;
    const filter = {};
    if (req.user && req.user.role === 'department_admin') {
      filter.department = req.user.department._id;
    } else if (department_id) {
      filter.department = department_id;
    }
    if (available_only === 'true') {
      filter.is_active = true;
      filter.status = 'active';
    }
    // Only fetch labs that have a department set
    filter.department = { $exists: true, $ne: null, ...(filter.department && { $eq: filter.department }) };

    const labs = await Lab.find(filter)
      .populate('department', 'name')
      .populate('fields', 'name code')
      .lean();

    // Only include labs with a valid department for department_admin
    let formattedLabs = labs;
    if (req.user && req.user.role === 'department_admin') {
      formattedLabs = labs.filter(lab => lab.department && lab.department._id && lab.department._id.toString() === req.user.department._id.toString());
    }
    formattedLabs = formattedLabs.map(lab => ({
      id: lab._id,
      name: lab.name,
      code: lab.code,
      department_id: lab.department?._id,
      department_name: lab.department?.name,
      capacity: lab.capacity,
      location: lab.location,
      description: lab.description,
      is_active: lab.is_active,
      equipment_count: 0, // Placeholder
      available_fields: lab.fields || [],
      current_availability: lab.status,
      next_booking: null // Placeholder
    }));

    res.json({
      success: true,
      data: formattedLabs
    });
  } catch (error) {
    console.error('Get all labs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching labs',
      errors: [error.message]
    });
  }
};

// Get specific lab details
const getLabById = async (req, res) => {
  try {
    const lab = await Lab.findById(req.params.id)
      .populate('department', 'name')
      .populate('fields', 'name code')
      .lean();
    if (!lab) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }
    res.json({
      success: true,
      data: {
        id: lab._id,
        name: lab.name,
        code: lab.code,
        department_id: lab.department?._id,
        department: {
          id: lab.department?._id,
          name: lab.department?.name
        },
        capacity: lab.capacity,
        location: lab.location,
        description: lab.description,
        is_active: lab.is_active,
        created_at: lab.createdAt,
        available_fields: lab.fields || [],
        equipment: [], // Placeholder
        recent_bookings: [], // Placeholder
        statistics: {} // Placeholder
      }
    });
  } catch (error) {
    console.error('Get lab by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching lab details',
      errors: [error.message]
    });
  }
};

// Check lab availability (stub)
const checkLabAvailability = async (req, res) => {
  try {
    // Implement logic as needed
    res.json({ success: true, available: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error checking availability', errors: [error.message] });
  }
};

// Create new lab
const createLab = async (req, res) => {
  try {
    const { name, code, department, capacity, location, description, fields } = req.body;
    const lab = await Lab.create({
      name,
      code,
      department,
      capacity,
      location,
      description,
      fields
    });
    res.status(201).json({
      success: true,
      message: 'Lab created successfully',
      data: lab
    });
  } catch (error) {
    console.error('Create lab error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating lab',
      errors: [error.message]
    });
  }
};

// Update lab
const updateLab = async (req, res) => {
  try {
    const labId = req.params.id;
    const updateData = req.body;
    const updatedLab = await Lab.findByIdAndUpdate(labId, updateData, { new: true });
    if (!updatedLab) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }
    res.json({
      success: true,
      message: 'Lab updated successfully',
      data: updatedLab
    });
  } catch (error) {
    console.error('Update lab error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating lab',
      errors: [error.message]
    });
  }
};

// Delete lab
const deleteLab = async (req, res) => {
  try {
    const labId = req.params.id;
    const deletedLab = await Lab.findByIdAndDelete(labId);
    if (!deletedLab) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }
    res.json({
      success: true,
      message: 'Lab deleted successfully'
    });
  } catch (error) {
    console.error('Delete lab error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting lab',
      errors: [error.message]
    });
  }
};

module.exports = {
  getAllLabs,
  getLabById,
  checkLabAvailability,
  createLab,
  updateLab,
  deleteLab
}; 