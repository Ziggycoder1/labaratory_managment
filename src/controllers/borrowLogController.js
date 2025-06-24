const BorrowLog = require('../models/BorrowLog');
const Item = require('../models/Item');
const User = require('../models/User');
const Lab = require('../models/Lab');
const { validationResult } = require('express-validator');

// Get all borrow logs with filters
const getAllBorrowLogs = async (req, res) => {
  try {
    const { item_id, user_id, lab_id, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    
    if (item_id) filter.item = item_id;
    if (user_id) filter.user = user_id;
    if (lab_id) filter.lab = lab_id;
    if (status) filter.status = status;
    // Department admin: only logs for labs in their department
    if (req.user && req.user.role === 'department_admin') {
      const labs = await Lab.find({ department: req.user.department._id }).select('_id');
      const labIds = labs.map(l => l._id);
      filter.lab = { $in: labIds };
    }

    const skip = (page - 1) * limit;
    const totalCount = await BorrowLog.countDocuments(filter);
    
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

// Borrow an item
const borrowItem = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { item_id, lab_id, notes } = req.body;
    const user_id = req.user.id;

    // Check if item exists and is available
    const item = await Item.findById(item_id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Check if item is already borrowed
    const activeBorrow = await BorrowLog.findOne({
      item: item_id,
      status: 'borrowed'
    });

    if (activeBorrow) {
      return res.status(400).json({
        success: false,
        message: 'Item is already borrowed'
      });
    }

    // Check if lab exists
    const lab = await Lab.findById(lab_id);
    if (!lab) {
      return res.status(404).json({
        success: false,
        message: 'Lab not found'
      });
    }

    // Create borrow log
    const borrowLog = await BorrowLog.create({
      item: item_id,
      user: user_id,
      lab: lab_id,
      notes
    });

    const populatedBorrowLog = await BorrowLog.findById(borrowLog._id)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .populate('lab', 'name code');

    res.status(201).json({
      success: true,
      message: 'Item borrowed successfully',
      data: populatedBorrowLog
    });
  } catch (error) {
    console.error('Borrow item error:', error);
    res.status(500).json({
      success: false,
      message: 'Error borrowing item',
      errors: [error.message]
    });
  }
};

// Return an item
const returnItem = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id;

    const borrowLog = await BorrowLog.findById(id);
    if (!borrowLog) {
      return res.status(404).json({
        success: false,
        message: 'Borrow log not found'
      });
    }

    // Check if item is currently borrowed
    if (borrowLog.status !== 'borrowed') {
      return res.status(400).json({
        success: false,
        message: 'Item is not currently borrowed'
      });
    }

    // Only allow return if user borrowed the item or is admin/lab_manager
    if (borrowLog.user.toString() !== user_id && !['admin', 'lab_manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You can only return items you borrowed'
      });
    }

    // Update borrow log
    borrowLog.status = 'returned';
    borrowLog.return_date = new Date();
    await borrowLog.save();

    const populatedBorrowLog = await BorrowLog.findById(id)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .populate('lab', 'name code');

    res.json({
      success: true,
      message: 'Item returned successfully',
      data: populatedBorrowLog
    });
  } catch (error) {
    console.error('Return item error:', error);
    res.status(500).json({
      success: false,
      message: 'Error returning item',
      errors: [error.message]
    });
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

module.exports = {
  getAllBorrowLogs,
  getBorrowLogById,
  borrowItem,
  returnItem,
  getMyBorrows,
  getActiveBorrows
}; 