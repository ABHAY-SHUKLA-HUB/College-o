/**
 * server/routes/mockTests.js
 * Student Mock Tests Router with Authoritative Server-Side Scoring & Security
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
  safeParseJson,
  stripAnswerKeysFromQuestions
} = require('../services/assessmentEngine');
const { ensurePart9Schema } = require('../db/part9-schema');

const router = express.Router();

async function buildDashboardPayload(userId) {
  const [profileResult, membership, totalAttemptsResult] = await Promise.all([
    pool.query(
      `SELECT up.category_id, up.branch_id, up.semester_id, up.course_branch, ac.name AS category_name, ab.name AS branch_name
       FROM user_profiles up
       LEFT JOIN academic_categories ac ON ac.id = up.category_id
       LEFT JOIN academic_branches ab ON ab.id = up.branch_id
       WHERE up.user_id = $1`,
      [userId]
    ),
    resolveMembershipState(userId),
    pool.query('SELECT COUNT(*)::int AS count FROM mock_test_attempts WHERE user_id = $1', [userId])
  ]);

  const { resolveStudentAcademicScope, applyAcademicScopeToQuery } = require('../utils/academic-scope');
  const studentScope = await resolveStudentAcademicScope(userId);
  if (!studentScope || !studentScope.profileComplete) {
    return {
      profile: null,
      membership,
      summary: { totalAttempts: 0, completedCount: 0, avgMarks: 0, topRank: null },
      tests: [],
      error: 'ACADEMIC_PROFILE_REQUIRED'
    };
  }

  const scopeFilter = applyAcademicScopeToQuery(studentScope, { alias: 'mt', startIndex: 2, legacySupport: true });

  const testsResult = await pool.query(
    `SELECT
      mt.id,
      mt.title,
      mt.duration_minutes,
      mt.total_marks,
      mt.total_questions,
      mt.subject,
      mt.topic,
      mt.category_key,
      mt.difficulty,
      mt.syllabus,
      mt.instructions,
      mt.access_type,
      mt.status,
      mt.is_common,
      mt.branch_id,
      mt.semester_id,
      mt.attempt_limit_free,
      mt.retake_allowed,
      mt.scheduled_at,
      mt.start_at,
      mt.end_at,
      mt.result_policy,
      ab.name AS branch_name,
      asr.label AS semester_label,
      COALESCE(participants.total_participants, 0)::int AS participants_count,
      COALESCE(user_stats.attempt_count, 0)::int AS attempt_count,
      user_stats.last_attempt_id,
      user_stats.last_marks_obtained,
      user_stats.last_percentile,
      user_stats.last_rank_india,
      user_stats.last_accuracy_percent,
      user_stats.last_time_spent,
      user_stats.last_attempted_at,
      COALESCE(avg_stats.avg_marks, 0)::numeric(8,2) AS avg_marks,
      COALESCE(avg_stats.top_marks, 0)::numeric(8,2) AS top_marks
     FROM mock_tests mt
     LEFT JOIN academic_branches ab ON ab.id = mt.branch_id
     LEFT JOIN academic_semesters asr ON asr.id = mt.semester_id
     LEFT JOIN (
       SELECT mock_test_id, COUNT(*)::int AS total_participants
       FROM mock_test_attempts
       GROUP BY mock_test_id
     ) participants ON participants.mock_test_id = mt.id
     LEFT JOIN (
       SELECT
         mock_test_id,
         AVG(marks_obtained)::numeric(8,2) AS avg_marks,
         MAX(marks_obtained)::numeric(8,2) AS top_marks
       FROM mock_test_attempts
       GROUP BY mock_test_id
     ) avg_stats ON avg_stats.mock_test_id = mt.id
     LEFT JOIN LATERAL (
       SELECT
         COUNT(*)::int AS attempt_count,
         MAX(mta.attempted_at) AS last_attempted_at,
         (
           SELECT mta2.id
           FROM mock_test_attempts mta2
           WHERE mta2.mock_test_id = mt.id AND mta2.user_id = $1
           ORDER BY mta2.attempted_at DESC
           LIMIT 1
         ) AS last_attempt_id,
         (
           SELECT mta2.marks_obtained
           FROM mock_test_attempts mta2
           WHERE mta2.mock_test_id = mt.id AND mta2.user_id = $1
           ORDER BY mta2.attempted_at DESC
           LIMIT 1
         ) AS last_marks_obtained,
         (
           SELECT mta2.percentile
           FROM mock_test_attempts mta2
           WHERE mta2.mock_test_id = mt.id AND mta2.user_id = $1
           ORDER BY mta2.attempted_at DESC
           LIMIT 1
         ) AS last_percentile,
         (
           SELECT mta2.rank_india
           FROM mock_test_attempts mta2
           WHERE mta2.mock_test_id = mt.id AND mta2.user_id = $1
           ORDER BY mta2.attempted_at DESC
           LIMIT 1
         ) AS last_rank_india,
         (
           SELECT mta2.accuracy_percent
           FROM mock_test_attempts mta2
           WHERE mta2.mock_test_id = mt.id AND mta2.user_id = $1
           ORDER BY mta2.attempted_at DESC
           LIMIT 1
         ) AS last_accuracy_percent,
         (
           SELECT mta2.time_spent_seconds
           FROM mock_test_attempts mta2
           WHERE mta2.mock_test_id = mt.id AND mta2.user_id = $1
           ORDER BY mta2.attempted_at DESC
           LIMIT 1
         ) AS last_time_spent
       FROM mock_test_attempts mta
       WHERE mta.mock_test_id = mt.id AND mta.user_id = $1
     ) user_stats ON TRUE
     WHERE COALESCE(mt.status, 'published') = 'published'
       AND mt.deleted_at IS NULL
       AND ${scopeFilter.sqlClause}
     ORDER BY mt.scheduled_at DESC NULLS LAST, mt.id DESC`,
    [userId, ...scopeFilter.params]
  );

  const tests = testsResult.rows.map((test) => {
    const lockedByPremium = String(test.access_type || 'free').toLowerCase() === 'premium' && !premiumActive;
    const freeLimit = Number(test.attempt_limit_free || 2);
    const attemptsUsed = Number(test.attempt_count || 0);
    const limitReached = !premiumActive && attemptsUsed >= freeLimit;
    return {
      ...test,
      locked: lockedByPremium || limitReached,
      lockReason: lockedByPremium
        ? 'Premium only test'
        : (limitReached ? `Free attempts exhausted (${freeLimit}/${freeLimit})` : null),
      branch_relevance: profile?.branch_name || profile?.course_branch || 'General',
      previous_performance: attemptsUsed > 0
        ? {
            marks: Number(test.last_marks_obtained || 0),
            accuracy: Number(test.last_accuracy_percent || 0),
            rank: Number(test.last_rank_india || 0),
            percentile: Number(test.last_percentile || 0)
          }
        : null
    };
  });

  const categoriesMap = new Map([
    ['grand', { key: 'grand', title: 'Grand Tests', icon: 'fa-trophy', description: 'Full-length simulation of competitive exams', testsAvailable: 0 }],
    ['practice', { key: 'practice', title: 'Practice Tests', icon: 'fa-dumbbell', description: 'Targeted practice sets for regular preparation', testsAvailable: 0 }],
    ['topic', { key: 'topic', title: 'Topic Tests', icon: 'fa-book-open-reader', description: 'Short tests focused on individual topics', testsAvailable: 0 }],
    ['previous', { key: 'previous', title: 'Previous Year Tests', icon: 'fa-clock-rotate-left', description: 'Past exam pattern and PYQ simulation', testsAvailable: 0 }],
    ['quick', { key: 'quick', title: 'Quick Tests', icon: 'fa-bolt', description: 'Fast revision checks for instant confidence', testsAvailable: 0 }]
  ]);

  tests.forEach((test) => {
    const key = String(test.category_key || 'grand').toLowerCase();
    if (!categoriesMap.has(key)) return;
    categoriesMap.get(key).testsAvailable += 1;
  });

  const recentAttempts = await pool.query(
    `SELECT
      mta.id,
      mta.mock_test_id,
      mt.title,
      mta.marks_obtained,
      mta.total_possible_marks,
      mta.rank_india,
      mta.percentile,
      mta.accuracy_percent,
      mta.time_spent_seconds,
      mta.attempted_at,
      mta.status
     FROM mock_test_attempts mta
     JOIN mock_tests mt ON mt.id = mta.mock_test_id
     WHERE mta.user_id = $1
     ORDER BY mta.attempted_at DESC
     LIMIT 6`,
    [userId]
  );

  const overview = await pool.query(
    `SELECT
      COUNT(*)::int AS attempted_tests,
      COALESCE(ROUND(AVG(marks_obtained), 2), 0)::numeric(8,2) AS average_score,
      COALESCE(ROUND(AVG(accuracy_percent), 2), 0)::numeric(6,2) AS accuracy_percentage,
      COALESCE(MIN(rank_india), 0)::int AS best_rank,
      COALESCE(MAX(percentile), 0)::numeric(6,2) AS percentile,
      COALESCE(SUM(time_spent_seconds), 0)::int AS total_time_spent
     FROM mock_test_attempts
     WHERE user_id = $1`,
    [userId]
  );

  const o = overview.rows[0] || {};

  return {
    profile: {
      categoryId: profile?.category_id || null,
      branchId: profile?.branch_id || null,
      semesterId: profile?.semester_id || null,
      categoryName: profile?.category_name || null,
      branchName: profile?.branch_name || profile?.course_branch || null
    },
    quota: {
      freeLimit: 2,
      used: totalAttempts,
      remaining: Math.max(0, 2 - totalAttempts),
      premiumActive
    },
    overview: {
      attemptedTests: Number(o.attempted_tests || 0),
      averageScore: Number(o.average_score || 0),
      accuracyPercentage: Number(o.accuracy_percentage || 0),
      bestRank: Number(o.best_rank || 0),
      percentile: Number(o.percentile || 0),
      totalPracticeHours: Number(o.total_time_spent || 0) / 3600
    },
    categories: Array.from(categoriesMap.values()),
    tests,
    recommended: tests.filter((t) => !t.locked).slice(0, 6),
    recentAttempts: recentAttempts.rows
  };
}

router.get('/dashboard', requireAuth, requireFeatureEnabled('mock_tests'), async (req, res) => {
  try {
    const payload = await buildDashboardPayload(req.session.userId);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/leaderboard', requireAuth, async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        u.id,
        u.full_name,
        up.course_branch,
        ROUND(AVG(mta.marks_obtained), 2)::numeric(8,2) AS avg_score,
        ROUND(MAX(mta.percentile), 2)::numeric(6,2) AS best_percentile,
        COUNT(*)::int AS attempts
       FROM mock_test_attempts mta
       JOIN users u ON u.id = mta.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       GROUP BY u.id, up.course_branch
       ORDER BY AVG(mta.marks_obtained) DESC
       LIMIT 50`
    );
    res.json({ leaderboard: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// START or RESUME ATTEMPT
router.get('/:id/start', requireAuth, requireFeatureEnabled('mock_tests'), async (req, res) => {
  try {
    const mockTestId = toNumber(req.params.id, -1);
    if (mockTestId < 1) return res.status(400).json({ error: 'Invalid mock test id' });

    const result = await startAssessmentAttempt({
      userId: req.session.userId,
      testId: mockTestId,
      testType: 'mock_test',
      session: req.session
    });

    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

// AUTOSAVE ANSWERS
router.put('/attempts/:attemptId/save', requireAuth, requireFeatureEnabled('mock_tests'), async (req, res) => {
  try {
    const attemptId = toNumber(req.params.attemptId, -1);
    if (attemptId < 1) return res.status(400).json({ error: 'Invalid attempt id' });

    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    const result = await saveAttemptAnswers({
      userId: req.session.userId,
      attemptId,
      testType: 'mock_test',
      responses
    });

    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

// SUBMIT ATTEMPT
router.post('/attempts/:attemptId/submit', requireAuth, requireFeatureEnabled('mock_tests'), async (req, res) => {
  try {
    const attemptId = toNumber(req.params.attemptId, -1);
    if (attemptId < 1) return res.status(400).json({ error: 'Invalid attempt id' });

    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    const timeSpentSeconds = toNumber(req.body.timeSpentSeconds, 0);

    const result = await submitAssessmentAttempt({
      userId: req.session.userId,
      attemptId,
      testType: 'mock_test',
      responses,
      timeSpentSeconds
    });

    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

// BACKWARD COMPATIBLE SUBMIT BY TEST ID
router.post('/:id/submit', requireAuth, requireFeatureEnabled('mock_tests'), async (req, res) => {
  try {
    const mockTestId = toNumber(req.params.id, -1);
    if (mockTestId < 1) return res.status(400).json({ error: 'Invalid mock test id' });

    // Check for existing IN_PROGRESS attempt
    const activeRes = await pool.query(
      `SELECT id FROM mock_test_attempts WHERE user_id = $1 AND mock_test_id = $2 AND status = 'IN_PROGRESS' ORDER BY started_at DESC LIMIT 1`,
      [req.session.userId, mockTestId]
    );

    let attemptId;
    if (activeRes.rows[0]) {
      attemptId = activeRes.rows[0].id;
    } else {
      // Start and immediately submit if legacy client skipped start endpoint
      const startRes = await startAssessmentAttempt({
        userId: req.session.userId,
        testId: mockTestId,
        testType: 'mock_test',
        session: req.session
      });
      attemptId = startRes.attemptId;
    }

    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    const timeSpentSeconds = toNumber(req.body.timeSpentSeconds, 0);

    const result = await submitAssessmentAttempt({
      userId: req.session.userId,
      attemptId,
      testType: 'mock_test',
      responses,
      timeSpentSeconds
    });

    res.json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message, message: error.message });
  }
});

// FETCH RESULT
router.get('/results/:attemptId', requireAuth, async (req, res) => {
  try {
    const attemptId = toNumber(req.params.attemptId, -1);
    if (attemptId < 1) return res.status(400).json({ error: 'Invalid attempt id' });

    const attemptResult = await pool.query(
      `SELECT
        mta.*,
        mt.title,
        mt.subject,
        mt.topic,
        mt.category_key,
        mt.difficulty,
        mt.explanations_visible,
        mt.result_policy,
        mt.syllabus
       FROM mock_test_attempts mta
       JOIN mock_tests mt ON mt.id = mta.mock_test_id
       WHERE mta.id = $1 AND mta.user_id = $2`,
      [attemptId, req.session.userId]
    );

    if (!attemptResult.rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = attemptResult.rows[0];

    const resultPolicy = String(attempt.result_policy || 'IMMEDIATE').toUpperCase();
    const canViewDetailedReview = resultPolicy === 'IMMEDIATE';

    let review = [];
    if (canViewDetailedReview) {
      const reviewResult = await pool.query(
        `SELECT id, question_text, question_type, topic, section_name, marks, negative_marks, options_json, correct_answer_json, explanation
         FROM mock_test_questions
         WHERE mock_test_id = $1
         ORDER BY order_no, id`,
        [attempt.mock_test_id]
      );

      const answerMap = new Map(
        safeParseJson(attempt.answers_json, []).map((row) => [Number(row.questionId), row])
      );

      review = reviewResult.rows.map((q) => ({
        questionId: q.id,
        questionText: q.question_text,
        questionType: q.question_type,
        topic: q.topic,
        section: q.section_name,
        options: safeParseJson(q.options_json, []),
        correctAnswer: safeParseJson(q.correct_answer_json, null),
        explanation: q.explanation,
        submittedAnswer: answerMap.get(q.id)?.answer ?? null,
        isCorrect: Boolean(answerMap.get(q.id)?.isCorrect)
      }));
    }

    res.json({
      result: attempt,
      reviewPolicy: resultPolicy,
      canViewDetailedReview,
      review
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', requireAuth, async (req, res) => {
  try {
    const payload = await buildDashboardPayload(req.session.userId);
    res.json({
      mockTests: payload.tests,
      quota: payload.quota,
      overview: payload.overview,
      categories: payload.categories,
      recommended: payload.recommended,
      recentAttempts: payload.recentAttempts
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
