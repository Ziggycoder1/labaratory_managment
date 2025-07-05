const mongoose = require('mongoose');
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
    // Department admin: only stock logs for items in labs in their department
    if (req.user && req.user.role === 'department_admin') {
      const labs = await require('../models/Lab').find({ department: req.user.department._id }).select('_id');
      const labIds = labs.map(l => l._id);
      const items = await require('../models/Item').find({ lab: { $in: labIds } }).select('_id');
      const itemIds = items.map(i => i._id);
      filter.item = { $in: itemIds };
    }

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
  } catch (error) {
    console.error('Get stock summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stock summary',
      errors: [error.message]
    });
  }
};

/**
 * Get movement data for specific items
 */
const getItemsMovementData = async (req, res) => {
  try {
    const { item_ids } = req.query;
    
    if (!item_ids) {
      return res.status(400).json({
        success: false,
        message: 'Item IDs are required',
        errors: ['item_ids parameter is required']
      });
    }

    const itemIds = item_ids.split(',');
    
    // Get stock logs for these items, grouped by item
    // Validate and convert item IDs
    const validItemIds = [];
    const invalidItemIds = [];
    
    for (const id of itemIds) {
      if (mongoose.Types.ObjectId.isValid(id)) {
        validItemIds.push(new mongoose.Types.ObjectId(id));
      } else {
        invalidItemIds.push(id);
        console.warn(`Invalid item ID: ${id}`);
      }
    }

    if (validItemIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid item IDs provided',
        errors: ['All provided item IDs are invalid'],
        invalidItemIds
      });
    }

    if (invalidItemIds.length > 0) {
      console.warn(`Proceeding with ${validItemIds.length} valid item IDs, ignoring ${invalidItemIds.length} invalid IDs`);
    }

    const itemsMovementData = await StockLog.aggregate([
      { 
        $match: { 
          item: { $in: validItemIds } 
        } 
      },
      { $sort: { created_at: -1 } },
      {
        $group: {
          _id: '$item',
          lastMovement: { $first: '$created_at' },
          lastChange: { $first: '$change_quantity' },
          lastChangeType: { $first: '$type' },
          lastChangeBy: { $first: '$user' },
          totalChanges: { $sum: 1 },
          avgChange: { $avg: '$change_quantity' },
          totalIn: {
            $sum: {
              $cond: [{ $gt: ['$change_quantity', 0] }, '$change_quantity', 0]
            }
          },
          totalOut: {
            $sum: {
              $cond: [{ $lt: ['$change_quantity', 0] }, { $multiply: ['$change_quantity', -1] }, 0]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'lastChangeBy',
          foreignField: '_id',
          as: 'userData'
        }
      },
      { $unwind: { path: '$userData', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          itemId: '$_id',
          lastMovement: 1,
          lastChange: 1,
          lastChangeType: 1,
          lastChangeBy: {
            $ifNull: ['$userData.full_name', 'System']
          },
          totalChanges: 1,
          avgChange: { $round: ['$avgChange', 2] },
          totalIn: 1,
          totalOut: 1,
          trend: {
            $switch: {
              branches: [
                { case: { $gt: ['$avgChange', 0] }, then: 'up' },
                { case: { $lt: ['$avgChange', 0] }, then: 'down' }
              ],
              default: 'stable'
            }
          },
          percentage: {
            $min: [
              { $multiply: [{ $abs: '$avgChange' }, 10] },
              30 // Cap at 30%
            ]
          },
          status: {
            $let: {
              vars: {
                daysSinceLastMovement: {
                  $divide: [
                    { $subtract: [new Date(), '$lastMovement'] },
                    1000 * 60 * 60 * 24 // Convert to days
                  ]
                }
              },
              in: {
                $switch: {
                  branches: [
                    { 
                      case: { $gt: ['$$daysSinceLastMovement', 30] },
                      then: 'stagnant'
                    },
                    { 
                      case: { 
                        $and: [
                          { $lt: ['$avgChange', 0] },
                          { $gt: [{ $abs: '$avgChange' }, 1.5] }
                        ]
                      },
                      then: 'depleting'
                    }
                  ],
                  default: 'active'
                }
              }
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: itemsMovementData
    });
  } catch (error) {
    console.error('Get items movement data error:', error);
    
    // More detailed error response
    const errorResponse = {
      success: false,
      message: 'Error fetching items movement data',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      details: {
        itemIds,
        validItemIds: validItemIds ? validItemIds.map(id => id.toString()) : [],
        invalidItemIds
      }
    };
    
    res.status(500).json(errorResponse);
  }
};

module.exports = {
  getAllStockLogs,
  getStockLogById,
  createStockLog,
  getStockLogsByItem,
  getStockLogsByUser,
  getStockSummary,
  getItemsMovementData
};