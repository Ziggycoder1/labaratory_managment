const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Lab = require('../models/Lab');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No authentication token, access denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).populate('department');
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is invalid' });
  }
};

const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied: insufficient permissions' });
    }
    next();
  };
};

// Department-scoped access: admins are global; department_admin and lab_manager limited to their department(s).
const checkDepartmentAccess = async (req, res, next) => {
  try {
    // If user is super admin, allow access to all departments
    if (req.user.role === 'admin') {
      // Provide empty scope to signal global access
      req.departmentScope = { global: true, departmentId: null, labIds: [] };
      return next();
    }

    // Department-scoped roles: department_admin and lab_manager
    if (req.user.role === 'department_admin' || req.user.role === 'lab_manager') {
      const resourceDepartmentId = req.params.department_id || req.body.department_id || req.query.department_id || req.query.department;

      // Build department scope from either single `department` or multi `departments`
      const deptIds = [];
      if (req.user.department?._id) deptIds.push(req.user.department._id.toString());
      if (Array.isArray(req.user.departments)) {
        for (const d of req.user.departments) {
          if (d) deptIds.push(d.toString());
        }
      }

      // Deduplicate
      const uniqueDeptIds = [...new Set(deptIds)];
      if (uniqueDeptIds.length === 0) {
        return res.status(400).json({ message: 'User has no department assigned' });
      }

      // Pre-compute labs belonging to the user's department(s) for downstream filters
      const labs = await Lab.find({ department: { $in: uniqueDeptIds } }).select('_id');
      const labIds = labs.map(l => l._id);
      req.departmentScope = { global: false, departmentIds: uniqueDeptIds, labIds };
      req.departmentFilter = { department: { $in: uniqueDeptIds } };

      // If a department was explicitly requested, enforce it matches the user's department(s)
      if (resourceDepartmentId && !uniqueDeptIds.map(String).includes(resourceDepartmentId.toString())) {
        return res.status(403).json({ 
          message: 'Access denied: you can only access resources from your department' 
        });
      }
    }

    next();
  } catch (error) {
    console.error('Department access check error:', error);
    res.status(500).json({ message: 'Error checking department access' });
  }
};

module.exports = { auth, checkRole, checkDepartmentAccess }; 