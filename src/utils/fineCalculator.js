/**
 * Calculate fine for overdue items
 * @param {number} daysOverdue - Number of days the item is overdue
 * @returns {number} Calculated fine amount
 */
const calculateFine = (daysOverdue) => {
  // Fine calculation logic
  const FINE_RATE_PER_DAY = 1000; // Example: 1000 RWF per day
  const MAX_FINE_DAYS = 30; // Cap fine at 30 days
  
  // Cap the number of days to prevent excessive fines
  const cappedDays = Math.min(daysOverdue, MAX_FINE_DAYS);
  
  // Calculate fine (simple linear rate)
  return cappedDays * FINE_RATE_PER_DAY;
};

module.exports = {
  calculateFine
};
