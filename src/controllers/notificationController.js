const { Notification, NOTIFICATION_TYPES } = require('../models/Notification');
const User = require('../models/User');
const { Types: { ObjectId } } = require('mongoose');

// GET /api/notifications
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    console.log('Fetching notifications for user ID:', userId, 'Type:', typeof userId);
    
    const { unread_only, type, page = 1, limit = 20 } = req.query;
    console.log('Query params:', { unread_only, type, page, limit });
    
    // Convert userId to ObjectId for consistent comparison
    const userIdObj = new ObjectId(userId);
    
    // Build filter with explicit type conversion
    const filter = { user: userIdObj };
    
    if (unread_only === 'true') {
      filter.is_read = false;
      console.log('Filtering for unread notifications only');
    }
    
    if (type) {
      filter.type = type;
      console.log('Filtering by type:', type);
    }
    
    const skip = (page - 1) * limit;
    
    // Log the filter being used
    console.log('MongoDB filter:', JSON.stringify(filter));
    
    // Get total count with the same filter
    const totalCount = await Notification.countDocuments(filter);
    console.log('Total notifications matching filter:', totalCount);
    
    // Get paginated notifications
    const notifications = await Notification.find(filter)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('related_item', 'name code')
      .populate('related_lab', 'name code')
      .lean();
    
    console.log(`Found ${notifications.length} notifications for user ${userId}`);
    
    if (notifications.length > 0) {
      console.log('Sample notification (first one):', {
        id: notifications[0]._id,
        type: notifications[0].type,
        title: notifications[0].title,
        created_at: notifications[0].created_at,
        user: notifications[0].user,
        user_type: typeof notifications[0].user
      });
    }

    // Format the response to match frontend expectations
    const formattedNotifications = notifications.map(notification => ({
      id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      is_read: notification.is_read,
      created_at: notification.created_at,
      data: notification.data,
      action_url: notification.action_url,
      related_item: notification.related_item,
      related_lab: notification.related_lab,
      priority: notification.priority
    }));

    const unread_count = await Notification.countDocuments({ user: userIdObj, is_read: false });
    console.log('Unread count for user:', unread_count);
    
    const response = {
      success: true,
      data: {
        notifications: formattedNotifications,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_count: totalCount,
          per_page: parseInt(limit)
        },
        unread_count
      }
    };
    
    console.log('Sending response with', formattedNotifications.length, 'notifications');
    res.json(response);
    
  } catch (error) {
    console.error('Error in getNotifications:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?._id,
      query: req.query
    });
    
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching notifications', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// PATCH /api/notifications/:id/read
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, user: userId },
      { is_read: true },
      { new: true }
    );
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error marking notification as read', error: error.message });
  }
};

// PATCH /api/notifications/mark-all-read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    await Notification.updateMany(
      { user: userId, is_read: false },
      { $set: { is_read: true } }
    );
    
    // Get updated unread count
    const unreadCount = await Notification.countDocuments({ 
      user: userId, 
      is_read: false 
    });
    
    res.json({ 
      success: true, 
      message: 'All notifications marked as read',
      data: {
        unread_count: unreadCount
      }
    });
  } catch (error) {
    console.error('Error marking all as read:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error marking notifications as read', 
      error: error.message 
    });
  }
};

// GET /api/notifications/unread-count
exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const count = await Notification.countDocuments({ 
      user: userId, 
      is_read: false 
    });
    
    res.json({ 
      success: true, 
      data: { 
        count 
      } 
    });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error getting unread count', 
      error: error.message 
    });
  }
};

// GET /api/notifications/settings
exports.getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    const defaultSettings = {
      email_notifications: true,
      push_notifications: true,
      notification_types: {
        booking_approved: true,
        booking_rejected: true,
        return_reminder: true,
        stock_alert: false,
        maintenance_reminder: true
      },
      reminder_preferences: {
        return_reminder_hours: 24,
        booking_reminder_hours: 2
      }
    };
    res.json({ success: true, data: user.notification_settings || defaultSettings });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching settings', error: error.message });
  }
};

// PUT /api/notifications/settings
exports.updateSettings = async (req, res) => {
  try {
    const userId = req.user._id;
    const { email_notifications, push_notifications, notification_types, reminder_preferences } = req.body;
    const update = {
      notification_settings: {
        email_notifications,
        push_notifications,
        notification_types,
        reminder_preferences
      }
    };
    await User.findByIdAndUpdate(userId, update);
    res.json({ success: true, message: 'Notification settings updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating settings', error: error.message });
  }
}; 