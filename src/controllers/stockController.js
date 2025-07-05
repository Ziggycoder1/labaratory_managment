const stockService = require('../services/stockService');
const Item = require('../models/Item');
const { validationResult } = require('express-validator');

class StockController {
  /**
   * Add stock to an item
   */
  async addStock(req, res, next) {
    try {
      await stockService.startSession();
      
      const { itemId } = req.params;
      const { quantity, reason, notes } = req.body;
      
      const item = await stockService.addStock(
        itemId,
        parseFloat(quantity),
        req.user.id,
        reason || 'Stock added',
        { notes }
      );
      
      await stockService.commit();
      
      res.json({
        success: true,
        message: 'Stock added successfully',
        data: item
      });
    } catch (error) {
      await stockService.rollback();
      next(error);
    }
  }

  /**
   * Remove stock from an item
   */
  async removeStock(req, res, next) {
    try {
      await stockService.startSession();
      
      const { itemId } = req.params;
      const { quantity, reason, notes } = req.body;
      
      const item = await stockService.removeStock(
        itemId,
        parseFloat(quantity),
        req.user.id,
        reason || 'Stock consumed',
        { notes }
      );
      
      await stockService.commit();
      
      res.json({
        success: true,
        message: 'Stock removed successfully',
        data: item
      });
    } catch (error) {
      await stockService.rollback();
      next(error);
    }
  }

  /**
   * Move stock between labs
   */
  async moveStock(req, res, next) {
    let session = null;
    const hasExistingSession = stockService.session?.inTransaction?.();
    let shouldEndSession = false;
    
    try {
      // Only start a new session if one doesn't exist
      if (!hasExistingSession) {
        session = await stockService.startSession();
        await session.startTransaction();
        shouldEndSession = true;
      } else {
        session = stockService.session;
      }
      
      const { itemId } = req.params;
      const { 
        target_lab_id, 
        source_lab_id, 
        quantity, 
        reason, 
        notes, 
        userId 
      } = req.body;
      
      // Validate required fields
      if (!target_lab_id) {
        if (shouldEndSession) {
          await session.abortTransaction();
          await session.endSession();
        }
        return res.status(400).json({
          success: false,
          message: 'Target lab ID is required',
          status: 400
        });
      }
      
      if (!quantity || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
        if (shouldEndSession) {
          await session.abortTransaction();
          await session.endSession();
        }
        return res.status(400).json({
          success: false,
          message: 'Valid quantity is required',
          status: 400
        });
      }
      
      // Get the user ID from the request or body
      const performingUserId = req.user?.id || userId;
      
      if (!performingUserId) {
        if (shouldEndSession) {
          await session.abortTransaction();
          await session.endSession();
        }
        return res.status(401).json({
          success: false,
          message: 'User not authenticated',
          status: 401
        });
      }
      
      console.log(`Moving item ${itemId} from lab ${source_lab_id} to ${target_lab_id}`, {
        quantity: parseFloat(quantity),
        reason: reason || 'Stock transfer',
        userId: performingUserId,
        hasExistingSession,
        shouldEndSession
      });
      
      const result = await stockService.moveStock(
        itemId,
        source_lab_id,
        target_lab_id,
        parseFloat(quantity),
        performingUserId,
        reason || 'Stock transfer',
        { 
          notes,
          session
        }
      );
      
      // Only commit if we started the transaction
      if (shouldEndSession) {
        await session.commitTransaction();
      }
      
      res.json({
        success: true,
        message: 'Stock moved successfully',
        data: result
      });
    } catch (error) {
      console.error('Error moving stock:', error);
      
      // Only abort if we started the transaction
      if (session && shouldEndSession) {
        try {
          await session.abortTransaction();
        } catch (abortError) {
          console.error('Error aborting transaction:', abortError);
        }
      }
      
      // Send appropriate error response
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || 'Failed to move stock',
        status,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    } finally {
      // End the session if we started it
      if (session && shouldEndSession) {
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
  async adjustStock(req, res, next) {
    try {
      await stockService.startSession();
      
      const { itemId } = req.params;
      const { new_quantity, reason, notes } = req.body;
      
      const item = await stockService.adjustStock(
        itemId,
        parseFloat(new_quantity),
        req.user.id,
        reason || 'Stock adjustment',
        { notes }
      );
      
      await stockService.commit();
      
      res.json({
        success: true,
        message: 'Stock adjusted successfully',
        data: item
      });
    } catch (error) {
      await stockService.rollback();
      next(error);
    }
  }

  /**
   * Get stock history for an item
   */
  async getStockHistory(req, res, next) {
    try {
      const { itemId } = req.params;
      const { page = 1, limit = 50 } = req.query;
      
      const result = await stockService.getStockHistory(itemId, { 
        page: parseInt(page), 
        limit: Math.min(parseInt(limit), 100) 
      });
      
      res.json({
        success: true,
        data: result.data,
        pagination: result.pagination
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get low stock items
   */
  async getLowStockItems(req, res, next) {
    try {
      const { lab_id } = req.query;
      const items = await Item.getLowStockItems(lab_id);
      
      res.json({
        success: true,
        data: items,
        count: items.length
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get expiring items
   */
  async getExpiringItems(req, res, next) {
    try {
      const { lab_id, days = 30 } = req.query;
      const items = await Item.getExpiringItems(parseInt(days), lab_id);
      
      res.json({
        success: true,
        data: items,
        count: items.length
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new StockController();
