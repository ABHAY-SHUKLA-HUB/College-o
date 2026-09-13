const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { requireFeatureEnabled } = require('../middleware/featureToggle');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');
const { deleteUploadedFileById } = require('../services/supabaseStorage');
const { sanitizeText } = require('../utils/communitySanitizer');

const router = express.Router();

let feedbackSchemaEnsured = false;
const upload = createUploadMiddleware({
  maxFileSize: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
  invalidTypeMessage: 'Only image uploads are allowed'
});

async function ensureFeedbackSchema() {
  if (feedbackSchemaEnsured) return;
  await pool.query(
    `ALTER TABLE feedback
      ADD COLUMN IF NOT EXISTS category VARCHAR(60) DEFAULT 'General Feedback',
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'Submitted',
      ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
  );
  feedbackSchemaEnsured = true;
}

function isEditable(row) {
  if (!row) return false;
  const status = String(row.status || 'Submitted');
  return !row.admin_reply && (status === 'Submitted');
}

router.post('/upload-screenshot', requireAuth, requireFeatureEnabled('student_experience'), upload.single('screenshot'), async (req, res) => {
  await ensureFeedbackSchema();
  if (!req.file) return res.status(400).json({ error: 'Screenshot file is required' });

  try {
    const stored = await saveUploadedFile({
      file: req.file,
      folder: 'users/feedback',
      prefix: 'feedback',
      userId: req.session.userId,
      uploadedBy: req.session.userId,
      entityType: 'feedback_screenshot'
    });
    return res.status(201).json({ screenshotUrl: stored.url });
  } catch (error) {
    if (error?.code === 'INVALID_UPLOAD_FILE' || error?.statusCode === 400) {
      return res.status(400).json({ error: error.message || 'Invalid file upload' });
    }
    return res.status(502).json({ error: 'Failed to upload screenshot' });
  }
});

router.post('/', requireAuth, requireFeatureEnabled('student_experience'), async (req, res) => {
  await ensureFeedbackSchema();
  const { rating, message, screenshotUrl, category, isAnonymous } = req.body;
  if (!rating || !message) return res.status(400).json({ error: 'rating and message are required' });

  const safeMessage = sanitizeText(message, 5000);
  const safeCategory = sanitizeText(category || 'General Feedback', 60);

  const { rows } = await pool.query(
    `INSERT INTO feedback (user_id, rating, message, screenshot_url, category, status, is_anonymous, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'Submitted', $6, NOW())
     RETURNING id, rating, message, screenshot_url, category, status, is_anonymous, admin_reply, created_at, updated_at`,
    [req.session.userId, Number(rating), safeMessage, screenshotUrl || null, safeCategory, Boolean(isAnonymous)]
  );

  res.status(201).json({ feedback: rows[0] });
});

router.get('/mine', requireAuth, requireFeatureEnabled('student_experience'), async (req, res) => {
  await ensureFeedbackSchema();
  const filter = String(req.query.filter || 'all').toLowerCase();
  const params = [req.session.userId];
  const where = ['user_id = $1'];

  if (filter === 'replied') {
    where.push("(admin_reply IS NOT NULL OR status = 'Replied')");
  } else if (filter === 'pending') {
    where.push("(admin_reply IS NULL AND COALESCE(status, 'Submitted') IN ('Submitted','Under Review'))");
  } else if (filter === 'resolved') {
    where.push("COALESCE(status, '') = 'Resolved'");
  }

  const { rows } = await pool.query(
    `SELECT id,
            rating,
            message,
            screenshot_url,
            admin_reply,
            COALESCE(category, 'General Feedback') AS category,
            COALESCE(status, CASE WHEN admin_reply IS NOT NULL THEN 'Replied' ELSE 'Submitted' END) AS status,
            COALESCE(is_anonymous, FALSE) AS is_anonymous,
            created_at,
            updated_at
     FROM feedback
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC`,
    params
  );

  res.json({ feedback: rows });
});

router.get('/stats', requireAuth, requireFeatureEnabled('student_experience'), async (req, res) => {
  await ensureFeedbackSchema();
  const { rows } = await pool.query(
    `SELECT
      COUNT(*)::int AS total_submitted,
      COUNT(*) FILTER (WHERE COALESCE(status, '') = 'Resolved')::int AS resolved_issues,
      COUNT(*) FILTER (WHERE admin_reply IS NULL AND COALESCE(status, 'Submitted') IN ('Submitted', 'Under Review'))::int AS pending_reviews,
      COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS average_rating
     FROM feedback
     WHERE user_id = $1`,
    [req.session.userId]
  );
  res.json({ stats: rows[0] });
});

router.get('/:id', requireAuth, requireFeatureEnabled('student_experience'), async (req, res) => {
  await ensureFeedbackSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid feedback id' });

  const isAdmin = req.session.role === 'admin' || req.session.role === 'super_admin';
  const { rows } = await pool.query(
    `SELECT f.*, u.full_name as student_name, u.email as student_email
     FROM feedback f
     JOIN users u ON u.id = f.user_id
     WHERE f.id = $1 AND ($2 = TRUE OR f.user_id = $3)`,
    [id, isAdmin, req.session.userId]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });
  res.json({ feedback: rows[0] });
});

router.put('/:id', requireAuth, requireFeatureEnabled('student_experience'), async (req, res) => {
  await ensureFeedbackSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid feedback id' });

  const current = await pool.query(
    `SELECT id, status, admin_reply, screenshot_url
     FROM feedback
     WHERE id = $1 AND user_id = $2`,
    [id, req.session.userId]
  );
  const row = current.rows[0];
  if (!row) return res.status(404).json({ error: 'Feedback not found' });
  if (!isEditable(row)) return res.status(403).json({ error: 'Feedback cannot be edited after review starts' });

  const { rating, message, screenshotUrl, category, isAnonymous } = req.body;
  if (!rating || !message) return res.status(400).json({ error: 'rating and message are required' });

  const safeMessage = sanitizeText(message, 5000);
  const safeCategory = sanitizeText(category || 'General Feedback', 60);

  const { rows } = await pool.query(
    `UPDATE feedback
     SET rating = $3,
         message = $4,
         screenshot_url = $5,
         category = $6,
         is_anonymous = $7,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, rating, message, screenshot_url, category, status, is_anonymous, admin_reply, created_at, updated_at`,
    [id, req.session.userId, Number(rating), safeMessage, screenshotUrl || null, safeCategory, Boolean(isAnonymous)]
  );

  res.json({ feedback: rows[0], message: 'Feedback updated successfully' });
});

router.delete('/:id', requireAuth, requireFeatureEnabled('student_experience'), async (req, res) => {
  await ensureFeedbackSchema();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid feedback id' });

  const current = await pool.query(
    `SELECT id, status, admin_reply, screenshot_url
     FROM feedback
     WHERE id = $1 AND user_id = $2`,
    [id, req.session.userId]
  );
  const row = current.rows[0];
  if (!row) return res.status(404).json({ error: 'Feedback not found' });
  if (!isEditable(row)) return res.status(403).json({ error: 'Feedback cannot be deleted after review starts' });

  await pool.query('DELETE FROM feedback WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
  const fileMatch = String(row.screenshot_url || '').match(/\/api\/files\/(\d+)/);
  if (fileMatch) await deleteUploadedFileById(fileMatch[1]);
  res.json({ message: 'Feedback deleted successfully' });
});

// Admin Feedback Routes
router.get('/admin/all', requireAdmin, async (req, res) => {
  await ensureFeedbackSchema();
  const status = String(req.query.status || 'all').toLowerCase();
  const search = String(req.query.search || '').trim();

  const params = [];
  const where = [];

  if (status !== 'all') {
    params.push(status);
    where.push(`LOWER(f.status) = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR f.message ILIKE $${params.length})`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT f.id, f.rating, f.message, f.screenshot_url, f.category, f.status, f.admin_reply, f.is_anonymous, f.created_at, f.updated_at,
            u.id as student_id, u.full_name as student_name, u.email as student_email
     FROM feedback f
     JOIN users u ON u.id = f.user_id
     ${whereClause}
     ORDER BY f.created_at DESC
     LIMIT 100`,
    params
  );

  res.json({ feedback: rows });
});

router.post('/admin/:id/reply', requireAdmin, async (req, res) => {
  await ensureFeedbackSchema();
  const id = Number(req.params.id);
  const { reply } = req.body;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid feedback id' });
  if (!reply || !String(reply).trim()) return res.status(400).json({ error: 'Reply text required' });

  const safeReply = sanitizeText(reply, 5000);
  const { rows } = await pool.query(
    `UPDATE feedback
     SET admin_reply = $1, status = 'Replied', updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [safeReply, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });
  res.json({ message: 'Reply sent successfully', feedback: rows[0] });
});

router.patch('/admin/:id/status', requireAdmin, async (req, res) => {
  await ensureFeedbackSchema();
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid feedback id' });

  const validStatuses = ['Submitted', 'Under Review', 'Replied', 'Resolved', 'Closed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { rows } = await pool.query(
    `UPDATE feedback
     SET status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });
  res.json({ message: 'Status updated successfully', feedback: rows[0] });
});

module.exports = router;
module.exports.ensureFeedbackSchema = ensureFeedbackSchema;
