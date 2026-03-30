/**
 * Database Optimization Guide
 * SQL indexes, query optimization, and performance tuning
 */

/**
 * CRITICAL INDEXES FOR PRODUCTION
 * 
 * Run these SQL commands to optimize database performance:
 */

const requiredIndexes = `
-- User table indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- Session table index (already exists but verify)
CREATE INDEX IF NOT EXISTS idx_session_sid ON session(sid);

-- User profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- Subscription tracking
CREATE INDEX IF NOT EXISTS idx_users_subscription_tier ON users(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_users_subscription_expiry ON users(subscription_expiry);

-- Quiz attempts (for analytics)
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_id ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_quiz_id ON quiz_attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_created_at ON quiz_attempts(created_at DESC);

-- Mock tests
CREATE INDEX IF NOT EXISTS idx_mock_test_attempts_user_id ON mock_test_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_mock_test_attempts_mock_test_id ON mock_test_attempts(mock_test_id);

-- Notes
CREATE INDEX IF NOT EXISTS idx_notes_created_by ON notes(created_by);
CREATE INDEX IF NOT EXISTS idx_notes_subject ON notes(subject);

-- Forum threads
CREATE INDEX IF NOT EXISTS idx_forum_threads_user_id ON forum_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_created_at ON forum_threads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_threads_category ON forum_threads(category);

-- Forum replies
CREATE INDEX IF NOT EXISTS idx_forum_replies_thread_id ON forum_replies(thread_id);
CREATE INDEX IF NOT EXISTS idx_forum_replies_user_id ON forum_replies(user_id);

-- Campus feed
CREATE INDEX IF NOT EXISTS idx_campus_feed_posts_user_id ON campus_feed_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_campus_feed_posts_created_at ON campus_feed_posts(created_at DESC);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Contributions
CREATE INDEX IF NOT EXISTS idx_contributions_user_id ON contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_contributions_created_at ON contributions(created_at DESC);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_role_subscription ON users(role, subscription_tier);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_forum_threads_user_created ON forum_threads(user_id, created_at DESC);
`;

/**
 * Query optimization best practices for routes
 */
const queryOptimizationPatterns = {
  /**
   * GOOD: Use SELECT with specific columns
   */
  good_specific_columns: `
    SELECT id, name, email, created_at 
    FROM users 
    WHERE id = $1
  `,

  /**
   * BAD: SELECT * returns unnecessary columns
   */
  bad_select_all: `
    SELECT * FROM users WHERE id = $1
  `,

  /**
   * GOOD: Use JOINs for related data
   */
  good_join: `
    SELECT u.id, u.name, COALESCE(COUNT(qa.id), 0) as attempts
    FROM users u
    LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
    WHERE u.id = $1
    GROUP BY u.id
  `,

  /**
   * BAD: N+1 queries - fetch user, then loop and fetch attempts
   */
  bad_n_plus_one: [
    'SELECT * FROM users WHERE id = $1',
    '// In loop: SELECT * FROM quiz_attempts WHERE user_id = $1'
  ],

  /**
   * GOOD: Batch queries with IN clause
   */
  good_batch: `
    SELECT id, name, email 
    FROM users 
    WHERE id = ANY($1::int[])
  `,

  /**
   * BAD: Multiple individual queries
   */
  bad_loop_queries: [
    '// In loop:',
    'SELECT * FROM users WHERE id = $1',
    'SELECT * FROM users WHERE id = $2',
    'SELECT * FROM users WHERE id = $3'
  ],

  /**
   * GOOD: Limit result sets
   */
  good_pagination: `
    SELECT id, name, email 
    FROM users 
    ORDER BY created_at DESC 
    LIMIT $1 OFFSET $2
  `,

  /**
   * BAD: Fetch all rows then paginate in code
   */
  bad_fetch_all: `
    SELECT * FROM users
    // Then slice in JavaScript
  `,

  /**
   * GOOD: Use COUNT estimate for large tables
   */
  good_count_estimate: `
    SELECT 
      (SELECT count(*) FROM users) as total_users,
      COUNT(*) as premium_users
    FROM users
    WHERE subscription_tier = 'premium'
  `,

  /**
   * GOOD: Cache frequently accessed data
   */
  good_cached: `
    // Check cache first
    const cached = await cache.get('user:' + userId);
    if (cached) return cached;
    
    // Then query DB
    const user = await pool.query(...);
    await cache.set('user:' + userId, user, 3600); // 1 hour
    return user;
  `
};

/**
 * Connection pool optimization
 */
const poolOptimization = {
  minConnections: 2,
  maxConnections: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  /**
   * In pool configuration:
   * - Too few connections: Database bottleneck
   * - Too many connections: Memory usage, slow queries
   * - Pool size should be: Math.ceil((avgConnections * 3) / 4)
   */
};

/**
 * Query execution analysis
 */
const performanceAnalysis = {
  /**
   * Identify slow queries:
   */
  slow_query_log: `
    -- PostgreSQL slow query log
    SET log_min_duration_statement = 100;  -- Log queries over 100ms
    
    -- Then check logs:
    SELECT query, mean_exec_time, calls
    FROM pg_stat_statements
    ORDER BY mean_exec_time DESC
    LIMIT 10;
  `,

  /**
   * Explain query plan (check for sequential scans):
   */
  analyze_plan: `
    EXPLAIN ANALYZE 
    SELECT * FROM users WHERE email = $1;
    
    -- Look for "Index Scan" (good)
    -- Avoid "Seq Scan" without WHERE (bad)
  `,

  /**
   * Find missing indexes:
   */
  find_missing_indexes: `
    SELECT 
      schemaname,
      tablename,
      attname,
      n_distinct,
      correlation
    FROM pg_stats
    WHERE n_distinct > 100
    AND correlation < 0.1
    ORDER BY n_distinct DESC;
  `
};

/**
 * Caching strategy
 */
const cachingStrategy = {
  /**
   * Cache by type (time-to-live recommendations):
   */
  cache_ttl: {
    user_profile: 300,        // 5 minutes
    leaderboard: 600,         // 10 minutes
    frequently_accessed: 1800, // 30 minutes
    static_content: 86400,    // 24 hours
    user_settings: 3600       // 1 hour
  },

  /**
   * Cache invalidation events:
   */
  invalidate_on: [
    'user_profile_update',
    'settings_change',
    'payment_update',
    'admin_content_update'
  ]
};

/**
 * Example: Optimized route with caching
 */
const optimizedRouteExample = `
const { pool } = require('../db/pool');
const { cache } = require('../services/cache');

router.get('/users/:id', async (req, res) => {
  const userId = req.params.id;
  
  // 1. Try cache first
  const cacheKey = \`user:\${userId}\`;
  let user = await cache.get(cacheKey);
  
  if (!user) {
    // 2. Query specific columns only
    const { rows } = await pool.query(
      \`SELECT id, name, email, created_at 
        FROM users 
        WHERE id = $1\`,
      [userId]
    );
    
    user = rows[0];
    
    if (!user) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    // 3. Store in cache (5 minute TTL)
    await cache.set(cacheKey, user, 300);
  }
  
  return res.json(user);
});
`;

module.exports = {
  requiredIndexes,
  queryOptimizationPatterns,
  poolOptimization,
  performanceAnalysis,
  cachingStrategy,
  optimizedRouteExample
};
