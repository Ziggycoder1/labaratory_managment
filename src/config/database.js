const mongoose = require('mongoose');

const DB_URI = process.env.DB_URI1 || 'mongodb://localhost:27017/lab_managment';

mongoose.connect(DB_URI);

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

const borrowLogSchema = new mongoose.Schema({
  item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lab: { type: mongoose.Schema.Types.ObjectId, ref: 'Lab', required: true },
  borrow_date: { type: Date, default: Date.now },
  return_date: { type: Date },
  status: { type: String, enum: ['borrowed', 'returned'], default: 'borrowed' },
  notes: { type: String }
}, { timestamps: true });

module.exports = db; 