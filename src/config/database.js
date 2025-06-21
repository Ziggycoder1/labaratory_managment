const mongoose = require('mongoose');

const DB_URI = process.env.DB_URI || 'mongodb://localhost:27017/lab_managment';

mongoose.connect(DB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

module.exports = db; 