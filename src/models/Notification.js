const mongoose = require('mongoose');
const { Schema } = mongoose;

// Notification types
const NOTIFICATION_TYPES = {
  // Stock related
  STOCK_LOW: 'stock_low',
  STOCK_OUT: 'stock_out',
  STOCK_EXPIRING: 'stock_expiring',
  STOCK_EXPIRED: 'stock_expired',
  STOCK_ADJUSTMENT: 'stock_adjustment',
  STOCK_TRANSFER: 'stock_transfer',
  // Other types...
  BOOKING_APPROVED: 'booking_approved',
  BOOKING_REJECTED: 'booking_rejected',
  SYSTEM_ALERT: 'system_alert'
};

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  action_url: { type: String },
  // Reference to related entities
  related_item: { type: Schema.Types.ObjectId, ref: 'Item' },
  related_lab: { type: Schema.Types.ObjectId, ref: 'Lab' },
  // Additional metadata
  metadata: { type: Schema.Types.Mixed }
}, { timestamps: true });

// Indexes for better query performance
notificationSchema.index({ user: 1, is_read: 1, created_at: -1 });
notificationSchema.index({ type: 1, created_at: -1 });

// Static methods
notificationSchema.statics.createStockNotification = async function(userId, type, {
  title,
  message,
  itemId,
  labId,
  metadata = {}
}) {
  if (!Object.values(NOTIFICATION_TYPES).includes(type)) {
    throw new Error('Invalid notification type');
  }

  return this.create({
    user: userId,
    type,
    title,
    message,
    related_item: itemId,
    related_lab: labId,
    metadata,
    priority: type.includes('out') || type.includes('expired') ? 'high' : 'normal'
  });
};

// Mark all notifications as read for a user
notificationSchema.statics.markAllAsRead = function(userId) {
  return this.updateMany(
    { user: userId, is_read: false },
    { $set: { is_read: true } }
  );
};

// Get unread notifications count
notificationSchema.statics.getUnreadCount = function(userId) {
  return this.countDocuments({ user: userId, is_read: false });
};

const Notification = mongoose.model('Notification', notificationSchema);

// Export constants
module.exports = {
  Notification,
  NOTIFICATION_TYPES
};