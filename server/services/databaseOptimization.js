/**
 * Database Optimization Service
 * Query performance optimization, indexing strategy, and connection pooling
 */

const { pool } = require('../db/pool');
const logger = require('./logger');

/**
 * Database Indexing Strategy
 * Run this once during deployment to ensure optimal indexes
 */
async function initializeProductionIndexes() {
  const indexes = [
    // ==================== AUTH & USERS ====================
    {
      name: 'idx_users_email',
      sql: 'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      table: 'users'
    },
    {
      name: 'idx_users_username',
      sql: 'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
      table: 'users'
    },
    {
      name: 'idx_users_role',
      sql: 'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
      table: 'users'
    },

    // ==================== ACADEMIC CONTRIBUTIONS ====================
    {
      name: 'idx_contributions_user_created',
      sql: `CREATE INDEX IF NOT EXISTS idx_contributions_user_created 
            ON academic_contributions(user_id, created_at DESC)`,
      table: 'academic_contributions'
    },
    {
      name: 'idx_contributions_status',
      sql: `CREATE INDEX IF NOT EXISTS idx_contributions_status 
            ON academic_contributions(status, is_approved)`,
      table: 'academic_contributions'
    },
    {
      name: 'idx_contributions_college_branch_semester',
      sql: `CREATE INDEX IF NOT EXISTS idx_contributions_college_branch_semester
            ON academic_contributions(college_name, branch_id, semester_id)`,
      table: 'academic_contributions'
    },
    {
      name: 'idx_contributions_created_at',
      sql: `CREATE INDEX IF NOT EXISTS idx_contributions_created_at
            ON academic_contributions(created_at DESC)`,
      table: 'academic_contributions'
    },

    // ==================== COMMENTS ====================
    {
      name: 'idx_comments_contribution_created',
      sql: `CREATE INDEX IF NOT EXISTS idx_comments_contribution_created
            ON comments(contribution_id, created_at DESC)`,
      table: 'comments'
    },
    {
      name: 'idx_comments_user_created',
      sql: `CREATE INDEX IF NOT EXISTS idx_comments_user_created
            ON comments(user_id, created_at DESC)`,
      table: 'comments'
    },

    // ==================== Q&A ====================
    {
      name: 'idx_questions_contribution_created',
      sql: `CREATE INDEX IF NOT EXISTS idx_questions_contribution_created
            ON q_and_a_questions(contribution_id, created_at DESC)`,
      table: 'q_and_a_questions'
    },
    {
      name: 'idx_questions_user_created',
      sql: `CREATE INDEX IF NOT EXISTS idx_questions_user_created
            ON q_and_a_questions(user_id, created_at DESC)`,
      table: 'q_and_a_questions'
    },

    // ==================== MODERATION ====================
    {
      name: 'idx_moderation_contribution_created',
      sql: `CREATE INDEX IF NOT EXISTS idx_moderation_contribution_created
            ON contribution_moderation_events(contribution_id, created_at DESC)`,
      table: 'contribution_moderation_events'
    },

    // ==================== ADMIN INTELLIGENCE ====================
    {
      name: 'idx_alerts_user_resolved',
      sql: `CREATE INDEX IF NOT EXISTS idx_alerts_user_resolved
            ON suspicious_activity_alerts(user_id, is_resolved)`,
      table: 'suspicious_activity_alerts'
    },
    {
      name: 'idx_quality_history_user_date',
      sql: `CREATE INDEX IF NOT EXISTS idx_quality_history_user_date
            ON contributor_quality_history(user_id, period_date DESC)`,
      table: 'contributor_quality_history'
    },

    // ==================== CODING CHALLENGES ====================
    {
      name: 'idx_coding_submissions_contest_user',
      sql: `CREATE INDEX IF NOT EXISTS idx_coding_submissions_contest_user
            ON coding_submissions(contest_id, student_id)`,
      table: 'coding_submissions'
    },
    {
      name: 'idx_coding_submissions_contest_status',
      sql: `CREATE INDEX IF NOT EXISTS idx_coding_submissions_contest_status
            ON coding_submissions(contest_id, status)`,
      table: 'coding_submissions'
    },
    {
      name: 'idx_coding_leaderboard_contest_rank',
      sql: `CREATE INDEX IF NOT EXISTS idx_coding_leaderboard_contest_rank
            ON coding_leaderboard(contest_id, rank)`,
      table: 'coding_leaderboard'
    }
  ];

  logger.info({ message: 'starting_index_creation', count: indexes.length });

  for (const index of indexes) {
    try {
      await pool.query(index.sql);
      logger.info({
        message: 'index_created',
        name: index.name,
        table: index.table
      });
    } catch (error) {
      logger.warn({
        message: 'index_creation_failed',
        name: index.name,
        error: error.message
      });
    }
  }

  logger.info({ message: 'index_creation_complete' });
}

/**
 * Query Performance Analysis
 * Identifies slow queries and N+1 problems
 */
class QueryAnalyzer {
  constructor() {
    this.queries = [];
    this.slowQueryThreshold = 500; // ms
  }

  /**
   * Log query execution
   */
  logQuery(query, duration, params = []) {
    this.queries.push({
      query: query.substring(0, 200),
      duration,
      paramCount: params.length,
      timestamp: Date.now()
    });

    if (duration > this.slowQueryThreshold) {
      logger.warn({
        message: 'slow_query',
        duration,
        query: query.substring(0, 150),
        threshold: this.slowQueryThreshold
      });
    }
  }

  /**
   * Get query statistics
   */
  getStats() {
    if (this.queries.length === 0) {
      return { totalQueries: 0 };
    }

    const durations = this.queries.map(q => q.duration);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const maxDuration = Math.max(...durations);
    const minDuration = Math.min(...durations);
    const slowCount = durations.filter(d => d > this.slowQueryThreshold).length;

    return {
      totalQueries: this.queries.length,
      avgDuration: Math.round(avgDuration),
      maxDuration,
      minDuration,
      slowQueryCount: slowCount,
      slowQueryPercentage: ((slowCount / this.queries.length) * 100).toFixed(2)
    };
  }
}

/**
 * Connection Pool Configuration
 * Optimized for production workloads
 */
const POOL_CONFIG = {
  development: {
    min: 2,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  },
  production: {
    min: 5,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  },
  staging: {
    min: 3,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  }
};

/**
 * Query Optimization Best Practices
 * Constants and utilities to prevent common performance issues
 */
const QUERY_LIMITS = {
  maxPageSize: 100,
  defaultPageSize: 20,
  maxResults: 1000,
  searchLimit: 500
};

/**
 * N+1 Query Prevention Patterns
 */
const OptimizedQueries = {
  /**
   * Get contributions with user info (JOIN instead of N+1)
   */
  getContributionsWithUser: async (limit = 20, offset = 0) => {
    return pool.query(`
      SELECT 
        ac.id, ac.title, ac.description, ac.created_at,
        u.id as user_id, u.full_name, u.username,
        COUNT(c.id) as comment_count
      FROM academic_contributions ac
      JOIN users u ON ac.user_id = u.id
      LEFT JOIN comments c ON ac.id = c.contribution_id
      WHERE ac.is_approved = TRUE
      GROUP BY ac.id, u.id
      ORDER BY ac.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
  },

  /**
   * Get leaderboard efficiently
   */
  getLeaderboard: async (period = 'weekly', limit = 100) => {
    const dateInterval = period === 'monthly' ? '30 days' : '7 days';
    
    return pool.query(`
      SELECT 
        u.id, u.full_name, u.username, u.profile_image,
        COUNT(ac.id) as contribution_count,
        SUM(CASE WHEN ac.is_approved = TRUE THEN 1 ELSE 0 END) as approved_count,
        AVG(CASE WHEN ac.quality_rating IS NOT NULL THEN ac.quality_rating ELSE 50 END)::NUMERIC(5, 1) as avg_quality,
        SUM(ac.download_count) as total_downloads
      FROM users u
      LEFT JOIN academic_contributions ac ON u.id = ac.user_id 
        AND ac.created_at >= NOW() - INTERVAL '${dateInterval}'
      WHERE u.role = 'student'
      GROUP BY u.id
      HAVING COUNT(ac.id) > 0
      ORDER BY approved_count DESC, avg_quality DESC
      LIMIT $1
    `, [limit]);
  },

  /**
   * Get search results with ranking
   */
  searchContributions: async (query, limit = 20, offset = 0) => {
    return pool.query(`
      SELECT 
        ac.id, ac.title, ac.description, ac.created_at,
        u.full_name, u.username,
        ts_rank(search_vector, plainto_tsquery($1)) as relevance
      FROM academic_contributions ac
      JOIN users u ON ac.user_id = u.id
      WHERE ac.search_vector @@ plainto_tsquery($1)
        AND ac.is_approved = TRUE
      ORDER BY relevance DESC, ac.created_at DESC
      LIMIT $2 OFFSET $3
    `, [query, limit, offset]);
  }
};

/**
 * Database Health Check
 */
async function healthCheck() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();

    return {
      status: 'healthy',
      timestamp: result.rows[0].now,
      poolSize: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount
    };
  } catch (error) {
    logger.error({
      message: 'database_health_check_failed',
      error: error.message
    });

    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

module.exports = {
  initializeProductionIndexes,
  QueryAnalyzer,
  POOL_CONFIG,
  QUERY_LIMITS,
  OptimizedQueries,
  healthCheck
};
