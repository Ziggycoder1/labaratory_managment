const mongoose = require('mongoose');
const BorrowLog = require('../models/BorrowLog');
const Item = require('../models/Item');
const User = require('../models/User');
const Lab = require('../models/Lab');
const StockLog = require('../models/StockLog');
const { validationResult } = require('express-validator');
const { calculateFine } = require('../utils/fineCalculator');
const { createNotification } = require('../utils/notifications');

// Get all borrow logs with filters and role-based access control
const getAllBorrowLogs = async (req, res) => {
  try {
    const { item_id, user_id, lab_id, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    
    // Always filter by item_id if provided
    if (item_id) filter.item = item_id;
    
    // Apply user filter based on role
    if (user_id) {
      filter.user = user_id;
    } else if (['student', 'external'].includes(req.user.role)) {
      // Students and external users can only see their own requests
      filter.user = req.user.id;
    }
    
    // Filter by lab if provided
    if (lab_id) filter.lab = lab_id;
    
    // Filter by status if provided
    if (status) filter.status = status;
    
    // For department_admin, only show borrow logs from labs in their department
    if (req.user.role === 'department_admin' && req.user.department) {
      // Find all labs in the department
      const labs = await Lab.find({ department: req.user.department }).select('_id');
      const labIds = labs.map(lab => lab._id);
      
      // If no labs in department, return empty result
      if (labIds.length === 0) {
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
      
      // Add lab filter to only show logs from labs in the department
      filter.lab = { $in: labIds };
    }
    
    // For admin and lab manager, if no results with current filters, show all requests
    let totalCount = await BorrowLog.countDocuments(filter);
    if (totalCount === 0 && ['admin', 'lab_manager'].includes(req.user.role)) {
      delete filter.user; // Remove user filter to show all requests
      totalCount = await BorrowLog.countDocuments(filter);
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
    if (item.quantity_available <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Item is currently not available for borrowing'
      });
    }

    // Check if user has any overdue items
    const hasOverdue = await BorrowLog.findOne({
      user: user_id,
      status: 'overdue'
    }).session(session);

    if (hasOverdue) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'You have overdue items. Please return them before borrowing more.'
      });
    }

    // Create borrow request
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

    // Create notification for lab manager
    await createNotification({
      user: req.user.id,
      type: 'borrow_request',
      title: 'New Borrow Request',
      message: `New borrow request for ${item.name} from ${req.user.full_name}`,
      data: {
        item_id: item._id,
        item_name: item.name,
        expected_return_date: expected_return_date,
        request_date: new Date()
      },
      action_url: `/borrow-requests/${borrowLog._id}`
    });

    // Notify all lab managers
    const labManagers = await User.find({ role: 'lab_manager' });
    for (const manager of labManagers) {
      await createNotification({
        user: manager._id,
        type: 'borrow_request_received',
        title: 'New Borrow Request',
        message: `New borrow request for ${item.name} from ${req.user.full_name}`,
        data: {
          item_id: item._id,
          item_name: item.name,
          requester_id: req.user.id,
          requester_name: req.user.full_name,
          expected_return_date: expected_return_date
        },
        priority: 'high',
        action_url: `/borrow-requests/${borrowLog._id}`
      });
    }

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

    // Check item availability again
    const item = await Item.findById(borrowLog.item).session(session);
    if (item.quantity_available <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Item is no longer available for borrowing'
      });
    }

    // Check if item is consumable or non-consumable
    const isConsumable = item.type === 'consumable';
    
    // For non-consumable items, we just need to check availability
    // For consumable items, we need to reduce the available quantity
    if (isConsumable) {
      if (item.available_quantity < 1) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'Insufficient stock available for this item'
        });
      }
      
      // Reduce available quantity for consumables
      item.available_quantity -= 1;
      await item.save({ session });
      
      // Create stock log for the reduction
      const stockLog = new StockLog({
        item: item._id,
        user: req.user.id,
        lab: borrowLog.lab,
        change_quantity: -1,
        reason: 'borrow_approved',
        notes: `Item borrowed by user ${borrowLog.user}`,
        type: 'remove',
        reference_id: borrowLog._id
      });
      
      await stockLog.save({ session });
    } else {
      // For non-consumable items, just check if it's available
      if (item.available_quantity < 1) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: 'This item is currently not available for borrowing'
        });
      }
      
      // Reduce available quantity for non-consumable items
      item.available_quantity -= 1;
      await item.save({ session });
      
      // Create stock log for the reduction
      const stockLog = new StockLog({
        item: item._id,
        user: req.user.id,
        lab: borrowLog.lab,
        change_quantity: -1,
        reason: 'borrow_approved',
        notes: `Item borrowed by user ${borrowLog.user}`,
        type: 'adjustment',
        reference_id: borrowLog._id
      });
      
      await stockLog.save({ session });
    }

    // Update borrow log
    borrowLog.status = 'borrowed';
    borrowLog.approved_by = req.user.id;
    borrowLog.approved_at = new Date();
    borrowLog.notes = notes || borrowLog.notes;
    
    await borrowLog.save({ session });

    // Create notification for requester
    await createNotification({
      user: borrowLog.user,
      type: 'borrow_approved',
      title: 'Borrow Request Approved',
      message: `Your request to borrow ${item.name} has been approved`,
      data: {
        item_id: item._id,
        item_name: item.name,
        approved_by: req.user.id,
        approved_at: new Date(),
        expected_return_date: borrowLog.expected_return_date
      },
      action_url: `/borrow-requests/${borrowLog._id}`
    });

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'Borrow request approved successfully',
      data: borrowLog
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Approve borrow request error:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving borrow request',
      errors: [error.message]
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
    
    const borrowLog = await BorrowLog.findById(id).session(session);
    
    if (!borrowLog) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Borrow record not found'
      });
    }

    if (borrowLog.status !== 'borrowed') {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'This item is not currently borrowed'
      });
    }

    // Get item to update quantity
    const item = await Item.findById(borrowLog.item).session(session);
    if (!item) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }
    
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
    borrowLog.damage_notes = damage_notes;
    borrowLog.fine_amount = fineAmount;
    borrowLog.fine_paid = fineAmount === 0; // Mark as paid if no fine
    
    await borrowLog.save({ session });

    // Handle stock updates based on item type
    const isConsumable = item.type === 'consumable';
    
    if (!isConsumable) {
      // For non-consumable items, increase available quantity
      item.available_quantity += 1;
      await item.save({ session });
      
      // Create stock log for the return
      const stockLog = new StockLog({
        item: item._id,
        user: req.user.id,
        lab: borrowLog.lab,
        change_quantity: 1,
        reason: 'item_returned',
        notes: `Item returned by user ${borrowLog.user}. Condition: ${condition_after}`,
        type: 'adjustment',
        reference_id: borrowLog._id,
        metadata: {
          condition_after,
          has_damage: condition_after !== 'excellent' || !!damage_notes ? 'yes' : 'no',
          is_overdue: isOverdue ? 'yes' : 'no'
        }
      });
      
      await stockLog.save({ session });
    }
    // For consumable items, we don't return them to stock

    // Create notification for lab manager if there's damage or if item is non-consumable and was returned
    if (condition_after !== 'excellent' || damage_notes) {
      await createNotification({
        user: borrowLog.approved_by, // Notify the lab manager who approved
        type: 'item_returned',
        title: 'Item Returned with Issues',
        message: `Item ${item.name} was returned with condition: ${condition_after}. Please check the details.`,
        data: {
          item_id: item._id,
          item_name: item.name,
          condition_after,
          damage_notes,
          returned_by: req.user.id,
          returned_at: new Date(),
          is_overdue: isOverdue,
          fine_amount: fineAmount
        },
        priority: 'high',
        action_url: `/borrow-logs/${borrowLog._id}`
      });
    }

    // Notify the borrower about the return
    await createNotification({
      user: borrowLog.user,
      type: 'item_return_confirmation',
      title: 'Item Return Confirmed',
      message: `You have successfully returned ${item.name}`,
      data: {
        item_id: item._id,
        item_name: item.name,
        returned_at: new Date(),
        condition_after,
        fine_imposed: fineAmount > 0 ? 'Yes' : 'No',
        fine_amount: fineAmount
      },
      action_url: `/my-borrowings/${borrowLog._id}`
    });

    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      message: 'Item returned successfully',
      data: {
        ...borrowLog.toObject(),
        fine_amount: fineAmount
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Return item error:', error);
    res.status(500).json({
      success: false,
      message: 'Error returning item',
      errors: [error.message]
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