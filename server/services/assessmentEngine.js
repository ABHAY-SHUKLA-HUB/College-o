/**
 * server/services/assessmentEngine.js
 * Authoritative Server-Side Assessment Engine for College OS
 * Handles Question Evaluation, Correct Answer Protection, Server-Authoritative Timer,
 * Incremental Autosave, Server-Side Scoring, and Idempotent Submissions.
 */

const { pool } = require('../db/pool');
const { resolveMembershipState } = require('../middleware/auth');
const { readFeatureMatrix, resolveEffectiveFeatureState } = require('../middleware/featureToggle');
const { logSecurityEvent } = require('../middleware/auditLog');

function safeParseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_e) {
    return typeof value === 'string' ? value : fallback;
  }
}

function normalizeQuestionType(type) {
  const val = String(type || 'single_mcq').toLowerCase();
  if (['single_mcq', 'multi_select', 'true_false', 'numerical', 'short_answer'].includes(val)) return val;
  return 'single_mcq';
}

function evaluateQuestionAnswer(question, submittedValue) {
  const type = normalizeQuestionType(question.question_type || question.type);
  const correct = safeParseJson(question.correct_answer_json || question.correctAnswer, null);

  if (type === 'single_mcq' || type === 'true_false') {
    const submitted = String(submittedValue ?? '').trim();
    const answer = String(correct ?? '').trim();
    return submitted.length > 0 && submitted.toLowerCase() === answer.toLowerCase();
  }

  if (type === 'numerical' || type === 'short_answer') {
    const submittedStr = String(submittedValue ?? '').trim();
    const answerStr = String(correct ?? '').trim();
    if (!submittedStr.length) return false;
    const submittedNum = Number(submittedStr);
    const answerNum = Number(answerStr);
    if (Number.isFinite(submittedNum) && Number.isFinite(answerNum)) {
      return Math.abs(submittedNum - answerNum) < 0.00001;
    }
    return submittedStr.toLowerCase() === answerStr.toLowerCase();
  }

  if (type === 'multi_select') {
    const submitted = Array.isArray(submittedValue) ? submittedValue.map((v) => String(v).trim()).sort() : [];
    const answer = Array.isArray(correct) ? correct.map((v) => String(v).trim()).sort() : [];
    if (submitted.length !== answer.length) return false;
    return submitted.every((v, idx) => v === answer[idx]);
  }

  return false;
}

/**
 * CRITICAL SECURITY HELPER:
 * Strips all correct answers, answer keys, and explanations from questions before returning to student browser.
 */
function stripAnswerKeysFromQuestions(questions) {
  if (!Array.isArray(questions)) return [];
  return questions.map((q) => {
    const {
      correct_answer_json,
      correctAnswer,
      is_correct,
      isCorrect,
      answer_key,
      explanation,
      ...safeQuestion
    } = q;

    // Sanitize options if array of objects containing is_correct
    if (Array.isArray(safeQuestion.options_json)) {
      safeQuestion.options = safeQuestion.options_json.map((opt) => {
        if (typeof opt === 'object' && opt !== null) {
          const { is_correct: _ic, isCorrect: _ic2, ...safeOpt } = opt;
          return safeOpt;
        }
        return opt;
      });
    } else if (Array.isArray(safeQuestion.options)) {
      safeQuestion.options = safeQuestion.options.map((opt) => {
        if (typeof opt === 'object' && opt !== null) {
          const { is_correct: _ic, isCorrect: _ic2, ...safeOpt } = opt;
          return safeOpt;
        }
        return opt;
      });
    }

    return safeQuestion;
  });
}

/**
 * START / RESUME ASSESSMENT ATTEMPT
 * Enforces User Suspension, Feature Toggle, Assessment Status, Schedule, Membership Entitlement,
 * Academic Profile Eligibility, Attempt Limit, Server-Authoritative Timer & Question Snapshot.
 */
async function startAssessmentAttempt({ userId, testId, testType = 'mock_test', session = {} }) {
  const client = await pool.connect();
  try {
    // 1. Verify User Account & Suspension Status
    const userRes = await client.query(
      'SELECT id, is_suspended, role FROM users WHERE id = $1',
      [userId]
    );
    const user = userRes.rows[0];
    if (!user) throw { statusCode: 401, error: 'User not found' };
    if (user.is_suspended) {
      throw { statusCode: 403, error: 'ACCOUNT_SUSPENDED', message: 'Your account is suspended. Protected assessment access is restricted.' };
    }

    // 2. Verify Feature Toggle
    const featureKey = testType === 'quiz' ? 'quizzes' : 'mock_tests';
    const matrix = await readFeatureMatrix(true);
    const isEnabled = resolveEffectiveFeatureState(matrix, featureKey, session);
    if (!isEnabled) {
      throw { statusCode: 403, error: 'FEATURE_DISABLED', message: `${testType === 'quiz' ? 'Quizzes' : 'Mock Tests'} feature is currently disabled.` };
    }

    // 3. Fetch Assessment Record
    const isQuiz = testType === 'quiz';
    const testTable = isQuiz ? 'quizzes' : 'mock_tests';
    const attemptsTable = isQuiz ? 'quiz_attempts' : 'mock_test_attempts';
    const questionsTable = isQuiz ? 'quiz_questions' : 'mock_test_questions';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';

    const testRes = await client.query(
      `SELECT * FROM ${testTable} WHERE id = $1 AND deleted_at IS NULL`,
      [testId]
    );
    const test = testRes.rows[0];
    if (!test) throw { statusCode: 404, error: 'TEST_NOT_FOUND', message: 'Assessment not found' };

    // Draft / Archived Denial
    const status = String(test.status || 'published').toLowerCase();
    if (status !== 'published') {
      throw { statusCode: 403, error: 'DRAFT_ACCESS_DENIED', message: 'This assessment is not published.' };
    }

    // 4. Verify Schedule (start_at / end_at)
    const now = new Date();
    if (test.start_at && now < new Date(test.start_at)) {
      throw { statusCode: 403, error: 'TEST_NOT_STARTED', message: `This assessment starts at ${new Date(test.start_at).toLocaleString()}` };
    }
    if (test.end_at && now > new Date(test.end_at)) {
      throw { statusCode: 403, error: 'TEST_EXPIRED', message: 'This assessment schedule window has closed.' };
    }

    // 5. Verify Membership Entitlement
    const membership = await resolveMembershipState(userId);
    const premiumActive = Boolean(membership?.premiumActive || membership?.isAdmin);
    if (String(test.access_type || 'free').toLowerCase() === 'premium' && !premiumActive) {
      throw { statusCode: 403, error: 'UPGRADE_REQUIRED', message: 'This assessment is premium-only. Upgrade to continue.' };
    }

    // 6. Verify Academic Scope Eligibility (Part 3 Strict Isolation)
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      const { resolveStudentAcademicScope, canStudentAccessResource } = require('../utils/academic-scope');
      const studentScope = await resolveStudentAcademicScope(userId);
      if (!studentScope || !studentScope.profileComplete) {
        throw { statusCode: 403, error: 'ACADEMIC_PROFILE_REQUIRED', message: 'Mandatory academic onboarding setup is required before attempting assessments.' };
      }
      if (!canStudentAccessResource(studentScope, test)) {
        throw { statusCode: 403, error: 'ACADEMIC_INELIGIBLE', message: 'This assessment is not authorized for your academic scope.' };
      }
    }

    // 7. Check Existing Active IN_PROGRESS Attempt
    const activeAttemptRes = await client.query(
      `SELECT * FROM ${attemptsTable}
       WHERE user_id = $1 AND ${testIdCol} = $2 AND status = 'IN_PROGRESS'
       ORDER BY started_at DESC LIMIT 1`,
      [userId, testId]
    );

    let activeAttempt = activeAttemptRes.rows[0] || null;

    if (activeAttempt) {
      // Resume Existing Attempt
      const expiresAt = new Date(activeAttempt.expires_at);
      if (now > expiresAt) {
        // Expired -> Auto finalize
        return await submitAssessmentAttempt({
          userId,
          attemptId: activeAttempt.id,
          testType,
          responses: safeParseJson(activeAttempt.answers_json, []),
          timeSpentSeconds: Number(test.duration_minutes || 15) * 60,
          isAutoSubmit: true
        });
      }

      const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
      const questionsSnapshot = safeParseJson(activeAttempt.question_snapshot, []);
      const sanitizedQuestions = stripAnswerKeysFromQuestions(questionsSnapshot);

      return {
        isResumed: true,
        attemptId: activeAttempt.id,
        test: {
          id: test.id,
          title: test.title || test.subject,
          durationMinutes: Number(test.duration_minutes || test.timer_minutes || 60),
          totalMarks: Number(test.total_marks || 100),
          instructions: test.instructions || test.description,
          resultPolicy: test.result_policy || 'IMMEDIATE'
        },
        expiresAt: expiresAt.toISOString(),
        remainingSeconds,
        savedAnswers: safeParseJson(activeAttempt.answers_json, []),
        questions: sanitizedQuestions
      };
    }

    // 8. Enforce Attempt Limit for New Attempt
    const attemptCountRes = await client.query(
      `SELECT COUNT(*)::int AS count FROM ${attemptsTable} WHERE user_id = $1 AND ${testIdCol} = $2`,
      [userId, testId]
    );
    const attemptsUsed = Number(attemptCountRes.rows[0]?.count || 0);
    const limit = Number(test.attempt_limit || test.attempt_limit_free || (isQuiz ? 0 : 2));

    if (limit > 0 && !premiumActive && attemptsUsed >= limit) {
      throw { statusCode: 403, error: 'ATTEMPT_LIMIT_REACHED', message: `Maximum attempt limit reached (${attemptsUsed}/${limit}).` };
    }

    // 9. Load Questions and Create Snapshot
    const questionsRes = await client.query(
      `SELECT * FROM ${questionsTable} WHERE ${testIdCol} = $1 ORDER BY order_no, id`,
      [testId]
    );
    let questions = questionsRes.rows;

    if (!questions.length) {
      throw { statusCode: 400, error: 'NO_QUESTIONS_CONFIGURED', message: 'This assessment has no questions configured.' };
    }

    if (test.shuffle_questions) {
      questions = [...questions].sort(() => Math.random() - 0.5);
    }
    if (test.shuffle_options) {
      questions = questions.map((q) => {
        const opts = safeParseJson(q.options_json, []);
        return Array.isArray(opts) ? { ...q, options_json: [...opts].sort(() => Math.random() - 0.5) } : q;
      });
    }

    const durationMinutes = Number(test.duration_minutes || test.timer_minutes || 60);
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

    // Insert Authoritative IN_PROGRESS Attempt
    const newAttemptRes = await client.query(
      `INSERT INTO ${attemptsTable} (
        user_id, ${testIdCol}, status, started_at, expires_at, question_snapshot, answers_json
      ) VALUES ($1, $2, 'IN_PROGRESS', NOW(), $3, $4::jsonb, '[]'::jsonb)
      RETURNING *`,
      [userId, testId, expiresAt, JSON.stringify(questions)]
    );

    const createdAttempt = newAttemptRes.rows[0];
    const sanitizedQuestions = stripAnswerKeysFromQuestions(questions);

    return {
      isResumed: false,
      attemptId: createdAttempt.id,
      test: {
        id: test.id,
        title: test.title || test.subject,
        durationMinutes,
        totalMarks: Number(test.total_marks || 100),
        instructions: test.instructions || test.description,
        resultPolicy: test.result_policy || 'IMMEDIATE'
      },
      expiresAt: expiresAt.toISOString(),
      remainingSeconds: durationMinutes * 60,
      savedAnswers: [],
      questions: sanitizedQuestions
    };
  } finally {
    client.release();
  }
}

/**
 * INCREMENTAL AUTOSAVE
 * Saves student answers in progress securely while verify attempt status and timer expiry.
 */
async function saveAttemptAnswers({ userId, attemptId, testType = 'mock_test', responses = [] }) {
  const isQuiz = testType === 'quiz';
  const attemptsTable = isQuiz ? 'quiz_attempts' : 'mock_test_attempts';

  const res = await pool.query(
    `SELECT * FROM ${attemptsTable} WHERE id = $1 AND user_id = $2`,
    [attemptId, userId]
  );
  const attempt = res.rows[0];
  if (!attempt) throw { statusCode: 404, error: 'ATTEMPT_NOT_FOUND', message: 'Attempt not found' };
  if (attempt.status !== 'IN_PROGRESS') {
    throw { statusCode: 400, error: 'ATTEMPT_NOT_IN_PROGRESS', message: 'Cannot save answers for finalized attempt.' };
  }

  if (new Date() > new Date(attempt.expires_at)) {
    throw { statusCode: 400, error: 'ATTEMPT_EXPIRED', message: 'Attempt duration has expired.' };
  }

  await pool.query(
    `UPDATE ${attemptsTable} SET answers_json = $1::jsonb WHERE id = $2`,
    [JSON.stringify(responses), attemptId]
  );

  return { success: true, savedAt: new Date().toISOString() };
}

/**
 * SUBMIT ASSESSMENT ATTEMPT & SERVER SCORING
 * Performs server-side scoring, atomic state transition IN_PROGRESS -> SUBMITTED,
 * idempotency check, and calculates pass/fail status.
 */
async function submitAssessmentAttempt({
  userId,
  attemptId,
  testType = 'mock_test',
  responses = [],
  timeSpentSeconds = 0,
  isAutoSubmit = false
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const isQuiz = testType === 'quiz';
    const testTable = isQuiz ? 'quizzes' : 'mock_tests';
    const attemptsTable = isQuiz ? 'quiz_attempts' : 'mock_test_attempts';
    const questionsTable = isQuiz ? 'quiz_questions' : 'mock_test_questions';
    const testIdCol = isQuiz ? 'quiz_id' : 'mock_test_id';

    const attemptRes = await client.query(
      `SELECT * FROM ${attemptsTable} WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [attemptId, userId]
    );
    const attempt = attemptRes.rows[0];
    if (!attempt) throw { statusCode: 404, error: 'ATTEMPT_NOT_FOUND', message: 'Attempt not found' };

    // Idempotent Check: If already SUBMITTED or AUTO_SUBMITTED, return existing result without re-evaluating!
    if (attempt.status === 'SUBMITTED' || attempt.status === 'AUTO_SUBMITTED') {
      await client.query('COMMIT');
      return {
        alreadySubmitted: true,
        attempt
      };
    }

    const testRes = await client.query(
      `SELECT * FROM ${testTable} WHERE id = $1`,
      [attempt[testIdCol]]
    );
    const test = testRes.rows[0] || {};

    // Load Snapshot Questions (or fallback to DB questions)
    let questions = safeParseJson(attempt.question_snapshot, null);
    if (!Array.isArray(questions) || !questions.length) {
      const dbQ = await client.query(
        `SELECT * FROM ${questionsTable} WHERE ${testIdCol} = $1 ORDER BY order_no, id`,
        [attempt[testIdCol]]
      );
      questions = dbQ.rows;
    }

    // Merge saved responses with incoming submit responses
    const savedResponses = safeParseJson(attempt.answers_json, []);
    const mergedMap = new Map();

    if (Array.isArray(savedResponses)) {
      savedResponses.forEach((r) => {
        if (r && r.questionId !== undefined) mergedMap.set(Number(r.questionId), r.answer);
      });
    }
    if (Array.isArray(responses)) {
      responses.forEach((r) => {
        if (r && r.questionId !== undefined) mergedMap.set(Number(r.questionId), r.answer);
      });
    }

    let correct = 0;
    let wrong = 0;
    let skipped = 0;
    let marksObtained = 0;
    let totalPossible = 0;
    const evaluatedAnswers = [];

    questions.forEach((q) => {
      const qid = Number(q.id);
      const submitted = mergedMap.get(qid);
      const hasAnswer = !(submitted === undefined || submitted === null || submitted === '');
      const marks = Number(q.marks || test.marks_per_question || 1);
      const negative = Number(q.negative_marks || test.negative_marks || 0);

      totalPossible += marks;

      if (!hasAnswer) {
        skipped += 1;
        evaluatedAnswers.push({ questionId: qid, answer: null, isCorrect: false, skipped: true });
      } else {
        const isCorrect = evaluateQuestionAnswer(q, submitted);
        if (isCorrect) {
          correct += 1;
          marksObtained += marks;
        } else {
          wrong += 1;
          marksObtained -= negative;
        }
        evaluatedAnswers.push({ questionId: qid, answer: submitted, isCorrect, skipped: false });
      }
    });

    const accuracy = correct + wrong > 0 ? (correct / (correct + wrong)) * 100 : 0;
    const percentage = totalPossible > 0 ? (marksObtained / totalPossible) * 100 : 0;
    const passingMarks = Number(test.passing_marks || 0);
    const isPassed = marksObtained >= passingMarks;
    const finalStatus = isAutoSubmit ? 'AUTO_SUBMITTED' : 'SUBMITTED';

    let updatedAttempt;
    if (isQuiz) {
      const scorePercent = Number(Math.max(0, percentage).toFixed(2));
      const xpEarned = Math.round(marksObtained * 10);
      const updateRes = await client.query(
        `UPDATE quiz_attempts SET
          status = $1,
          submitted_at = NOW(),
          score_percent = $2,
          xp_earned = $3,
          marks_obtained = $4,
          total_possible_marks = $5,
          answers_json = $6::jsonb,
          is_passed = $7
         WHERE id = $8
         RETURNING *`,
        [
          finalStatus,
          scorePercent,
          xpEarned,
          Number(marksObtained.toFixed(2)),
          Number(totalPossible.toFixed(2)),
          JSON.stringify(evaluatedAnswers),
          isPassed,
          attemptId
        ]
      );
      updatedAttempt = updateRes.rows[0];
    } else {
      const updateRes = await client.query(
        `UPDATE mock_test_attempts SET
          status = $1,
          submitted_at = NOW(),
          marks_obtained = $2,
          total_questions = $3,
          correct_answers = $4,
          wrong_answers = $5,
          skipped_answers = $6,
          accuracy_percent = $7,
          time_spent_seconds = $8,
          total_possible_marks = $9,
          answers_json = $10::jsonb,
          is_passed = $11
         WHERE id = $12
         RETURNING *`,
        [
          finalStatus,
          Number(marksObtained.toFixed(2)),
          questions.length,
          correct,
          wrong,
          skipped,
          Number(accuracy.toFixed(2)),
          Number(timeSpentSeconds || 0),
          Number(totalPossible.toFixed(2)),
          JSON.stringify(evaluatedAnswers),
          isPassed,
          attemptId
        ]
      );
      updatedAttempt = updateRes.rows[0];
    }

    await client.query('COMMIT');

    logSecurityEvent('assessment_attempt_submitted', {
      userId,
      attemptId,
      testType,
      marksObtained,
      totalPossible,
      status: finalStatus
    });

    return {
      alreadySubmitted: false,
      attempt: updatedAttempt,
      summary: {
        status: finalStatus,
        correct,
        wrong,
        skipped,
        marksObtained: Number(marksObtained.toFixed(2)),
        totalPossible: Number(totalPossible.toFixed(2)),
        accuracy: Number(accuracy.toFixed(2)),
        percentage: Number(percentage.toFixed(2)),
        isPassed
      }
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  safeParseJson,
  normalizeQuestionType,
  evaluateQuestionAnswer,
  stripAnswerKeysFromQuestions,
  startAssessmentAttempt,
  saveAttemptAnswers,
  submitAssessmentAttempt
};
