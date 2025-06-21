const mongoose = require('mongoose');
const { Schema } = mongoose;

const fieldSchema = new Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, trim: true },
  description: { type: String },
  // Add more fields as needed
}, { timestamps: true });

// Virtual to populate labs that reference this field
fieldSchema.virtual('labs', {
  ref: 'Lab',
  localField: '_id',
  foreignField: 'fields',
});

const Field = mongoose.model('Field', fieldSchema);
module.exports = Field; 