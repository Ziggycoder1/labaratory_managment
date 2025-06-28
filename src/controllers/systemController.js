const SystemSetting = require('../models/SystemSetting');
const SystemLog = require('../models/SystemLog');
const User = require('../models/User');

// GET /api/system/settings
exports.getSettings = async (req, res) => {
  try {
    // Only allow admin
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
    let settings = await SystemSetting.findOne();
    if (!settings) {
      settings = await SystemSetting.create({});
    }
    res.json({ success: true, data: settings.toObject() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching settings', error: error.message });
  }
};

// PUT /api/system/settings
exports.updateSettings = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
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
    res.status(500).json({ success: false, message: 'Error updating settings', error: error.message });
  }
};

// GET /api/system/logs
exports.getLogs = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
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
    res.status(500).json({ success: false, message: 'Error fetching logs', error: error.message });
  }
}; 