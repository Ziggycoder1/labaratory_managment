// src/middleware/error.middleware.js

function errorHandler(err, req, res, next) {
  // Set default status code
  const statusCode = err.statusCode || 500;
  // Build error response
  const errorResponse = {
    success: false,
    status: statusCode,
    message: err.message || 'Internal Server Error',
  };
  // Include error details in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = err.stack;
    if (err.errors) errorResponse.errors = err.errors;
  }
  // For validation errors (e.g., from Mongoose)
  if (err.name === 'ValidationError') {
    errorResponse.message = 'Validation Error';
    errorResponse.errors = {};
    for (let field in err.errors) {
      errorResponse.errors[field] = err.errors[field].message;
    }
  }
  res.status(statusCode).json(errorResponse);
}

module.exports = { errorHandler }; 