const StockLog = require('../models/StockLog');
const Item = require('../models/Item');
const User = require('../models/User');
const { validationResult } = require('express-validator');

// Get all stock logs with filters
const getAllStockLogs = async (req, res) => {
  try {
    const { item_id, user_id, page = 1, limit = 20 } = req.query;
    const filter = {};
    
    if (item_id) filter.item = item_id;
    if (user_id) filter.user = user_id;

    const skip = (page - 1) * limit;
    const totalCount = await StockLog.countDocuments(filter);
    
    const stockLogs = await StockLog.find(filter)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        stockLogs,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get stock logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stock logs',
      errors: [error.message]
    });
  }
};

// Get specific stock log
const getStockLogById = async (req, res) => {
  try {
    const stockLog = await StockLog.findById(req.params.id)
      .populate('item', 'name type')
      .populate('user', 'full_name email')
      .lean();

    if (!stockLog) {
      return res.status(404).json({
        success: false,
        message: 'Stock log not found'
      });
    }

    res.json({
      success: true,
      data: stockLog
    });
  } catch (error) {
    console.error('Get stock log error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stock log',
      errors: [error.message]
    });
  }
};

// Create stock log (add/remove stock)
const createStockLog = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { item_id, change_quantity, reason } = req.body;
    const user_id = req.user.id;

    // Check if item exists
    const item = await Item.findById(item_id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Check if user has permission to modify stock
    if (!['admin', 'lab_manager'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify stock'
      });
    }

    // Update item quantity
    const newQuantity = item.quantity + change_quantity;
    const newAvailableQuantity = item.available_quantity + change_quantity;

    if (newQuantity < 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove more stock than available'
      });
    }

    // Update item
    item.quantity = newQuantity;
    item.available_quantity = newAvailableQuantity;
    await item.save();

    // Create stock log
    const stockLog = await StockLog.create({
      item: item_id,
      user: user_id,
      change_quantity,
      reason
    });

    const populatedStockLog = await StockLog.findById(stockLog._id)
      .populate('item', 'name type')
      .populate('user', 'full_name email');

    res.status(201).json({
      success: true,
      message: 'Stock updated successfully',
      data: {
        stockLog: populatedStockLog,
        newQuantity: item.quantity,
        newAvailableQuantity: item.available_quantity
      }
    });
  } catch (error) {
    console.error('Create stock log error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating stock',
      errors: [error.message]
    });
  }
};

// Get stock logs by item
const getStockLogsByItem = async (req, res) => {
  try {
    const { item_id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (page - 1) * limit;
    const totalCount = await StockLog.countDocuments({ item: item_id });
    
    const stockLogs = await StockLog.find({ item: item_id })
      .populate('user', 'full_name email')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        stockLogs,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get stock logs by item error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stock logs for item',
      errors: [error.message]
    });
  }
};

// Get stock logs by user
const getStockLogsByUser = async (req, res) => {
  try {
    const { user_id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (page - 1) * limit;
    const totalCount = await StockLog.countDocuments({ user: user_id });
    
    const stockLogs = await StockLog.find({ user: user_id })
      .populate('item', 'name type')
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.json({
      success: true,
      data: {
        stockLogs,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    console.error('Get stock logs by user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stock logs for user',
      errors: [error.message]
    });
  }
};

// Get stock summary (for dashboard)
const getStockSummary = async (req, res) => {
  try {
    const { lab_id } = req.query;
    const filter = {};
    if (lab_id) filter.lab = lab_id;

    // Get items with their current stock levels
    const items = await Item.find(filter)
      .populate('lab', 'name')
      .lean();

    // Calculate summary statistics
    const summary = {
      total_items: items.length,
      low_stock_items: items.filter(item => item.available_quantity <= item.minimum_quantity).length,
      out_of_stock_items: items.filter(item => item.available_quantity === 0).length,
      total_value: items.reduce((sum, item) => sum + (item.quantity || 0), 0)
    };

    // Get recent stock movements
    const recentMovements = await StockLog.find()
      .populate('item', 'name type')
      .populate('user', 'full_name')
      .sort({ created_at: -1 })
      .limit(10)
      .lean();

    res.json({
      success: true,
      data: {
        summary,
        recentMovements,
        items: items.map(item => ({
          id: item._id,
          name: item.name,
          type: item.type,
          quantity: item.quantity,
          available_quantity: item.available_quantity,
          minimum_quantity: item.minimum_quantity,
          lab: item.lab?.name,
          status: item.available_quantity <= item.minimum_quantity ? 'low_stock' : 'normal'
        }))
      }
    });
  } catch (error) {
    console.error('Get stock summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stock summary',
      errors: [error.message]
    });
  }
};

module.exports = {
  getAllStockLogs,
  getStockLogById,
  createStockLog,
  getStockLogsByItem,
  getStockLogsByUser,
  getStockSummary
}; 