const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { publishContentChanged } = require('../services/realtimeBus');
const { deleteUploadedFileById } = require('../services/supabaseStorage');

const router = express.Router();

function noteSourceTypeExpression(noteAlias = 'n', creatorAlias = 'creator') {
  return `COALESCE(${noteAlias}.source_type, CASE WHEN ${creatorAlias}.role IN ('admin', 'super_admin') THEN 'admin_upload' ELSE 'student_personal' END)`;
}

// ============================================
// ADMIN ACADEMIC CONTENT MANAGEMENT
// ============================================

/**
 * GET /admin/academics/content-overview
 * Get statistics on content by branch/category
 */
router.get('/academics/content-overview', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      WITH scoped_notes AS (
        SELECT n.*, ${noteSourceTypeExpression('n', 'creator')} AS resolved_source_type
        FROM notes n
        LEFT JOIN users creator ON creator.id = n.created_by
      )
      SELECT
        ac.name as category,
        ab.name as branch,
        COUNT(CASE WHEN n.id IS NOT NULL THEN 1 END) as notes_count,
        COUNT(CASE WHEN q.id IS NOT NULL THEN 1 END) as quizzes_count,
        COUNT(CASE WHEN m.id IS NOT NULL THEN 1 END) as materials_count,
        COUNT(CASE WHEN pp.id IS NOT NULL THEN 1 END) as papers_count
      FROM academic_categories ac
      LEFT JOIN academic_branches ab ON ab.category_id = ac.id
      LEFT JOIN scoped_notes n ON (n.branch_id = ab.id OR (n.is_common = TRUE AND n.branch_id IS NULL)) AND n.resolved_source_type = 'admin_upload'
      LEFT JOIN quizzes q ON q.branch_id = ab.id OR (q.is_common = TRUE AND q.branch_id IS NULL)
      LEFT JOIN materials m ON m.branch_id = ab.id OR (m.is_common = TRUE AND m.branch_id IS NULL)
      LEFT JOIN previous_papers pp ON pp.branch_id = ab.id OR (pp.is_common = TRUE AND pp.branch_id IS NULL)
      GROUP BY ac.id, ac.name, ab.id, ab.name
      ORDER BY ac.name, ab.name
    `);
    res.json({ overview: result.rows });
  } catch (error) {
    console.error('Content overview error:', error);
    res.status(500).json({ error: 'Failed to fetch content overview' });
  }
});

/**
 * POST /admin/academics/notes
 * Upload academic notes with category/branch tagging
 */
router.post('/academics/notes', requireAdmin, async (req, res) => {
  try {
    const {
      subject,
      chapter,
      content,
      categoryId,
      branchId,
      semesterId,
      subjectId,
      academicSubject,
      formatType,
      difficulty,
      accessType,
      isCommon,
      status
    } = req.body;

    if (!subject || !chapter || !content) {
      return res.status(400).json({
        error: 'subject, chapter, and content are required'
      });
    }

    const result = await pool.query(
      `INSERT INTO notes (
        subject, chapter, content, format_type, difficulty,
        category_id, branch_id, semester_id, subject_id,
        academic_subject, access_type, is_common, status,
        created_by, created_at, source_type, approval_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP, $15, $16)
      RETURNING id, subject, chapter, category_id, branch_id, semester_id, status, created_at`,
      [
        subject,
        chapter,
        content,
        formatType || null,
        difficulty || null,
        categoryId || null,
        branchId || null,
        semesterId || null,
        subjectId || null,
        academicSubject || null,
        accessType || 'free',
        isCommon === true,
        status || 'published',
        req.session.userId,
        'admin_upload',
        'published'
      ]
    );

    res.status(201).json({
      message: 'Note uploaded successfully',
      note: result.rows[0]
    });
    publishContentChanged('notes', 'created', result.rows[0]?.id || null, {
      categoryId: categoryId || null,
      branchId: branchId || null,
      semesterId: semesterId || null,
      userId: req.session.userId
    });
  } catch (error) {
    console.error('Notes upload error:', error);
    if (error?.code === 'INVALID_UPLOAD_FILE' || error?.statusCode === 400) {
      return res.status(400).json({ error: error.message || 'Invalid file upload' });
    }
    res.status(500).json({ error: 'Failed to upload note' });
  }
});

/**
 * GET /admin/academics/notes?categoryId=1&branchId=1&status=published
 * Get notes with filters
 */
router.get('/academics/notes', requireAdmin, async (req, res) => {
  try {
    const { categoryId, branchId, semesterId, status } = req.query;
    const params = [];
    const clauses = ["resolved_source_type = 'admin_upload'"];

    const sourceTypeExpression = noteSourceTypeExpression('n', 'creator');

    if (categoryId) {
      params.push(Number(categoryId));
      clauses.push(`n.category_id = $${params.length}`);
    }

    if (branchId) {
      params.push(Number(branchId));
      clauses.push(`n.branch_id = $${params.length}`);
    }

    if (semesterId) {
      params.push(Number(semesterId));
      clauses.push(`n.semester_id = $${params.length}`);
    }

    params.push(status || 'published');
    clauses.push(`n.status = $${params.length}`);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await pool.query(
      `WITH scoped_notes AS (
         SELECT n.*, ${sourceTypeExpression} AS resolved_source_type
         FROM notes n
         LEFT JOIN users creator ON creator.id = n.created_by
       )
       SELECT
        n.id, n.subject, n.chapter, n.difficulty, n.format_type, n.access_type, n.status,
        n.is_common, n.created_at, n.pdf_url, n.college_name,
        ac.name as category_name, ab.name as branch_name, asr.label as semester_label,
        u.full_name as created_by_name
       FROM scoped_notes n
       LEFT JOIN academic_categories ac ON ac.id = n.category_id
       LEFT JOIN academic_branches ab ON ab.id = n.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = n.semester_id
       LEFT JOIN users u ON u.id = n.created_by
       ${where}
       ORDER BY n.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({ notes: result.rows });
  } catch (error) {
    console.error('Notes fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

/**
 * PUT /admin/academics/notes/:id
 * Update academic note
 */
router.put('/academics/notes/:id', requireAdmin, async (req, res) => {
  try {
    const noteId = Number(req.params.id);
    if (!Number.isInteger(noteId) || noteId <= 0) {
      return res.status(400).json({ error: 'Invalid note id' });
    }

    const {
      subject,
      chapter,
      content,
      categoryId,
      branchId,
      semesterId,
      accessType,
      isCommon,
      status
    } = req.body;

    const result = await pool.query(
      `UPDATE notes SET
        subject = COALESCE($1, subject),
        chapter = COALESCE($2, chapter),
        content = COALESCE($3, content),
        category_id = COALESCE($4, category_id),
        branch_id = COALESCE($5, branch_id),
        semester_id = COALESCE($6, semester_id),
        access_type = COALESCE($7, access_type),
        is_common = COALESCE($8, is_common),
        status = COALESCE($9, status)
       WHERE id = $10
       RETURNING id, subject, chapter, status, created_at`,
      [subject, chapter, content, categoryId || null, branchId || null, semesterId || null, accessType, isCommon, status, noteId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    res.json({
      message: 'Note updated successfully',
      note: result.rows[0]
    });
    publishContentChanged('notes', 'updated', noteId, {
      categoryId: categoryId || null,
      branchId: branchId || null,
      semesterId: semesterId || null,
      userId: req.session.userId
    });
  } catch (error) {
    console.error('Note update error:', error);
    res.status(500).json({ error: 'Failed to update note' });
  }
});

/**
 * DELETE /admin/academics/notes/:id
 */
router.delete('/academics/notes/:id', requireAdmin, async (req, res) => {
  try {
    const noteId = Number(req.params.id);
    const existing = await pool.query('SELECT pdf_url FROM notes WHERE id = $1', [noteId]);
    const result = await pool.query('DELETE FROM notes WHERE id = $1 RETURNING id', [noteId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const fileMatch = String(existing.rows[0]?.pdf_url || '').match(/\/api\/files\/(\d+)/);
    if (fileMatch) await deleteUploadedFileById(fileMatch[1]);

    res.json({ message: 'Note deleted successfully', id: noteId });
    publishContentChanged('notes', 'deleted', noteId, { userId: req.session.userId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

/**
 * POST /admin/academics/quizzes
 * Create academic quiz with tagging
 */
router.post('/academics/quizzes', requireAdmin, async (req, res) => {
  try {
    const {
      subject,
      chapter,
      difficulty,
      questionCount,
      categoryId,
      branchId,
      semesterId,
      accessType,
      isCommon,
      status
    } = req.body;

    if (!subject || !chapter || !questionCount) {
      return res.status(400).json({
        error: 'subject, chapter, and questionCount are required'
      });
    }

    const result = await pool.query(
      `INSERT INTO quizzes (
        subject, chapter, difficulty, question_count,
        category_id, branch_id, semester_id, access_type,
        is_common, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, subject, chapter, category_id, branch_id, status, created_at`,
      [
        subject,
        chapter,
        difficulty || null,
        questionCount,
        categoryId || null,
        branchId || null,
        semesterId || null,
        accessType || 'free',
        isCommon === true,
        status || 'published'
      ]
    );

    res.status(201).json({
      message: 'Quiz created successfully',
      quiz: result.rows[0]
    });
    publishContentChanged('quizzes', 'created', result.rows[0]?.id || null, {
      categoryId: categoryId || null,
      branchId: branchId || null,
      semesterId: semesterId || null,
      userId: req.session.userId
    });
  } catch (error) {
    console.error('Quiz creation error:', error);
    res.status(500).json({ error: 'Failed to create quiz' });
  }
});

/**
 * PUT /admin/academics/quizzes/:id
 * Update academic quiz
 */
router.put('/academics/quizzes/:id', requireAdmin, async (req, res) => {
  try {
    const quizId = Number(req.params.id);
    if (!Number.isInteger(quizId) || quizId <= 0) {
      return res.status(400).json({ error: 'Invalid quiz id' });
    }

    const {
      subject,
      chapter,
      difficulty,
      questionCount,
      categoryId,
      branchId,
      semesterId,
      accessType,
      isCommon,
      status
    } = req.body;

    const result = await pool.query(
      `UPDATE quizzes SET
        subject = COALESCE($1, subject),
        chapter = COALESCE($2, chapter),
        difficulty = COALESCE($3, difficulty),
        question_count = COALESCE($4, question_count),
        category_id = COALESCE($5, category_id),
        branch_id = COALESCE($6, branch_id),
        semester_id = COALESCE($7, semester_id),
        access_type = COALESCE($8, access_type),
        is_common = COALESCE($9, is_common),
        status = COALESCE($10, status)
       WHERE id = $11
       RETURNING id, subject, chapter, category_id, branch_id, semester_id, status, created_at, question_count, difficulty, access_type, is_common`,
      [subject, chapter, difficulty, questionCount ? Number(questionCount) : null, categoryId || null, branchId || null, semesterId || null, accessType, typeof isCommon === 'undefined' ? null : Boolean(isCommon), status, quizId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    res.json({ message: 'Quiz updated successfully', quiz: result.rows[0] });
  } catch (error) {
    console.error('Quiz update error:', error);
    res.status(500).json({ error: 'Failed to update quiz' });
  }
});

/**
 * GET /admin/academics/quizzes
 * Get quizzes with filters
 */
router.get('/academics/quizzes', requireAdmin, async (req, res) => {
  try {
    const { categoryId, branchId, semesterId, status } = req.query;
    const params = [];
    const clauses = [];

    if (categoryId) {
      params.push(Number(categoryId));
      clauses.push(`q.category_id = $${params.length}`);
    }

    if (branchId) {
      params.push(Number(branchId));
      clauses.push(`q.branch_id = $${params.length}`);
    }

    if (semesterId) {
      params.push(Number(semesterId));
      clauses.push(`q.semester_id = $${params.length}`);
    }

    params.push(status || 'published');
    clauses.push(`q.status = $${params.length}`);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
        q.id, q.subject, q.chapter, q.difficulty, q.question_count,
        q.access_type, q.is_common, q.status, q.created_at,
        ac.name as category_name, ab.name as branch_name,
        asr.label as semester_label
       FROM quizzes q
       LEFT JOIN academic_categories ac ON ac.id = q.category_id
       LEFT JOIN academic_branches ab ON ab.id = q.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = q.semester_id
       ${where}
       ORDER BY q.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({ quizzes: result.rows });
  } catch (error) {
    console.error('Quizzes fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch quizzes' });
  }
});

/**
 * DELETE /admin/academics/quizzes/:id
 * Delete academic quiz
 */
router.delete('/academics/quizzes/:id', requireAdmin, async (req, res) => {
  try {
    const quizId = Number(req.params.id);
    if (!quizId) {
      return res.status(400).json({ error: 'Invalid quiz id' });
    }

    const result = await pool.query('DELETE FROM quizzes WHERE id = $1 RETURNING id', [quizId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    res.json({ message: 'Quiz deleted successfully', id: quizId });
    publishContentChanged('quizzes', 'deleted', quizId, { userId: req.session.userId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete quiz' });
  }
});

/**
 * GET /admin/academics/dashboard
 * Analytics dashboard with branch-wise statistics
 */
router.get('/academics/dashboard', requireAdmin, async (req, res) => {
  try {
    const [studentsByBranch, contentByBranch, activeUsers] = await Promise.all([
      pool.query(`
        SELECT
          ac.name as category,
          ab.name as branch,
          COUNT(up.user_id)::int as student_count
        FROM academic_categories ac
        LEFT JOIN academic_branches ab ON ab.category_id = ac.id
        LEFT JOIN user_profiles up ON up.branch_id = ab.id AND up.onboarding_completed = TRUE
        GROUP BY ac.id, ac.name, ab.id, ab.name
        ORDER BY ac.name, ab.name
      `),
      pool.query(`
        SELECT
          ab.name as branch,
          COUNT(CASE WHEN n.id IS NOT NULL THEN 1 END)::int as notes,
          COUNT(CASE WHEN q.id IS NOT NULL THEN 1 END)::int as quizzes,
          COUNT(CASE WHEN pp.id IS NOT NULL THEN 1 END)::int as papers
        FROM academic_branches ab
        LEFT JOIN notes n ON n.branch_id = ab.id
        LEFT JOIN quizzes q ON q.branch_id = ab.id
        LEFT JOIN previous_papers pp ON pp.branch_id = ab.id
        GROUP BY ab.id, ab.name
        ORDER BY ab.name
      `),
      pool.query(`
        SELECT
          ac.name as category,
          ab.name as branch,
          COUNT(DISTINCT qa.user_id)::int as users_attempted_quizzes
        FROM academic_branches ab
        LEFT JOIN academic_categories ac ON ac.id = ab.category_id
        LEFT JOIN quizzes q ON q.branch_id = ab.id
        LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id
        GROUP BY ac.id, ac.name, ab.id, ab.name
        ORDER BY ac.name, ab.name
      `)
    ]);

    res.json({
      studentsByBranch: studentsByBranch.rows,
      contentByBranch: contentByBranch.rows,
      activeUsers: activeUsers.rows
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
