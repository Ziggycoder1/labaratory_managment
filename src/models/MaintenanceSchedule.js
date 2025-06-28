const mongoose = require('mongoose');
const { Schema } = mongoose;

const maintenanceScheduleSchema = new Schema({
  item: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
  maintenance_type: { type: String, required: true },
  scheduled_date: { type: Date, required: true },
  last_maintenance: { type: Date },
  frequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'], required: true },
  status: { type: String, enum: ['scheduled', 'due', 'overdue', 'completed'], default: 'scheduled' },
  assigned_to: { type: Schema.Types.ObjectId, ref: 'User' },
  estimated_duration: { type: String },
  description: { type: String },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  completion_date: { type: Date },
  performed_by: { type: Schema.Types.ObjectId, ref: 'User' },
  notes: { type: String },
  parts_replaced: [{ type: String }],
  cost: { type: Number },
  next_maintenance_date: { type: Date },
  condition_after: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('MaintenanceSchedule', maintenanceScheduleSchema); 