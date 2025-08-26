const mongoose = require('mongoose');
const { Schema } = mongoose;

const systemLogSchema = new Schema({
  level: { type: String, enum: ['info', 'warning', 'error'], required: true },
  message: { type: String, required: true },
  context: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SystemLog', systemLogSchema); 