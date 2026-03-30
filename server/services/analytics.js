/**
 * Analytics Event Tracking Service
 * Track user behavior, growth metrics, and platform health
 */

const { pool } = require('../db/pool');
const logger = require('./logger');

/**
 * Analytics Event Service
 */
class AnalyticsService {
  constructor() {
    this.eventBuffer = [];
    this.flushInterval = 30000; // Flush every 30 seconds
    this.maxBufferSize = 1000;

    // Start flush interval
    this.startFlushInterval();
  }

  /**
   * Track event
   */
  async trackEvent(eventType, data = {}) {
    const event = {
      eventType,
      data: {
        timestamp: new Date().toISOString(),
        userId: data.userId || null,
        sessionId: data.sessionId || null,
        metadata: data,
        ipAddress: data.ipAddress || null
      }
    };

    // Add to buffer
    this.eventBuffer.push(event);

    // Flush if buffer is full
    if (this.eventBuffer.length >= this.maxBufferSize) {
      await this.flush();
    }

    logger.debug({
      message: 'event_tracked',
      eventType,
      buffered: this.eventBuffer.length
    });
  }

  /**
   * Flush buffered events to database
   */
  async flush() {
    if (this.eventBuffer.length === 0) {
      return;
    }

    const events = this.eventBuffer.splice(0);

    try {
      // Create table if doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS analytics_events (
          id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
          event_type VARCHAR(100) NOT NULL,
          user_id INTEGER,
          session_id VARCHAR(100),
          metadata JSONB,
          ip_address INET,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Batch insert events
      const values = events.map(e => [
        e.eventType,
        e.data.userId,
        e.data.sessionId,
        JSON.stringify(e.data.metadata),
        e.data.ipAddress
      ]);

      const placeholders = values.map((_, i) => {
        const start = i * 5 + 1;
        return `($${start}, $${start + 1}, $${start + 2}, $${start + 3}, $${start + 4})`;
      }).join(',');

      const flatValues = values.flat();

      await pool.query(
        `INSERT INTO analytics_events (event_type, user_id, session_id, metadata, ip_address)
         VALUES ${placeholders}`,
        flatValues
      );

      logger.info({
        message: 'analytics_events_flushed',
        count: events.length
      });
    } catch (error) {
      logger.error({
        message: 'analytics_flush_failed',
        error: error.message,
        eventCount: events.length
      });

      // Re-add events to buffer if flush fails
      this.eventBuffer.unshift(...events);
    }
  }

  /**
   * Start background flush interval
   */
  startFlushInterval() {
    this.flushTimer = setInterval(() => {
      this.flush().catch(error => {
        logger.error({
          message: 'flush_interval_error',
          error: error.message
        });
      });
    }, this.flushInterval);
  }

  /**
   * Stop background flush
   */
  stop() {
    clearInterval(this.flushTimer);
    return this.flush();
  }

  /**
   * Get analytics summary
   */
  async getSummary(days = 7) {
    try {
      const result = await pool.query(`
        SELECT 
          event_type,
          COUNT(*) as count,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(DISTINCT session_id) as unique_sessions,
          COUNT(DISTINCT DATE(created_at)) as active_days
        FROM analytics_events
        WHERE created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY event_type
        ORDER BY count DESC
      `);

      return result.rows;
    } catch (error) {
      logger.error({
        message: 'analytics_summary_failed',
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get daily active users
   */
  async getDailyActiveUsers(days = 30) {
    try {
      const result = await pool.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(DISTINCT user_id) as active_users
        FROM analytics_events
        WHERE user_id IS NOT NULL
          AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      return result.rows;
    } catch (error) {
      logger.error({
        message: 'dau_failed',
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get upload metrics
   */
  async getUploadMetrics(days = 30) {
    try {
      const result = await pool.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as uploads
        FROM analytics_events
        WHERE event_type = 'contribution_uploaded'
          AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);

      return result.rows;
    } catch (error) {
      logger.error({
        message: 'upload_metrics_failed',
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get engagement metrics
   */
  async getEngagementMetrics(days = 30) {
    try {
      const result = await pool.query(`
        SELECT 
          event_type,
          COUNT(*) as count,
          COUNT(DISTINCT user_id) as unique_users
        FROM analytics_events
        WHERE event_type IN (
          'contribution_viewed',
          'contribution_downloaded',
          'comment_posted',
          'question_asked'
        )
        AND created_at >= NOW() - INTERVAL '${days} days'
        GROUP BY event_type
        ORDER BY count DESC
      `);

      return result.rows;
    } catch (error) {
      logger.error({
        message: 'engagement_metrics_failed',
        error: error.message
      });
      return [];
    }
  }

    /**
   * Cleanup old events
   */
  async cleanupOldEvents(olderThanDays = 90) {
    try {
      const result = await pool.query(`
        DELETE FROM analytics_events
        WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
        RETURNING id
      `);

      logger.info({
        message: 'analytics_cleanup',
        deletedCount: result.rowCount,
        olderThanDays
      });

      return result.rowCount;
    } catch (error) {
      logger.error({
        message: 'analytics_cleanup_failed',
        error: error.message
      });
      return 0;
    }
  }
}

/**
 * Pre-configured event types
 */
const EventTypes = {
  // User events
  USER_SIGNUP: 'user_signup',
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  USER_PROFILE_UPDATED: 'user_profile_updated',

  // Contribution events
  CONTRIBUTION_UPLOADED: 'contribution_uploaded',
  CONTRIBUTION_APPROVED: 'contribution_approved',
  CONTRIBUTION_REJECTED: 'contribution_rejected',
  CONTRIBUTION_VIEWED: 'contribution_viewed',
  CONTRIBUTION_DOWNLOADED: 'contribution_downloaded',
  CONTRIBUTION_SAVED: 'contribution_saved',

  // Engagement events
  COMMENT_POSTED: 'comment_posted',
  COMMENT_LIKED: 'comment_liked',
  QUESTION_ASKED: 'question_asked',
  ANSWER_PROVIDED: 'answer_provided',
  ANSWER_UPVOTED: 'answer_upvoted',

  // Search events
  SEARCH_PERFORMED: 'search_performed',

  // Admin events
  ADMIN_LOGIN: 'admin_login',
  ADMIN_CONTENT_MODERATED: 'admin_content_moderated',
  ADMIN_USER_ACTION: 'admin_user_action'
};

/**
 * Singleton instance
 */
let instance = null;

function getAnalyticsService() {
  if (!instance) {
    instance = new AnalyticsService();
  }
  return instance;
}

module.exports = {
  AnalyticsService,
  EventTypes,
  getAnalyticsService
};
