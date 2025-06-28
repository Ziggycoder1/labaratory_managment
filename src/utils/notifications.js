const User = require('../models/User');
const Notification = require('../models/Notification');

// Save notification to DB
const createNotification = async ({ user, type, title, message, data, priority = 'normal', action_url }) => {
  try {
    await Notification.create({ user, type, title, message, data, priority, action_url });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
};

// Existing notification functions (can call createNotification as needed)
const sendBookingNotificationToAdmin = async (booking, user) => {
  try {
    // Example: send to all admins
    const admins = await User.find({ role: 'admin' });
    for (const admin of admins) {
      await createNotification({
        user: admin._id,
        type: 'booking_request',
        title: 'New Booking Request',
        message: `${user.full_name} booked ${booking.lab.name} for ${booking.purpose}`,
        data: { booking_id: booking._id, lab_name: booking.lab.name, start_time: booking.start_time },
        action_url: `/bookings/${booking._id}`
      });
    }
  } catch (error) {
    console.error('Error sending admin notification:', error);
  }
};

const sendBookingStatusUpdate = async (booking, user, status, rejectionReason = null) => {
  try {
    let type = status === 'approved' ? 'booking_approved' : 'booking_rejected';
    let title = status === 'approved' ? 'Booking Approved' : 'Booking Rejected';
    let message = status === 'approved'
      ? `Your booking for ${booking.lab.name} has been approved`
      : `Your booking for ${booking.lab.name} was rejected${rejectionReason ? ': ' + rejectionReason : ''}`;
    await createNotification({
      user: user._id,
      type,
      title,
      message,
      data: { booking_id: booking._id, lab_name: booking.lab.name, start_time: booking.start_time },
      action_url: `/bookings/${booking._id}`
    });
  } catch (error) {
    console.error('Error sending status update:', error);
  }
};

const sendBookingReminder = async (booking, user) => {
  try {
    await createNotification({
      user: user._id,
      type: 'booking_reminder',
      title: 'Booking Reminder',
      message: `Upcoming booking for ${booking.lab.name}`,
      data: { booking_id: booking._id, lab_name: booking.lab.name, start_time: booking.start_time },
      action_url: `/bookings/${booking._id}`
    });
  } catch (error) {
    console.error('Error sending reminder:', error);
  }
};

const sendLowStockAlert = async (item, currentQuantity, minimumQuantity) => {
  try {
    // Example: send to all lab managers
    const managers = await User.find({ role: 'lab_manager' });
    for (const manager of managers) {
      await createNotification({
        user: manager._id,
        type: 'stock_alert',
        title: 'Low Stock Alert',
        message: `${item.name} is low on stock`,
        data: { item_id: item._id, item_name: item.name, current_quantity: currentQuantity, minimum_quantity: minimumQuantity },
        priority: 'high',
        action_url: `/items/${item._id}`
      });
    }
  } catch (error) {
    console.error('Error sending low stock alert:', error);
  }
};

module.exports = {
  createNotification,
  sendBookingNotificationToAdmin,
  sendBookingStatusUpdate,
  sendBookingReminder,
  sendLowStockAlert
}; 