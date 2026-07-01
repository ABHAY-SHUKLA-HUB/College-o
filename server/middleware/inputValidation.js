const validator = require('validator');

/**
 * Input validation and sanitization middleware
 * Provides reusable validators for common fields
 */

function sanitizeString(value, maxLength = 500) {
  if (!value) return '';
  return validator.trim(String(value).substring(0, maxLength));
}

function sanitizeEmail(value) {
  if (!value) return null;
  const trimmed = validator.trim(String(value).toLowerCase());
  if (!validator.isEmail(trimmed)) return null;
  return trimmed;
}

function sanitizeInt(value, min = null, max = null) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  if (min !== null && parsed < min) return null;
  if (max !== null && parsed > max) return null;
  return parsed;
}

function sanitizePassword(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length < 6 || value.length > 256) return null;
  return value; // Passwords are not sanitized, just validated
}

function validateEmail(value) {
  return validator.isEmail(String(value || '').toLowerCase());
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') return false;
  // Minimum 6 chars; can add more complex rules later
  if (password.length < 6) return false;
  if (password.length > 256) return false;
  return true;
}

function validateName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = validator.trim(name);
  if (trimmed.length < 2) return false;
  if (trimmed.length > 100) return false;
  // Allow letters, spaces, hyphens, apostrophes
  return /^[a-zA-Z\s\-']+$/.test(trimmed);
}

function validateId(id) {
  const parsed = Number.parseInt(id, 10);
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * Middleware: Reject unexpected fields
 * Only allow specified fields in request body
 */
function rejectUnexpectedFields(allowedFields) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== 'object') return next();
    const receivedFields = Object.keys(req.body);
    const unexpected = receivedFields.filter((field) => !allowedFields.includes(field));
    if (unexpected.length > 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: `Unexpected fields: ${unexpected.join(', ')}`
      });
    }
    return next();
  };
}

/**
 * Middleware: Validate required fields
 */
function requireFields(fields) {
  return (req, res, next) => {
    const missing = fields.filter((field) => !req.body || req.body[field] === undefined || req.body[field] === null || req.body[field] === '');
    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Validation error',
        message: `Missing required fields: ${missing.join(', ')}`
      });
    }
    return next();
  };
}

/**
 * Middleware: Validate login request
 */
function validateLoginRequest(req, res, next) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ error: 'Invalid password format' });
  }
  req.validatedData = { email: sanitizeEmail(email), password };
  return next();
}

/**
 * Middleware: Validate signup request
 */
function validateSignupRequest(req, res, next) {
  const { email, password, fullName, collegeName } = req.body || {};

  const errors = [];
  if (!email || !validateEmail(email)) errors.push('Invalid email');
  if (!password || !validatePassword(password)) errors.push('Password must be 6-256 characters');
  if (!fullName || !validateName(fullName)) errors.push('Invalid name (2-100 letters)');

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation error', details: errors });
  }

  req.validatedData = {
    email: sanitizeEmail(email),
    password,
    fullName: sanitizeString(fullName, 100),
    collegeName: sanitizeString(collegeName, 200)
  };
  return next();
}

module.exports = {
  sanitizeString,
  sanitizeEmail,
  sanitizeInt,
  sanitizePassword,
  validateEmail,
  validatePassword,
  validateName,
  validateId,
  rejectUnexpectedFields,
  requireFields,
  validateLoginRequest,
  validateSignupRequest
};
