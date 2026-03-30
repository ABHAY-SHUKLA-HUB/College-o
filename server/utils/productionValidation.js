/**
 * Production Validation & Security Utilities
 * Enhanced validation for enterprise-scale platform
 */

const { ValidationError, ForbiddenError } = require('../middleware/errorHandler');
const validator = require('validator');

class ProductionValidator {
  constructor() {
    this.errors = {};
  }

  /**
   * Validate string field
   */
  validateString(field, value, options = {}) {
    const {
      minLength = 1,
      maxLength = 1000,
      required = true,
      allowHtml = false,
      pattern = null,
      errorMessage = `Invalid ${field}`
    } = options;

    if (required && !value) {
      this.errors[field] = `${field} is required`;
      return false;
    }

    if (!value) return true;

    // Trim whitespace
    value = String(value).trim();

    // Check length
    if (value.length < minLength) {
      this.errors[field] = `${field} must be at least ${minLength} characters`;
      return false;
    }

    if (value.length > maxLength) {
      this.errors[field] = `${field} must be at most ${maxLength} characters`;
      return false;
    }

    // Check pattern match
    if (pattern && !pattern.test(value)) {
      this.errors[field] = errorMessage;
      return false;
    }

    // Prevent HTML if not allowed
    if (!allowHtml && this.containsHtml(value)) {
      this.errors[field] = `${field} cannot contain HTML`;
      return false;
    }

    return true;
  }

  /**
   * Validate email
   */
  validateEmail(field, email, required = true) {
    if (required && !email) {
      this.errors[field] = `${field} is required`;
      return false;
    }

    if (!email) return true;

    email = String(email).toLowerCase().trim();

    if (!validator.isEmail(email)) {
      this.errors[field] = 'Invalid email address';
      return false;
    }

    return true;
  }

  /**
   * Validate number
   */
  validateNumber(field, value, options = {}) {
    const {
      min = Number.MIN_SAFE_INTEGER,
      max = Number.MAX_SAFE_INTEGER,
      integer = false,
      required = true
    } = options;

    if (required && (value === null || value === undefined)) {
      this.errors[field] = `${field} is required`;
      return false;
    }

    if (!value && value !== 0) return true;

    const num = Number(value);

    if (isNaN(num)) {
      this.errors[field] = `${field} must be a number`;
      return false;
    }

    if (integer && !Number.isInteger(num)) {
      this.errors[field] = `${field} must be an integer`;
      return false;
    }

    if (num < min || num > max) {
      this.errors[field] = `${field} must be between ${min} and ${max}`;
      return false;
    }

    return true;
  }

  /**
   * Validate file
   */
  validateFile(field, file, options = {}) {
    const {
      maxSize = 52428800, // 50MB
      mimeTypes = ['application/pdf', 'image/*', 'application/msword'],
      required = true
    } = options;

    if (required && !file) {
      this.errors[field] = `${field} is required`;
      return false;
    }

    if (!file) return true;

    // Check size
    if (file.size > maxSize) {
      this.errors[field] = `${field} exceeds maximum size of ${maxSize / 1024 / 1024}MB`;
      return false;
    }

    // Check MIME type
    const allowed = mimeTypes.some(type => {
      if (type.includes('*')) {
        const baseType = type.split('/')[0];
        return file.mimetype.startsWith(baseType);
      }
      return file.mimetype === type;
    });

    if (!allowed) {
      this.errors[field] = `${field} has invalid file type`;
      return false;
    }

    return true;
  }

  /**
   * Validate URL
   */
  validateUrl(field, url, required = true) {
    if (required && !url) {
      this.errors[field] = `${field} is required`;
      return false;
    }

    if (!url) return true;

    if (!validator.isURL(String(url))) {
      this.errors[field] = 'Invalid URL';
      return false;
    }

    return true;
  }

  /**
   * Validate enum (must be one of specific values)
   */
  validateEnum(field, value, allowedValues, required = true) {
    if (required && !value) {
      this.errors[field] = `${field} is required`;
      return false;
    }

    if (!value) return true;

    if (!allowedValues.includes(String(value))) {
      this.errors[field] = `${field} must be one of: ${allowedValues.join(', ')}`;
      return false;
    }

    return true;
  }

  /**
   * Validate array
   */
  validateArray(field, array, options = {}) {
    const {
      minLength = 0,
      maxLength = 100,
      required = true
    } = options;

    if (required && (!Array.isArray(array) || array.length === 0)) {
      this.errors[field] = `${field} is required`;
      return false;
    }

    if (!Array.isArray(array)) {
      this.errors[field] = `${field} must be an array`;
      return false;
    }

    if (array.length < minLength) {
      this.errors[field] = `${field} must have at least ${minLength} items`;
      return false;
    }

    if (array.length > maxLength) {
      this.errors[field] = `${field} must have at most ${maxLength} items`;
      return false;
    }

    return true;
  }

  /**
   * Sanitize string by removing HTML
   */
  sanitizeString(value) {
    if (!value) return '';
    return String(value)
      .trim()
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&[a-zA-Z0-9#]+;/g, '') // Remove HTML entities
      .substring(0, 1000); // Limit length
  }

  /**
   * Escape HTML special characters
   */
  escapeHtml(value) {
    if (!value) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * Check if string contains HTML
   */
  containsHtml(value) {
    if (!value) return false;
    return /<[^>]*>/.test(String(value));
  }

  /**
   * Get validation errors
   */
  getErrors() {
    if (Object.keys(this.errors).length === 0) {
      return null;
    }
    return this.errors;
  }

  /**
   * Throw validation error if there are errors
   */
  throwIfErrors() {
    if (Object.keys(this.errors).length > 0) {
      throw new ValidationError('Validation failed', this.errors);
    }
  }

  /**
   * Reset errors
   */
  reset() {
    this.errors = {};
  }
}

/**
 * IDOR Prevention Middleware
 * Ensures users can only access their own data
 */
const idorPrevention = (resourceOwnerField = 'userId') => {
  return (req, res, next) => {
    const resourceId = req.params.id || req.body[resourceOwnerField];
    const userId = req.user?.id;

    if (!userId) {
      throw new ForbiddenError('Not authenticated');
    }

    // Admins can access any resource
    if (req.user.role === 'admin') {
      return next();
    }

    // For routes with user ID in params
    if (req.params.userId && String(req.params.userId) !== String(userId)) {
      throw new ForbiddenError('Cannot access other user\'s data');
    }

    // Verify in database if needed (do in route handler)
    req.requireOwnershipCheck = true;
    next();
  };
};

/**
 * Request body size limit and validation
 */
const validateBodySize = (maxSizeBytes = 1000000) => {
  return (req, res, next) => {
    if (!req.body) return next();

    const bodySize = JSON.stringify(req.body).length;
    if (bodySize > maxSizeBytes) {
      throw new ValidationError(`Request body exceeds maximum size of ${maxSizeBytes} bytes`);
    }

    next();
  };
};

/**
 * Pagination validation and bounds
 */
const validatePagination = (req, res, next) => {
  let page = parseInt(req.query.page) || 1;
  let limit = parseInt(req.query.limit) || 20;

  // Bounds enforcement
  page = Math.max(1, Math.min(page, 10000));
  limit = Math.max(1, Math.min(limit, 100));

  req.pagination = {
    page,
    limit,
    offset: (page - 1) * limit
  };

  next();
};

/**
 * Search query validation
 */
const validateSearchQuery = (req, res, next) => {
  const query = String(req.query.q || '').trim();

  // Bounds
  if (query.length < 2) {
    throw new ValidationError('Search query must be at least 2 characters');
  }

  if (query.length > 200) {
    throw new ValidationError('Search query must be at most 200 characters');
  }

  // Sanitize query
  req.searchQuery = query
    .replace(/[<>]/g, '') // Remove potential SQL injection chars
    .trim();

  next();
};

module.exports = {
  ProductionValidator,
  idorPrevention,
  validateBodySize,
  validatePagination,
  validateSearchQuery
};
