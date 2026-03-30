/**
 * Enhanced Structured Logging Middleware
 * Provides comprehensive request/response/security/error logging
 * Integrates with logger.js service
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../services/logger');

/**
 * Request ID middleware - adds unique ID to each request
 * Enables request tracing across logs
 */
function requestIdMiddleware(req, res, next) {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  
  // Store start time for duration calculation
  req.startTime = Date.now();
  
  return next();
}

/**
 * Request logging middleware
 * Logs HTTP requests with method, path, status, duration
 * Filtered to avoid noise (only logs slow requests or errors)
 */
function requestLogger(req, res, next) {
  // Capture response finish event
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    const shouldLog = duration > 100 || res.statusCode >= 400;
    
    if (!shouldLog) return next();

    logger.info('HTTP Request', {
      action: 'http_request',
      requestId: req.id,
      method: req.method,
      path: req.path,
      query: req.query,
      status: res.statusCode,
      contentLength: res.getHeader('content-length') || 0,
      duration: `${duration}ms`,
      userId: req.session?.userId || null,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      timestamp: new Date().toISOString()
    });
  });

  return next();
}

/**
 * Security event logging middleware
 * Logs authentication, authorization, CSRF, file upload events
 */
function securityEventLogger(req, res, next) {
  res.on('finish', () => {
    // Log authentication events
    if (req.path.includes('/auth/login') || req.path.includes('/auth/signup')) {
      logger.info('Security Event', {
        action: 'auth_attempt',
        requestId: req.id,
        path: req.path,
        status: res.statusCode,
        ip: req.ip,
        success: res.statusCode === 200,
        timestamp: new Date().toISOString()
      });
    }

    // Log authorization failures (403)
    if (res.statusCode === 403) {
      logger.warn('Security Event', {
        action: 'auth_forbidden',
        requestId: req.id,
        path: req.path,
        userId: req.session?.userId || 'unknown',
        ip: req.ip,
        reason: res.message || 'Forbidden',
        timestamp: new Date().toISOString()
      });
    }

    // Log CSRF failures
    if (req.path.match(/POST|PUT|DELETE/) && res.statusCode === 403 && req.path.includes('/api')) {
      logger.warn('Security Event', {
        action: 'csrf_failure',
        requestId: req.id,
        path: req.path,
        userId: req.session?.userId || 'unknown',
        ip: req.ip,
        timestamp: new Date().toISOString()
      });
    }

    // Log admin actions
    if (req.path.includes('/api/admin') && req.method !== 'GET') {
      logger.info('Security Event', {
        action: 'admin_action',
        requestId: req.id,
        path: req.path,
        method: req.method,
        userId: req.session?.userId || 'unknown',
        status: res.statusCode,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });
    }

    // Log file uploads
    if (req.path.includes('/upload') || req.path.includes('/upload')) {
      logger.info('Security Event', {
        action: 'file_upload',
        requestId: req.id,
        path: req.path,
        userId: req.session?.userId || 'unknown',
        status: res.statusCode,
        ip: req.ip,
        timestamp: new Date().toISOString()
      });
    }
  });

  return next();
}

/**
 * Error logging middleware
 * Wraps error handler to log ALL errors with full context
 */
function errorLogger(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const logLevel = statusCode >= 500 ? 'error' : 'warn';

  logger.log(logLevel, 'Error Occurred', {
    action: 'error_caught',
    requestId: req.id,
    errorType: err.name,
    errorCode: err.code,
    message: err.message,
    path: req.path,
    method: req.method,
    status: statusCode,
    userId: req.session?.userId || 'unknown',
    ip: req.ip,
    userAgent: req.get('user-agent'),
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    timestamp: new Date().toISOString()
  });

  return next(err);
}

/**
 * Performance monitoring middleware
 * Tracks slow endpoints and database queries
 */
function performanceMonitor(req, res, next) {
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    
    // Alert if endpoint is slow (>500ms)
    if (duration > 500) {
      logger.warn('Performance Alert', {
        action: 'slow_endpoint',
        requestId: req.id,
        path: req.path,
        duration: `${duration}ms`,
        threshold: '500ms',
        status: res.statusCode,
        timestamp: new Date().toISOString()
      });
    }
  });

  return next();
}

/**
 * 404 Not Found handler
 * Should be registered AFTER all routes
 */
function notFoundHandler(req, res) {
  logger.warn('Not Found', {
    action: 'not_found',
    requestId: req.id,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    timestamp: new Date().toISOString()
  });

  return res.status(404).json({
    success: false,
    error: 'Not found',
    code: 'NOT_FOUND',
    status: 404,
    requestId: req.id,
    timestamp: new Date().toISOString()
  });
}

/**
 * Centralized error handler middleware
 * Must be LAST in middleware stack
 * Handles all errors and prevents raw errors from being exposed
 */
function globalErrorHandler(err, req, res, next) {
  // Default values
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || 'INTERNAL_ERROR';
  let details = err.details || {};

  // Parse specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    code = 'UNAUTHORIZED';
  } else if (err.name === 'ForbiddenError') {
    statusCode = 403;
    code = 'FORBIDDEN';
  } else if (err.name === 'NotFoundError') {
    statusCode = 404;
    code = 'NOT_FOUND';
  } else if (err.name === 'ConflictError') {
    statusCode = 409;
    code = 'CONFLICT';
  } else if (err.name === 'RateLimitError') {
    statusCode = 429;
    code = 'RATE_LIMITED';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid or malformed token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token has expired';
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    code = 'UPLOAD_ERROR';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File exceeds maximum size limit';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files uploaded';
    }
  } else if (err.code === '23505') {
    // PostgreSQL unique constraint violation
    statusCode = 409;
    code = 'DUPLICATE_ENTRY';
    message = 'This resource already exists';
  } else if (err.code === '23503') {
    // PostgreSQL foreign key violation
    statusCode = 400;
    code = 'INVALID_REFERENCE';
    message = 'Referenced resource does not exist';
  } else if (err.code === '23502') {
    // PostgreSQL not-null violation
    statusCode = 400;
    code = 'MISSING_REQUIRED_FIELD';
    const match = err.message.match(/null value in column "(\w+)"/);
    message = match ? `Missing required field: ${match[1]}` : 'Missing required field';
  } else if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
    // Don't expose internal errors in production
    message = 'An unexpected error occurred. Please try again later.';
  }

  // Build safe response (never expose stack traces in production)
  const response = {
    success: false,
    error: message,
    code,
    status: statusCode,
    requestId: req.id || 'unknown',
    timestamp: new Date().toISOString()
  };

  // Add validation details if present
  if (details && Object.keys(details).length > 0) {
    response.details = details;
  }

  // Add stack trace ONLY in development
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack.split('\n').slice(0, 10);
  }

  // Add Retry-After header for rate limits
  if (statusCode === 429 && err.retryAfter) {
    res.set('Retry-After', err.retryAfter.toString());
  }

  // Never send headers if already sent (streaming response)
  if (res.headersSent) {
    return;
  }

  return res.status(statusCode).json(response);
}

module.exports = {
  requestIdMiddleware,
  requestLogger,
  securityEventLogger,
  errorLogger,
  performanceMonitor,
  notFoundHandler,
  globalErrorHandler
};
