const Permission = require('../models/Permission');

// GET /api/permissions
exports.getAllPermissions = async (req, res, next) => {
  try {
    const permissions = await Permission.find().lean();
    const data = permissions.map((p, idx) => ({
      id: p._id,
      name: p.name,
      description: p.description,
      module: p.module
    }));
    res.json({ success: true, data });
  } catch (error) {
    error.message = 'Error fetching permissions: ' + error.message;
    next(error);
  }
}; 