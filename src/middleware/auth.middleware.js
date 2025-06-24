const jwt = require('jsonwebtoken');
const User = require('../models/User');

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

// New middleware to check department access
const checkDepartmentAccess = async (req, res, next) => {
  try {
    // If user is super admin, allow access to all departments
    if (req.user.role === 'admin') {
      return next();
    }

    // For department admin, check if they're accessing their own department
    if (req.user.role === 'department_admin') {
      const resourceDepartmentId = req.params.department_id || req.body.department_id || req.query.department_id;
      
      if (!resourceDepartmentId) {
        // If no department specified, only allow if it's their own department
        req.departmentFilter = { department: req.user.department._id };
        return next();
      }

      if (resourceDepartmentId.toString() !== req.user.department._id.toString()) {
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