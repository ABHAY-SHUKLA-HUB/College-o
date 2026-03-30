const crypto = require('crypto');
const { pool } = require('../db/pool');
const { publishRealtimeEvent } = require('./realtimeBus');
const { sendSystemEmail } = require('../utils/mailer');
const { buildNotificationEmail } = require('../utils/emailTemplates');

let campusFeedSchemaReady = false;

async function ensureCampusFeedSchema() {
  if (campusFeedSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_creator_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
      trust_level VARCHAR(20) NOT NULL DEFAULT 'new',
      campus_role VARCHAR(30) NOT NULL DEFAULT 'regular_student',
      manual_trust_level VARCHAR(20),
      manual_campus_role VARCHAR(30),
      posting_suspended BOOLEAN NOT NULL DEFAULT FALSE,
      suspension_reason TEXT,
      suspended_until TIMESTAMP,
      suspended_by INTEGER REFERENCES users(id),
      trust_score INTEGER NOT NULL DEFAULT 0,
      total_points INTEGER NOT NULL DEFAULT 0,
      approved_posts INTEGER NOT NULL DEFAULT 0,
      rejected_posts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE student_feed_creator_profiles
      ADD COLUMN IF NOT EXISTS manual_trust_level VARCHAR(20),
      ADD COLUMN IF NOT EXISTS manual_campus_role VARCHAR(30),
      ADD COLUMN IF NOT EXISTS posting_suspended BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
      ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMP,
      ADD COLUMN IF NOT EXISTS suspended_by INTEGER REFERENCES users(id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_posts (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
      title VARCHAR(220) NOT NULL,
      description TEXT NOT NULL,
      content_hash VARCHAR(64),
      post_type VARCHAR(30) NOT NULL,
      category VARCHAR(40) NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      poll_options JSONB,
      poll_ends_at TIMESTAMP,
      media_url TEXT,
      media_type VARCHAR(30),
      event_starts_at TIMESTAMP,
      event_venue VARCHAR(200),
      is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
      moderation_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      moderation_reason TEXT,
      admin_notes TEXT,
      moderated_by INTEGER REFERENCES users(id),
      moderated_at TIMESTAMP,
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      is_trending BOOLEAN NOT NULL DEFAULT FALSE,
      last_trending_notified_at TIMESTAMP,
      like_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      share_count INTEGER NOT NULL DEFAULT 0,
      save_count INTEGER NOT NULL DEFAULT 0,
      quality_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      retention_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      low_quality_penalty NUMERIC(8,2) NOT NULL DEFAULT 0,
      points_earned INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE student_feed_posts
      ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS poll_options JSONB,
      ADD COLUMN IF NOT EXISTS poll_ends_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS admin_notes TEXT,
      ADD COLUMN IF NOT EXISTS retention_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS low_quality_penalty NUMERIC(8,2) NOT NULL DEFAULT 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_engagements (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      post_id INTEGER NOT NULL REFERENCES student_feed_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      engagement_type VARCHAR(20) NOT NULL,
      is_valid BOOLEAN NOT NULL DEFAULT TRUE,
      fraud_reason VARCHAR(120),
      ip_hash VARCHAR(64),
      device_hash VARCHAR(64),
      session_hash VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (post_id, user_id, engagement_type)
    )
  `);

  await pool.query(`
    ALTER TABLE student_feed_engagements
      ADD COLUMN IF NOT EXISTS is_valid BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS fraud_reason VARCHAR(120),
      ADD COLUMN IF NOT EXISTS ip_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS device_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS session_hash VARCHAR(64)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_comments (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      post_id INTEGER NOT NULL REFERENCES student_feed_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      is_valid BOOLEAN NOT NULL DEFAULT TRUE,
      fraud_reason VARCHAR(120),
      ip_hash VARCHAR(64),
      device_hash VARCHAR(64),
      session_hash VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE student_feed_comments
      ADD COLUMN IF NOT EXISTS is_valid BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS fraud_reason VARCHAR(120),
      ADD COLUMN IF NOT EXISTS ip_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS device_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS session_hash VARCHAR(64)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_view_signals (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      post_id INTEGER NOT NULL REFERENCES student_feed_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
      watch_seconds INTEGER NOT NULL DEFAULT 0,
      dwell_seconds INTEGER NOT NULL DEFAULT 0,
      scroll_depth NUMERIC(5,2) NOT NULL DEFAULT 0,
      completion_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
      is_valid BOOLEAN NOT NULL DEFAULT TRUE,
      ip_hash VARCHAR(64),
      session_hash VARCHAR(64),
      device_hash VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (post_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_poll_votes (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      post_id INTEGER NOT NULL REFERENCES student_feed_posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      selected_index INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (post_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_reports (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      post_id INTEGER NOT NULL REFERENCES student_feed_posts(id) ON DELETE CASCADE,
      reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
      reason VARCHAR(40) NOT NULL,
      details TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (post_id, reporter_user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_collections (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, college_id, name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_collection_posts (
      collection_id INTEGER NOT NULL REFERENCES student_feed_collections(id) ON DELETE CASCADE,
      post_id INTEGER NOT NULL REFERENCES student_feed_posts(id) ON DELETE CASCADE,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection_id, post_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_security_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      post_id INTEGER REFERENCES student_feed_posts(id) ON DELETE SET NULL,
      college_id INTEGER REFERENCES colleges(id) ON DELETE SET NULL,
      event_type VARCHAR(50) NOT NULL,
      reason VARCHAR(220),
      ip_hash VARCHAR(64),
      session_hash VARCHAR(64),
      device_hash VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_feed_point_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      creator_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      post_id INTEGER REFERENCES student_feed_posts(id) ON DELETE CASCADE,
      college_id INTEGER NOT NULL REFERENCES colleges(id) ON DELETE CASCADE,
      event_type VARCHAR(40) NOT NULL,
      event_key VARCHAR(160) UNIQUE NOT NULL,
      points INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE student_feed_point_events
      ALTER COLUMN post_id DROP NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_feed_posts_college_status_created
      ON student_feed_posts (college_id, moderation_status, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_feed_posts_content_hash
      ON student_feed_posts (college_id, user_id, content_hash, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_feed_posts_college_category
      ON student_feed_posts (college_id, moderation_status, category, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_feed_posts_college_trending
      ON student_feed_posts (college_id, moderation_status, is_trending, updated_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_feed_engagements_post_valid
      ON student_feed_engagements (post_id, is_valid, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_student_feed_security_events_college
      ON student_feed_security_events (college_id, created_at DESC)
  `);

  campusFeedSchemaReady = true;
}

function normalizePostType(postType) {
  const allowed = new Set([
    'image',
    'video',
    'text',
    'event',
    'achievement',
    'alert',
    'official',
    'poll',
    'announcement',
    'lost_found',
    'placement_update',
    'event_coverage'
  ]);
  const value = String(postType || '').trim().toLowerCase();
  return allowed.has(value) ? value : null;
}

function normalizeCategory(category) {
  const allowed = new Set(['latest', 'official', 'events', 'achievements', 'alerts', 'placements', 'lost_found', 'announcements']);
  const value = String(category || '').trim().toLowerCase();
  return allowed.has(value) ? value : null;
}

function normalizeCampusRole(value) {
  const allowed = new Set(['regular_student', 'campus_reporter', 'verified_contributor']);
  const role = String(value || '').trim().toLowerCase();
  return allowed.has(role) ? role : null;
}

function normalizeTags(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean).slice(0, 10))];
}

async function resolveUserCollegeId(userId) {
  const { rows } = await pool.query(
    'SELECT id, college_name FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  const user = rows[0];
  if (!user) return null;

  const collegeName = String(user.college_name || '').trim();
  if (!collegeName) {
    const error = new Error('Please set your college in profile before using campus feed.');
    error.status = 400;
    throw error;
  }

  const existing = await pool.query(
    'SELECT id, name FROM colleges WHERE LOWER(name) = LOWER($1) LIMIT 1',
    [collegeName]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await pool.query(
    `INSERT INTO colleges (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [collegeName]
  );
  return created.rows[0].id;
}

async function createNotification(userId, kind, message) {
  await pool.query(
    'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
    [userId, message, kind]
  );

  try {
    const recipient = await pool.query(
      `SELECT email, full_name, is_email_verified
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    const row = recipient.rows[0];
    if (row?.email && row?.is_email_verified !== false) {
      const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
      const template = buildNotificationEmail({
        kind,
        title: `Hello ${row.full_name || 'Student'}, here is your update`,
        message,
        ctaUrl: `${baseUrl.replace(/\/$/, '')}/notifications.html`
      });
      await sendSystemEmail({
        to: row.email,
        subject: template.subject,
        text: template.text,
        html: template.html
      });
    }
  } catch (error) {
    if (process.env.DEBUG_AUTH === 'true') {
      // Email send failures should not break feed workflows.
      console.error('[Campus Email Notify Error]', error.message);
    }
  }

  publishRealtimeEvent('notification_changed', {
    userId: Number(userId),
    kind,
    message
  });
}

function hashSignal(input) {
  return crypto.createHash('sha256').update(String(input || 'unknown')).digest('hex');
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function classifyPostRisk({ title, description }) {
  const text = `${normalizeText(title)} ${normalizeText(description)}`.trim();
  const reasons = [];
  const abusiveLexicon = [
    /\bfuck\b/i,
    /\bbitch\b/i,
    /\bslur\b/i,
    /\bkill\b/i,
    /\bsex\b/i,
    /\bscam\b/i
  ];

  if (text.length < 24) reasons.push('low_quality_short_content');
  if (/(.)\1{7,}/.test(text)) reasons.push('repetitive_text_pattern');
  if (/https?:\/\//i.test(text) && text.split('http').length > 3) reasons.push('excessive_link_spam');
  if (abusiveLexicon.some((pattern) => pattern.test(text))) reasons.push('abusive_or_unsafe_terms');

  const hash = crypto.createHash('sha256').update(text).digest('hex');
  return { reasons, hash };
}

async function evaluateSubmissionRisk({ userId, collegeId, title, description }) {
  const local = classifyPostRisk({ title, description });

  const duplicate = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM student_feed_posts
     WHERE user_id = $1
       AND college_id = $2
       AND content_hash = $3
       AND created_at >= NOW() - INTERVAL '24 hours'`,
    [userId, collegeId, local.hash]
  );

  const burst = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM student_feed_posts
     WHERE user_id = $1
       AND created_at >= NOW() - INTERVAL '10 minutes'`,
    [userId]
  );

  const reasons = [...local.reasons];
  if (Number(duplicate.rows[0]?.total || 0) >= 1) reasons.push('duplicate_submission_24h');
  if (Number(burst.rows[0]?.total || 0) >= 5) reasons.push('submission_rate_spike');

  return {
    reasons,
    contentHash: local.hash,
    isRisky: reasons.length > 0
  };
}

async function assertCreatorCanPost(userId, collegeId) {
  const row = await pool.query(
    `SELECT posting_suspended, suspension_reason, suspended_until
     FROM student_feed_creator_profiles
     WHERE user_id = $1 AND college_id = $2
     LIMIT 1`,
    [userId, collegeId]
  );
  const profile = row.rows[0];
  if (!profile) return;

  if (!profile.posting_suspended) return;

  const suspendedUntil = profile.suspended_until ? new Date(profile.suspended_until) : null;
  if (!suspendedUntil || suspendedUntil.getTime() > Date.now()) {
    const error = new Error(profile.suspension_reason || 'Posting is temporarily suspended by admin moderation controls.');
    error.status = 403;
    throw error;
  }

  await pool.query(
    `UPDATE student_feed_creator_profiles
     SET posting_suspended = FALSE,
         suspension_reason = NULL,
         suspended_until = NULL,
         suspended_by = NULL,
         updated_at = NOW()
     WHERE user_id = $1 AND college_id = $2`,
    [userId, collegeId]
  );
}

function resolveFraudSignals(req) {
  const userAgent = String(req.headers['user-agent'] || 'unknown-agent');
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || req.ip || req.socket?.remoteAddress || '0.0.0.0';
  const sessionId = String(req.sessionID || req.session?.id || 'no-session');
  const deviceHeader = String(req.headers['x-device-id'] || '').trim();
  const deviceSource = deviceHeader || `${userAgent}:${sessionId}`;

  return {
    ipHash: hashSignal(ip),
    sessionHash: hashSignal(sessionId),
    deviceHash: hashSignal(deviceSource)
  };
}

async function writeSecurityEvent({ userId = null, postId = null, collegeId = null, eventType, reason, ipHash = null, sessionHash = null, deviceHash = null }) {
  await pool.query(
    `INSERT INTO student_feed_security_events (
      user_id, post_id, college_id, event_type, reason, ip_hash, session_hash, device_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, postId, collegeId, eventType, reason || null, ipHash, sessionHash, deviceHash]
  );
}

async function runEngagementFraudChecks({ postId, userId, collegeId, engagementType, ipHash, sessionHash, deviceHash }) {
  const [minuteRate, hourRate, ipDuplicate, sessionRate, spikeCheck] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM student_feed_engagements
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 minute'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM student_feed_engagements
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 hour'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM student_feed_engagements
       WHERE post_id = $1
         AND engagement_type = $2
         AND ip_hash = $3
         AND user_id <> $4
         AND created_at >= NOW() - INTERVAL '20 minutes'`,
      [postId, engagementType, ipHash, userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM student_feed_engagements
       WHERE (session_hash = $1 OR device_hash = $2)
         AND created_at >= NOW() - INTERVAL '1 minute'`,
      [sessionHash, deviceHash]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(DISTINCT user_id)::int AS unique_users
       FROM student_feed_engagements
       WHERE post_id = $1
         AND created_at >= NOW() - INTERVAL '5 minutes'
         AND is_valid = TRUE`,
      [postId]
    )
  ]);

  const reasons = [];
  if (Number(minuteRate.rows[0]?.total || 0) >= 20) reasons.push('user_rate_limit_minute');
  if (Number(hourRate.rows[0]?.total || 0) >= 120) reasons.push('user_rate_limit_hour');
  if (Number(ipDuplicate.rows[0]?.total || 0) >= 3) reasons.push('ip_duplicate_pattern');
  if (Number(sessionRate.rows[0]?.total || 0) >= 15) reasons.push('device_or_session_abuse');

  const spikeTotal = Number(spikeCheck.rows[0]?.total || 0);
  const uniqueUsers = Number(spikeCheck.rows[0]?.unique_users || 0);
  if (spikeTotal >= 40 && uniqueUsers <= 10) reasons.push('suspicious_engagement_spike');

  return {
    isValid: reasons.length === 0,
    reasons
  };
}

async function runSignalFraudChecks({ userId, postId, ipHash, sessionHash, deviceHash, dwellSeconds }) {
  const [burstSignals, sessionBurst] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM student_feed_view_signals
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '1 minute'`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM student_feed_view_signals
       WHERE post_id = $1
         AND (ip_hash = $2 OR session_hash = $3 OR device_hash = $4)
         AND created_at >= NOW() - INTERVAL '5 minutes'`,
      [postId, ipHash, sessionHash, deviceHash]
    )
  ]);

  const reasons = [];
  if (Number(burstSignals.rows[0]?.total || 0) >= 25) reasons.push('signal_rate_limit');
  if (Number(sessionBurst.rows[0]?.total || 0) >= 8) reasons.push('signal_device_burst');
  if (Number(dwellSeconds || 0) > 3600) reasons.push('invalid_dwell_time');

  return {
    isValid: reasons.length === 0,
    reasons
  };
}

async function refreshPostQuality(postId) {
  const engagement = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE engagement_type = 'like' AND is_valid = TRUE)::int AS likes,
       COUNT(*) FILTER (WHERE engagement_type = 'share' AND is_valid = TRUE)::int AS shares,
       COUNT(*) FILTER (WHERE engagement_type = 'save' AND is_valid = TRUE)::int AS saves,
       COUNT(DISTINCT user_id) FILTER (WHERE is_valid = TRUE)::int AS unique_engagers
     FROM student_feed_engagements
     WHERE post_id = $1`,
    [postId]
  );

  const commentCountResult = await pool.query(
    'SELECT COUNT(*)::int AS comments FROM student_feed_comments WHERE post_id = $1 AND is_valid = TRUE',
    [postId]
  );

  const retentionResult = await pool.query(
    `SELECT
       COALESCE(AVG(completion_rate), 0)::numeric(10,2) AS completion,
       COALESCE(AVG(scroll_depth), 0)::numeric(10,2) AS scroll_depth,
       COALESCE(AVG(dwell_seconds), 0)::numeric(10,2) AS dwell
     FROM student_feed_view_signals
     WHERE post_id = $1
       AND is_valid = TRUE`,
    [postId]
  );

  const likes = Number(engagement.rows[0]?.likes || 0);
  const shares = Number(engagement.rows[0]?.shares || 0);
  const saves = Number(engagement.rows[0]?.saves || 0);
  const uniqueEngagers = Number(engagement.rows[0]?.unique_engagers || 0);
  const comments = Number(commentCountResult.rows[0]?.comments || 0);
  const completion = Number(retentionResult.rows[0]?.completion || 0);
  const scrollDepth = Number(retentionResult.rows[0]?.scroll_depth || 0);
  const dwell = Number(retentionResult.rows[0]?.dwell || 0);

  const retentionScore = (completion * 0.65) + (Math.min(100, scrollDepth) * 0.2) + (Math.min(180, dwell) / 180 * 100 * 0.15);
  const lowQualityPenalty = retentionScore < 25 && (likes + comments + shares) < 4 ? 8 : retentionScore < 15 ? 12 : 0;

  const qualityScore = (
    (likes * 1.1)
    + (comments * 2.8)
    + (shares * 3.4)
    + (saves * 0.7)
    + (uniqueEngagers * 1.6)
    + (retentionScore * 0.35)
    - lowQualityPenalty
  );

  const updated = await pool.query(
    `UPDATE student_feed_posts
     SET like_count = $2,
         comment_count = $3,
         share_count = $4,
         save_count = $5,
         quality_score = $6,
            retention_score = $7,
            low_quality_penalty = $8,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
          [postId, likes, comments, shares, saves, qualityScore, retentionScore, lowQualityPenalty]
  );

  return updated.rows[0] || null;
}

async function grantCreatorPoints({
  post,
  actorUserId,
  eventType,
  points,
  eventKey,
  allowSelf = false
}) {
  if (!post || post.moderation_status !== 'approved') return { awarded: false, reason: 'not_approved' };
  if (!allowSelf && Number(post.user_id) === Number(actorUserId)) return { awarded: false, reason: 'self_engagement' };
  if (!points || points <= 0) return { awarded: false, reason: 'invalid_points' };

  const insert = await pool.query(
    `INSERT INTO student_feed_point_events (
      creator_user_id, actor_user_id, post_id, college_id, event_type, event_key, points
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (event_key) DO NOTHING
    RETURNING id`,
    [post.user_id, actorUserId || null, post.id, post.college_id, eventType, eventKey, points]
  );

  if (!insert.rows[0]) return { awarded: false, reason: 'duplicate' };

  await pool.query(
    `UPDATE student_feed_posts
     SET points_earned = COALESCE(points_earned, 0) + $2,
         updated_at = NOW()
     WHERE id = $1`,
    [post.id, points]
  );

  await createNotification(
    post.user_id,
    'campus_points_earned',
    `You earned +${points} creator points from campus feed engagement.`
  );

  return { awarded: true };
}

async function adjustCreatorPoints({ creatorUserId, collegeId, delta, reason, adminUserId }) {
  const amount = Number(delta || 0);
  if (!Number.isInteger(amount) || amount === 0) {
    const error = new Error('Points delta must be a non-zero integer');
    error.status = 400;
    throw error;
  }

  const latestPost = await pool.query(
    `SELECT id
     FROM student_feed_posts
     WHERE user_id = $1 AND college_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [creatorUserId, collegeId]
  );

  const postId = latestPost.rows[0]?.id || null;
  const eventKey = `manual:${creatorUserId}:${adminUserId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  await pool.query(
    `INSERT INTO student_feed_point_events (
      creator_user_id, actor_user_id, post_id, college_id, event_type, event_key, points
    ) VALUES ($1, $2, $3, $4, 'admin_adjustment', $5, $6)`,
    [creatorUserId, adminUserId || null, postId, collegeId, eventKey, amount]
  );

  if (postId) {
    await pool.query(
      `UPDATE student_feed_posts
       SET points_earned = GREATEST(0, COALESCE(points_earned, 0) + $2),
           updated_at = NOW()
       WHERE id = $1`,
      [postId, amount]
    );
  }

  await createNotification(
    creatorUserId,
    'campus_points_adjusted',
    `${amount > 0 ? 'Bonus' : 'Adjustment'} points ${amount > 0 ? '+' : ''}${amount} were applied by moderation.${reason ? ` Reason: ${reason}` : ''}`
  );
}

async function updateCreatorProfile(userId, collegeId) {
  const stats = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE moderation_status = 'approved')::int AS approved_posts,
       COUNT(*) FILTER (WHERE moderation_status = 'rejected')::int AS rejected_posts,
       COALESCE(SUM(points_earned), 0)::int AS total_points,
       COALESCE(AVG(quality_score), 0)::numeric(10,2) AS avg_quality,
       COUNT(*) FILTER (WHERE moderation_status = 'approved' AND is_trending = TRUE)::int AS trending_posts
     FROM student_feed_posts
     WHERE user_id = $1 AND college_id = $2`,
    [userId, collegeId]
  );

  const approvedPosts = Number(stats.rows[0]?.approved_posts || 0);
  const rejectedPosts = Number(stats.rows[0]?.rejected_posts || 0);
  const totalPoints = Number(stats.rows[0]?.total_points || 0);
  const avgQuality = Number(stats.rows[0]?.avg_quality || 0);
  const trendingPosts = Number(stats.rows[0]?.trending_posts || 0);
  const totalReviewed = approvedPosts + rejectedPosts;
  const rejectionRate = totalReviewed > 0 ? rejectedPosts / totalReviewed : 0;

  let trustLevel = 'new';
  if (approvedPosts >= 20 && totalPoints >= 250 && avgQuality >= 15 && rejectionRate < 0.2) {
    trustLevel = 'verified';
  } else if (approvedPosts >= 5 && totalPoints >= 50 && avgQuality >= 6 && rejectionRate < 0.35) {
    trustLevel = 'trusted';
  }

  let campusRole = 'regular_student';
  if (approvedPosts >= 8 && trustLevel !== 'new') campusRole = 'campus_reporter';
  if (trustLevel === 'verified' || (trendingPosts >= 3 && totalPoints >= 300)) campusRole = 'verified_contributor';

  const trustScore = Math.round((approvedPosts * 6) + totalPoints - (rejectedPosts * 8) + avgQuality + (trendingPosts * 5));

  const manual = await pool.query(
    `SELECT manual_trust_level, manual_campus_role, posting_suspended, suspension_reason, suspended_until, suspended_by
     FROM student_feed_creator_profiles
     WHERE user_id = $1`,
    [userId]
  );

  const manualTrustLevel = manual.rows[0]?.manual_trust_level || null;
  const manualCampusRole = manual.rows[0]?.manual_campus_role || null;
  const postingSuspended = Boolean(manual.rows[0]?.posting_suspended);
  const suspensionReason = manual.rows[0]?.suspension_reason || null;
  const suspendedUntil = manual.rows[0]?.suspended_until || null;
  const suspendedBy = manual.rows[0]?.suspended_by || null;

  if (manualTrustLevel) trustLevel = manualTrustLevel;
  if (manualCampusRole) campusRole = manualCampusRole;

  const { rows } = await pool.query(
    `INSERT INTO student_feed_creator_profiles (
      user_id, college_id, trust_level, campus_role, trust_score, total_points, approved_posts, rejected_posts, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
      college_id = EXCLUDED.college_id,
      trust_level = EXCLUDED.trust_level,
      campus_role = EXCLUDED.campus_role,
      trust_score = EXCLUDED.trust_score,
      total_points = EXCLUDED.total_points,
      approved_posts = EXCLUDED.approved_posts,
      rejected_posts = EXCLUDED.rejected_posts,
      posting_suspended = $9,
      suspension_reason = $10,
      suspended_until = $11,
      suspended_by = $12,
      updated_at = NOW()
    RETURNING *`,
    [userId, collegeId, trustLevel, campusRole, trustScore, totalPoints, approvedPosts, rejectedPosts, postingSuspended, suspensionReason, suspendedUntil, suspendedBy]
  );

  return rows[0] || null;
}

module.exports = {
  ensureCampusFeedSchema,
  normalizePostType,
  normalizeCategory,
  normalizeCampusRole,
  normalizeTags,
  resolveUserCollegeId,
  createNotification,
  resolveFraudSignals,
  runEngagementFraudChecks,
  runSignalFraudChecks,
  evaluateSubmissionRisk,
  assertCreatorCanPost,
  writeSecurityEvent,
  refreshPostQuality,
  grantCreatorPoints,
  adjustCreatorPoints,
  updateCreatorProfile
};
