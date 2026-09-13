/**
 * server/routes/admin-assessment-control.js
 * Admin Control Router for Mock Test Studio, Quizzes, Study Roadmaps, and Academic Structure
 */

const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { logSecurityEvent } = require('../middleware/auditLog');
const { toNumber } = require('../utils/validation');
const { safeParseJson, evaluateQuestionAnswer } = require('../services/assessmentEngine');

const router = express.Router();
router.use(requireAdmin);

// ============================================
// 1. MOCK TEST STUDIO & QUIZZES ADMIN AUTHORING
// ============================================

/**
 * GET /api/admin/control/assessments?type=mock_test&status=published
 * List assessments with pagination and filters
 */
router.get('/assessments', async (req, res) => {
  try {
    const type = req.query.type === 'quiz' ? 'quiz' : 'mock_test';
    const status = req.query.status ? String(req.query.status).toLowerCase() : null;
    const branchId = req.query.branchId ? Number(req.query.branchId) : null;
    const semesterId = req.query.semesterId ? Number(req.query.semesterId) : null;

    const isQuiz = type === 'quiz';
    const table = isQuiz ? 'quizzes' : 'mock_tests';
    const params = [];
    const clauses = ['t.deleted_at IS NULL'];

    if (status) {
      params.push(status);
      clauses.push(`COALESCE(t.status, 'published') = $${params.length}`);
    }
    if (branchId) {
      params.push(branchId);
      clauses.push(`t.branch_id = $${params.length}`);
    }
    if (semesterId) {
      params.push(semesterId);
      clauses.push(`t.semester_id = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
        t.*,
        ab.name as branch_name,
        asr.label as semester_label,
        sub.name as subject_name,
        COALESCE(q_count.cnt, 0)::int as calculated_question_count,
        COALESCE(att_count.cnt, 0)::int as total_attempts
       FROM ${table} t
       LEFT JOIN academic_branches ab ON ab.id = t.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = t.semester_id
       LEFT JOIN academic_subjects sub ON sub.id = t.subject_id
       LEFT JOIN (
         SELECT ${isQuiz ? 'quiz_id' : 'mock_test_id'} as tid, COUNT(*)::int as cnt
         FROM ${isQuiz ? 'quiz_questions' : 'mock_test_questions'}
         GROUP BY tid
       ) q_count ON q_count.tid = t.id
       LEFT JOIN (
         SELECT ${isQuiz ? 'quiz_id' : 'mock_test_id'} as tid, COUNT(*)::int as cnt
         FROM ${isQuiz ? 'quiz_attempts' : 'mock_test_attempts'}
         GROUP BY tid
       ) att_count ON att_count.tid = t.id
       ${where}
       ORDER BY t.created_at DESC`,
      params
    );

    res.json({ assessments: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/control/assessments
 * Create a new Assessment (Mock Test or Quiz) in DRAFT state
 */
router.post('/assessments', async (req, res) => {
  try {
    const type = req.body.type === 'quiz' ? 'quiz' : 'mock_test';
    const isQuiz = type === 'quiz';
    const table = isQuiz ? 'quizzes' : 'mock_tests';

    const {
      title,
      subject,
      chapter,
      topic,
      description,
      durationMinutes,
      totalMarks,
      passingMarks,
      attemptLimit,
      shuffleQuestions,
      shuffleOptions,
      accessType,
      branchId,
      semesterId,
      subjectId,
      startAt,
      endAt,
      resultPolicy
    } = req.body;

    if (!title && !subject) {
      return res.status(400).json({ error: 'Title or subject is required' });
    }

    const duration = toNumber(durationMinutes || req.body.timerMinutes, isQuiz ? 15 : 60);
    const marks = toNumber(totalMarks, 100);

    const queryStr = isQuiz
      ? `INSERT INTO quizzes (
          title, subject, chapter, difficulty, question_count, duration_minutes, timer_minutes,
          total_marks, passing_marks, attempt_limit, shuffle_questions, shuffle_options,
          access_type, branch_id, semester_id, subject_id, status, result_policy, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'draft', $17, NOW())
        RETURNING *`
      : `INSERT INTO mock_tests (
          title, subject, topic, description, duration_minutes, total_marks,
          attempt_limit_free, shuffle_questions, shuffle_options, access_type,
          branch_id, semester_id, subject_id, start_at, end_at, status, result_policy, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16, $17, NOW())
        RETURNING *`;

    const values = isQuiz
      ? [
          title || subject,
          subject || title,
          chapter || 'General',
          req.body.difficulty || 'medium',
          0,
          duration,
          duration,
          marks,
          toNumber(passingMarks, 0),
          toNumber(attemptLimit, 0),
          Boolean(shuffleQuestions),
          Boolean(shuffleOptions),
          accessType || 'free',
          branchId ? Number(branchId) : null,
          semesterId ? Number(semesterId) : null,
          subjectId ? Number(subjectId) : null,
          resultPolicy || 'IMMEDIATE'
        ]
      : [
          title || subject,
          subject || title,
          topic || 'General',
          description || '',
          duration,
          marks,
          toNumber(attemptLimit, 2),
          Boolean(shuffleQuestions),
          Boolean(shuffleOptions),
          accessType || 'free',
          branchId ? Number(branchId) : null,
          semesterId ? Number(semesterId) : null,
          subjectId ? Number(subjectId) : null,
          startAt ? new Date(startAt) : null,
          endAt ? new Date(endAt) : null,
          resultPolicy || 'IMMEDIATE',
          req.session.userId
        ];

    const result = await pool.query(queryStr, values);
    const created = result.rows[0];

    logSecurityEvent('assessment_created', {
      userId: req.session.userId,
      assessmentId: created.id,
      type
    });

    res.status(201).json({ message: 'Assessment created in draft', assessment: created });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/control/assessments/:id
 * Get assessment details WITH questions & answer key preview for Admin
 */
router.get('/assessments/:id', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const type = req.query.type === 'quiz' ? 'quiz' : 'mock_test';
    const isQuiz = type === 'quiz';
    const table = isQuiz ? 'quizzes' : 'mock_tests';
    const questionsTable = isQuiz ? 'quiz_questions' : 'mock_test_questions';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';

    const testRes = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
    const test = testRes.rows[0];
    if (!test) return res.status(404).json({ error: 'Assessment not found' });

    const questionsRes = await pool.query(
      `SELECT * FROM ${questionsTable} WHERE ${testIdCol} = $1 ORDER BY order_no, id`,
      [id]
    );

    res.json({
      assessment: test,
      questions: questionsRes.rows.map((q) => ({
        ...q,
        options: safeParseJson(q.options_json, []),
        correctAnswer: safeParseJson(q.correct_answer_json, null)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/control/assessments/:id
 * Update Assessment Metadata
 */
router.put('/assessments/:id', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const type = req.body.type === 'quiz' ? 'quiz' : 'mock_test';
    const isQuiz = type === 'quiz';
    const table = isQuiz ? 'quizzes' : 'mock_tests';

    const existingRes = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: 'Assessment not found' });

    // Lock protected fields if test is published and attempts exist!
    const attemptsTable = isQuiz ? 'quiz_attempts' : 'mock_test_attempts';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';
    const attemptsRes = await pool.query(`SELECT COUNT(*)::int as count FROM ${attemptsTable} WHERE ${testIdCol} = $1`, [id]);
    const attemptsExist = Number(attemptsRes.rows[0]?.count || 0) > 0;

    const {
      title,
      subject,
      chapter,
      topic,
      description,
      durationMinutes,
      totalMarks,
      passingMarks,
      attemptLimit,
      shuffleQuestions,
      shuffleOptions,
      accessType,
      branchId,
      semesterId,
      subjectId,
      startAt,
      endAt,
      resultPolicy
    } = req.body;

    const duration = toNumber(durationMinutes || req.body.timerMinutes, Number(existing.duration_minutes || 60));

    if (isQuiz) {
      await pool.query(
        `UPDATE quizzes SET
          title = $1, subject = $2, chapter = $3, duration_minutes = $4, timer_minutes = $4,
          total_marks = $5, passing_marks = $6, attempt_limit = $7, shuffle_questions = $8,
          shuffle_options = $9, access_type = $10, branch_id = $11, semester_id = $12,
          subject_id = $13, result_policy = $14, updated_at = NOW()
         WHERE id = $15`,
        [
          title || existing.title || subject,
          subject || existing.subject,
          chapter || existing.chapter || 'General',
          duration,
          toNumber(totalMarks, existing.total_marks || 100),
          toNumber(passingMarks, existing.passing_marks || 0),
          toNumber(attemptLimit, existing.attempt_limit || 0),
          shuffleQuestions !== undefined ? Boolean(shuffleQuestions) : existing.shuffle_questions,
          shuffleOptions !== undefined ? Boolean(shuffleOptions) : existing.shuffle_options,
          accessType || existing.access_type || 'free',
          branchId ? Number(branchId) : existing.branch_id,
          semesterId ? Number(semesterId) : existing.semester_id,
          subjectId ? Number(subjectId) : existing.subject_id,
          resultPolicy || existing.result_policy || 'IMMEDIATE',
          id
        ]
      );
    } else {
      await pool.query(
        `UPDATE mock_tests SET
          title = $1, subject = $2, topic = $3, description = $4, duration_minutes = $5,
          total_marks = $6, attempt_limit_free = $7, shuffle_questions = $8, shuffle_options = $9,
          access_type = $10, branch_id = $11, semester_id = $12, subject_id = $13,
          start_at = $14, end_at = $15, result_policy = $16, updated_at = NOW()
         WHERE id = $17`,
        [
          title || existing.title,
          subject || existing.subject,
          topic || existing.topic || 'General',
          description !== undefined ? description : existing.description,
          duration,
          toNumber(totalMarks, existing.total_marks || 100),
          toNumber(attemptLimit, existing.attempt_limit_free || 2),
          shuffleQuestions !== undefined ? Boolean(shuffleQuestions) : existing.shuffle_questions,
          shuffleOptions !== undefined ? Boolean(shuffleOptions) : existing.shuffle_options,
          accessType || existing.access_type || 'free',
          branchId ? Number(branchId) : existing.branch_id,
          semesterId ? Number(semesterId) : existing.semester_id,
          subjectId ? Number(subjectId) : existing.subject_id,
          startAt ? new Date(startAt) : existing.start_at,
          endAt ? new Date(endAt) : existing.end_at,
          resultPolicy || existing.result_policy || 'IMMEDIATE',
          id
        ]
      );
    }

    res.json({ message: 'Assessment metadata updated', attemptsExistWarning: attemptsExist });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/control/assessments/:id/questions
 * Add Question to Assessment
 */
router.post('/assessments/:id/questions', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const type = req.body.type === 'quiz' ? 'quiz' : 'mock_test';
    const isQuiz = type === 'quiz';
    const questionsTable = isQuiz ? 'quiz_questions' : 'mock_test_questions';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';

    const {
      questionText,
      questionType,
      difficulty,
      sectionName,
      subject,
      topic,
      marks,
      negativeMarks,
      explanation,
      options,
      correctAnswer,
      orderNo
    } = req.body;

    if (!questionText || !questionText.trim()) {
      return res.status(400).json({ error: 'Question text is required' });
    }
    if (correctAnswer === undefined || correctAnswer === null || String(correctAnswer).trim() === '') {
      return res.status(400).json({ error: 'Correct answer key is required' });
    }

    const qMarks = toNumber(marks, 1);
    const qNeg = toNumber(negativeMarks, 0);

    const result = await pool.query(
      `INSERT INTO ${questionsTable} (
        ${testIdCol}, question_text, question_type, difficulty, section_name, subject, topic,
        marks, negative_marks, explanation, options_json, correct_answer_json, order_no, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, NOW(), NOW())
      RETURNING *`,
      [
        id,
        questionText,
        questionType || 'single_mcq',
        difficulty || 'medium',
        sectionName || 'General',
        subject || 'General',
        topic || 'General',
        qMarks,
        qNeg,
        explanation || '',
        JSON.stringify(options || []),
        JSON.stringify(correctAnswer),
        toNumber(orderNo, 0)
      ]
    );

    // Update question count & total marks in assessment metadata
    const table = isQuiz ? 'quizzes' : 'mock_tests';
    await pool.query(
      `UPDATE ${table} SET
        total_questions = (SELECT COUNT(*)::int FROM ${questionsTable} WHERE ${testIdCol} = $1),
        question_count = (SELECT COUNT(*)::int FROM ${questionsTable} WHERE ${testIdCol} = $1),
        total_marks = COALESCE((SELECT SUM(marks)::int FROM ${questionsTable} WHERE ${testIdCol} = $1), 100)
       WHERE id = $1`,
      [id]
    );

    res.status(201).json({ message: 'Question added successfully', question: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/control/assessments/:id/questions/:questionId
 * Edit Question
 */
router.put('/assessments/:id/questions/:questionId', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const qid = toNumber(req.params.questionId, -1);
    const type = req.body.type === 'quiz' ? 'quiz' : 'mock_test';
    const isQuiz = type === 'quiz';
    const questionsTable = isQuiz ? 'quiz_questions' : 'mock_test_questions';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';

    const {
      questionText,
      questionType,
      difficulty,
      sectionName,
      subject,
      topic,
      marks,
      negativeMarks,
      explanation,
      options,
      correctAnswer,
      orderNo
    } = req.body;

    const result = await pool.query(
      `UPDATE ${questionsTable} SET
        question_text = COALESCE($1, question_text),
        question_type = COALESCE($2, question_type),
        difficulty = COALESCE($3, difficulty),
        section_name = COALESCE($4, section_name),
        subject = COALESCE($5, subject),
        topic = COALESCE($6, topic),
        marks = COALESCE($7, marks),
        negative_marks = COALESCE($8, negative_marks),
        explanation = COALESCE($9, explanation),
        options_json = CASE WHEN $10::jsonb IS NOT NULL THEN $10::jsonb ELSE options_json END,
        correct_answer_json = CASE WHEN $11::jsonb IS NOT NULL THEN $11::jsonb ELSE correct_answer_json END,
        order_no = COALESCE($12, order_no),
        updated_at = NOW()
       WHERE id = $13 AND ${testIdCol} = $14
       RETURNING *`,
      [
        questionText || null,
        questionType || null,
        difficulty || null,
        sectionName || null,
        subject || null,
        topic || null,
        marks !== undefined ? toNumber(marks, 1) : null,
        negativeMarks !== undefined ? toNumber(negativeMarks, 0) : null,
        explanation !== undefined ? explanation : null,
        options ? JSON.stringify(options) : null,
        correctAnswer !== undefined ? JSON.stringify(correctAnswer) : null,
        orderNo !== undefined ? toNumber(orderNo, 0) : null,
        qid,
        id
      ]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Question not found' });

    res.json({ message: 'Question updated successfully', question: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/control/assessments/:id/questions/:questionId
 * Delete Question
 */
router.delete('/assessments/:id/questions/:questionId', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const qid = toNumber(req.params.questionId, -1);
    const type = req.query.type === 'quiz' ? 'quiz' : 'mock_test';
    const isQuiz = type === 'quiz';
    const questionsTable = isQuiz ? 'quiz_questions' : 'mock_test_questions';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';

    const result = await pool.query(
      `DELETE FROM ${questionsTable} WHERE id = $1 AND ${testIdCol} = $2 RETURNING id`,
      [qid, id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Question not found' });

    // Update metadata counts
    const table = isQuiz ? 'quizzes' : 'mock_tests';
    await pool.query(
      `UPDATE ${table} SET
        total_questions = (SELECT COUNT(*)::int FROM ${questionsTable} WHERE ${testIdCol} = $1),
        question_count = (SELECT COUNT(*)::int FROM ${questionsTable} WHERE ${testIdCol} = $1),
        total_marks = COALESCE((SELECT SUM(marks)::int FROM ${questionsTable} WHERE ${testIdCol} = $1), 0)
       WHERE id = $1`,
      [id]
    );

    res.json({ message: 'Question deleted successfully', questionId: qid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/control/assessments/:id/publish
 * Validate & Publish Assessment
 */
router.post('/assessments/:id/publish', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const type = req.body.type === 'quiz' ? 'quiz' : 'mock_test';
    const isQuiz = type === 'quiz';
    const table = isQuiz ? 'quizzes' : 'mock_tests';
    const questionsTable = isQuiz ? 'quiz_questions' : 'mock_test_questions';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';

    const testRes = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id]);
    const test = testRes.rows[0];
    if (!test) return res.status(404).json({ error: 'Assessment not found' });

    const questionsRes = await pool.query(
      `SELECT * FROM ${questionsTable} WHERE ${testIdCol} = $1`,
      [id]
    );
    const questions = questionsRes.rows;

    if (!questions.length) {
      return res.status(400).json({
        error: 'PUBLISH_VALIDATION_FAILED',
        message: 'Cannot publish an empty assessment. Add at least 1 question.'
      });
    }

    // Validate each question has text and valid correct answer
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text || !q.question_text.trim()) {
        return res.status(400).json({
          error: 'PUBLISH_VALIDATION_FAILED',
          message: `Question #${i + 1} has empty text.`
        });
      }
      const ans = safeParseJson(q.correct_answer_json, null);
      if (ans === null || ans === undefined || String(ans).trim() === '') {
        return res.status(400).json({
          error: 'PUBLISH_VALIDATION_FAILED',
          message: `Question #${i + 1} ("${q.question_text.substring(0, 20)}...") has missing correct answer.`
        });
      }
    }

    // Validate schedule if start_at and end_at set
    if (test.start_at && test.end_at && new Date(test.end_at) <= new Date(test.start_at)) {
      return res.status(400).json({
        error: 'PUBLISH_VALIDATION_FAILED',
        message: 'End time must be after Start time.'
      });
    }

    const calculatedTotalMarks = questions.reduce((sum, q) => sum + Number(q.marks || 1), 0);

    await pool.query(
      `UPDATE ${table} SET
        status = 'published',
        published_at = NOW(),
        total_questions = $1,
        question_count = $1,
        total_marks = $2,
        updated_at = NOW()
       WHERE id = $3`,
      [questions.length, calculatedTotalMarks, id]
    );

    logSecurityEvent('assessment_published', {
      userId: req.session.userId,
      assessmentId: id,
      type
    });

    res.json({ message: 'Assessment published successfully', id, totalQuestions: questions.length, totalMarks: calculatedTotalMarks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/control/assessments/:id/archive
 * Archive Assessment
 */
router.post('/assessments/:id/archive', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const type = req.body.type === 'quiz' ? 'quiz' : 'mock_test';
    const table = type === 'quiz' ? 'quizzes' : 'mock_tests';

    const result = await pool.query(
      `UPDATE ${table} SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Assessment not found' });

    res.json({ message: 'Assessment archived successfully', id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/control/assessments/:id/results
 * Server-paginated Student Attempts & Performance View
 */
router.get('/assessments/:id/results', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const type = req.query.type === 'quiz' ? 'quiz' : 'mock_test';
    const limit = Math.min(100, Math.max(10, toNumber(req.query.limit, 20)));
    const offset = Math.max(0, toNumber(req.query.offset, 0));
    const search = req.query.search ? String(req.query.search).trim() : '';

    const isQuiz = type === 'quiz';
    const attemptsTable = isQuiz ? 'quiz_attempts' : 'mock_test_attempts';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';

    const params = [id];
    let where = `WHERE a.${testIdCol} = $1`;

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    const [countRes, attemptsRes, statsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as total FROM ${attemptsTable} a JOIN users u ON u.id = a.user_id ${where}`, params),
      pool.query(
        `SELECT
          a.*,
          u.full_name as student_name,
          u.email as student_email,
          up.course_branch,
          up.semester_id
         FROM ${attemptsTable} a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN user_profiles up ON up.user_id = u.id
         ${where}
         ORDER BY a.attempted_at DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params
      ),
      pool.query(
        `SELECT
          COUNT(*)::int as total_attempts,
          COALESCE(AVG(a.marks_obtained), 0)::numeric(8,2) as avg_score,
          COALESCE(MAX(a.marks_obtained), 0)::numeric(8,2) as max_score,
          COALESCE(COUNT(CASE WHEN a.is_passed = true THEN 1 END), 0)::int as pass_count
         FROM ${attemptsTable} a
         WHERE a.${testIdCol} = $1`,
        [id]
      )
    ]);

    const total = countRes.rows[0]?.total || 0;
    const stats = statsRes.rows[0] || {};
    const passRate = stats.total_attempts > 0 ? Number(((stats.pass_count / stats.total_attempts) * 100).toFixed(2)) : 0;

    res.json({
      total,
      limit,
      offset,
      stats: {
        totalAttempts: Number(stats.total_attempts || 0),
        averageScore: Number(stats.avg_score || 0),
        maxScore: Number(stats.max_score || 0),
        passCount: Number(stats.pass_count || 0),
        passRate
      },
      attempts: attemptsRes.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 2. ACADEMIC STRUCTURE CANONICAL ADMIN MODULE
// ============================================

/**
 * GET /api/admin/control/academic-structure
 * Fetch canonical Academic Hierarchy (Categories -> Branches -> Semesters -> Subjects)
 */
router.get('/academic-structure', async (_req, res) => {
  try {
    const [catRes, branchRes, semRes, subRes] = await Promise.all([
      pool.query('SELECT * FROM academic_categories WHERE is_active = true ORDER BY display_order, name'),
      pool.query('SELECT * FROM academic_branches WHERE is_active = true ORDER BY display_order, name'),
      pool.query('SELECT * FROM academic_semesters WHERE is_active = true ORDER BY display_order, semester_number'),
      pool.query('SELECT * FROM academic_subjects WHERE deleted_at IS NULL ORDER BY display_order, name')
    ]);

    res.json({
      categories: catRes.rows,
      branches: branchRes.rows,
      semesters: semRes.rows,
      subjects: subRes.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/control/academic-structure/subjects
 * Create Academic Subject
 */
router.post('/academic-structure/subjects', async (req, res) => {
  try {
    const { name, code, branchId, semesterId, description, credits, displayOrder } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Subject name is required' });
    }

    const result = await pool.query(
      `INSERT INTO academic_subjects (
        name, code, branch_id, semester_id, description, credits, display_order, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
      RETURNING *`,
      [
        name.trim(),
        code ? code.trim() : name.trim().toUpperCase().substring(0, 10),
        branchId ? Number(branchId) : null,
        semesterId ? Number(semesterId) : null,
        description || '',
        credits ? Number(credits) : 3,
        toNumber(displayOrder, 0)
      ]
    );

    logSecurityEvent('academic_subject_created', {
      userId: req.session.userId,
      subjectId: result.rows[0].id,
      name
    });

    res.status(201).json({ message: 'Subject created successfully', subject: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/control/academic-structure/subjects/:id
 * Update Academic Subject
 */
router.put('/academic-structure/subjects/:id', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const { name, code, branchId, semesterId, description, credits, displayOrder, isActive } = req.body;

    const result = await pool.query(
      `UPDATE academic_subjects SET
        name = COALESCE($1, name),
        code = COALESCE($2, code),
        branch_id = COALESCE($3, branch_id),
        semester_id = COALESCE($4, semester_id),
        description = COALESCE($5, description),
        credits = COALESCE($6, credits),
        display_order = COALESCE($7, display_order),
        is_active = COALESCE($8, is_active)
       WHERE id = $9 AND deleted_at IS NULL
       RETURNING *`,
      [
        name ? name.trim() : null,
        code ? code.trim() : null,
        branchId ? Number(branchId) : null,
        semesterId ? Number(semesterId) : null,
        description !== undefined ? description : null,
        credits ? Number(credits) : null,
        displayOrder !== undefined ? toNumber(displayOrder, 0) : null,
        isActive !== undefined ? Boolean(isActive) : null,
        id
      ]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Subject not found' });
    res.json({ message: 'Subject updated successfully', subject: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/control/academic-structure/subjects/:id
 * Soft Archive Academic Subject (Preserves historical test/content relationships)
 */
router.delete('/academic-structure/subjects/:id', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);

    const result = await pool.query(
      `UPDATE academic_subjects SET is_active = false, deleted_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Subject not found' });

    logSecurityEvent('academic_subject_archived', {
      userId: req.session.userId,
      subjectId: id
    });

    res.json({ message: 'Subject archived successfully. Historical relations preserved.', id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// 3. STUDY ROADMAP ADMIN AUTHORING
// ============================================

/**
 * GET /api/admin/control/roadmaps
 * List all Roadmaps for Admin
 */
router.get('/roadmaps', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        r.*,
        ab.name as branch_name,
        asr.label as semester_label,
        sub.name as subject_name,
        COALESCE(steps.cnt, 0)::int as total_steps
       FROM roadmaps r
       LEFT JOIN academic_branches ab ON ab.id = r.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = r.semester_id
       LEFT JOIN academic_subjects sub ON sub.id = r.subject_id
       LEFT JOIN (
         SELECT roadmap_id, COUNT(*)::int as cnt FROM roadmap_steps GROUP BY roadmap_id
       ) steps ON steps.roadmap_id = r.id
       WHERE r.deleted_at IS NULL
       ORDER BY r.created_at DESC`
    );
    res.json({ roadmaps: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/control/roadmaps
 * Create Roadmap in Draft state
 */
router.post('/roadmaps', async (req, res) => {
  try {
    const { title, description, categoryId, branchId, semesterId, subjectId, accessType } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Roadmap title is required' });
    }

    const result = await pool.query(
      `INSERT INTO roadmaps (
        title, description, category_id, branch_id, semester_id, subject_id,
        access_type, status, is_published, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', false, $8, NOW(), NOW())
      RETURNING *`,
      [
        title.trim(),
        description || '',
        categoryId ? Number(categoryId) : null,
        branchId ? Number(branchId) : null,
        semesterId ? Number(semesterId) : null,
        subjectId ? Number(subjectId) : null,
        accessType || 'free',
        req.session.userId
      ]
    );

    res.status(201).json({ message: 'Roadmap created in draft', roadmap: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/admin/control/roadmaps/:id
 * Get Roadmap and Step details
 */
router.get('/roadmaps/:id', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const roadmapRes = await pool.query(`SELECT * FROM roadmaps WHERE id = $1 AND deleted_at IS NULL`, [id]);
    const roadmap = roadmapRes.rows[0];
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found' });

    const stepsRes = await pool.query(
      `SELECT * FROM roadmap_steps WHERE roadmap_id = $1 ORDER BY step_order ASC, id ASC`,
      [id]
    );

    res.json({ roadmap, steps: stepsRes.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/admin/control/roadmaps/:id
 * Update Roadmap metadata
 */
router.put('/roadmaps/:id', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const { title, description, categoryId, branchId, semesterId, subjectId, accessType } = req.body;

    const result = await pool.query(
      `UPDATE roadmaps SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        category_id = COALESCE($3, category_id),
        branch_id = COALESCE($4, branch_id),
        semester_id = COALESCE($5, semester_id),
        subject_id = COALESCE($6, subject_id),
        access_type = COALESCE($7, access_type),
        updated_at = NOW()
       WHERE id = $8 AND deleted_at IS NULL
       RETURNING *`,
      [
        title ? title.trim() : null,
        description !== undefined ? description : null,
        categoryId ? Number(categoryId) : null,
        branchId ? Number(branchId) : null,
        semesterId ? Number(semesterId) : null,
        subjectId ? Number(subjectId) : null,
        accessType || null,
        id
      ]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Roadmap not found' });
    res.json({ message: 'Roadmap updated successfully', roadmap: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/control/roadmaps/:id/steps
 * Add or Update Roadmap Step
 */
router.post('/roadmaps/:id/steps', async (req, res) => {
  try {
    const roadmapId = toNumber(req.params.id, -1);
    const { stepId, title, description, stepOrder, resourceType, resourceId, resourceUrl, isRequired } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Step title is required' });
    }
    if (!resourceType) {
      return res.status(400).json({ error: 'Resource type is required (e.g. material, note, quiz, mock_test)' });
    }

    let result;
    if (stepId) {
      result = await pool.query(
        `UPDATE roadmap_steps SET
          title = $1, description = $2, step_order = $3, resource_type = $4,
          resource_id = $5, resource_url = $6, is_required = $7
         WHERE id = $8 AND roadmap_id = $9
         RETURNING *`,
        [
          title.trim(),
          description || '',
          toNumber(stepOrder, 0),
          resourceType,
          resourceId ? Number(resourceId) : null,
          resourceUrl || null,
          isRequired !== undefined ? Boolean(isRequired) : true,
          stepId,
          roadmapId
        ]
      );
    } else {
      result = await pool.query(
        `INSERT INTO roadmap_steps (
          roadmap_id, title, description, step_order, resource_type, resource_id, resource_url, is_required
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          roadmapId,
          title.trim(),
          description || '',
          toNumber(stepOrder, 0),
          resourceType,
          resourceId ? Number(resourceId) : null,
          resourceUrl || null,
          isRequired !== undefined ? Boolean(isRequired) : true
        ]
      );
    }

    res.status(201).json({ message: 'Roadmap step saved', step: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/admin/control/roadmaps/:id/steps/:stepId
 * Delete Roadmap Step
 */
router.delete('/roadmaps/:id/steps/:stepId', async (req, res) => {
  try {
    const roadmapId = toNumber(req.params.id, -1);
    const stepId = toNumber(req.params.stepId, -1);

    const result = await pool.query(
      `DELETE FROM roadmap_steps WHERE id = $1 AND roadmap_id = $2 RETURNING id`,
      [stepId, roadmapId]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Step not found' });
    res.json({ message: 'Step deleted successfully', stepId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/control/roadmaps/:id/publish
 * Validate & Publish Roadmap
 */
router.post('/roadmaps/:id/publish', async (req, res) => {
  try {
    const id = toNumber(req.params.id, -1);
    const stepsRes = await pool.query(`SELECT COUNT(*)::int as count FROM roadmap_steps WHERE roadmap_id = $1`, [id]);
    const stepCount = Number(stepsRes.rows[0]?.count || 0);

    if (stepCount === 0) {
      return res.status(400).json({
        error: 'PUBLISH_VALIDATION_FAILED',
        message: 'Cannot publish an empty roadmap. Add at least 1 step.'
      });
    }

    const result = await pool.query(
      `UPDATE roadmaps SET status = 'published', is_published = true, published_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [id]
    );

    if (!result.rows[0]) return res.status(404).json({ error: 'Roadmap not found' });

    logSecurityEvent('roadmap_published', {
      userId: req.session.userId,
      roadmapId: id
    });

    res.json({ message: 'Roadmap published successfully', roadmap: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
