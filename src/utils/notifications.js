const User = require('../models/User');

// Simple notification functions (without email for now)
const sendBookingNotificationToAdmin = async (booking, user) => {
  try {
    console.log(`📧 New booking notification for admin: ${user.full_name} booked ${booking.lab.name} for ${booking.purpose}`);
    // Email functionality can be added here later
  } catch (error) {
    console.error('Error sending admin notification:', error);
  }
};

const sendBookingStatusUpdate = async (booking, user, status, rejectionReason = null) => {
  try {
    console.log(`📧 Status update notification for ${user.full_name}: Booking ${status} for ${booking.lab.name}`);
    // Email functionality can be added here later
  } catch (error) {
    console.error('Error sending status update:', error);
  }
};

const sendBookingReminder = async (booking, user) => {
  try {
    console.log(`📧 Reminder notification for ${user.full_name}: Upcoming booking for ${booking.lab.name}`);
    // Email functionality can be added here later
  } catch (error) {
    console.error('Error sending reminder:', error);
  }
};

const sendLowStockAlert = async (item, currentQuantity, minimumQuantity) => {
  try {
    console.log(`📧 Low stock alert: ${item.name} - Current: ${currentQuantity}, Minimum: ${minimumQuantity}`);
    // Email functionality can be added here later
  } catch (error) {
    console.error('Error sending low stock alert:', error);
  }
};

module.exports = {
  sendBookingNotificationToAdmin,
  sendBookingStatusUpdate,
  sendBookingReminder,
  sendLowStockAlert
}; 