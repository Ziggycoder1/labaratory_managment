const mongoose = require('mongoose');
const { Schema } = mongoose;

const itemRequirementSchema = new Schema({
  item: { 
    type: Schema.Types.ObjectId, 
    ref: 'Item', 
    required: true 
  },
  name: { type: String }, // Denormalized for easier queries
  type: { 
    type: String, 
    enum: ['consumable', 'non_consumable', 'fixed_asset'],
    required: true 
  },
  quantity_needed: { 
    type: Number, 
    required: true, 
    min: [1, 'Quantity must be at least 1'] 
  },
  quantity_allocated: { 
    type: Number, 
    default: 0,
    min: [0, 'Allocated quantity cannot be negative']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'partially_fulfilled'],
    default: 'pending'
  },
  notes: { 
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  approved_by: { 
    type: Schema.Types.ObjectId, 
    ref: 'User' 
  },
  approved_at: { 
    type: Date 
  },
  rejection_reason: {
    type: String,
    maxlength: [500, 'Rejection reason cannot exceed 500 characters']
  }
}, { _id: true, timestamps: true });

const allocatedConsumableSchema = new Schema({
  item: { 
    type: Schema.Types.ObjectId, 
    ref: 'Item', 
    required: true 
  },
  name: { type: String }, // Denormalized for easier queries
  quantity: { 
    type: Number, 
    required: true, 
    min: [1, 'Quantity must be at least 1'] 
  },
  allocated_by: { 
    type: Schema.Types.ObjectId, 
    ref: 'User',
    required: true 
  },
  allocated_at: { 
    type: Date, 
    default: Date.now 
  },
  returned_quantity: {
    type: Number,
    default: 0,
    min: [0, 'Returned quantity cannot be negative']
  },
  returned_at: {
    type: Date
  },
  received_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  }
}, { _id: true, timestamps: true });

const bookingSchema = new Schema({
  // Core booking information
  lab: { 
    type: Schema.Types.ObjectId, 
    ref: 'Lab', 
    required: [true, 'Lab is required'] 
  },
  field: { 
    type: Schema.Types.ObjectId, 
    ref: 'Field', 
    required: [true, 'Field is required'] 
  },
  user: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: [true, 'User is required'] 
  },
  // Free-text name of the person who made the booking (from UI)
  user_name: {
    type: String,
    trim: true,
    maxlength: [200, 'Booked by name cannot exceed 200 characters']
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  start_time: { 
    type: Date, 
    required: [true, 'Start time is required'] 
  },
  end_time: { 
    type: Date, 
    required: [true, 'End time is required'] 
  },
  
  // Booking metadata
  booking_type: { 
    type: String, 
    enum: {
      values: ['lecture', 'practical', 'exam', 'research', 'meeting', 'maintenance', 'other'],
      message: 'Invalid booking type'
    },
    required: [true, 'Booking type is required']
  },
  
  // Participants and capacity
  participants_count: { 
    type: Number, 
    min: [1, 'At least one participant is required'],
    default: 1 
  },
  max_participants: {
    type: Number,
    min: [1, 'Maximum participants must be at least 1']
  },
  
  // Item management
  item_requirements: [itemRequirementSchema],
  allocated_consumables: [allocatedConsumableSchema],
  
  // Status and workflow
  status: { 
    type: String, 
    enum: {
      values: ['draft', 'pending', 'approved', 'rejected', 'cancelled', 'completed'],
      message: 'Invalid status'
    },
    default: 'draft'
  },
  
  // Approval information
  approved_by: { 
    type: Schema.Types.ObjectId, 
    ref: 'User' 
  },
  approved_at: { 
    type: Date 
  },
  rejected_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  rejected_at: {
    type: Date
  },
  rejection_reason: { 
    type: String,
    maxlength: [500, 'Rejection reason cannot exceed 500 characters']
  },
  
  // Timing and scheduling
  setup_time_needed: { 
    type: Number, 
    min: [0, 'Setup time cannot be negative'],
    default: 0 
  },
  cleanup_time_required: { 
    type: Number, 
    min: [0, 'Cleanup time cannot be negative'],
    default: 0 
  },
  actual_start_time: {
    type: Date
  },
  actual_end_time: {
    type: Date
  },
  
  // Recurring bookings
  is_recurring: { 
    type: Boolean, 
    default: false 
  },
  recurring_pattern: {
    frequency: { 
      type: String, 
      enum: ['daily', 'weekly', 'biweekly', 'monthly', 'custom'],
      required: function() { return this.is_recurring; }
    },
    interval: {
      type: Number,
      min: [1, 'Interval must be at least 1'],
      default: 1
    },
    end_date: { 
      type: Date,
      required: function() { return this.is_recurring; },
      validate: {
        validator: function(value) {
          return !this.is_recurring || value > this.start_time;
        },
        message: 'End date must be after start time'
      }
    },
    days_of_week: [{ 
      type: Number, 
      min: 0, 
      max: 6, // 0=Sunday, 6=Saturday
      validate: {
        validator: function(v) {
          return !this.is_recurring || this.recurring_pattern.frequency === 'weekly' || 
                 this.recurring_pattern.frequency === 'biweekly' || 
                 this.recurring_pattern.frequency === 'custom';
        },
        message: 'Days of week are only applicable for weekly/biweekly/custom recurring bookings'
      }
    }],
    month_day: {
      type: Number,
      min: 1,
      max: 31,
      validate: {
        validator: function(v) {
          return !this.is_recurring || this.recurring_pattern.frequency === 'monthly';
        },
        message: 'Month day is only applicable for monthly recurring bookings'
      }
    },
    custom_dates: [{
      type: Date,
      validate: {
        validator: function(v) {
          return !this.is_recurring || this.recurring_pattern.frequency === 'custom';
        },
        message: 'Custom dates are only applicable for custom recurring bookings'
      }
    }]
  },
  
  // Allocated consumables
  allocated_consumables: [allocatedConsumableSchema],
  
  // Additional information
  special_requirements: {
    type: String,
    maxlength: [1000, 'Special requirements cannot exceed 1000 characters']
  },
  internal_notes: {
    type: String,
    maxlength: [2000, 'Internal notes cannot exceed 2000 characters']
  },
  
  // Audit fields
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updated_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Soft delete
  is_deleted: {
    type: Boolean,
    default: false
  },
  deleted_at: {
    type: Date
  },
  deleted_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

// Indexes for efficient querying
bookingSchema.index({ lab: 1, start_time: 1, end_time: 1 });
bookingSchema.index({ 'field': 1, start_time: 1, end_time: 1 });
bookingSchema.index({ user: 1, created_at: -1 });
bookingSchema.index({ status: 1, start_time: 1 });
bookingSchema.index({ 'item_requirements.item': 1, start_time: 1 });
bookingSchema.index({ 'item_requirements.status': 1 });
bookingSchema.index({ is_recurring: 1, 'recurring_pattern.end_date': 1 });
bookingSchema.index({ is_deleted: 1 });
bookingSchema.index({ 'allocated_consumables.item': 1, 'allocated_consumables.returned_quantity': 1 });

// Virtuals for calculated fields
bookingSchema.virtual('duration_minutes').get(function() {
  return (this.end_time - this.start_time) / (1000 * 60);
});

bookingSchema.virtual('duration_hours').get(function() {
  return this.duration_minutes / 60;
});

bookingSchema.virtual('total_setup_time').get(function() {
  return this.setup_time_needed + this.cleanup_time_required;
});

bookingSchema.virtual('actual_duration_minutes').get(function() {
  if (!this.actual_start_time || !this.actual_end_time) return null;
  return (this.actual_end_time - this.actual_start_time) / (1000 * 60);
});

bookingSchema.virtual('is_past').get(function() {
  return this.end_time < new Date();
});

bookingSchema.virtual('is_ongoing').get(function() {
  const now = new Date();
  return this.start_time <= now && this.end_time >= now;
});

bookingSchema.virtual('is_upcoming').get(function() {
  return this.start_time > new Date();
});

// Pre-save middleware for validation
bookingSchema.pre('validate', function(next) {
  // Validate end time is after start time
  if (this.end_time <= this.start_time) {
    const err = new Error('End time must be after start time');
    err.name = 'ValidationError';
    return next(err);
  }
  
  // Validate recurring pattern if this is a recurring booking
  if (this.is_recurring) {
    if (!this.recurring_pattern || !this.recurring_pattern.frequency) {
      const err = new Error('Recurring pattern is required for recurring bookings');
      err.name = 'ValidationError';
      return next(err);
    }
    
    if (this.recurring_pattern.frequency === 'weekly' && 
        (!this.recurring_pattern.days_of_week || this.recurring_pattern.days_of_week.length === 0)) {
      const err = new Error('Days of week are required for weekly recurring bookings');
      err.name = 'ValidationError';
      return next(err);
    }
  }
  
  next();
});

// Pre-save middleware to validate time conflicts and field availability
bookingSchema.pre('save', async function(next) {
  // Skip validation for deleted or cancelled bookings
  if (this.is_deleted || this.status === 'cancelled') {
    return next();
  }
  
  // Only validate if relevant fields have changed
  const relevantFields = ['start_time', 'end_time', 'lab', 'field', 'status', 'is_deleted'];
  const shouldValidate = this.isNew || Object.keys(this.getChanges())
    .some(field => relevantFields.includes(field));
  
  if (!shouldValidate) {
    return next();
  }
  
  const Booking = this.constructor;
  
  // Check for overlapping bookings for the same field
  const query = {
    _id: { $ne: this._id },
    field: this.field,
    status: { $in: ['pending', 'approved'] },
    is_deleted: { $ne: true },
    $or: [
      {
        // Case 1: New booking starts during an existing booking
        start_time: { $lt: this.end_time },
        end_time: { $gt: this.start_time }
      },
      // Case 2: New booking completely contains an existing booking
      {
        start_time: { $gte: this.start_time, $lte: this.end_time },
        end_time: { $gte: this.start_time, $lte: this.end_time }
      }
    ]
  };
  
  // If this is a recurring booking, we need to check for conflicts with all instances
  if (this.is_recurring && this.recurring_pattern) {
    // This is a simplified check - in a real app, you'd need to generate all instances
    // and check each one for conflicts
    query.$or.push({
      is_recurring: true,
      'recurring_pattern.end_date': { $gte: this.start_time }
    });
  }
  
  const conflictingBookings = await Booking.find(query);
  
  if (conflictingBookings.length > 0) {
    const conflict = conflictingBookings[0];
    const error = new Error(`Field is already booked from ${conflict.start_time} to ${conflict.end_time}`);
    error.name = 'ValidationError';
    error.conflicts = conflictingBookings;
    return next(error);
  }
  
  // Check item availability if there are item requirements
  if (this.item_requirements && this.item_requirements.length > 0) {
    const itemIds = this.item_requirements.map(req => req.item);
    const items = await mongoose.model('Item').find({
      _id: { $in: itemIds },
      status: 'available',
      deleted_at: null,
      $or: [
        // For non-consumables, just check status and not deleted
        { type: { $ne: 'consumable' } },
        // For consumables, also check available quantity
        { 
          type: 'consumable',
          available_quantity: { $gte: 1 } // At least 1 available
        }
      ]
    });
    
    // Create a map of available items for quick lookup
    const availableItems = new Map(items.map(item => [item._id.toString(), item]));
    
    // Check if all required items are available
    for (const req of this.item_requirements) {
      const item = availableItems.get(req.item.toString());
      if (!item) {
        // Try to get more details about why the item isn't available
        const itemDetails = await mongoose.model('Item').findById(req.item).lean();
        if (!itemDetails) {
          const error = new Error(`Item ${req.item} not found`);
          error.name = 'ValidationError';
          return next(error);
        }
        
        if (itemDetails.deleted_at) {
          const error = new Error(`Item ${itemDetails.name} has been deleted`);
          error.name = 'ValidationError';
          return next(error);
        }
        
        if (itemDetails.status !== 'available') {
          const error = new Error(`Item ${itemDetails.name} is ${itemDetails.status.replace('_', ' ')}`);
          error.name = 'ValidationError';
          return next(error);
        }
        
        if (itemDetails.type === 'consumable' && itemDetails.available_quantity < (req.quantity_needed || 1)) {
          const error = new Error(`Insufficient quantity for item ${itemDetails.name}. Available: ${itemDetails.available_quantity}, Required: ${req.quantity_needed || 1}`);
          error.name = 'ValidationError';
          return next(error);
        }
        
        const error = new Error(`Item ${itemDetails.name} is not available`);
        error.name = 'ValidationError';
        return next(error);
      }
      
      // For consumables, check quantity
      if (item.type === 'consumable' && item.available_quantity < (req.quantity_needed || 1)) {
        const error = new Error(`Insufficient quantity for item ${item.name}. Available: ${item.available_quantity}, Required: ${req.quantity_needed || 1}`);
        error.name = 'ValidationError';
        return next(error);
      }
      
      // For non-consumables, check availability during the requested time
      if (item.quantity === undefined) {
        const conflictingItemBookings = await Booking.find({
          '_id': { $ne: this._id },
          'item_requirements.item': req.item,
          'status': { $in: ['pending', 'approved'] },
          'is_deleted': { $ne: true },
          $or: [
            { start_time: { $lt: this.end_time }, end_time: { $gt: this.start_time } },
            { start_time: { $gte: this.start_time, $lte: this.end_time } }
          ]
        });
        
        if (conflictingItemBookings.length > 0) {
          const error = new Error(`Item ${item.name} is already booked for the requested time`);
          error.name = 'ValidationError';
          error.conflicts = conflictingItemBookings;
          return next(error);
        }
      }
    }
  }
  
  next();
});

// Post-save middleware to update item quantities
bookingSchema.post('save', async function(doc, next) {
  try {
    // Only process if this is a new booking with item requirements
    if (doc.isNew && doc.item_requirements && doc.item_requirements.length > 0) {
      const Item = mongoose.model('Item');
      const bulkOps = [];
      
      for (const req of doc.item_requirements) {
        // For consumables, update the available quantity
        bulkOps.push({
          updateOne: {
            filter: { 
              _id: req.item,
              quantity: { $exists: true },
              available_quantity: { $gte: req.quantity_needed }
            },
            update: { 
              $inc: { available_quantity: -req.quantity_needed },
              $push: { 
                booking_history: {
                  booking: doc._id,
                  quantity: -req.quantity_needed,
                  date: new Date(),
                  type: 'reservation',
                  status: doc.status
                }
              }
            }
          }
        });
      }
      
      if (bulkOps.length > 0) {
        await Item.bulkWrite(bulkOps);
      }
    }
    next();
  } catch (error) {
    console.error('Error updating item quantities:', error);
    // Don't throw error here to prevent infinite loop, but log it
    next();
  }
});

// Pre-remove middleware to restore item quantities if booking is deleted
bookingSchema.pre('remove', async function(next) {
  try {
    if (this.item_requirements && this.item_requirements.length > 0) {
      const Item = mongoose.model('Item');
      const bulkOps = [];
      
      for (const req of this.item_requirements) {
        // Only restore if this is a consumable and was allocated
        if (req.quantity_allocated && req.quantity_allocated > 0) {
          bulkOps.push({
            updateOne: {
              filter: { _id: req.item, quantity: { $exists: true } },
              update: { 
                $inc: { available_quantity: req.quantity_allocated },
                $push: { 
                  booking_history: {
                    booking: this._id,
                    quantity: req.quantity_allocated,
                    date: new Date(),
                    type: 'return',
                    status: 'completed'
                  }
                }
              }
            }
          });
        }
      }
      
      if (bulkOps.length > 0) {
        await Item.bulkWrite(bulkOps);
      }
    }
    next();
  } catch (error) {
    console.error('Error restoring item quantities:', error);
    next(error);
  }
});

// Add static methods
bookingSchema.statics.findByFieldAndTime = async function(fieldId, startTime, endTime, excludeId = null) {
  const query = {
    field: fieldId,
    status: { $in: ['pending', 'approved'] },
    is_deleted: { $ne: true },
    $or: [
      { start_time: { $lt: endTime }, end_time: { $gt: startTime } },
      { start_time: { $gte: startTime, $lte: endTime } }
    ]
  };
  
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  
  return this.find(query);
};

// Add instance methods
bookingSchema.methods.checkItemAvailability = async function() {
  if (!this.item_requirements || this.item_requirements.length === 0) {
    return [];
  }
  
  const Item = mongoose.model('Item');
  const itemIds = this.item_requirements.map(req => req.item);
  const items = await Item.find({
    _id: { $in: itemIds },
    is_available: true
  });
  
  const unavailableItems = [];
  
  for (const req of this.item_requirements) {
    const item = items.find(i => i._id.equals(req.item));
    if (!item) {
      unavailableItems.push({
        item: req.item,
        reason: 'Item not found or not available'
      });
      continue;
    }
    
    // For consumables, check quantity
    if (item.quantity !== undefined && item.available_quantity < req.quantity_needed) {
      unavailableItems.push({
        item: req.item,
        reason: `Insufficient quantity. Available: ${item.available_quantity}, Required: ${req.quantity_needed}`
      });
      continue;
    }
    
    // For non-consumables, check availability during the requested time
    if (item.quantity === undefined) {
      const conflictingBookings = await this.constructor.find({
        '_id': { $ne: this._id },
        'item_requirements.item': req.item,
        'status': { $in: ['pending', 'approved'] },
        'is_deleted': { $ne: true },
        $or: [
          { start_time: { $lt: this.end_time }, end_time: { $gt: this.start_time } },
          { start_time: { $gte: this.start_time, $lte: this.end_time } }
        ]
      });
      
      if (conflictingBookings.length > 0) {
        unavailableItems.push({
          item: req.item,
          reason: `Item is already booked by ${conflictingBookings.length} other bookings`,
          conflicts: conflictingBookings.map(b => ({
            booking_id: b._id,
            start_time: b.start_time,
            end_time: b.end_time,
            user: b.user
          }))
        });
      }
    }
  }
  
  return unavailableItems;
};

// Add toJSON transform to include virtuals
if (!bookingSchema.options.toJSON) bookingSchema.options.toJSON = {};
bookingSchema.options.toJSON.transform = function(doc, ret, options) {
  // Remove sensitive/internal fields
  delete ret.__v;
  delete ret.is_deleted;
  delete ret.deleted_at;
  delete ret.deleted_by;
  delete ret.internal_notes;
  
  // Include virtuals
  if (doc.duration_minutes) ret.duration_minutes = doc.duration_minutes;
  if (doc.duration_hours) ret.duration_hours = doc.duration_hours;
  if (doc.total_setup_time) ret.total_setup_time = doc.total_setup_time;
  if (doc.actual_duration_minutes) ret.actual_duration_minutes = doc.actual_duration_minutes;
  if (doc.is_past !== undefined) ret.is_past = doc.is_past;
  if (doc.is_ongoing !== undefined) ret.is_ongoing = doc.is_ongoing;
  if (doc.is_upcoming !== undefined) ret.is_upcoming = doc.is_upcoming;
  
  return ret;
};

const Booking = mongoose.model('Booking', bookingSchema);
module.exports = Booking;