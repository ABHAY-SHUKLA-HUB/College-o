const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, resolveMembershipState } = require('../middleware/auth');
const { toNumber } = require('../utils/validation');

const router = express.Router();

let mockSchemaEnsured = false;

function normalizeQuestionType(type) {
  const value = String(type || 'single_mcq').toLowerCase();
  if (['single_mcq', 'multi_select', 'true_false', 'numerical', 'coding'].includes(value)) return value;
  return 'single_mcq';
}

function isPremiumAccess(accessType) {
  return String(accessType || 'free').toLowerCase() === 'premium';
}

function safeParseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return fallback;
  }
}

async function ensureMockTestSchema() {
  if (mockSchemaEnsured) return;

  await pool.query(`
    ALTER TABLE mock_tests
      ADD COLUMN IF NOT EXISTS category_key VARCHAR(40) DEFAULT 'grand',
      ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20) DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS total_questions INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS syllabus TEXT,
      ADD COLUMN IF NOT EXISTS instructions TEXT,
      ADD COLUMN IF NOT EXISTS attempt_limit_free INTEGER DEFAULT 2,
      ADD COLUMN IF NOT EXISTS retake_allowed BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS explanations_visible BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS marks_per_question NUMERIC(6,2) DEFAULT 1,
      ADD COLUMN IF NOT EXISTS negative_marking_enabled BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS negative_marks NUMERIC(6,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS section_config JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)
  `);

  await pool.query(`
    ALTER TABLE mock_test_attempts
      ADD COLUMN IF NOT EXISTS total_questions INTEGER,
      ADD COLUMN IF NOT EXISTS correct_answers INTEGER,
      ADD COLUMN IF NOT EXISTS wrong_answers INTEGER,
      ADD COLUMN IF NOT EXISTS skipped_answers INTEGER,
      ADD COLUMN IF NOT EXISTS accuracy_percent NUMERIC(6,2),
      ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER,
      ADD COLUMN IF NOT EXISTS total_possible_marks NUMERIC(8,2),
      ADD COLUMN IF NOT EXISTS answers_json JSONB,
      ADD COLUMN IF NOT EXISTS section_breakdown JSONB,
      ADD COLUMN IF NOT EXISTS topic_breakdown JSONB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mock_test_questions (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      mock_test_id INTEGER NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type VARCHAR(30) NOT NULL DEFAULT 'single_mcq',
      difficulty VARCHAR(20) DEFAULT 'medium',
      section_name VARCHAR(120),
      subject VARCHAR(120),
      topic VARCHAR(160),
      marks NUMERIC(6,2) DEFAULT 1,
      negative_marks NUMERIC(6,2) DEFAULT 0,
      explanation TEXT,
      options_json JSONB,
      correct_answer_json JSONB NOT NULL,
      order_no INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS mock_test_questions_test_idx ON mock_test_questions(mock_test_id, order_no)');
  await pool.query('CREATE INDEX IF NOT EXISTS mock_test_attempts_user_test_idx ON mock_test_attempts(user_id, mock_test_id, attempted_at DESC)');

  mockSchemaEnsured = true;
}

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

  const profile = profileResult.rows[0] || null;
  const premiumActive = Boolean(membership?.premiumActive || membership?.isAdmin);
  const totalAttempts = totalAttemptsResult.rows[0]?.count || 0;

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
       AND (
         COALESCE(mt.is_common, FALSE) = TRUE
         OR mt.branch_id IS NULL
         OR mt.branch_id = $2
       )
       AND (
         mt.semester_id IS NULL
         OR mt.semester_id = $3
       )
     ORDER BY mt.scheduled_at DESC NULLS LAST, mt.id DESC`,
    [userId, profile?.branch_id || null, profile?.semester_id || null]
  );

  const tests = testsResult.rows.map((test) => {
    const lockedByPremium = isPremiumAccess(test.access_type) && !premiumActive;
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
      mta.attempted_at
     FROM mock_test_attempts mta
     JOIN mock_tests mt ON mt.id = mta.mock_test_id
     WHERE mta.user_id = $1
     ORDER BY mta.attempted_at DESC
     LIMIT 6`,
    [userId]
  );

  const leaderboard = await pool.query(
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
     LIMIT 10`
  );

  const weakTopicsResult = await pool.query(
    `SELECT
      COALESCE(q.topic, mt.topic, 'General') AS topic,
      COUNT(*)::int AS total,
      ROUND(AVG(CASE WHEN ans.is_correct THEN 1 ELSE 0 END) * 100, 2)::numeric(6,2) AS accuracy
     FROM mock_test_attempts mta
     JOIN mock_tests mt ON mt.id = mta.mock_test_id
     LEFT JOIN LATERAL jsonb_array_elements(COALESCE(mta.answers_json, '[]'::jsonb)) ans_elem ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         (ans_elem ->> 'questionId')::int AS question_id,
         COALESCE((ans_elem ->> 'isCorrect')::boolean, false) AS is_correct
     ) ans ON TRUE
     LEFT JOIN mock_test_questions q ON q.id = ans.question_id
     WHERE mta.user_id = $1
     GROUP BY COALESCE(q.topic, mt.topic, 'General')
     HAVING COUNT(*) > 0
     ORDER BY AVG(CASE WHEN ans.is_correct THEN 1 ELSE 0 END) ASC
     LIMIT 3`,
    [userId]
  );

  const weakTopics = weakTopicsResult.rows.map((row) => ({ topic: row.topic, accuracy: Number(row.accuracy || 0) }));

  const recommended = tests
    .filter((t) => !t.locked)
    .sort((a, b) => {
      const aPerf = Number(a.last_percentile || 0);
      const bPerf = Number(b.last_percentile || 0);
      const aAttempts = Number(a.attempt_count || 0);
      const bAttempts = Number(b.attempt_count || 0);
      if (aAttempts !== bAttempts) return aAttempts - bAttempts;
      return aPerf - bPerf;
    })
    .slice(0, 6);

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
    recommended,
    recentAttempts: recentAttempts.rows,
    leaderboard: leaderboard.rows,
    aiInsights: {
      weakTopics,
      nextRecommendedTest: recommended[0] || null,
      suggestions: weakTopics.map((item) => `Revise ${item.topic} before your next full-length test.`)
    }
  };
}

function evaluateQuestion(question, submittedValue) {
  const type = normalizeQuestionType(question.question_type);
  const correct = safeParseJson(question.correct_answer_json, null);

  if (type === 'single_mcq' || type === 'true_false') {
    const submitted = String(submittedValue ?? '').trim();
    const answer = String(correct ?? '').trim();
    return submitted.length > 0 && submitted.toLowerCase() === answer.toLowerCase();
  }

  if (type === 'numerical') {
    const submittedNum = Number(submittedValue);
    const answerNum = Number(correct);
    if (!Number.isFinite(submittedNum) || !Number.isFinite(answerNum)) return false;
    return Math.abs(submittedNum - answerNum) < 0.00001;
  }

  if (type === 'multi_select') {
    const submitted = Array.isArray(submittedValue) ? submittedValue.map((v) => String(v).trim()).sort() : [];
    const answer = Array.isArray(correct) ? correct.map((v) => String(v).trim()).sort() : [];
    if (submitted.length !== answer.length) return false;
    return submitted.every((v, idx) => v === answer[idx]);
  }

  return false;
}

router.get('/dashboard', requireAuth, async (req, res) => {
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
        mt.syllabus,
        COALESCE(avg_stats.avg_marks, 0)::numeric(8,2) AS average_score,
        COALESCE(avg_stats.top_marks, 0)::numeric(8,2) AS top_score,
        COALESCE(branch_stats.branch_rank, 0)::int AS branch_rank,
        COALESCE(branch_stats.branch_total, 0)::int AS branch_total
       FROM mock_test_attempts mta
       JOIN mock_tests mt ON mt.id = mta.mock_test_id
       LEFT JOIN (
         SELECT mock_test_id, AVG(marks_obtained)::numeric(8,2) AS avg_marks, MAX(marks_obtained)::numeric(8,2) AS top_marks
         FROM mock_test_attempts
         GROUP BY mock_test_id
       ) avg_stats ON avg_stats.mock_test_id = mta.mock_test_id
       LEFT JOIN LATERAL (
         SELECT
           COALESCE((
             SELECT ranked.rank_pos
             FROM (
               SELECT id, RANK() OVER (ORDER BY marks_obtained DESC, attempted_at ASC) AS rank_pos
               FROM mock_test_attempts
               WHERE mock_test_id = mta.mock_test_id
                 AND user_id IN (
                   SELECT u2.id
                   FROM users u2
                   LEFT JOIN user_profiles up2 ON up2.user_id = u2.id
                   WHERE up2.course_branch = (
                     SELECT up1.course_branch FROM user_profiles up1 WHERE up1.user_id = mta.user_id
                   )
                 )
             ) ranked
             WHERE ranked.id = mta.id
           ), 0) AS branch_rank,
           COALESCE((
             SELECT COUNT(*)::int
             FROM mock_test_attempts x
             WHERE x.mock_test_id = mta.mock_test_id
               AND x.user_id IN (
                 SELECT u3.id
                 FROM users u3
                 LEFT JOIN user_profiles up3 ON up3.user_id = u3.id
                 WHERE up3.course_branch = (
                   SELECT up4.course_branch FROM user_profiles up4 WHERE up4.user_id = mta.user_id
                 )
               )
           ), 0) AS branch_total
       ) branch_stats ON TRUE
       WHERE mta.id = $1 AND mta.user_id = $2`,
      [attemptId, req.session.userId]
    );

    if (!attemptResult.rows[0]) return res.status(404).json({ error: 'Attempt not found' });
    const attempt = attemptResult.rows[0];

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

    const review = reviewResult.rows.map((q) => ({
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

    const strongTopics = safeParseJson(attempt.topic_breakdown, [])
      .filter((x) => Number(x.accuracy || 0) >= 70)
      .slice(0, 3);
    const weakTopics = safeParseJson(attempt.topic_breakdown, [])
      .filter((x) => Number(x.accuracy || 0) < 55)
      .slice(0, 3);

    res.json({
      result: attempt,
      charts: {
        scoreBreakdown: {
          correct: Number(attempt.correct_answers || 0),
          wrong: Number(attempt.wrong_answers || 0),
          skipped: Number(attempt.skipped_answers || 0)
        },
        sectionWise: safeParseJson(attempt.section_breakdown, []),
        topicWise: safeParseJson(attempt.topic_breakdown, []),
        timeSpentSeconds: Number(attempt.time_spent_seconds || 0)
      },
      comparison: {
        yourScore: Number(attempt.marks_obtained || 0),
        averageScore: Number(attempt.average_score || 0),
        topScore: Number(attempt.top_score || 0),
        branchRank: Number(attempt.branch_rank || 0),
        branchParticipants: Number(attempt.branch_total || 0),
        overallRank: Number(attempt.rank_india || 0)
      },
      aiAnalysis: {
        strongTopics,
        weakTopics,
        suggestions: [
          ...(weakTopics.map((item) => `Revise ${item.topic} and solve 2 topic tests before your next grand test.`)),
          'Improve time management in low-accuracy sections using quick tests.',
          'Review explanations for all wrong answers in this attempt.'
        ]
      },
      review,
      nextActions: {
        retryUrl: `mock-test-attempt.html?mockTestId=${attempt.mock_test_id}`,
        suggestedTopic: weakTopics[0]?.topic || null,
        notesUrl: weakTopics[0]?.topic
          ? `notes-library.html?search=${encodeURIComponent(weakTopics[0].topic)}`
          : 'notes-library.html',
        roadmapUrl: 'study-roadmap.html'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/start', requireAuth, async (req, res) => {
  try {
    const mockTestId = toNumber(req.params.id, -1);
    if (mockTestId < 1) return res.status(400).json({ error: 'Invalid mock test id' });

    const [testResult, membership] = await Promise.all([
      pool.query(
        `SELECT * FROM mock_tests
         WHERE id = $1 AND deleted_at IS NULL AND COALESCE(status, 'published') = 'published'`,
        [mockTestId]
      ),
      resolveMembershipState(req.session.userId)
    ]);

    const test = testResult.rows[0];
    if (!test) return res.status(404).json({ error: 'Mock test not found' });

    const premiumActive = Boolean(membership?.premiumActive || membership?.isAdmin);
    if (isPremiumAccess(test.access_type) && !premiumActive) {
      return res.status(403).json({
        error: 'This test is premium-only. Upgrade membership to continue.',
        code: 'UPGRADE_REQUIRED'
      });
    }

    const userAttemptsResult = await pool.query(
      'SELECT COUNT(*)::int AS count FROM mock_test_attempts WHERE user_id = $1 AND mock_test_id = $2',
      [req.session.userId, mockTestId]
    );
    const attemptsUsed = Number(userAttemptsResult.rows[0]?.count || 0);
    const freeLimit = Number(test.attempt_limit_free || 2);

    if (!premiumActive && attemptsUsed >= freeLimit) {
      return res.status(403).json({
        error: `Free plan allows only ${freeLimit} attempt(s) for this test.`,
        code: 'UPGRADE_REQUIRED'
      });
    }
    if (!test.retake_allowed && attemptsUsed > 0) {
      return res.status(403).json({
        error: 'Retake is disabled for this test by admin configuration.',
        code: 'RETAKE_NOT_ALLOWED'
      });
    }

    const questionsResult = await pool.query(
      `SELECT id, question_text, question_type, difficulty, section_name, subject, topic, marks, negative_marks, options_json, order_no
       FROM mock_test_questions
       WHERE mock_test_id = $1
       ORDER BY order_no, id`,
      [mockTestId]
    );

    let questions = questionsResult.rows.map((q) => ({
      id: q.id,
      text: q.question_text,
      type: q.question_type,
      difficulty: q.difficulty || test.difficulty || 'medium',
      section: q.section_name || 'General',
      subject: q.subject || test.subject || 'General',
      topic: q.topic || test.topic || 'General',
      marks: Number(q.marks || test.marks_per_question || 1),
      negativeMarks: Number(q.negative_marks || test.negative_marks || 0),
      options: safeParseJson(q.options_json, [])
    }));

    if (!questions.length) {
      questions = Array.from({ length: Math.max(10, Number(test.total_questions || 10)) }, (_x, idx) => ({
        id: -(idx + 1),
        text: `Placeholder Question ${idx + 1} for ${test.title}`,
        type: 'single_mcq',
        difficulty: test.difficulty || 'medium',
        section: 'General',
        subject: test.subject || 'General',
        topic: test.topic || 'General',
        marks: Number(test.marks_per_question || 1),
        negativeMarks: Number(test.negative_marks || 0),
        options: [
          { key: 'A', text: 'Option A' },
          { key: 'B', text: 'Option B' },
          { key: 'C', text: 'Option C' },
          { key: 'D', text: 'Option D' }
        ]
      }));
    }

    if (test.shuffle_questions) {
      questions = [...questions].sort(() => Math.random() - 0.5);
    }
    if (test.shuffle_options) {
      questions = questions.map((q) => ({ ...q, options: [...q.options].sort(() => Math.random() - 0.5) }));
    }

    res.json({
      test: {
        id: test.id,
        title: test.title,
        category: test.category_key || 'grand',
        difficulty: test.difficulty || 'medium',
        durationMinutes: Number(test.duration_minutes || 60),
        totalMarks: Number(test.total_marks || 100),
        totalQuestions: Number(test.total_questions || questions.length),
        subject: test.subject,
        topic: test.topic,
        syllabus: test.syllabus,
        instructions: test.instructions,
        marksPerQuestion: Number(test.marks_per_question || 1),
        negativeMarkingEnabled: Boolean(test.negative_marking_enabled),
        negativeMarks: Number(test.negative_marks || 0),
        sectionConfig: safeParseJson(test.section_config, []),
        explanationVisibleAfterSubmission: Boolean(test.explanations_visible)
      },
      questions,
      membership: {
        premiumActive,
        attemptsUsed,
        freeLimit
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/submit', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const mockTestId = toNumber(req.params.id, -1);
    if (mockTestId < 1) return res.status(400).json({ error: 'Invalid mock test id' });

    const responses = Array.isArray(req.body.responses) ? req.body.responses : [];
    const timeSpentSeconds = toNumber(req.body.timeSpentSeconds, 0);

    const [testResult, questionsResult] = await Promise.all([
      client.query('SELECT * FROM mock_tests WHERE id = $1 AND deleted_at IS NULL', [mockTestId]),
      client.query(
        `SELECT id, question_type, topic, section_name, marks, negative_marks, correct_answer_json
         FROM mock_test_questions
         WHERE mock_test_id = $1
         ORDER BY order_no, id`,
        [mockTestId]
      )
    ]);

    const test = testResult.rows[0];
    if (!test) return res.status(404).json({ error: 'Mock test not found' });

    const questions = questionsResult.rows;
    if (!questions.length) {
      return res.status(400).json({ error: 'This mock test has no questions configured yet.' });
    }

    const answerMap = new Map();
    responses.forEach((r) => {
      const qid = Number(r.questionId);
      if (Number.isFinite(qid)) answerMap.set(qid, r.answer);
    });

    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    let marksObtained = 0;
    let totalPossible = 0;

    const sectionStats = new Map();
    const topicStats = new Map();
    const answersJson = [];

    questions.forEach((question) => {
      const qid = Number(question.id);
      const submitted = answerMap.get(qid);
      const hasAnswer = !(submitted === undefined || submitted === null || submitted === '');
      const marks = Number(question.marks || test.marks_per_question || 1);
      const negative = Number(question.negative_marks || test.negative_marks || 0);
      const section = question.section_name || 'General';
      const topic = question.topic || test.topic || 'General';
      totalPossible += marks;

      const sec = sectionStats.get(section) || { section, correct: 0, wrong: 0, skipped: 0, total: 0 };
      const top = topicStats.get(topic) || { topic, correct: 0, wrong: 0, skipped: 0, total: 0 };
      sec.total += 1;
      top.total += 1;

      if (!hasAnswer) {
        skipped += 1;
        sec.skipped += 1;
        top.skipped += 1;
        answersJson.push({ questionId: qid, answer: null, isCorrect: false, skipped: true });
      } else {
        const isCorrect = evaluateQuestion(question, submitted);
        if (isCorrect) {
          correct += 1;
          marksObtained += marks;
          sec.correct += 1;
          top.correct += 1;
        } else {
          wrong += 1;
          marksObtained -= negative;
          sec.wrong += 1;
          top.wrong += 1;
        }
        answersJson.push({ questionId: qid, answer: submitted, isCorrect, skipped: false });
      }

      sectionStats.set(section, sec);
      topicStats.set(topic, top);
    });

    const accuracy = correct + wrong > 0 ? (correct / (correct + wrong)) * 100 : 0;

    const sectionBreakdown = Array.from(sectionStats.values()).map((row) => ({
      ...row,
      accuracy: row.correct + row.wrong > 0 ? Number(((row.correct / (row.correct + row.wrong)) * 100).toFixed(2)) : 0
    }));
    const topicBreakdown = Array.from(topicStats.values()).map((row) => ({
      ...row,
      accuracy: row.correct + row.wrong > 0 ? Number(((row.correct / (row.correct + row.wrong)) * 100).toFixed(2)) : 0
    }));

    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO mock_test_attempts (
        user_id,
        mock_test_id,
        marks_obtained,
        percentile,
        rank_india,
        total_questions,
        correct_answers,
        wrong_answers,
        skipped_answers,
        accuracy_percent,
        time_spent_seconds,
        total_possible_marks,
        answers_json,
        section_breakdown,
        topic_breakdown
      )
      VALUES ($1, $2, $3, 0, 0, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)
      RETURNING *`,
      [
        req.session.userId,
        mockTestId,
        Number(marksObtained.toFixed(2)),
        questions.length,
        correct,
        wrong,
        skipped,
        Number(accuracy.toFixed(2)),
        timeSpentSeconds,
        Number(totalPossible.toFixed(2)),
        JSON.stringify(answersJson),
        JSON.stringify(sectionBreakdown),
        JSON.stringify(topicBreakdown)
      ]
    );

    const attempt = insertResult.rows[0];

    const rankingResult = await client.query(
      `WITH ranked AS (
         SELECT
           id,
           RANK() OVER (ORDER BY marks_obtained DESC, attempted_at ASC) AS rank_pos,
           ROUND((PERCENT_RANK() OVER (ORDER BY marks_obtained) * 100)::numeric, 2) AS percentile_score
         FROM mock_test_attempts
         WHERE mock_test_id = $1
       )
       SELECT rank_pos, percentile_score FROM ranked WHERE id = $2`,
      [mockTestId, attempt.id]
    );

    const rankRow = rankingResult.rows[0] || { rank_pos: 0, percentile_score: 0 };

    const updated = await client.query(
      `UPDATE mock_test_attempts
       SET rank_india = $1, percentile = $2
       WHERE id = $3
       RETURNING *`,
      [Number(rankRow.rank_pos || 0), Number(rankRow.percentile_score || 0), attempt.id]
    );

    await client.query('COMMIT');

    res.status(201).json({
      attempt: updated.rows[0],
      summary: {
        correct,
        wrong,
        skipped,
        marksObtained: Number(marksObtained.toFixed(2)),
        totalPossible: Number(totalPossible.toFixed(2)),
        accuracy: Number(accuracy.toFixed(2)),
        rankIndia: Number(updated.rows[0].rank_india || 0),
        percentile: Number(updated.rows[0].percentile || 0)
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
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
      recentAttempts: payload.recentAttempts,
      leaderboard: payload.leaderboard,
      aiInsights: payload.aiInsights
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Backward-compatible endpoint used by existing client paths.
router.post('/:id/attempts', requireAuth, async (req, res) => {
  try {
    const mockTestId = toNumber(req.params.id, -1);
    const marks = toNumber(req.body.marksObtained, 0);
    const percentile = toNumber(req.body.percentile, 0);
    const rank = toNumber(req.body.rankIndia, 0);

    if (mockTestId < 1) return res.status(400).json({ error: 'Invalid mock test id' });

    const membership = await resolveMembershipState(req.session.userId);
    const premiumActive = Boolean(membership?.premiumActive || membership?.isAdmin);

    if (!premiumActive) {
      const attempts = await pool.query('SELECT COUNT(*)::int AS count FROM mock_test_attempts WHERE user_id = $1', [req.session.userId]);
      if ((attempts.rows[0]?.count || 0) >= 2) {
        return res.status(403).json({
          error: 'Free plan allows only 2 mock tests. Upgrade to Premium (Rs.49/month).',
          code: 'UPGRADE_REQUIRED'
        });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO mock_test_attempts (user_id, mock_test_id, marks_obtained, percentile, rank_india)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, marks_obtained, percentile, rank_india, attempted_at`,
      [req.session.userId, mockTestId, marks, percentile, rank]
    );

    res.status(201).json({ attempt: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
module.exports.ensureMockTestSchema = ensureMockTestSchema;
