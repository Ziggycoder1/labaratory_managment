const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  full_name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, required: true, enum: ['admin', 'department_admin', 'lab_manager', 'teacher', 'student', 'external'] },
  department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  is_active: { type: Boolean, default: true },
  reset_token: { type: String },
  reset_token_expiry: { type: Date },
  last_login: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const User = mongoose.model('User', userSchema);
module.exports = User; 