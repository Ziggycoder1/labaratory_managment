const mongoose = require('mongoose');

const blackoutPeriodSchema = new mongoose.Schema({
  lab: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lab',
    required: true
  },
  field: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Field',
    required: false // If null, applies to all fields in the lab
  },
  start_time: {
    type: Date,
    required: true
  },
  end_time: {
    type: Date,
    required: true,
    validate: {
      validator: function(value) {
        return value > this.start_time;
      },
      message: 'End time must be after start time'
    }
  },
  reason: {
    type: String,
    required: true
  },
  created_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Index for faster queries
blackoutPeriodSchema.index({ lab: 1, field: 1, start_time: 1, end_time: 1 });

// Prevent overlapping blackout periods for the same lab and field
blackoutPeriodSchema.index(
  { 
    lab: 1, 
    field: 1, 
    start_time: 1, 
    end_time: 1 
  },
  { 
    unique: true,
    partialFilterExpression: {
      $or: [
        { start_time: { $exists: true } },
        { end_time: { $exists: true } }
      ]
    }
  }
);

// Pre-save hook to ensure no overlapping blackout periods
blackoutPeriodSchema.pre('save', async function(next) {
  const BlackoutPeriod = this.constructor;
  const query = {
    lab: this.lab,
    $or: [
      {
        start_time: { $lt: this.end_time },
        end_time: { $gt: this.start_time }
      }
    ]
  };

  // If field is specified, check for overlaps with same field or global blackouts
  if (this.field) {
    query.$or[0].$or = [
      { field: this.field },
      { field: { $exists: false } }
    ];
  }

  // Exclude current document when updating
  if (!this.isNew) {
    query._id = { $ne: this._id };
  }

  const existing = await BlackoutPeriod.findOne(query);
  if (existing) {
    const err = new Error('Overlapping blackout period exists');
    err.name = 'ValidationError';
    return next(err);
  }
  next();
});

module.exports = mongoose.model('BlackoutPeriod', blackoutPeriodSchema);
