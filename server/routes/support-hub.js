const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { ProductionValidator } = require('../utils/productionValidation');
const logger = require('../services/logger');
const { ensureSupportSchema } = require('../utils/supportSchema');
const {
  getSupportGovernanceConfig,
  guardSupportFeature,
  isUserSupportSuspended
} = require('../utils/supportGovernance');

const router = express.Router();

const supportUploadDir = path.join(__dirname, '..', '..', 'uploads', 'support');
if (!fs.existsSync(supportUploadDir)) {
  fs.mkdirSync(supportUploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, supportUploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'];
    cb(null, allowed.includes(String(file.mimetype || '').toLowerCase()));
  }
});

router.use(requireAuth, guardSupportFeature);

async function getUserAcademicContext(userId) {
  const { rows } = await pool.query(
    `SELECT
       u.id,
       u.email,
       u.university_id,
       u.college_name,
       up.category_id,
       up.branch_id,
       up.semester_id
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function sanitizeMeetLink(rawLink) {
  const link = String(rawLink || '').trim();
  if (!link) return null;

  try {
    const parsed = new URL(link);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    if (host !== 'meet.google.com' && host !== 'g.co') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeJsonArray(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((value) => typeof value === 'string').slice(0, 4);
}

async function guardAcademicContext(req, res) {
  const userId = Number(req.session.userId || 0);
  const context = await getUserAcademicContext(userId);

  if (!context || !context.category_id || !context.branch_id || !context.semester_id) {
    res.status(403).json({ error: 'User profile incomplete' });
    return null;
  }

  const suspended = await isUserSupportSuspended(userId);
  if (suspended) {
    res.status(403).json({ error: 'Support participation is suspended for this account.' });
    return null;
  }

  return context;
}

router.get('/config', async (_req, res) => {
  try {
    const config = await getSupportGovernanceConfig();
    return res.json({ success: true, config });
  } catch (error) {
    logger.error('Failed to load support governance config for student', { error: error.message });
    return res.status(500).json({ error: 'Failed to load support config' });
  }
});

router.post('/upload', upload.array('files', 4), async (req, res) => {
  try {
    const cfg = req.supportGovernance || (await getSupportGovernanceConfig());
    if (!cfg.allowAttachments) {
      return res.status(403).json({ error: 'Attachments are temporarily disabled by admin.' });
    }

    const context = await guardAcademicContext(req, res);
    if (!context) return;

    const files = Array.isArray(req.files) ? req.files : [];
    const urls = files.map((file) => `/uploads/support/${file.filename}`);
    return res.json({ success: true, files: urls });
  } catch (error) {
    logger.error('Failed to upload support files', { error: error.message });
    return res.status(500).json({ error: 'Upload failed' });
  }
});

router.post('/create-request', async (req, res) => {
  try {
    const cfg = req.supportGovernance || (await getSupportGovernanceConfig());
    if (!cfg.allowRequestCreation) {
      return res.status(403).json({ error: 'Support request creation is temporarily disabled.' });
    }

    const context = await guardAcademicContext(req, res);
    if (!context) return;

    const {
      title,
      description,
      request_category,
      subject,
      urgency_level,
      attachment_urls,
      image_urls,
      meet_link,
      tags
    } = req.body || {};

    const validator = new ProductionValidator();
    validator.validateString('title', title, { required: true, minLength: 3, maxLength: 250 });
    validator.validateString('description', description, { required: true, minLength: 10, maxLength: 5000 });
    validator.validateString('request_category', request_category, { required: true, minLength: 2, maxLength: 80 });
    validator.validateEnum('urgency_level', urgency_level || 'medium', ['low', 'medium', 'high', 'urgent']);

    const validationErrors = validator.getErrors();
    if (validationErrors) {
      return res.status(400).json({ errors: validationErrors });
    }

    const normalizedMeetLink = sanitizeMeetLink(meet_link);
    if (meet_link && (!cfg.allowMeetLinks || !normalizedMeetLink)) {
      return res.status(400).json({ error: 'Meet links are disabled or invalid.' });
    }

    const safeAttachmentUrls = cfg.allowAttachments
      ? safeJsonArray(attachment_urls).filter((item) => item.startsWith('/uploads/support/'))
      : [];

    const safeImageUrls = cfg.allowAttachments
      ? safeJsonArray(image_urls).filter((item) => item.startsWith('/uploads/support/'))
      : [];

    const safeTags = Array.isArray(tags)
      ? tags
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((item) => item.length >= 2 && item.length <= 30)
          .slice(0, 10)
      : [];

    const userId = Number(req.session.userId || 0);

    const { rows: recentRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM support_requests
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId]
    );

    if (Number(recentRows[0]?.count || 0) >= 5) {
      return res.status(429).json({ error: 'Too many requests. Please wait before posting again.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO support_requests (
         request_uuid,
         user_id,
         category_id,
         branch_id,
         semester_id,
         university_id,
         college_name,
         title,
         description,
         request_category,
         subject,
         urgency_level,
         attachment_urls,
         image_urls,
         meet_link
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15)
       RETURNING id, request_uuid, title, status, created_at`,
      [
        uuidv4(),
        userId,
        context.category_id,
        context.branch_id,
        context.semester_id,
        context.university_id,
        context.college_name,
        String(title).trim(),
        String(description).trim(),
        String(request_category).trim(),
        subject ? String(subject).trim() : null,
        urgency_level || 'medium',
        JSON.stringify(safeAttachmentUrls),
        JSON.stringify(safeImageUrls),
        normalizedMeetLink
      ]
    );

    if (safeTags.length) {
      for (const tag of safeTags) {
        await pool.query(
          `INSERT INTO support_request_tags (request_id, tag) VALUES ($1, $2)`,
          [rows[0].id, tag]
        );
      }
    }

    await pool.query(
      `INSERT INTO support_quality_metrics (user_id, metric_type, metric_value, metric_reason)
       VALUES ($1, 'request_created', 1, 'Request created in support hub')`,
      [userId]
    );

    logger.info('Support request created', { requestId: rows[0].id, userId });
    return res.status(201).json({ success: true, request: rows[0] });
  } catch (error) {
    logger.error('Failed to create support request', { error: error.message });
    return res.status(500).json({ error: 'Failed to create request' });
  }
});

router.get('/requests', async (req, res) => {
  try {
    const context = await guardAcademicContext(req, res);
    if (!context) return;

    const status = String(req.query.status || '').trim();
    const urgency = String(req.query.urgency || '').trim();
    const sortBy = String(req.query.sort_by || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const offset = (page - 1) * limit;

    let where =
      'WHERE sr.category_id = $1 AND sr.branch_id = $2 AND sr.semester_id = $3 AND sr.is_removed = FALSE AND sr.is_hidden = FALSE';
    const params = [context.category_id, context.branch_id, context.semester_id];

    if (['open', 'in_progress', 'solved'].includes(status)) {
      where += ` AND sr.status = $${params.length + 1}`;
      params.push(status);
    }

    if (['low', 'medium', 'high', 'urgent'].includes(urgency)) {
      where += ` AND sr.urgency_level = $${params.length + 1}`;
      params.push(urgency);
    }

    let orderBy = 'sr.created_at DESC';
    if (sortBy === 'urgent') {
      orderBy = "CASE sr.urgency_level WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, sr.created_at DESC";
    }
    if (sortBy === 'unanswered') {
      orderBy = 'COUNT(sa.id) ASC, sr.created_at DESC';
    }
    if (sortBy === 'most_active') {
      orderBy = 'COUNT(sa.id) DESC, sr.view_count DESC, sr.created_at DESC';
    }

    const { rows } = await pool.query(
      `SELECT
         sr.id,
         sr.request_uuid,
         sr.user_id,
         sr.title,
         sr.description,
         sr.request_category,
         sr.subject,
         sr.urgency_level,
         sr.status,
         sr.created_at,
         sr.updated_at,
         sr.marked_helpful_count,
         sr.view_count,
         sr.is_priority,
         sr.is_featured,
         u.full_name,
         u.email,
         COUNT(sa.id)::int AS answer_count,
         SUM(CASE WHEN sa.is_accepted THEN 1 ELSE 0 END)::int AS accepted_count
       FROM support_requests sr
       INNER JOIN users u ON u.id = sr.user_id
       LEFT JOIN support_answers sa ON sa.request_id = sr.id AND sa.is_removed = FALSE AND sa.is_hidden = FALSE
       ${where}
       GROUP BY sr.id, u.id
       ORDER BY ${orderBy}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM support_requests sr ${where}`,
      params
    );

    return res.json({
      success: true,
      requests: rows,
      pagination: {
        page,
        limit,
        total: Number(countRows[0]?.total || 0),
        pages: Math.ceil(Number(countRows[0]?.total || 0) / limit)
      }
    });
  } catch (error) {
    logger.error('Failed to load support requests', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

router.get('/request/:id', async (req, res) => {
  try {
    const context = await guardAcademicContext(req, res);
    if (!context) return;

    const requestId = Number(req.params.id || 0);
    const userId = Number(req.session.userId || 0);

    const { rows: requestRows } = await pool.query(
      `SELECT sr.*, u.full_name, u.email
       FROM support_requests sr
       INNER JOIN users u ON u.id = sr.user_id
       WHERE sr.id = $1
         AND sr.category_id = $2
         AND sr.branch_id = $3
         AND sr.semester_id = $4
         AND sr.is_removed = FALSE
         AND sr.is_hidden = FALSE
       LIMIT 1`,
      [requestId, context.category_id, context.branch_id, context.semester_id]
    );

    if (!requestRows.length) {
      return res.status(404).json({ error: 'Request not found or access denied' });
    }

    await pool.query('UPDATE support_requests SET view_count = view_count + 1 WHERE id = $1', [requestId]);

    const { rows: answers } = await pool.query(
      `SELECT
         sa.id,
         sa.answer_uuid,
         sa.answerer_id,
         sa.content,
         sa.explanation_detail,
         sa.is_accepted,
         sa.helpful_count,
         sa.unhelpful_count,
         sa.attachment_urls,
         sa.image_urls,
         sa.meet_link,
         sa.created_at,
         sa.updated_at,
         u.full_name,
         u.email,
         hr.reputation_level,
         hr.total_answers,
         hr.accepted_answers,
         (SELECT vote_type FROM support_answer_votes WHERE answer_id = sa.id AND voter_id = $2 LIMIT 1) AS user_vote
       FROM support_answers sa
       INNER JOIN users u ON u.id = sa.answerer_id
       LEFT JOIN helper_reputation hr ON hr.helper_id = sa.answerer_id
       WHERE sa.request_id = $1
         AND sa.is_removed = FALSE
         AND sa.is_hidden = FALSE
       ORDER BY sa.is_accepted DESC, sa.helpful_count DESC, sa.created_at ASC`,
      [requestId, userId]
    );

    const request = requestRows[0];
    request.attachment_urls = Array.isArray(request.attachment_urls) ? request.attachment_urls : [];
    request.image_urls = Array.isArray(request.image_urls) ? request.image_urls : [];

    return res.json({
      success: true,
      request,
      answers: answers.map((row) => ({
        ...row,
        attachment_urls: Array.isArray(row.attachment_urls) ? row.attachment_urls : [],
        image_urls: Array.isArray(row.image_urls) ? row.image_urls : []
      }))
    });
  } catch (error) {
    logger.error('Failed to load support request detail', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch request' });
  }
});

router.put('/request/:id/mark-solved', async (req, res) => {
  try {
    const cfg = req.supportGovernance || (await getSupportGovernanceConfig());
    if (!cfg.allowSolvedFlow) {
      return res.status(403).json({ error: 'Solved flow is temporarily disabled.' });
    }

    const context = await guardAcademicContext(req, res);
    if (!context) return;

    const requestId = Number(req.params.id || 0);
    const userId = Number(req.session.userId || 0);

    const { rows } = await pool.query(
      `SELECT id, status
       FROM support_requests
       WHERE id = $1
         AND user_id = $2
         AND category_id = $3
         AND branch_id = $4
         AND semester_id = $5
         AND is_removed = FALSE
       LIMIT 1`,
      [requestId, userId, context.category_id, context.branch_id, context.semester_id]
    );

    if (!rows.length) {
      return res.status(403).json({ error: 'Request not found or unauthorized' });
    }

    await pool.query(
      `UPDATE support_requests
       SET status = 'solved', solved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    return res.json({ success: true, message: 'Request marked solved' });
  } catch (error) {
    logger.error('Failed to mark support request solved', { error: error.message });
    return res.status(500).json({ error: 'Failed to update request' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const context = await guardAcademicContext(req, res);
    if (!context) return;

    const query = String(req.query.query || '').trim();
    if (query.length < 2) {
      return res.status(400).json({ error: 'Search query too short' });
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit || 10)));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT
         sr.id,
         sr.request_uuid,
         sr.title,
         sr.description,
         sr.request_category,
         sr.subject,
         sr.urgency_level,
         sr.status,
         sr.created_at,
         u.full_name,
         COUNT(sa.id)::int AS answer_count
       FROM support_requests sr
       INNER JOIN users u ON u.id = sr.user_id
       LEFT JOIN support_answers sa ON sa.request_id = sr.id AND sa.is_removed = FALSE AND sa.is_hidden = FALSE
       WHERE sr.category_id = $1
         AND sr.branch_id = $2
         AND sr.semester_id = $3
         AND sr.is_removed = FALSE
         AND sr.is_hidden = FALSE
         AND (
           sr.title ILIKE $4 OR sr.description ILIKE $4 OR COALESCE(sr.subject, '') ILIKE $4
         )
       GROUP BY sr.id, u.id
       ORDER BY sr.created_at DESC
       LIMIT $5 OFFSET $6`,
      [context.category_id, context.branch_id, context.semester_id, `%${query}%`, limit, offset]
    );

    return res.json({ success: true, results: rows, page, limit });
  } catch (error) {
    logger.error('Failed to search support requests', { error: error.message });
    return res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
