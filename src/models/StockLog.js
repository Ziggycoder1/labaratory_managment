const mongoose = require('mongoose');
const { Schema } = mongoose;

const stockLogSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  change_quantity: { type: Number, required: true },
  reason: { type: String, required: true }
}, { timestamps: true });

// Index for efficient querying
stockLogSchema.index({ item: 1, created_at: -1 });
stockLogSchema.index({ user: 1, created_at: -1 });

const StockLog = mongoose.model('StockLog', stockLogSchema);
module.exports = StockLog; 