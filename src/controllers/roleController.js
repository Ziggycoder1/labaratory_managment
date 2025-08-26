const Role = require('../models/Role');
const Permission = require('../models/Permission');

// GET /api/roles
exports.getAllRoles = async (req, res, next) => {
  try {
    const roles = await Role.find().populate('permissions').lean();
    const data = roles.map((r) => ({
      id: r._id,
      name: r.name,
      display_name: r.display_name,
      description: r.description,
      permissions: (r.permissions || []).map(p => ({
        id: p._id,
        name: p.name
      }))
    }));
    res.json({ success: true, data });
  } catch (error) {
    error.message = 'Error fetching roles: ' + error.message;
    next(error);
  }
}; 