const express = require('express');
const router = express.Router();
const { auth, checkRole, checkDepartmentAccess } = require('../middleware/auth.middleware');
const { body, param, query, validationResult } = require('express-validator');
const Lab = require('../models/Lab');
const {
  getAllLabs,
  getLabById,
  createLab,
  updateLab,
  deleteLab,
  updateLabStatus,
  addEquipmentToLab,
  logMaintenance,
  getLabStatistics,
  checkLabAvailability
} = require('../controllers/labController');

// Import assignment routes
const assignmentRoutes = require('./labAssignmentRoutes');

// Enhanced checkDepartmentAccess that works with async/await
const enhancedCheckDepartmentAccess = async (req, res, next) => {
  try {
    // Get the lab ID from the request
    const labId = req.params.id;
    
    // If no lab ID is provided, proceed (might be a create operation)
    if (!labId) return next();
    
    // Find the lab
    const lab = await Lab.findById(labId);
    
    if (!lab) {
      return res.status(404).json({ 
        message: 'Lab not found',
        errorType: 'not_found'
      });
    }
    
    // Check if user has access to this lab's department
    if (req.user.role !== 'admin' && 
        !req.user.departments.includes(lab.department.toString())) {
      return res.status(403).json({ 
        message: 'You do not have permission to access this lab',
        errorType: 'forbidden'
      });
    }
    
    // Attach the lab to the request for later use
    req.lab = lab;
    next();
  } catch (error) {
    console.error('Error in enhancedCheckDepartmentAccess:', error);
    next(error);
  }
};

// Validation middleware
const validateRequest = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    return res.status(400).json({
      message: 'Validation failed',
      errorType: 'validation_error',
      errors: errors.array()
    });
  };
};

// Validation middleware
const validateLabStatus = [
  body('status')
    .isIn(['active', 'maintenance', 'inactive', 'available', 'booked'])
    .withMessage('Invalid status value'),
  body('notes').optional().isString().trim()
];

const validateEquipment = [
  body('equipment_id')
    .isMongoId()
    .withMessage('Valid equipment ID is required'),
  body('quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer'),
  body('notes').optional().isString().trim()
];

const validateMaintenance = [
  body('type')
    .isIn(['preventive', 'corrective', 'inspection', 'other'])
    .withMessage('Invalid maintenance type'),
  body('description')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Description is required'),
  body('start_time')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  body('end_time')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
  body('technician').optional().isString().trim(),
  body('cost').optional().isFloat({ min: 0 }),
  body('parts_replaced').optional().isArray()
];

// Validation rules for labs endpoint
const labQueryValidations = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1 }).withMessage('Limit must be a positive integer'),
  query('status').optional().isIn(['active', 'inactive', 'maintenance', 'available', 'booked']).withMessage('Invalid status value'),
  query('department').optional().isMongoId().withMessage('Invalid department ID'),
  query('search').optional().isString().trim(),
  query('available_only').optional().isBoolean().withMessage('available_only must be a boolean'),
  query('field_id').optional().isMongoId().withMessage('Invalid field ID')
];

// Main labs endpoint with filtering and pagination (protected for scoped listing)
router.get('/',
  labQueryValidations,
  (req, res, next) => {
    console.log('=== GET /api/labs ===');
    console.log('Query params:', req.query);
    next();
  },
  auth,
  checkRole(['admin', 'department_admin', 'lab_manager', 'teacher', 'student', 'external_user']),
  checkDepartmentAccess,
  validateRequest(labQueryValidations),
  getAllLabs
);

// Test endpoints (kept for debugging)
router.get('/test', (req, res) => {
  console.log('GET /api/labs/test endpoint hit');
  res.json({ 
    message: 'Test endpoint is working!',
    timestamp: new Date().toISOString(),
    method: 'GET'
  });
});

router.post('/test', (req, res) => {
  console.log('POST /api/labs/test endpoint hit', { body: req.body });
  res.json({ 
    message: 'Test POST endpoint is working!',
    timestamp: new Date().toISOString(),
    method: 'POST',
    body: req.body
  });
});

// Lab availability check (public)
router.get('/:id/availability', 
  [
    param('id').isMongoId().withMessage('Invalid lab ID'),
    query('start_time').isISO8601().withMessage('Valid start time is required'),
    query('end_time').isISO8601().withMessage('Valid end time is required')
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errorType: 'validation_error',
        errors: errors.array()
      });
    }
    next();
  },
  checkLabAvailability
);

// Protected routes (require authentication)
router.use(auth);

// Lab statistics (available to lab managers and above)
router.get('/:id/stats',
  checkRole(['admin', 'department_admin', 'lab_manager']),
  checkDepartmentAccess,
  [
    param('id').isMongoId().withMessage('Invalid lab ID'),
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601()
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errorType: 'validation_error',
        errors: errors.array()
      });
    }
    next();
  },
  getLabStatistics
);



// Lab assignment routes (nested under /:labId/assignments)
router.use('/:labId/assignments', assignmentRoutes);

// Debug endpoint to test lab creation
router.post('/debug-create', (req, res) => {
  console.log('=== DEBUG LAB CREATION ===');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('User:', req.user);
  console.log('Method:', req.method);
  console.log('Original URL:', req.originalUrl);
  console.log('==========================');
  
  res.json({
    success: true,
    message: 'Debug endpoint hit',
    headers: req.headers,
    body: req.body,
    user: req.user,
    method: req.method,
    originalUrl: req.originalUrl
  });
});

// Lab creation route handler with proper middleware chaining and error handling
const createLabHandler = [
  // Logging middleware
  (req, res, next) => {
    console.log('=== LAB CREATION REQUEST ===');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    console.log('User:', req.user);
    console.log('===========================');
    next();
  },
  
  // Role-based access control
  (req, res, next) => {
    checkRole(['admin', 'department_admin', 'lab_manager'])(req, res, (err) => {
      if (err) return next(err);
      console.log('After checkRole - User has required role');
      next();
    });
  },
  
  // Department access control
  (req, res, next) => {
    checkDepartmentAccess(req, res, (err) => {
      if (err) return next(err);
      console.log('After checkDepartmentAccess - User has department access');
      next();
    });
  },
  
  // Request validation
  [
    body('name').isString().trim().notEmpty().withMessage('Lab name is required'),
    body('code').isString().trim().notEmpty().withMessage('Lab code is required'),
    body('department').isMongoId().withMessage('Valid department ID is required'),
    body('capacity').isInt({ min: 1 }).withMessage('Capacity must be at least 1'),
    body('status').optional().isIn(['active', 'maintenance', 'inactive']).withMessage('Invalid status value'),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean')
  ],
  
  // Validate request
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation failed:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(err => err.msg)
      });
    }
    console.log('After validateRequest - Request is valid');
    next();
  },
  
  // Handle lab creation with better error handling
  async (req, res, next) => {
    try {
      // First check if lab with same code exists
      const existingLab = await Lab.findOne({ code: req.body.code });
      if (existingLab) {
        return res.status(400).json({
          success: false,
          message: 'Lab creation failed',
          errors: ['A lab with this code already exists. Please use a unique code.']
        });
      }
      
      // If no duplicate, proceed with creation
      await createLab(req, res);
    } catch (error) {
      console.error('Error in createLab controller:', error);
      
      // Handle duplicate key error
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Lab creation failed',
          errors: ['A lab with this code already exists. Please use a unique code.']
        });
      }
      
      // Handle validation errors
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: Object.values(error.errors).map(err => err.message)
        });
      }
      
      // Pass other errors to the error handler
      next(error);
    }
  },
  
  // Error handling middleware
  (err, req, res, next) => {
    console.error('Lab creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  }
];

// Register routes - prioritize /create endpoint
router.post('/create', createLabHandler);
router.post('/', createLabHandler); // Keep root route for backward compatibility

router.get('/:id', 
  checkRole(['admin', 'department_admin', 'lab_manager']), 
  checkDepartmentAccess,
  [param('id').isMongoId().withMessage('Invalid lab ID')],
  validateRequest,
  getLabById
);

// Update lab route with enhanced error handling and logging
router.put('/:id', 
  // Debug logging
  (req, res, next) => {
    console.log('=== UPDATE LAB REQUEST ===');
    console.log('Params:', req.params);
    console.log('Body:', req.body);
    console.log('User:', req.user);
    console.log('==========================');
    next();
  },
  
  // Authentication
  auth,
  
  // Role-based access control
  checkRole(['admin', 'department_admin', 'lab_manager']), 
  
  // Department access control
  enhancedCheckDepartmentAccess,
  
  // Request validation
  [
    param('id').isMongoId().withMessage('Invalid lab ID'),
    body('name').optional().isString().trim().notEmpty(),
    body('code').optional().isString().trim().notEmpty(),
    body('department').optional().isMongoId(),
    body('capacity').optional().isInt({ min: 1 })
  ],
  
  // Validate request
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation failed:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(err => err.msg)
      });
    }
    next();
  },
  
  // Handle the update
  async (req, res, next) => {
    try {
      console.log('Calling updateLab controller...');
      await updateLab(req, res);
    } catch (error) {
      console.error('Error in update route:', error);
      
      // Handle duplicate key error
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'Update failed',
          errors: ['A lab with this code already exists. Please use a unique code.']
        });
      }
      
      // Handle validation errors
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: Object.values(error.errors).map(err => err.message)
        });
      }
      
      // Pass other errors to the error handler
      next(error);
    }
  }
);

// Debug middleware to log request info
const debugRequest = (req, res, next) => {
  console.log('=== DEBUG REQUEST ===');
  console.log('Method:', req.method);
  console.log('URL:', req.originalUrl);
  console.log('Headers:', req.headers);
  console.log('Params:', req.params);
  console.log('User:', req.user || 'No user');
  console.log('====================');
  next();
};

// Wrapper to handle async middleware errors
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};



// Test route - minimal implementation
router.delete('/:id', 
  // Debug logging
  (req, res, next) => {
    console.log('=== DELETE ROUTE HIT ===');
    console.log('Params:', req.params);
    next();
  },
  
  // Authentication
  auth,
  
  // Role-based access control
  checkRole(['admin', 'department_admin', 'lab_manager']),
  
  // Department access control
  enhancedCheckDepartmentAccess,
  
  // Validate param
  [param('id').isMongoId().withMessage('Invalid lab ID')],
  validateRequest,
   
  // Directly call the controller
  async (req, res) => {
    try {
      console.log('=== CALLING DELETE LAB CONTROLLER ===');
      await deleteLab(req, res);
    } catch (error) {
      console.error('Error in delete route:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: error.message
      });
    }
  }
);

// Lab status management (admin and department admins)
router.patch('/:id/status',
  checkRole(['admin', 'department_admin']),
  checkDepartmentAccess,
  [param('id').isMongoId().withMessage('Invalid lab ID')],
  validateRequest,
  validateLabStatus,
  updateLabStatus
);

// Equipment management (lab managers and above)
router.post('/:id/equipment',
  checkRole(['admin', 'department_admin', 'lab_manager']),
  checkDepartmentAccess,
  [param('id').isMongoId().withMessage('Invalid lab ID')],
  validateRequest,
  validateEquipment,
  addEquipmentToLab
);

// Maintenance logging (lab managers and above)
router.post('/:id/maintenance',
  checkRole(['admin', 'department_admin', 'lab_manager']),
  checkDepartmentAccess,
  [param('id').isMongoId().withMessage('Invalid lab ID')],
  validateRequest,
  validateMaintenance,
  logMaintenance
);

module.exports = router;