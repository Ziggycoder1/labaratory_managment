const mongoose = require('mongoose');
const { Schema } = mongoose;

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
  action_url: { type: String }
});

module.exports = mongoose.model('Notification', notificationSchema); 