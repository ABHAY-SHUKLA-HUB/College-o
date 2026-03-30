/**
 * Feature Flags System
 * Admin-controlled feature toggles for safe rollouts
 */

const { pool } = require('../db/pool');
const logger = require('./logger');

class FeatureFlagsService {
  constructor() {
    this.flags = new Map();
    this.loaded = false;
    this.ttl = 5 * 60 * 1000; // 5 minutes
    this.lastLoad = 0;
  }

  /**
   * Initialize feature flags from database
   */
  async initialize() {
    try {
      await this.loadFlags();
      this.loaded = true;

      logger.info({
        action: 'feature_flags_initialized',
        flagCount: this.flags.size
      });

      // Reload every 5 minutes
      setInterval(() => this.loadFlags(), this.ttl);
    } catch (error) {
      logger.error({
        action: 'feature_flags_init_failed',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Load flags from database
   */
  async loadFlags() {
    try {
      // Create table if doesn't exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS feature_flags (
          id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
          flag_name VARCHAR(100) NOT NULL UNIQUE,
          is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          description TEXT,
          created_by INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Load all flags
      const result = await pool.query(
        `SELECT flag_name, is_enabled FROM feature_flags`
      );

      this.flags.clear();
      result.rows.forEach(row => {
        this.flags.set(row.flag_name, row.is_enabled);
      });

      this.lastLoad = Date.now();
    } catch (error) {
      logger.error({
        action: 'feature_flags_load_failed',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if feature is enabled
   */
  isEnabled(flagName, defaultValue = false) {
    if (!this.loaded) {
      logger.warn({
        action: 'feature_flags_not_loaded',
        flag: flagName
      });
      return defaultValue;
    }

    return this.flags.get(flagName) ?? defaultValue;
  }

  /**
   * Set feature flag
   */
  async setFlag(flagName, isEnabled, adminId, description = '') {
    try {
      await pool.query(
        `INSERT INTO feature_flags (flag_name, is_enabled, description, created_by, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (flag_name) DO UPDATE
         SET is_enabled = $2, updated_at = CURRENT_TIMESTAMP`,
        [flagName, isEnabled, description, adminId]
      );

      // Update in-memory flag
      this.flags.set(flagName, isEnabled);

      logger.info({
        action: 'feature_flag_updated',
        flag: flagName,
        enabled: isEnabled,
        adminId
      });

      return { flagName, isEnabled };
    } catch (error) {
      logger.error({
        action: 'feature_flag_update_failed',
        flag: flagName,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all flags
   */
  async getAllFlags() {
    try {
      const result = await pool.query(
        `SELECT flag_name, is_enabled, description, created_at, updated_at
         FROM feature_flags
         ORDER BY flag_name`
      );
      return result.rows;
    } catch (error) {
      logger.error({
        action: 'feature_flags_fetch_failed',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Middleware to check feature flag
   */
  checkFeature(flagName, defaultValue = false) {
    return (req, res, next) => {
      if (!this.isEnabled(flagName, defaultValue)) {
        return res.status(404).json({
          success: false,
          error: 'Feature not available',
          code: 'FEATURE_DISABLED'
        });
      }
      next();
    };
  }
}

/**
 * Default feature flags
 */
const DEFAULT_FLAGS = {
  // Core features
  contribution_system_enabled: true,
  community_qa_enabled: true,
  comments_enabled: true,
  leaderboard_enabled: true,

  // AI features
  ai_summaries_enabled: true,
  ai_key_points_enabled: true,
  ai_insights_enabled: true,

  // Advanced features
  full_text_search_enabled: true,
  real_time_updates_enabled: true,
  advanced_analytics_enabled: true,
  admin_intelligence_enabled: true,

  // Social features
  social_sharing_enabled: true,
  user_following_enabled: true,
  notifications_enabled: true,

  // Experimental
  experimental_recommendation_engine: false,
  experimental_collaboration_features: false,
  experimental_mobile_app: false
};

/**
 * Initialize default flags
 */
async function initializeDefaultFlags() {
  const service = new FeatureFlagsService();
  
  try {
    // Create table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feature_flags (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        flag_name VARCHAR(100) NOT NULL UNIQUE,
        is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        description TEXT,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default flags
    for (const [flagName, enabled] of Object.entries(DEFAULT_FLAGS)) {
      await pool.query(
        `INSERT INTO feature_flags (flag_name, is_enabled, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (flag_name) DO NOTHING`,
        [flagName, enabled, `Default flag: ${flagName}`]
      );
    }

    await service.initialize();
    return service;
  } catch (error) {
    logger.error({
      action: 'feature_flags_init_default_failed',
      error: error.message
    });
    throw error;
  }
}

/**
 * Global singleton
 */
let instance = null;

async function getFeatureFlagsService() {
  if (!instance) {
    instance = new FeatureFlagsService();
    await instance.initialize();
  }
  return instance;
}

module.exports = {
  FeatureFlagsService,
  DEFAULT_FLAGS,
  initializeDefaultFlags,
  getFeatureFlagsService
};
