const mongoose = require('mongoose');
const { Schema } = mongoose;

const labSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, trim: true },
  department: { type: Schema.Types.ObjectId, ref: 'Department', required: true },
  status: { type: String, default: 'active' },
  is_active: { type: Boolean, default: true },
  capacity: { type: Number },
  location: { type: String },
  description: { type: String },
  fields: [{ type: Schema.Types.ObjectId, ref: 'Field' }],
  // Add more fields as needed based on controller usage
}, { timestamps: true });

const Lab = mongoose.model('Lab', labSchema);
module.exports = Lab; 