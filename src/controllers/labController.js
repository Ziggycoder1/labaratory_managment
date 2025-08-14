const mongoose = require('mongoose');
const Lab = require('../models/Lab');
const Department = require('../models/Department');
const Field = require('../models/Field');
const { validationResult } = require('express-validator');
const { sendLabNotification } = require('../utils/notifications');

// Helper function to format lab response
const formatLabResponse = (lab) => {
  if (!lab) return null;

  const formattedLab = lab.toObject ? lab.toObject() : lab;
  
  // Add virtuals and computed fields
  formattedLab.id = formattedLab._id;
  
  // Add full location if not already present
  if (!formattedLab.full_location && (formattedLab.building || formattedLab.room_number || formattedLab.floor != null)) {
    const parts = [];
    if (formattedLab.building) parts.push(formattedLab.building);
    if (formattedLab.room_number) parts.push(`Room ${formattedLab.room_number}`);
    if (formattedLab.floor != null) {
      parts.push(`${formattedLab.floor > 0 ? `${formattedLab.floor} Floor` : 'Basement'}`);
    }
    formattedLab.full_location = parts.join(', ');
  }

  // Add URL
  formattedLab.url = `/labs/${formattedLab._id}`;
  
  return formattedLab;
};

/**
 * @swagger
 * /api/labs:
 *   get:
 *     summary: Get all labs with optional filters
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term (searches in name, code, and description)
 *       - in: query
 *         name: department_id
 *         schema:
 *           type: string
 *         description: Filter by department ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, maintenance, inactive, booked, available]
 *         description: Filter by lab status
 *       - in: query
 *         name: available_only
 *         schema:
 *           type: boolean
 *         description: Return only available labs
 *       - in: query
 *         name: field_id
 *         schema:
 *           type: string
 *         description: Filter labs by field ID
 *     responses:
 *       200:
 *         description: List of labs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     labs:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Lab'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 */
const getAllLabs = async (req, res) => {
  console.log('=== START: getAllLabs ===');
  console.log('Request query:', req.query);
  console.log('User:', req.user ? { id: req.user._id, role: req.user.role } : 'No user');
  
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      department_id, 
      status, 
      available_only, 
      field_id 
    } = req.query;

    // Build filter
    const filter = { deleted_at: null };
    console.log('Initial filter:', filter);
    
    // Apply role-based filtering
    if (req.user && req.user.role === 'department_admin') {
      filter.department = req.user.department?._id || req.user.department;
    } else if (department_id) {
      filter.department = department_id;
    }

    // Apply status filters
    if (available_only === 'true') {
      filter.is_active = true;
      filter.$or = [
        { status: Lab.STATUS.AVAILABLE },
        { status: Lab.STATUS.ACTIVE }
      ];
    } else if (status) {
      filter.status = status;
    }

    // Apply field filter
    if (field_id) {
      filter.fields = { $in: [field_id] };
    }

    // Apply search
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Only fetch labs that have a department set
    filter.department = { $exists: true, $ne: null, ...(filter.department && { $eq: filter.department }) };
    console.log('Final filter:', JSON.stringify(filter, null, 2));

    // Execute query with pagination
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const total = await Lab.countDocuments(filter);
    const totalPages = Math.ceil(total / limitNum);

    // Execute query with pagination
    console.log('Executing query with filter:', JSON.stringify(filter, null, 2));
    const labs = await Lab.find(filter)
      .populate([
        { path: 'department', select: 'name code' },
        { path: 'fields', select: 'name code' },
        { path: 'created_by', select: 'name email' },
        { path: 'updated_by', select: 'name email' }
      ])
      .sort({ name: 1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    console.log(`Found ${labs.length} labs`);
    // Format response
    const result = {
      labs: labs.map(lab => formatLabResponse(lab)),
      pagination: {
        total: total,
        total_pages: totalPages,
        current_page: pageNum,
        has_next_page: pageNum < totalPages,
        has_prev_page: pageNum > 1,
        limit: limitNum
      }
    };

    const response = {
      success: true,
      data: result
    };
    
    console.log('Sending response with', result.labs.length, 'labs');
    res.json(response);
  } catch (error) {
    console.error('Get all labs error:', error);
    console.error('Error stack:', error.stack);
    
    const errorResponse = {
      success: false,
      message: 'Error fetching labs',
      errors: [error.message]
    };
    
    console.error('Sending error response:', errorResponse);
    res.status(500).json(errorResponse);
  }
};

/**
 * @swagger
 * /api/labs/{id}:
 *   get:
 *     summary: Get a specific lab by ID
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lab ID
 *     responses:
 *       200:
 *         description: Lab details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Lab'
 */
const getLabById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lab ID format',
        errors: ['The provided ID is not a valid MongoDB ID']
      });
    }

    // Build query with all necessary population
    const lab = await Lab.findById(id)
      .populate('department', 'name code')
      .populate('fields', 'name code description')
      .populate('equipment', 'name model serial_number status')
      .populate('created_by', 'name email')
      .populate('updated_by', 'name email')
      .populate({
        path: 'bookings',
        options: { limit: 5, sort: { start_time: -1 } },
        populate: [
          { path: 'user', select: 'name email' },
          { path: 'course', select: 'name code' }
        ]
      });

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: ['No lab found with the provided ID']
      });
    }

    // Check department access for department admins
    if (req.user.role === 'department_admin' && 
        lab.department && 
        lab.department._id.toString() !== req.user.department._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: ['You do not have permission to access this lab']
      });
    }

    // Calculate statistics
    const statistics = await lab.getStatistics();
    
    // Format the response
    const response = {
      ...formatLabResponse(lab),
      statistics,
      equipment: lab.equipment || [],
      recent_bookings: lab.bookings || [],
      maintenance_schedule: lab.maintenance_schedule,
      opening_hours: lab.opening_hours,
      contact_person: lab.contact_person,
      notes: lab.notes,
      images: lab.images || [],
      created_at: lab.createdAt,
      updated_at: lab.updatedAt
    };

    res.json({
      success: true,
      data: response
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

/**
 * @swagger
 * /api/labs/{id}/availability:
 *   get:
 *     summary: Check lab availability for a specific time period
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lab ID
 *       - in: query
 *         name: start_time
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start time of the availability check (ISO 8601 format)
 *       - in: query
 *         name: end_time
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End time of the availability check (ISO 8601 format)
 *     responses:
 *       200:
 *         description: Availability check result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 available:
 *                   type: boolean
 *                   description: Whether the lab is available for the specified time period
 *                 message:
 *                   type: string
 *                   description: Additional details about the availability
 *                 conflicts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: ID of the conflicting booking
 *                       start_time:
 *                         type: string
 *                         format: date-time
 *                       end_time:
 *                         type: string
 *                         format: date-time
 *                       reason:
 *                         type: string
 *                         description: Reason for conflict
 */
const checkLabAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_time: startTimeStr, end_time: endTimeStr } = req.query;

    // Validate required parameters
    if (!startTimeStr || !endTimeStr) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters',
        errors: ['start_time and end_time are required']
      });
    }

    // Parse and validate dates
    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format',
        errors: ['start_time and end_time must be valid ISO 8601 dates']
      });
    }

    if (startTime >= endTime) {
      return res.status(400).json({
        success: false,
        message: 'Invalid time range',
        errors: ['end_time must be after start_time']
      });
    }

    // Check if lab exists
    const lab = await Lab.findById(id)
      .populate('department', 'name code')
      .populate('bookings', 'start_time end_time status');

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: ['No lab found with the provided ID']
      });
    }

    // Check department admin access
    if (req.user.role === 'department_admin' && 
        lab.department && 
        lab.department._id.toString() !== req.user.department._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: ['You do not have permission to check availability for this lab']
      });
    }

    // Check if lab is active
    if (!lab.is_active || lab.status === 'inactive') {
      return res.json({
        success: true,
        available: false,
        message: 'Lab is not active',
        conflicts: [{
          reason: 'Lab is marked as inactive'
        }]
      });
    }

    // Check if lab is under maintenance
    if (lab.status === 'maintenance') {
      return res.json({
        success: true,
        available: false,
        message: 'Lab is under maintenance',
        conflicts: [{
          reason: 'Lab is currently under maintenance',
          maintenance_schedule: lab.maintenance_schedule
        }]
      });
    }

    // Check opening hours if available
    if (lab.opening_hours) {
      const dayOfWeek = startTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const openingHours = lab.opening_hours[dayOfWeek];
      
      if (!openingHours || !openingHours.open) {
        return res.json({
          success: true,
          available: false,
          message: 'Lab is closed on this day',
          conflicts: [{
            reason: 'Lab is not open on the selected day',
            day: dayOfWeek,
            opening_hours: lab.opening_hours
          }]
        });
      }

      // Convert times to minutes since midnight for comparison
      const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
      const endMinutes = endTime.getHours() * 60 + endTime.getMinutes();
      const openTime = openingHours.open_time.split(':');
      const closeTime = openingHours.close_time.split(':');
      const openMinutes = parseInt(openTime[0], 10) * 60 + parseInt(openTime[1], 10);
      const closeMinutes = parseInt(closeTime[0], 10) * 60 + parseInt(closeTime[1], 10);

      if (startMinutes < openMinutes || endMinutes > closeMinutes) {
        return res.json({
          success: true,
          available: false,
          message: 'Requested time is outside of opening hours',
          conflicts: [{
            reason: 'Requested time is outside of opening hours',
            opening_hours: lab.opening_hours,
            requested_start: startTime.toISOString(),
            requested_end: endTime.toISOString()
          }]
        });
      }
    }

    // Check for conflicting bookings
    const conflictingBookings = lab.bookings.filter(booking => {
      // Check if the booking is in a status that would cause a conflict
      const isActiveBooking = ['confirmed', 'pending'].includes(booking.status);
      if (!isActiveBooking) return false;

      // Check for time overlap
      const bookingStart = new Date(booking.start_time);
      const bookingEnd = new Date(booking.end_time);
      
      return (
        (startTime >= bookingStart && startTime < bookingEnd) ||
        (endTime > bookingStart && endTime <= bookingEnd) ||
        (startTime <= bookingStart && endTime >= bookingEnd)
      );
    });

    if (conflictingBookings.length > 0) {
      return res.json({
        success: true,
        available: false,
        message: 'Lab is already booked for the requested time',
        conflicts: conflictingBookings.map(booking => ({
          id: booking._id,
          start_time: booking.start_time,
          end_time: booking.end_time,
          status: booking.status,
          reason: 'Conflicts with an existing booking'
        }))
      });
    }

    // If we get here, the lab is available
    res.json({
      success: true,
      available: true,
      message: 'Lab is available for the requested time',
      lab: {
        id: lab._id,
        name: lab.name,
        code: lab.code,
        capacity: lab.capacity,
        status: lab.status,
        is_active: lab.is_active
      }
    });
  } catch (error) {
    console.error('Check lab availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking lab availability',
      errors: [error.message]
    });
  }
};

/**
 * @swagger
 * /api/labs:
 *   post:
 *     summary: Create a new lab
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LabInput'
 *     responses:
 *       201:
 *         description: Lab created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Lab'
 */
const createLab = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(err => err.msg)
      });
    }

    const {
      name,
      code,
      department,
      capacity,
      building,
      floor,
      room_number,
      description,
      fields = [],
      assigned_users = [],
      equipment = [],
      images = [],
      opening_hours = {},
      contact_person = {},
      notes = '',
      maintenance_schedule = {},
      status = 'active',
      is_active = true
    } = req.body;
    
    // Prepare assigned users with additional metadata
    const preparedAssignedUsers = assigned_users.map(user => ({
      user: user.user,
      role: user.role || 'manager',
      assigned_at: new Date(),
      assigned_by: req.user._id,
      notes: user.notes || ''
    }));

    // Check for existing lab with same code
    const existingLab = await Lab.findOne({ code }).session(session);
    if (existingLab) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Lab creation failed',
        errors: ['A lab with this code already exists']
      });
    }

    // Check department exists and user has access
    const departmentDoc = await Department.findById(department).session(session);
    if (!departmentDoc) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid department',
        errors: ['The specified department does not exist']
      });
    }

    // Check if user is department admin for this department
    if (req.user.role === 'department_admin' && 
        departmentDoc._id.toString() !== req.user.department._id.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: ['You do not have permission to create a lab in this department']
      });
    }

    // Log the incoming fields data for debugging
    console.log('Incoming fields data - Raw:', JSON.stringify({
      rawFields: fields,
      isArray: Array.isArray(fields),
      length: Array.isArray(fields) ? fields.length : 0,
      firstItem: Array.isArray(fields) && fields.length > 0 ? fields[0] : null,
      fieldsType: Array.isArray(fields) && fields.length > 0 ? typeof fields[0] : 'none'
    }, null, 2));

    // Process fields to ensure we only have valid ObjectIds
    const processedFields = [];
    if (Array.isArray(fields)) {
      for (const field of fields) {
        try {
          // Skip if field is null/undefined
          if (!field) {
            console.warn('Skipping null/undefined field');
            continue;
          }

          // Handle different field formats
          let fieldId;
          
          if (typeof field === 'string') {
            fieldId = field.trim();
          } else if (field && (field._id || field.id)) {
            fieldId = (field._id || field.id).toString().trim();
          } else {
            console.warn('Skipping invalid field format:', field);
            continue;
          }
          
          // Skip empty IDs
          if (!fieldId) {
            console.warn('Skipping empty field ID');
            continue;
          }
          
          // Validate ObjectId format
          if (!mongoose.Types.ObjectId.isValid(fieldId)) {
            console.warn('Invalid ObjectId format for field:', fieldId);
            continue;
          }
          
          // Create new ObjectId and add to processed fields
          const objectId = new mongoose.Types.ObjectId(fieldId);
          processedFields.push(objectId);
          
        } catch (error) {
          console.error('Error processing field:', {
            field,
            error: error.message,
            stack: error.stack
          });
        }
      }
    }

    // Log the processed fields for debugging
    console.log('Processed fields:', {
      count: processedFields.length,
      sample: processedFields.slice(0, 2).map(id => id.toString()),
      allFields: processedFields.map(id => id.toString())
    });

    // Create the lab
    const labData = {
      name,
      code,
      department,
      capacity,
      building,
      floor,
      room_number,
      description,
      fields: processedFields,
      assigned_users: preparedAssignedUsers,
      equipment,
      images,
      opening_hours,
      contact_person,
      notes,
      maintenance_schedule,
      status,
      is_active,
      created_by: req.user._id,
      updated_by: req.user._id
    };
    
    console.log('Creating lab with data:', JSON.stringify(labData, null, 2));

    const lab = await Lab.create([labData], { session });
    const createdLab = lab[0];

    // Send notification about lab creation
    await sendLabNotification(
      createdLab,
      req.user,
      'created',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: 'Lab created successfully',
      data: formatLabResponse(createdLab)
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Create lab error:', error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Lab creation failed',
        errors: ['A lab with this code already exists']
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creating lab',
      errors: [error.message]
    });
  }
};

/**
 * @swagger
 * /api/labs/{id}:
 *   put:
 *     summary: Update an existing lab
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lab ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LabInput'
 *     responses:
 *       200:
 *         description: Lab updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Lab'
 */
const updateLab = async (req, res) => {
  // Set a timeout for the entire operation
  const timeoutMs = 30000; // Increased to 30 seconds
  let timeoutId;
  let session;
  
  try {
    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    
    session = await mongoose.startSession();
    await session.startTransaction();
    
    const { id } = req.params;
    const updateData = { ...req.body };
    
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array().map(err => err.msg)
      });
    }

    // Check if lab exists
    const existingLab = await Lab.findById(id).session(session);
    if (!existingLab) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: ['No lab found with the provided ID']
      });
    }

    // Check department admin access
    if (req.user.role === 'department_admin' && 
        existingLab.department && 
        existingLab.department.toString() !== req.user.department._id.toString()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: ['You do not have permission to update this lab']
      });
    }

    // Check if department is being changed and user has access to new department
    if (updateData.department && updateData.department !== existingLab.department.toString()) {
      // If user is department admin, they can't change the department
      if (req.user.role === 'department_admin') {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          errors: ['You do not have permission to change the department of this lab']
        });
      }
      
      // Check if new department exists
      const newDepartment = await Department.findById(updateData.department).session(session);
      if (!newDepartment) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Invalid department',
          errors: ['The specified department does not exist']
        });
      }
    }

    // Check for duplicate code if code is being updated
    if (updateData.code && updateData.code !== existingLab.code) {
      const codeExists = await Lab.findOne({ code: updateData.code }).session(session);
      if (codeExists) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: 'Update failed',
          errors: ['A lab with this code already exists']
        });
      }
    }

    // Handle assigned_users if provided
    if (updateData.assigned_users) {
      updateData.assigned_users = updateData.assigned_users.map(user => ({
        user: user.user,
        role: user.role || 'manager',
        assigned_at: user.assigned_at || new Date(),
        assigned_by: req.user._id,
        notes: user.notes || ''
      }));
    }

    // Ensure fields is an array
    if (updateData.fields && !Array.isArray(updateData.fields)) {
      updateData.fields = [];
    }

    // Prepare update data
    const updateFields = {
      ...updateData,
      updated_by: req.user._id,
      updated_at: new Date()
    };
    
    console.log('Updating lab with data:', JSON.stringify(updateFields, null, 2));

    // Update the lab
    const updatedLab = await Lab.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, session }
    )
      .populate('department', 'name code')
      .populate('fields', 'name code')
      .populate('updated_by', 'name email');

    if (!updatedLab) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }

    // Send notification about lab update
    await sendLabNotification(
      updatedLab,
      req.user,
      'updated',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'Lab updated successfully',
      data: formatLabResponse(updatedLab)
    });
  } catch (error) {
    // Clear the timeout if the operation completes before timeout
    if (timeoutId) clearTimeout(timeoutId);
    
    // Only try to abort transaction if session is still active
    if (session.inTransaction()) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error('Error aborting transaction:', abortError);
      }
    }
    
    // End the session
    if (session.inTransaction()) {
      try {
        await session.endSession();
      } catch (endSessionError) {
        console.error('Error ending session:', endSessionError);
      }
    }
    
    console.error('Update lab error:', error);
    
    // Handle timeout errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Update failed',
        errors: ['A lab with this code already exists']
      });
    }
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }
    
    if (error.errorLabels?.includes('TransientTransactionError')) {
      return res.status(503).json({
        success: false,
        message: 'Temporary database error',
        errors: ['The database is temporarily unavailable. Please try again.']
      });
    }
    
    // Default error response
    return res.status(500).json({
      success: false,
      message: 'Error updating lab',
      errors: [error.message || 'An unexpected error occurred']
    });
  } finally {
    // Ensure timeout is always cleared
    if (timeoutId) clearTimeout(timeoutId);
    
    // Ensure session is always ended
    if (session) {
      try {
        await session.endSession();
      } catch (sessionError) {
        console.error('Error ending session in finally block:', sessionError);
      }
    }
  }
};

/**
 * @swagger
 * /api/labs/{id}:
 *   delete:
 *     summary: Delete a lab (soft delete)
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lab ID
 *     responses:
 *       200:
 *         description: Lab deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Lab'
 */
const deleteLab = async (req, res) => {
  console.log('=== DELETE LAB REQUEST ===');
  console.log('Headers:', req.headers);
  console.log('Params:', req.params);
  console.log('User:', req.user ? { id: req.user._id, role: req.user.role } : 'No user info');
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    console.log(`Processing delete for lab ID: ${id}`);

    // Check if lab exists
    console.log('Checking if lab exists...');
    const lab = await Lab.findById(id).session(session);
    console.log('Lab found:', lab ? 'Yes' : 'No');
    
    if (!lab) {
      console.log('Lab not found, aborting transaction');
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: ['No lab found with the provided ID']
      });
    }

    // Check department admin access
    if (req.user.role === 'department_admin') {
      console.log('Checking department admin access...');
      const departmentMatch = lab.department && 
                            req.user.department &&
                            lab.department.toString() === req.user.department._id.toString();
      
      console.log('Department access check:', {
        labDepartment: lab.department,
        userDepartment: req.user.department?._id,
        match: departmentMatch ? 'Yes' : 'No'
      });
      
      if (!departmentMatch) {
        console.log('Department admin access denied');
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          errors: ['You do not have permission to delete this lab']
        });
      }
    }

    // Perform soft delete
    const now = new Date();
    const updateData = {
      is_active: false,
      status: 'inactive',
      deleted_at: now,
      deleted_by: req.user._id,
      updated_by: req.user._id,
      updated_at: now
    };
    
    console.log('Performing soft delete with data:', updateData);
    
    const deletedLab = await Lab.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, session }
    )
      .populate('department', 'name code')
      .populate('deleted_by', 'name email');
      
    console.log('Soft delete result:', deletedLab ? 'Success' : 'Failed');

    if (!deletedLab) {
      console.log('Failed to update lab - not found after update attempt');
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: ['The lab could not be found for update']
      });
    }

    // Send notification about lab deletion
    await sendLabNotification(
      deletedLab,
      req.user,
      'deleted',
      { session }
    );

    // TODO: Add logic to cancel/update any future bookings for this lab

    console.log('Committing transaction...');
    await session.commitTransaction();
    session.endSession();
    
    const response = {
      success: true,
      message: 'Lab deleted successfully',
      data: formatLabResponse(deletedLab)
    };
    
    console.log('Sending success response:', response);
    res.json(response);
  } catch (error) {
    console.error('Delete lab error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      keyPattern: error.keyPattern,
      keyValue: error.keyValue
    });
    
    try {
      await session.abortTransaction();
      session.endSession();
    } catch (sessionError) {
      console.error('Error ending session after error:', sessionError);
    }
    
    const statusCode = error.name === 'ValidationError' ? 400 : 500;
    const errorMessage = error.message || 'An unexpected error occurred';
    
    console.log('Sending error response:', { statusCode, message: errorMessage });
    
    res.status(statusCode).json({
      success: false,
      message: 'Error deleting lab',
      errors: [errorMessage],
      errorType: error.name
    });
  }
};

/**
 * @swagger
 * /api/labs/{id}/status:
 *   patch:
 *     summary: Update lab status
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lab ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, maintenance, inactive, available, booked]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Lab status updated successfully
 */
const updateLabStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    // Validate status
    if (!Object.values(Lab.STATUS).includes(status)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
        errors: [`Status must be one of: ${Object.values(Lab.STATUS).join(', ')}`]
      });
    }

    // Find and update lab
    const lab = await Lab.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          updated_by: req.user._id,
          updated_at: new Date()
        },
        $push: status === 'maintenance' ? {
          maintenance_logs: {
            start_time: new Date(),
            notes: notes || 'Status changed to maintenance',
            updated_by: req.user._id
          }
        } : {}
      },
      { new: true, session }
    )
      .populate('updated_by', 'name email')
      .populate('department', 'name code');

    if (!lab) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }

    // Send notification about status change
    await sendLabNotification(
      lab,
      req.user,
      'status_changed',
      { 
        oldStatus: lab.status,
        newStatus: status,
        notes,
        session 
      }
    );

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: `Lab status updated to ${status}`,
      data: formatLabResponse(lab)
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Update lab status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating lab status',
      errors: [error.message]
    });
  }
};

/**
 * @swagger
 * /api/labs/{id}/equipment:
 *   post:
 *     summary: Add equipment to lab
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lab ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - equipment_id
 *               - quantity
 *             properties:
 *               equipment_id:
 *                 type: string
 *               quantity:
 *                 type: number
 *                 minimum: 1
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Equipment added to lab successfully
 */
const addEquipmentToLab = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { equipment_id, quantity, notes } = req.body;

    // Validate input
    if (!mongoose.Types.ObjectId.isValid(equipment_id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Invalid equipment ID',
        errors: ['The provided equipment ID is not valid']
      });
    }

    // Find lab and update equipment
    const lab = await Lab.findByIdAndUpdate(
      id,
      {
        $addToSet: {
          equipment: {
            equipment: equipment_id,
            quantity: quantity || 1,
            added_by: req.user._id,
            added_at: new Date(),
            notes: notes || ''
          }
        },
        $set: {
          updated_by: req.user._id,
          updated_at: new Date()
        }
      },
      { new: true, session }
    )
      .populate('equipment.equipment', 'name model serial_number')
      .populate('updated_by', 'name email');

    if (!lab) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'Equipment added to lab successfully',
      data: formatLabResponse(lab)
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Add equipment to lab error:', error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Equipment already exists in lab',
        errors: ['This equipment is already assigned to the lab']
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error adding equipment to lab',
      errors: [error.message]
    });
  }
};

/**
 * @swagger
 * /api/labs/{id}/maintenance:
 *   post:
 *     summary: Log maintenance activity for a lab
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lab ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - description
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [preventive, corrective, inspection, other]
 *               description:
 *                 type: string
 *               start_time:
 *                 type: string
 *                 format: date-time
 *               end_time:
 *                 type: string
 *                 format: date-time
 *               technician:
 *                 type: string
 *               cost:
 *                 type: number
 *               parts_replaced:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     quantity:
 *                       type: number
 *                     cost:
 *                       type: number
 *     responses:
 *       201:
 *         description: Maintenance logged successfully
 */
const logMaintenance = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const {
      type,
      description,
      start_time = new Date(),
      end_time = null,
      technician = null,
      cost = 0,
      parts_replaced = []
    } = req.body;

    // Validate required fields
    if (!type || !description) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        errors: ['type and description are required']
      });
    }

    // Create maintenance log
    const maintenanceLog = {
      type,
      description,
      start_time: new Date(start_time),
      end_time: end_time ? new Date(end_time) : null,
      reported_by: req.user._id,
      technician,
      cost,
      parts_replaced,
      status: end_time ? 'completed' : 'in_progress',
      created_at: new Date()
    };

    // Update lab with maintenance log
    const lab = await Lab.findByIdAndUpdate(
      id,
      {
        $push: { maintenance_logs: maintenanceLog },
        $set: {
          status: maintenanceLog.status === 'completed' ? 'active' : 'maintenance',
          updated_by: req.user._id,
          updated_at: new Date()
        }
      },
      { new: true, session }
    )
      .populate('maintenance_logs.reported_by', 'name email')
      .populate('updated_by', 'name email');

    if (!lab) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: 'Maintenance logged successfully',
      data: {
        lab: formatLabResponse(lab),
        maintenance_log: maintenanceLog
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Log maintenance error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error logging maintenance',
      errors: [error.message]
    });
  }
};

/**
 * @swagger
 * /api/labs/{id}/stats:
 *   get:
 *     summary: Get lab statistics and usage
 *     tags: [Labs]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Lab ID
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for statistics (YYYY-MM-DD)
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for statistics (YYYY-MM-DD, defaults to today)
 *     responses:
 *       200:
 *         description: Lab statistics retrieved successfully
 */
const getLabStatistics = async (req, res) => {
  try {
    const { id } = req.params;
    let { start_date, end_date } = req.query;
    
    // Set default date range if not provided
    const endDate = end_date ? new Date(end_date) : new Date();
    const startDate = start_date ? new Date(start_date) : new Date();
    startDate.setMonth(startDate.getMonth() - 1); // Default to last 30 days

    // Find lab with related data
    const lab = await Lab.findById(id)
      .populate('department', 'name code')
      .populate('bookings', 'start_time end_time status user')
      .populate('maintenance_logs', 'start_time end_time type status cost');

    if (!lab) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found',
        errors: []
      });
    }

    // Calculate booking statistics
    const bookingsInRange = lab.bookings.filter(booking => {
      const bookingStart = new Date(booking.start_time);
      return bookingStart >= startDate && bookingStart <= endDate;
    });

    const bookingStats = {
      total: bookingsInRange.length,
      byStatus: bookingsInRange.reduce((acc, booking) => {
        acc[booking.status] = (acc[booking.status] || 0) + 1;
        return acc;
      }, {}),
      byDay: bookingsInRange.reduce((acc, booking) => {
        const day = new Date(booking.start_time).toISOString().split('T')[0];
        acc[day] = (acc[day] || 0) + 1;
        return acc;
      }, {})
    };

    // Calculate maintenance statistics
    const maintenanceInRange = lab.maintenance_logs.filter(log => {
      const logDate = new Date(log.start_time);
      return logDate >= startDate && logDate <= endDate;
    });

    const maintenanceStats = {
      total: maintenanceInRange.length,
      byType: maintenanceInRange.reduce((acc, log) => {
        acc[log.type] = (acc[log.type] || 0) + 1;
        return acc;
      }, {}),
      total_downtime: maintenanceInRange.reduce((total, log) => {
        if (log.end_time) {
          const start = new Date(log.start_time);
          const end = new Date(log.end_time);
          return total + (end - start);
        }
        return total;
      }, 0) / (1000 * 60 * 60) // Convert to hours
    };

    // Calculate utilization rate
    const totalHours = (endDate - startDate) / (1000 * 60 * 60); // Total hours in period
    const bookedHours = bookingsInRange.reduce((total, booking) => {
      const start = new Date(booking.start_time);
      const end = new Date(booking.end_time);
      return total + (end - start) / (1000 * 60 * 60); // Convert to hours
    }, 0);

    const utilizationRate = totalHours > 0 ? (bookedHours / totalHours) * 100 : 0;

    // Prepare response
    const stats = {
      lab: {
        id: lab._id,
        name: lab.name,
        code: lab.code,
        status: lab.status,
        capacity: lab.capacity,
        equipment_count: lab.equipment ? lab.equipment.length : 0
      },
      date_range: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      },
      bookings: bookingStats,
      maintenance: maintenanceStats,
      utilization_rate: Math.min(100, Math.round(utilizationRate * 100) / 100) // Cap at 100%
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get lab statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving lab statistics',
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
  deleteLab,
  updateLabStatus,
  addEquipmentToLab,
  logMaintenance,
  getLabStatistics
};