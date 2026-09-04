/**
 * Coding Module Rate Limiting Middleware
 * Prevents API spam and Judge0 execution abuse.
 */

const rateStore = new Map();

function createRateLimiter({ windowMs = 60000, maxRequests = 10, actionName = 'request' }) {
  return function rateLimiterMiddleware(req, res, next) {
    const userId = req.session && req.session.userId ? `user_${req.session.userId}` : `ip_${req.ip || req.socket.remoteAddress}`;
    const key = `${actionName}:${userId}`;

    const now = Date.now();
    let record = rateStore.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
    } else {
      record.count += 1;
    }

    rateStore.set(key, record);

    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: `Rate limit exceeded for ${actionName}. Please wait ${retryAfter} second(s) before trying again.`,
        retryAfter
      });
    }

    next();
  };
}

const runCodeLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 10, actionName: 'run_code' });
const submitLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 5, actionName: 'submit_solution' });
const integrityLimiter = createRateLimiter({ windowMs: 60000, maxRequests: 30, actionName: 'integrity_event' });

module.exports = {
  runCodeLimiter,
  submitLimiter,
  integrityLimiter
};
