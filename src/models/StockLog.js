const mongoose = require('mongoose');
const { Schema } = mongoose;

const stockLogSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lab: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
  change_quantity: { type: Number, required: true },
  reason: { type: String, required: true },
  notes: { type: String },
  type: { 
    type: String, 
    enum: ['add', 'remove', 'transfer_in', 'transfer_out', 'adjustment'],
    default: 'adjustment'
  },
  reference_id: { type: Schema.Types.ObjectId },
  created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updated_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  metadata: { type: Map, of: String }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Pre-validate hook to ensure required fields are set before validation
stockLogSchema.pre('validate', function(next) {
  // If this is a new document and created_by is not set, set it to user
  if (this.isNew && !this.created_by && this.user) {
    this.created_by = this.user;
  }
  
  // Always set updated_by to user if available
  if (this.user) {
    this.updated_by = this.user;
  }
  
  next();
});

// Index for efficient querying
stockLogSchema.index({ item: 1, created_at: -1 });
stockLogSchema.index({ user: 1, created_at: -1 });

const StockLog = mongoose.model('StockLog', stockLogSchema);
module.exports = StockLog;