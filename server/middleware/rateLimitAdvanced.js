const { pool } = require('../db/pool');

/**
 * Advanced rate limiting and brute force protection
 * Uses database for persistence across server restarts
 */

const IN_MEMORY_STORE = new Map(); // Fallback in-memory store

/**
 * Get rate limit key for request
 */
function getRateLimitKey(req, prefix = 'global') {
  const userId = req.session?.userId;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (userId) {
    return `${prefix}:user:${userId}`;
  }
  return `${prefix}:ip:${ip}`;
}

/**
 * Check and increment rate limit counter
 * Returns { allowed: boolean, remaining: number, resetAt: Date }
 */
async function checkRateLimit(key, maxAttempts, windowSeconds) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);

  try {
    // Try using DB if available
    const { rows } = await pool.query(
      `INSERT INTO rate_limit_buckets (key, count, reset_at, updated_at)
       VALUES ($1, 1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET
         count = CASE
           WHEN rate_limit_buckets.reset_at <= NOW() THEN 1
           ELSE rate_limit_buckets.count + 1
         END,
         reset_at = CASE
           WHEN rate_limit_buckets.reset_at <= NOW() THEN $2
           ELSE rate_limit_buckets.reset_at
         END,
         updated_at = NOW()
       RETURNING count, reset_at`,
      [key, resetAt]
    );

    const count = rows[0]?.count || 0;
    const dbResetAt = rows[0]?.reset_at ? new Date(rows[0].reset_at) : resetAt;
    const remaining = Math.max(0, maxAttempts - count);

    return {
      allowed: count <= maxAttempts,
      count,
      remaining,
      resetAt: dbResetAt
    };
  } catch (err) {
    // Fallback to in-memory store
    console.warn('[RateLimit] DB unavailable, using in-memory store', err.message);

    const stored = IN_MEMORY_STORE.get(key) || { count: 0, resetAt: now };
    if (stored.resetAt <= now) {
      stored.count = 0;
      stored.resetAt = resetAt;
    }
    stored.count += 1;
    IN_MEMORY_STORE.set(key, stored);

    const remaining = Math.max(0, maxAttempts - stored.count);
    return {
      allowed: stored.count <= maxAttempts,
      count: stored.count,
      remaining,
      resetAt: stored.resetAt
    };
  }
}

/**
 * Create rate limit middleware for login attempts
 * Default: 5 attempts per 15 minutes
 */
function rateLimitLogin(maxAttempts = 5, windowMinutes = 15) {
  return async (req, res, next) => {
    const key = getRateLimitKey(req, 'login');
    const limit = await checkRateLimit(key, maxAttempts, windowMinutes * 60);

    res.setHeader('X-RateLimit-Limit', maxAttempts);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit.remaining));
    res.setHeader('X-RateLimit-Reset', Math.floor(limit.resetAt.getTime() / 1000));

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Too many login attempts',
        message: `Please try again after ${Math.ceil((limit.resetAt.getTime() - Date.now()) / 60000)} minutes`,
        retryAfter: Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)
      });
    }

    next();
  };
}

/**
 * Create rate limit middleware for OTP requests
 * Default: 3 requests per 10 minutes
 */
function rateLimitOTP(maxAttempts = 3, windowMinutes = 10) {
  return async (req, res, next) => {
    const key = getRateLimitKey(req, 'otp');
    const limit = await checkRateLimit(key, maxAttempts, windowMinutes * 60);

    res.setHeader('X-RateLimit-Limit', maxAttempts);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit.remaining));

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Too many OTP requests',
        message: 'Please wait before requesting another OTP',
        retryAfter: Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)
      });
    }

    next();
  };
}

/**
 * Create rate limit middleware for password reset
 * Default: 3 attempts per 30 minutes
 */
function rateLimitPasswordReset(maxAttempts = 3, windowMinutes = 30) {
  return async (req, res, next) => {
    const key = getRateLimitKey(req, 'password-reset');
    const limit = await checkRateLimit(key, maxAttempts, windowMinutes * 60);

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Too many password reset attempts',
        message: 'Please wait before requesting another password reset',
        retryAfter: Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)
      });
    }

    next();
  };
}

/**
 * Create rate limit middleware for API endpoints
 * Default: 100 requests per minute
 */
function rateLimitAPI(maxAttempts = 100, windowSeconds = 60) {
  return async (req, res, next) => {
    const key = getRateLimitKey(req, 'api');
    const limit = await checkRateLimit(key, maxAttempts, windowSeconds);

    res.setHeader('X-RateLimit-Limit', maxAttempts);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit.remaining));

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((limit.resetAt.getTime() - Date.now()) / 1000)
      });
    }

    next();
  };
}

/**
 * Brute force detection: lock account after repeated failed attempts
 */
async function checkBruteForceStatus(email) {
  try {
    const { rows } = await pool.query(
      `SELECT failed_login_attempts, account_locked_until
       FROM users
       WHERE lower(email) = lower($1)
       LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user) return { locked: false };

    const now = new Date();
    const lockedUntil = user.account_locked_until ? new Date(user.account_locked_until) : null;

    if (lockedUntil && lockedUntil > now) {
      return {
        locked: true,
        lockedUntil,
        minutesRemaining: Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000)
      };
    }

    return { locked: false, failedAttempts: user.failed_login_attempts || 0 };
  } catch (err) {
    console.warn('[BruteForce] Error checking status:', err.message);
    return { locked: false };
  }
}

/**
 * Record failed login attempt and lock account if needed
 */
async function recordFailedLogin(email) {
  try {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + 15 * 60000); // 15 minutes

    await pool.query(
      `UPDATE users
       SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
           account_locked_until = CASE
             WHEN COALESCE(failed_login_attempts, 0) + 1 >= 5 THEN $2
             ELSE account_locked_until
           END,
           updated_at = NOW()
       WHERE lower(email) = lower($1)`,
      [email, lockUntil]
    );
  } catch (err) {
    console.warn('[BruteForce] Error recording failed attempt:', err.message);
  }
}

/**
 * Clear failed login attempts after successful login
 */
async function clearFailedLogins(userId) {
  try {
    await pool.query(
      `UPDATE users
       SET failed_login_attempts = 0,
           account_locked_until = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  } catch (err) {
    console.warn('[BruteForce] Error clearing failed attempts:', err.message);
  }
}

module.exports = {
  getRateLimitKey,
  checkRateLimit,
  rateLimitLogin,
  rateLimitOTP,
  rateLimitPasswordReset,
  rateLimitAPI,
  checkBruteForceStatus,
  recordFailedLogin,
  clearFailedLogins
};
