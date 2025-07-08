const Booking = require('../models/Booking');
const Lab = require('../models/Lab');
const Field = require('../models/Field');
const User = require('../models/User');
const Item = require('../models/Item');
const StockLog = require('../models/StockLog');
const { validationResult } = require('express-validator');
const { 
  sendBookingNotificationToAdmin, 
  sendBookingStatusUpdate 
} = require('../utils/notifications');
const moment = require('moment-timezone');
const mongoose = require('mongoose');
const { Types: { ObjectId } } = require('mongoose');

// Get all bookings with filters
const getAllBookings = async (req, res) => {
  try {
    const {
      lab_id, field_id, user_id, status, booking_type,
      start_date, end_date, page = 1, limit = 20
    } = req.query;
    const filter = {};

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

    // Department admin: only bookings for labs in their department
    if (req.user && req.user.role === 'department_admin') {
      const labs = await Lab.find({ department: req.user.department._id }).select('_id');
      const labIds = labs.map(l => l._id);
      filter.lab = { $in: labIds };
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
      approved_by: b.approved_by?.full_name || null
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
        await sendBookingNotificationToAdmin(booking, req.user);
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

      // Send notifications in the background without awaiting
      sendBookingNotificationToAdmin(populatedBooking, req.user)
        .catch(err => console.error('Background notification error:', err));

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
    if (sendBookingStatusUpdate) {
      await sendBookingStatusUpdate(booking, booking.user, status, rejection_reason);
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
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { notes } = req.body;
    const { id } = req.params;
    const admin_id = req.user.id;

    // Find and validate booking
    const booking = await Booking.findById(id).session(session);
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

    // Process item requirements
    for (const req of booking.item_requirements) {
      const item = await Item.findById(req.item).session(session);
      if (!item) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Item ${req.item} not found`
        });
      }

      // For consumable items, reduce available quantity
      if (item.type === 'consumable') {
        if (item.available_quantity < req.quantity_needed) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for item: ${item.name}`,
            item: {
              id: item._id,
              name: item.name,
              available: item.available_quantity,
              required: req.quantity_needed
            }
          });
        }

        // Reduce available quantity
        item.available_quantity -= req.quantity_needed;
        
        // Update item status if needed
        if (item.available_quantity <= item.minimum_quantity) {
          item.status = item.available_quantity === 0 ? 'out_of_stock' : 'low_stock';
        }

        await item.save({ session });

        // Create stock log entry
        const stockLog = new StockLog({
          item: item._id,
          user: admin_id,
          lab: booking.lab,
          change_quantity: -req.quantity_needed,
          reason: 'Booking approved',
          notes: `Booking ID: ${booking._id}`,
          type: 'remove',
          reference_id: booking._id
        });
        await stockLog.save({ session });
      }
      // For non-consumable items, ensure they're available and not in maintenance
      else if (item.type === 'equipment') {
        if (item.status === 'in_maintenance') {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Cannot approve booking: ${item.name} is under maintenance`,
            item: {
              id: item._id,
              name: item.name,
              status: item.status
            }
          });
        }
        item.status = 'in_use';
        await item.save({ session });
      }
    }

    // Update booking status
    booking.status = 'approved';
    booking.approved_by = admin_id;
    booking.approved_at = new Date();
    booking.special_instructions = notes || booking.special_instructions;
    
    await booking.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Populate booking details for response
    const populatedBooking = await Booking.findById(id)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('user', 'full_name email')
      .populate('approved_by', 'full_name email')
      .populate('item_requirements.item', 'name type');

    // Send notification to user about approval
    if (sendBookingStatusUpdate) {
      await sendBookingStatusUpdate(populatedBooking, populatedBooking.user, 'approved');
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
    res.status(500).json({
      success: false,
      message: 'Error approving booking',
      errors: [error.message]
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

// Cancel booking
const cancelBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Only allow cancellation if user owns the booking or is admin/lab_manager
    if (booking.user.toString() !== user_id && !['admin', 'lab_manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You can only cancel your own bookings'
      });
    }

    // Check if booking can be cancelled (not too close to start time)
    const now = new Date();
    const timeUntilStart = booking.start_time - now;
    const hoursUntilStart = timeUntilStart / (1000 * 60 * 60);

    if (hoursUntilStart < 24 && !['admin', 'lab_manager'].includes(req.user.role)) {
      return res.status(400).json({
        success: false,
        message: 'Bookings can only be cancelled at least 24 hours before start time'
      });
    }

    booking.status = 'cancelled';
    await booking.save();

    const populatedBooking = await Booking.findById(id)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('user', 'full_name email');

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: populatedBooking
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error cancelling booking',
      errors: [error.message]
    });
  }
};

// Check lab availability
const checkLabAvailability = async (req, res) => {
  try {
    const { lab_id, start_time, end_time, booking_id } = req.body;

    if (!lab_id || !start_time || !end_time) {
      return res.status(400).json({
        success: false,
        message: 'Lab ID, start time, and end time are required'
      });
    }

    const startDate = new Date(start_time);
    const endDate = new Date(end_time);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid date format. Please use ISO 8601 format (e.g., 2023-01-01T09:00:00.000Z)'
      });
    }

    if (startDate >= endDate) {
      return res.status(400).json({
        success: false,
        message: 'End time must be after start time'
      });
    }

    // Check for conflicting bookings
    const query = {
      lab: lab_id,
      status: { $in: ['pending', 'approved'] },
      $or: [
        { start_time: { $lt: endDate }, end_time: { $gt: startDate } }
      ]
    };

    // Exclude current booking when checking for updates
    if (booking_id) {
      query._id = { $ne: booking_id };
    }

    const conflictingBookings = await Booking.find(query)
      .populate('user', 'full_name email')
      .populate('lab', 'name')
      .populate('field', 'name')
      .sort({ start_time: 1 });

    res.json({
      success: true,
      data: {
        is_available: conflictingBookings.length === 0,
        conflicting_bookings: conflictingBookings,
        requested_slot: {
          start_time: startDate,
          end_time: endDate,
          duration_minutes: (endDate - startDate) / (1000 * 60)
        }
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

// Get my bookings (for current user)
const getMyBookings = async (req, res) => {
  try {
    const user_id = req.user.id;
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
    res.status(500).json({
      success: false,
      message: 'Error fetching your bookings',
      errors: [error.message]
    });
  }
};

// Get booking statistics
const getBookingStats = async (req, res) => {
  try {
    const stats = await Booking.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total_hours: { $sum: { $divide: [{ $subtract: ['$end_time', '$start_time'] }, 1000 * 60 * 60] } }
        }
      }
    ]);

    const totalBookings = await Booking.countDocuments();
    const upcomingBookings = await Booking.countDocuments({
      start_time: { $gte: new Date() },
      status: { $in: ['pending', 'approved'] }
    });

    res.json({
      success: true,
      data: {
        stats,
        total_bookings: totalBookings,
        upcoming_bookings: upcomingBookings
      }
    });
  } catch (error) {
    console.error('Get booking stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching booking statistics',
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
    const count = await Booking.countDocuments({ status: 'pending' });
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

// Get today's bookings
const getTodayBookings = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const bookings = await Booking.find({
      status: { $in: ['pending', 'approved'] },
      start_time: { $gte: today, $lt: tomorrow }
    })
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

    const bookings = await Booking.find({
      status: { $in: ['pending', 'approved'] },
      start_time: { $gte: now }
    })
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

// Get lab utilization report
const getLabUtilizationReport = async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const startDate = start_date ? new Date(start_date) : new Date();
    const endDate = end_date ? new Date(end_date) : new Date();
    
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const report = await Booking.aggregate([
      {
        $match: {
          status: 'approved',
          start_time: { $gte: startDate, $lte: endDate }
        }
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

// Get available time slots for a lab within a date range
const getAvailableTimeSlots = async (req, res) => {
  try {
    // ... (rest of the code remains the same)

    // Get existing bookings for the day
    const existingBookings = await Booking.find({
      lab: lab_id,
      status: { $in: ['approved', 'pending'] },
      $or: [
        {
          // Bookings that start or end on the target date
          $or: [
            { start_time: { $gte: dayStart.toDate(), $lt: dayEnd.toDate() } },
            { end_time: { $gt: dayStart.toDate(), $lte: dayEnd.toDate() } },
            { 
              // Multi-day bookings that span the target date
              start_time: { $lte: dayStart.toDate() },
              end_time: { $gte: dayEnd.toDate() }
            }
          ]
        }
      ]
    }).sort({ start_time: 1 });

    // Generate time slots based on operating hours and existing bookings
    const slotDuration = duration; // in minutes
    const slotInterval = 15; // minutes between slots
    const slots = [];
    
    let currentSlotStart = dayStart.clone();
    
    while (currentSlotStart.isBefore(dayEnd)) {
      const slotEnd = currentSlotStart.clone().add(slotDuration, 'minutes');
      
      // Skip if slot goes beyond operating hours
      if (slotEnd.isAfter(dayEnd)) {
        break;
      }
      
      // Check if this slot is available
      const isAvailable = !existingBookings.some(booking => {
        const bookingStart = moment(booking.start_time);
        const bookingEnd = moment(booking.end_time);
        return (
          (currentSlotStart.isBetween(bookingStart, bookingEnd, null, '[)')) ||
          (slotEnd.isBetween(bookingStart, bookingEnd, null, '(]')) ||
          (bookingStart.isBetween(currentSlotStart, slotEnd, null, '[]'))
        );
      });
      
      if (isAvailable) {
        slots.push({
          start_time: currentSlotStart.toISOString(),
          end_time: slotEnd.toISOString(),
          duration_minutes: slotDuration,
          is_available: true
        });
        
        // Skip ahead to next potential slot
        currentSlotStart = slotEnd.clone();
      } else {
        // Move to next time slot
        currentSlotStart = currentSlotStart.add(slotInterval, 'minutes');
      }
    }
    
    // Group available slots into continuous blocks
    const continuousSlots = [];
    if (slots.length > 0) {
      let currentBlock = { ...slots[0], slots: [slots[0]] };
      
      for (let i = 1; i < slots.length; i++) {
        const prevEnd = moment(currentBlock.end_time);
        const currStart = moment(slots[i].start_time);
        
        if (currStart.diff(prevEnd, 'minutes') <= slotInterval) {
          // Extend current block
          currentBlock.end_time = slots[i].end_time;
          currentBlock.duration_minutes = moment(currentBlock.end_time).diff(
            moment(currentBlock.start_time), 'minutes'
          );
          currentBlock.slots.push(slots[i]);
        } else {
          // Start new block
          continuousSlots.push(currentBlock);
          currentBlock = { ...slots[i], slots: [slots[i]] };
        }
      }
      
      // Add the last block
      continuousSlots.push(currentBlock);
    }
    
    res.json({
      success: true,
      data: {
        lab: {
          id: lab._id,
          name: lab.name,
          operating_hours: operatingHours
        },
        date: targetDate.format('YYYY-MM-DD'),
        timezone: timezone,
        duration_minutes: duration,
        available_slots: continuousSlots,
        total_available_slots: continuousSlots.reduce((sum, block) => sum + block.slots.length, 0),
        total_available_minutes: continuousSlots.reduce((sum, block) => sum + block.duration_minutes, 0)
      }
    });
    
  } catch (error) {
    console.error('Get available time slots error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching available time slots',
      errors: [error.message],
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

module.exports = {
  getAllBookings,
  getBookingById,
  createBooking,
  updateBookingStatus,
  approveBooking,
  rejectBooking,
  cancelBooking,
  checkLabAvailability,
  getAvailableTimeSlots,
  getMyBookings,
  getBookingStats,
  getBookingCalendar,
  getPendingBookingsCount,
  getTodayBookings,
  getUpcomingBookings,
  getLabUtilizationReport
};