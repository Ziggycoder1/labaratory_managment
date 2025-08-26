const mongoose = require('mongoose');
const Item = require('../models/Item');
const StockLog = require('../models/StockLog');
const Booking = require('../models/Booking');

/**
 * Release items allocated to a booking
 * @param {string} bookingId - ID of the booking
 * @param {string} userId - ID of user performing the action
 * @param {string} reason - Reason for release (e.g., 'booking_completed', 'booking_cancelled')
 * @param {Object} session - MongoDB session (optional)
 * @returns {Promise<Object>} Result of the operation
 */
/**
 * Release items allocated to a booking
 * @param {string} bookingId - ID of the booking
 * @param {string} userId - ID of the user performing the action
 * @param {string} reason - Reason for release (e.g., 'booking_completed', 'booking_cancelled')
 * @param {Object} [session] - Optional MongoDB session
 * @returns {Promise<Object>} Result of the operation
 */
async function releaseBookingItems(bookingId, userId, reason = 'booking_completed', session = null) {
  const localSession = session || await mongoose.startSession();
  const shouldEndSession = !session;
  
  try {
    if (!session) {
      await localSession.startTransaction();
    }
    
    // Find the booking with populated item requirements
    const booking = await Booking.findById(bookingId)
      .populate({
        path: 'item_requirements.item',
        model: 'Item',
        select: '_id name type available_quantity minimum_quantity status lab'
      })
      .session(localSession);
    
    if (!booking) {
      throw new Error(`Booking not found with ID: ${bookingId}`);
    }

    // Process each item requirement
    for (const req of booking.item_requirements) {
      if (!req.item) {
        console.warn(`Skipping item requirement with missing item in booking ${bookingId}`);
        continue;
      }
      
      const item = req.item; // Already populated
      if (!item) {
        console.warn(`Skipping null item in booking ${bookingId}`);
        continue;
      }
      
      // For consumable items, return the used quantity to available stock
      if (item.type === 'consumable') {
        console.log(`Processing consumable item: ${item.name} (${item._id})`);
        
        // Initialize allocated_consumables if it doesn't exist
        if (!booking.allocated_consumables || !Array.isArray(booking.allocated_consumables)) {
          console.warn(`No allocated_consumables array found for booking ${bookingId}, creating empty array`);
          booking.allocated_consumables = [];
          await booking.save({ session: localSession });
        }
        
        // Find the allocation record for this item
        const allocationIndex = booking.allocated_consumables.findIndex(
          a => a && a.item && a.item.toString() === item._id.toString()
        );
        
        console.log(`Allocation found at index: ${allocationIndex}`);
        
        if (allocationIndex !== -1 && allocationIndex !== undefined) {
          const allocation = booking.allocated_consumables[allocationIndex];
          const allocatedQty = allocation.quantity || 0;
          
          console.log(`Releasing ${allocatedQty} of item ${item.name} (${item._id})`);
          
          if (allocatedQty > 0) {
            // Update item quantity and status
            item.available_quantity += allocatedQty;
            
            if (item.status === 'out_of_stock' && item.available_quantity > 0) {
              item.status = item.available_quantity <= item.minimum_quantity ? 'low_stock' : 'in_stock';
            } else if (item.available_quantity <= item.minimum_quantity) {
              item.status = 'low_stock';
            }
            
            // Save the updated item
            await item.save({ session: localSession, new: true });
            
            // Create stock log entry
            const stockLog = new StockLog({
              item: item._id,
              user: userId,
              lab: booking.lab,
              change_quantity: allocatedQty,
              reason: `Booking ${reason === 'booking_cancelled' ? 'cancellation' : 'completion'}`,
              notes: `Booking ID: ${booking._id}`,
              type: 'add',
              reference_id: booking._id
            });
            
            await stockLog.save({ session: localSession });
            
            // Mark this allocation as returned
            const allocation = {
              ...booking.allocated_consumables[allocationIndex],
              returned_quantity: allocatedQty,
              returned_at: new Date(),
              received_by: userId
            };
            
            // Update the booking's allocated_consumables array
            booking.allocated_consumables[allocationIndex] = allocation;
            
            console.log(`Successfully released ${allocatedQty} of item ${item.name}`);
          }
        } else {
          console.warn(`No active allocation found for item ${item.name} (${item._id}) in booking ${bookingId}`);
        }
      }
      // For non-consumable items, mark as available again
      else if (item.type === 'equipment' && item.status === 'in_use') {
        item.status = 'available';
        await item.save({ session: localSession, new: true });
      }
    }
    
    // Only commit if we started the transaction
    if (shouldEndSession) {
      await localSession.commitTransaction();
    }
    
    return { 
      success: true, 
      bookingId,
      message: `Successfully released items for booking ${bookingId}`
    };
    
  } catch (error) {
    console.error(`Error in releaseBookingItems for booking ${bookingId}:`, error);
    
    // Only abort if we started the transaction
    if (shouldEndSession && localSession.inTransaction()) {
      await localSession.abortTransaction();
    }
    
    throw new Error(`Failed to release booking items: ${error.message}`);
    
  } finally {
    // Only end the session if we created it
    if (shouldEndSession) {
      await localSession.endSession();
    }
  }
}

/**
 * Check and release items from completed bookings
 * @returns {Promise<Object>} Result with count of processed bookings
 */
async function releaseCompletedBookings() {
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      console.log(`[${now.toISOString()}] Checking for completed bookings...`);
      
      // Find all approved bookings that have ended and have item requirements
      const completedBookings = await Booking.find({
        status: 'approved',
        end_time: { $lt: now },
        'item_requirements.0': { $exists: true }
      })
      .populate('approved_by', '_id')
      .populate('user', '_id')
      .session(session);
      
      console.log(`Found ${completedBookings.length} completed bookings to process`);
      
      let successCount = 0;
      const errors = [];
      
      for (const booking of completedBookings) {
        try {
          // Determine which user to attribute the completion to
          const completedBy = booking.approved_by?._id?.toString() || booking.user._id.toString();
          
          // Release items for this booking
          await releaseBookingItems(
            booking._id, 
            completedBy,
            'booking_completed_auto',
            session
          );
          
          // Update booking status to completed
          booking.status = 'completed';
          booking.completed_at = new Date();
          booking.completed_by = completedBy;
          
          await booking.save({ session });
          successCount++;
          
          console.log(`Successfully processed booking ${booking._id}`);
          
        } catch (error) {
          const errorMsg = `Error processing booking ${booking._id}: ${error.message}`;
          console.error(errorMsg);
          errors.push({
            bookingId: booking._id,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
          });
        }
      }
      
      console.log(`Successfully processed ${successCount} of ${completedBookings.length} bookings`);
      
      if (errors.length > 0) {
        console.warn(`Encountered ${errors.length} errors while processing bookings`);
      }
      
      return { 
        success: true,
        processed: successCount,
        total: completedBookings.length,
        errors: errors.length > 0 ? errors : undefined
      };
      
    });
    
  } catch (error) {
    console.error('Error in releaseCompletedBookings transaction:', error);
    return {
      success: false,
      error: error.message,
      processed: 0,
      total: 0,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
  } finally {
    await session.endSession();
  }
}

module.exports = {
  releaseBookingItems,
  releaseCompletedBookings
};
