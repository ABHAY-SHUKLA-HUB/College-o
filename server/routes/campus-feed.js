const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');
const {
  ensureCampusFeedSchema,
  normalizePostType,
  normalizeCategory,
  normalizeTags,
  resolveUserCollegeId,
  createNotification,
  resolveFraudSignals,
  runEngagementFraudChecks,
  runSignalFraudChecks,
  writeSecurityEvent,
  refreshPostQuality,
  grantCreatorPoints,
  updateCreatorProfile,
  evaluateSubmissionRisk,
  assertCreatorCanPost
} = require('../services/campusFeedService');
const { subscribeRealtime, publishRealtimeEvent } = require('../services/realtimeBus');

const router = express.Router();

const mediaUpload = createUploadMiddleware({
  maxFileSize: 25 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'],
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov'],
  invalidTypeMessage: 'Only image/video uploads are allowed'
});

function parseTags(raw) {
  if (Array.isArray(raw)) return normalizeTags(raw);
  const text = String(raw || '').trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeTags(parsed);
  } catch {
    // Ignore JSON parse and use comma split.
  }

  return normalizeTags(text.split(',').map((part) => part.trim()));
}

function parsePollOptions(raw) {
  if (!raw) return null;
  let rows = [];

  if (Array.isArray(raw)) {
    rows = raw;
  } else {
    const text = String(raw || '').trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        rows = parsed;
      } else {
        rows = text.split('\n');
      }
    } catch {
      rows = text.split('\n');
    }
  }

  const normalized = rows
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 6);

  return normalized.length >= 2 ? normalized : null;
}

function computeTrendingScore(post) {
  const likes = Number(post.like_count || 0);
  const comments = Number(post.comment_count || 0);
  const shares = Number(post.share_count || 0);
  const quality = Number(post.quality_score || 0);
  const retention = Number(post.retention_score || 0);
  const penalty = Number(post.low_quality_penalty || 0);
  const roleBoost = post.campus_role === 'verified_contributor' ? 2.5 : post.campus_role === 'campus_reporter' ? 1 : 0;
  const featuredBoost = post.is_featured ? 5 : 0;
  const ageHours = Math.max(0, (Date.now() - new Date(post.created_at).getTime()) / (1000 * 60 * 60));
  const recencyBoost = Math.max(0, (72 - ageHours) / 8);

  return (likes * 1.15)
    + (comments * 2.85)
    + (shares * 3.2)
    + (quality * 0.35)
    + (retention * 0.28)
    + featuredBoost
    + roleBoost
    + recencyBoost
    - penalty;
}

function publicShareLink(req, postId) {
  const origin = `${req.protocol}://${req.get('host')}`;
  return `${origin}/college-feed.html?post=${encodeURIComponent(postId)}`;
}

async function resolveViewerContext(userId) {
  const collegeId = await resolveUserCollegeId(userId);
  const userResult = await pool.query(
    `SELECT id, full_name, email, college_name
     FROM users
     WHERE id = $1`,
    [userId]
  );

  const creatorResult = await pool.query(
    `SELECT trust_level, campus_role, trust_score, total_points, approved_posts, rejected_posts
     FROM student_feed_creator_profiles
     WHERE user_id = $1`,
    [userId]
  );

  return {
    user: userResult.rows[0] || null,
    collegeId,
    creatorProfile: creatorResult.rows[0] || {
      trust_level: 'new',
      campus_role: 'regular_student',
      trust_score: 0,
      total_points: 0,
      approved_posts: 0,
      rejected_posts: 0
    }
  };
}

async function fetchApprovedPostForCollege(postId, collegeId) {
  const { rows } = await pool.query(
    `SELECT p.*, u.full_name AS author_name,
            cp.trust_level,
            cp.campus_role,
            cp.total_points AS creator_points
     FROM student_feed_posts p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN student_feed_creator_profiles cp ON cp.user_id = p.user_id
     WHERE p.id = $1
       AND p.college_id = $2
       AND p.moderation_status = 'approved'
     LIMIT 1`,
    [postId, collegeId]
  );
  return rows[0] || null;
}

async function ensureDefaultCollection(userId, collegeId) {
  const existing = await pool.query(
    `SELECT id
     FROM student_feed_collections
     WHERE user_id = $1 AND college_id = $2 AND LOWER(name) = 'saved'
     LIMIT 1`,
    [userId, collegeId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await pool.query(
    `INSERT INTO student_feed_collections (user_id, college_id, name)
     VALUES ($1, $2, 'Saved')
     RETURNING id`,
    [userId, collegeId]
  );
  return created.rows[0].id;
}

async function upsertWatchSignal({ postId, userId, collegeId, watchSeconds, dwellSeconds, scrollDepth, completionRate, isValid, ipHash, sessionHash, deviceHash }) {
  await pool.query(
    `INSERT INTO student_feed_view_signals (
      post_id, user_id, college_id, watch_seconds, dwell_seconds, scroll_depth, completion_rate,
      is_valid, ip_hash, session_hash, device_hash
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11
    )
    ON CONFLICT (post_id, user_id)
    DO UPDATE SET
      watch_seconds = GREATEST(student_feed_view_signals.watch_seconds, EXCLUDED.watch_seconds),
      dwell_seconds = GREATEST(student_feed_view_signals.dwell_seconds, EXCLUDED.dwell_seconds),
      scroll_depth = GREATEST(student_feed_view_signals.scroll_depth, EXCLUDED.scroll_depth),
      completion_rate = GREATEST(student_feed_view_signals.completion_rate, EXCLUDED.completion_rate),
      is_valid = student_feed_view_signals.is_valid AND EXCLUDED.is_valid,
      ip_hash = EXCLUDED.ip_hash,
      session_hash = EXCLUDED.session_hash,
      device_hash = EXCLUDED.device_hash,
      created_at = NOW()`,
    [postId, userId, collegeId, watchSeconds, dwellSeconds, scrollDepth, completionRate, isValid, ipHash, sessionHash, deviceHash]
  );
}

async function updateTrendingFlag(postId) {
  const row = await pool.query(
    `SELECT p.*, cp.campus_role
     FROM student_feed_posts p
     LEFT JOIN student_feed_creator_profiles cp ON cp.user_id = p.user_id
     WHERE p.id = $1`,
    [postId]
  );
  const post = row.rows[0];
  if (!post) return null;

  const score = computeTrendingScore(post);
  const isTrending = score >= 18;
  const wasTrending = Boolean(post.is_trending);

  const updated = await pool.query(
    `UPDATE student_feed_posts
     SET is_trending = $2,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [postId, isTrending]
  );

  if (!wasTrending && isTrending && updated.rows[0]?.moderation_status === 'approved') {
    const shouldNotify = !updated.rows[0].last_trending_notified_at ||
      (Date.now() - new Date(updated.rows[0].last_trending_notified_at).getTime()) > (24 * 60 * 60 * 1000);

    if (shouldNotify) {
      await pool.query(
        'UPDATE student_feed_posts SET last_trending_notified_at = NOW() WHERE id = $1',
        [postId]
      );
      await createNotification(
        updated.rows[0].user_id,
        'campus_post_trending',
        `Your post \"${updated.rows[0].title}\" is trending in your campus feed.`
      );
    }
  }

  return updated.rows[0] || null;
}

router.get('/stream', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const context = await resolveViewerContext(req.session.userId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const heartbeat = setInterval(() => {
    res.write('event: heartbeat\\n');
    res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\\n\\n`);
  }, 20000);

  const unsubscribe = subscribeRealtime((evt) => {
    const payload = evt?.payload || {};
    const targetsCollege = !payload.collegeId || Number(payload.collegeId) === Number(context.collegeId);
    const targetsUser = !payload.userId || Number(payload.userId) === Number(req.session.userId);

    if (!targetsCollege && !targetsUser) return;

    res.write(`event: ${evt.type}\\n`);
    res.write(`data: ${JSON.stringify(evt.payload || {})}\\n\\n`);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

router.get('/me/summary', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const context = await resolveViewerContext(req.session.userId);

  const [pending, approved, saved, trending, reports] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS total FROM student_feed_posts WHERE user_id = $1 AND college_id = $2 AND moderation_status = $3', [req.session.userId, context.collegeId, 'pending']),
    pool.query('SELECT COUNT(*)::int AS total FROM student_feed_posts WHERE user_id = $1 AND college_id = $2 AND moderation_status = $3', [req.session.userId, context.collegeId, 'approved']),
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM student_feed_engagements e
       JOIN student_feed_posts p ON p.id = e.post_id
       WHERE e.user_id = $1 AND e.engagement_type = 'save' AND p.college_id = $2 AND e.is_valid = TRUE`,
      [req.session.userId, context.collegeId]
    ),
    pool.query('SELECT COUNT(*)::int AS total FROM student_feed_posts WHERE college_id = $1 AND moderation_status = $2 AND is_trending = TRUE', [context.collegeId, 'approved']),
    pool.query('SELECT COUNT(*)::int AS total FROM student_feed_reports WHERE reporter_user_id = $1 AND college_id = $2', [req.session.userId, context.collegeId])
  ]);

  return res.json({
    college: {
      id: context.collegeId,
      name: context.user?.college_name || null
    },
    creatorProfile: context.creatorProfile,
    stats: {
      pendingPosts: pending.rows[0]?.total || 0,
      approvedPosts: approved.rows[0]?.total || 0,
      savedPosts: saved.rows[0]?.total || 0,
      trendingNow: trending.rows[0]?.total || 0,
      reportsSubmitted: reports.rows[0]?.total || 0
    }
  });
});

router.get('/posts', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const context = await resolveViewerContext(req.session.userId);

  const tab = String(req.query.tab || 'latest').toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit || 25), 5), 60);

  const params = [context.collegeId, req.session.userId];
  const where = [`p.college_id = $1`, `p.moderation_status = 'approved'`];
  let orderBy = 'p.is_urgent DESC, p.created_at DESC';

  if (tab === 'official') {
    where.push(`p.category = 'official'`);
  } else if (tab === 'events') {
    where.push(`p.category = 'events'`);
  } else if (tab === 'achievements') {
    where.push(`p.category = 'achievements'`);
  } else if (tab === 'alerts') {
    where.push(`p.category = 'alerts'`);
    where.push('p.is_urgent = TRUE');
    orderBy = 'p.created_at DESC';
  } else if (tab === 'placements') {
    where.push(`(p.category = 'placements' OR p.post_type = 'placement_update')`);
  } else if (tab === 'lost_found') {
    where.push(`(p.category = 'lost_found' OR p.post_type = 'lost_found')`);
  } else if (tab === 'trending') {
    orderBy = `(
      (COALESCE(p.like_count, 0) * 1.15)
      + (COALESCE(p.comment_count, 0) * 2.85)
      + (COALESCE(p.share_count, 0) * 3.2)
      + (COALESCE(p.quality_score, 0) * 0.35)
      + (COALESCE(p.retention_score, 0) * 0.28)
      + CASE WHEN p.is_featured THEN 5 ELSE 0 END
      + CASE WHEN cp.campus_role = 'verified_contributor' THEN 2.5 WHEN cp.campus_role = 'campus_reporter' THEN 1 ELSE 0 END
      + GREATEST(0, (72 - EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600) / 8)
      - COALESCE(p.low_quality_penalty, 0)
    ) DESC, p.created_at DESC`;
  }

  params.push(limit);

  const { rows } = await pool.query(
    `SELECT p.id,
            p.user_id,
            p.title,
            p.description,
            p.post_type,
            p.category,
            p.tags,
            p.poll_options,
            p.poll_ends_at,
            p.media_url,
            p.media_type,
            p.event_starts_at,
            p.event_venue,
            p.is_urgent,
            p.is_featured,
            p.is_trending,
            p.like_count,
            p.comment_count,
            p.share_count,
            p.save_count,
            p.quality_score,
            p.retention_score,
            p.low_quality_penalty,
            p.points_earned,
            p.created_at,
            p.updated_at,
            u.full_name AS author_name,
            COALESCE(cp.trust_level, 'new') AS author_trust_level,
            COALESCE(cp.campus_role, 'regular_student') AS author_role,
            COALESCE(cp.total_points, 0) AS author_points,
            EXISTS (
              SELECT 1 FROM student_feed_engagements e
              WHERE e.post_id = p.id AND e.user_id = $2 AND e.engagement_type = 'like' AND e.is_valid = TRUE
            ) AS liked_by_me,
            EXISTS (
              SELECT 1 FROM student_feed_engagements e
              WHERE e.post_id = p.id AND e.user_id = $2 AND e.engagement_type = 'save' AND e.is_valid = TRUE
            ) AS saved_by_me,
            EXISTS (
              SELECT 1 FROM student_feed_engagements e
              WHERE e.post_id = p.id AND e.user_id = $2 AND e.engagement_type = 'share' AND e.is_valid = TRUE
            ) AS shared_by_me,
            (
              SELECT pv.selected_index
              FROM student_feed_poll_votes pv
              WHERE pv.post_id = p.id AND pv.user_id = $2
              LIMIT 1
            ) AS my_poll_vote,
            (
              SELECT COALESCE(
                json_agg(
                  json_build_object('selected_index', tally.selected_index, 'votes', tally.votes)
                  ORDER BY tally.selected_index
                ),
                '[]'::json
              )
              FROM (
                SELECT selected_index, COUNT(*)::int AS votes
                FROM student_feed_poll_votes
                WHERE post_id = p.id
                GROUP BY selected_index
              ) tally
            ) AS poll_votes,
            (
              SELECT COUNT(*)::int
              FROM student_feed_reports r
              WHERE r.post_id = p.id
            ) AS report_count
     FROM student_feed_posts p
     JOIN users u ON u.id = p.user_id
     LEFT JOIN student_feed_creator_profiles cp ON cp.user_id = p.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT $3`,
    params
  );

  return res.json({ posts: rows, tab, collegeId: context.collegeId });
});

router.get('/posts/trending', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const context = await resolveViewerContext(req.session.userId);
  const limit = Math.min(Math.max(Number(req.query.limit || 8), 3), 20);

  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.category, p.like_count, p.comment_count, p.share_count, p.media_url, p.created_at,
            u.full_name AS author_name
     FROM student_feed_posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.college_id = $1
       AND p.moderation_status = 'approved'
       AND p.is_trending = TRUE
     ORDER BY p.updated_at DESC, p.created_at DESC
     LIMIT $2`,
    [context.collegeId, limit]
  );

  return res.json({ trending: rows });
});

router.get('/posts/mine', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const context = await resolveViewerContext(req.session.userId);

  const { rows } = await pool.query(
    `SELECT id, title, description, post_type, category, media_url, moderation_status,
            moderation_reason, is_trending, points_earned, created_at
     FROM student_feed_posts
     WHERE user_id = $1 AND college_id = $2
     ORDER BY created_at DESC
     LIMIT 80`,
    [req.session.userId, context.collegeId]
  );

  return res.json({ submissions: rows });
});

router.get('/creator/:userId', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const creatorUserId = Number(req.params.userId);
  if (!Number.isInteger(creatorUserId)) return res.status(400).json({ error: 'Invalid creator user id' });

  const context = await resolveViewerContext(req.session.userId);

  const creator = await pool.query(
    `SELECT u.id, u.full_name, u.college_name,
            cp.trust_level, cp.campus_role, cp.total_points, cp.approved_posts, cp.rejected_posts, cp.trust_score
     FROM users u
     LEFT JOIN student_feed_creator_profiles cp ON cp.user_id = u.id
     WHERE u.id = $1`,
    [creatorUserId]
  );

  if (!creator.rows[0]) return res.status(404).json({ error: 'Creator not found' });

  const creatorCollege = await resolveUserCollegeId(creatorUserId);
  if (Number(creatorCollege) !== Number(context.collegeId)) {
    return res.status(403).json({ error: 'Cross-college creator access blocked' });
  }

  const [topPosts, engagementStats] = await Promise.all([
    pool.query(
      `SELECT id, title, like_count, comment_count, share_count, quality_score, is_trending, created_at
       FROM student_feed_posts
       WHERE user_id = $1 AND college_id = $2 AND moderation_status = 'approved'
       ORDER BY quality_score DESC, created_at DESC
       LIMIT 5`,
      [creatorUserId, context.collegeId]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(like_count), 0)::int AS total_likes,
         COALESCE(SUM(comment_count), 0)::int AS total_comments,
         COALESCE(SUM(share_count), 0)::int AS total_shares,
         COALESCE(AVG(retention_score), 0)::numeric(10,2) AS avg_retention,
         COUNT(*) FILTER (WHERE is_trending = TRUE)::int AS trending_posts,
         COUNT(*)::int AS total_posts
       FROM student_feed_posts
       WHERE user_id = $1
         AND college_id = $2
         AND moderation_status = 'approved'`,
      [creatorUserId, context.collegeId]
    )
  ]);

  const stats = engagementStats.rows[0] || {};
  const badges = [];
  if (Number(stats.total_posts || 0) >= 5) badges.push('Consistent Creator');
  if (Number(stats.trending_posts || 0) >= 1) badges.push('Trending Voice');
  if (Number(stats.avg_retention || 0) >= 55) badges.push('High Retention');
  if (String(creator.rows[0].campus_role || '') === 'verified_contributor') badges.push('Verified Contributor');

  return res.json({
    creator: {
      ...creator.rows[0],
      badges
    },
    topPosts: topPosts.rows,
    engagementStats: stats
  });
});

router.post('/posts', requireAuth, mediaUpload.single('media'), async (req, res) => {
  await ensureCampusFeedSchema();
  const context = await resolveViewerContext(req.session.userId);
  await assertCreatorCanPost(req.session.userId, context.collegeId);

  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const postType = normalizePostType(req.body.postType);
  const category = normalizeCategory(req.body.category) || 'latest';
  const tags = parseTags(req.body.tags);
  const isUrgent = req.body.isUrgent === 'true' || req.body.isUrgent === true;
  const pollOptions = parsePollOptions(req.body.pollOptions);

  if (!title || !description || !postType) {
    return res.status(400).json({ error: 'title, description and valid postType are required' });
  }

  if (postType === 'official') {
    return res.status(403).json({ error: 'Students cannot publish official category posts' });
  }

  let mediaUrl = null;
  let mediaType = null;
  if (req.file) {
    mediaUrl = (await saveUploadedFile({
      file: req.file,
      folder: `campus-feed/${context.collegeId}`,
      prefix: `campus-${postType}`
    })) || null;
    mediaType = req.file?.mimetype || null;
  }

  if ((postType === 'image' || postType === 'video' || postType === 'event_coverage') && !mediaUrl) {
    return res.status(400).json({ error: 'Media upload is required for this post type' });
  }

  if (postType === 'poll' && !pollOptions) {
    return res.status(400).json({ error: 'Poll posts require at least two options' });
  }

  const submissionRisk = await evaluateSubmissionRisk({
    userId: req.session.userId,
    collegeId: context.collegeId,
    title,
    description
  });

  if (submissionRisk.isRisky) {
    await writeSecurityEvent({
      userId: req.session.userId,
      collegeId: context.collegeId,
      eventType: 'content_flagged_submission',
      reason: submissionRisk.reasons.join(', ')
    });
  }

  const eventStartsAt = req.body.eventStartsAt ? new Date(req.body.eventStartsAt) : null;
  const safeEventStartsAt = eventStartsAt && !Number.isNaN(eventStartsAt.getTime()) ? eventStartsAt.toISOString() : null;
  const eventVenue = String(req.body.eventVenue || '').trim() || null;
  const pollEndsAtRaw = req.body.pollEndsAt ? new Date(req.body.pollEndsAt) : null;
  const pollEndsAt = pollEndsAtRaw && !Number.isNaN(pollEndsAtRaw.getTime()) ? pollEndsAtRaw.toISOString() : null;

  const { rows } = await pool.query(
    `INSERT INTO student_feed_posts (
      user_id, college_id, title, description, post_type, category, tags,
      content_hash,
      poll_options, poll_ends_at,
      media_url, media_type, event_starts_at, event_venue, is_urgent,
      moderation_status, moderation_reason, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7::jsonb,
      $8,
      $9::jsonb, $10,
      $11, $12, $13, $14, $15,
      'pending', $16, NOW(), NOW()
    )
    RETURNING id, title, post_type, category, moderation_status, moderation_reason, created_at`,
    [
      req.session.userId,
      context.collegeId,
      title,
      description,
      postType,
      category,
      JSON.stringify(tags),
      submissionRisk.contentHash,
      pollOptions ? JSON.stringify(pollOptions) : null,
      pollEndsAt,
      mediaUrl,
      mediaType,
      safeEventStartsAt,
      eventVenue,
      isUrgent,
      submissionRisk.isRisky ? `Flagged for admin review: ${submissionRisk.reasons.join(', ')}` : null
    ]
  );

  publishRealtimeEvent('campus_post_submitted', {
    collegeId: context.collegeId,
    postId: rows[0].id,
    userId: req.session.userId
  });

  return res.status(201).json({
    message: submissionRisk.isRisky
      ? 'Post submitted and flagged for additional moderation review.'
      : 'Post submitted for moderation. It will appear after approval.',
    post: rows[0]
  });
});

router.post('/posts/:id/engagement', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  const type = String(req.body.type || '').trim().toLowerCase();
  const allowed = new Set(['like', 'save', 'share']);

  if (!Number.isInteger(postId) || !allowed.has(type)) {
    return res.status(400).json({ error: 'Invalid post or engagement type' });
  }

  const context = await resolveViewerContext(req.session.userId);
  const post = await fetchApprovedPostForCollege(postId, context.collegeId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const existing = await pool.query(
    `SELECT id
     FROM student_feed_engagements
     WHERE post_id = $1 AND user_id = $2 AND engagement_type = $3
     LIMIT 1`,
    [postId, req.session.userId, type]
  );

  let active = false;
  const signals = resolveFraudSignals(req);

  if (existing.rows[0]) {
    await pool.query('DELETE FROM student_feed_engagements WHERE id = $1', [existing.rows[0].id]);
    if (type === 'save') {
      const defaultCollectionId = await ensureDefaultCollection(req.session.userId, context.collegeId);
      await pool.query(
        `DELETE FROM student_feed_collection_posts
         WHERE collection_id = $1 AND post_id = $2`,
        [defaultCollectionId, postId]
      );
    }
  } else {
    const fraudCheck = await runEngagementFraudChecks({
      postId,
      userId: req.session.userId,
      collegeId: context.collegeId,
      engagementType: type,
      ipHash: signals.ipHash,
      sessionHash: signals.sessionHash,
      deviceHash: signals.deviceHash
    });

    const isValid = fraudCheck.isValid;
    if (!isValid) {
      await writeSecurityEvent({
        userId: req.session.userId,
        postId,
        collegeId: context.collegeId,
        eventType: 'engagement_flagged',
        reason: fraudCheck.reasons.join(', '),
        ipHash: signals.ipHash,
        sessionHash: signals.sessionHash,
        deviceHash: signals.deviceHash
      });
    }

    await pool.query(
      `INSERT INTO student_feed_engagements (
        post_id, user_id, engagement_type, is_valid, fraud_reason, ip_hash, device_hash, session_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [postId, req.session.userId, type, isValid, isValid ? null : fraudCheck.reasons.join(', '), signals.ipHash, signals.deviceHash, signals.sessionHash]
    );
    active = true;
  }

  if (active && type === 'save') {
    const defaultCollectionId = await ensureDefaultCollection(req.session.userId, context.collegeId);
    await pool.query(
      `INSERT INTO student_feed_collection_posts (collection_id, post_id)
       VALUES ($1, $2)
       ON CONFLICT (collection_id, post_id) DO NOTHING`,
      [defaultCollectionId, postId]
    );
  }

  const refreshed = await refreshPostQuality(postId);
  await updateTrendingFlag(postId);

  const insertedEngagement = await pool.query(
    `SELECT is_valid
     FROM student_feed_engagements
     WHERE post_id = $1 AND user_id = $2 AND engagement_type = $3
     LIMIT 1`,
    [postId, req.session.userId, type]
  );
  const isValidEngagement = Boolean(insertedEngagement.rows[0]?.is_valid);

  if (active && isValidEngagement && type === 'like') {
    await grantCreatorPoints({
      post,
      actorUserId: req.session.userId,
      eventType: 'like',
      points: 1,
      eventKey: `like:${postId}:${req.session.userId}`
    });

    if (Number(post.user_id) !== Number(req.session.userId)) {
      await createNotification(post.user_id, 'campus_post_liked', `Your post \"${post.title}\" got a new like.`);
    }
  }

  if (active && isValidEngagement && type === 'share') {
    await grantCreatorPoints({
      post,
      actorUserId: req.session.userId,
      eventType: 'share',
      points: 4,
      eventKey: `share:${postId}:${req.session.userId}`
    });

    if (Number(post.user_id) !== Number(req.session.userId)) {
      await createNotification(post.user_id, 'campus_post_shared', `Your post \"${post.title}\" was shared by a student.`);
    }
  }

  if (active && type === 'save' && Number(post.user_id) !== Number(req.session.userId)) {
    await createNotification(post.user_id, 'campus_post_saved', `A student bookmarked your post \"${post.title}\".`);
  }

  await updateCreatorProfile(post.user_id, post.college_id);

  publishRealtimeEvent('campus_post_engagement', {
    collegeId: context.collegeId,
    postId,
    userId: req.session.userId,
    type,
    active,
    counts: {
      likes: refreshed?.like_count || 0,
      comments: refreshed?.comment_count || 0,
      shares: refreshed?.share_count || 0,
      saves: refreshed?.save_count || 0
    }
  });

  return res.json({
    postId,
    type,
    active,
    ignoredForQuality: active && !isValidEngagement,
    counts: {
      likes: refreshed?.like_count || 0,
      comments: refreshed?.comment_count || 0,
      shares: refreshed?.share_count || 0,
      saves: refreshed?.save_count || 0
    }
  });
});

router.post('/posts/:id/signal', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const context = await resolveViewerContext(req.session.userId);
  const post = await fetchApprovedPostForCollege(postId, context.collegeId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const watchSeconds = Math.max(0, Math.min(3600, Number(req.body.watchSeconds || 0)));
  const dwellSeconds = Math.max(0, Math.min(3600, Number(req.body.dwellSeconds || 0)));
  const scrollDepth = Math.max(0, Math.min(100, Number(req.body.scrollDepth || 0)));
  const completionRate = Math.max(0, Math.min(100, Number(req.body.completionRate || 0)));

  const signals = resolveFraudSignals(req);
  const fraudCheck = await runSignalFraudChecks({
    userId: req.session.userId,
    postId,
    ipHash: signals.ipHash,
    sessionHash: signals.sessionHash,
    deviceHash: signals.deviceHash,
    dwellSeconds
  });

  if (!fraudCheck.isValid) {
    await writeSecurityEvent({
      userId: req.session.userId,
      postId,
      collegeId: context.collegeId,
      eventType: 'signal_flagged',
      reason: fraudCheck.reasons.join(', '),
      ipHash: signals.ipHash,
      sessionHash: signals.sessionHash,
      deviceHash: signals.deviceHash
    });
  }

  await upsertWatchSignal({
    postId,
    userId: req.session.userId,
    collegeId: context.collegeId,
    watchSeconds,
    dwellSeconds,
    scrollDepth,
    completionRate,
    isValid: fraudCheck.isValid,
    ipHash: signals.ipHash,
    sessionHash: signals.sessionHash,
    deviceHash: signals.deviceHash
  });

  const refreshed = await refreshPostQuality(postId);
  await updateTrendingFlag(postId);

  if (fraudCheck.isValid && Number(refreshed?.retention_score || 0) >= 60) {
    await grantCreatorPoints({
      post,
      actorUserId: req.session.userId,
      eventType: 'retention_quality',
      points: 2,
      eventKey: `retention:${postId}:${req.session.userId}`
    });
    await updateCreatorProfile(post.user_id, post.college_id);
  }

  return res.json({
    postId,
    accepted: fraudCheck.isValid,
    retentionScore: refreshed?.retention_score || 0,
    qualityScore: refreshed?.quality_score || 0
  });
});

router.post('/posts/:id/comments', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  const body = String(req.body.body || '').trim();

  if (!Number.isInteger(postId) || !body) {
    return res.status(400).json({ error: 'Valid post id and comment body are required' });
  }

  const context = await resolveViewerContext(req.session.userId);
  const post = await fetchApprovedPostForCollege(postId, context.collegeId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const signals = resolveFraudSignals(req);
  const fraudCheck = await runEngagementFraudChecks({
    postId,
    userId: req.session.userId,
    collegeId: context.collegeId,
    engagementType: 'comment',
    ipHash: signals.ipHash,
    sessionHash: signals.sessionHash,
    deviceHash: signals.deviceHash
  });

  const isValidComment = fraudCheck.isValid;
  if (!isValidComment) {
    await writeSecurityEvent({
      userId: req.session.userId,
      postId,
      collegeId: context.collegeId,
      eventType: 'comment_flagged',
      reason: fraudCheck.reasons.join(', '),
      ipHash: signals.ipHash,
      sessionHash: signals.sessionHash,
      deviceHash: signals.deviceHash
    });
  }

  const inserted = await pool.query(
    `INSERT INTO student_feed_comments (post_id, user_id, body, is_valid, fraud_reason, ip_hash, device_hash, session_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, post_id, user_id, body, created_at, is_valid`,
    [postId, req.session.userId, body, isValidComment, isValidComment ? null : fraudCheck.reasons.join(', '), signals.ipHash, signals.deviceHash, signals.sessionHash]
  );

  const refreshed = await refreshPostQuality(postId);
  await updateTrendingFlag(postId);

  if (isValidComment) {
    const commentPointsWindow = await pool.query(
      `SELECT COUNT(*)::int AS cnt
       FROM student_feed_comments
       WHERE post_id = $1 AND user_id = $2 AND created_at::date = CURRENT_DATE AND is_valid = TRUE`,
      [postId, req.session.userId]
    );

    if (Number(commentPointsWindow.rows[0]?.cnt || 0) <= 2) {
      await grantCreatorPoints({
        post,
        actorUserId: req.session.userId,
        eventType: 'comment',
        points: 3,
        eventKey: `comment:${postId}:${req.session.userId}:${inserted.rows[0].id}`
      });
    }

    const interactionTotal = (Number(refreshed?.like_count || 0) + Number(refreshed?.comment_count || 0) + Number(refreshed?.share_count || 0));
    if (interactionTotal >= 10) {
      await grantCreatorPoints({
        post,
        actorUserId: req.session.userId,
        eventType: 'engagement_bonus',
        points: 5,
        eventKey: `bonus:engaged:${postId}:10`
      });
    }
  }

  if (Number(post.user_id) !== Number(req.session.userId)) {
    await createNotification(post.user_id, 'campus_post_commented', `Your post \"${post.title}\" received a new comment.`);
  }

  await updateCreatorProfile(post.user_id, post.college_id);

  publishRealtimeEvent('campus_post_comment', {
    collegeId: context.collegeId,
    postId,
    userId: req.session.userId,
    comment: inserted.rows[0]
  });

  return res.status(201).json({
    comment: inserted.rows[0],
    ignoredForQuality: !isValidComment,
    counts: {
      likes: refreshed?.like_count || 0,
      comments: refreshed?.comment_count || 0,
      shares: refreshed?.share_count || 0,
      saves: refreshed?.save_count || 0
    }
  });
});

router.get('/posts/:id/comments', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const context = await resolveViewerContext(req.session.userId);
  const post = await fetchApprovedPostForCollege(postId, context.collegeId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const { rows } = await pool.query(
    `SELECT c.id, c.post_id, c.body, c.created_at, u.id AS user_id, u.full_name
     FROM student_feed_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id = $1
       AND c.is_valid = TRUE
     ORDER BY c.created_at ASC
     LIMIT 250`,
    [postId]
  );

  return res.json({ comments: rows });
});

router.post('/posts/:id/report', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  const reason = String(req.body.reason || '').trim().toLowerCase();
  const details = String(req.body.details || '').trim();
  const allowedReasons = new Set(['spam', 'abuse', 'fake', 'harassment', 'misinformation', 'other']);

  if (!Number.isInteger(postId) || !allowedReasons.has(reason)) {
    return res.status(400).json({ error: 'Invalid report submission' });
  }

  const context = await resolveViewerContext(req.session.userId);
  const post = await fetchApprovedPostForCollege(postId, context.collegeId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const perDay = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM student_feed_reports
     WHERE reporter_user_id = $1
       AND college_id = $2
       AND created_at >= NOW() - INTERVAL '1 day'`,
    [req.session.userId, context.collegeId]
  );

  if (Number(perDay.rows[0]?.total || 0) >= 10) {
    return res.status(429).json({ error: 'Report limit exceeded for today' });
  }

  const inserted = await pool.query(
    `INSERT INTO student_feed_reports (post_id, reporter_user_id, college_id, reason, details)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (post_id, reporter_user_id)
     DO UPDATE SET reason = EXCLUDED.reason, details = EXCLUDED.details, status = 'pending', created_at = NOW()
     RETURNING id, status, reason, created_at`,
    [postId, req.session.userId, context.collegeId, reason, details || null]
  );

  const reportCounts = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM student_feed_reports
     WHERE post_id = $1 AND status = 'pending'`,
    [postId]
  );

  if (Number(reportCounts.rows[0]?.total || 0) >= 5) {
    await pool.query(
      `UPDATE student_feed_posts
       SET moderation_status = 'pending',
           moderation_reason = 'Auto-held due to multiple reports',
           updated_at = NOW()
       WHERE id = $1`,
      [postId]
    );

    await publishRealtimeEvent('campus_post_auto_held', {
      collegeId: context.collegeId,
      postId
    });
  }

  return res.status(201).json({ report: inserted.rows[0], pendingReports: reportCounts.rows[0]?.total || 0 });
});

router.get('/collections', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const context = await resolveViewerContext(req.session.userId);
  await ensureDefaultCollection(req.session.userId, context.collegeId);

  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.created_at,
            COUNT(cp.post_id)::int AS post_count
     FROM student_feed_collections c
     LEFT JOIN student_feed_collection_posts cp ON cp.collection_id = c.id
     WHERE c.user_id = $1 AND c.college_id = $2
     GROUP BY c.id
     ORDER BY c.created_at ASC`,
    [req.session.userId, context.collegeId]
  );

  return res.json({ collections: rows });
});

router.post('/collections', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const context = await resolveViewerContext(req.session.userId);
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 120) return res.status(400).json({ error: 'Valid collection name is required' });

  const { rows } = await pool.query(
    `INSERT INTO student_feed_collections (user_id, college_id, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, college_id, name)
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id, name, created_at`,
    [req.session.userId, context.collegeId, name]
  );

  return res.status(201).json({ collection: rows[0] });
});

router.post('/collections/:collectionId/posts/:postId', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const collectionId = Number(req.params.collectionId);
  const postId = Number(req.params.postId);
  if (!Number.isInteger(collectionId) || !Number.isInteger(postId)) {
    return res.status(400).json({ error: 'Invalid collection or post id' });
  }

  const context = await resolveViewerContext(req.session.userId);
  const collection = await pool.query(
    `SELECT id
     FROM student_feed_collections
     WHERE id = $1 AND user_id = $2 AND college_id = $3`,
    [collectionId, req.session.userId, context.collegeId]
  );
  if (!collection.rows[0]) return res.status(404).json({ error: 'Collection not found' });

  const post = await fetchApprovedPostForCollege(postId, context.collegeId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  await pool.query(
    `INSERT INTO student_feed_collection_posts (collection_id, post_id)
     VALUES ($1, $2)
     ON CONFLICT (collection_id, post_id) DO NOTHING`,
    [collectionId, postId]
  );

  return res.json({ message: 'Post added to collection' });
});

router.delete('/collections/:collectionId/posts/:postId', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const collectionId = Number(req.params.collectionId);
  const postId = Number(req.params.postId);
  if (!Number.isInteger(collectionId) || !Number.isInteger(postId)) {
    return res.status(400).json({ error: 'Invalid collection or post id' });
  }

  const context = await resolveViewerContext(req.session.userId);
  const result = await pool.query(
    `DELETE FROM student_feed_collection_posts cp
     USING student_feed_collections c
     WHERE cp.collection_id = c.id
       AND cp.collection_id = $1
       AND cp.post_id = $2
       AND c.user_id = $3
       AND c.college_id = $4`,
    [collectionId, postId, req.session.userId, context.collegeId]
  );

  if (result.rowCount === 0) return res.status(404).json({ error: 'Collection post not found' });
  return res.json({ message: 'Removed from collection' });
});

router.get('/collections/:collectionId/posts', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const collectionId = Number(req.params.collectionId);
  if (!Number.isInteger(collectionId)) return res.status(400).json({ error: 'Invalid collection id' });

  const context = await resolveViewerContext(req.session.userId);
  const collection = await pool.query(
    `SELECT id, name
     FROM student_feed_collections
     WHERE id = $1 AND user_id = $2 AND college_id = $3`,
    [collectionId, req.session.userId, context.collegeId]
  );
  if (!collection.rows[0]) return res.status(404).json({ error: 'Collection not found' });

  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.description, p.media_url, p.post_type, p.category, p.created_at,
            u.full_name AS author_name,
            cp.added_at
     FROM student_feed_collection_posts cp
     JOIN student_feed_posts p ON p.id = cp.post_id
     JOIN users u ON u.id = p.user_id
     WHERE cp.collection_id = $1
       AND p.college_id = $2
       AND p.moderation_status = 'approved'
     ORDER BY cp.added_at DESC`,
    [collectionId, context.collegeId]
  );

  return res.json({ collection: collection.rows[0], posts: rows });
});

router.get('/posts/:id/share-link', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const context = await resolveViewerContext(req.session.userId);
  const post = await fetchApprovedPostForCollege(postId, context.collegeId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const link = publicShareLink(req, postId);
  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(`Trending in ${context.user?.college_name || 'my college'}: ${post.title} ${link}`)}`;
  return res.json({ link, whatsappLink, postId });
});

router.post('/posts/:id/poll-vote', requireAuth, async (req, res) => {
  await ensureCampusFeedSchema();
  const postId = Number(req.params.id);
  const selectedIndex = Number(req.body.selectedIndex);

  if (!Number.isInteger(postId) || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
    return res.status(400).json({ error: 'Invalid poll vote request' });
  }

  const context = await resolveViewerContext(req.session.userId);
  const post = await fetchApprovedPostForCollege(postId, context.collegeId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.post_type !== 'poll' || !Array.isArray(post.poll_options)) {
    return res.status(400).json({ error: 'This post is not a poll' });
  }
  if (selectedIndex >= post.poll_options.length) {
    return res.status(400).json({ error: 'Invalid poll option' });
  }

  if (post.poll_ends_at && new Date(post.poll_ends_at).getTime() < Date.now()) {
    return res.status(400).json({ error: 'Poll voting has ended' });
  }

  await pool.query(
    `INSERT INTO student_feed_poll_votes (post_id, user_id, selected_index)
     VALUES ($1, $2, $3)
     ON CONFLICT (post_id, user_id)
     DO UPDATE SET selected_index = EXCLUDED.selected_index`,
    [postId, req.session.userId, selectedIndex]
  );

  const tally = await pool.query(
    `SELECT selected_index, COUNT(*)::int AS votes
     FROM student_feed_poll_votes
     WHERE post_id = $1
     GROUP BY selected_index
     ORDER BY selected_index ASC`,
    [postId]
  );

  publishRealtimeEvent('campus_poll_vote', {
    collegeId: context.collegeId,
    postId
  });

  return res.json({ postId, votes: tally.rows });
});

module.exports = router;
