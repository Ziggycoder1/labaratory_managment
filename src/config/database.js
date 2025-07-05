const mongoose = require('mongoose');

const DB_URI = process.env.DB_URI1 || 'mongodb://localhost:27017/lab_managment';

// Connect to MongoDB
mongoose.connect(DB_URI, {
  serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
  socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
  family: 4 // Use IPv4, skip trying IPv6
});

const db = mongoose.connection;

db.on('error', (error) => {
  console.error('MongoDB connection error:', error);
  process.exit(1);
});

db.once('open', () => {
  console.log('Connected to MongoDB');
});

module.exports = db; 