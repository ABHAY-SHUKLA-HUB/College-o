const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { resolveMembershipState } = require('../middleware/auth');

const router = express.Router();

function noteSourceTypeExpression(noteAlias = 'n', creatorAlias = 'creator') {
  return `COALESCE(${noteAlias}.source_type, CASE WHEN ${creatorAlias}.role IN ('admin', 'super_admin') THEN 'admin_upload' ELSE 'student_personal' END)`;
}

async function checkPremiumAccess(userId) {
  const membership = await resolveMembershipState(userId);
  return Boolean(membership?.isAdmin || membership?.premiumActive);
}

const { resolveStudentAcademicScope, applyAcademicScopeToQuery } = require('../utils/academic-scope');

router.get('/', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const role = String(req.session.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'super_admin';
  const isPremium = await checkPremiumAccess(userId);

  const { subject, search, college, format, categoryId, branchId, semesterId } = req.query;
  const sourceTypeExpression = noteSourceTypeExpression('n', 'creator');

  const params = [];
  const clauses = [
    `n.status = 'published'`,
    `n.deleted_at IS NULL`,
    `n.resolved_source_type = 'admin_upload'`
  ];

  if (!isAdmin) {
    const studentScope = await resolveStudentAcademicScope(userId);
    if (!studentScope || !studentScope.profileComplete) {
      return res.status(403).json({
        error: 'ACADEMIC_PROFILE_REQUIRED',
        message: 'Please complete your academic profile setup before accessing notes.'
      });
    }

    const { sqlClause, params: scopeParams } = applyAcademicScopeToQuery(studentScope, {
      alias: 'n',
      startIndex: params.length + 1,
      legacySupport: true
    });
    params.push(...scopeParams);
    clauses.push(sqlClause);
  }

  if (categoryId) {
    params.push(Number(categoryId));
    clauses.push(`n.category_id = $${params.length}`);
  }

  if (branchId) {
    params.push(Number(branchId));
    clauses.push(`(n.branch_id = $${params.length} OR n.is_common = TRUE)`);
  }

  if (semesterId) {
    params.push(Number(semesterId));
    clauses.push(`(n.semester_id = $${params.length} OR n.semester_id IS NULL)`);
  }

  if (subject) {
    params.push(subject);
    clauses.push(`(n.subject ILIKE $${params.length} OR n.academic_subject ILIKE $${params.length})`);
  }

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(n.chapter ILIKE $${params.length} OR n.content ILIKE $${params.length} OR n.subject ILIKE $${params.length})`);
  }

  if (college) {
    params.push(college);
    clauses.push(`(n.college_name = $${params.length} OR n.college_name IS NULL)`);
  }

  if (format) {
    params.push(format);
    clauses.push(`n.format_type = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `WITH scoped_notes AS (
       SELECT n.*, ${sourceTypeExpression} AS resolved_source_type
       FROM notes n
       LEFT JOIN users creator ON creator.id = n.created_by
     )
     SELECT
       n.id, n.subject, n.chapter, n.content, n.user_notes, n.bookmarks, n.difficulty,
       n.format_type, n.created_by, n.college_name, n.pdf_url, n.branch_id, n.semester_id,
       n.category_id, n.access_type, n.is_common, n.created_at,
       ac.name AS category_name, ab.name AS branch_name, asem.label AS semester_label
     FROM scoped_notes n
     LEFT JOIN academic_categories ac ON ac.id = n.category_id
     LEFT JOIN academic_branches ab ON ab.id = n.branch_id
     LEFT JOIN academic_semesters asem ON asem.id = n.semester_id
     ${where}
     ORDER BY n.created_at DESC
     LIMIT 200`,
    params
  );

  res.json({ notes: rows, isPremium });
});

router.get('/mine', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const { rows } = await pool.query(
    `WITH scoped_notes AS (
       SELECT n.*, ${noteSourceTypeExpression('n', 'creator')} AS resolved_source_type
       FROM notes n
       LEFT JOIN users creator ON creator.id = n.created_by
     )
     SELECT id, subject, chapter, content, user_notes, bookmarks, difficulty, format_type, created_at
     FROM scoped_notes
     WHERE created_by = $1 AND resolved_source_type = 'student_personal'
     ORDER BY created_at DESC`,
    [req.session.userId]
  );
  res.json({ notes: rows });
});

router.post('/', requireAuth, async (req, res) => {
  if (!(await checkPremiumAccess(req.session.userId))) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access notes.', code: 'UPGRADE_REQUIRED' });
  }

  const { subject, chapter, content, userNotes, bookmarks, difficulty, formatType } = req.body;
  if (!subject || !chapter || !content) return res.status(400).json({ error: 'subject, chapter, content required' });

  const { rows } = await pool.query(
    `INSERT INTO notes (subject, chapter, content, user_notes, bookmarks, difficulty, format_type, created_by, source_type, approval_status, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'student_personal', 'draft', 'private')
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
    `WITH scoped_notes AS (
       SELECT n.*, ${noteSourceTypeExpression('n', 'creator')} AS resolved_source_type
       FROM notes n
       LEFT JOIN users creator ON creator.id = n.created_by
     )
     SELECT id, subject, chapter, content, user_notes, bookmarks, difficulty, format_type, created_at
     FROM scoped_notes
     WHERE id = $1 AND created_by = $2 AND resolved_source_type = 'student_personal'`,
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
       AND COALESCE(source_type, 'student_personal') = 'student_personal'
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
    "DELETE FROM notes WHERE id = $1 AND created_by = $2 AND COALESCE(source_type, 'student_personal') = 'student_personal' RETURNING id",
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
    "UPDATE notes SET bookmarks = $1::jsonb WHERE id = $2 AND created_by = $3 AND COALESCE(source_type, 'student_personal') = 'student_personal' RETURNING id, bookmarks",
    [JSON.stringify(bookmarks), noteId, req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Note not found' });
  res.json({ note: rows[0] });
});

module.exports = router;
