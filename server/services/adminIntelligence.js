/**
 * Admin Intelligence Service
 * Provides intelligent insights, quality analysis, abuse detection, and
 * contributor reputation tracking for platform admins
 */

const { pool } = require('../db/pool');

/**
 * Admin Moderation Filters - Save and manage custom filtering presets
 */

/**
 * Save a custom moderation filter
 * @param {number} adminUserId - Admin creating the filter
 * @param {string} filterName - Name of the filter
 * @param {object} filterConfig - Filter configuration
 */
async function saveModerationFilter(adminUserId, filterName, filterConfig) {
  try {
    const result = await pool.query(
      `INSERT INTO admin_moderation_filters (admin_user_id, filter_name, filter_config)
       VALUES ($1, $2, $3)
       ON CONFLICT (admin_user_id, filter_name) DO UPDATE
       SET filter_config = $3, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [adminUserId, filterName, JSON.stringify(filterConfig)]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving moderation filter:', error);
    throw error;
  }
}

/**
 * Get admin's saved filters
 * @param {number} adminUserId - Admin user ID
 */
async function getAdminFilters(adminUserId) {
  try {
    const result = await pool.query(
      `SELECT * FROM admin_moderation_filters 
       WHERE admin_user_id = $1 OR (is_private = FALSE AND admin_user_id != $1)
       ORDER BY updated_at DESC`,
      [adminUserId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching admin filters:', error);
    throw error;
  }
}

/**
 * Contributor Quality Metrics - Track reputation and approval rates
 */

/**
 * Calculate rolling 7-day contributor quality metrics
 * @param {number} userId - User ID to analyze
 */
async function calculateContributorQuality(userId) {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get all contributions in last 7 days with their moderation status
    const result = await pool.query(
      `SELECT 
         COUNT(CASE WHEN is_approved = TRUE THEN 1 END)::float / 
         NULLIF(COUNT(*), 0) * 100 as approval_rate,
         AVG(CASE WHEN quality_rating IS NOT NULL THEN quality_rating ELSE 50 END)::numeric(5, 1) as quality_avg,
         COUNT(*) as total_submissions
       FROM academic_contributions
       WHERE user_id = $1 AND created_at >= $2`,
      [userId, sevenDaysAgo]
    );

    const metrics = result.rows[0] || { approval_rate: 50, quality_avg: 50, total_submissions: 0 };

    // Update user record with these metrics
    await pool.query(
      `UPDATE users 
       SET last_quality_avg_7d = $1,
           last_approval_rate_7d = $2,
           last_quality_check = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [
        metrics.quality_avg || 50,
        metrics.approval_rate || 50,
        userId
      ]
    );

    // Record history for trend analysis
    const today = new Date().toISOString().split('T')[0];
    await pool.query(
      `INSERT INTO contributor_quality_history  
         (user_id, period_date, avg_quality_score, approval_count, rejection_count, total_submissions)
       SELECT $1, $2::date, $3, 
              COUNT(CASE WHEN is_approved = TRUE THEN 1 END),
              COUNT(CASE WHEN is_approved = FALSE AND is_approved IS NOT NULL THEN 1 END),
              COUNT(*)
       FROM academic_contributions
       WHERE user_id = $1 AND DATE(created_at) = $2::date
       ON CONFLICT (user_id, period_date) DO UPDATE
       SET avg_quality_score = EXCLUDED.avg_quality_score,
           approval_count = EXCLUDED.approval_count,
           rejection_count = EXCLUDED.rejection_count,
           total_submissions = EXCLUDED.total_submissions`,
      [userId, today, metrics.quality_avg || 50]
    );

    return metrics;
  } catch (error) {
    console.error('Error calculating contributor quality:', error);
    throw error;
  }
}

/**
 * Get contributor quality trends
 * @param {number} userId - User ID
 * @param {number} days - Number of days to analyze (default 30)
 */
async function getContributorTrends(userId, days = 30) {
  try {
    const result = await pool.query(
      `SELECT * FROM contributor_quality_history
       WHERE user_id = $1 AND period_date >= CURRENT_DATE - $2
       ORDER BY period_date DESC`,
      [userId, days]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching contributor trends:', error);
    throw error;
  }
}

/**
 * Intelligent Moderation - Detect suspicious patterns
 */

/**
 * Analyze contribution for suspicious patterns
 * @param {object} contribution - Contribution object
 */
async function analyzeForSuspiciousActivity(contribution) {
  const suspicionFlags = [];
  const confidenceScores = {};

  // Flag 1: Check for duplicate content
  if (contribution.file_hash) {
    const duplicateCheck = await pool.query(
      `SELECT COUNT(*) as count FROM academic_contributions
       WHERE file_hash = $1 AND id != $2 AND is_approved = TRUE`,
      [contribution.file_hash, contribution.id]
    );
    
    if (Number(duplicateCheck.rows[0].count) > 0) {
      suspicionFlags.push('DUPLICATE_FILE');
      confidenceScores.duplicate = 95;
    } else {
      confidenceScores.duplicate = 'low';
    }
  }

  // Flag 2: Quality score anomaly
  if (contribution.quality_rating && contribution.quality_rating < 30) {
    suspicionFlags.push('LOW_QUALITY');
    confidenceScores.quality = 80;
  } else {
    confidenceScores.quality = 'normal';
  }

  // Flag 3: Subject mismatch with user profile
  const userResult = await pool.query(
    `SELECT branch_id, semester_id FROM users WHERE id = $1`,
    [contribution.user_id]
  );
  
  if (userResult.rows[0]) {
    const user = userResult.rows[0];
    if (user.branch_id && contribution.branch_id && user.branch_id !== contribution.branch_id) {
      suspicionFlags.push('SUBJECT_MISMATCH');
      confidenceScores.subject_match = 70;
    } else {
      confidenceScores.subject_match = 'match';
    }
  }

  // Flag 4: Rapid uploads in short time
  const recentCount = await pool.query(
    `SELECT COUNT(*) as count FROM academic_contributions
     WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 hour'`,
    [contribution.user_id]
  );

  if (Number(recentCount.rows[0].count) > 5) {
    suspicionFlags.push('RAPID_UPLOADS');
    confidenceScores.rapid_uploads = 85;
  }

  // Flag 5: New user with many submissions
  const userAge = await pool.query(
    `SELECT AGE(CURRENT_TIMESTAMP, created_at) as age, 
            (SELECT COUNT(*) FROM academic_contributions WHERE user_id = $1) as contribution_count
     FROM users WHERE id = $1`,
    [contribution.user_id]
  );

  if (userAge.rows[0]) {
    const age = userAge.rows[0].age;
    const contribCount = Number(userAge.rows[0].contribution_count);
    if (age && age.days < 7 && contribCount > 20) {
      suspicionFlags.push('NEW_USER_BULK_UPLOAD');
      confidenceScores.new_user_activity = 75;
    }
  }

  return { flags: suspicionFlags, confidenceScores };
}

/**
 * Log suspicious activity alert
 * @param {object} alertData - Alert details
 */
async function logSuspiciousActivityAlert(alertData) {
  try {
    const result = await pool.query(
      `INSERT INTO suspicious_activity_alerts
         (user_id, contribution_id, alert_type, alert_message, severity, is_resolved)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
      [
        alertData.userId,
        alertData.contributionId,
        alertData.alertType,
        alertData.alertMessage,
        alertData.severity || 'medium'
      ]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error logging suspicious activity:', error);
    throw error;
  }
}

/**
 * Get unresolved alerts for admin dashboard
 */
async function getUnresolvedAlerts(limit = 50) {
  try {
    const result = await pool.query(
      `SELECT sa.*, u.full_name, ac.title as contribution_title
       FROM suspicious_activity_alerts sa
       LEFT JOIN users u ON sa.user_id = u.id
       LEFT JOIN academic_contributions ac ON sa.contribution_id = ac.id
       WHERE sa.is_resolved = FALSE
       ORDER BY sa.severity DESC, sa.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching unresolved alerts:', error);
    throw error;
  }
}

/**
 * Resource Effectiveness Analysis - Lifecycle management
 */

/**
 * Analyze resource effectiveness and usage metrics
 * @param {number} contributionId - Contribution ID
 */
async function analyzeResourceEffectiveness(contributionId) {
  try {
    const contribution = await pool.query(
      `SELECT * FROM academic_contributions WHERE id = $1`,
      [contributionId]
    );

    if (!contribution.rows[0]) {
      throw new Error('Contribution not found');
    }

    const contrib = contribution.rows[0];
    const createdAt = new Date(contrib.created_at);
    const daysSinceCreation = Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));

    // Calculate effectiveness metrics (these would come from analytics service)
    const downloads = await pool.query(
      `SELECT COUNT(*) as count FROM resource_interactions
       WHERE contribution_id = $1 AND interaction_type = 'download'`,
      [contributionId]
    );

    const helpful = await pool.query(
      `SELECT COUNT(*) as count FROM resource_interactions
       WHERE contribution_id = $1 AND interaction_type = 'helpful'`,
      [contributionId]
    );

    const saves = await pool.query(
      `SELECT COUNT(*) as count FROM resource_interactions
       WHERE contribution_id = $1 AND interaction_type = 'save'`,
      [contributionId]
    );

    const downloadCount = Number(downloads.rows[0]?.count || 0);
    const helpfulCount = Number(helpful.rows[0]?.count || 0);
    const saveCount = Number(saves.rows[0]?.count || 0);

    // Calculate scores
    const downloadToHelpfulRatio = downloadCount > 0 ? (helpfulCount / downloadCount * 100).toFixed(2) : 0;
    const saveToDownloadRatio = downloadCount > 0 ? (saveCount / downloadCount * 100).toFixed(2) : 0;
    
    // Effectiveness score: based on engagement metrics
    const effectivenessScore = Math.min(100, 
      (helpfulCount * 10) + (saveCount * 5) + (downloadCount * 2)
    );

    // Determine if resource is outdated
    const isOutdated = daysSinceCreation > 365 && downloadCount === 0;
    
    // Archive suggestion
    let archiveSuggestion = null;
    if (daysSinceCreation > 180 && downloadCount < 5) {
      archiveSuggestion = 'low_engagement';
    } else if (daysSinceCreation > 365 && effectivenessScore < 20) {
      archiveSuggestion = 'minimal_utility';
    }

    // Save analysis
    const result = await pool.query(
      `INSERT INTO resource_effectiveness_analysis
         (contribution_id, effectiveness_score, download_to_helpful_ratio, 
          save_to_download_ratio, is_outdated, archive_suggestion)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (contribution_id) DO UPDATE
       SET effectiveness_score = $2,
           download_to_helpful_ratio = $3,
           save_to_download_ratio = $4,
           is_outdated = $5,
           archive_suggestion = $6,
           analyzed_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        contributionId,
        effectivenessScore,
        downloadToHelpfulRatio,
        saveToDownloadRatio,
        isOutdated,
        archiveSuggestion
      ]
    );

    return result.rows[0];
  } catch (error) {
    console.error('Error analyzing resource effectiveness:', error);
    throw error;
  }
}

/**
 * Subject Demand Heatmap - Identify high-demand subjects
 */

/**
 * Analyze subject demand and update heatmap
 * @param {string} collegeName - College name
 * @param {number} branchId - Branch ID
 * @param {number} semesterId - Semester ID
 */
async function updateSubjectDemandHeatmap(collegeName, branchId, semesterId) {
  try {
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    // Get subject upload volumes and metrics
    const result = await pool.query(
      `SELECT 
         subject_name,
         resource_type,
         COUNT(*) as upload_volume_30d,
         ROUND(COUNT(CASE WHEN is_approved = TRUE THEN 1 END)::float / 
         NULLIF(COUNT(*), 0) * 100) as approval_rate,
         ROUND(AVG(CAST(JSON_ARRAY_LENGTH(COALESCE(download_count_json, '[]'::json)) AS NUMERIC)), 2)::numeric(10, 2) as avg_download_velocity
       FROM academic_contributions
       WHERE college_name = $1 
         AND branch_id = $2 
         AND semester_id = $3
         AND created_at >= $4
       GROUP BY subject_name, resource_type`,
      [collegeName, branchId, semesterId, last30Days]
    );

    const today = new Date().toISOString().split('T')[0];

    // Insert or update heatmap records
    for (const row of result.rows) {
      const isHighDemand = row.upload_volume_30d > 10 && row.approval_rate > 70;
      
      await pool.query(
        `INSERT INTO subject_demand_heatmap
           (college_name, branch_id, semester_id, subject_name, resource_type,
            upload_volume_30d, approval_rate, avg_download_velocity, is_high_demand, analyzed_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (college_name, branch_id, semester_id, subject_name, resource_type, analyzed_date)
         DO UPDATE SET 
           upload_volume_30d = $6,
           approval_rate = $7,
           avg_download_velocity = $8,
           is_high_demand = $9`,
        [
          collegeName, branchId, semesterId, row.subject_name, row.resource_type,
          row.upload_volume_30d, row.approval_rate, row.avg_download_velocity,
          isHighDemand, today
        ]
      );
    }

    return result.rows;
  } catch (error) {
    console.error('Error updating subject demand heatmap:', error);
    throw error;
  }
}

/**
 * Get demand heatmap for college/branch/semester
 */
async function getDemandHeatmap(collegeName, branchId, semesterId) {
  try {
    const result = await pool.query(
      `SELECT * FROM subject_demand_heatmap
       WHERE college_name = $1 
         AND branch_id = $2 
         AND semester_id = $3
         AND analyzed_date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY upload_volume_30d DESC, approval_rate DESC`,
      [collegeName, branchId, semesterId]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching demand heatmap:', error);
    throw error;
  }
}

/**
 * Cache Intelligence Data - For analytics performance
 */

/**
 * Get or compute cached analytics
 * @param {string} cacheKey - Cache identifier
 * @param {function} computeFn - Function to compute value if not cached
 * @param {number} ttlMinutes - Time-to-live in minutes (default 60)
 */
async function getCachedAnalytics(cacheKey, computeFn, ttlMinutes = 60) {
  try {
    // Try to get from cache
    const cached = await pool.query(
      `SELECT cache_value FROM admin_intelligence_cache
       WHERE cache_key = $1 AND expires_at > CURRENT_TIMESTAMP`,
      [cacheKey]
    );

    if (cached.rows.length > 0) {
      return cached.rows[0].cache_value;
    }

    // Compute new value
    const value = await computeFn();

    // Store in cache
    await pool.query(
      `INSERT INTO admin_intelligence_cache (cache_key, cache_value, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 minute' * $3)
       ON CONFLICT (cache_key) DO UPDATE
       SET cache_value = $2, expires_at = CURRENT_TIMESTAMP + INTERVAL '1 minute' * $3`,
      [cacheKey, JSON.stringify(value), ttlMinutes]
    );

    return value;
  } catch (error) {
    console.error('Error getting cached analytics:', error);
    throw error;
  }
}

module.exports = {
  saveModerationFilter,
  getAdminFilters,
  calculateContributorQuality,
  getContributorTrends,
  analyzeForSuspiciousActivity,
  logSuspiciousActivityAlert,
  getUnresolvedAlerts,
  analyzeResourceEffectiveness,
  updateSubjectDemandHeatmap,
  getDemandHeatmap,
  getCachedAnalytics
};
