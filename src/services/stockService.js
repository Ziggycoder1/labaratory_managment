const mongoose = require('mongoose');
const StockLog = require('../models/StockLog');
const { Notification } = require('../models/Notification');
// Import Item model inside methods to avoid circular dependency
let Item;

class StockService {
  constructor() {
    this.session = null;
  }

  async startSession() {
    if (!this.session) {
      this.session = await mongoose.startSession();
    }
    return this.session;
  }

  async commit() {
    if (this.session?.inTransaction?.()) {
      await this.session.commitTransaction();
      await this.endSession();
    }
  }

  async rollback() {
    if (this.session?.inTransaction?.()) {
      try {
        await this.session.abortTransaction();
      } catch (error) {
        console.error('Error aborting transaction:', error);
      }
      await this.endSession();
    }
  }

  async endSession() {
    if (this.session) {
      try {
        await this.session.endSession();
      } catch (error) {
        console.error('Error ending session:', error);
      } finally {
        this.session = null;
      }
    }
  }

  /**
   * Add stock to an item
   */
  async addStock(itemId, quantity, userId, reason = 'Stock added', metadata = {}) {
    try {
      // Ensure Item model is loaded
      if (!Item) Item = require('../models/Item');
      
      const item = await Item.findById(itemId).session(this.session);
      if (!item) throw new Error('Item not found');

      const oldQuantity = item.quantity;
      item.quantity += quantity;
      item.available_quantity += quantity;
      
      await item.save({ session: this.session });
      await this._createStockLog({
        itemId,
        userId,
        labId: item.lab,
        changeQuantity: quantity,
        type: 'add',
        reason,
        metadata: {
          oldQuantity,
          newQuantity: item.quantity,
          ...metadata
        }
      });

      await this._checkStockLevels(item, userId);
      return item;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  /**
   * Remove stock from an item
   */
  async removeStock(itemId, quantity, userId, reason = 'Stock consumed', metadata = {}) {
    try {
      // Ensure Item model is loaded
      if (!Item) Item = require('../models/Item');
      
      const item = await Item.findById(itemId).session(this.session);
      if (!item) throw new Error('Item not found');
      if (item.available_quantity < quantity) {
        throw new Error('Insufficient stock available');
      }

      const oldQuantity = item.quantity;
      item.available_quantity -= quantity;
      
      await item.save({ session: this.session });
      await this._createStockLog({
        itemId,
        userId,
        labId: item.lab,
        changeQuantity: -quantity,
        type: 'remove',
        reason,
        metadata: {
          oldQuantity,
          newQuantity: item.available_quantity,
          ...metadata
        }
      });

      await this._checkStockLevels(item, userId);
      return item;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  /**
   * Move stock between labs
   */
  async moveStock(itemId, fromLabId, toLabId, quantity, userId, reason = 'Stock transfer', options = {}) {
    // Use provided session or check for existing one
    const session = options.session || this.session || await this.startSession();
    const hasExistingSession = !!session?.inTransaction?.();
    const shouldEndSession = !hasExistingSession && !options.session;
    
    try {
      // Start transaction if needed
      if (!hasExistingSession) {
        await session.startTransaction();
      }
      
      // Ensure Item model is loaded
      if (!Item) Item = require('../models/Item');
      
      // 1. Get the source item with current session
      const sourceItem = await Item.findById(itemId).session(session);
      if (!sourceItem) {
        throw new Error('Source item not found');
      }

      // Check if we're moving the full quantity
      const isFullQuantity = sourceItem.quantity === quantity;
      
      if (isFullQuantity) {
        // If moving full quantity, just update the lab
        sourceItem.lab = toLabId;
        await sourceItem.save({ session });
        
        // Create stock log for the move (using transfer_out for the source lab)
        await this._createStockLog({
          itemId: sourceItem._id,
          userId,
          labId: fromLabId,
          changeQuantity: -quantity,
          type: 'transfer_out',
          reason: `Transferred to lab ${toLabId}: ${reason}`,
          metadata: {
            toLab: toLabId,
            quantity: quantity
          },
          session
        });
        
        // Create a transfer_in log for the target lab
        await this._createStockLog({
          itemId: sourceItem._id,
          userId,
          labId: toLabId,
          changeQuantity: quantity,
          type: 'transfer_in',
          reason: `Transferred from lab ${fromLabId}: ${reason}`,
          metadata: {
            fromLab: fromLabId,
            quantity: quantity
          },
          session
        });
        
        // Only commit if we started the transaction
        if (shouldEndSession) {
          await session.commitTransaction();
        }
        
        return {
          sourceItem: null, // No source item as it was moved
          targetItem: sourceItem // The item is now in the target lab
        };
      } else {
        // For partial quantity, use the existing logic
        // 1. Remove from source
        await this.removeStock(itemId, quantity, userId, `Transferred to lab ${toLabId}: ${reason}`);
        
        // 2. Find or create item in target lab
        let targetItem = await Item.findOne({
          name: sourceItem.name,
          lab: toLabId
        }).session(session);
        
        if (!targetItem) {
          // Create a new item in the target lab
          targetItem = new Item({
            ...sourceItem.toObject(),
            _id: new mongoose.Types.ObjectId(),
            lab: toLabId,
            quantity: 0,
            available_quantity: 0,
            minimum_quantity: sourceItem.minimum_quantity,
            unit: sourceItem.unit,
            status: 'available'
          });
          await targetItem.save({ session });
        }

        // 3. Add to target lab
        await this.addStock(targetItem._id, quantity, userId, `Transferred from lab ${fromLabId}: ${reason}`);
        
        // 4. Update stock levels
        await this._checkStockLevels(await Item.findById(itemId).session(session), userId);
        await this._checkStockLevels(await Item.findById(targetItem._id).session(session), userId);
        
        // Only commit if we started the transaction
        if (shouldEndSession) {
          await session.commitTransaction();
        }
        
        return {
          sourceItem: await Item.findById(itemId).session(session),
          targetItem: await Item.findById(targetItem._id).session(session)
        };
      }
    } catch (error) {
      // Only abort if we started the transaction
      if (shouldEndSession) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          console.error('Error aborting transaction:', abortError);
        }
      }
      throw error;
    } finally {
      // End session only if we started it
      if (shouldEndSession) {
        try {
          await session.endSession();
        } catch (endSessionError) {
          console.error('Error ending session:', endSessionError);
        }
      }
    }
  }

  /**
   * Adjust stock (manual correction)
   */
  async adjustStock(itemId, newQuantity, userId, reason = 'Stock adjustment', metadata = {}) {
    try {
      // Ensure Item model is loaded
      if (!Item) Item = require('../models/Item');
      
      const item = await Item.findById(itemId).session(this.session);
      if (!item) throw new Error('Item not found');

      const oldQuantity = item.quantity;
      const difference = newQuantity - item.quantity;
      
      item.quantity = newQuantity;
      item.available_quantity += difference;
      
      if (item.available_quantity < 0) {
        throw new Error('Available quantity cannot be negative');
      }

      await item.save({ session: this.session });
      
      await this._createStockLog({
        itemId,
        userId,
        labId: item.lab,
        changeQuantity: difference,
        type: 'adjustment',
        reason,
        metadata: {
          oldQuantity,
          newQuantity,
          ...metadata
        }
      });

      await this._checkStockLevels(item);
      return item;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  /**
   * Check stock levels and trigger alerts if needed
   */
  async _checkStockLevels(item, userId = null) {
    let status = 'available';
    let notificationType = null;
    
    if (item.available_quantity <= 0) {
      status = 'out_of_stock';
      notificationType = 'stock_out';
    } else if (item.available_quantity <= item.minimum_quantity) {
      status = 'low_stock';
      notificationType = 'low_stock';
    }

    // Check for expiry if applicable
    if (item.expiry_date && new Date(item.expiry_date) < new Date()) {
      status = 'expired';
      notificationType = 'item_expired';
    }

    if (item.status !== status) {
      item.status = status;
      await item.save({ session: this.session });
      
      if (notificationType) {
        // If no user ID is provided, try to get it from the current session
        const notificationUserId = userId || (this.session?.userId) || null;
        
        // Only create notification if we have a user ID
        if (notificationUserId) {
          await this._createNotification({
            user: notificationUserId,
            type: notificationType,
            title: `Item ${status.replace('_', ' ')}`,
            message: `${item.name} is now ${status.replace('_', ' ')} in lab ${item.lab}`,
            item: item._id,
            lab: item.lab,
            metadata: {
              currentQuantity: item.available_quantity,
              minimumQuantity: item.minimum_quantity,
              expiryDate: item.expiry_date
            }
          });
        } else {
          console.warn('Skipping notification: No user ID available for stock level change');
        }
      }
    }
  }

  /**
   * Create stock log entry
   */
  async _createStockLog({ itemId, userId, labId, changeQuantity, type, reason, metadata = {} }) {
    // Lazy load Item model to avoid circular dependency
    if (!Item) Item = require('../models/Item');
    
    // Get the current item to include in the log
    const item = await Item.findById(itemId).session(this.session || null);
    
    const log = new StockLog({
      item: itemId,
      user: userId,
      lab: labId,
      change_quantity: changeQuantity,
      type,
      reason,
      metadata: {
        ...metadata,
        currentQuantity: item ? item.available_quantity : 0,
        minimumQuantity: item ? item.minimum_quantity : 0,
        expiryDate: item ? item.expiry_date : null
      },
      timestamp: new Date()
    });
    
    if (this.session) {
      log.$session(this.session);
    }
    
    return await log.save();
  }

  /**
   * Create notification
   */
  async _createNotification(notificationData) {
    const notificationDataWithDefaults = {
      ...notificationData,
      is_read: false,
      created_at: new Date()
    };
    
    const options = this.session ? { session: this.session } : {};
    
    return await Notification.create([notificationDataWithDefaults], options).then(
      (notifications) => notifications[0]
    );
  }

  /**
   * Get stock history for an item
   */
  async getStockHistory(itemId, { page = 1, limit = 50 } = {}) {
    try {
      // Ensure Item model is loaded
      if (!Item) Item = require('../models/Item');
      
      const skip = (page - 1) * limit;
      
      const [logs, total] = await Promise.all([
        StockLog.find({ item: itemId })
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .populate('user', 'name email')
          .populate('lab', 'name'),
        StockLog.countDocuments({ item: itemId })
      ]);

      return {
        data: logs,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error getting stock history:', error);
      throw error;
    }
  }
}

module.exports = new StockService();
