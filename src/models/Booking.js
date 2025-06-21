const mongoose = require('mongoose');
const { Schema } = mongoose;

const itemRequirementSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity_needed: { type: Number, required: true, min: 1 },
  notes: { type: String }
}, { _id: false });

const allocatedConsumableSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  quantity: { type: Number, required: true, min: 1 },
  allocated_at: { type: Date, default: Date.now }
}, { _id: false });

const bookingSchema = new Schema({
  lab: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
  field: { type: Schema.Types.ObjectId, ref: 'Field', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  start_time: { type: Date, required: true },
  end_time: { type: Date, required: true },
  purpose: { type: String, required: true },
  booking_type: { 
    type: String, 
    enum: ['research', 'teaching', 'practical', 'maintenance', 'other'], 
    default: 'other' 
  },
  participants_count: { type: Number, min: 1, default: 1 },
  equipment_needed: { type: String },
  item_requirements: [itemRequirementSchema],
  allocated_consumables: [allocatedConsumableSchema],
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'cancelled', 'completed'], 
    default: 'pending' 
  },
  approved_by: { type: Schema.Types.ObjectId, ref: 'User' },
  approved_at: { type: Date },
  rejection_reason: { type: String },
  special_instructions: { type: String },
  setup_time_needed: { type: Number, default: 0 }, // minutes before start_time
  cleanup_time_needed: { type: Number, default: 0 }, // minutes after end_time
  is_recurring: { type: Boolean, default: false },
  recurring_pattern: {
    frequency: { type: String, enum: ['daily', 'weekly', 'monthly'] },
    end_date: { type: Date },
    days_of_week: [{ type: Number, min: 0, max: 6 }] // 0=Sunday, 6=Saturday
  }
}, { timestamps: true });

// Index for efficient querying
bookingSchema.index({ lab: 1, start_time: 1, end_time: 1 });
bookingSchema.index({ user: 1, created_at: -1 });
bookingSchema.index({ status: 1, start_time: 1 });
bookingSchema.index({ field: 1, start_time: 1 });

// Virtual for duration in hours
bookingSchema.virtual('duration_hours').get(function() {
  return (this.end_time - this.start_time) / (1000 * 60 * 60);
});

// Virtual for total setup and cleanup time
bookingSchema.virtual('total_setup_time').get(function() {
  return this.setup_time_needed + this.cleanup_time_needed;
});

// Pre-save middleware to validate time conflicts
bookingSchema.pre('save', async function(next) {
  if (this.isNew || this.isModified('start_time') || this.isModified('end_time') || this.isModified('lab')) {
    const Booking = this.constructor;
    const conflictingBooking = await Booking.findOne({
      lab: this.lab,
      _id: { $ne: this._id },
      status: { $in: ['pending', 'approved'] },
      $or: [
        {
          start_time: { $lt: this.end_time },
          end_time: { $gt: this.start_time }
        }
      ]
    });

    if (conflictingBooking) {
      const error = new Error('Lab is already booked for this time period');
      error.name = 'ValidationError';
      return next(error);
    }
  }
  next();
});

const Booking = mongoose.model('Booking', bookingSchema);
module.exports = Booking; 