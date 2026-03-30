/**
 * Production Caching Service
 * Redis abstraction with fallback to in-memory caching
 */

const logger = require('./logger');

class CacheService {
  constructor(options = {}) {
    this.redis = options.redis || null;
    this.inMemoryStore = new Map();
    this.defaultTTL = options.defaultTTL || 300; // 5 minutes
    this.useRedis = !!(this.redis);

    // Cleanup in-memory cache every 10 minutes
    this.cleanupInterval = setInterval(() => this.cleanupMemoryCache(), 10 * 60 * 1000);
  }

  /**
   * Get cached value
   */
  async get(key) {
    try {
      if (this.useRedis) {
        const value = await this.redis.get(key);
        if (value) {
          logger.debug(`cache_hit redis: ${key}`);
          return JSON.parse(value);
        }
      } else {
        const cached = this.inMemoryStore.get(key);
        if (cached && cached.expiresAt > Date.now()) {
          logger.debug(`cache_hit memory: ${key}`);
          return cached.value;
        } else if (cached) {
          // Clear expired entry
          this.inMemoryStore.delete(key);
        }
      }

      logger.debug(`cache_miss: ${key}`);
      return null;
    } catch (error) {
      logger.error({
        message: 'cache_get_error',
        key,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Set cached value
   */
  async set(key, value, ttlSeconds = null) {
    try {
      const ttl = ttlSeconds || this.defaultTTL;

      if (this.useRedis) {
        await this.redis.setex(key, ttl, JSON.stringify(value));
      } else {
        this.inMemoryStore.set(key, {
          value,
          expiresAt: Date.now() + (ttl * 1000),
          setAt: Date.now()
        });
      }

      logger.debug(`cache_set: ${key} (ttl: ${ttl}s)`);
      return true;
    } catch (error) {
      logger.error({
        message: 'cache_set_error',
        key,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Delete cached value
   */
  async delete(key) {
    try {
      if (this.useRedis) {
        await this.redis.del(key);
      } else {
        this.inMemoryStore.delete(key);
      }

      logger.debug(`cache_delete: ${key}`);
      return true;
    } catch (error) {
      logger.error({
        message: 'cache_delete_error',
        key,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Clear all cache (use carefully!)
   */
  async clear() {
    try {
      if (this.useRedis) {
        await this.redis.flushdb();
      } else {
        this.inMemoryStore.clear();
      }

      logger.info('cache_cleared');
      return true;
    } catch (error) {
      logger.error({
        message: 'cache_clear_error',
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get or compute value
   */
  async getOrCompute(key, computeFn, ttlSeconds = null) {
    // Try to get from cache
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    // Compute value
    const value = await computeFn();

    // Store in cache
    await this.set(key, value, ttlSeconds);

    return value;
  }

  /**
   * Invalidate pattern (only with Redis)
   */
  async invalidatePattern(pattern) {
    if (!this.useRedis) {
      logger.warn('Pattern invalidation not supported for in-memory cache');
      return;
    }

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info(`cache_pattern_invalidate: ${pattern} (count: ${keys.length})`);
      }
    } catch (error) {
      logger.error({
        message: 'cache_pattern_invalidate_error',
        pattern,
        error: error.message
      });
    }
  }

  /**
   * Clean up expired entries from in-memory cache
   */
  cleanupMemoryCache() {
    if (this.useRedis) return;

    const now = Date.now();
    const expired = [];

    for (const [key, cached] of this.inMemoryStore.entries()) {
      if (cached.expiresAt <= now) {
        expired.push(key);
      }
    }

    expired.forEach(key => this.inMemoryStore.delete(key));

    if (expired.length > 0) {
      logger.debug(`cache_cleanup_memory: removed ${expired.length} entries`);
    }
  }

  /**
   * Get cache stats
   */
  async stats() {
    if (this.useRedis) {
      try {
        const info = await this.redis.info('memory');
        return { backend: 'redis', info };
      } catch (error) {
        logger.error({ message: 'cache_stats_error', error: error.message });
        return { backend: 'redis', error: error.message };
      }
    } else {
      return {
        backend: 'memory',
        entries: this.inMemoryStore.size,
        memory: process.memoryUsage()
      };
    }
  }

  /**
   * Shutdown cache service
   */
  destroy() {
    clearInterval(this.cleanupInterval);
    this.inMemoryStore.clear();
  }
}

/**
 * Cache key builder - standardized cache key format
 */
class CacheKeys {
  static user(userId) {
    return `user:${userId}`;
  }

  static contribution(contribId) {
    return `contrib:${contribId}`;
  }

  static leaderboard(period = 'weekly') {
    return `leaderboard:${period}`;
  }

  static searchResults(query, page = 1) {
    return `search:${query}:${page}`;
  }

  static analytics(metric, date) {
    return `analytics:${metric}:${date}`;
  }

  static adminDashboard(adminId) {
    return `admin:dashboard:${adminId}`;
  }

  static aiSummary(contribId) {
    return `ai:summary:${contribId}`;
  }

  static demandHeatmap(college, branch, semester) {
    return `demand:${college}:${branch}:${semester}`;
  }

  static qualityHistory(userId, days) {
    return `quality:${userId}:${days}`;
  }
}

/**
 * Cache invalidation strategies
 */
const invalidate = {
  // User-related caches
  user: async (cache, userId) => {
    await cache.delete(CacheKeys.user(userId));
  },

  // Contribution-related caches
  contribution: async (cache, contribId) => {
    await cache.delete(CacheKeys.contribution(contribId));
    await cache.invalidatePattern('search:*');
    await cache.invalidatePattern('leaderboard:*');
  },

  // Leaderboard caches
  leaderboard: async (cache) => {
    await cache.invalidatePattern('leaderboard:*');
  },

  // Analytics caches
  analytics: async (cache, metric) => {
    await cache.invalidatePattern(`analytics:${metric}:*`);
  },

  // All admin caches
  admin: async (cache, adminId) => {
    await cache.delete(CacheKeys.adminDashboard(adminId));
    await cache.invalidatePattern('admin:*');
  }
};

/**
 * Singleton instance
 */
let instance = null;

function getCacheService() {
  if (!instance) {
    const redis = null; // Set to redis client if available
    instance = new CacheService({ redis });
  }
  return instance;
}

module.exports = {
  CacheService,
  CacheKeys,
  invalidate,
  getCacheService
};
