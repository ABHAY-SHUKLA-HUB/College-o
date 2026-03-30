const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');
const {
  ensureCampusFeedSchema,
  normalizePostType,
  normalizeCategory,
  normalizeCampusRole,
  normalizeTags,
  adjustCreatorPoints,
  createNotification,
  refreshPostQuality,
  updateCreatorProfile
} = require('../services/campusFeedService');
const { publishRealtimeEvent } = require('../services/realtimeBus');

const router = express.Router();

const mediaUpload = createUploadMiddleware({
  maxFileSize: 25 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'],
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov'],
  invalidTypeMessage: 'Only image/video uploads are allowed'
});

function moderationRiskLabel(trustLevel, approvedPosts, securityFlags) {
  if (Number(securityFlags || 0) >= 3) return 'high';
  if (trustLevel === 'verified') return 'low';
  if (trustLevel === 'trusted') return Number(approvedPosts || 0) >= 10 ? 'low' : 'medium';
  return 'high';
}

function normalizeTrustLevel(value) {
  const allowed = new Set(['new', 'trusted', 'verified']);
  const next = String(value || '').trim().toLowerCase();
  return allowed.has(next) ? next : null;
}

router.get('/moderation', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();

  const status = String(req.query.status || 'pending').toLowerCase();
  const search = String(req.query.search || '').trim();
  const collegeId = Number(req.query.collegeId || 0);
  const limit = Math.min(Math.max(Number(req.query.limit || 80), 10), 200);

  const params = [];
  const where = [];

  if (['pending', 'approved', 'rejected'].includes(status)) {
    params.push(status);
    where.push(`p.moderation_status = $${params.length}`);
  } else if (status === 'featured') {
    where.push(`p.moderation_status = 'approved'`);
    where.push(`p.is_featured = TRUE`);
  } else if (status === 'flagged') {
    where.push(`(
      (SELECT COUNT(*) FROM student_feed_reports r3 WHERE r3.post_id = p.id AND r3.status = 'pending') > 0
      OR (SELECT COUNT(*) FROM student_feed_security_events se3 WHERE se3.post_id = p.id AND se3.created_at >= NOW() - INTERVAL '7 days') > 0
      OR COALESCE(p.low_quality_penalty, 0) >= 8
    )`);
  }

  if (Number.isInteger(collegeId) && collegeId > 0) {
    params.push(collegeId);
    where.push(`p.college_id = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    where.push(`(
      p.title ILIKE $${params.length}
      OR p.description ILIKE $${params.length}
      OR u.full_name ILIKE $${params.length}
      OR c.name ILIKE $${params.length}
    )`);
  }

  params.push(limit);
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.description, p.post_type, p.category, p.tags, p.media_url, p.media_type,
            p.poll_options, p.poll_ends_at,
            p.event_starts_at, p.event_venue, p.is_urgent, p.moderation_status, p.moderation_reason,
            p.admin_notes,
            p.created_at, p.updated_at, p.like_count, p.comment_count, p.share_count, p.save_count,
            p.quality_score, p.retention_score, p.low_quality_penalty,
            p.is_featured, p.points_earned,
            u.id AS author_id, u.full_name AS author_name, u.email AS author_email,
            c.id AS college_id, c.name AS college_name,
            COALESCE(cp.trust_level, 'new') AS trust_level,
            COALESCE(cp.campus_role, 'regular_student') AS campus_role,
            COALESCE(cp.total_points, 0) AS creator_points,
            COALESCE(cp.approved_posts, 0) AS approved_posts,
            COALESCE(cp.rejected_posts, 0) AS rejected_posts,
            COALESCE(cp.posting_suspended, FALSE) AS posting_suspended,
            cp.suspension_reason,
            cp.suspended_until,
            (
              SELECT COUNT(*)::int
              FROM student_feed_reports r
              WHERE r.post_id = p.id
                AND r.status = 'pending'
            ) AS pending_reports,
            (
              SELECT COUNT(*)::int
              FROM student_feed_security_events se
              WHERE se.post_id = p.id
                AND se.created_at >= NOW() - INTERVAL '7 days'
            ) AS security_flags
     FROM student_feed_posts p
     JOIN users u ON u.id = p.user_id
     JOIN colleges c ON c.id = p.college_id
     LEFT JOIN student_feed_creator_profiles cp ON cp.user_id = p.user_id
     ${whereClause}
     ORDER BY
       CASE WHEN p.moderation_status = 'pending' THEN 0 ELSE 1 END,
       CASE WHEN (SELECT COUNT(*) FROM student_feed_reports r2 WHERE r2.post_id = p.id AND r2.status = 'pending') >= 3 THEN 0 ELSE 1 END,
       p.is_urgent DESC,
       p.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  const posts = rows.map((post) => ({
    ...post,
    moderation_risk: moderationRiskLabel(post.trust_level, Number(post.approved_posts || 0), Number(post.security_flags || 0))
  }));

  const collegeRows = await pool.query('SELECT id, name FROM colleges ORDER BY name ASC');

  res.json({ posts, colleges: collegeRows.rows });
});

router.post('/posts/:id/moderate', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  const action = String(req.body.action || '').toLowerCase();
  const reason = String(req.body.reason || '').trim() || null;

  if (!Number.isInteger(postId) || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Invalid moderation request' });
  }

  const postRes = await pool.query(
    'SELECT * FROM student_feed_posts WHERE id = $1 LIMIT 1',
    [postId]
  );
  const post = postRes.rows[0];
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const nextStatus = action === 'approve' ? 'approved' : 'rejected';

  const updated = await pool.query(
    `UPDATE student_feed_posts
     SET moderation_status = $2,
         moderation_reason = $3,
         moderated_by = $4,
         moderated_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [postId, nextStatus, reason, req.session.userId]
  );

  const row = updated.rows[0];

  if (nextStatus === 'approved') {
    await createNotification(
      row.user_id,
      'campus_post_approved',
      `Your campus post \"${row.title}\" has been approved and is now live.`
    );
  } else {
    await createNotification(
      row.user_id,
      'campus_post_rejected',
      `Your campus post \"${row.title}\" was rejected.${reason ? ` Reason: ${reason}` : ''}`
    );
  }

  await refreshPostQuality(postId);
  await updateCreatorProfile(row.user_id, row.college_id);

  publishRealtimeEvent('campus_post_moderated', {
    collegeId: row.college_id,
    postId,
    status: nextStatus,
    userId: row.user_id
  });

  return res.json({ message: `Post ${nextStatus} successfully`, post: row });
});

router.post('/posts/:id/feature', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  const isFeatured = Boolean(req.body.isFeatured);

  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const { rows } = await pool.query(
    `UPDATE student_feed_posts
     SET is_featured = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [postId, isFeatured]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Post not found' });

  if (isFeatured) {
    await createNotification(
      rows[0].user_id,
      'campus_post_featured',
      `Your post \"${rows[0].title}\" has been featured by campus admins.`
    );
  }

  publishRealtimeEvent('campus_post_featured', {
    collegeId: rows[0].college_id,
    postId,
    isFeatured,
    userId: rows[0].user_id
  });

  return res.json({ post: rows[0], message: isFeatured ? 'Post featured' : 'Post unfeatured' });
});

router.put('/posts/:id', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const fields = [];
  const values = [postId];

  const title = req.body.title == null ? null : String(req.body.title).trim();
  const description = req.body.description == null ? null : String(req.body.description).trim();
  const postType = req.body.postType == null ? null : normalizePostType(req.body.postType);
  const category = req.body.category == null ? null : normalizeCategory(req.body.category);
  const tags = req.body.tags == null ? null : normalizeTags(Array.isArray(req.body.tags) ? req.body.tags : String(req.body.tags).split(',').map((x) => x.trim()));
  const adminNotes = req.body.adminNotes == null ? null : String(req.body.adminNotes).trim();

  if (req.body.title != null) {
    if (!title) return res.status(400).json({ error: 'title cannot be empty' });
    values.push(title);
    fields.push(`title = $${values.length}`);
  }
  if (req.body.description != null) {
    if (!description) return res.status(400).json({ error: 'description cannot be empty' });
    values.push(description);
    fields.push(`description = $${values.length}`);
  }
  if (req.body.postType != null) {
    if (!postType) return res.status(400).json({ error: 'Invalid postType' });
    values.push(postType);
    fields.push(`post_type = $${values.length}`);
  }
  if (req.body.category != null) {
    if (!category) return res.status(400).json({ error: 'Invalid category' });
    values.push(category);
    fields.push(`category = $${values.length}`);
  }
  if (req.body.tags != null) {
    values.push(JSON.stringify(tags));
    fields.push(`tags = $${values.length}::jsonb`);
  }
  if (req.body.isUrgent != null) {
    values.push(Boolean(req.body.isUrgent));
    fields.push(`is_urgent = $${values.length}`);
  }
  if (req.body.eventVenue != null) {
    values.push(String(req.body.eventVenue || '').trim() || null);
    fields.push(`event_venue = $${values.length}`);
  }
  if (req.body.eventStartsAt != null) {
    const dt = req.body.eventStartsAt ? new Date(req.body.eventStartsAt) : null;
    values.push(dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : null);
    fields.push(`event_starts_at = $${values.length}`);
  }
  if (req.body.adminNotes != null) {
    values.push(adminNotes || null);
    fields.push(`admin_notes = $${values.length}`);
  }

  if (!fields.length) return res.status(400).json({ error: 'No valid fields to update' });

  fields.push('updated_at = NOW()');
  values.push(req.session.userId);
  fields.push(`moderated_by = $${values.length}`);

  const updated = await pool.query(
    `UPDATE student_feed_posts
     SET ${fields.join(', ')}
     WHERE id = $1
     RETURNING *`,
    values
  );

  if (!updated.rows[0]) return res.status(404).json({ error: 'Post not found' });
  return res.json({ message: 'Post updated successfully', post: updated.rows[0] });
});

router.post('/posts/:id/mark-official', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const isOfficial = req.body.isOfficial === true || req.body.isOfficial === 'true';
  const isImportant = req.body.isImportant === true || req.body.isImportant === 'true';

  const updated = await pool.query(
    `UPDATE student_feed_posts
     SET category = CASE WHEN $2 THEN 'official' ELSE category END,
         post_type = CASE WHEN $2 THEN 'official' ELSE post_type END,
         is_urgent = CASE WHEN $3 THEN TRUE ELSE is_urgent END,
         moderation_status = CASE WHEN moderation_status = 'rejected' THEN 'pending' ELSE moderation_status END,
         moderation_reason = CASE
           WHEN $2 OR $3 THEN COALESCE(moderation_reason, 'Escalated by admin moderation controls')
           ELSE moderation_reason
         END,
         moderated_by = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [postId, isOfficial, isImportant, req.session.userId]
  );

  if (!updated.rows[0]) return res.status(404).json({ error: 'Post not found' });
  await createNotification(
    updated.rows[0].user_id,
    'campus_post_escalated',
    `Your post "${updated.rows[0].title}" was escalated by campus moderators.`
  );

  return res.json({ message: 'Post escalation updated', post: updated.rows[0] });
});

router.get('/reports', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();
  const status = String(req.query.status || 'pending').toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit || 120), 10), 300);

  const params = [];
  let where = '';

  if (['pending', 'resolved', 'dismissed'].includes(status)) {
    params.push(status);
    where = `WHERE r.status = $${params.length}`;
  }

  params.push(limit);

  const { rows } = await pool.query(
    `SELECT r.id, r.post_id, r.reason, r.details, r.status, r.created_at,
            r.reporter_user_id, reporter.full_name AS reporter_name,
            p.title AS post_title, p.college_id, c.name AS college_name,
            post_author.full_name AS post_author_name
     FROM student_feed_reports r
     JOIN student_feed_posts p ON p.id = r.post_id
     JOIN users reporter ON reporter.id = r.reporter_user_id
     JOIN users post_author ON post_author.id = p.user_id
     JOIN colleges c ON c.id = p.college_id
     ${where}
     ORDER BY r.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  res.json({ reports: rows });
});

router.post('/reports/:id/resolve', requireAdmin, async (req, res) => {
  try {
    await ensureCampusFeedSchema();
    const reportId = Number(req.params.id);
    const action = String(req.body.action || 'resolved').toLowerCase();
    const postAction = String(req.body.postAction || 'none').toLowerCase();
    const pointsDelta = Number(req.body.pointsDelta || 0);
    const adminUserId = Number(req.session.userId);

    if (!Number.isInteger(reportId) || !['resolved', 'dismissed'].includes(action)) {
      return res.status(400).json({ error: 'Invalid report resolution request' });
    }
    if (!['none', 'reject', 'approve', 'remove'].includes(postAction)) {
      return res.status(400).json({ error: 'Invalid postAction' });
    }
    if (!Number.isInteger(adminUserId)) {
      return res.status(401).json({ error: 'Admin session is invalid' });
    }
    if (!Number.isInteger(pointsDelta)) {
      return res.status(400).json({ error: 'pointsDelta must be an integer' });
    }

    const reportUpdate = await pool.query(
      `UPDATE student_feed_reports
       SET status = $2,
           reviewed_by = $3::integer,
           reviewed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [reportId, action, adminUserId]
    );

    if (!reportUpdate.rows[0]) return res.status(404).json({ error: 'Report not found' });
    const report = reportUpdate.rows[0];

    if (postAction === 'reject') {
      await pool.query(
        `UPDATE student_feed_posts
         SET moderation_status = 'rejected',
             moderation_reason = COALESCE(moderation_reason, 'Rejected after reports review'),
             moderated_by = $2::integer,
             moderated_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [report.post_id, adminUserId]
      );
    } else if (postAction === 'approve') {
      await pool.query(
        `UPDATE student_feed_posts
         SET moderation_status = 'approved',
             moderated_by = $2::integer,
             moderated_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [report.post_id, adminUserId]
      );
    } else if (postAction === 'remove') {
      await pool.query(
        `UPDATE student_feed_posts
         SET moderation_status = 'approved',
             is_featured = FALSE,
             is_trending = FALSE,
             moderated_by = $2::integer,
             moderated_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [report.post_id, adminUserId]
      );
    }

    if (pointsDelta !== 0) {
      const postRow = await pool.query('SELECT user_id, college_id FROM student_feed_posts WHERE id = $1 LIMIT 1', [report.post_id]);
      if (postRow.rows[0]) {
        await adjustCreatorPoints({
          creatorUserId: postRow.rows[0].user_id,
          collegeId: postRow.rows[0].college_id,
          delta: pointsDelta,
          reason: `Report moderation adjustment (${action})`,
          adminUserId
        });
        await updateCreatorProfile(postRow.rows[0].user_id, postRow.rows[0].college_id);
      }
    }

    return res.json({ message: `Report marked ${action}`, report: reportUpdate.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to resolve report', details: error.message });
  }
});

router.post('/creators/:userId/role', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();
  const creatorUserId = Number(req.params.userId);
  const role = normalizeCampusRole(req.body.role);
  if (!Number.isInteger(creatorUserId) || !role) {
    return res.status(400).json({ error: 'Invalid creator role assignment' });
  }

  const creator = await pool.query(
    `SELECT cp.user_id, cp.college_id
     FROM student_feed_creator_profiles cp
     WHERE cp.user_id = $1`,
    [creatorUserId]
  );
  if (!creator.rows[0]) return res.status(404).json({ error: 'Creator profile not found' });

  const updated = await pool.query(
    `UPDATE student_feed_creator_profiles
     SET campus_role = $2,
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING user_id, campus_role, trust_level, total_points`,
    [creatorUserId, role]
  );

  await createNotification(
    creatorUserId,
    'campus_role_updated',
    `Your campus contributor role was updated to ${role.replace(/_/g, ' ')}.`
  );

  publishRealtimeEvent('campus_creator_role_updated', {
    collegeId: creator.rows[0].college_id,
    userId: creatorUserId,
    role
  });

  return res.json({ creator: updated.rows[0], message: 'Campus role updated' });
});

router.post('/creators/:userId/trust', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();
  const creatorUserId = Number(req.params.userId);
  const trustLevel = normalizeTrustLevel(req.body.trustLevel);
  const campusRole = normalizeCampusRole(req.body.campusRole);

  if (!Number.isInteger(creatorUserId) || (!trustLevel && !campusRole)) {
    return res.status(400).json({ error: 'Invalid trust update payload' });
  }

  const creator = await pool.query('SELECT user_id, college_id FROM student_feed_creator_profiles WHERE user_id = $1 LIMIT 1', [creatorUserId]);
  if (!creator.rows[0]) return res.status(404).json({ error: 'Creator profile not found' });

  const updated = await pool.query(
    `UPDATE student_feed_creator_profiles
     SET trust_level = COALESCE($2, trust_level),
         campus_role = COALESCE($3, campus_role),
         manual_trust_level = COALESCE($2, manual_trust_level),
         manual_campus_role = COALESCE($3, manual_campus_role),
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING user_id, trust_level, campus_role, total_points, posting_suspended`,
    [creatorUserId, trustLevel, campusRole]
  );

  await createNotification(
    creatorUserId,
    'campus_trust_updated',
    `Your creator trust profile was updated by campus moderation controls.`
  );

  return res.json({ message: 'Creator trust updated', creator: updated.rows[0] });
});

router.post('/creators/:userId/suspension', requireAdmin, async (req, res) => {
  try {
    await ensureCampusFeedSchema();
    const creatorUserId = Number(req.params.userId);
    const adminUserId = Number(req.session.userId);
    if (!Number.isInteger(creatorUserId)) return res.status(400).json({ error: 'Invalid creator id' });
    if (!Number.isInteger(adminUserId)) return res.status(401).json({ error: 'Admin session is invalid' });

    const suspend = req.body.suspend === true || req.body.suspend === 'true';
    const reason = String(req.body.reason || '').trim() || null;
    const untilRaw = req.body.until ? new Date(req.body.until) : null;
    const until = untilRaw && !Number.isNaN(untilRaw.getTime()) ? untilRaw.toISOString() : null;

    if (suspend && !reason) {
      return res.status(400).json({ error: 'reason is required when suspend=true' });
    }

    const creator = await pool.query('SELECT user_id, college_id FROM student_feed_creator_profiles WHERE user_id = $1 LIMIT 1', [creatorUserId]);
    if (!creator.rows[0]) return res.status(404).json({ error: 'Creator profile not found' });

    const suspensionReason = suspend ? reason : null;
    const suspendedUntil = suspend ? until : null;
    const suspendedBy = suspend ? adminUserId : null;

    const updated = await pool.query(
      `UPDATE student_feed_creator_profiles
       SET posting_suspended = $2,
           suspension_reason = $3::text,
           suspended_until = $4::timestamp,
           suspended_by = $5::integer,
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, posting_suspended, suspension_reason, suspended_until, suspended_by`,
      [creatorUserId, suspend, suspensionReason, suspendedUntil, suspendedBy]
    );

    await createNotification(
      creatorUserId,
      suspend ? 'campus_posting_suspended' : 'campus_posting_restored',
      suspend
        ? `Your campus posting ability is suspended.${reason ? ` Reason: ${reason}` : ''}`
        : 'Your campus posting access has been restored.'
    );

    return res.json({ message: suspend ? 'Creator suspended' : 'Creator restored', creator: updated.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update creator suspension', details: error.message });
  }
});

router.post('/creators/:userId/points', requireAdmin, async (req, res) => {
  await ensureCampusFeedSchema();
  const creatorUserId = Number(req.params.userId);
  const rawActionType = String(req.body.actionType || '').trim().toLowerCase();
  const amount = Number(req.body.amount);
  const delta = Number(req.body.delta);
  const reason = String(req.body.reason || '').trim() || null;
  const allowedActionTypes = new Set(['add', 'remove', 'bonus', 'fraud_correction']);

  if (!Number.isInteger(creatorUserId)) return res.status(400).json({ error: 'Invalid creator id' });
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  let actionType = rawActionType;
  let finalDelta = delta;

  if (actionType) {
    if (!allowedActionTypes.has(actionType)) {
      return res.status(400).json({ error: 'Invalid actionType. Allowed: add, remove, bonus, fraud_correction' });
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive integer when actionType is provided' });
    }
    finalDelta = (actionType === 'remove' || actionType === 'fraud_correction') ? -Math.abs(amount) : Math.abs(amount);
  } else {
    if (!Number.isInteger(finalDelta) || finalDelta === 0) {
      return res.status(400).json({ error: 'delta must be a non-zero integer when actionType is not provided' });
    }
    actionType = finalDelta > 0 ? 'add' : 'remove';
  }

  const creator = await pool.query(
    `SELECT user_id, college_id
     FROM student_feed_creator_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [creatorUserId]
  );
  if (!creator.rows[0]) return res.status(404).json({ error: 'Creator profile not found' });

  await adjustCreatorPoints({
    creatorUserId,
    collegeId: creator.rows[0].college_id,
    delta: finalDelta,
    reason: `${actionType}: ${reason}`,
    adminUserId: req.session.userId
  });

  const profile = await updateCreatorProfile(creatorUserId, creator.rows[0].college_id);
  return res.json({ message: 'Creator points adjusted', creator: profile, delta: finalDelta, actionType });
});

router.get('/analytics', requireAdmin, async (_req, res) => {
  await ensureCampusFeedSchema();

  const [overview, topPosts, topCreators, activeColleges, suspicious] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE moderation_status = 'pending')::int AS pending_posts,
         COUNT(*) FILTER (WHERE moderation_status = 'approved')::int AS approved_posts,
         COUNT(*) FILTER (WHERE moderation_status = 'rejected')::int AS rejected_posts,
         COUNT(*) FILTER (WHERE is_featured = TRUE AND moderation_status = 'approved')::int AS featured_posts,
         COUNT(*) FILTER (WHERE is_trending = TRUE AND moderation_status = 'approved')::int AS trending_posts,
         COALESCE(SUM(points_earned), 0)::int AS points_distributed
       FROM student_feed_posts`
    ),
    pool.query(
      `SELECT p.id, p.title, p.college_id, c.name AS college_name, p.quality_score, p.retention_score,
              p.like_count, p.comment_count, p.share_count, p.created_at, u.full_name AS author_name
       FROM student_feed_posts p
       JOIN users u ON u.id = p.user_id
       JOIN colleges c ON c.id = p.college_id
       WHERE p.moderation_status = 'approved'
       ORDER BY p.quality_score DESC, p.created_at DESC
       LIMIT 8`
    ),
    pool.query(
      `SELECT cp.user_id, u.full_name, c.name AS college_name, cp.trust_level, cp.campus_role,
              cp.total_points, cp.approved_posts, cp.rejected_posts, cp.posting_suspended
       FROM student_feed_creator_profiles cp
       JOIN users u ON u.id = cp.user_id
       JOIN colleges c ON c.id = cp.college_id
       ORDER BY cp.total_points DESC, cp.trust_score DESC
       LIMIT 8`
    ),
    pool.query(
      `SELECT c.id, c.name,
              COUNT(p.id)::int AS total_posts,
              COUNT(p.id) FILTER (WHERE p.moderation_status = 'pending')::int AS pending_posts,
              COUNT(p.id) FILTER (WHERE p.moderation_status = 'approved')::int AS approved_posts,
              COALESCE(SUM(p.points_earned), 0)::int AS points_total
       FROM colleges c
       LEFT JOIN student_feed_posts p ON p.college_id = c.id
       GROUP BY c.id
       ORDER BY approved_posts DESC, total_posts DESC
       LIMIT 10`
    ),
    pool.query(
      `SELECT event_type,
              COUNT(*)::int AS total,
              MAX(created_at) AS latest_at
       FROM student_feed_security_events
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY event_type
       ORDER BY total DESC
       LIMIT 10`
    )
  ]);

  return res.json({
    overview: overview.rows[0] || {},
    topPosts: topPosts.rows,
    topCreators: topCreators.rows,
    activeColleges: activeColleges.rows,
    suspiciousSignals: suspicious.rows
  });
});

router.post('/official-posts', requireAdmin, mediaUpload.single('media'), async (req, res) => {
  await ensureCampusFeedSchema();

  const collegeId = Number(req.body.collegeId || 0);
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const postType = normalizePostType(req.body.postType || 'official') || 'official';
  const category = normalizeCategory(req.body.category || 'official') || 'official';
  const tagsRaw = req.body.tags;

  if (!Number.isInteger(collegeId) || collegeId <= 0 || !title || !description) {
    return res.status(400).json({ error: 'collegeId, title and description are required' });
  }

  const collegeCheck = await pool.query('SELECT id, name FROM colleges WHERE id = $1 LIMIT 1', [collegeId]);
  if (!collegeCheck.rows[0]) {
    return res.status(400).json({ error: 'Invalid collegeId' });
  }

  let tags = [];
  try {
    tags = normalizeTags(Array.isArray(tagsRaw) ? tagsRaw : JSON.parse(String(tagsRaw || '[]')));
  } catch {
    tags = normalizeTags(String(tagsRaw || '').split(',').map((x) => x.trim()));
  }

  let mediaUrl = null;
  let mediaType = null;
  if (req.file) {
    mediaUrl = (await saveUploadedFile({
      file: req.file,
      folder: `campus-feed/${collegeId}`,
      prefix: `admin-${postType}`
    })) || null;
    mediaType = req.file?.mimetype || null;
  }

  const eventStartsAt = req.body.eventStartsAt ? new Date(req.body.eventStartsAt) : null;
  const safeEventStartsAt = eventStartsAt && !Number.isNaN(eventStartsAt.getTime()) ? eventStartsAt.toISOString() : null;
  const pollOptions = (() => {
    const source = String(req.body.pollOptions || '').trim();
    if (!source) return null;
    try {
      const parsed = JSON.parse(source);
      return Array.isArray(parsed) ? parsed.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6) : null;
    } catch {
      const rows = source.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
      return rows.length >= 2 ? rows : null;
    }
  })();

  const inserted = await pool.query(
    `INSERT INTO student_feed_posts (
      user_id, college_id, title, description, post_type, category, tags,
      poll_options, poll_ends_at,
      media_url, media_type, event_starts_at, event_venue, is_urgent,
      moderation_status, moderated_by, moderated_at, is_featured,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::jsonb,
      $8::jsonb, $9,
      $10, $11, $12, $13, $14,
      'approved', $1, NOW(), TRUE,
      NOW(), NOW()
    )
    RETURNING *`,
    [
      req.session.userId,
      collegeId,
      title,
      description,
      postType,
      category,
      JSON.stringify(tags),
      pollOptions ? JSON.stringify(pollOptions) : null,
      req.body.pollEndsAt || null,
      mediaUrl,
      mediaType,
      safeEventStartsAt,
      String(req.body.eventVenue || '').trim() || null,
      req.body.isUrgent === 'true' || req.body.isUrgent === true
    ]
  );

  const collegeUsers = await pool.query(
    "SELECT id FROM users WHERE LOWER(COALESCE(college_name, '')) = LOWER($1)",
    [collegeCheck.rows[0].name]
  );

  await Promise.all(collegeUsers.rows.map((user) => createNotification(
    user.id,
    'campus_important_update',
    `New official update posted: \"${title}\"`
  )));

  publishRealtimeEvent('campus_official_post_published', {
    collegeId,
    postId: inserted.rows[0].id
  });

  return res.status(201).json({ message: 'Official post published', post: inserted.rows[0] });
});

module.exports = router;
