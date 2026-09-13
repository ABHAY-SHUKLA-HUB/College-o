/**
 * server/routes/quizzes.js
 * Student Quizzes Router with Authoritative Server-Side Scoring & Security
 */

const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, resolveMembershipState } = require('../middleware/auth');
const { requireFeatureEnabled } = require('../middleware/featureToggle');
const { toNumber } = require('../utils/validation');
const {
  startAssessmentAttempt,
  saveAttemptAnswers,
  submitAssessmentAttempt,
  safeParseJson
} = require('../services/assessmentEngine');

const router = express.Router();
router.use(requireAuth);

router.get('/', requireFeatureEnabled('quizzes'), async (req, res) => {
  try {
    const viewerId = req.session?.userId || null;
    const subject = req.query.subject;
    const branchId = req.query.branchId;
    const semesterId = req.query.semesterId;
    const membership = viewerId ? await resolveMembershipState(viewerId) : null;
    const params = [viewerId];
    let where = "WHERE COALESCE(q.status, 'published') = 'published' AND q.deleted_at IS NULL";

    const userRole = String(req.session?.role || '').toLowerCase();
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';

    if (!isAdmin && viewerId) {
      const { resolveStudentAcademicScope, applyAcademicScopeToQuery } = require('../utils/academic-scope');
      const studentScope = await resolveStudentAcademicScope(viewerId);
      if (!studentScope || !studentScope.profileComplete) {
        return res.status(403).json({
          error: 'ACADEMIC_PROFILE_REQUIRED',
          code: 'ACADEMIC_PROFILE_REQUIRED',
          message: 'Mandatory academic setup is required before accessing quizzes.'
        });
      }

      const scopeFilter = applyAcademicScopeToQuery(studentScope, { alias: 'q', startIndex: params.length + 1, legacySupport: true });
      where += ` AND ${scopeFilter.sqlClause}`;
      params.push(...scopeFilter.params);
    }

    if (!membership?.isAdmin && !membership?.premiumActive) {
      where += ` AND COALESCE(q.access_type, 'free') <> 'premium'`;
    }

    if (subject) {
      params.push(subject);
      where += ` AND (q.subject = $${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT
         q.id,
         q.title,
         q.subject,
         q.chapter,
         q.difficulty,
         q.question_count,
         q.duration_minutes,
         q.timer_minutes,
         q.total_marks,
         q.passing_marks,
         q.branch_id,
         q.semester_id,
         q.access_type,
         q.is_common,
         COALESCE(MAX(qa.score_percent) FILTER (WHERE qa.user_id = $1), 0)::numeric(5,2) AS my_best_score,
         COALESCE(COUNT(qa.id) FILTER (WHERE qa.user_id = $1), 0)::int AS my_attempts,
         COALESCE(COUNT(DISTINCT qa.user_id), 0)::int AS students_attempted
       FROM quizzes q
       LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id
       ${where}
       GROUP BY q.id, q.title, q.subject, q.chapter, q.difficulty, q.question_count, q.duration_minutes, q.timer_minutes, q.total_marks, q.passing_marks, q.branch_id, q.semester_id, q.access_type, q.is_common
       ORDER BY q.subject, q.chapter`,
      params
    );

    res.json({ quizzes: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// START / RESUME QUIZ
router.get('/:id/start', requireFeatureEnabled('quizzes'), async (req, res) => {
  try {
    const quizId = toNumber(req.params.id, -1);
    if (quizId < 1) return res.status(400).json({ error: 'Invalid quiz id' });

    const result = await startAssessmentAttempt({
      userId: req.session.userId,
      testId: quizId,
      testType: 'quiz',
      session: req.session
    });

    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

// AUTOSAVE QUIZ ANSWERS
router.put('/attempts/:attemptId/save', requireFeatureEnabled('quizzes'), async (req, res) => {
  try {
    const attemptId = toNumber(req.params.attemptId, -1);
    if (attemptId < 1) return res.status(400).json({ error: 'Invalid attempt id' });

    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    const result = await saveAttemptAnswers({
      userId: req.session.userId,
      attemptId,
      testType: 'quiz',
      responses
    });

    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

// SUBMIT QUIZ ATTEMPT BY ATTEMPT ID
router.post('/attempts/:attemptId/submit', requireFeatureEnabled('quizzes'), async (req, res) => {
  try {
    const attemptId = toNumber(req.params.attemptId, -1);
    if (attemptId < 1) return res.status(400).json({ error: 'Invalid attempt id' });

    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    const timeSpentSeconds = toNumber(req.body.timeSpentSeconds, 0);

    const result = await submitAssessmentAttempt({
      userId: req.session.userId,
      attemptId,
      testType: 'quiz',
      responses,
      timeSpentSeconds
    });

    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

// BACKWARD COMPATIBLE SUBMIT BY QUIZ ID
router.post('/:id/submit', requireFeatureEnabled('quizzes'), async (req, res) => {
  try {
    const quizId = toNumber(req.params.id, -1);
    if (quizId < 1) return res.status(400).json({ error: 'Invalid quiz id' });

    const activeRes = await pool.query(
      `SELECT id FROM quiz_attempts WHERE user_id = $1 AND quiz_id = $2 AND status = 'IN_PROGRESS' ORDER BY started_at DESC LIMIT 1`,
      [req.session.userId, quizId]
    );

    let attemptId;
    if (activeRes.rows[0]) {
      attemptId = activeRes.rows[0].id;
    } else {
      const startRes = await startAssessmentAttempt({
        userId: req.session.userId,
        testId: quizId,
        testType: 'quiz',
        session: req.session
      });
      attemptId = startRes.attemptId;
    }

    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    const timeSpentSeconds = toNumber(req.body.timeSpentSeconds, 0);

    const result = await submitAssessmentAttempt({
      userId: req.session.userId,
      attemptId,
      testType: 'quiz',
      responses,
      timeSpentSeconds
    });

    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

// LEGACY / BACKWARD COMPATIBLE POST ATTEMPTS
router.post('/:id/attempts', requireFeatureEnabled('quizzes'), async (req, res) => {
  try {
    const quizId = toNumber(req.params.id, -1);
    if (quizId < 1) return res.status(400).json({ error: 'Invalid quiz id' });

    // Delegate to authoritative submit
    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    const startRes = await startAssessmentAttempt({
      userId: req.session.userId,
      testId: quizId,
      testType: 'quiz',
      session: req.session
    });

    const result = await submitAssessmentAttempt({
      userId: req.session.userId,
      attemptId: startRes.attemptId,
      testType: 'quiz',
      responses
    });

    res.status(201).json({ attempt: result.attempt, summary: result.summary });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

router.get('/attempts/me', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT qa.id, qa.quiz_id, q.subject, q.chapter, q.title, qa.score_percent, qa.xp_earned, qa.attempted_at, qa.status, qa.marks_obtained, qa.total_possible_marks
       FROM quiz_attempts qa
       JOIN quizzes q ON q.id = qa.quiz_id
       WHERE qa.user_id = $1
       ORDER BY qa.attempted_at DESC
       LIMIT 50`,
      [req.session.userId]
    );
    res.json({ attempts: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/results/:attemptId', async (req, res) => {
  try {
    const attemptId = toNumber(req.params.attemptId, -1);
    if (attemptId < 1) return res.status(400).json({ error: 'Invalid attempt id' });

    const attemptResult = await pool.query(
      `SELECT qa.*, q.title, q.subject, q.chapter, q.result_policy
       FROM quiz_attempts qa
       JOIN quizzes q ON q.id = qa.quiz_id
       WHERE qa.id = $1 AND qa.user_id = $2`,
      [attemptId, req.session.userId]
    );

    if (!attemptResult.rows[0]) return res.status(404).json({ error: 'Quiz attempt not found' });
    const attempt = attemptResult.rows[0];

    const reviewResult = await pool.query(
      `SELECT id, question_text, question_type, topic, marks, negative_marks, options_json, correct_answer_json, explanation
       FROM quiz_questions
       WHERE quiz_id = $1
       ORDER BY order_no, id`,
      [attempt.quiz_id]
    );

    const answerMap = new Map(
      safeParseJson(attempt.answers_json, []).map((row) => [Number(row.questionId), row])
    );

    const review = reviewResult.rows.map((q) => ({
      questionId: q.id,
      questionText: q.question_text,
      questionType: q.question_type,
      options: safeParseJson(q.options_json, []),
      correctAnswer: safeParseJson(q.correct_answer_json, null),
      explanation: q.explanation,
      submittedAnswer: answerMap.get(q.id)?.answer ?? null,
      isCorrect: Boolean(answerMap.get(q.id)?.isCorrect)
    }));

    res.json({
      result: attempt,
      review
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
