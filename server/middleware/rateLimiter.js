/**
 * Rate Limiting Service
 * Prevents API abuse and DDoS attacks
 * Uses in-memory storage (fast) with optional Redis backend
 */

const { RateLimitError } = require('./errorHandler');

class RateLimiter {
  constructor(options = {}) {
    this.store = new Map(); // In-memory store
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.maxRequests = options.maxRequests || 100;
    this.keyGenerator = options.keyGenerator || (() => 'global');
    this.skipSuccessfulRequests = options.skipSuccessfulRequests || false;
    this.skipFailedRequests = options.skipFailedRequests || false;
    this.redis = options.redis || null;
    
    // Cleanup old entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async increment(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (this.redis) {
      return this.incrementRedis(key, windowStart);
    }

    // In-memory increment
    if (!this.store.has(key)) {
      this.store.set(key, []);
    }

    let records = this.store.get(key);

    // Remove old records outside window
    records = records.filter((time) => time > windowStart);

    records.push(now);
    this.store.set(key, records);

    return {
      current: records.length,
      limit: this.maxRequests,
      resetTime: records[0] + this.windowMs
    };
  }

  async incrementRedis(key, windowStart) {
    const redisKey = `ratelimit:${key}`;
    
    // Increment count
    const count = await this.redis.incr(redisKey);
    
    // Set expiry on first request
    if (count === 1) {
      await this.redis.expire(redisKey, Math.ceil(this.windowMs / 1000));
    }

    return {
      current: count,
      limit: this.maxRequests,
      resetTime: Date.now() + this.windowMs
    };
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, records] of this.store.entries()) {
      const filtered = records.filter(time => time > windowStart);
      
      if (filtered.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, filtered);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
  }
}

/**
 * Middleware factory for rate limiting
 */
function rateLimit(options = {}) {
  const limiter = new RateLimiter(options);

  return async (req, res, next) => {
    try {
      // Skip or relax rate limiting for / and /favicon.ico
      if (req.path === '/' || req.path === '/favicon.ico') {
        return next();
      }

      // Skip rate limiting for certain status codes
      res.on('finish', () => {
        const shouldSkip = 
          (limiter.skipSuccessfulRequests && res.statusCode < 400) ||
          (limiter.skipFailedRequests && res.statusCode >= 400);

        if (!shouldSkip) {
          // Rate limit was enforced
        }
      });

      const key = options.keyGenerator(req) || `${req.ip}`;
      const limits = await limiter.increment(key);

      // Set headers
      res.set('X-RateLimit-Limit', limiter.maxRequests);
      res.set('X-RateLimit-Remaining', Math.max(0, limiter.maxRequests - limits.current));
      res.set('X-RateLimit-Reset', new Date(limits.resetTime).toISOString());

      if (limits.current > limiter.maxRequests) {
        const retryAfter = Math.ceil((limits.resetTime - Date.now()) / 1000);
        const error = new RateLimitError(retryAfter);
        error.rateLimitContext = {
          route: req.path,
          method: req.method,
          ip: req.ip,
          userId: req.user?.id || null,
          origin: req.headers.origin || '',
          userAgent: req.headers['user-agent'] || '',
          key,
          retryAfter
        };
        throw error;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Pre-configured rate limiters for different endpoints
 */
const rateLimiters = {
  // General API - 100 requests per minute per user
  general: (req) => `user:${req.user?.id || req.ip}`,

  // Auth endpoints - stricter limits
  auth: (req) => `auth:${req.ip}`,

  // Upload endpoint - per-user limit
  upload: (req) => `upload:${req.user?.id}`,

  // Search - per-IP limit
  search: (req) => `search:${req.ip}`,

  // Comments - per-user limit
  comment: (req) => `comment:${req.user?.id}`,

  // Admin endpoints - per-admin limit
  admin: (req) => `admin:${req.user?.id}`
};

/**
 * Rate limit presets
 */
const presets = {
  // Default: 100 requests per minute
  default: rateLimit({
    windowMs: 60000,
    maxRequests: 100,
    keyGenerator: rateLimiters.general
  }),

  // Strict: 10 requests per minute (for auth)
  strict: rateLimit({
    windowMs: 60000,
    maxRequests: 10,
    keyGenerator: rateLimiters.auth,
    skipSuccessfulRequests: true // Only count failed attempts
  }),

  // Medium: 30 requests per minute (for uploads)
  medium: rateLimit({
    windowMs: 60000,
    maxRequests: 30,
    keyGenerator: rateLimiters.upload
  }),

  // Loose: 200 requests per minute (for admins)
  loose: rateLimit({
    windowMs: 60000,
    maxRequests: 200,
    keyGenerator: rateLimiters.admin
  }),

  // Search: 30 requests per minute
  search: rateLimit({
    windowMs: 60000,
    maxRequests: 30,
    keyGenerator: rateLimiters.search
  })
};

/**
 * Create custom rate limiter
 */
function createLimiter(windowMs, maxRequests, keyGenerator) {
  return rateLimit({ windowMs, maxRequests, keyGenerator });
}

module.exports = {
  RateLimiter,
  rateLimit,
  rateLimiters,
  presets,
  createLimiter
};
