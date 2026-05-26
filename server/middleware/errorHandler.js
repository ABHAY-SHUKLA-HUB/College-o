/**
 * Global Error Handler Middleware
 * Catches all errors and returns standardized responses
 * Must be the LAST middleware registered in Express app
 */

const logger = require('../services/logger');

/**
 * Custom error classes for type-safe error handling
 */
class AppError extends Error {
  constructor(message, statusCode, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(retryAfter = 60) {
    super('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
    this.retryAfter = retryAfter;
  }
}

class DatabaseError extends AppError {
  constructor(message = 'Database error', originalError = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.originalError = originalError;
  }
}

/**
 * Async route wrapper - prevents unhandled promise rejections
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Main error handler middleware
 * Must be registered AFTER all other middleware and routes
 */
const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Default to 500 if no status code
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || 'INTERNAL_ERROR';
  let details = err.details || {};

  // Log error with context
  const logLevel = statusCode >= 500 ? 'error' : 'warn';
  logger[logLevel]({
    action: 'error_caught',
    error: {
      statusCode,
      code,
      message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    },
    request: {
      method: req.method,
      path: req.path,
      userId: req.user?.id,
      ip: req.ip,
      origin: req.headers.origin,
      userAgent: req.headers['user-agent'],
      rateLimit: err.rateLimitContext || null
    }
  });

  // Special handling for different error types
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid or malformed token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token has expired';
  } else if (err.code === '23505') {
    // PostgreSQL unique constraint violation
    statusCode = 409;
    code = 'DUPLICATE_ENTRY';
    message = 'Resource already exists';
  } else if (err.code === '23503') {
    // PostgreSQL foreign key violation
    statusCode = 400;
    code = 'INVALID_REFERENCE';
    message = 'Referenced resource does not exist';
  } else if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
    // Don't expose internal errors in production
    message = 'An unexpected error occurred. Please try again later.';
  }

  // Determine if we should include detailed info
  const isProduction = process.env.NODE_ENV === 'production';
  const shouldExposeDetails = !isProduction || err.exposeInProduction;

  // Build response
  const response = {
    success: false,
    error: message,
    code,
    status: statusCode,
    timestamp: new Date().toISOString(),
    requestId: req.id || 'unknown'
  };

  // Add details if validation error
  if (details && Object.keys(details).length > 0) {
    response.details = details;
  }

  // Add stack trace in development
  if (!isProduction && err.stack) {
    response.stack = err.stack.split('\n');
  }

  // Add retry-after header for rate limit errors
  if (statusCode === 429 && err.retryAfter) {
    res.set('Retry-After', err.retryAfter.toString());
  }

  if (statusCode === 429) {
    response.ok = false;
    response.message = message;
    response.retryAfter = err.retryAfter || null;
    response.code = 'RATE_LIMITED';
  }

  res.status(statusCode).json(response);
};

/**
 * 404 Not Found middleware
 * Should be registered AFTER all routes
 */
const notFoundHandler = (req, res, next) => {
  next(new NotFoundError(`${req.method} ${req.path}`));
};

/**
 * Request ID middleware - adds unique ID to each request
 */
const requestIdMiddleware = (req, res, next) => {
  const { v4: uuidv4 } = require('uuid');
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
};

/**
 * Request logging middleware
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Only log if duration > 100ms or status >= 400
    if (duration > 100 || res.statusCode >= 400) {
      logger.info({
        action: 'http_request',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        userId: req.user?.id,
        ip: req.ip
      });
    }
  });

  next();
};

module.exports = {
  // Error classes
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,

  // Middleware
  errorHandler,
  notFoundHandler,
  requestIdMiddleware,
  requestLogger,

  // Utilities
  asyncHandler
};
