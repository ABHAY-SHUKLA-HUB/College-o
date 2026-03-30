const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const logger = require('../services/logger');
const { ensureSupportSchema } = require('../utils/supportSchema');

const router = express.Router();

router.use(async (_req, _res, next) => {
  try {
    await ensureSupportSchema();
    next();
  } catch (error) {
    next(error);
  }
});

// ============================================
// QUALITY & ABUSE PROTECTION SYSTEM
// ============================================

// Helper: Check if user is admin
async function isAdmin(userId) {
  const { rows } = await pool.query(
    'SELECT role FROM users WHERE id = $1',
    [userId]
  );
  return rows[0]?.role === 'admin';
}

// ============================================
// 1. REPORT REQUEST/ANSWER AS ABUSE
// ============================================

router.post('/report', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    const { report_type, request_id, answer_id, report_reason } = req.body;
    
    if (!['spam', 'inappropriate', 'abuse', 'low-quality', 'irrelevant'].includes(report_type)) {
      return res.status(400).json({ error: 'Invalid report type' });
    }
    
    if (!report_reason || report_reason.length < 5) {
      return res.status(400).json({ error: 'Report reason too short' });
    }
    
    // Create moderation queue entry
    const { rows } = await pool.query(`
      INSERT INTO support_moderation_queue 
      (request_id, answer_id, report_type, reported_by, report_reason, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING id, created_at
    `, [request_id || null, answer_id || null, report_type, userId, report_reason]);
    
    // Increment abuse counter for tracking patterns
    if (answer_id) {
      await pool.query(`
        UPDATE support_answers SET is_flagged = TRUE WHERE id = $1
      `, [answer_id]);
    }
    
    if (request_id) {
      await pool.query(`
        UPDATE support_requests SET is_flagged = TRUE WHERE id = $1
      `, [request_id]);
    }
    
    logger.info(`Abuse report filed: ${rows[0].id} by user ${userId}`);
    
    res.status(201).json({
      success: true,
      report_id: rows[0].id
    });
  } catch (error) {
    logger.error('Failed to create report:', error);
    res.status(500).json({ error: 'Failed to report' });
  }
});

// ============================================
// 2. CHECK SPAM PATTERNS (internal safety check)
// ============================================

async function detectSpam(userId, _contentType) {
  // Get user's quality metrics
  const { rows } = await pool.query(`
    SELECT COUNT(*) as spam_count FROM support_quality_metrics
    WHERE user_id = $1 AND metric_type = 'spam_flag'
      AND created_at > NOW() - INTERVAL '7 days'
  `, [userId]);
  
  // High spam score triggers quality penalty
  const spamScore = parseInt(rows[0].spam_count);
  
  if (spamScore >= 5) {
    // Reduce support points for repeated abuse.
    await pool.query(`
      UPDATE user_profiles SET support_points_earned = GREATEST(COALESCE(support_points_earned, 0) - 5, 0)
      WHERE user_id = $1
    `, [userId]);
    
    return { is_spam: true, score: spamScore };
  }
  
  return { is_spam: false, score: spamScore };
}

// ============================================
// 3. ADMIN: VIEW MODERATION QUEUE
// ============================================

router.get('/moderation-queue', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Only admins can access moderation' });
    }
    
    const { status = 'pending', page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const { rows } = await pool.query(`
      SELECT 
        smq.id, smq.request_id, smq.answer_id, smq.report_type, smq.report_reason,
        smq.reported_by, smq.status, smq.created_at,
        sr.title as request_title,
        sa.content as answer_content,
        u.full_name as reported_by_name
      FROM support_moderation_queue smq
      LEFT JOIN support_requests sr ON smq.request_id = sr.id
      LEFT JOIN support_answers sa ON smq.answer_id = sa.id
      INNER JOIN users u ON smq.reported_by = u.id
      WHERE smq.status = $1
      ORDER BY smq.created_at DESC
      LIMIT $2 OFFSET $3
    `, [status, parseInt(limit), offset]);
    
    res.json({
      success: true,
      reports: rows,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    logger.error('Failed to fetch moderation queue:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// ============================================
// 4. ADMIN: TAKE MODERATION ACTION
// ============================================

router.put('/moderation/:reportId/action', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Only admins can moderate' });
    }
    
    const { review_action, review_notes } = req.body;
    
    if (!['approve', 'reject', 'delete', 'warn'].includes(review_action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    
    // Get the report
    const { rows: reportRows } = await pool.query(`
      SELECT * FROM support_moderation_queue WHERE id = $1
    `, [req.params.reportId]);
    
    if (!reportRows.length) {
      return res.status(404).json({ error: 'Report not found' });
    }
    
    const report = reportRows[0];
    await detectSpam(report.reported_by, 'moderation_report');
    
    // Take action
    if (review_action === 'delete') {
      if (report.request_id) {
        await pool.query(`DELETE FROM support_requests WHERE id = $1`, [report.request_id]);
      }
      if (report.answer_id) {
        await pool.query(`DELETE FROM support_answers WHERE id = $1`, [report.answer_id]);
      }
    }
    
    if (review_action === 'warn') {
      const targetUserId = report.request_id 
        ? (await pool.query(`SELECT user_id FROM support_requests WHERE id = $1`, [report.request_id])).rows[0].user_id
        : (await pool.query(`SELECT answerer_id FROM support_answers WHERE id = $1`, [report.answer_id])).rows[0].answerer_id;
      
      await pool.query(`
        INSERT INTO notifications (user_id, message, kind)
        VALUES ($1, $2, 'moderation_warning')
      `, [
        targetUserId,
        `Your support content was flagged for: ${report.report_reason}. Please follow community guidelines.`
      ]);
    }
    
    // Update report status
    await pool.query(`
      UPDATE support_moderation_queue 
      SET status = 'reviewed', reviewed_by = $1, review_action = $2, review_notes = $3, updated_at = NOW()
      WHERE id = $4
    `, [userId, review_action, review_notes, req.params.reportId]);
    
    logger.info(`Moderation action taken on report ${req.params.reportId}: ${review_action}`);
    
    res.json({
      success: true,
      message: `Action taken: ${review_action}`
    });
  } catch (error) {
    logger.error('Moderation action failed:', error);
    res.status(500).json({ error: 'Action failed' });
  }
});

// ============================================
// 5. ADMIN: REWARD CONTROL (final authority)
// ============================================

router.put('/admin/rewards/:userId/adjust', requireAuth, async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    if (!(await isAdmin(userId))) {
      return res.status(403).json({ error: 'Only admins can adjust rewards' });
    }

    const pointsDelta = Number(req.body.points_delta);
    const reason = String(req.body.reason || '').trim();

    if (!Number.isInteger(pointsDelta) || pointsDelta === 0 || pointsDelta < -200 || pointsDelta > 200) {
      return res.status(400).json({ error: 'points_delta must be an integer between -200 and 200 (excluding 0)' });
    }
    if (reason.length < 3 || reason.length > 180) {
      return res.status(400).json({ error: 'reason must be 3-180 characters' });
    }

    await pool.query(
      `INSERT INTO helper_reputation (helper_id, total_points_earned)
       VALUES ($1, 0)
       ON CONFLICT (helper_id) DO NOTHING`,
      [req.params.userId]
    );

    await pool.query(
      `UPDATE helper_reputation
       SET total_points_earned = GREATEST(total_points_earned + $1, 0), updated_at = NOW()
       WHERE helper_id = $2`,
      [pointsDelta, req.params.userId]
    );

    await pool.query(
      `UPDATE user_profiles
       SET support_points_earned = GREATEST(COALESCE(support_points_earned, 0) + $1, 0)
       WHERE user_id = $2`,
      [pointsDelta, req.params.userId]
    );

    await pool.query(
      `INSERT INTO support_quality_metrics (user_id, metric_type, metric_value, metric_reason)
       VALUES ($1, 'admin_reward_adjustment', $2, $3)`,
      [req.params.userId, pointsDelta, reason]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, message, kind)
       VALUES ($1, $2, 'support_reward_adjusted')`,
      [req.params.userId, `Support reward adjusted by admin: ${pointsDelta > 0 ? '+' : ''}${pointsDelta} points. Reason: ${reason}`]
    );

    return res.json({ success: true, points_delta: pointsDelta });
  } catch (error) {
    logger.error('Admin reward adjustment failed:', error);
    return res.status(500).json({ error: 'Failed to adjust rewards' });
  }
});

module.exports = router;
