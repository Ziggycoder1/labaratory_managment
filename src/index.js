const dotenv = require("dotenv");
const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

// Load environment variables from .env file in the current directory
const envPath = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

// Log environment variables for debugging (remove in production)
console.log('Environment variables loaded:', {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET ? '***' : 'Not set',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ? '***' : 'Not set',
  DB_URI: process.env.DB_URI ? '***' : 'Not set'
});

if (result.error) {
  console.error('Error loading .env file:', result.error);
  process.exit(1);
}

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
const bookingRoutes = require('./routes/bookingRoutes');
const borrowLogRoutes = require('./routes/borrowLogRoutes');
const stockLogRoutes = require('./routes/stockLogRoutes');
const stockRoutes = require('./routes/stockRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const fileRoutes = require('./routes/fileRoutes');
const systemRoutes = require('./routes/systemRoutes');
const permissionRoutes = require('./routes/permissionRoutes');
const roleRoutes = require('./routes/roleRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/labs', labRoutes);
app.use('/api/fields', fieldRoutes);
app.use('/api/lab-fields', labFieldRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/borrow-logs', borrowLogRoutes);
app.use('/api/stock-logs', stockLogRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/api/files/reports', express.static(path.join(__dirname, '../reports')));

// Error handling middleware
const { errorHandler } = require('./middleware/error.middleware');
app.use(errorHandler);

// Start scheduled jobs
if (process.env.NODE_ENV !== 'test') {
  const stockChecks = require('./jobs/stockChecks');
  stockChecks.start();
}

// Connect to MongoDB and start server only if successful
const db = require('./config/database');
const PORT = process.env.PORT || 3000;

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