const dotenv = require("dotenv");
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
const departmentRoutes = require('./routes/departmentRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const labRoutes = require('./routes/labRoutes');
const fieldRoutes = require('./routes/fieldRoutes');
const labFieldRoutes = require('./routes/labFieldRoutes');
const itemRoutes = require('./routes/itemRoutes');

app.use('/api/departments', departmentRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/labs', labRoutes);
app.use('/api/fields', fieldRoutes);
app.use('/api/lab-fields', labFieldRoutes);
app.use('/api/stock', itemRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3000;

// Connect to MongoDB and start server only if successful
const db = require('./config/database');

db.once('open', () => {
  console.log('Connected to MongoDB (from index.js)');
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
db.on('error', (err) => {
  console.error('Failed to connect to MongoDB:', err);
  process.exit(1);
}); 