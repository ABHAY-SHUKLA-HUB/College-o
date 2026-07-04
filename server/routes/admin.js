const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { isEmail, normalizeEmail } = require('../utils/validation');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');
const { getOtpTestEmail, sendSystemEmail } = require('../utils/mailer');

const router = express.Router();

const ADMIN_RATE_STATE = new Map();
const ADMIN_RATE_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 20;
const ADMIN_LOGIN_LOCK_THRESHOLD = 5;
const ADMIN_LOGIN_LOCK_MS = 20 * 60 * 1000;
const CAPTCHA_SECRET = process.env.AUTH_CAPTCHA_SECRET || process.env.SESSION_SECRET || 'dev-captcha-secret';

function getRequesterIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.ip || 'unknown';
}

function enforceAdminRateLimit(req, res) {
  const key = `admin:login:${getRequesterIp(req)}`;
  const now = Date.now();
  const existing = ADMIN_RATE_STATE.get(key);
  if (!existing || existing.resetAt <= now) {
    ADMIN_RATE_STATE.set(key, { count: 1, resetAt: now + ADMIN_RATE_WINDOW_MS });
    return null;
  }
  existing.count += 1;
  if (existing.count > ADMIN_LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  return null;
}

function verifyCaptchaPayload(req, captcha) {
  // CRITICAL: Reject missing capscha (fail-closed, not fail-open)
  if (!captcha || typeof captcha !== 'object') return false;
  
  const answer = Number(captcha.answer);
  const a = Number(captcha.a);
  const b = Number(captcha.b);
  const expiresAt = Number(captcha.expiresAt);
  const nonce = String(captcha.nonce || '');
  const signature = String(captcha.signature || '');
  if (!Number.isInteger(answer) || !Number.isInteger(a) || !Number.isInteger(b) || !expiresAt || !nonce || !signature) {
    return false;
  }
  if (Date.now() > expiresAt) return false;
  const payload = `${a}:${b}:${expiresAt}:${nonce}`;
  const expected = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('hex');
  return expected === signature && answer === a + b;
}

async function ensureAdminAuthColumns() {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMP
  `);
}

const upload = createUploadMiddleware({
  maxFileSize: 15 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf'],
  allowedExtensions: ['.pdf'],
  invalidTypeMessage: 'Only PDF files are allowed'
});

router.post('/login', async (req, res) => {
  const limited = enforceAdminRateLimit(req, res);
  if (limited) return;

  await ensureAdminAuthColumns();

  const { email, password, captcha } = req.body;
  if (!verifyCaptchaPayload(req, captcha)) {
    return res.status(400).json({ error: 'Captcha validation failed' });
  }
  if (!isEmail(email) || !password) return res.status(401).json({ error: 'Invalid email or password' });

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return res.status(429).json({ error: 'Too many failed attempts. Please try again later.' });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid || user.role !== 'admin') {
    const failedAttempts = Number(user.failed_login_attempts || 0) + 1;
    const lockUntil = failedAttempts >= ADMIN_LOGIN_LOCK_THRESHOLD
      ? new Date(Date.now() + ADMIN_LOGIN_LOCK_MS)
      : null;
    await pool.query(
      `UPDATE users
       SET failed_login_attempts = $2,
           locked_until = $3,
           last_failed_login_at = NOW()
       WHERE id = $1`,
      [user.id, failedAttempts, lockUntil]
    );
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL,
         last_login_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

  req.session.regenerate((sessionError) => {
    if (sessionError) {
      return res.status(500).json({ error: 'Could not start secure session' });
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.cookie.maxAge = 1000 * 60 * 60 * 12;

    return res.json({ user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role } });
  });

  return;
});

router.post('/users/admin', requireAdmin, async (req, res) => {
  const { fullName, email, password } = req.body;
  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'fullName, email, password are required' });
  }

  const exists = await pool.query('SELECT id FROM users WHERE email = $1', [String(email).toLowerCase()]);
  if (exists.rowCount > 0) return res.status(409).json({ error: 'Email already exists' });

  const hash = await bcrypt.hash(password, 12);
  const referralCode = `ADM${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, college_name, password_hash, referral_code, role, subscription_tier)
     VALUES ($1, $2, $3, $4, $5, 'admin', 'premium')
     RETURNING id, full_name, email, role`,
    [fullName, String(email).toLowerCase(), 'College OS', hash, referralCode]
  );

  res.status(201).json({ admin: rows[0] });
});

router.get('/dashboard', requireAdmin, async (_req, res) => {
  const [students, premium, subs, feedback, colleges, pendingApprovals, expiredUsers, monthlyRevenue, dailyActiveUsers, liveSessionTotals] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'student'"),
    pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'student' AND subscription_tier = 'premium'"),
    pool.query("SELECT COALESCE(SUM(amount_inr), 0)::numeric(10,2) AS revenue FROM subscriptions WHERE status = 'active'"),
    pool.query('SELECT COUNT(*)::int AS total FROM feedback'),
    pool.query("SELECT COUNT(DISTINCT college_name)::int AS total FROM users WHERE role = 'student'"),
    pool.query("SELECT COUNT(*)::int AS total FROM membership_payment_requests WHERE status = 'pending'"),
    pool.query("SELECT COUNT(*)::int AS total FROM users WHERE role = 'student' AND payment_status = 'expired'"),
    pool.query(
      `SELECT COALESCE(SUM(amount_inr), 0)::numeric(10,2) AS revenue
       FROM membership_payment_requests
       WHERE status = 'approved' AND approved_at >= DATE_TRUNC('month', NOW())`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users
       WHERE role = 'student'
         AND deleted_at IS NULL
         AND last_login_at >= CURRENT_DATE`
    ),
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'live')::int AS live_sessions,
        COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled_sessions,
        COUNT(*) FILTER (WHERE status = 'ended')::int AS ended_sessions,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_sessions,
        COALESCE(SUM(COALESCE(participant_count, 0)), 0)::int AS active_participants,
        COALESCE(ROUND(100.0 * SUM(COALESCE(participant_count, 0)) / NULLIF(SUM(COALESCE(max_participants, 0)), 0), 2), 0) AS attendance_rate
       FROM live_sessions`
    )
  ]);

  res.json({
    totalStudents: students.rows[0].total,
    premiumStudents: premium.rows[0].total,
    revenueInr: Number(subs.rows[0].revenue),
    totalFeedback: feedback.rows[0].total,
    collegesCovered: colleges.rows[0].total,
    pendingApprovals: pendingApprovals.rows[0].total,
    expiredUsers: expiredUsers.rows[0].total,
    monthlyRevenueInr: Number(monthlyRevenue.rows[0].revenue),
    dailyActiveUsers: dailyActiveUsers.rows[0].total,
    liveSessions: liveSessionTotals.rows[0]
  });
});

async function sendAdminEmailTest(req, res) {
  const to = getOtpTestEmail();
  if (!to) {
    return res.status(500).json({ success: false, message: 'OTP test email is not configured.' });
  }

  const result = await sendSystemEmail({
    to,
    subject: 'College OS Verification Code',
    text: 'This is a test email from College OS to verify the active email provider on Render.',
    html: '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a"><h2>College OS Verification Code</h2><p>This is a test email from College OS to verify the active email provider on Render.</p><p>If you received this, email delivery is working.</p></div>'
  });

  if (!result.sent) {
    console.warn('[Admin Email Test] send failed', {
      reason: result.reason,
      code: result.error?.code,
      message: result.error?.message
    });
    return res.status(500).json({ success: false, message: 'Failed to send test email.' });
  }

  return res.json({ success: true, message: 'Test email sent.' });
}

router.get('/test-email', requireAdmin, sendAdminEmailTest);
router.get('/test-smtp', requireAdmin, sendAdminEmailTest);

router.get('/membership-payments', requireAdmin, async (req, res) => {
  const status = String(req.query.status || 'all').toLowerCase();
  const params = [];
  let where = '';
  if (status !== 'all') {
    params.push(status);
    where = `WHERE m.status = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT
      m.id,
      m.user_id,
      m.full_name,
      m.email,
      m.payment_method,
      m.transaction_id,
      m.screenshot_url,
      m.payment_date,
      m.amount_inr,
      m.note,
      m.status,
      m.rejection_reason,
      m.submitted_at,
      m.approved_at,
      m.expiry_date,
      approver.full_name AS approved_by_name
     FROM membership_payment_requests m
     LEFT JOIN users approver ON approver.id = m.approved_by
     ${where}
     ORDER BY m.submitted_at DESC`,
    params
  );

  res.json({ payments: rows });
});

router.put('/membership-payments/:id/status', requireAdmin, async (req, res) => {
  const requestId = Number(req.params.id);
  const nextStatus = String(req.body.status || '').toLowerCase();
  const reason = String(req.body.reason || '').trim() || null;

  if (!['approved', 'rejected', 'pending'].includes(nextStatus)) {
    return res.status(400).json({ error: 'status must be approved, rejected, or pending' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payment = await client.query(
      'SELECT * FROM membership_payment_requests WHERE id = $1 FOR UPDATE',
      [requestId]
    );
    const row = payment.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment request not found' });
    }

    if (nextStatus === 'approved') {
      const cfg = await client.query("SELECT value_json FROM platform_settings WHERE key = 'membership_center_config' LIMIT 1");
      const premiumCfg = cfg.rows[0]?.value_json?.plans?.premium || {};
      const durationDays = Number(premiumCfg.durationDays || 30);
      const amountInr = Number(premiumCfg.priceInr || row.amount_inr || 49);

      const updatePayment = await client.query(
        `UPDATE membership_payment_requests
         SET status = 'approved',
             rejection_reason = NULL,
             approved_at = NOW(),
             approved_by = $1,
             expiry_date = NOW() + ($3::int * INTERVAL '1 day'),
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [req.session.userId, requestId, durationDays]
      );

      await client.query(
        `UPDATE users
         SET subscription_tier = 'premium',
             payment_status = 'approved',
             subscription_started_at = NOW(),
             subscription_expiry = NOW() + ($2::int * INTERVAL '1 day')
         WHERE id = $1`,
        [row.user_id, durationDays]
      );

      await client.query(
        `INSERT INTO subscriptions (user_id, plan_name, amount_inr, status, start_date, end_date)
         VALUES ($1, 'premium', $2, 'active', CURRENT_DATE, CURRENT_DATE + ($3::int * INTERVAL '1 day'))`,
        [row.user_id, amountInr, durationDays]
      );

      await client.query(
        'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
        [row.user_id, 'Your payment has been approved. Premium membership is now active.', 'payment_approved']
      );

      await client.query('COMMIT');
      return res.json({ payment: updatePayment.rows[0], message: 'Payment approved and premium activated' });
    }

    if (nextStatus === 'rejected') {
      const updatePayment = await client.query(
        `UPDATE membership_payment_requests
         SET status = 'rejected',
             rejection_reason = $1,
             approved_at = NULL,
             approved_by = $2,
             expiry_date = NULL,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [reason, req.session.userId, requestId]
      );

      await client.query(
        `UPDATE users
         SET subscription_tier = 'free', payment_status = 'rejected'
         WHERE id = $1`,
        [row.user_id]
      );

      await client.query(
        'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
        [row.user_id, reason ? `Your payment was rejected: ${reason}` : 'Your payment was rejected. Please submit a valid transaction proof.', 'payment_rejected']
      );

      await client.query('COMMIT');
      return res.json({ payment: updatePayment.rows[0], message: 'Payment rejected' });
    }

    const updatePayment = await client.query(
      `UPDATE membership_payment_requests
       SET status = 'pending',
           rejection_reason = NULL,
           approved_at = NULL,
           approved_by = NULL,
           expiry_date = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [requestId]
    );

    await client.query(
      `UPDATE users
       SET subscription_tier = 'free', payment_status = 'pending_approval'
       WHERE id = $1`,
      [row.user_id]
    );

    await client.query(
      'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
      [row.user_id, 'Your payment request is pending admin verification.', 'payment_pending']
    );

    await client.query('COMMIT');
    return res.json({ payment: updatePayment.rows[0], message: 'Payment marked as pending' });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.get('/students', requireAdmin, async (req, res) => {
  const college = req.query.college;
  const params = [];
  let where = "WHERE u.role = 'student'";
  if (college) {
    params.push(college);
    where += ` AND u.college_name = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.full_name,
       u.email,
       u.college_name,
       u.subscription_tier,
       COALESCE(SUM(qa.xp_earned), 0)::int AS xp,
       COUNT(qa.id)::int AS quizzes_attempted,
       COALESCE(ROUND(AVG(qa.score_percent), 2), 0) AS avg_quiz_score
     FROM users u
     LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
     ${where}
     GROUP BY u.id
     ORDER BY u.college_name, xp DESC`,
    params
  );

  res.json({ students: rows });
});

router.get('/students/report.xlsx', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
      u.full_name AS "Name",
      u.email AS "Email",
      u.college_name AS "College",
      u.subscription_tier AS "Subscription",
      COALESCE(SUM(qa.xp_earned), 0)::int AS "XP",
      COUNT(qa.id)::int AS "Quizzes Attempted",
      COALESCE(ROUND(AVG(qa.score_percent), 2), 0) AS "Average Quiz Score"
     FROM users u
     LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
     WHERE u.role = 'student'
     GROUP BY u.id
     ORDER BY "XP" DESC`
  );

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="student-progress-report.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.get('/trends', requireAdmin, async (_req, res) => {
  const [signups, revenue, collegeStats, quizTrend, liveSessionTrend, aiUsageTrend, attendanceHeatmap, hostLeaderboard, liveActiveUsers, sessionAuditSummary] = await Promise.all([
    pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
       FROM users
       WHERE role = 'student' AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY 1
       ORDER BY 1`
    ),
    pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day, COALESCE(SUM(amount_inr), 0)::numeric(10,2) AS amount
       FROM subscriptions
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY 1
       ORDER BY 1`
    ),
    pool.query(
      `SELECT college_name, COUNT(*)::int AS students
       FROM users
       WHERE role = 'student'
       GROUP BY college_name
       ORDER BY students DESC
       LIMIT 6`
    ),
    pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS attempts,
              COALESCE(ROUND(AVG(score_percent), 2), 0) AS avg_score
       FROM quiz_attempts
       WHERE created_at >= NOW() - INTERVAL '14 days'
       GROUP BY 1
       ORDER BY 1`
    ),
    pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('day', COALESCE(actual_start, scheduled_start)), 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE status = 'live')::int AS live_sessions,
              COUNT(*) FILTER (WHERE status = 'ended')::int AS ended_sessions,
              COALESCE(SUM(COALESCE(participant_count, 0)), 0)::int AS participant_total
       FROM live_sessions
       WHERE COALESCE(actual_start, scheduled_start) >= NOW() - INTERVAL '14 days'
       GROUP BY 1
       ORDER BY 1`
    ),
    pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS requests,
              COUNT(*) FILTER (WHERE success = TRUE)::int AS successful_requests,
              COUNT(*) FILTER (WHERE provider_used = 'azure_openai')::int AS azure_requests
       FROM ai_request_logs
       WHERE created_at >= NOW() - INTERVAL '14 days'
       GROUP BY 1
       ORDER BY 1`
    ),
    pool.query(
      `SELECT TO_CHAR(DATE_TRUNC('hour', COALESCE(actual_start, scheduled_start)), 'YYYY-MM-DD HH24:00') AS bucket,
              COUNT(*)::int AS sessions,
              COALESCE(SUM(COALESCE(participant_count, 0)), 0)::int AS participants
       FROM live_sessions
       WHERE COALESCE(actual_start, scheduled_start) >= NOW() - INTERVAL '7 days'
       GROUP BY 1
       ORDER BY 1`
    ),
    pool.query(
      `SELECT
         COALESCE(u.full_name, ls.assigned_host_email, 'Unassigned') AS host_name,
         COUNT(*)::int AS sessions,
         COALESCE(SUM(COALESCE(ls.participant_count, 0)), 0)::int AS participants,
         COUNT(*) FILTER (WHERE ls.status = 'ended')::int AS completed_sessions
       FROM live_sessions ls
       LEFT JOIN users u ON u.id = ls.assigned_host_user_id
       WHERE COALESCE(ls.scheduled_start, NOW()) >= NOW() - INTERVAL '30 days'
       GROUP BY 1
       ORDER BY sessions DESC, participants DESC
       LIMIT 8`
    ),
    pool.query(
      `SELECT COUNT(DISTINCT user_id)::int AS active_users
       FROM live_session_presence
       WHERE status = 'online' AND is_present = TRUE`
    ),
    pool.query(
      `SELECT action, COUNT(*)::int AS total
       FROM live_session_logs
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY 1
       ORDER BY total DESC
       LIMIT 8`
    )
  ]);

  res.json({
    signupTrend: signups.rows,
    revenueTrend: revenue.rows,
    collegeDistribution: collegeStats.rows,
    quizTrend: quizTrend.rows,
    liveSessionTrend: liveSessionTrend.rows,
    aiUsageTrend: aiUsageTrend.rows,
    attendanceHeatmap: attendanceHeatmap.rows,
    hostLeaderboard: hostLeaderboard.rows,
    liveActiveUsers: Number(liveActiveUsers.rows[0]?.active_users || 0),
    sessionAuditSummary: sessionAuditSummary.rows
  });
});

router.post('/content/notes', requireAdmin, upload.single('file'), async (req, res) => {
  const {
    subject,
    chapter,
    collegeName,
    difficulty,
    formatType,
    categoryId,
    branchId,
    semesterId,
    academicSubject,
    accessType,
    status,
    isCommon,
    collegeId,
    courseId,
    yearId
  } = req.body;

  if (!subject || !chapter) {
    return res.status(400).json({ error: 'subject and chapter are required' });
  }

  let fileUrl = null;
  if (req.file) {
    try {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'admin-uploads/notes',
        prefix: 'note'
      });
      fileUrl = stored.url;
    } catch (error) {
      return res.status(502).json({ error: 'Failed to upload note file' });
    }
  }
  const content = fileUrl ? `PDF uploaded: ${fileUrl}` : 'Admin uploaded note';
  const parsedIsCommon = String(isCommon || '').toLowerCase() === 'true' || String(isCommon || '').toLowerCase() === 'on';

  const { rows } = await pool.query(
    `INSERT INTO notes (
      subject, chapter, content, difficulty, format_type, created_by, college_name, pdf_url,
      category_id, branch_id, semester_id, academic_subject, access_type, status, is_common, college_id, course_id, year_id,
      source_type, approval_status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     RETURNING id, subject, chapter, college_name, pdf_url, category_id, branch_id, semester_id, created_at`,
    [
      subject,
      chapter,
      content,
      difficulty || null,
      formatType || 'detailed',
      req.session.userId,
      collegeName || null,
      fileUrl,
      categoryId ? Number(categoryId) : null,
      branchId ? Number(branchId) : null,
      semesterId ? Number(semesterId) : null,
      academicSubject || null,
      accessType || 'free',
      status || 'published',
      parsedIsCommon,
      collegeId ? Number(collegeId) : null,
      courseId ? Number(courseId) : null,
      yearId ? Number(yearId) : null,
      'admin_upload',
      'published'
    ]
  );

  res.status(201).json({ note: rows[0] });
});

router.post('/content/papers', requireAdmin, upload.single('file'), async (req, res) => {
  const {
    subject,
    examName,
    year,
    collegeName,
    categoryId,
    branchId,
    semesterId,
    accessType,
    status,
    isCommon,
    collegeId,
    courseId,
    yearId
  } = req.body;

  if (!subject || !examName || !year) {
    return res.status(400).json({ error: 'subject, examName, and year are required' });
  }

  let fileUrl = req.body.paperUrl || null;
  if (req.file) {
    try {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'admin-uploads/papers',
        prefix: 'paper'
      });
      fileUrl = stored.url;
    } catch (error) {
      return res.status(502).json({ error: 'Failed to upload paper file' });
    }
  }
  const parsedIsCommon = String(isCommon || '').toLowerCase() === 'true' || String(isCommon || '').toLowerCase() === 'on';
  const { rows } = await pool.query(
    `INSERT INTO previous_papers (
      subject, exam_name, year, paper_url, summary_note_url, college_name, uploaded_by,
      category_id, branch_id, semester_id, access_type, status, is_common, college_id, course_id, year_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id, subject, exam_name, year, paper_url, college_name, branch_id, semester_id, created_at`,
    [
      subject,
      examName,
      year,
      fileUrl,
      'notes-library.html',
      collegeName || null,
      req.session.userId,
      categoryId ? Number(categoryId) : null,
      branchId ? Number(branchId) : null,
      semesterId ? Number(semesterId) : null,
      accessType || 'free',
      status || 'published',
      parsedIsCommon,
      collegeId ? Number(collegeId) : null,
      courseId ? Number(courseId) : null,
      yearId ? Number(yearId) : null
    ]
  );

  res.status(201).json({ paper: rows[0] });
});

router.get('/feedback', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT f.id, f.rating, f.message, f.screenshot_url, f.admin_reply, f.created_at,
            u.full_name, u.email, u.college_name
     FROM feedback f
     JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC`
  );

  res.json({ feedback: rows });
});

router.put('/feedback/:id/reply', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { reply } = req.body;
  if (!reply) return res.status(400).json({ error: 'reply is required' });

  const { rows } = await pool.query(
    `UPDATE feedback
     SET admin_reply = $1, replied_by = $2, replied_at = NOW()
     WHERE id = $3
     RETURNING id, admin_reply, replied_at`,
    [reply, req.session.userId, id]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });
  res.json({ feedback: rows[0] });
});

// Papers management routes
router.get('/papers', requireAdmin, async (_req, res) => {
  const { categoryId, branchId, semesterId, status } = _req.query;
  const params = [];
  const clauses = [];

  if (categoryId) {
    params.push(Number(categoryId));
    clauses.push(`pp.category_id = $${params.length}`);
  }

  if (branchId) {
    params.push(Number(branchId));
    clauses.push(`pp.branch_id = $${params.length}`);
  }

  if (semesterId) {
    params.push(Number(semesterId));
    clauses.push(`(pp.semester_id = $${params.length} OR pp.semester_id IS NULL)`);
  }

  if (status) {
    params.push(status);
    clauses.push(`pp.status = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
      pp.id, pp.subject, pp.exam_name, pp.year, pp.college_name, pp.paper_url,
      pp.status, pp.is_common, pp.created_at,
      ac.name AS category_name, ab.name AS branch_name, asem.label AS semester_label
     FROM previous_papers pp
     LEFT JOIN academic_categories ac ON ac.id = pp.category_id
     LEFT JOIN academic_branches ab ON ab.id = pp.branch_id
     LEFT JOIN academic_semesters asem ON asem.id = pp.semester_id
     ${where}
     ORDER BY pp.created_at DESC`,
    params
  );
  res.json({ papers: rows });
});

router.delete('/papers/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM previous_papers WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Paper not found' });
  res.json({ message: 'Paper deleted successfully' });
});

// Materials management routes
router.get('/materials', requireAdmin, async (_req, res) => {
  const { categoryId, branchId, semesterId, status } = _req.query;
  const params = [];
  const clauses = [];

  if (categoryId) {
    params.push(Number(categoryId));
    clauses.push(`m.category_id = $${params.length}`);
  }

  if (branchId) {
    params.push(Number(branchId));
    clauses.push(`m.branch_id = $${params.length}`);
  }

  if (semesterId) {
    params.push(Number(semesterId));
    clauses.push(`(m.semester_id = $${params.length} OR m.semester_id IS NULL)`);
  }

  if (status) {
    params.push(status);
    clauses.push(`m.status = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
      m.id, m.title, m.category, m.subject, m.description, m.file_url,
      m.status, m.is_common, m.created_at,
      ac.name AS category_name, ab.name AS branch_name, asem.label AS semester_label
     FROM materials m
     LEFT JOIN academic_categories ac ON ac.id = m.category_id
     LEFT JOIN academic_branches ab ON ab.id = m.branch_id
     LEFT JOIN academic_semesters asem ON asem.id = m.semester_id
     ${where}
     ORDER BY m.created_at DESC`,
    params
  );
  res.json({ materials: rows });
});

router.post('/materials', requireAdmin, upload.single('file'), async (req, res) => {
  const {
    title,
    category,
    subject,
    description,
    categoryId,
    branchId,
    semesterId,
    accessType,
    status,
    isCommon,
    collegeId,
    courseId,
    yearId
  } = req.body;
  if (!title || !category || !subject) {
    return res.status(400).json({ error: 'title, category, subject are required' });
  }

  let fileUrl = null;
  if (req.file) {
    try {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'admin-uploads/materials',
        prefix: 'material'
      });
      fileUrl = stored.url;
    } catch (error) {
      return res.status(502).json({ error: 'Failed to upload material file' });
    }
  }
  const parsedIsCommon = String(isCommon || '').toLowerCase() === 'true' || String(isCommon || '').toLowerCase() === 'on';
  const { rows } = await pool.query(
    `INSERT INTO materials (
      title, category, subject, description, file_url, uploaded_by,
      category_id, branch_id, semester_id, access_type, status, is_common, college_id, course_id, year_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id, title, category, subject, file_url, category_id, branch_id, semester_id, created_at`,
    [
      title,
      category,
      subject,
      description,
      fileUrl,
      req.session.userId,
      categoryId ? Number(categoryId) : null,
      branchId ? Number(branchId) : null,
      semesterId ? Number(semesterId) : null,
      accessType || 'free',
      status || 'published',
      parsedIsCommon,
      collegeId ? Number(collegeId) : null,
      courseId ? Number(courseId) : null,
      yearId ? Number(yearId) : null
    ]
  );

  res.status(201).json({ material: rows[0] });
});

router.delete('/materials/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM materials WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Material not found' });
  res.json({ message: 'Material deleted successfully' });
});

// Admin quizzes management routes
router.get('/quizzes', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT q.id, q.title, q.subject, q.description, q.time_limit, q.created_at,
            COUNT(qq.id)::int AS question_count
     FROM admin_quizzes q
     LEFT JOIN admin_quiz_questions qq ON qq.quiz_id = q.id
     GROUP BY q.id
     ORDER BY q.created_at DESC`
  );
  res.json({ quizzes: rows });
});

router.post('/quizzes', requireAdmin, async (req, res) => {
  const { title, subject, description, timeLimit, questions } = req.body;
  if (!title || !subject || !questions || !Array.isArray(questions)) {
    return res.status(400).json({ error: 'title, subject, and questions array are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { rows: [quiz] } = await client.query(
      `INSERT INTO admin_quizzes (title, subject, description, time_limit, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [title, subject, description, timeLimit || null, req.session.userId]
    );

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await client.query(
        `INSERT INTO admin_quiz_questions (quiz_id, question_text, option_a, option_b, option_c, option_d, correct_answer, question_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [quiz.id, q.text, q.options.A, q.options.B, q.options.C, q.options.D, q.correct, i + 1]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ quiz: { id: quiz.id, title, subject, question_count: questions.length } });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/quizzes/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM admin_quizzes WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Quiz not found' });
  res.json({ message: 'Quiz deleted successfully' });
});

// Certificates management routes
let certificateSchemaEnsured = false;

async function ensureCertificateSchema() {
  if (certificateSchemaEnsured) return;

  await pool.query(
    `CREATE TABLE IF NOT EXISTS admin_certificates (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      title VARCHAR(200) NOT NULL,
      course VARCHAR(120) NOT NULL,
      student_email VARCHAR(180),
      issue_date DATE NOT NULL,
      description TEXT,
      issued_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await pool.query(
    `ALTER TABLE admin_certificates
      ADD COLUMN IF NOT EXISTS certificate_type VARCHAR(120),
      ADD COLUMN IF NOT EXISTS achievement_name VARCHAR(200),
      ADD COLUMN IF NOT EXISTS score_rank VARCHAR(80),
      ADD COLUMN IF NOT EXISTS certificate_id VARCHAR(120),
      ADD COLUMN IF NOT EXISTS organization_name VARCHAR(160),
      ADD COLUMN IF NOT EXISTS signatory_name VARCHAR(160),
      ADD COLUMN IF NOT EXISTS template_name VARCHAR(40) DEFAULT 'Classic',
      ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Draft',
      ADD COLUMN IF NOT EXISTS assigned_student_ids JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS issued_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS verification_id VARCHAR(120),
      ADD COLUMN IF NOT EXISTS is_bulk BOOLEAN DEFAULT false`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS admin_certificate_issuances (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      admin_certificate_id INTEGER NOT NULL REFERENCES admin_certificates(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      certificate_id INTEGER REFERENCES certificates(id) ON DELETE SET NULL,
      verification_code VARCHAR(120),
      status VARCHAR(20) NOT NULL DEFAULT 'Issued',
      issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      verified_at TIMESTAMP,
      revoked_at TIMESTAMP,
      UNIQUE (admin_certificate_id, user_id)
    )`
  );

  certificateSchemaEnsured = true;
}

function normalizeStudentIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

function createCertificateId() {
  return `CERT-${Date.now().toString().slice(-8)}`;
}

function createVerificationCode() {
  return `COL-${uuidv4().slice(0, 8).toUpperCase()}`;
}

async function resolveStudentIds(issueMode, assignedStudentIds) {
  if (issueMode === 'all') {
    const { rows } = await pool.query("SELECT id FROM users WHERE role = 'student' ORDER BY id");
    return rows.map((row) => row.id);
  }
  return assignedStudentIds;
}

async function issueAdminCertificate(adminCertificateId) {
  const { rows } = await pool.query(
    `SELECT id,
            COALESCE(certificate_type, title, 'Certificate') AS certificate_type,
            COALESCE(issue_date, CURRENT_DATE) AS issue_date,
            COALESCE(assigned_student_ids, '[]'::jsonb) AS assigned_student_ids,
            COALESCE(certificate_id, verification_id, 'CERT') AS base_certificate_id,
            is_bulk
     FROM admin_certificates
     WHERE id = $1`,
    [adminCertificateId]
  );

  const record = rows[0];
  if (!record) {
    throw new Error('Certificate not found');
  }

  const assigned = normalizeStudentIds(record.assigned_student_ids);
  const issueMode = record.is_bulk ? 'all' : 'selected';
  const targetUserIds = await resolveStudentIds(issueMode, assigned);
  if (!targetUserIds.length) {
    throw new Error('No eligible students found for issuance');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let issuedCount = 0;
    for (const userId of targetUserIds) {
      const existing = await client.query(
        `SELECT id, certificate_id, status
         FROM admin_certificate_issuances
         WHERE admin_certificate_id = $1 AND user_id = $2`,
        [adminCertificateId, userId]
      );

      if (existing.rowCount > 0 && existing.rows[0].certificate_id && existing.rows[0].status !== 'Revoked') {
        issuedCount += 1;
        continue;
      }

      const verificationCode = createVerificationCode();
      const created = await client.query(
        `INSERT INTO certificates (user_id, type, issued_date, certificate_url, verification_code)
         VALUES ($1, $2, $3::date, $4, $5)
         RETURNING id, verification_code`,
        [userId, record.certificate_type, record.issue_date, null, verificationCode]
      );

      await client.query(
        `INSERT INTO admin_certificate_issuances (admin_certificate_id, user_id, certificate_id, verification_code, status, issued_at, revoked_at)
         VALUES ($1, $2, $3, $4, 'Issued', NOW(), NULL)
         ON CONFLICT (admin_certificate_id, user_id)
         DO UPDATE SET
           certificate_id = EXCLUDED.certificate_id,
           verification_code = EXCLUDED.verification_code,
           status = 'Issued',
           issued_at = NOW(),
           revoked_at = NULL`,
        [adminCertificateId, userId, created.rows[0].id, created.rows[0].verification_code]
      );

      issuedCount += 1;
    }

    await client.query(
      `UPDATE admin_certificates
       SET status = 'Issued',
           issued_count = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [adminCertificateId, issuedCount]
    );

    await client.query('COMMIT');
    return issuedCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

router.get('/students/search', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const q = String(req.query.q || '').trim();

  const values = [];
  let where = "WHERE role = 'student'";
  if (q) {
    values.push(`%${q}%`);
    where += ` AND (full_name ILIKE $${values.length} OR email ILIKE $${values.length} OR CAST(id AS TEXT) ILIKE $${values.length})`;
  }

  const { rows } = await pool.query(
    `SELECT id, full_name, email, college_name
     FROM users
     ${where}
     ORDER BY full_name ASC
     LIMIT 80`,
    values
  );

  res.json({ students: rows });
});

router.get('/certificates', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();

  const values = [];
  const where = [];
  const status = String(req.query.status || 'all').trim();
  const type = String(req.query.type || '').trim();
  const search = String(req.query.search || '').trim();

  if (status && status.toLowerCase() !== 'all') {
    values.push(status);
    where.push(`COALESCE(ac.status, 'Draft') = $${values.length}`);
  }

  if (type) {
    values.push(type);
    where.push(`COALESCE(ac.certificate_type, ac.title, '') = $${values.length}`);
  }

  if (search) {
    values.push(`%${search}%`);
    where.push(`(
      COALESCE(ac.certificate_id, ac.verification_id, '') ILIKE $${values.length}
      OR COALESCE(ac.certificate_type, ac.title, '') ILIKE $${values.length}
      OR TO_CHAR(ac.issue_date, 'YYYY-MM-DD') ILIKE $${values.length}
      OR COALESCE(st.student_names, '') ILIKE $${values.length}
    )`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT ac.id,
            COALESCE(ac.certificate_type, ac.title, 'Certificate') AS certificate_type,
            COALESCE(ac.achievement_name, ac.course, '-') AS achievement_name,
            COALESCE(ac.score_rank, '-') AS score_rank,
            COALESCE(ac.issue_date, CURRENT_DATE) AS issue_date,
            COALESCE(ac.certificate_id, ac.verification_id, '-') AS certificate_id,
            COALESCE(ac.organization_name, 'College OS Academy') AS organization_name,
            COALESCE(ac.signatory_name, 'Academic Director') AS signatory_name,
            COALESCE(ac.description, '') AS description,
            COALESCE(ac.template_name, 'Classic') AS template_name,
            COALESCE(ac.status, 'Draft') AS status,
            COALESCE(ac.assigned_student_ids, '[]'::jsonb) AS assigned_student_ids,
            COALESCE(ac.issued_count, 0) AS issued_count,
            ac.is_bulk,
            ac.created_at,
            ac.updated_at,
            COALESCE(st.student_names, CASE WHEN ac.student_email IS NOT NULL THEN ac.student_email ELSE '-' END) AS student_names,
            COALESCE(st.student_count, 0) AS student_count
     FROM admin_certificates ac
     LEFT JOIN LATERAL (
       SELECT STRING_AGG(u.full_name, ', ' ORDER BY u.full_name) AS student_names,
              COUNT(*)::int AS student_count
       FROM users u
       WHERE u.id IN (
         SELECT CAST(value AS INTEGER)
         FROM jsonb_array_elements_text(COALESCE(ac.assigned_student_ids, '[]'::jsonb))
       )
     ) st ON TRUE
     ${whereClause}
     ORDER BY ac.created_at DESC`,
    values
  );

  res.json({ certificates: rows });
});

router.get('/certificates/:id', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });

  const { rows } = await pool.query(
    `SELECT id,
            COALESCE(certificate_type, title, 'Certificate') AS certificate_type,
            COALESCE(achievement_name, course, '-') AS achievement_name,
            COALESCE(score_rank, '-') AS score_rank,
            COALESCE(issue_date, CURRENT_DATE) AS issue_date,
            COALESCE(certificate_id, verification_id, '-') AS certificate_id,
            COALESCE(organization_name, 'College OS Academy') AS organization_name,
            COALESCE(signatory_name, 'Academic Director') AS signatory_name,
            COALESCE(description, '') AS description,
            COALESCE(template_name, 'Classic') AS template_name,
            COALESCE(status, 'Draft') AS status,
            COALESCE(assigned_student_ids, '[]'::jsonb) AS assigned_student_ids,
            COALESCE(issued_count, 0) AS issued_count,
            is_bulk,
            created_at,
            updated_at
     FROM admin_certificates
     WHERE id = $1`,
    [id]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Certificate not found' });
  res.json({ certificate: rows[0] });
});

router.post('/certificates', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();

  const {
    certificateType,
    achievementName,
    scoreRank,
    issueDate,
    certificateId,
    organizationName,
    signatoryName,
    description,
    templateName,
    selectedStudentIds,
    issueMode,
    action,
    status
  } = req.body;

  if (!certificateType || !achievementName || !issueDate) {
    return res.status(400).json({ error: 'certificateType, achievementName and issueDate are required' });
  }

  const assignedStudentIds = normalizeStudentIds(selectedStudentIds);
  const bulkIssue = issueMode === 'all';
  if (!bulkIssue && assignedStudentIds.length === 0) {
    return res.status(400).json({ error: 'Select at least one student for assignment' });
  }

  const nextCertId = String(certificateId || createCertificateId()).trim();
  const nextStatus = action === 'issue' ? 'Issued' : status || 'Draft';
  const { rows } = await pool.query(
    `INSERT INTO admin_certificates (
      title,
      course,
      student_email,
      issue_date,
      description,
      issued_by,
      certificate_type,
      achievement_name,
      score_rank,
      certificate_id,
      verification_id,
      organization_name,
      signatory_name,
      template_name,
      status,
      assigned_student_ids,
      is_bulk,
      updated_at
    )
    VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $13, $14::jsonb, $15, NOW())
    RETURNING id`,
    [
      certificateType,
      achievementName,
      issueDate,
      description || null,
      req.session.userId,
      certificateType,
      achievementName,
      scoreRank || null,
      nextCertId,
      organizationName || 'College OS Academy',
      signatoryName || 'Academic Director',
      templateName || 'Classic',
      nextStatus,
      JSON.stringify(assignedStudentIds),
      bulkIssue
    ]
  );

  let issuedCount = 0;
  if (action === 'issue') {
    issuedCount = await issueAdminCertificate(rows[0].id);
  }

  res.status(201).json({
    message: action === 'issue' ? 'Certificate issued successfully' : 'Certificate generated successfully',
    certificateId: rows[0].id,
    issuedCount
  });
});

router.put('/certificates/:id', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });

  const {
    certificateType,
    achievementName,
    scoreRank,
    issueDate,
    certificateId,
    organizationName,
    signatoryName,
    description,
    templateName,
    selectedStudentIds,
    issueMode,
    status
  } = req.body;

  const assignedStudentIds = normalizeStudentIds(selectedStudentIds);
  const bulkIssue = issueMode === 'all';
  if (!bulkIssue && assignedStudentIds.length === 0) {
    return res.status(400).json({ error: 'Select at least one student for assignment' });
  }

  const { rowCount } = await pool.query(
    `UPDATE admin_certificates
     SET title = $2,
         course = $3,
         issue_date = $4,
         description = $5,
         certificate_type = $2,
         achievement_name = $3,
         score_rank = $6,
         certificate_id = $7,
         verification_id = $7,
         organization_name = $8,
         signatory_name = $9,
         template_name = $10,
         status = $11,
         assigned_student_ids = $12::jsonb,
         is_bulk = $13,
         updated_at = NOW()
     WHERE id = $1`,
    [
      id,
      certificateType,
      achievementName,
      issueDate,
      description || null,
      scoreRank || null,
      certificateId || createCertificateId(),
      organizationName || 'College OS Academy',
      signatoryName || 'Academic Director',
      templateName || 'Classic',
      status || 'Draft',
      JSON.stringify(assignedStudentIds),
      bulkIssue
    ]
  );

  if (rowCount === 0) return res.status(404).json({ error: 'Certificate not found' });
  res.json({ message: 'Certificate updated successfully' });
});

router.post('/certificates/:id/issue', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });

  const issuedCount = await issueAdminCertificate(id);
  res.json({ message: 'Certificate issued successfully', issuedCount });
});

router.post('/certificates/:id/reissue', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });

  await pool.query(
    `UPDATE admin_certificate_issuances
     SET status = 'Revoked',
         revoked_at = NOW()
     WHERE admin_certificate_id = $1`,
    [id]
  );

  const issuedCount = await issueAdminCertificate(id);
  res.json({ message: 'Certificate reissued successfully', issuedCount });
});

router.post('/certificates/:id/verify', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });

  await pool.query(
    `UPDATE admin_certificate_issuances
     SET status = 'Verified',
         verified_at = NOW()
     WHERE admin_certificate_id = $1 AND status <> 'Revoked'`,
    [id]
  );
  await pool.query(`UPDATE admin_certificates SET status = 'Verified', updated_at = NOW() WHERE id = $1`, [id]);

  res.json({ message: 'Certificate verified successfully' });
});

router.post('/certificates/:id/revoke', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });

  await pool.query(
    `UPDATE admin_certificate_issuances
     SET status = 'Revoked',
         revoked_at = NOW()
     WHERE admin_certificate_id = $1`,
    [id]
  );
  await pool.query(`UPDATE admin_certificates SET status = 'Revoked', updated_at = NOW() WHERE id = $1`, [id]);

  res.json({ message: 'Certificate revoked successfully' });
});

router.post('/certificates/bulk', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const action = String(req.body.action || '').trim();
  const ids = normalizeStudentIds(req.body.ids);
  if (!action || ids.length === 0) {
    return res.status(400).json({ error: 'action and ids are required' });
  }

  if (action === 'issue') {
    const outcomes = [];
    for (const id of ids) {
      const count = await issueAdminCertificate(id);
      outcomes.push({ id, issuedCount: count });
    }
    return res.json({ message: 'Bulk issue completed', outcomes });
  }

  if (action === 'verify') {
    await pool.query(
      `UPDATE admin_certificate_issuances
       SET status = 'Verified',
           verified_at = NOW()
       WHERE admin_certificate_id = ANY($1::int[]) AND status <> 'Revoked'`,
      [ids]
    );
    await pool.query(
      `UPDATE admin_certificates
       SET status = 'Verified',
           updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    return res.json({ message: 'Bulk verify completed' });
  }

  if (action === 'revoke') {
    await pool.query(
      `UPDATE admin_certificate_issuances
       SET status = 'Revoked',
           revoked_at = NOW()
       WHERE admin_certificate_id = ANY($1::int[])`,
      [ids]
    );
    await pool.query(
      `UPDATE admin_certificates
       SET status = 'Revoked',
           updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [ids]
    );
    return res.json({ message: 'Bulk revoke completed' });
  }

  if (action === 'download') {
    const { rows } = await pool.query(
      `SELECT ac.id,
              COALESCE(ac.certificate_type, ac.title, 'Certificate') AS certificate_type,
              COALESCE(ac.certificate_id, ac.verification_id, '-') AS certificate_id,
              COALESCE(ac.issue_date, CURRENT_DATE) AS issue_date,
              COALESCE(ac.status, 'Draft') AS status,
              COUNT(ai.id)::int AS issuance_records
       FROM admin_certificates ac
       LEFT JOIN admin_certificate_issuances ai ON ai.admin_certificate_id = ac.id
       WHERE ac.id = ANY($1::int[])
       GROUP BY ac.id
       ORDER BY ac.id DESC`,
      [ids]
    );
    return res.json({ message: 'Bulk download payload ready', certificates: rows });
  }

  return res.status(400).json({ error: 'Unsupported bulk action' });
});

router.delete('/certificates/:id', requireAdmin, async (req, res) => {
  await ensureCertificateSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid certificate id' });

  const { rowCount } = await pool.query('DELETE FROM admin_certificates WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Certificate not found' });
  res.json({ message: 'Certificate deleted successfully' });
});

// Roadmaps management routes
router.get('/roadmaps', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, track, level, duration, description, 
            jsonb_array_length(steps) AS step_count, created_at
     FROM admin_roadmaps
     ORDER BY created_at DESC`
  );
  res.json({ roadmaps: rows });
});

router.post('/roadmaps', requireAdmin, async (req, res) => {
  const { title, track, level, duration, description, steps } = req.body;
  if (!title || !track || !steps || !Array.isArray(steps)) {
    return res.status(400).json({ error: 'title, track, and steps array are required' });
  }

  const { rows } = await pool.query(
    `INSERT INTO admin_roadmaps (title, track, level, duration, description, steps, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, track, level, duration, jsonb_array_length(steps) AS step_count`,
    [title, track, level, duration, description, JSON.stringify(steps), req.session.userId]
  );

  res.status(201).json({ roadmap: rows[0] });
});

router.delete('/roadmaps/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query('DELETE FROM admin_roadmaps WHERE id = $1', [id]);
  if (rowCount === 0) return res.status(404).json({ error: 'Roadmap not found' });
  res.json({ message: 'Roadmap deleted successfully' });
});

// ============================================================
// INTELLIGENT ADMIN FEATURES - Analytics, Quality, Security
// ============================================================

const adminIntel = require('../services/adminIntelligence');

/**
 * ====================
 * Moderation Filters
 * ====================
 */

/**
 * POST /admin/filters
 * Save a custom moderation filter
 */
router.post('/filters', requireAdmin, async (req, res) => {
  try {
    const { filterName, filterConfig } = req.body;
    const adminUserId = req.user.id;

    if (!filterName || !filterConfig) {
      return res.status(400).json({ error: 'Filter name and config required' });
    }

    const result = await adminIntel.saveModerationFilter(
      adminUserId,
      filterName,
      filterConfig
    );

    res.json(result);
  } catch (error) {
    console.error('Error saving filter:', error);
    res.status(500).json({ error: 'Failed to save filter' });
  }
});

/**
 * GET /admin/filters
 * Get admin's saved moderation filters
 */
router.get('/filters', requireAdmin, async (req, res) => {
  try {
    const filters = await adminIntel.getAdminFilters(req.user.id);
    res.json(filters);
  } catch (error) {
    console.error('Error fetching filters:', error);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

/**
 * ====================
 * Contributor Metrics
 * ====================
 */

/**
 * POST /admin/contributors/:userId/quality
 * Calculate 7-day quality metrics for a contributor
 */
router.post('/contributors/:userId/quality', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const metrics = await adminIntel.calculateContributorQuality(Number(userId));
    res.json(metrics);
  } catch (error) {
    console.error('Error calculating quality:', error);
    res.status(500).json({ error: 'Failed to calculate quality metrics' });
  }
});

/**
 * GET /admin/contributors/:userId/trends
 * Get contributor quality trends over time
 */
router.get('/contributors/:userId/trends', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;
    const trends = await adminIntel.getContributorTrends(Number(userId), Number(days));
    res.json(trends);
  } catch (error) {
    console.error('Error fetching trends:', error);
    res.status(500).json({ error: 'Failed to fetch contributor trends' });
  }
});

/**
 * ====================
 * Suspicious Activity
 * ====================
 */

/**
 * POST /admin/contributions/:contribId/analyze
 * Analyze a contribution for suspicious patterns
 */
router.post('/contributions/:contribId/analyze', requireAdmin, async (req, res) => {
  try {
    const { contribId } = req.params;

    // Fetch the contribution
    const result = await pool.query(
      'SELECT * FROM academic_contributions WHERE id = $1',
      [contribId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Contribution not found' });
    }

    const suspiciousAnalysis = await adminIntel.analyzeForSuspiciousActivity(
      result.rows[0]
    );

    res.json(suspiciousAnalysis);
  } catch (error) {
    console.error('Error analyzing contribution:', error);
    res.status(500).json({ error: 'Failed to analyze contribution' });
  }
});

/**
 * POST /admin/alerts
 * Log a suspicious activity alert
 */
router.post('/alerts', requireAdmin, async (req, res) => {
  try {
    const { userId, contributionId, alertType, alertMessage, severity } = req.body;

    if (!alertType || !alertMessage) {
      return res.status(400).json({ error: 'Alert type and message required' });
    }

    const alert = await adminIntel.logSuspiciousActivityAlert({
      userId,
      contributionId,
      alertType,
      alertMessage,
      severity
    });

    res.status(201).json(alert);
  } catch (error) {
    console.error('Error logging alert:', error);
    res.status(500).json({ error: 'Failed to log alert' });
  }
});

/**
 * GET /admin/alerts
 * Get unresolved suspicious activity alerts (admin dashboard)
 */
router.get('/alerts', requireAdmin, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const alerts = await adminIntel.getUnresolvedAlerts(Number(limit));
    res.json(alerts);
  } catch (error) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

/**
 * PUT /admin/alerts/:alertId/resolve
 * Mark an alert as resolved
 */
router.put('/alerts/:alertId/resolve', requireAdmin, async (req, res) => {
  try {
    const { alertId } = req.params;
    const { notes } = req.body;

    const result = await pool.query(
      `UPDATE suspicious_activity_alerts
       SET is_resolved = TRUE,
           resolved_by = $1,
           resolved_at = CURRENT_TIMESTAMP,
           admin_notes = $2
       WHERE id = $3
       RETURNING *`,
      [req.user.id, notes || null, alertId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error resolving alert:', error);
    res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

/**
 * ====================
 * Resource Analysis
 * ====================
 */

/**
 * POST /admin/contributions/:contribId/analyze-effectiveness
 * Analyze resource effectiveness and lifecycle
 */
router.post('/contributions/:contribId/analyze-effectiveness', requireAdmin, async (req, res) => {
  try {
    const { contribId } = req.params;
    const analysis = await adminIntel.analyzeResourceEffectiveness(Number(contribId));
    res.json(analysis);
  } catch (error) {
    console.error('Error analyzing effectiveness:', error);
    res.status(500).json({ error: 'Failed to analyze resource effectiveness' });
  }
});

/**
 * ====================
 * Demand Analytics
 * ====================
 */

/**
 * POST /admin/demand-heatmap/update
 * Update the subject demand heatmap
 */
router.post('/demand-heatmap/update', requireAdmin, async (req, res) => {
  try {
    const { collegeName, branchId, semesterId } = req.body;

    if (!collegeName || !branchId || !semesterId) {
      return res.status(400).json({
        error: 'College name, branch ID, and semester ID required'
      });
    }

    const heatmap = await adminIntel.updateSubjectDemandHeatmap(
      collegeName,
      Number(branchId),
      Number(semesterId)
    );

    res.json(heatmap);
  } catch (error) {
    console.error('Error updating heatmap:', error);
    res.status(500).json({ error: 'Failed to update demand heatmap' });
  }
});

/**
 * GET /admin/demand-heatmap
 * Get subject demand heatmap
 */
router.get('/demand-heatmap', requireAdmin, async (req, res) => {
  try {
    const { collegeName, branchId, semesterId } = req.query;

    if (!collegeName || !branchId || !semesterId) {
      return res.status(400).json({
        error: 'College name, branch ID, and semester ID required'
      });
    }

    const heatmap = await adminIntel.getDemandHeatmap(
      collegeName,
      Number(branchId),
      Number(semesterId)
    );

    res.json(heatmap);
  } catch (error) {
    console.error('Error fetching heatmap:', error);
    res.status(500).json({ error: 'Failed to fetch demand heatmap' });
  }
});

/**
 * ====================
 * Admin Dashboard
 * ====================
 */

/**
 * GET /admin/dashboard
 * Comprehensive admin dashboard with key metrics
 */
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    // Get all metrics in parallel
    const [
      alertsResult,
      filterCountResult,
      topContributorsResult,
      suspiciousResult
    ] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as total, 
               COUNT(CASE WHEN severity = 'critical' THEN 1 END) as critical
        FROM suspicious_activity_alerts WHERE is_resolved = FALSE
      `),
      pool.query(`
        SELECT COUNT(DISTINCT admin_user_id) as total
        FROM admin_moderation_filters
      `),
      pool.query(`
        SELECT u.id, u.full_name, 
               COUNT(ac.id) as contribution_count,
               u.last_quality_avg_7d,
               u.last_approval_rate_7d
        FROM users u
        LEFT JOIN academic_contributions ac ON u.id = ac.user_id
        WHERE u.role = 'student'
        GROUP BY u.id, u.full_name, u.last_quality_avg_7d, u.last_approval_rate_7d
        ORDER BY contribution_count DESC LIMIT 10
      `),
      pool.query(`
        SELECT alert_type, COUNT(*) as count
        FROM suspicious_activity_alerts
        WHERE is_resolved = FALSE
        GROUP BY alert_type
        ORDER BY count DESC
      `)
    ]);

    res.json({
      alerts: {
        total: Number(alertsResult.rows[0]?.total || 0),
        critical: Number(alertsResult.rows[0]?.critical || 0)
      },
      filters: {
        total: Number(filterCountResult.rows[0]?.total || 0)
      },
      topContributors: topContributorsResult.rows,
      suspiciousByType: suspiciousResult.rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating dashboard:', error);
    res.status(500).json({ error: 'Failed to generate dashboard' });
  }
});

/**
 * ====================
 * Cache Management
 * ====================
 */

/**
 * GET /admin/cache-status
 * Get intelligence cache status
 */
router.get('/cache-status', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN expires_at > CURRENT_TIMESTAMP THEN 1 END) as valid,
        COUNT(CASE WHEN expires_at <= CURRENT_TIMESTAMP THEN 1 END) as expired
      FROM admin_intelligence_cache
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching cache status:', error);
    res.status(500).json({ error: 'Failed to fetch cache status' });
  }
});

/**
 * DELETE /admin/cache
 * Clear expired cache entries
 */
router.delete('/cache', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM admin_intelligence_cache
      WHERE expires_at <= CURRENT_TIMESTAMP
      RETURNING id
    `);

    res.json({ deletedCount: result.rows.length });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

module.exports = router;
module.exports.ensureCertificateSchema = ensureCertificateSchema;
