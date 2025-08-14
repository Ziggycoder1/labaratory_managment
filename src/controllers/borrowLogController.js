const mongoose = require('mongoose');
const BorrowLog = require('../models/BorrowLog');
const Item = require('../models/Item');
const User = require('../models/User');
const Lab = require('../models/Lab');
const StockLog = require('../models/StockLog');
const { validationResult } = require('express-validator');
const { calculateFine } = require('../utils/fineCalculator');
const { createNotification, sendBorrowStatusUpdate } = require('../utils/notifications');

// Get all borrow logs with unified role-based access control
const getAllBorrowLogs = async (req, res) => {
  try {
    const { item_id, user_id, lab_id, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    
    // Always filter by item_id if provided
    if (item_id) filter.item = item_id;
    
    // Apply role-based filtering
    switch (req.user.role) {
      case 'admin':
        // Admins can see all borrow logs
        if (user_id) filter.user = user_id;
        break;
        
      case 'lab_manager':
      case 'department_admin':
        // Lab managers and department admins can see logs from their labs
        const labs = req.user.managed_labs || [];
        if (req.user.role === 'department_admin' && req.user.department) {
          // For department admins, get all labs in their department
          const departmentLabs = await Lab.find({ department: req.user.department }).select('_id');
          departmentLabs.forEach(lab => {
            if (!labs.includes(lab._id)) labs.push(lab._id);
          });
        }
        
        if (labs.length > 0) {
          filter.lab = { $in: labs };
          // If user_id is provided, further filter by user
          if (user_id) filter.user = user_id;
        } else {
          // No accessible labs, return empty result
          return res.json({
            success: true,
            data: {
              borrowLogs: [],
              pagination: {
                current_page: parseInt(page),
                total_pages: 0,
                total_count: 0,
                per_page: parseInt(limit)
              }
            }
          });
        }
        break;
        
      case 'teacher':
      case 'student':
      case 'external':
      default:
        // Regular users can only see their own borrow logs
        filter.user = req.user.id;
        break;
    }
    
    // Additional filters
    if (lab_id) filter.lab = lab_id;
    if (status) filter.status = status;
    
    // For admins and lab managers, if no results with current filters, show all accessible requests
    let totalCount = await BorrowLog.countDocuments(filter);
    if (totalCount === 0 && ['admin', 'lab_manager', 'department_admin'].includes(req.user.role)) {
      // Remove user filter but keep other filters (like lab filters)
      const { user, ...otherFilters } = filter;
      totalCount = await BorrowLog.countDocuments(otherFilters);
      
      // If we found results without the user filter, update the filter
      if (totalCount > 0) {
        Object.assign(filter, otherFilters);
      }
    }

    const skip = (page - 1) * limit;
    
    const borrowLogs = await BorrowLog.find(filter)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .populate('lab', 'name code')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        borrowLogs,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get borrow logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching borrow logs',
      errors: [error.message]
    });
  }
};

// Get specific borrow log
const getBorrowLogById = async (req, res) => {
  try {
    const borrowLog = await BorrowLog.findById(req.params.id)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .populate('lab', 'name code')
      .lean();

    if (!borrowLog) {
      return res.status(404).json({
        success: false,
        message: 'Borrow log not found'
      });
    }

    res.json({
      success: true,
      data: borrowLog
    });
  } catch (error) {
    console.error('Get borrow log error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching borrow log',
      errors: [error.message]
    });
  }
};

// Request to borrow an item
const borrowItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { item_id, lab_id, expected_return_date, condition_before, notes } = req.body;
    const user_id = req.user.id;

    // Check if item exists and is available
    const item = await Item.findById(item_id).session(session);
    if (!item) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Check if item is available for borrowing
    if (item.status !== 'available' && item.available_quantity <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Item is not available for borrowing'
      });
    }

    // Check if lab exists
    const lab = await Lab.findById(lab_id).session(session);
    if (!lab) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Lab not found'
      });
    }

    // Create borrow log
    const borrowLog = new BorrowLog({
      item: item_id,
      user: user_id,
      lab: lab_id,
      expected_return_date,
      condition_before,
      notes,
      status: 'pending' // Initial status is pending
    });

    await borrowLog.save({ session });

    // Send notification to requester and lab managers
    await sendBorrowStatusUpdate(
      {
        ...borrowLog.toObject(),
        item: { _id: item._id, name: item.name },
        lab: lab._id,
        user: user_id
      },
      req.user,
      'pending',
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      success: true,
      message: 'Borrow request submitted successfully. Waiting for approval.',
      data: borrowLog
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Borrow item error:', error);
    res.status(500).json({
      success: false,
      message: 'Error borrowing item',
      errors: [error.message]
    });
  } finally {
    session.endSession();
  }
};

// Approve a borrow request (Lab Manager)
const approveBorrowRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { notes } = req.body;

    // 1. Input validation
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid borrow request ID',
      });
    }

    console.log(`Approving borrow request ${id} by user ${req.user.id}`);

    // 2. Find the borrow log with item and user populated
    const borrowLog = await BorrowLog.findById(id)
      .populate('item')
      .populate('user', 'name email')
      .session(session);

    if (!borrowLog) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Borrow request not found',
      });
    }

    // 3. Check current status
    if (borrowLog.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `Borrow request is already ${borrowLog.status}`,
      });
    }

    const item = borrowLog.item;
    const isConsumable = item.item_type === 'consumable';

    console.log(`Processing ${isConsumable ? 'consumable' : 'non-consumable'} item:`, {
      itemId: item._id,
      currentQuantity: item.quantity_available,
      isConsumable,
    });

    // 4. Handle item quantity update if consumable
    if (isConsumable) {
      if (item.quantity_available < 1) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock available for this item',
        });
      }

      // Update item quantity
      item.quantity_available -= 1;
      
      try {
        await item.save({ session });
        console.log('Item quantity updated successfully');
      } catch (itemError) {
        console.error('Error updating item quantity:', itemError);
        await session.abortTransaction();
        return res.status(500).json({
          success: false,
          message: 'Error updating item quantity',
          error: itemError.message,
        });
      }

      // Create stock log
      const stockLog = new StockLog({
        item: item._id,
        user: req.user.id,
        lab: borrowLog.lab,
        change_quantity: -1,
        reason: 'borrow_approved',
        notes: `Item borrowed by user ${borrowLog.user._id} (${borrowLog.user.name || 'Unknown'})`,
        type: 'adjustment',
        reference_id: borrowLog._id,
        created_by: req.user.id,
        updated_by: req.user.id,
      });

      try {
        await stockLog.save({ session });
        console.log('Stock log created successfully');
      } catch (stockLogError) {
        console.error('Error creating stock log:', stockLogError);
        await session.abortTransaction();
        return res.status(500).json({
          success: false,
          message: 'Error creating stock log',
          error: stockLogError.message,
        });
      }
    }

    // 5. Update borrow log status
    borrowLog.status = 'borrowed';
    borrowLog.approved_by = req.user.id;
    borrowLog.approved_at = new Date();
    borrowLog.notes = notes || borrowLog.notes;

    try {
      await borrowLog.save({ session });
      console.log('Borrow log updated successfully');
    } catch (borrowLogError) {
      console.error('Error updating borrow log:', borrowLogError);
      await session.abortTransaction();
      return res.status(500).json({
        success: false,
        message: 'Error updating borrow request',
        error: borrowLogError.message,
      });
    }

    // 6. Create notification
    try {
      await createNotification({
        user: borrowLog.user._id,
        type: 'borrow_approved',
        title: 'Borrow Request Approved',
        message: `Your request to borrow ${item.name} has been approved`,
        data: {
          item_id: item._id,
          item_name: item.name,
          approved_by: req.user.id,
          approved_at: new Date(),
          expected_return_date: borrowLog.expected_return_date,
          borrow_id: borrowLog._id,
        },
        action_url: `/borrow-requests/${borrowLog._id}`,
        related_item: item._id,
        related_lab: borrowLog.lab,
        priority: 'high',
        session,
      });
      console.log('Notification created successfully');
    } catch (notificationError) {
      // Don't fail the entire operation if notification fails
      console.error('Error creating notification:', notificationError);
    }

    // 7. Commit the transaction
    await session.commitTransaction();
    console.log('Borrow approval completed successfully');

    return res.json({
      success: true,
      message: 'Borrow request approved successfully',
      data: borrowLog,
    });
  } catch (error) {
    console.error('Error in approveBorrowRequest:', {
      error: error.message,
      stack: error.stack,
      request: {
        params: req.params,
        body: req.body,
        user: req.user ? { id: req.user.id, role: req.user.role } : 'no user',
      },
    });

    await session.abortTransaction();
    
    return res.status(500).json({
      success: false,
      message: 'Error approving borrow request',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  } finally {
    session.endSession();
  }
};

// Reject a borrow request (Lab Manager)
const rejectBorrowRequest = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a reason for rejection'
      });
    }
    
    const borrowLog = await BorrowLog.findById(id).session(session);
    
    if (!borrowLog) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Borrow request not found'
      });
    }

    if (borrowLog.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'This request has already been processed'
      });
    }

    // Update borrow log
    borrowLog.status = 'rejected';
    borrowLog.rejected_by = req.user.id;
    borrowLog.rejected_at = new Date();
    borrowLog.rejected_reason = reason;
    
    await borrowLog.save({ session });

    // Create notification for requester
    await createNotification({
      user: borrowLog.user,
      type: 'borrow_rejected',
      title: 'Borrow Request Rejected',
      message: `Your request to borrow an item has been rejected. Reason: ${reason}`,
      data: {
        rejected_by: req.user.id,
        rejected_at: new Date(),
        rejected_reason: reason,
        item_id: borrowLog.item,
        request_date: borrowLog.created_at
      },
      action_url: `/borrow-requests/${borrowLog._id}`
    });

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'Borrow request rejected',
      data: borrowLog
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Reject borrow request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting borrow request',
      errors: [error.message]
    });
  } finally {
    session.endSession();
  }
};

// Return an item
const returnItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { id } = req.params;
    const { condition_after, damage_notes } = req.body;
    
    // Input validation
    if (!condition_after) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Please provide the condition of the returned item',
      });
    }
    
    // Find the borrow log with item and user populated
    const borrowLog = await BorrowLog.findById(id)
      .populate('item')
      .populate('user', 'name email')
      .session(session);
    
    if (!borrowLog) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Borrow record not found',
      });
    }

    if (borrowLog.status !== 'borrowed') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'This item is not currently borrowed',
      });
    }

    // Get item to update quantity
    const item = borrowLog.item;
    const isConsumable = item.item_type === 'consumable';

    // Calculate fine if overdue
    let fineAmount = 0;
    const isOverdue = new Date() > borrowLog.expected_return_date;
    
    if (isOverdue) {
      const daysOverdue = Math.ceil((new Date() - borrowLog.expected_return_date) / (1000 * 60 * 60 * 24));
      fineAmount = calculateFine(daysOverdue);
    }

    // Update borrow log
    borrowLog.status = 'returned';
    borrowLog.actual_return_date = new Date();
    borrowLog.condition_after = condition_after;
    borrowLog.damage_notes = damage_notes || '';
    borrowLog.fine_amount = fineAmount;
    borrowLog.fine_paid = fineAmount === 0; // Mark as paid if no fine
    borrowLog.returned_by = req.user.id;
    
    await borrowLog.save({ session });

    // Handle stock updates based on item type
    if (!isConsumable) {
      // For non-consumable items, increase available quantity
      item.quantity_available += 1;
      
      // Save the updated item
      await item.save({ session });
      
      // Create stock log for the return
      const stockLog = new StockLog({
        item: item._id,
        user: req.user.id,
        lab: borrowLog.lab,
        change_quantity: 1,
        reason: 'item_returned',
        notes: `Item returned by user ${borrowLog.user._id} (${borrowLog.user.name || 'Unknown'}). Condition: ${condition_after}`,
        type: 'adjustment',
        reference_id: borrowLog._id,
        created_by: req.user.id,
        updated_by: req.user.id,
        metadata: {
          condition_after,
          has_damage: (condition_after !== 'excellent' || damage_notes) ? 'yes' : 'no',
          is_overdue: isOverdue ? 'yes' : 'no'
        }
      });
      
      await stockLog.save({ session });
    }

    // Send notifications using the centralized function
    await sendBorrowStatusUpdate(
      {
        ...borrowLog.toObject(),
        item: { _id: item._id, name: item.name },
        lab: borrowLog.lab,
        user: borrowLog.user._id,
        expected_return_date: borrowLog.expected_return_date
      },
      req.user,
      'returned',
      { 
        condition_after,
        damage_notes: damage_notes || '',
        fine_amount: fineAmount,
        session 
      }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      success: true,
      message: 'Item returned successfully',
      data: {
        ...borrowLog.toObject(),
        fine_amount: fineAmount,
        is_overdue: isOverdue
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Error in returnItem:', {
      error: error.message,
      stack: error.stack,
      request: {
        params: req.params,
        body: req.body,
        user: req.user ? { id: req.user.id, role: req.user.role } : 'no user',
      },
    });
    
    return res.status(500).json({
      success: false,
      message: 'Error processing item return',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    });
  } finally {
    session.endSession();
  }
};

// Get my borrows (for current user)
const getMyBorrows = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { status, page = 1, limit = 20 } = req.query;
    
    const filter = { user: user_id };
    if (status) filter.status = status;

    const skip = (page - 1) * limit;
    const totalCount = await BorrowLog.countDocuments(filter);
    
    const borrowLogs = await BorrowLog.find(filter)
      .populate('item', 'name type')
      .populate('lab', 'name code')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        borrowLogs,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get my borrows error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching your borrows',
      errors: [error.message]
    });
  }
};

// Get active borrows (currently borrowed items)
const getActiveBorrows = async (req, res) => {
  try {
    const { lab_id, page = 1, limit = 20 } = req.query;
    
    const filter = { status: 'borrowed' };
    if (lab_id) filter.lab = lab_id;

    const skip = (page - 1) * limit;
    const totalCount = await BorrowLog.countDocuments(filter);
    
    const borrowLogs = await BorrowLog.find(filter)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .populate('lab', 'name code')
      .sort({ borrow_date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        borrowLogs,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get active borrows error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching active borrows',
      errors: [error.message]
    });
  }
};

// Get pending borrow requests (for lab managers)
const getPendingRequests = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = { status: 'pending' };
    
    // If user is a department admin, only show requests from their department
    if (req.user.role === 'department_admin') {
      const labs = await Lab.find({ department: req.user.department._id }).select('_id');
      const labIds = labs.map(l => l._id);
      filter.lab = { $in: labIds };
    }
    
    const totalCount = await BorrowLog.countDocuments(filter);
    
    const requests = await BorrowLog.find(filter)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .populate('lab', 'name code')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        requests,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending requests',
      errors: [error.message]
    });
  }
};

// Get overdue items
const getOverdueItems = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = { 
      status: 'borrowed',
      expected_return_date: { $lt: new Date() }
    };
    
    // If user is a department admin, only show items from their department
    if (req.user.role === 'department_admin') {
      const labs = await Lab.find({ department: req.user.department._id }).select('_id');
      const labIds = labs.map(l => l._id);
      filter.lab = { $in: labIds };
    }
    
    const totalCount = await BorrowLog.countDocuments(filter);
    
    const overdueItems = await BorrowLog.find(filter)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .populate('lab', 'name code')
      .sort({ expected_return_date: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Add days overdue to each item
    const itemsWithOverdueDays = overdueItems.map(item => ({
      ...item,
      days_overdue: Math.ceil((new Date() - new Date(item.expected_return_date)) / (1000 * 60 * 60 * 24))
    }));

    res.json({
      success: true,
      data: {
        items: itemsWithOverdueDays,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get overdue items error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching overdue items',
      errors: [error.message]
    });
  }
};

module.exports = {
  getAllBorrowLogs,
  getBorrowLogById,
  borrowItem,
  approveBorrowRequest,
  rejectBorrowRequest,
  returnItem,
  getMyBorrows,
  getActiveBorrows,
  getPendingRequests,
  getOverdueItems
};