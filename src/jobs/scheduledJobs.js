const cron = require('node-cron');
const { releaseCompletedBookings } = require('../utils/inventoryUtils');
const Booking = require('../models/Booking');

// Schedule to run every hour
const scheduleInventoryCleanup = () => {
  // Run at the top of every hour
  cron.schedule('0 * * * *', async () => {
    try {
      console.log('Running scheduled job: releaseCompletedBookings');
      const result = await releaseCompletedBookings();
      console.log('Completed scheduled job: releaseCompletedBookings', result);
    } catch (error) {
      console.error('Error in scheduled job releaseCompletedBookings:', error);
    }
  });

  console.log('Scheduled jobs initialized');
};

module.exports = {
  scheduleInventoryCleanup
};
