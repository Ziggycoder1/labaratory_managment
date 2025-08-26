const mongoose = require('mongoose');
const { Schema } = mongoose;

const borrowLogSchema = new Schema({
  item: { 
    type: Schema.Types.ObjectId, 
    ref: 'Item', 
    required: true 
  },
  user: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  lab: { 
    type: Schema.Types.ObjectId, 
    ref: 'Lab', 
    required: true 
  },
  borrow_date: { 
    type: Date, 
    default: Date.now 
  },
  expected_return_date: { 
    type: Date, 
    required: true 
  },
  actual_return_date: { 
    type: Date 
  },
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
  rejected_reason: {
    type: String
  },
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'borrowed', 'returned', 'overdue'], 
    default: 'pending' 
  },
  fine_amount: {
    type: Number,
    default: 0
  },
  fine_paid: {
    type: Boolean,
    default: false
  },
  notes: { 
    type: String 
  },
  condition_before: {
    type: String,
    enum: ['excellent', 'good', 'fair', 'poor'],
    required: true
  },
  condition_after: {
    type: String,
    enum: ['excellent', 'good', 'fair', 'poor']
  },
  damage_notes: {
    type: String
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient querying
borrowLogSchema.index({ item: 1, status: 1 });
borrowLogSchema.index({ user: 1, created_at: -1 });
borrowLogSchema.index({ lab: 1, created_at: -1 });
borrowLogSchema.index({ status: 1, expected_return_date: 1 });
borrowLogSchema.index({ expected_return_date: 1 });

// Virtual for checking if item is overdue
borrowLogSchema.virtual('is_overdue').get(function() {
  if (this.status === 'borrowed' && this.expected_return_date < new Date()) {
    return true;
  }
  return false;
});

// Virtual for days overdue
borrowLogSchema.virtual('days_overdue').get(function() {
  if (this.status === 'borrowed' && this.expected_return_date < new Date()) {
    const diffTime = Math.abs(new Date() - this.expected_return_date);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  return 0;
});

// Pre-save hook to update status if overdue
borrowLogSchema.pre('save', function(next) {
  if (this.status === 'borrowed' && this.expected_return_date < new Date()) {
    this.status = 'overdue';
  }
  next();
});

const BorrowLog = mongoose.model('BorrowLog', borrowLogSchema);
module.exports = BorrowLog;