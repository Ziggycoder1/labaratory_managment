const Booking = require('../models/Booking');
const Lab = require('../models/Lab');
const Field = require('../models/Field');
const User = require('../models/User');
const Item = require('../models/Item');
const { validationResult } = require('express-validator');
const { 
  sendBookingNotificationToAdmin, 
  sendBookingStatusUpdate 
} = require('../utils/notifications');

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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { 
      lab_id, field_id, start_time, end_time, purpose, booking_type,
      participants_count, equipment_needed, item_requirements, 
      special_instructions, setup_time_needed, cleanup_time_needed,
      is_recurring, recurring_pattern
    } = req.body;
    const user_id = req.user.id;

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

    // Validate item requirements and check availability
    if (item_requirements && item_requirements.length > 0) {
      for (const requirement of item_requirements) {
        const item = await Item.findById(requirement.item);
        if (!item) {
          return res.status(400).json({
            success: false,
            message: `Item with ID ${requirement.item} not found`
          });
        }
        
        if (item.available_quantity < requirement.quantity_needed) {
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for item ${item.name}. Available: ${item.available_quantity}, Required: ${requirement.quantity_needed}`
          });
        }
      }
    }

    // Create booking data
    const bookingData = {
      lab: lab_id,
      field: field_id,
      user: user_id,
      start_time: new Date(start_time),
      end_time: new Date(end_time),
      purpose,
      booking_type: booking_type || 'other',
      participants_count: participants_count || 1,
      equipment_needed,
      item_requirements: item_requirements || [],
      special_instructions,
      setup_time_needed: setup_time_needed || 0,
      cleanup_time_needed: cleanup_time_needed || 0,
      is_recurring: is_recurring || false,
      recurring_pattern: recurring_pattern || null
    };

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

      // Send notification to admin
      await sendBookingNotificationToAdmin(populatedBooking, req.user);

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

// Update booking status (approve/reject)
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
    await sendBookingStatusUpdate(booking, booking.user, status, rejection_reason);

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
  try {
    const { notes, allocated_consumables } = req.body;
    const { id } = req.params;
    const admin_id = req.user.id;

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking is already approved or rejected
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Booking is already ${booking.status}`
      });
    }

    // Update booking with approval details
    booking.status = 'approved';
    booking.approved_by = admin_id;
    booking.approved_at = new Date();
    booking.special_instructions = notes || booking.special_instructions;
    
    // Add allocated consumables if provided
    if (allocated_consumables && allocated_consumables.length > 0) {
      booking.allocated_consumables = allocated_consumables.map(consumable => ({
        item: consumable.item_id,
        quantity: consumable.quantity,
        allocated_at: new Date()
      }));
    }

    await booking.save();

    const populatedBooking = await Booking.findById(id)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('user', 'full_name email')
      .populate('approved_by', 'full_name email')
      .populate('item_requirements.item', 'name type')
      .populate('allocated_consumables.item', 'name type');

    // Send notification to user about approval
    await sendBookingStatusUpdate(populatedBooking, populatedBooking.user, 'approved');

    res.json({
      success: true,
      message: 'Booking approved successfully',
      data: {
        id: populatedBooking._id,
        status: populatedBooking.status,
        approved_at: populatedBooking.approved_at,
        notes: populatedBooking.special_instructions,
        allocated_consumables: populatedBooking.allocated_consumables
      }
    });
  } catch (error) {
    console.error('Approve booking error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving booking',
      errors: [error.message]
    });
  }
};

// Reject booking (Lab Manager only)
const rejectBooking = async (req, res) => {
  try {
    const { reason } = req.body;
    const { id } = req.params;
    const admin_id = req.user.id;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking is already approved or rejected
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Booking is already ${booking.status}`
      });
    }

    // Update booking with rejection details
    booking.status = 'rejected';
    booking.approved_by = admin_id;
    booking.approved_at = new Date();
    booking.rejection_reason = reason;

    await booking.save();

    const populatedBooking = await Booking.findById(id)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('user', 'full_name email')
      .populate('approved_by', 'full_name email')
      .populate('item_requirements.item', 'name type');

    // Send notification to user about rejection
    await sendBookingStatusUpdate(populatedBooking, populatedBooking.user, 'rejected', reason);

    res.json({
      success: true,
      message: 'Booking rejected',
      data: {
        id: populatedBooking._id,
        status: populatedBooking.status,
        rejection_reason: populatedBooking.rejection_reason,
        rejected_at: populatedBooking.approved_at
      }
    });
  } catch (error) {
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

// Check lab availability with enhanced details
const checkLabAvailability = async (req, res) => {
  try {
    const { lab_id, start_time, end_time, exclude_booking_id } = req.query;

    if (!lab_id || !start_time || !end_time) {
      return res.status(400).json({
        success: false,
        message: 'Lab ID, start time, and end time are required'
      });
    }

    const filter = {
      lab: lab_id,
      status: { $in: ['pending', 'approved'] },
      $or: [
        {
          start_time: { $lt: new Date(end_time) },
          end_time: { $gt: new Date(start_time) }
        }
      ]
    };

    if (exclude_booking_id) {
      filter._id = { $ne: exclude_booking_id };
    }

    const overlappingBookings = await Booking.find(filter)
      .populate('field', 'name code')
      .populate('user', 'full_name')
      .populate('item_requirements.item', 'name type')
      .lean();

    // Get lab details
    const lab = await Lab.findById(lab_id).populate('fields');

    res.json({
      success: true,
      data: {
        available: overlappingBookings.length === 0,
        conflicting_bookings: overlappingBookings,
        lab_details: lab,
        requested_time: {
          start: start_time,
          end: end_time,
          duration_hours: (new Date(end_time) - new Date(start_time)) / (1000 * 60 * 60)
        }
      }
    });
  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking availability',
      errors: [error.message]
    });
  }
};

// Get my bookings (for current user)
const getMyBookings = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { status, booking_type, page = 1, limit = 20 } = req.query;
    
    const filter = { user: user_id };
    if (status) filter.status = status;
    if (booking_type) filter.booking_type = booking_type;

    const skip = (page - 1) * limit;
    const totalCount = await Booking.countDocuments(filter);
    
    const bookings = await Booking.find(filter)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('item_requirements.item', 'name type')
      .sort({ start_time: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

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
    const { lab_id, start_date, end_date } = req.query;
    const filter = {};
    
    if (lab_id) filter.lab = lab_id;
    if (start_date || end_date) {
      filter.start_time = {};
      if (start_date) filter.start_time.$gte = new Date(start_date);
      if (end_date) filter.start_time.$lte = new Date(end_date);
    }

    const stats = await Booking.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total_hours: { $sum: { $divide: [{ $subtract: ['$end_time', '$start_time'] }, 1000 * 60 * 60] } }
        }
      }
    ]);

    const totalBookings = await Booking.countDocuments(filter);
    const upcomingBookings = await Booking.countDocuments({
      ...filter,
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
    const { lab_id, month, view = 'month' } = req.query;
    // Parse month (YYYY-MM) or use current month
    let startDate, endDate;
    if (month) {
      const [year, mon] = month.split('-').map(Number);
      startDate = new Date(year, mon - 1, 1);
      endDate = new Date(year, mon, 0, 23, 59, 59, 999);
    } else {
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }
    console.log('Calendar Query Range:', { startDate, endDate });
    const filter = {
      status: { $in: ['pending', 'approved'] },
      start_time: { $gte: startDate, $lte: endDate }
    };
    if (lab_id) filter.lab = lab_id;

    // Populate field and user for names
    const bookings = await Booking.find(filter)
      .populate('field', 'name')
      .populate('user', 'full_name')
      .sort({ start_time: 1 })
      .lean();
    console.log('Bookings found:', bookings.map(b => ({
      _id: b._id,
      start_time: b.start_time,
      end_time: b.end_time,
      status: b.status
    })));

    // Group bookings by date
    const calendarMap = {};
    bookings.forEach(booking => {
      const dateKey = new Date(booking.start_time).toISOString().split('T')[0];
      if (!calendarMap[dateKey]) calendarMap[dateKey] = [];
      calendarMap[dateKey].push({
        id: booking._id,
        start_time: new Date(booking.start_time).toISOString().substr(11, 5),
        end_time: new Date(booking.end_time).toISOString().substr(11, 5),
        field_name: booking.field?.name || '',
        user_name: booking.user?.full_name || '',
        status: booking.status
      });
    });
    // Convert to array format
    const calendar_data = Object.keys(calendarMap).map(date => ({
      date,
      bookings: calendarMap[date]
    }));

    // Statistics
    const total_bookings = bookings.length;
    const approved_bookings = bookings.filter(b => b.status === 'approved').length;
    const pending_bookings = bookings.filter(b => b.status === 'pending').length;
    // Utilization rate: sum of booking hours / total available hours in month (lab open 8am-8pm, 12h/day)
    let utilization_rate = 0;
    if (total_bookings > 0) {
      const totalBookedHours = bookings.reduce((sum, b) => sum + ((new Date(b.end_time) - new Date(b.start_time)) / (1000 * 60 * 60)), 0);
      const daysInMonth = (endDate.getDate() - startDate.getDate() + 1);
      const totalAvailableHours = daysInMonth * 12; // 12 hours per day
      utilization_rate = totalAvailableHours > 0 ? (totalBookedHours / totalAvailableHours) * 100 : 0;
      utilization_rate = Math.round(utilization_rate * 10) / 10;
    }

    res.json({
      success: true,
      data: {
        calendar_data,
        statistics: {
          total_bookings,
          approved_bookings,
          pending_bookings,
          utilization_rate
        }
      }
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

// Get pending bookings count (for admin dashboard)
const getPendingBookingsCount = async (req, res) => {
  try {
    const count = await Booking.countDocuments({ status: 'pending' });
    
    res.json({
      success: true,
      data: {
        pending_count: count
      }
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
    const { lab_id } = req.query;
    
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    
    const filter = {
      start_time: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ['pending', 'approved'] }
    };
    
    if (lab_id) filter.lab = lab_id;

    const bookings = await Booking.find(filter)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('user', 'full_name email')
      .populate('item_requirements.item', 'name type')
      .sort({ start_time: 1 })
      .lean();

    res.json({
      success: true,
      data: {
        bookings,
        total: bookings.length,
        date: today.toISOString().split('T')[0]
      }
    });
  } catch (error) {
    console.error('Get today bookings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching today bookings',
      errors: [error.message]
    });
  }
};

// Get upcoming bookings (next 7 days)
const getUpcomingBookings = async (req, res) => {
  try {
    const { lab_id, limit = 10 } = req.query;
    
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const filter = {
      start_time: { $gte: now, $lte: nextWeek },
      status: { $in: ['pending', 'approved'] }
    };
    
    if (lab_id) filter.lab = lab_id;

    const bookings = await Booking.find(filter)
      .populate('lab', 'name code')
      .populate('field', 'name code')
      .populate('user', 'full_name email')
      .populate('item_requirements.item', 'name type')
      .sort({ start_time: 1 })
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        bookings,
        total: bookings.length,
        date_range: {
          start: now.toISOString(),
          end: nextWeek.toISOString()
        }
      }
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
    const { lab_id, start_date, end_date } = req.query;
    
    const filter = {
      status: 'approved'
    };
    
    if (lab_id) filter.lab = lab_id;
    if (start_date && end_date) {
      filter.start_time = {
        $gte: new Date(start_date),
        $lte: new Date(end_date)
      };
    }

    const bookings = await Booking.find(filter)
      .populate('lab', 'name code capacity')
      .lean();

    // Calculate utilization
    const labUtilization = {};
    
    bookings.forEach(booking => {
      const labId = booking.lab._id.toString();
      const duration = (new Date(booking.end_time) - new Date(booking.start_time)) / (1000 * 60 * 60); // hours
      
      if (!labUtilization[labId]) {
        labUtilization[labId] = {
          lab: booking.lab,
          total_hours: 0,
          total_bookings: 0,
          total_participants: 0,
          average_duration: 0
        };
      }
      
      labUtilization[labId].total_hours += duration;
      labUtilization[labId].total_bookings += 1;
      labUtilization[labId].total_participants += booking.participants_count;
    });

    // Calculate averages
    Object.values(labUtilization).forEach(lab => {
      lab.average_duration = lab.total_bookings > 0 ? lab.total_hours / lab.total_bookings : 0;
      lab.utilization_percentage = lab.total_hours > 0 ? (lab.total_hours / (24 * 30)) * 100 : 0; // Assuming 30 days
    });

    res.json({
      success: true,
      data: {
        lab_utilization: Object.values(labUtilization),
        total_labs: Object.keys(labUtilization).length,
        total_hours: Object.values(labUtilization).reduce((sum, lab) => sum + lab.total_hours, 0),
        total_bookings: Object.values(labUtilization).reduce((sum, lab) => sum + lab.total_bookings, 0)
      }
    });
  } catch (error) {
    console.error('Get lab utilization report error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching lab utilization report',
      errors: [error.message]
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
  getMyBookings,
  getBookingStats,
  getBookingCalendar,
  getPendingBookingsCount,
  getTodayBookings,
  getUpcomingBookings,
  getLabUtilizationReport
}; 