const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const logger = require('../services/logger');
const { ensureSupportSchema } = require('../utils/supportSchema');
const {
  getSupportGovernanceConfig,
  setSupportGovernanceConfig,
  normalizeGovernanceConfig
} = require('../utils/supportGovernance');

const router = express.Router();

router.use(requireAdmin);
router.use(async (_req, _res, next) => {
  try {
    await ensureSupportSchema();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        actor_user_id INTEGER REFERENCES users(id),
        actor_role VARCHAR(40),
        action VARCHAR(120) NOT NULL,
        target_type VARCHAR(80),
        target_id VARCHAR(80),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    next();
  } catch (error) {
    next(error);
  }
});

function getAdminId(req) {
  return Number(req.session.userId || 0);
}

async function writeGovernanceAudit(req, actionType, targetType, targetId, payload = {}) {
  const actorUserId = getAdminId(req);
  const actorRoleRows = await pool.query('SELECT admin_role FROM users WHERE id = $1 LIMIT 1', [actorUserId]);
  const actorRole = actorRoleRows.rows[0]?.admin_role || 'support_admin';

  await pool.query(
    `INSERT INTO support_admin_actions (actor_user_id, action_type, target_type, target_id, notes, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      actorUserId,
      actionType,
      targetType,
      targetId ? Number(targetId) : null,
      payload.notes || null,
      JSON.stringify(payload || {})
    ]
  );

  await pool.query(
    `INSERT INTO admin_audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      actorUserId,
      actorRole,
      `support_governance.${actionType}`,
      targetType,
      targetId ? String(targetId) : null,
      JSON.stringify(payload || {})
    ]
  );
}

function normalizeAction(input) {
  return String(input || '').trim().toLowerCase();
}

router.get('/feature-config', async (_req, res) => {
  try {
    const config = await getSupportGovernanceConfig();
    return res.json({ success: true, config });
  } catch (error) {
    logger.error('Failed to fetch support governance config', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch config' });
  }
});

router.put('/feature-config', async (req, res) => {
  try {
    const nextConfig = normalizeGovernanceConfig(req.body || {});
    const saved = await setSupportGovernanceConfig(nextConfig, getAdminId(req));

    await writeGovernanceAudit(req, 'feature_config_update', 'support_feature_governance', null, {
      config: saved,
      notes: 'Support feature toggles updated'
    });

    return res.json({ success: true, config: saved });
  } catch (error) {
    logger.error('Failed to update support governance config', { error: error.message });
    return res.status(500).json({ error: 'Failed to update config' });
  }
});

router.get('/dashboard', async (_req, res) => {
  try {
    const [counts, helperActivity, highRisk, rewards] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE is_removed = FALSE AND is_hidden = FALSE AND status = 'open')::int AS open_requests,
           COUNT(*) FILTER (WHERE is_removed = FALSE AND is_hidden = FALSE AND status = 'solved')::int AS solved_requests,
           COUNT(*) FILTER (WHERE is_flagged = TRUE AND is_removed = FALSE)::int AS flagged_requests,
           COUNT(*) FILTER (WHERE urgency_level = 'urgent' AND is_removed = FALSE AND is_hidden = FALSE)::int AS urgent_requests,
           COUNT(*) FILTER (WHERE is_priority = TRUE AND is_removed = FALSE)::int AS high_priority_requests,
           COUNT(*) FILTER (WHERE is_featured = TRUE AND is_removed = FALSE)::int AS featured_requests,
           COUNT(*) FILTER (WHERE is_locked = TRUE AND is_removed = FALSE)::int AS locked_requests
         FROM support_requests`
      ),
      pool.query(
        `SELECT
           hr.helper_id,
           u.full_name,
           u.college_name,
           up.branch_id,
           up.semester_id,
           hr.total_answers,
           hr.accepted_answers,
           hr.total_points_earned,
           hr.reputation_level,
           hr.verified_helper
         FROM helper_reputation hr
         INNER JOIN users u ON u.id = hr.helper_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
         ORDER BY hr.total_points_earned DESC, hr.accepted_answers DESC
         LIMIT 12`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE report_type = 'spam' AND status = 'pending')::int AS spam_reports,
           COUNT(*) FILTER (WHERE report_type = 'abuse' AND status = 'pending')::int AS abuse_reports,
           COUNT(*) FILTER (WHERE report_type = 'inappropriate' AND status = 'pending')::int AS inappropriate_reports,
           COUNT(*) FILTER (WHERE report_type = 'low-quality' AND status = 'pending')::int AS quality_reports,
           COUNT(*) FILTER (WHERE status = 'pending')::int AS total_pending_reports
         FROM support_moderation_queue`
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS reward_events_count,
           COALESCE(SUM(points_delta), 0)::int AS net_points_delta,
           COUNT(*) FILTER (WHERE points_delta < 0)::int AS penalties,
           COUNT(*) FILTER (WHERE points_delta > 0)::int AS bonuses
         FROM support_reward_events
         WHERE created_at > NOW() - INTERVAL '30 days'`
      )
    ]);

    return res.json({
      success: true,
      kpis: {
        ...(counts.rows[0] || {}),
        ...(highRisk.rows[0] || {}),
        ...(rewards.rows[0] || {})
      },
      highValueHelpers: helperActivity.rows
    });
  } catch (error) {
    logger.error('Failed to fetch support governance dashboard', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

router.get('/threads', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const flaggedOnly = String(req.query.flaggedOnly || '').trim() === 'true';
    const urgentOnly = String(req.query.urgentOnly || '').trim() === 'true';
    const branchId = Number(req.query.branchId || 0);
    const semesterId = Number(req.query.semesterId || 0);
    const search = String(req.query.search || '').trim();
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));

    const params = [];
    let where = 'WHERE 1=1';

    if (['open', 'in_progress', 'solved'].includes(status)) {
      params.push(status);
      where += ` AND sr.status = $${params.length}`;
    }
    if (flaggedOnly) {
      where += ' AND (sr.is_flagged = TRUE OR sr.flagged_link_risk = TRUE OR sr.flagged_attachment_risk = TRUE)';
    }
    if (urgentOnly) {
      where += " AND sr.urgency_level = 'urgent'";
    }
    if (branchId > 0) {
      params.push(branchId);
      where += ` AND sr.branch_id = $${params.length}`;
    }
    if (semesterId > 0) {
      params.push(semesterId);
      where += ` AND sr.semester_id = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (sr.title ILIKE $${params.length} OR sr.description ILIKE $${params.length} OR COALESCE(sr.subject, '') ILIKE $${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT
         sr.id,
         sr.title,
         sr.description,
         sr.request_category,
         sr.subject,
         sr.urgency_level,
         sr.status,
         sr.is_flagged,
         sr.flagged_link_risk,
         sr.flagged_attachment_risk,
         sr.is_hidden,
         sr.is_removed,
         sr.is_locked,
         sr.is_priority,
         sr.is_featured,
         sr.meet_link,
         sr.attachment_urls,
         sr.image_urls,
         sr.created_at,
         requester.id AS requester_id,
         requester.full_name AS requester_name,
         requester.college_name,
         requester.email AS requester_email,
         up.branch_id,
         up.semester_id,
         COUNT(sa.id)::int AS answer_count,
         COUNT(sa.id) FILTER (WHERE sa.is_flagged = TRUE)::int AS flagged_answers,
         COUNT(sa.id) FILTER (WHERE sa.is_removed = TRUE)::int AS removed_answers,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT helper.full_name), NULL) AS helper_names
       FROM support_requests sr
       INNER JOIN users requester ON requester.id = sr.user_id
       LEFT JOIN user_profiles up ON up.user_id = requester.id
       LEFT JOIN support_answers sa ON sa.request_id = sr.id
       LEFT JOIN users helper ON helper.id = sa.answerer_id
       ${where}
       GROUP BY sr.id, requester.id, up.branch_id, up.semester_id
       ORDER BY sr.is_priority DESC, sr.urgency_level DESC, sr.created_at DESC
       LIMIT ${limit}`,
      params
    );

    return res.json({ success: true, threads: rows });
  } catch (error) {
    logger.error('Failed to fetch moderated support threads', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch threads' });
  }
});

router.post('/threads/:requestId/action', async (req, res) => {
  try {
    const requestId = Number(req.params.requestId || 0);
    const action = normalizeAction(req.body?.action);
    const notes = String(req.body?.notes || '').trim();
    const reason = String(req.body?.reason || '').trim();

    const { rows: foundRows } = await pool.query('SELECT id FROM support_requests WHERE id = $1 LIMIT 1', [requestId]);
    if (!foundRows.length) return res.status(404).json({ error: 'Request not found' });

    let updateQuery = null;
    const actorId = getAdminId(req);

    if (action === 'hide') {
      updateQuery = [`UPDATE support_requests SET is_hidden = TRUE, hidden_by = $2, hidden_at = NOW(), updated_at = NOW() WHERE id = $1`, [requestId, actorId]];
    } else if (action === 'unhide' || action === 'restore_visibility') {
      updateQuery = [`UPDATE support_requests SET is_hidden = FALSE, hidden_by = NULL, hidden_at = NULL, updated_at = NOW() WHERE id = $1`, [requestId]];
    } else if (action === 'remove') {
      updateQuery = [`UPDATE support_requests SET is_removed = TRUE, removed_by = $2, removed_at = NOW(), updated_at = NOW() WHERE id = $1`, [requestId, actorId]];
    } else if (action === 'restore') {
      updateQuery = [`UPDATE support_requests SET is_removed = FALSE, removed_by = NULL, removed_at = NULL, updated_at = NOW() WHERE id = $1`, [requestId]];
    } else if (action === 'lock_thread') {
      updateQuery = [`UPDATE support_requests SET is_locked = TRUE, locked_by = $2, locked_at = NOW(), updated_at = NOW() WHERE id = $1`, [requestId, actorId]];
    } else if (action === 'unlock_thread') {
      updateQuery = [`UPDATE support_requests SET is_locked = FALSE, locked_by = NULL, locked_at = NULL, updated_at = NOW() WHERE id = $1`, [requestId]];
    } else if (action === 'reopen') {
      updateQuery = [`UPDATE support_requests SET status = 'open', solved_at = NULL, updated_at = NOW() WHERE id = $1`, [requestId]];
    } else if (action === 'mark_priority') {
      updateQuery = [`UPDATE support_requests SET is_priority = TRUE, priority_reason = $2, updated_at = NOW() WHERE id = $1`, [requestId, reason || notes || 'Marked by admin']];
    } else if (action === 'clear_priority') {
      updateQuery = [`UPDATE support_requests SET is_priority = FALSE, priority_reason = NULL, updated_at = NOW() WHERE id = $1`, [requestId]];
    } else if (action === 'feature') {
      updateQuery = [`UPDATE support_requests SET is_featured = TRUE, featured_by = $2, featured_at = NOW(), updated_at = NOW() WHERE id = $1`, [requestId, actorId]];
    } else if (action === 'unfeature') {
      updateQuery = [`UPDATE support_requests SET is_featured = FALSE, featured_by = NULL, featured_at = NULL, updated_at = NOW() WHERE id = $1`, [requestId]];
    } else if (action === 'mark_abuse' || action === 'mark_spam') {
      updateQuery = [`UPDATE support_requests SET is_flagged = TRUE, abuse_reason = $2, updated_at = NOW() WHERE id = $1`, [requestId, reason || notes || action]];
    } else {
      return res.status(400).json({ error: 'Unsupported action' });
    }

    await pool.query(updateQuery[0], updateQuery[1]);

    await writeGovernanceAudit(req, `thread_${action}`, 'support_request', requestId, {
      reason,
      notes
    });

    const { rows: requestOwner } = await pool.query('SELECT user_id FROM support_requests WHERE id = $1 LIMIT 1', [requestId]);
    if (requestOwner.length && ['hide', 'remove', 'lock_thread', 'mark_abuse', 'mark_spam', 'restore', 'unhide', 'unlock_thread', 'reopen'].includes(action)) {
      const message = `Admin moderation update on your support request: ${action.replace('_', ' ')}`;
      await pool.query(
        `INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, 'support_moderation')`,
        [requestOwner[0].user_id, message]
      );
    }

    return res.json({ success: true, action });
  } catch (error) {
    logger.error('Failed to execute support thread action', { error: error.message });
    return res.status(500).json({ error: 'Failed to perform action' });
  }
});

router.post('/answers/:answerId/action', async (req, res) => {
  try {
    const answerId = Number(req.params.answerId || 0);
    const action = normalizeAction(req.body?.action);
    const notes = String(req.body?.notes || '').trim();
    const reason = String(req.body?.reason || '').trim();

    const { rows: answerRows } = await pool.query(
      'SELECT id, answerer_id FROM support_answers WHERE id = $1 LIMIT 1',
      [answerId]
    );
    if (!answerRows.length) return res.status(404).json({ error: 'Answer not found' });

    const actorId = getAdminId(req);
    let updateQuery = null;

    if (action === 'hide') {
      updateQuery = [`UPDATE support_answers SET is_hidden = TRUE, hidden_by = $2, hidden_at = NOW(), updated_at = NOW() WHERE id = $1`, [answerId, actorId]];
    } else if (action === 'unhide') {
      updateQuery = [`UPDATE support_answers SET is_hidden = FALSE, hidden_by = NULL, hidden_at = NULL, updated_at = NOW() WHERE id = $1`, [answerId]];
    } else if (action === 'remove') {
      updateQuery = [`UPDATE support_answers SET is_removed = TRUE, removed_by = $2, removed_at = NOW(), updated_at = NOW() WHERE id = $1`, [answerId, actorId]];
    } else if (action === 'restore') {
      updateQuery = [`UPDATE support_answers SET is_removed = FALSE, removed_by = NULL, removed_at = NULL, updated_at = NOW() WHERE id = $1`, [answerId]];
    } else if (action === 'mark_abuse' || action === 'mark_spam') {
      updateQuery = [`UPDATE support_answers SET is_flagged = TRUE, abuse_reason = $2, updated_at = NOW() WHERE id = $1`, [answerId, reason || notes || action]];
    } else {
      return res.status(400).json({ error: 'Unsupported action' });
    }

    await pool.query(updateQuery[0], updateQuery[1]);

    await writeGovernanceAudit(req, `answer_${action}`, 'support_answer', answerId, { reason, notes });

    await pool.query(
      `INSERT INTO notifications (user_id, message, kind)
       VALUES ($1, $2, 'support_moderation')`,
      [answerRows[0].answerer_id, `Admin moderation update on your support answer: ${action.replace('_', ' ')}`]
    );

    return res.json({ success: true, action });
  } catch (error) {
    logger.error('Failed to execute support answer action', { error: error.message });
    return res.status(500).json({ error: 'Failed to perform action' });
  }
});

router.post('/rewards/adjust', async (req, res) => {
  try {
    const helperUserId = Number(req.body?.helperUserId || 0);
    const pointsDelta = Number(req.body?.pointsDelta || 0);
    const reason = String(req.body?.reason || '').trim();
    const eventType = String(req.body?.eventType || 'admin_adjust').trim();

    if (!helperUserId || !Number.isInteger(pointsDelta) || pointsDelta === 0 || pointsDelta < -500 || pointsDelta > 500) {
      return res.status(400).json({ error: 'Invalid helperUserId or pointsDelta' });
    }
    if (reason.length < 3) {
      return res.status(400).json({ error: 'Reason is required for reward adjustment' });
    }

    await pool.query(
      `INSERT INTO helper_reputation (helper_id, total_points_earned)
       VALUES ($1, 0)
       ON CONFLICT (helper_id) DO NOTHING`,
      [helperUserId]
    );

    await pool.query(
      `UPDATE helper_reputation
       SET total_points_earned = GREATEST(total_points_earned + $1, 0), updated_at = NOW()
       WHERE helper_id = $2`,
      [pointsDelta, helperUserId]
    );

    await pool.query(
      `UPDATE user_profiles
       SET support_points_earned = GREATEST(COALESCE(support_points_earned, 0) + $1, 0)
       WHERE user_id = $2`,
      [pointsDelta, helperUserId]
    );

    await pool.query(
      `INSERT INTO support_reward_events (helper_user_id, actor_user_id, points_delta, reason, event_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [helperUserId, getAdminId(req), pointsDelta, reason, eventType]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, message, kind)
       VALUES ($1, $2, 'support_reward_adjusted')`,
      [helperUserId, `Admin adjusted your support points: ${pointsDelta > 0 ? '+' : ''}${pointsDelta}. Reason: ${reason}`]
    );

    await writeGovernanceAudit(req, 'reward_adjust', 'helper_user', helperUserId, {
      pointsDelta,
      reason,
      eventType
    });

    return res.json({ success: true, helperUserId, pointsDelta });
  } catch (error) {
    logger.error('Failed to adjust support rewards', { error: error.message });
    return res.status(500).json({ error: 'Failed to adjust rewards' });
  }
});

router.get('/rewards/history', async (req, res) => {
  try {
    const helperUserId = Number(req.query.helperUserId || 0);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 80)));

    const params = [];
    let where = 'WHERE 1=1';
    if (helperUserId > 0) {
      params.push(helperUserId);
      where += ` AND sre.helper_user_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT
         sre.id,
         sre.helper_user_id,
         helper.full_name AS helper_name,
         sre.actor_user_id,
         actor.full_name AS actor_name,
         sre.points_delta,
         sre.reason,
         sre.event_type,
         sre.request_id,
         sre.answer_id,
         sre.created_at
       FROM support_reward_events sre
       INNER JOIN users helper ON helper.id = sre.helper_user_id
       LEFT JOIN users actor ON actor.id = sre.actor_user_id
       ${where}
       ORDER BY sre.created_at DESC
       LIMIT ${limit}`,
      params
    );

    return res.json({ success: true, events: rows });
  } catch (error) {
    logger.error('Failed to fetch support reward history', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch reward history' });
  }
});

router.post('/helpers/:helperUserId/trust', async (req, res) => {
  try {
    const helperUserId = Number(req.params.helperUserId || 0);
    const trustLevelRaw = String(req.body?.trustLevel || '').trim().toLowerCase();
    const verifiedContributor = Boolean(req.body?.verifiedContributor);
    const suspend = Boolean(req.body?.suspend);
    const suspensionReason = String(req.body?.suspensionReason || '').trim();
    const suspendedUntil = req.body?.suspendedUntil ? new Date(req.body.suspendedUntil) : null;

    const trustLevelMap = {
      new_helper: 'New Helper',
      trusted_helper: 'Trusted Helper',
      top_academic_helper: 'Top Academic Helper',
      verified_support_contributor: 'Verified Support Contributor'
    };

    if (!helperUserId) return res.status(400).json({ error: 'Invalid helper user id' });
    if (trustLevelRaw && !trustLevelMap[trustLevelRaw]) {
      return res.status(400).json({ error: 'Invalid trust level' });
    }

    const nextBadge = trustLevelMap[trustLevelRaw] || 'New Helper';

    await pool.query(
      `INSERT INTO support_helper_controls (
         helper_user_id, trust_level, trust_badge, is_verified_contributor, is_suspended,
         suspended_until, suspension_reason, updated_by, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (helper_user_id)
       DO UPDATE SET
         trust_level = EXCLUDED.trust_level,
         trust_badge = EXCLUDED.trust_badge,
         is_verified_contributor = EXCLUDED.is_verified_contributor,
         is_suspended = EXCLUDED.is_suspended,
         suspended_until = EXCLUDED.suspended_until,
         suspension_reason = EXCLUDED.suspension_reason,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [
        helperUserId,
        trustLevelRaw || 'new_helper',
        nextBadge,
        verifiedContributor,
        suspend,
        suspendedUntil && !Number.isNaN(suspendedUntil.getTime()) ? suspendedUntil : null,
        suspend ? suspensionReason || 'Suspended by admin' : null,
        getAdminId(req)
      ]
    );

    await pool.query(
      `UPDATE users
       SET
         helper_level = $1,
         support_suspended = $2,
         support_suspended_until = $3,
         support_suspend_reason = $4
       WHERE id = $5`,
      [
        nextBadge,
        suspend,
        suspend && suspendedUntil && !Number.isNaN(suspendedUntil.getTime()) ? suspendedUntil : null,
        suspend ? suspensionReason || 'Suspended by admin' : null,
        helperUserId
      ]
    );

    await pool.query(
      `UPDATE helper_reputation
       SET reputation_level = $1, verified_helper = $2, verification_badge = $3, updated_at = NOW()
       WHERE helper_id = $4`,
      [nextBadge, verifiedContributor, verifiedContributor ? 'Verified Support Contributor' : null, helperUserId]
    );

    await pool.query(
      `UPDATE user_profiles
       SET helper_badge = $1
       WHERE user_id = $2`,
      [nextBadge, helperUserId]
    );

    const notice = suspend
      ? `Support participation has been suspended by admin. Reason: ${suspensionReason || 'Policy violation'}`
      : `Your helper trust profile was updated to ${nextBadge}.`;

    await pool.query(
      `INSERT INTO notifications (user_id, message, kind)
       VALUES ($1, $2, 'support_helper_governance')`,
      [helperUserId, notice]
    );

    await writeGovernanceAudit(req, 'helper_trust_update', 'helper_user', helperUserId, {
      trustLevel: trustLevelRaw || 'new_helper',
      trustBadge: nextBadge,
      verifiedContributor,
      suspend,
      suspensionReason,
      suspendedUntil: suspendedUntil && !Number.isNaN(suspendedUntil.getTime()) ? suspendedUntil.toISOString() : null
    });

    return res.json({ success: true, helperUserId, trustLevel: trustLevelRaw || 'new_helper', suspend });
  } catch (error) {
    logger.error('Failed to update helper trust control', { error: error.message });
    return res.status(500).json({ error: 'Failed to update helper trust' });
  }
});

router.get('/helpers/:helperUserId/history', async (req, res) => {
  try {
    const helperUserId = Number(req.params.helperUserId || 0);
    if (!helperUserId) return res.status(400).json({ error: 'Invalid helper user id' });

    const [summary, rewards, quality, controls] = await Promise.all([
      pool.query(
        `SELECT hr.*, u.full_name, u.email, u.college_name, up.branch_id, up.semester_id
         FROM helper_reputation hr
         INNER JOIN users u ON u.id = hr.helper_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
         WHERE hr.helper_id = $1
         LIMIT 1`,
        [helperUserId]
      ),
      pool.query(
        `SELECT id, points_delta, reason, event_type, request_id, answer_id, created_at
         FROM support_reward_events
         WHERE helper_user_id = $1
         ORDER BY created_at DESC
         LIMIT 80`,
        [helperUserId]
      ),
      pool.query(
        `SELECT id, metric_type, metric_value, metric_reason, created_at
         FROM support_quality_metrics
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 80`,
        [helperUserId]
      ),
      pool.query(
        `SELECT * FROM support_helper_controls WHERE helper_user_id = $1 LIMIT 1`,
        [helperUserId]
      )
    ]);

    return res.json({
      success: true,
      summary: summary.rows[0] || null,
      rewards: rewards.rows,
      qualityHistory: quality.rows,
      control: controls.rows[0] || null
    });
  } catch (error) {
    logger.error('Failed to fetch helper governance history', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch helper history' });
  }
});

router.get('/isolation/anomalies', async (_req, res) => {
  try {
    const [requestAnomalies, answerAnomalies] = await Promise.all([
      pool.query(
        `SELECT
           sr.id,
           sr.user_id,
           sr.category_id,
           sr.branch_id,
           sr.semester_id,
           up.category_id AS profile_category_id,
           up.branch_id AS profile_branch_id,
           up.semester_id AS profile_semester_id,
           u.full_name,
           u.college_name,
           sr.created_at
         FROM support_requests sr
         INNER JOIN users u ON u.id = sr.user_id
         LEFT JOIN user_profiles up ON up.user_id = sr.user_id
         WHERE (up.category_id IS DISTINCT FROM sr.category_id
            OR up.branch_id IS DISTINCT FROM sr.branch_id
            OR up.semester_id IS DISTINCT FROM sr.semester_id)
         ORDER BY sr.created_at DESC
         LIMIT 200`
      ),
      pool.query(
        `SELECT
           sa.id,
           sa.request_id,
           sa.answerer_id,
           sa.category_id,
           sa.branch_id,
           sa.semester_id,
           up.category_id AS profile_category_id,
           up.branch_id AS profile_branch_id,
           up.semester_id AS profile_semester_id,
           u.full_name,
           sa.created_at
         FROM support_answers sa
         INNER JOIN users u ON u.id = sa.answerer_id
         LEFT JOIN user_profiles up ON up.user_id = sa.answerer_id
         WHERE (up.category_id IS DISTINCT FROM sa.category_id
            OR up.branch_id IS DISTINCT FROM sa.branch_id
            OR up.semester_id IS DISTINCT FROM sa.semester_id)
         ORDER BY sa.created_at DESC
         LIMIT 200`
      )
    ]);

    return res.json({
      success: true,
      requestAnomalies: requestAnomalies.rows,
      answerAnomalies: answerAnomalies.rows,
      counts: {
        requestAnomalies: requestAnomalies.rowCount,
        answerAnomalies: answerAnomalies.rowCount
      }
    });
  } catch (error) {
    logger.error('Failed to fetch isolation anomalies', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch isolation anomalies' });
  }
});

router.get('/safety/link-risk', async (_req, res) => {
  try {
    const [meetUsage, repeatedMeetLinks, attachmentRisk] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE meet_link IS NOT NULL)::int AS total_meet_links,
           COUNT(*) FILTER (WHERE flagged_link_risk = TRUE)::int AS flagged_meet_links
         FROM support_requests`
      ),
      pool.query(
        `SELECT meet_link, COUNT(*)::int AS usage_count
         FROM support_requests
         WHERE meet_link IS NOT NULL
         GROUP BY meet_link
         HAVING COUNT(*) >= 4
         ORDER BY usage_count DESC
         LIMIT 80`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(attachment_urls, '[]'::jsonb)) > 0)::int AS requests_with_attachments,
           COUNT(*) FILTER (WHERE flagged_attachment_risk = TRUE)::int AS flagged_attachment_requests,
           COUNT(*) FILTER (WHERE jsonb_array_length(COALESCE(image_urls, '[]'::jsonb)) > 0)::int AS requests_with_images
         FROM support_requests`
      )
    ]);

    return res.json({
      success: true,
      meetUsage: meetUsage.rows[0],
      repeatedMeetLinks: repeatedMeetLinks.rows,
      attachmentRisk: attachmentRisk.rows[0]
    });
  } catch (error) {
    logger.error('Failed to fetch support safety metrics', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch safety metrics' });
  }
});

router.get('/analytics/overview', async (_req, res) => {
  try {
    const [subjectDemand, topicDemand, resolution, branchDemand, helperTrend, abuseTrend] = await Promise.all([
      pool.query(
        `SELECT COALESCE(subject, 'General') AS subject, COUNT(*)::int AS request_count
         FROM support_requests
         WHERE is_removed = FALSE
         GROUP BY COALESCE(subject, 'General')
         ORDER BY request_count DESC
         LIMIT 20`
      ),
      pool.query(
        `SELECT request_category AS topic, COUNT(*)::int AS request_count
         FROM support_requests
         WHERE is_removed = FALSE
         GROUP BY request_category
         ORDER BY request_count DESC
         LIMIT 20`
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_requests,
           COUNT(*) FILTER (WHERE status = 'solved')::int AS solved_requests,
           ROUND(
             CASE WHEN COUNT(*) = 0 THEN 0
             ELSE (COUNT(*) FILTER (WHERE status = 'solved')::numeric / COUNT(*)::numeric) * 100
             END,
             2
           ) AS resolution_rate
         FROM support_requests
         WHERE is_removed = FALSE`
      ),
      pool.query(
        `SELECT
           sr.branch_id,
           sr.semester_id,
           COUNT(*)::int AS request_count,
           COUNT(*) FILTER (WHERE sr.status = 'solved')::int AS solved_count
         FROM support_requests sr
         WHERE sr.is_removed = FALSE
         GROUP BY sr.branch_id, sr.semester_id
         ORDER BY request_count DESC
         LIMIT 60`
      ),
      pool.query(
        `SELECT
           DATE_TRUNC('week', created_at)::date AS week,
           COUNT(*)::int AS answers_count,
           COUNT(*) FILTER (WHERE is_accepted = TRUE)::int AS accepted_count
         FROM support_answers
         WHERE created_at > NOW() - INTERVAL '180 days'
         GROUP BY DATE_TRUNC('week', created_at)
         ORDER BY week DESC
         LIMIT 26`
      ),
      pool.query(
        `SELECT
           DATE_TRUNC('week', created_at)::date AS week,
           COUNT(*)::int AS reports_count,
           COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
         FROM support_moderation_queue
         WHERE created_at > NOW() - INTERVAL '180 days'
         GROUP BY DATE_TRUNC('week', created_at)
         ORDER BY week DESC
         LIMIT 26`
      )
    ]);

    return res.json({
      success: true,
      subjectDemand: subjectDemand.rows,
      topicDemand: topicDemand.rows,
      resolution: resolution.rows[0],
      branchDemand: branchDemand.rows,
      helperTrend: helperTrend.rows,
      abuseTrend: abuseTrend.rows
    });
  } catch (error) {
    logger.error('Failed to fetch support analytics', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.get('/activity/audit', async (req, res) => {
  try {
    const limit = Math.min(300, Math.max(1, Number(req.query.limit || 120)));
    const { rows } = await pool.query(
      `SELECT
         saa.id,
         saa.actor_user_id,
         actor.full_name AS actor_name,
         saa.action_type,
         saa.target_type,
         saa.target_id,
         saa.notes,
         saa.payload,
         saa.created_at
       FROM support_admin_actions saa
       LEFT JOIN users actor ON actor.id = saa.actor_user_id
       ORDER BY saa.created_at DESC
       LIMIT ${limit}`
    );
    return res.json({ success: true, audits: rows });
  } catch (error) {
    logger.error('Failed to fetch support governance audit', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
