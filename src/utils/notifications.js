const User = require('../models/User');
const { Notification } = require('../models/Notification');

// Save notification to DB
const createNotification = async ({ 
  user, 
  type, 
  title, 
  message, 
  data, 
  priority = 'normal', 
  action_url, 
  related_item, 
  related_lab,
  session = null
}) => {
  try {
    console.log('Creating notification:', { 
      user, 
      type, 
      title, 
      message: message?.substring(0, 100) + '...',
      data: data ? 'data present' : 'no data',
      priority,
      action_url,
      related_item: related_item ? 'related_item present' : 'no related_item',
      related_lab: related_lab ? 'related_lab present' : 'no related_lab',
      inTransaction: !!session
    });

    const notificationData = { 
      user, 
      type, 
      title, 
      message, 
      data, 
      priority, 
      action_url,
      related_item,
      related_lab,
      created_at: new Date()
    };
    
    // Use the session if provided to include in transaction
    const options = session ? { session } : {};
    
    const notification = await Notification.create([notificationData], options);
    
    console.log('Notification created successfully:', {
      id: notification[0]._id,
      user: notification[0].user,
      type: notification[0].type,
      created_at: notification[0].created_at
    });
    
    return notification[0];
  } catch (error) {
    console.error('Error creating notification:', {
      error: error.message,
      stack: error.stack,
      notificationData: { user, type, title }
    });
    // Don't throw error to prevent blocking the main operation
    return null;
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

const sendBookingStatusUpdate = async (booking, user, status, rejectionReason = null, related_lab = null, adminId = null) => {
  try {
    let type = status === 'approved' ? 'booking_approved' : 'booking_rejected';
    let title = status === 'approved' ? 'Booking Approved' : 'Booking Rejected';
    
    // Student message
    let studentMessage = status === 'approved'
      ? `Your booking for ${booking.lab?.name || 'a lab'} has been approved`
      : `Your booking for ${booking.lab?.name || 'a lab'} was rejected${rejectionReason ? ': ' + rejectionReason : ''}`;
    
    console.log('Sending booking status update:', {
      type,
      title,
      message: studentMessage,
      userId: user?._id,
      status
    });

    // Create notification for student
    await createNotification({
      user: user?._id,
      type,
      title,
      message: studentMessage,
      data: { 
        booking_id: booking?._id, 
        lab_name: booking.lab?.name, 
        start_time: booking.start_time,
        status
      },
      action_url: `/bookings/${booking?._id || ''}`,
      related_lab: related_lab || booking.lab?._id,
      priority: 'high'
    });

    // If this is an approval and we have an adminId, create a notification for the admin too
    if (status === 'approved' && adminId) {
      const adminMessage = `You approved booking #${booking.booking_reference || booking._id} for ${user?.full_name || 'a student'}`;
      
      console.log('Creating admin notification:', {
        adminId,
        message: adminMessage
      });
      
      await createNotification({
        user: adminId,
        type: 'booking_approval_confirmation',
        title: 'Booking Approved',
        message: adminMessage,
        data: {
          booking_id: booking?._id,
          lab_name: booking.lab?.name,
          student_name: user?.full_name,
          student_email: user?.email,
          start_time: booking.start_time
        },
        action_url: `/bookings/${booking?._id || ''}`,
        related_lab: related_lab || booking.lab?._id,
        priority: 'normal'
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error in sendBookingStatusUpdate:', {
      message: error.message,
      stack: error.stack,
      bookingId: booking?._id,
      userId: user?._id
    });
    return false;
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

/**
 * Send notification for borrow request status update
 * @param {Object} borrowLog - The borrow log document
 * @param {Object} user - The user who initiated the action
 * @param {string} status - Status of the borrow request (pending, approved, rejected, returned)
 * @param {Object} options - Additional options
 * @param {string} [options.reason] - Reason for rejection (if any)
 * @param {string} [options.condition_after] - Condition of the item when returned
 * @param {string} [options.damage_notes] - Notes about any damage
 * @param {number} [options.fine_amount] - Fine amount if applicable
 * @param {ObjectId} [options.session] - Mongoose session for transaction
 * @returns {Promise<Array>} Array of notification results
 */
const sendBorrowStatusUpdate = async (borrowLog, user, status, options = {}) => {
  const {
    reason = '',
    condition_after = '',
    damage_notes = '',
    fine_amount = 0,
    session = null
  } = options;

  const notifications = [];
  const item = borrowLog.item;
  // Normalize IDs whether borrowLog.item/lab are populated objects or raw ObjectIds
  const itemId = (item && typeof item === 'object' && item._id) ? item._id : item;
  const labId = (borrowLog.lab && typeof borrowLog.lab === 'object' && borrowLog.lab._id) ? borrowLog.lab._id : borrowLog.lab;
  const isOverdue = status === 'returned' && new Date() > borrowLog.expected_return_date;

  try {
    // Notification for the requester
    let requesterNotification = null;
    switch (status) {
      case 'pending':
        requesterNotification = {
          user: borrowLog.user,
          type: 'borrow_requested',
          title: 'Borrow Request Submitted',
          message: `Your request to borrow ${item?.name || 'an item'} has been submitted for approval`,
          data: {
            item_id: itemId,
            item_name: item?.name,
            request_date: borrowLog.created_at,
            expected_return_date: borrowLog.expected_return_date
          },
          action_url: `/my-borrowings/${borrowLog._id}`,
          related_item: itemId,
          related_lab: labId,
          priority: 'normal',
          session
        };
        break;

      case 'approved':
        requesterNotification = {
          user: borrowLog.user,
          type: 'borrow_approved',
          title: 'Borrow Request Approved',
          message: `Your request to borrow ${item?.name || 'an item'} has been approved`,
          data: {
            item_id: itemId,
            item_name: item?.name,
            approved_by: user._id,
            approved_at: new Date(),
            expected_return_date: borrowLog.expected_return_date,
            borrow_id: borrowLog._id
          },
          action_url: `/my-borrowings/${borrowLog._id}`,
          related_item: itemId,
          related_lab: labId,
          priority: 'high',
          session
        };
        break;

      case 'rejected':
        requesterNotification = {
          user: borrowLog.user,
          type: 'borrow_rejected',
          title: 'Borrow Request Rejected',
          message: `Your borrow request has been rejected${reason ? `: ${reason}` : ''}`,
          data: {
            item_id: itemId,
            item_name: item?.name,
            rejected_by: user._id,
            rejected_at: new Date(),
            rejected_reason: reason,
            request_date: borrowLog.created_at
          },
          action_url: `/my-borrowings/${borrowLog._id}`,
          related_item: itemId,
          related_lab: labId,
          priority: 'high',
          session
        };
        break;

      case 'returned':
        requesterNotification = {
          user: borrowLog.user,
          type: 'item_return_confirmed',
          title: 'Item Return Confirmed',
          message: `You have successfully returned ${item?.name || 'the item'}`,
          data: {
            item_id: itemId,
            item_name: item?.name,
            returned_at: new Date(),
            condition_after,
            fine_imposed: fine_amount > 0 ? 'Yes' : 'No',
            fine_amount,
            is_overdue: isOverdue ? 'Yes' : 'No'
          },
          action_url: `/my-borrowings/${borrowLog._id}`,
          related_item: itemId,
          related_lab: labId,
          priority: 'normal',
          session
        };
        break;
    }

    if (requesterNotification) {
      notifications.push(await createNotification(requesterNotification));
    }

    // Notification for lab managers/admins (except for pending status)
    if (status !== 'pending') {
      let managerNotification = null;
      
      switch (status) {
        case 'approved':
          managerNotification = {
            user: user._id, // The admin who approved
            type: 'borrow_approval_confirmation',
            title: 'Borrow Request Approved',
            message: `You approved a borrow request for ${item?.name || 'an item'}`,
            data: {
              item_id: itemId,
              item_name: item?.name,
              requester_id: borrowLog.user,
              approved_at: new Date(),
              expected_return_date: borrowLog.expected_return_date,
              borrow_id: borrowLog._id
            },
            action_url: `/borrow-requests/${borrowLog._id}`,
            related_item: itemId,
            related_lab: labId,
            priority: 'normal',
            session
          };
          break;

        case 'rejected':
          managerNotification = {
            user: user._id, // The admin who rejected
            type: 'borrow_rejection_confirmation',
            title: 'Borrow Request Rejected',
            message: `You rejected a borrow request for ${item?.name || 'an item'}`,
            data: {
              item_id: itemId,
              item_name: item?.name,
              requester_id: borrowLog.user,
              rejected_at: new Date(),
              rejected_reason: reason,
              request_date: borrowLog.created_at
            },
            action_url: `/borrow-requests/${borrowLog._id}`,
            related_item: itemId,
            related_lab: labId,
            priority: 'normal',
            session
          };
          break;

        case 'returned':
          managerNotification = {
            user: user._id,
            type: 'item_return_recorded',
            title: 'Item Return Recorded',
            message: `You recorded a return for ${item?.name || 'an item'}`,
            data: {
              item_id: itemId,
              item_name: item?.name,
              requester_id: borrowLog.user,
              damage_notes,
              fine_amount,
              returned_at: new Date(),
            },
            action_url: `/borrow-logs/${borrowLog._id}`,
            related_item: itemId,
            related_lab: labId,
            priority: 'low',
            session
          };
          break;
      }

      if (managerNotification) {
        notifications.push(await createNotification(managerNotification));
      }
    }

    return notifications;
  } catch (error) {
    console.error('Error sending borrow status update:', error);
    return notifications;
  }
};

/**
 * Send notification for user account actions (create, update, delete)
 * @param {Object} user - The user document
 * @param {Object} actor - The user who performed the action
 * @param {string} action - Action performed (created, updated, deleted, status_changed)
 * @param {Object} options - Additional options
 * @param {string} [options.oldStatus] - Previous status for status changes
 * @param {string} [options.newStatus] - New status for status changes
 * @param {ObjectId} [options.session] - Mongoose session for transaction
 * @returns {Promise<Object>} Notification result
 */
const sendUserNotification = async (user, actor, action, options = {}) => {
  const { oldStatus, newStatus, session = null } = options;
  let notificationData = {
    user: user._id,
    type: `user_${action}`,
    priority: 'high',
    data: {
      user_id: user._id,
      user_name: user.full_name || user.email,
      action_by: actor._id,
      action_by_name: actor.full_name || actor.email,
      action_at: new Date()
    },
    action_url: `/users/${user._id}`,
    session
  };

  switch (action) {
    case 'created':
      notificationData.title = 'New User Account';
      notificationData.message = `A new user account has been created for ${user.full_name || user.email}`;
      notificationData.data.role = user.role;
      break;
      
    case 'updated':
      notificationData.title = 'User Account Updated';
      notificationData.message = `The account for ${user.full_name || user.email} has been updated`;
      break;
      
    case 'deleted':
      notificationData.title = 'User Account Deleted';
      notificationData.message = `The account for ${user.email} has been deleted`;
      notificationData.user = actor._id; // Notify the admin who performed the action
      break;
      
    case 'status_changed':
      notificationData.title = 'User Status Changed';
      notificationData.message = `Account status for ${user.full_name || user.email} changed from ${oldStatus} to ${newStatus}`;
      notificationData.data.old_status = oldStatus;
      notificationData.data.new_status = newStatus;
      break;
  }

  return await createNotification(notificationData);
};

/**
 * Send notification for lab management actions
 * @param {Object} lab - The lab document
 * @param {Object} actor - The user who performed the action
 * @param {string} action - Action performed (created, updated, deleted, status_changed)
 * @param {Object} options - Additional options
 * @param {ObjectId} [options.session] - Mongoose session for transaction
 * @returns {Promise<Object>} Notification result
 */
const sendLabNotification = async (lab, actor, action, options = {}) => {
  const { session = null } = options;
  let notificationData = {
    user: actor._id, // Default to actor, can be overridden
    type: `lab_${action}`,
    priority: 'normal',
    data: {
      lab_id: lab._id,
      lab_name: lab.name,
      action_by: actor._id,
      action_by_name: actor.full_name || actor.email,
      action_at: new Date()
    },
    related_lab: lab._id,
    action_url: `/labs/${lab._id}`,
    session
  };

  switch (action) {
    case 'created':
      notificationData.title = 'New Lab Created';
      notificationData.message = `A new lab "${lab.name}" has been created`;
      // Notify all admins and lab managers
      notificationData.user = null; // Will be set to all admins/lab managers
      break;
      
    case 'updated':
      notificationData.title = 'Lab Updated';
      notificationData.message = `Lab "${lab.name}" has been updated`;
      // Notify lab managers and admins
      notificationData.user = null; // Will be set to lab managers and admins
      break;
      
    case 'deleted':
      notificationData.title = 'Lab Deleted';
      notificationData.message = `Lab "${lab.name}" has been deleted`;
      // Only notify admins about deletion
      notificationData.user = null; // Will be set to admins
      notificationData.priority = 'high';
      break;
  }

  return await createNotification(notificationData);
};

/**
 * Send notification for department management actions
 * @param {Object} department - The department document
 * @param {Object} actor - The user who performed the action
 * @param {string} action - Action performed (created, updated, deleted)
 * @param {Object} options - Additional options
 * @param {ObjectId} [options.session] - Mongoose session for transaction
 * @returns {Promise<Object>} Notification result
 */
const sendDepartmentNotification = async (department, actor, action, options = {}) => {
  const { session = null } = options;
  let notificationData = {
    user: actor._id, // Default to actor, can be overridden
    type: `department_${action}`,
    priority: 'normal',
    data: {
      department_id: department._id,
      department_name: department.name,
      action_by: actor._id,
      action_by_name: actor.full_name || actor.email,
      action_at: new Date()
    },
    action_url: `/departments/${department._id}`,
    session
  };

  switch (action) {
    case 'created':
      notificationData.title = 'New Department Created';
      notificationData.message = `A new department "${department.name}" has been created`;
      // Notify all admins
      notificationData.user = null; // Will be set to all admins
      break;
      
    case 'updated':
      notificationData.title = 'Department Updated';
      notificationData.message = `Department "${department.name}" has been updated`;
      // Notify department head and admins
      notificationData.user = null; // Will be set to department head and admins
      break;
      
    case 'deleted':
      notificationData.title = 'Department Deleted';
      notificationData.message = `Department "${department.name}" has been deleted`;
      // Only notify admins about deletion
      notificationData.user = null; // Will be set to admins
      notificationData.priority = 'high';
      break;
  }

  return await createNotification(notificationData);
};

/**
 * Send notification for item movements (transfer, restock, etc.)
 * @param {Object} item - The item document
 * @param {Object} actor - The user who performed the action
 * @param {string} action - Type of movement (transferred, restocked, adjusted, damaged, disposed)
 * @param {Object} options - Additional options
 * @param {number} [options.quantity] - Quantity involved in the movement
 * @param {ObjectId} [options.fromLab] - Source lab for transfers
 * @param {ObjectId} [options.toLab] - Destination lab for transfers
 * @param {string} [options.notes] - Additional notes about the movement
 * @param {ObjectId} [options.session] - Mongoose session for transaction
 * @returns {Promise<Object>} Notification result
 */
const sendItemMovementNotification = async (item, actor, action, options = {}) => {
  const { 
    quantity = 1, 
    fromLab = null, 
    toLab = null, 
    notes = '',
    session = null 
  } = options;

  const notificationData = {
    user: null, // Will be set based on context
    type: `item_${action}`,
    priority: 'normal',
    data: {
      item_id: item._id,
      item_name: item.name,
      item_type: item.type,
      quantity,
      action_by: actor._id,
      action_by_name: actor.full_name || actor.email,
      action_at: new Date(),
      notes
    },
    related_item: item._id,
    action_url: `/items/${item._id}`,
    session
  };

  // Set notification details based on action type
  switch (action) {
    case 'transferred':
      notificationData.title = 'Item Transferred';
      notificationData.message = `${quantity} ${item.name} transferred` + 
        (fromLab ? ` from lab ${fromLab}` : '') +
        (toLab ? ` to lab ${toLab}` : '');
      notificationData.related_lab = toLab || fromLab;
      notificationData.data.from_lab = fromLab;
      notificationData.data.to_lab = toLab;
      // Notify both source and destination lab managers
      break;

    case 'restocked':
      notificationData.title = 'Item Restocked';
      notificationData.message = `${quantity} ${item.name} added to inventory`;
      notificationData.priority = 'low';
      // Notify inventory managers and admins
      break;

    case 'adjusted':
      notificationData.title = 'Inventory Adjusted';
      notificationData.message = `Inventory for ${item.name} adjusted by ${quantity > 0 ? '+' : ''}${quantity}`;
      notificationData.priority = 'high';
      // Notify inventory managers and admins
      break;

    case 'damaged':
      notificationData.title = 'Item Damaged';
      notificationData.message = `${quantity} ${item.name} marked as damaged`;
      notificationData.priority = 'high';
      // Notify lab managers and admins
      break;

    case 'disposed':
      notificationData.title = 'Item Disposed';
      notificationData.message = `${quantity} ${item.name} disposed`;
      notificationData.priority = 'high';
      // Notify lab managers and admins
      break;
  }

  return await createNotification(notificationData);
};

// Export all notification functions
module.exports = {
  createNotification,
  sendBookingNotificationToAdmin,
  sendBookingStatusUpdate,
  sendBookingReminder,
  sendLowStockAlert,
  sendBorrowStatusUpdate,
  sendUserNotification,
  sendLabNotification,
  sendDepartmentNotification,
  sendItemMovementNotification
};