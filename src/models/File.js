const mongoose = require('mongoose');
const { Schema } = mongoose;

const fileSchema = new Schema({
  filename: { type: String, required: true },
  original_name: { type: String, required: true },
  file_size: { type: Number, required: true },
  mime_type: { type: String, required: true },
  file_path: { type: String, required: true },
  reference_type: { type: String },
  reference_id: { type: Schema.Types.Mixed },
  uploaded_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  uploaded_at: { type: Date, default: Date.now },
  download_count: { type: Number, default: 0 },
  is_public: { type: Boolean, default: false }
});

module.exports = mongoose.model('File', fileSchema); 