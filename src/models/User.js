const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  full_name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  phone: { 
    type: String, 
    trim: true,
    match: [/^[0-9\-\(\)\s+]+$/, 'Please enter a valid phone number']
  },
  password: { type: String, required: true },
  role: { type: String, required: true, enum: ['admin', 'department_admin', 'lab_manager', 'teacher', 'student', 'external'] },
  department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  is_active: { type: Boolean, default: true },
  reset_token: { type: String },
  reset_token_expiry: { type: Date },
  last_login: { type: Date },
  notification_settings: {
    email_notifications: { type: Boolean, default: true },
    push_notifications: { type: Boolean, default: true },
    notification_types: {
      booking_approved: { type: Boolean, default: true },
      booking_rejected: { type: Boolean, default: true },
      return_reminder: { type: Boolean, default: true },
      stock_alert: { type: Boolean, default: false },
      maintenance_reminder: { type: Boolean, default: true }
    },
    reminder_preferences: {
      return_reminder_hours: { type: Number, default: 24 },
      booking_reminder_hours: { type: Number, default: 2 }
    }
  },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const User = mongoose.model('User', userSchema);
module.exports = User; 