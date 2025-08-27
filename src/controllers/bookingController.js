const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;
const ErrorResponse = require('../utils/errorResponse');
const Booking = require('../models/Booking');
const Lab = require('../models/Lab');
const Field = require('../models/Field');
const User = require('../models/User');
const Item = require('../models/Item');
const Notification = require('../models/Notification');
const StockLog = require('../models/StockLog');
const { validationResult } = require('express-validator');
const { 
  sendBookingNotificationToAdmin, 
  sendBookingStatusUpdate,
  createNotification
} = require('../utils/notifications');
const { 
  releaseBookingItems,
  releaseCompletedBookings
} = require('../utils/inventoryUtils');
const moment = require('moment-timezone');

// Get all bookings with filters and role-based access
const getAllBookings = async (req, res) => {
  try {
    const {
      lab_id, field_id, user_id, status, booking_type,
      start_date, end_date, page = 1, limit = 20
    } = req.query;
    const filter = {};

    // Apply filters from query parameters
    if (lab_id) filter.lab = lab_id;
    if (field_id) filter.field = field_id;
    if (user_id) filter.user = user_id;
    if (status) filter.status = status;
    if (booking_type) filter.booking_type = booking_type;

    // Date range filter
    if (start_date || end_date) {
      filter.start_time = {};
      if (start_date) filter.start_time.$gte = new Date(start_date);
      if (end_date) filter.start_time.$lte = new Date(end_date);
    }

    // Role-based filtering
    const userRole = req.user?.role;
    const userId = req.user?._id;

    if (userRole === 'admin') {
      // Admins can see all bookings
    } else if (userRole === 'lab_manager' || userRole === 'department_admin') {
      // Scoped by department labs provided by middleware
      let labIds = (req.departmentScope && !req.departmentScope.global) ? (req.departmentScope.labIds || []) : [];
      // If a specific department_id is requested, further narrow labs to that department
      const requestedDeptId = req.query.department_id;
      if (requestedDeptId) {
        // Intersect with labs of the requested department
        const deptLabIds = await Lab.find({ department: requestedDeptId }).select('_id');
        const deptLabIdSet = new Set(deptLabIds.map(l => l._id.toString()));
        labIds = labIds.filter(id => deptLabIdSet.has(id.toString()));
      }
      filter.lab = { $in: labIds };
    } else if (userRole === 'teacher' || userRole === 'instructor') {
      // Teachers can see their own bookings and bookings for their courses/fields
      const userFields = await Field.find({ instructor: userId }).select('_id');
      const fieldIds = userFields.map(f => f._id);
      
      // Show bookings for user's fields or bookings created by the user
      filter.$or = [
        { field: { $in: fieldIds } },
        { user: userId }
      ];
    } else if (userRole === 'student' || userRole === 'external_user') {
      // Students and external users can only see their own bookings
      filter.user = userId;
    } else {
      // Default: only show user's own bookings
      filter.user = userId;
    }

    // Enforce department scope again (in case of additional query filters),
    // but keep any requested department_id narrowing applied above.
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      const scopeLabIds = req.departmentScope.labIds || [];
      if (filter.lab && filter.lab.$in) {
        const scopeSet = new Set(scopeLabIds.map(id => id.toString()));
        filter.lab = { $in: filter.lab.$in.filter(id => scopeSet.has(id.toString())) };
      } else {
        filter.lab = { $in: scopeLabIds };
      }
    }

    const skip = (page - 1) * limit;
    const totalCount = await Booking.countDocuments(filter);

    const bookings = await Booking.find(filter)
      .populate('lab', 'name')
      .populate('field', 'name')
      .populate('user', 'full_name role')
      .populate('approved_by', 'full_name')
      .populate('item_requirements.item', 'name')
      .sort({ start_time: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const mappedBookings = bookings.map(b => ({
      id: b._id,
      lab_id: b.lab?._id,
      lab_name: b.lab?.name,
      field_id: b.field?._id,
      field_name: b.field?.name,
      user_id: b.user?._id,
      user_name: b.user?.full_name,
      user_role: b.user?.role,
      start_time: b.start_time ? new Date(b.start_time).toISOString() : null,
      end_time: b.end_time ? new Date(b.end_time).toISOString() : null,
      purpose: b.purpose,
      status: b.status,
      requested_consumables: (b.item_requirements || []).map(req => ({
        item_id: req.item?._id,
        item_name: req.item?.name,
        quantity: req.quantity_needed
      })),
      created_at: b.createdAt ? new Date(b.createdAt).toISOString() : null,
      approved_at: b.approved_at ? new Date(b.approved_at).toISOString() : null,
      approved_by: b.approved_by?.full_name || null,
      participants_count: b.participants_count || 0
    }));

    res.json({
      success: true,
      data: {
        bookings: mappedBookings,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bookings',
      errors: [error.message]
    });
  }
};

// Get specific booking
const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('lab', 'name code capacity description')
      .populate('field', 'name code description')
      .populate('user', 'full_name email department phone')
      .populate('approved_by', 'full_name email')
      .populate('item_requirements.item', 'name type available_quantity description')
      .lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Department scope enforcement for non-admins
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      const labIds = (req.departmentScope.labIds || []).map(id => id.toString());
      const bookingLabId = booking.lab?._id?.toString() || booking.lab?.toString();
      if (bookingLabId && !labIds.includes(bookingLabId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          errors: ['You do not have permission to access this booking']
        });
      }
    }

    res.json({
      success: true,
      data: booking
    });
  } catch (error) {
    console.error('Get booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking',
      errors: [error.message]
    });
  }
};

// Create new booking with item requirements
const createBooking = async (req, res) => {
  try {
    // Log the incoming request data
    console.log('=== INCOMING BOOKING REQUEST ===');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    console.log('Body:', JSON.stringify(req.body, null, 2));
    console.log('User:', req.user);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { 
      lab_id, field_id, start_time, end_time, purpose, booking_type,
      participants_count, equipment_needed, item_requirements, 
      special_instructions, setup_time_needed, cleanup_time_needed,
      is_recurring, recurring_pattern, title, created_by, user
    } = req.body;
    
    // Log the extracted fields
    console.log('Extracted fields:', {
      lab_id,
      field_id,
      start_time,
      end_time,
      purpose,
      booking_type,
      participants_count,
      title,
      created_by,
      user: req.user.id,
      item_requirements_count: item_requirements ? item_requirements.length : 0
    });
    
    const user_id = created_by || user || req.user.id;

    // Check if lab exists and is active
    const lab = await Lab.findById(lab_id);
    if (!lab || !lab.is_active) {
      return res.status(400).json({
        success: false,
        message: 'Lab not found or inactive'
      });
    }

    // Check if field is allowed for this lab
    const labWithFields = await Lab.findById(lab_id).populate('fields');
    if (!labWithFields.fields.some(field => field._id.toString() === field_id)) {
      return res.status(400).json({
        success: false,
        message: 'This field is not allowed to use this lab'
      });
    }

    // Check lab capacity
    if (participants_count > lab.capacity) {
      return res.status(400).json({
        success: false,
        message: `Lab capacity exceeded. Maximum ${lab.capacity} participants allowed.`
      });
    }

    // Initialize booking data object with all required fields
    const bookingData = {
      lab: lab_id,
      field: field_id,
      user: user_id,
      created_by: user_id, // Add created_by field
      title: title || `Booking for ${purpose?.substring(0, 50) || 'Untitled'}`,
      start_time: new Date(start_time),
      end_time: new Date(end_time),
      purpose: purpose || 'Lab booking',
      booking_type: booking_type || 'other',
      participants_count: participants_count || 1,
      special_instructions: special_instructions || '',
      setup_time_needed: setup_time_needed || 0,
      cleanup_time_required: cleanup_time_needed || 0, // Note: field name mismatch fixed
      item_requirements: [],
      status: 'pending',
      is_recurring: is_recurring || false,
      recurring_pattern: recurring_pattern || null
    };
    
    // Log the constructed booking data for debugging
    console.log('Constructed booking data:', JSON.stringify(bookingData, null, 2));

    // Validate item requirements and check availability
    if (item_requirements && item_requirements.length > 0) {
      // Normalize item_requirements to use 'item' field
      const normalizedRequirements = item_requirements.map(req => ({
        ...req,
        item: req.item || req.item_id, // Support both 'item' and 'item_id' for backward compatibility
        quantity_needed: Number(req.quantity_needed) || 1,
        notes: req.notes || ''
      }));

      // Validate each requirement
      for (const requirement of normalizedRequirements) {
        if (!requirement.item) {
          return res.status(400).json({
            success: false,
            message: `Item ID is missing in requirement: ${JSON.stringify(requirement)}`
          });
        }

        const item = await Item.findById(requirement.item);
        if (!item) {
          return res.status(400).json({
            success: false,
            message: `Item with ID ${requirement.item} not found`
          });
        }
        
        // Log detailed item info for debugging
        console.log('Checking item availability:', {
          itemId: item._id,
          name: item.name,
          type: item.type,
          available_quantity: item.available_quantity,
          required_quantity: requirement.quantity_needed,
          status: item.status,
          is_deleted: !!item.deleted_at
        });

        // Check if item is soft-deleted
        if (item.deleted_at) {
          return res.status(400).json({
            success: false,
            message: `Item ${item.name} has been deleted and is no longer available`
          });
        }

        // Check item status
        if (item.status !== 'available') {
          return res.status(400).json({
            success: false,
            message: `Item ${item.name} is currently ${item.status.replace('_', ' ')}`
          });
        }
        
        // Check available quantity
        if (item.available_quantity < requirement.quantity_needed) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for item ${item.name}. Available: ${item.available_quantity}, Required: ${requirement.quantity_needed}`,
            details: {
              itemId: item._id,
              itemName: item.name,
              available: item.available_quantity,
              required: requirement.quantity_needed,
              status: item.status
            }
          });
        }
      }

      // Update item requirements with normalized data
      bookingData.item_requirements = normalizedRequirements;
    }

    // Handle recurring bookings
    if (is_recurring && recurring_pattern) {
      const bookings = [];
      const startDate = new Date(start_time);
      const endDate = new Date(recurring_pattern.end_date);
      
      let currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const bookingStart = new Date(currentDate);
        const bookingEnd = new Date(currentDate);
        bookingEnd.setTime(bookingEnd.getTime() + (new Date(end_time) - new Date(start_time)));
        
        // Check if this day matches the recurring pattern
        const dayOfWeek = currentDate.getDay();
        if (recurring_pattern.days_of_week.includes(dayOfWeek)) {
          const recurringBooking = new Booking({
            ...bookingData,
            start_time: bookingStart,
            end_time: bookingEnd
          });
          bookings.push(recurringBooking);
        }
        
        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      // Save all recurring bookings
      const savedBookings = await Booking.insertMany(bookings);
      
      const populatedBookings = await Booking.find({ _id: { $in: savedBookings.map(b => b._id) } })
        .populate('lab', 'name code')
        .populate('field', 'name code')
        .populate('user', 'full_name email')
        .populate('item_requirements.item', 'name type');

      // Send notifications for recurring bookings
      for (const booking of populatedBookings) {
        try {
          console.log('Sending admin notification for recurring booking:', booking._id);
          await sendBookingNotificationToAdmin(booking, req.user);
          console.log('Successfully sent admin notification for booking:', booking._id);
        } catch (error) {
          console.error('Error sending admin notification for booking:', booking._id, error);
          // Don't fail the whole operation if notification fails
        }
      }

      res.status(201).json({
        success: true,
        message: `${savedBookings.length} recurring bookings created successfully`,
        data: populatedBookings
      });
    } else {
      // Single booking
      const booking = await Booking.create(bookingData);

      const populatedBooking = await Booking.findById(booking._id)
        .populate('lab', 'name code')
        .populate('field', 'name code')
        .populate('user', 'full_name email')
        .populate('item_requirements.item', 'name type');

      // Send admin notification for the booking
      try {
        console.log('Sending admin notification for new booking:', populatedBooking._id);
        await sendBookingNotificationToAdmin(populatedBooking, req.user);
        console.log('Successfully sent admin notification for booking:', populatedBooking._id);
      } catch (error) {
        console.error('Error sending admin notification for booking:', populatedBooking._id, error);
        // Don't fail the whole operation if notification fails
      }
      
      // Also send a confirmation to the user
      try {
        console.log('Sending user confirmation for booking:', populatedBooking._id);
        // Create a proper notification for booking request
        await createNotification({
          user: populatedBooking.user._id,
          type: 'booking_requested',
          title: 'Booking Request Submitted',
          message: `Your booking for ${populatedBooking.lab?.name || 'a lab'} has been received and is pending approval.`,
          data: { 
            booking_id: populatedBooking._id, 
            lab_name: populatedBooking.lab?.name, 
            start_time: populatedBooking.start_time,
            status: 'pending'
          },
          action_url: `/bookings/${populatedBooking._id}`,
          related_lab: populatedBooking.lab?._id,
          priority: 'normal'
        });
        console.log('Successfully sent user confirmation for booking:', populatedBooking._id);
      } catch (error) {
        console.error('Error sending user confirmation for booking:', populatedBooking._id, error);
      }

      res.status(201).json({
        success: true,
        message: 'Booking created successfully',
        data: populatedBooking
      });
    }
  } catch (error) {
    console.error('Create booking error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error creating booking',
      errors: [error.message]
    });
  }
};

// Update booking status
const updateBookingStatus = async (req, res) => {
  try {
    const { status, rejection_reason } = req.body;
    const { id } = req.params;
    const admin_id = req.user.id;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be approved or rejected'
      });
    }

    const updateData = { 
      status,
      approved_by: admin_id,
      approved_at: new Date()
    };

    if (status === 'rejected' && rejection_reason) {
      updateData.rejection_reason = rejection_reason;
    }

    const booking = await Booking.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate('lab', 'name code')
     .populate('field', 'name code')
     .populate('user', 'full_name email')
     .populate('approved_by', 'full_name email')
     .populate('item_requirements.item', 'name type');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Send notification to user about status update
    try {
      console.log('Sending booking status update notification...');
      console.log('Booking:', {
        id: booking._id,
        lab: booking.lab,
        user: booking.user,
        status: booking.status
      });
      
      // Get the user who made the booking
      const user = await User.findById(booking.user).lean();
      if (!user) {
        console.error('User not found for booking:', booking._id);
      } else {
        console.log('Found user for notification:', user._id, user.email);
        if (sendBookingStatusUpdate) {
          await sendBookingStatusUpdate(booking, user, status, rejection_reason);
          console.log('Booking status update notification sent successfully');
        } else {
          console.error('sendBookingStatusUpdate function not available');
        }
      }
    } catch (error) {
      console.error('Error sending booking status notification:', error);
      // Don't fail the whole request if notification fails
    }

    res.json({
      success: true,
      message: `Booking ${status} successfully`,
      data: booking
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating booking status',
      errors: [error.message]
    });
  }
};

// Approve booking (Lab Manager only)
const approveBooking = async (req, res) => {
  console.log('=== APPROVE BOOKING STARTED ===');
  console.log('Request params:', req.params);
  console.log('Request body:', req.body);
  console.log('Authenticated user ID:', req.user?.id);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { notes } = req.body;
    const admin_id = req.user.id;

    console.log('Approving booking with ID:', id);
    console.log('Admin ID:', admin_id);

    if (!admin_id) {
      await session.abortTransaction();
      session.endSession();
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: Admin ID is missing'
      });
    }

    // Find and validate booking
    const booking = await Booking.findById(id)
      .populate('lab', 'name code')
      .populate('user', 'full_name email')
      .session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    console.log('Found booking:', {
      id: booking._id,
      status: booking.status,
      lab: booking.lab,
      user: booking.user,
      item_requirements: booking.item_requirements
    });

    // Check if booking is already approved
    if (booking.status === 'approved') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Booking is already approved'
      });
    }

    // Department scope enforcement for non-admins
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      const labIds = (req.departmentScope.labIds || []).map(id => id.toString());
      const bookingLabId = booking.lab?._id?.toString() || booking.lab?.toString();
      if (bookingLabId && !labIds.includes(bookingLabId)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          errors: ['You do not have permission to approve this booking']
        });
      }
    }

    // Process item requirements
    if (booking.item_requirements && booking.item_requirements.length > 0) {
      const Item = mongoose.model('Item');
      
      for (const requirement of booking.item_requirements) {
        const item = await Item.findById(requirement.item).session(session);
        
        if (!item) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({
            success: false,
            message: `Item ${requirement.item} not found`
          });
        }

        // For consumable items, check availability and update quantity
        if (item.type === 'consumable') {
          if (item.available_quantity < requirement.quantity_needed) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              success: false,
              message: `Insufficient quantity for item ${item.name}. Available: ${item.available_quantity}, Required: ${requirement.quantity_needed}`
            });
          }

          // Update item quantity and ensure created_by is set
          item.available_quantity -= requirement.quantity_needed;
          if (!item.created_by) {
            item.created_by = admin_id;
          }
          
          try {
            await item.save({ session });
          } catch (error) {
            console.error('Error saving item:', error);
            throw error;
          }
        }
        // For non-consumable items, ensure they're available and not in maintenance
        else if (item.type === 'equipment') {
          if (item.status === 'in_maintenance') {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
              success: false,
              message: `Cannot approve booking: ${item.name} is under maintenance`
            });
          }
          
          // Update item status and ensure created_by is set
          item.status = 'in_use';
          if (!item.created_by) {
            item.created_by = admin_id;
          }
          
          try {
            await item.save({ session });
          } catch (error) {
            console.error('Error saving item:', error);
            throw error;
          }
        }
        
        // Update requirement status
        requirement.status = 'approved';
        requirement.approved_by = admin_id;
        requirement.approved_at = new Date();
      }
    }

    // Update booking status
    booking.status = 'approved';
    booking.approved_by = admin_id;
    booking.approved_at = new Date();
    booking.notes = notes || '';

    // Save the updated booking
    const updatedBooking = await booking.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Populate the updated booking for the response
    const populatedBooking = await Booking.findById(updatedBooking._id)
      .populate('lab', 'name code')
      .populate('user', 'full_name email')
      .populate('approved_by', 'full_name')
      .populate('item_requirements.item', 'name type available_quantity');

    // Send notification to user about approval
    if (sendBookingStatusUpdate) {
      await sendBookingStatusUpdate(
        populatedBooking, 
        populatedBooking.user, 
        'approved',
        null, // rejectionReason
        populatedBooking.lab?._id, // related_lab
        admin_id // Pass the admin's ID who approved the booking
      );
    }

    res.json({
      success: true,
      message: 'Booking approved successfully',
      data: populatedBooking
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    
    console.error('Approve booking error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error approving booking',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

const rejectBooking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { reason, notes } = req.body;
    const admin_id = req.user.id;

    if (!reason || !reason.trim()) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    // Find and validate booking
    const booking = await Booking.findById(id)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('user', 'full_name email')
      .session(session);

    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking is already approved or rejected
    if (booking.status !== 'pending') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Booking is already ${booking.status}`
      });
    }

    // Department scope enforcement for non-admins
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      const labIds = (req.departmentScope.labIds || []).map(id => id.toString());
      const bookingLabId = booking.lab?._id?.toString() || booking.lab?.toString();
      if (bookingLabId && !labIds.includes(bookingLabId)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          errors: ['You do not have permission to reject this booking']
        });
      }
    }

    // Update booking with rejection details
    // Use set to mark fields as modified
    booking.set({
      status: 'rejected',
      rejected_by: admin_id,
      rejected_at: new Date(),
      rejection_reason: reason,
      special_instructions: notes || booking.special_instructions,
      // Ensure required fields are not lost
      title: booking.title || 'Lab Booking',
      created_by: booking.created_by || admin_id,
      // Ensure item requirements have required fields
      item_requirements: (booking.item_requirements || []).map(item => ({
        ...item.toObject(),
        type: item.type || 'non_consumable', // Default type if missing
        quantity_needed: item.quantity_needed || 1 // Default quantity if missing
      }))
    });
    
    await booking.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Populate booking details for response
    const populatedBooking = await Booking.findById(id)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('user', 'full_name email')
      .populate('rejected_by', 'full_name email')
      .populate('item_requirements.item', 'name type');

    // Send notification to user about rejection
    if (sendBookingStatusUpdate) {
      await sendBookingStatusUpdate(populatedBooking, populatedBooking.user, 'rejected', reason);
    }

    res.json({
      success: true,
      message: 'Booking rejected successfully',
      data: populatedBooking
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Reject booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting booking',
      errors: [error.message]
    });
  }
};

// @desc    Cancel a booking
// @route   PATCH /api/bookings/:id/cancel
// @access  Private
const cancelBooking = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const user_id = req.user.id;
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid booking ID'
    });
  }
  
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // Find the booking with necessary fields populated
      const booking = await Booking.findById(id)
        .populate('user', '_id name email')
        .populate('lab', 'name')
        .session(session);

      if (!booking) {
        throw new ErrorResponse('Booking not found', 404);
      }

      // Check if booking is already cancelled
      if (booking.status === 'cancelled') {
        throw new ErrorResponse('Booking is already cancelled', 400);
      }

      // Check if booking is already completed
      if (booking.status === 'completed') {
        throw new ErrorResponse('Cannot cancel a completed booking', 400);
      }

      // Check permissions - user can cancel their own booking, admin/lab_manager can cancel any
      const isOwner = booking.user._id.toString() === req.user.id;
      const isAdminOrLabManager = ['admin', 'lab_manager'].includes(req.user.role);

      if (!isOwner && !isAdminOrLabManager) {
        throw new ErrorResponse('Not authorized to cancel this booking', 403);
      }

      // Department scope enforcement for non-admins
      if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
        const labIds = (req.departmentScope.labIds || []).map(id => id.toString());
        const bookingLabId = booking.lab?._id?.toString() || booking.lab?.toString();
        if (bookingLabId && !labIds.includes(bookingLabId)) {
          throw new ErrorResponse('Access denied: cannot cancel booking outside your department', 403);
        }
      }

      // Release any allocated items if booking was approved
      if (booking.status === 'approved' && booking.item_requirements && booking.item_requirements.length > 0) {
        console.log(`Releasing items for booking ${booking._id}`);
        await releaseBookingItems(booking._id, req.user.id, 'booking_cancelled', session);
        
        // Save the booking to persist any changes made by releaseBookingItems
        await booking.save({ session });
        console.log(`Successfully saved booking after releasing items`);
      }

      // Update booking status and metadata
      booking.status = 'cancelled';
      booking.cancelled_at = new Date();
      booking.cancelled_by = req.user.id;
      booking.cancellation_reason = reason || 'No reason provided';
      booking.updated_by = req.user.id;

      await booking.save({ session });

      // Create a notification for the booking user (if not the one cancelling)
      if (booking.user._id.toString() !== req.user.id) {
        await createNotification({
          user: booking.user._id,
          type: 'booking_cancelled',
          title: 'Booking Cancelled',
          message: `Your booking for ${booking.lab?.name || 'the lab'} has been cancelled by ${req.user.name || 'an administrator'}`,
          data: {
            booking_id: booking._id,
            lab_name: booking.lab?.name,
            cancelled_by: req.user.id,
            cancellation_reason: reason || 'No reason provided'
          },
          action_url: `/bookings/${booking._id}`,
          related_lab: booking.lab?._id,
          priority: 'high'
        });
      }

      // Log the cancellation
      console.log(`Booking ${booking._id} cancelled by user ${req.user.id}`);

      // Send success response
      res.status(200).json({
        success: true,
        message: 'Booking cancelled successfully',
        data: {
          bookingId: booking._id,
          status: booking.status,
          cancelledAt: booking.cancelled_at
        }
      });
    });

  } catch (error) {
    console.error('Error cancelling booking:', error);

    // Handle known error types
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.message
      });
    }

    // Handle custom error response
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      });
    }

    // Default error response
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });

  } finally {
    await session.endSession();
  }
};

// @desc    Complete a booking and release items
// @route   PATCH /api/bookings/:id/complete
// @access  Private (Lab Manager/Admin)
const completeBooking = async (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;
  
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid booking ID'
    });
  }
  
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    console.log('=== STARTING BOOKING COMPLETION ===');
    console.log('Booking ID:', id);
    console.log('User ID:', user_id);
    
    // Find the booking with necessary fields populated
    const booking = await Booking.findById(id)
      .populate('user', '_id name email')
      .populate('lab', 'name')
      .session(session);
      
    if (!booking) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }
      console.log('Transaction started');
      // Booking already loaded above
      
      // Check if booking is already completed or cancelled
      if (booking.status === 'completed') {
        throw new ErrorResponse('Booking is already completed', 400);
      }
      
      if (booking.status === 'cancelled') {
        throw new ErrorResponse('Cannot complete a cancelled booking', 400);
      }
      
      // Ensure booking is approved
      if (booking.status !== 'approved') {
        throw new ErrorResponse('Only approved bookings can be marked as completed', 400);
      }
      
      // Department scope enforcement for non-admins
      if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
        const labIds = (req.departmentScope.labIds || []).map(id => id.toString());
        const bookingLabId = booking.lab?._id?.toString() || booking.lab?.toString();
        if (bookingLabId && !labIds.includes(bookingLabId)) {
          throw new ErrorResponse('Access denied: cannot complete booking outside your department', 403);
        }
      }

      // Process item requirements
      if (booking.item_requirements && booking.item_requirements.length > 0) {
        console.log('Processing items for booking:', booking._id);
        const Item = mongoose.model('Item');
        
        for (const requirement of booking.item_requirements) {
          if (!requirement.item) continue;
          
          const item = await Item.findById(requirement.item).session(session);
          if (!item) {
            console.warn(`Item ${requirement.item} not found`);
            continue;
          }
          
          console.log(`Processing item: ${item.name} (${item._id})`);
          
          // For consumable items, return the used quantity
          if (item.type === 'consumable' && requirement.quantity_needed) {
            item.available_quantity += requirement.quantity_needed;
            await item.save({ session });
            console.log(`Returned ${requirement.quantity_needed} of ${item.name} to inventory`);
          }
          // For equipment, mark as available
          else if (item.type === 'equipment') {
            item.status = 'available';
            await item.save({ session });
            console.log(`Marked ${item.name} as available`);
          }
        }
      }

      // Update booking status and metadata
      booking.status = 'completed';
      booking.completed_at = new Date();
      booking.completed_by = user_id;
      booking.updated_by = user_id;
      
      // Save the updated booking
      const updatedBooking = await booking.save({ session });
      await session.commitTransaction();
      session.endSession();
      
      // Populate the updated booking for the response
      const populatedBooking = await Booking.findById(updatedBooking._id)
        .populate('lab', 'name')
        .populate('user', 'full_name email')
        .populate('completed_by', 'full_name');

      // Create a notification for the booking user
      const notification = new Notification({
        user: booking.user._id,
        title: 'Booking Completed',
        message: `Your booking for ${booking.lab?.name || 'the lab'} has been marked as completed.`,
        type: 'booking_completed',
        related_entity: {
          type: 'booking',
          id: booking._id,
          name: `Booking #${booking.booking_number || booking._id.toString().slice(-6)}`
        },
        created_by: user_id
      });

      await notification.save({ session });

      // Emit real-time notification if socket.io is available
      if (req.io) {
        req.io.to(`user_${booking.user._id}`).emit('notification', {
          _id: notification._id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          is_read: notification.is_read,
          created_at: notification.created_at
        });
      }

      // Log the completion
      console.log(`Booking ${booking._id} marked as completed by user ${user_id}`);

      // Send success response
      res.status(200).json({
        success: true,
        message: 'Booking marked as completed successfully',
        data: populatedBooking
      });

  } catch (error) {
    console.error('=== ERROR COMPLETING BOOKING ===');
    console.error('Timestamp:', new Date().toISOString());
    console.error('Error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Request params:', JSON.stringify(req.params, null, 2));
    console.error('Request user:', JSON.stringify(req.user, null, 2));
    console.error('Request body:', JSON.stringify(req.body, null, 2));
    console.error('Session ID:', session.id);
    console.error('Mongoose connection state:', mongoose.connection.readyState);
    console.error('==============================');
    
    // Log the full error for debugging
    if (error.errors) {
      console.error('Validation Errors:', JSON.stringify(error.errors, null, 2));
    }
    if (error.code) {
      console.error('Error code:', error.code);
    }

    // Handle known error types
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.message,
        details: error.errors
      });
    }

    // Handle custom error response
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        error: error
      });
    }

    // Default error response
    res.status(500).json({
      success: false,
      message: 'Failed to complete booking',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });

  } finally {
    await session.endSession();
  }
};

// Get today's bookings
const getTodayBookings = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const filter = {
      status: { $in: ['pending', 'approved'] },
      start_time: { $gte: today, $lt: tomorrow }
    };
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      filter.lab = { $in: req.departmentScope.labIds || [] };
    }

    const bookings = await Booking.find(filter)
      .populate('lab', 'name code')
      .populate('field', 'name')
      .populate('user', 'full_name')
      .sort({ start_time: 1 });

    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    console.error('Get today\'s bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching today\'s bookings',
      errors: [error.message]
    });
  }
};

// Get upcoming bookings
const getUpcomingBookings = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const now = new Date();

    const filter = {
      status: { $in: ['pending', 'approved'] },
      start_time: { $gte: now }
    };
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      filter.lab = { $in: req.departmentScope.labIds || [] };
    }

    const bookings = await Booking.find(filter)
      .populate('lab', 'name code')
      .populate('field', 'name')
      .populate('user', 'full_name')
      .sort({ start_time: 1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    console.error('Get upcoming bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching upcoming bookings',
      errors: [error.message]
    });
  }
};

// Get booking calendar view
const getBookingCalendar = async (req, res) => {
  try {
    const { lab_id, month, year } = req.query;
    const startDate = new Date(year || new Date().getFullYear(), month ? month - 1 : new Date().getMonth(), 1);
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0, 23, 59, 59);
    
    const filter = {
      status: { $in: ['pending', 'approved'] },
      start_time: { $gte: startDate, $lte: endDate }
    };
    if (lab_id) filter.lab = lab_id;
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      filter.lab = { $in: req.departmentScope.labIds || [] };
    }

    const bookings = await Booking.find(filter)
      .populate('lab', 'name')
      .populate('field', 'name')
      .populate('user', 'full_name')
      .sort({ start_time: 1 });

    res.json({
      success: true,
      data: bookings
    });
  } catch (error) {
    console.error('Get booking calendar error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking calendar',
      errors: [error.message]
    });
  }
};

// Get pending bookings count
const getPendingBookingsCount = async (req, res) => {
  try {
    const filter = { status: 'pending' };
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      filter.lab = { $in: req.departmentScope.labIds || [] };
    }
    const count = await Booking.countDocuments(filter);
    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    console.error('Get pending bookings count error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending bookings count',
      errors: [error.message]
    });
  }
};

// Get lab utilization report
const getLabUtilizationReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const startDate = start_date ? new Date(start_date) : new Date();
    const endDate = end_date ? new Date(end_date) : new Date();
    
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const match = {
      status: 'approved',
      start_time: { $gte: startDate, $lte: endDate }
    };
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      match.lab = { $in: (req.departmentScope.labIds || []).map(id => new ObjectId(id)) };
    }

    const report = await Booking.aggregate([
      {
        $match: match
      },
      {
        $group: {
          _id: '$lab',
          total_hours: { 
            $sum: { 
              $divide: [
                { $subtract: ['$end_time', '$start_time'] },
                1000 * 60 * 60 // Convert milliseconds to hours
              ]
            }
          },
          booking_count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'labs',
          localField: '_id',
          foreignField: '_id',
          as: 'lab'
        }
      },
      { $unwind: '$lab' },
      {
        $project: {
          _id: 0,
          lab_id: '$_id',
          lab_name: '$lab.name',
          total_hours: 1,
          booking_count: 1,
          utilization_percentage: {
            $multiply: [
              { 
                $divide: [
                  { $multiply: ['$total_hours', 100] },
                  { $multiply: [168, 1] } // 168 hours in a week
                ]
              },
              1 // To ensure it's a number
            ]
          }
        }
      },
      { $sort: { total_hours: -1 } }
    ]);

    res.json({
      success: true,
      data: {
        start_date: startDate,
        end_date: endDate,
        report
      }
    });
  } catch (error) {
    console.error('Get lab utilization report error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating lab utilization report',
      errors: [error.message]
    });
  }
};

// Get booking statistics
const getBookingStats = async (req, res) => {
  try {
    const baseMatch = {};
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      baseMatch.lab = { $in: (req.departmentScope.labIds || []).map(id => new ObjectId(id)) };
    }

    const stats = await Booking.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total_hours: {
            $sum: { $divide: [ { $subtract: ['$end_time', '$start_time'] }, 1000 * 60 * 60 ] }
          }
        }
      }
    ]);

    const now = new Date();
    const totalBookings = await Booking.countDocuments(baseMatch);
    const upcomingMatch = { ...baseMatch, start_time: { $gte: now }, status: { $in: ['pending', 'approved'] } };
    const upcomingBookings = await Booking.countDocuments(upcomingMatch);

    res.json({ success: true, data: { stats, total_bookings: totalBookings, upcoming_bookings: upcomingBookings } });
  } catch (error) {
    console.error('Get booking stats error:', error);
    res.status(500).json({ success: false, message: 'Error fetching booking statistics', errors: [error.message] });
  }
};

// Check lab availability
const checkLabAvailability = async (req, res) => {
  try {
    const { lab_id, start_time, end_time, exclude_booking_id } = req.query;

    if (!lab_id || !start_time || !end_time) {
      return res.status(400).json({ success: false, message: 'lab_id, start_time and end_time are required' });
    }

    // Department scope enforcement for non-admins
    if (req.user && req.user.role !== 'admin' && req.departmentScope && !req.departmentScope.global) {
      const allowed = (req.departmentScope.labIds || []).map(id => id.toString());
      if (!allowed.includes(lab_id.toString())) {
        return res.status(403).json({ success: false, message: 'Access denied: lab is outside your department' });
      }
    }

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate >= endDate) {
      return res.status(400).json({ success: false, message: 'Invalid time range' });
    }

    const query = {
      lab: lab_id,
      status: { $in: ['pending', 'approved'] },
      $or: [
        { start_time: { $lt: endDate }, end_time: { $gt: startDate } },
        { end_time: { $gt: startDate }, start_time: { $lt: endDate } },
        { start_time: { $lte: startDate }, end_time: { $gte: endDate } }
      ]
    };
    if (exclude_booking_id) query._id = { $ne: exclude_booking_id };

    const conflicting = await Booking.find(query)
      .populate('user', 'full_name email')
      .populate('lab', 'name')
      .populate('field', 'name')
      .sort({ start_time: 1 });

    return res.json({
      success: true,
      data: {
        is_available: conflicting.length === 0,
        conflicting_bookings: conflicting,
        requested_slot: {
          start_time: startDate,
          end_time: endDate,
          duration_minutes: (endDate - startDate) / (1000 * 60)
        }
      }
    });
  } catch (error) {
    console.error('Check lab availability error:', error);
    res.status(500).json({ success: false, message: 'Error checking lab availability', errors: [error.message] });
  }
};

// Get my bookings (for current user)
const getMyBookings = async (req, res) => {
  try {
    const user_id = req.user.id || req.user._id;
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { user: user_id };
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const totalCount = await Booking.countDocuments(filter);

    const bookings = await Booking.find(filter)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .sort({ start_time: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: {
        bookings,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get my bookings error:', error);
    res.status(500).json({ success: false, message: 'Error fetching your bookings', errors: [error.message] });
  }
};

module.exports = {
  completeBooking,
  getAllBookings,
  getBookingById,
  createBooking,
  updateBookingStatus,
  approveBooking,
  rejectBooking,
  cancelBooking,
  // restored handlers referenced by routes
  checkLabAvailability,
  getMyBookings,
  getBookingStats,
  getTodayBookings,
  getUpcomingBookings,
  getBookingCalendar,
  getPendingBookingsCount,
  getLabUtilizationReport
};