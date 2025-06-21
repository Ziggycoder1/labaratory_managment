const mongoose = require('mongoose');
const { Schema } = mongoose;

const borrowLogSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  lab: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
  borrow_date: { type: Date, default: Date.now },
  return_date: { type: Date },
  status: { 
    type: String, 
    enum: ['borrowed', 'returned'], 
    default: 'borrowed' 
  },
  notes: { type: String }
}, { timestamps: true });

// Index for efficient querying
borrowLogSchema.index({ item: 1, status: 1 });
borrowLogSchema.index({ user: 1, created_at: -1 });
borrowLogSchema.index({ lab: 1, created_at: -1 });

const BorrowLog = mongoose.model('BorrowLog', borrowLogSchema);
module.exports = BorrowLog; 