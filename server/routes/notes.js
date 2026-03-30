const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { resolveMembershipState } = require('../middleware/auth');

const router = express.Router();

async function checkPremiumAccess(userId) {
  const membership = await resolveMembershipState(userId);
  return Boolean(membership?.isAdmin || membership?.premiumActive);
}

router.get('/', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const userId = req.session.userId;
  const subject = req.query.subject;
  const search = req.query.search;
  const college = req.query.college;
  const format = req.query.format;
  const branchId = req.query.branchId; // Optional: filter by specific branch
  const semesterId = req.query.semesterId; // Optional: filter by specific semester
  
  // Get user's academic profile
  const userProfile = await pool.query(
    `SELECT branch_id, semester_id, category_id FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  
  const userBranchId = branchId || (userProfile.rows[0]?.branch_id);
  const userSemesterId = semesterId || (userProfile.rows[0]?.semester_id);

  const params = [];
  const clauses = [];

  // Filter by branch (student only sees their branch + common content)
  if (userBranchId) {
    params.push(userBranchId);
    clauses.push(`(branch_id = $${params.length} OR is_common = TRUE OR branch_id IS NULL)`);
  } else {
    // If no branch assigned yet, only show common content
    clauses.push(`(is_common = TRUE OR branch_id IS NULL)`);
  }

  // Filter by semester if user has one
  if (userSemesterId) {
    params.push(userSemesterId);
    clauses.push(`(semester_id = $${params.length} OR semester_id IS NULL)`);
  }

  if (subject) {
    params.push(subject);
    clauses.push(`(subject = $${params.length} OR academic_subject = $${params.length})`);
  }

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(chapter ILIKE $${params.length} OR content ILIKE $${params.length} OR subject ILIKE $${params.length})`);
  }

  if (college) {
    params.push(college);
    clauses.push(`(college_name = $${params.length} OR college_name IS NULL)`);
  }

  if (format) {
    params.push(format);
    clauses.push(`format_type = $${params.length}`);
  }

  // Only show published content
  clauses.push(`status = 'published'`);

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, subject, chapter, content, user_notes, bookmarks, difficulty, format_type, created_by, college_name, pdf_url, branch_id, semester_id, is_common, created_at
     FROM notes ${where}
     ORDER BY created_at DESC
     LIMIT 200`,
    params
  );

  res.json({ notes: rows });
});

router.get('/mine', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const { rows } = await pool.query('SELECT id, subject, chapter, user_notes, bookmarks, difficulty, format_type, created_at FROM notes WHERE created_by = $1 ORDER BY created_at DESC', [req.session.userId]);
  res.json({ notes: rows });
});

router.post('/', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const { subject, chapter, content, userNotes, bookmarks, difficulty, formatType } = req.body;
  if (!subject || !chapter || !content) return res.status(400).json({ error: 'subject, chapter, content required' });

  const { rows } = await pool.query(
    `INSERT INTO notes (subject, chapter, content, user_notes, bookmarks, difficulty, format_type, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
     RETURNING id, subject, chapter, content, user_notes, bookmarks, difficulty, format_type, created_by, created_at`,
    [subject, chapter, content, userNotes || null, JSON.stringify(bookmarks || []), difficulty || null, formatType || null, req.session.userId]
  );
  res.status(201).json({ note: rows[0] });
});

router.get('/:id', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const noteId = Number(req.params.id);
  const { rows } = await pool.query(
    'SELECT id, subject, chapter, content, user_notes, bookmarks, difficulty, format_type, created_at FROM notes WHERE id = $1 AND created_by = $2',
    [noteId, req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Note not found' });
  res.json({ note: rows[0] });
});

router.put('/:id', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const noteId = Number(req.params.id);
  const { subject, chapter, content, userNotes, bookmarks, difficulty, formatType } = req.body;
  
  const { rows } = await pool.query(
    `UPDATE notes 
     SET subject = COALESCE($1, subject), 
         chapter = COALESCE($2, chapter), 
         content = COALESCE($3, content), 
         user_notes = COALESCE($4, user_notes),
         bookmarks = COALESCE($5::jsonb, bookmarks),
         difficulty = COALESCE($6, difficulty),
         format_type = COALESCE($7, format_type)
     WHERE id = $8 AND created_by = $9 
     RETURNING id, subject, chapter, content, user_notes, bookmarks, difficulty, format_type, created_at`,
    [subject, chapter, content, userNotes, bookmarks ? JSON.stringify(bookmarks) : null, difficulty, formatType, noteId, req.session.userId]
  );
  
  if (!rows[0]) return res.status(404).json({ error: 'Note not found or unauthorized' });
  res.json({ note: rows[0] });
});

router.delete('/:id', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const noteId = Number(req.params.id);
  const { rows } = await pool.query(
    'DELETE FROM notes WHERE id = $1 AND created_by = $2 RETURNING id',
    [noteId, req.session.userId]
  );
  
  if (!rows[0]) return res.status(404).json({ error: 'Note not found or unauthorized' });
  res.json({ success: true, id: rows[0].id });
});

router.put('/:id/bookmark', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const noteId = Number(req.params.id);
  const bookmarks = req.body.bookmarks || [];
  const { rows } = await pool.query(
    'UPDATE notes SET bookmarks = $1::jsonb WHERE id = $2 AND created_by = $3 RETURNING id, bookmarks',
    [JSON.stringify(bookmarks), noteId, req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Note not found' });
  res.json({ note: rows[0] });
});

module.exports = router;
