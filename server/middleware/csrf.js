/**
 * CSRF Protection Middleware
 * Implements Double-Submit Cookie pattern for session-based authentication
 * Generates and validates CSRF tokens
 */

const crypto = require('crypto');

const CSRF_TOKEN_COOKIE = '_csrf';
const CSRF_TOKEN_HEADER = 'x-csrf-token';

/**
 * Generate a secure CSRF token
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate CSRF token
 */
function validateToken(token, secret) {
  if (!token || !secret) {
    return false;
  }
  // Simple constant-time comparison
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

/**
 * Middleware to initialize CSRF token on session
 * Should be applied AFTER session middleware
 */
function csrfInit() {
  return (req, res, next) => {
    const normalizedPath = String(req.path || '').replace(/\/+$/, '') || '/';
    const publicAuthEndpoints = new Set([
      '/api/auth/login',
      '/api/auth/login/email-otp',
      '/api/auth/signup',
      '/api/auth/google',
      '/api/auth/password/forgot',
      '/api/auth/password/reset',
      '/api/auth/captcha/challenge',
      '/api/auth/verification/request',
      '/api/auth/verification/verify',
      '/api/health',
      '/api/health/live',
      '/api/health/ready'
    ]);

    if (publicAuthEndpoints.has(normalizedPath)) {
      return next();
    }

    // Generate token on first request or if missing
    if (!req.session.csrfToken) {
      req.session.csrfToken = generateToken();
    }

    // Make token available for templates
    res.locals.csrfToken = req.session.csrfToken;

    // Also set as cookie for double-submit pattern
    res.cookie(CSRF_TOKEN_COOKIE, req.session.csrfToken, {
      httpOnly: false,  // Must be accessible to JavaScript for form submission
      secure: process.env.NODE_ENV === 'production',
      // The admin portal and API may be on different sites in production, so the
      // CSRF token cookie must be readable in that cross-site session flow.
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000  // 24 hours
    });

    return next();
  };
}

/**
 * Middleware to protect state-changing endpoints (POST, PUT, DELETE, PATCH)
 * Should be applied BEFORE routes
 */
function csrfProtect() {
  return (req, res, next) => {
    // CSRF protection only needed for state-changing methods
    const protectedMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    
    if (!protectedMethods.includes(req.method)) {
      return next();
    }

    // Skip CSRF check for public auth endpoints (signup, login - they use their own protections)
    const publicAuthEndpoints = [
      '/api/auth/signup',
      '/api/auth/login',
      '/api/auth/login/email-otp',
      '/api/auth/google',
      '/api/admin/login',
      '/api/auth/password/forgot',
      '/api/auth/password/reset',
      '/api/auth/captcha/challenge',
      '/api/auth/verification/request',
      '/api/auth/verification/verify'
    ];

    // Telemetry endpoint is auth-gated and non-critical; skipping CSRF avoids noisy
    // token-rotation conflicts when multiple POST requests are fired in parallel.
    const csrfExemptEndpoints = [
      '/api/intelligence/events'
    ];

    const normalizedPath = String(req.path || '').replace(/\/+$/, '') || '/';
    const strippedApiPrefixPath = normalizedPath.startsWith('/api/')
      ? normalizedPath.slice(4)
      : normalizedPath;

    if (
      publicAuthEndpoints.includes(normalizedPath)
      || publicAuthEndpoints.includes(strippedApiPrefixPath)
      || csrfExemptEndpoints.includes(normalizedPath)
      || csrfExemptEndpoints.includes(strippedApiPrefixPath)
    ) {
      return next();
    }

    // Require authentication for CSRF-protected endpoints
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      });
    }

    // Get token from header or body (preference: header > body)
    const token = req.headers[CSRF_TOKEN_HEADER] || req.body?._csrf;
    const sessionToken = req.session.csrfToken;

    if (!token || !sessionToken) {
      return res.status(403).json({
        error: 'CSRF token missing',
        code: 'CSRF_TOKEN_MISSING'
      });
    }

    try {
      if (!validateToken(token, sessionToken)) {
        return res.status(403).json({
          error: 'CSRF token invalid',
          code: 'CSRF_TOKEN_INVALID'
        });
      }
    } catch (err) {
      return res.status(403).json({
        error: 'CSRF token validation failed',
        code: 'CSRF_TOKEN_ERROR'
      });
    }

    // Token valid, regenerate for next request
    req.session.csrfToken = generateToken();
    res.locals.csrfToken = req.session.csrfToken;

    return next();
  };
}

/**
 * Helper to get CSRF token from session (for API responses)
 */
function getToken(req) {
  return req.session?.csrfToken || null;
}

module.exports = {
  csrfInit,
  csrfProtect,
  getToken,
  generateToken,
  validateToken,
  CSRF_TOKEN_COOKIE,
  CSRF_TOKEN_HEADER
};
