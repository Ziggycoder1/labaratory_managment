const mongoose = require('mongoose');
const { Schema } = mongoose;

const roleSchema = new Schema({
  name: { type: String, required: true, unique: true },
  display_name: { type: String, required: true },
  description: { type: String, required: true },
  permissions: [{ type: Schema.Types.ObjectId, ref: 'Permission' }]
}, { timestamps: true });

module.exports = mongoose.model('Role', roleSchema); 