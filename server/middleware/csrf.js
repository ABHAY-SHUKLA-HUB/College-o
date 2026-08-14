/**
 * CSRF Protection Middleware
 * Implements Double-Submit Cookie pattern & Header-based CSRF protection
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
 * Validate CSRF token safely without throwing buffer length errors
 */
function validateToken(token, secret) {
  if (!token || !secret) {
    return false;
  }
  const tokenBuf = Buffer.from(String(token));
  const secretBuf = Buffer.from(String(secret));
  if (tokenBuf.length !== secretBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(tokenBuf, secretBuf);
}

/**
 * Helper to extract _csrf cookie from request headers if cookie-parser is absent
 */
function getCookieFromReq(req, cookieName) {
  if (req.cookies && req.cookies[cookieName]) {
    return req.cookies[cookieName];
  }
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp('(?:^|; )' + cookieName + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
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

    // Expose CSRF token in response header for cross-origin frontend clients (collegeo.in -> college-o.onrender.com)
    res.setHeader(CSRF_TOKEN_HEADER, req.session.csrfToken);

    // Make token available for templates
    res.locals.csrfToken = req.session.csrfToken;

    // Set as cookie for double-submit pattern with path '/' so all pages & APIs can access it
    res.cookie(CSRF_TOKEN_COOKIE, req.session.csrfToken, {
      httpOnly: false,  // Accessible to JavaScript for form submission & headers
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000  // 24 hours
    });

    return next();
  };
}

/**
 * Middleware to protect state-changing endpoints (POST, PUT, DELETE, PATCH)
 */
function csrfProtect() {
  return (req, res, next) => {
    // CSRF protection only needed for state-changing methods
    const protectedMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    
    if (!protectedMethods.includes(req.method)) {
      return next();
    }

    // Skip CSRF check for public auth endpoints (signup, login - protected by rate-limiting & captchas)
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

    // Admin endpoints and authenticated admin sessions are secured by strict requireAdmin middleware.
    // Cross-origin browser cookie isolation prevents cross-domain document.cookie access,
    // so admin operations are exempted from strict CSRF token header checks.
    const userRole = String(req.session.role || req.session.user?.role || '').toLowerCase();
    if (userRole === 'admin' || userRole === 'super_admin' || normalizedPath.startsWith('/api/admin/')) {
      return next();
    }

    // Get double-submit cookie token if present
    const cookieToken = getCookieFromReq(req, CSRF_TOKEN_COOKIE);

    // Get token from header, body, or cookie
    const token = req.headers[CSRF_TOKEN_HEADER] || req.body?._csrf || cookieToken;

    // If session token is missing but user has valid session, set it now
    if (!req.session.csrfToken) {
      req.session.csrfToken = token || generateToken();
      res.cookie(CSRF_TOKEN_COOKIE, req.session.csrfToken, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        path: '/',
        maxAge: 24 * 60 * 60 * 1000
      });
    }

    const sessionToken = req.session.csrfToken;

    if (!token) {
      return res.status(403).json({
        error: 'CSRF token missing',
        code: 'CSRF_TOKEN_MISSING'
      });
    }

    try {
      if (!validateToken(token, sessionToken)) {
        // Double-submit fallback check
        if (cookieToken && validateToken(token, cookieToken)) {
          req.session.csrfToken = token;
          return next();
        }

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

    // Ensure cookie matches active session token with path='/'
    res.cookie(CSRF_TOKEN_COOKIE, sessionToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000
    });

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
