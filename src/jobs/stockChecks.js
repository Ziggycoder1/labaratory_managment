const cron = require('node-cron');
const { Notification, NOTIFICATION_TYPES } = require('../models/Notification');
const Item = require('../models/Item');
const User = require('../models/User');

class StockChecks {
  constructor() {
    this.lowStockCheck = null;
    this.expiryCheck = null;
  }

  /**
   * Start all scheduled stock checks
   */
  start() {
    // Run daily at 9 AM
    this.lowStockCheck = cron.schedule('0 9 * * *', this.checkLowStock.bind(this));
    
    // Run daily at 10 AM
    this.expiryCheck = cron.schedule('0 10 * * *', this.checkExpiringItems.bind(this));
    
    console.log('Stock check jobs scheduled');
  }

  /**
   * Stop all scheduled stock checks
   */
  stop() {
    if (this.lowStockCheck) this.lowStockCheck.stop();
    if (this.expiryCheck) this.expiryCheck.stop();
  }

  /**
   * Check for low stock items and notify lab managers
   */
  async checkLowStock() {
    try {
      console.log('Running low stock check...');
      
      // Get all items that are at or below minimum quantity
      const lowStockItems = await Item.find({
        $expr: { $lte: ["$available_quantity", "$minimum_quantity"] },
        status: { $ne: 'out_of_stock' }
      }).populate('lab', 'name managers');

      if (lowStockItems.length === 0) {
        console.log('No low stock items found');
        return;
      }

      // Group by lab for batch notifications
      const itemsByLab = {};
      lowStockItems.forEach(item => {
        if (!itemsByLab[item.lab._id]) {
          itemsByLab[item.lab._id] = {
            lab: item.lab,
            items: []
          };
        }
        itemsByLab[item.lab._id].items.push(item);
      });

      // Notify lab managers for each lab
      for (const labId in itemsByLab) {
        const { lab, items } = itemsByLab[labId];
        const managerIds = lab.managers || [];
        
        if (managerIds.length === 0) {
          console.warn(`No managers found for lab ${lab.name}`);
          continue;
        }

        // Create notification for each manager
        for (const managerId of managerIds) {
          await Notification.createStockNotification(
            managerId,
            NOTIFICATION_TYPES.STOCK_LOW,
            {
              title: 'Low Stock Alert',
              message: `${items.length} item(s) in ${lab.name} are running low on stock`,
              itemId: items[0]._id,
              labId: lab._id,
              metadata: {
                item_count: items.length,
                lab_name: lab.name,
                items: items.map(item => ({
                  id: item._id,
                  name: item.name,
                  available: item.available_quantity,
                  minimum: item.minimum_quantity
                }))
              }
            }
          );
        }
      }

      console.log(`Low stock check completed. Notified for ${lowStockItems.length} items.`);
    } catch (error) {
      console.error('Error in low stock check:', error);
    }
  }

  /**
   * Check for items expiring soon and notify lab managers
   */
  async checkExpiringItems(days = 7) {
    try {
      console.log('Checking for expiring items...');
      
      const date = new Date();
      date.setDate(date.getDate() + days);
      
      const expiringItems = await Item.find({
        expiry_date: { $lte: date, $gte: new Date() },
        status: { $ne: 'expired' }
      }).populate('lab', 'name managers');

      if (expiringItems.length === 0) {
        console.log('No expiring items found');
        return;
      }

      // Group by lab for batch notifications
      const itemsByLab = {};
      expiringItems.forEach(item => {
        if (!itemsByLab[item.lab._id]) {
          itemsByLab[item.lab._id] = {
            lab: item.lab,
            items: []
          };
        }
        itemsByLab[item.lab._id].items.push(item);
      });

      // Notify lab managers for each lab
      for (const labId in itemsByLab) {
        const { lab, items } = itemsByLab[labId];
        const managerIds = lab.managers || [];
        
        if (managerIds.length === 0) {
          console.warn(`No managers found for lab ${lab.name}`);
          continue;
        }

        // Create notification for each manager
        for (const managerId of managerIds) {
          await Notification.createStockNotification(
            managerId,
            items.some(i => new Date(i.expiry_date) <= new Date()) 
              ? NOTIFICATION_TYPES.STOCK_EXPIRED 
              : NOTIFICATION_TYPES.STOCK_EXPIRING,
            {
              title: items.some(i => new Date(i.expiry_date) <= new Date())
                ? 'Expired Items Alert'
                : 'Items Expiring Soon',
              message: `${items.length} item(s) in ${lab.name} ${items.some(i => new Date(i.expiry_date) <= new Date()) ? 'have expired' : 'will expire soon'}`,
              itemId: items[0]._id,
              labId: lab._id,
              metadata: {
                item_count: items.length,
                lab_name: lab.name,
                items: items.map(item => ({
                  id: item._id,
                  name: item.name,
                  expiry_date: item.expiry_date,
                  quantity: item.available_quantity
                }))
              }
            }
          );
        }
      }

      console.log(`Expiry check completed. Found ${expiringItems.length} items.`);
    } catch (error) {
      console.error('Error in expiry check:', error);
    }
  }
}

// Export singleton instance
module.exports = new StockChecks();
