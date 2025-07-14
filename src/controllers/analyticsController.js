const Booking = require('../models/Booking');
const Lab = require('../models/Lab');
const User = require('../models/User');
const Item = require('../models/Item');
const Department = require('../models/Department');
const BorrowLog = require('../models/BorrowLog');
const StockLog = require('../models/StockLog');
const Field = require('../models/Field');
const moment = require('moment-timezone');

/**
 * @desc    Get system-wide statistics
 * @route   GET /api/analytics/overview
 * @access  Private/Admin
 */
const getSystemOverview = async (req, res) => {
  try {
    const [
      totalUsers,
      totalLabs,
      totalItems,
      activeBookings,
      departments,
      recentActivities,
      labsByDepartment
    ] = await Promise.all([
      User.countDocuments(),
      Lab.countDocuments(),
      Item.countDocuments(),
      Booking.countDocuments({ status: 'approved' }),
      Department.find(),
      Booking.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'name email')
        .populate('lab', 'name'),
      Lab.aggregate([
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'department' } },
        { $unwind: '$department' }
      ])
    ]);

    const departmentStats = departments.map(dept => {
      const deptStats = labsByDepartment.find(d => d._id.toString() === dept._id.toString());
      return {
        id: dept._id,
        name: dept.name,
        labCount: deptStats ? deptStats.count : 0
      };
    });

    res.json({
      success: true,
      data: {
        totalUsers,
        totalLabs,
        totalItems,
        activeBookings,
        departmentStats,
        recentActivities
      }
    });
  } catch (error) {
    console.error('Error fetching system overview:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching system overview',
      error: error.message 
    });
  }
};

/**
 * @desc    Get booking analytics
 * @route   GET /api/analytics/bookings
 * @access  Private/Admin
 */
const getBookingAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, labId, departmentId } = req.query;
    const match = {};

    // Date range filter
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    // Lab filter
    if (labId) match.lab = labId;
    
    // Department filter for department admins
    if (req.user.role === 'department_admin') {
      const labs = await Lab.find({ department: req.user.department._id });
      match.lab = { $in: labs.map(l => l._id) };
    } else if (departmentId) {
      const labs = await Lab.find({ department: departmentId });
      match.lab = { $in: labs.map(l => l._id) };
    }

    const [
      totalBookings,
      statusStats,
      labStats,
      monthlyStats
    ] = await Promise.all([
      // Total bookings count
      Booking.countDocuments(match),
      
      // Status distribution
      Booking.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Lab distribution
      Booking.aggregate([
        { $match: match },
        { $lookup: { from: 'labs', localField: 'lab', foreignField: '_id', as: 'labData' } },
        { $unwind: '$labData' },
        { $group: { _id: '$labData.name', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]),
      
      // Monthly stats
      Booking.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            count: { $sum: 1 },
            totalHours: { $sum: { $divide: [{ $subtract: ['$end_time', '$start_time'] }, 1000 * 60 * 60] } }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        totalBookings,
        statusStats,
        labStats,
        monthlyStats
      }
    });
  } catch (error) {
    console.error('Error fetching booking analytics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching booking analytics',
      error: error.message 
    });
  }
};

/**
 * @desc    Get inventory analytics
 * @route   GET /api/analytics/inventory
 * @access  Private/Admin
 */
const getInventoryAnalytics = async (req, res) => {
  try {
    const { departmentId } = req.query;
    
    // Build the base query for items
    const itemQuery = {};
    let labQuery = {};
    
    // If department filter is provided, find all labs in that department
    if (departmentId) {
      const labsInDepartment = await Lab.find({ department: departmentId });
      const labIds = labsInDepartment.map(lab => lab._id);
      itemQuery.lab = { $in: labIds };
      
      // Also include department ID in lab query for population
      labQuery.department = departmentId;
    }
    
    // Get total items count
    const totalItems = await Item.countDocuments(itemQuery);
    
    // Status distribution
    const statusStats = await Item.aggregate([
      { $match: itemQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Category distribution
    const categoryStats = await Item.aggregate([
      { $match: itemQuery },
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Low stock items with lab and department info
    const lowStockItems = await Item.find({
      ...itemQuery,
      $expr: { $lte: ['$quantity', { $multiply: ['$minimum_quantity', 1.2] }] } // 20% above minimum
    })
    .sort({ quantity: 1 })
    .limit(10)
    .populate({
      path: 'lab',
      select: 'name department',
      populate: {
        path: 'department',
        select: 'name'
      }
    });

    res.json({
      success: true,
      data: {
        totalItems,
        statusDistribution: statusStats,
        categoryDistribution: categoryStats,
        lowStockItems
      }
    });
  } catch (error) {
    console.error('Error fetching inventory analytics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching inventory analytics',
      error: error.message 
    });
  }
};

/**
 * @desc    Get user activity analytics
 * @route   GET /api/analytics/user-activity
 * @access  Private/Admin
 */
const getUserActivityAnalytics = async (req, res) => {
  try {
    const { startDate, endDate, role } = req.query;
    const match = {};
    
    // Date range filter
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }
    
    // Role filter
    if (role) match.role = role;
    
    // Department filter for department admins
    if (req.user.role === 'department_admin') {
      match.department = req.user.department._id;
    }

    // User activity stats
    const bookings = await Booking.find(match)
      .populate('user', 'name email role')
      .sort({ updatedAt: -1 });
    
    const userActivityMap = new Map();
    
    bookings.forEach(booking => {
      if (!booking.user) return;
      
      const userId = booking.user._id.toString();
      if (!userActivityMap.has(userId)) {
        userActivityMap.set(userId, {
          id: booking.user._id,
          name: booking.user.name,
          email: booking.user.email,
          role: booking.user.role,
          bookingCount: 0,
          lastActivity: booking.updatedAt
        });
      }
      
      const userActivity = userActivityMap.get(userId);
      userActivity.bookingCount++;
      if (booking.updatedAt > userActivity.lastActivity) {
        userActivity.lastActivity = booking.updatedAt;
      }
    });
    
    const userActivity = Array.from(userActivityMap.values())
      .sort((a, b) => b.bookingCount - a.bookingCount)
      .slice(0, 10);
    
    // User registration stats
    const userRegistrationStats = await User.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 },
          roles: {
            $push: {
              role: '$role',
              count: 1
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        userActivity,
        userRegistrationStats
      }
    });
  } catch (error) {
    console.error('Error fetching user activity analytics:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching user activity analytics',
      error: error.message 
    });
  }
};

module.exports = {
  getSystemOverview,
  getBookingAnalytics,
  getInventoryAnalytics,
  getUserActivityAnalytics
};
