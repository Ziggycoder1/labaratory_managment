class ErrorResponse extends Error {
  constructor(message, statusCode, errors = []) {
    super(message);
    this.statusCode = statusCode || 500;
    this.errors = Array.isArray(errors) ? errors : [errors];
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      message: this.message,
      errors: this.errors,
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack })
    };
  }

  static fromError(error, statusCode = 500) {
    if (error instanceof ErrorResponse) return error;
    
    const err = new ErrorResponse(
      error.message || 'An error occurred',
      statusCode,
      error.errors || [error.message || 'An unknown error occurred']
    );
    
    if (error.stack) {
      err.stack = error.stack;
    }
    
    return err;
  }

  static handleError(res, error) {
    console.error('Error:', error);
    
    const response = {
      success: false,
      message: error.message || 'An error occurred',
      errors: error.errors || [error.message || 'An unknown error occurred']
    };
    
    if (process.env.NODE_ENV === 'development') {
      response.stack = error.stack;
    }
    
    res.status(error.statusCode || 500).json(response);
  }
}

module.exports = ErrorResponse;
