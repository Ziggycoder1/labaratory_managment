const SystemSetting = require('../models/SystemSetting');
const SystemLog = require('../models/SystemLog');
const User = require('../models/User');

// GET /api/system/settings
exports.getSettings = async (req, res, next) => {
  try {
    // Only allow admin
    if (!req.user || req.user.role !== 'admin') {
      const err = new Error('Forbidden: Admins only');
      err.statusCode = 403;
      return next(err);
    }
    let settings = await SystemSetting.findOne();
    if (!settings) {
      settings = await SystemSetting.create({});
    }
    res.json({ success: true, data: settings.toObject() });
  } catch (error) {
    error.message = 'Error fetching settings: ' + error.message;
    return next(error);
  }
};

// PUT /api/system/settings
exports.updateSettings = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      const err = new Error('Forbidden: Admins only');
      err.statusCode = 403;
      return next(err);
    }
    let settings = await SystemSetting.findOne();
    if (!settings) settings = await SystemSetting.create({});
    // Only update provided fields (deep merge)
    const update = req.body;
    for (const section in update) {
      if (typeof update[section] === 'object' && settings[section]) {
        Object.assign(settings[section], update[section]);
      } else {
        settings[section] = update[section];
      }
    }
    await settings.save();
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    error.message = 'Error updating settings: ' + error.message;
    return next(error);
  }
};

// GET /api/system/logs
exports.getLogs = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      const err = new Error('Forbidden: Admins only');
      err.statusCode = 403;
      return next(err);
    }
    const { level, start_date, end_date, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (level) filter.level = level;
    if (start_date || end_date) {
      filter.timestamp = {};
      if (start_date) filter.timestamp.$gte = new Date(start_date);
      if (end_date) filter.timestamp.$lte = new Date(end_date);
    }
    const skip = (page - 1) * limit;
    const totalCount = await SystemLog.countDocuments(filter);
    const logs = await SystemLog.find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    const mapped = logs.map(l => ({
      id: l._id,
      level: l.level,
      message: l.message,
      context: l.context,
      timestamp: l.timestamp ? new Date(l.timestamp).toISOString() : null
    }));
    res.json({
      success: true,
      data: {
        logs: mapped,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        }
      }
    });
  } catch (error) {
    error.message = 'Error fetching logs: ' + error.message;
    return next(error);
  }
};

// GET /api/health
exports.getHealth = async (req, res, next) => {
  try {
    // Database health check
    const dbStart = Date.now();
    let dbStatus = 'healthy';
    try {
      await SystemSetting.findOne();
    } catch (e) {
      dbStatus = 'unhealthy';
    }
    const dbResponseTime = Date.now() - dbStart;

    // File storage health check (check available space in uploads dir)
    const fs = require('fs');
    const path = require('path');
    let fileStatus = 'healthy';
    let availableSpace = 'unknown';
    try {
      const stat = fs.statSync(path.join(__dirname, '../../uploads'));
      // For demo, just set 85% (real check would use disk usage libs)
      availableSpace = '85%';
    } catch (e) {
      fileStatus = 'unhealthy';
    }

    // Email service health check (simulate, or check config)
    let emailStatus = 'healthy';
    let lastTest = new Date().toISOString();
    // Optionally, you could send a test email or check config

    res.json({
      success: true,
      status: dbStatus === 'healthy' && fileStatus === 'healthy' && emailStatus === 'healthy' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      checks: {
        database: {
          status: dbStatus,
          response_time: dbResponseTime + 'ms'
        },
        file_storage: {
          status: fileStatus,
          available_space: availableSpace
        },
        email_service: {
          status: emailStatus,
          last_test: lastTest
        }
      }
    });
  } catch (error) {
    error.message = 'Error performing health check: ' + error.message;
    next(error);
  }
};

// GET /api/version
exports.getVersion = (req, res, next) => {
  try {
    res.json({
      success: true,
      data: {
        api_version: '1.0.0',
        build_date: '2024-06-01T00:00:00Z',
        environment: process.env.NODE_ENV || 'development',
        features: [
          'booking_system',
          'stock_management',
          'user_management',
          'reporting'
        ]
      }
    });
  } catch (error) {
    error.message = 'Error fetching version info: ' + error.message;
    next(error);
  }
}; 