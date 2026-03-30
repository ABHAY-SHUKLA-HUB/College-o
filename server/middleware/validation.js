/**
 * Input Validation Middleware
 * Provides common validation schemas and middleware for API requests
 * Uses existing 'validator' package + custom validators
 */

const validators = require('validator');
const { ValidationError } = require('./errorHandler');

/**
 * Sanitizes string inputs to prevent XSS
 */
function sanitizeString(value, maxLength = 1000) {
  if (typeof value !== 'string') return '';
  let cleaned = String(value).trim().slice(0, maxLength);
  
  // Remove dangerous characters but preserve basic formatting
  cleaned = cleaned
    .replace(/<script[^>]*>.*?<\/script>/gi, '')  // Remove script tags
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')  // Remove iframes
    .replace(/on\w+\s*=/gi, '');                  // Remove event handlers
  
  return cleaned;
}

/**
 * Email validation with domain check
 */
function validateEmail(email) {
  if (!email || !validators.isEmail(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  if (email.length > 254) {
    return { valid: false, error: 'Email too long (max 254 characters)' };
  }
  return { valid: true };
}

/**
 * Password validation - checks strength requirements
 */
function validatePassword(password) {
  if (!password) {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 6) {
    return { valid: false, error: 'Password must be at least 6 characters' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password too long (max 128 characters)' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain uppercase letter' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain lowercase letter' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, error: 'Password must contain number' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain special character' };
  }
  return { valid: true };
}

/**
 * Text field validation with XSS protection
 */
function validateTextField(value, options = {}) {
  const {
    maxLength = 5000,
    minLength = 0,
    fieldName = 'Field',
    allowHtml = false
  } = options;

  if (typeof value !== 'string') {
    return { valid: false, error: `${fieldName} must be text` };
  }

  value = value.trim();

  if (value.length < minLength) {
    return { valid: false, error: `${fieldName} must be at least ${minLength} characters` };
  }

  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} must be at most ${maxLength} characters` };
  }

  if (!allowHtml) {
    value = sanitizeString(value, maxLength);
  }

  return { valid: true, data: value };
}

/**
 * URL validation
 */
function validateUrl(url, options = {}) {
  if (!url || !validators.isURL(url, options)) {
    return { valid: false, error: 'Invalid URL format' };
  }
  return { valid: true };
}

/**
 * Positive integer validation
 */
function validatePositiveInt(value, fieldName = 'Value') {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    return { valid: false, error: `${fieldName} must be positive integer` };
  }
  return { valid: true, data: num };
}

/**
 * UUID validation
 */
function validateUUID(value) {
  if (!validators.isUUID(value)) {
    return { valid: false, error: 'Invalid ID format' };
  }
  return { valid: true };
}

/**
 * Middleware factory for validating request body against schema
 * @param {Object} schema - Object mapping field names to validation functions
 */
function validateRequestBody(schema = {}) {
  return async (req, res, next) => {
    const errors = {};
    const validated = {};

    for (const [field, validator] of Object.entries(schema)) {
      const value = req.body[field];
      const result = validator(value);

      if (!result.valid) {
        errors[field] = result.error;
      } else {
        validated[field] = result.data !== undefined ? result.data : value;
      }
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors
      });
    }

    req.validated = validated;
    return next();
  };
}

/**
 * Middleware to prevent JSON bomb attacks (nested object limits)
 */
function preventJsonBomb(maxDepth = 10) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    function checkDepth(obj, depth = 0) {
      if (depth > maxDepth) {
        return false;
      }

      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (typeof item === 'object' && item !== null) {
            if (!checkDepth(item, depth + 1)) return false;
          }
        }
      } else if (typeof obj === 'object') {
        for (const value of Object.values(obj)) {
          if (typeof value === 'object' && value !== null) {
            if (!checkDepth(value, depth + 1)) return false;
          }
        }
      }

      return true;
    }

    if (!checkDepth(req.body)) {
      return res.status(400).json({
        error: 'Request body too deeply nested',
        code: 'VALIDATION_ERROR'
      });
    }

    return next();
  };
}

/**
 * Middleware to sanitize string fields in request body
 */
function sanitizeRequestBody(fieldsToSanitize = []) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') {
      return next();
    }

    function sanitizeObject(obj) {
      for (const [key, value] of Object.entries(obj)) {
        if (fieldsToSanitize.includes(key) && typeof value === 'string') {
          obj[key] = sanitizeString(value);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          sanitizeObject(value);
        }
      }
    }

    sanitizeObject(req.body);
    return next();
  };
}

/**
 * Middleware to limit request size (complementary to express.json limit)
 */
function limitRequestSize(maxMb = 2) {
  const maxBytes = maxMb * 1024 * 1024;

  return (req, res, next) => {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.startsWith('multipart/form-data')) {
      // File uploads are validated by route-specific multer limits.
      return next();
    }

    const contentLength = parseInt(req.headers['content-length'] || 0);
    if (contentLength > maxBytes) {
      return res.status(413).json({
        error: `Request too large (max ${maxMb}MB)`,
        code: 'PAYLOAD_TOO_LARGE'
      });
    }
    return next();
  };
}

module.exports = {
  // Validation functions
  sanitizeString,
  validateEmail,
  validatePassword,
  validateTextField,
  validateUrl,
  validatePositiveInt,
  validateUUID,

  // Middleware factories
  validateRequestBody,
  preventJsonBomb,
  sanitizeRequestBody,
  limitRequestSize,

  // Error class (for use in route handlers)
  ValidationError
};
