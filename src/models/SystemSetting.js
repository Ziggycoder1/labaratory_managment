const mongoose = require('mongoose');
const { Schema } = mongoose;

const systemSettingSchema = new Schema({
  general: {
    system_name: { type: String, default: 'UR Laboratory Information System' },
    institution_name: { type: String, default: 'University of Rwanda' },
    timezone: { type: String, default: 'Africa/Kigali' },
    date_format: { type: String, default: 'YYYY-MM-DD' },
    time_format: { type: String, default: '24h' }
  },
  booking: {
    advance_booking_days: { type: Number, default: 30 },
    max_booking_duration: { type: Number, default: 8 },
    require_approval: { type: Boolean, default: true },
    auto_approve_teachers: { type: Boolean, default: true },
    booking_reminder_hours: { type: Number, default: 24 }
  },
  stock: {
    low_stock_threshold: { type: Number, default: 20 },
    auto_reorder: { type: Boolean, default: false },
    maintenance_reminder_days: { type: Number, default: 7 },
    borrowing_period_days: { type: Number, default: 7 }
  },
  notifications: {
    email_enabled: { type: Boolean, default: true },
    sms_enabled: { type: Boolean, default: false },
    push_enabled: { type: Boolean, default: true }
  }
}, { timestamps: true });

module.exports = mongoose.model('SystemSetting', systemSettingSchema); 