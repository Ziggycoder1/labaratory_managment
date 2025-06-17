const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  }
}, {
  timestamps: true
});

// Virtual for labs count
departmentSchema.virtual('labs_count', {
  ref: 'Lab',
  localField: '_id',
  foreignField: 'department',
  count: true
});

// Virtual for users count
departmentSchema.virtual('users_count', {
  ref: 'User',
  localField: '_id',
  foreignField: 'department',
  count: true
});

// Ensure virtuals are included in JSON output
departmentSchema.set('toJSON', { virtuals: true });
departmentSchema.set('toObject', { virtuals: true });

const Department = mongoose.model('Department', departmentSchema);

module.exports = Department; 