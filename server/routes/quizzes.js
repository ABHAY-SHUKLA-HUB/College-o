const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { toNumber } = require('../utils/validation');

const router = express.Router();

router.get('/', async (req, res) => {
  const viewerId = req.session?.userId || null;
  const subject = req.query.subject;
  const branchId = req.query.branchId;
  const semesterId = req.query.semesterId;
  
  // Get viewer's academic profile if logged in
  let userBranchId = null;
  let userSemesterId = null;
  
  if (viewerId) {
    const profileResult = await pool.query(
      `SELECT branch_id, semester_id FROM user_profiles WHERE user_id = $1`,
      [viewerId]
    );
    if (profileResult.rows[0]) {
      userBranchId = branchId || profileResult.rows[0].branch_id;
      userSemesterId = semesterId || profileResult.rows[0].semester_id;
    }
  }
  
  const params = [viewerId];
  let where = 'WHERE q.status = \'published\'';
  
  // Filter by branch
  if (userBranchId) {
    params.push(userBranchId);
    where += ` AND (q.branch_id = $${params.length} OR q.is_common = TRUE OR q.branch_id IS NULL)`;
  } else {
    where += ` AND (q.is_common = TRUE OR q.branch_id IS NULL)`;
  }
  
  // Filter by semester
  if (userSemesterId) {
    params.push(userSemesterId);
    where += ` AND (q.semester_id = $${params.length} OR q.semester_id IS NULL)`;
  }
  
  if (subject) {
    params.push(subject);
    where += ` AND (q.subject = $${params.length} OR q.academic_subject = $${params.length})`;
  }
  
  const { rows } = await pool.query(
    `SELECT
       q.id,
       q.subject,
       q.chapter,
       q.difficulty,
       q.question_count,
       q.branch_id,
       q.semester_id,
       q.is_common,
       COALESCE(MAX(qa.score_percent) FILTER (WHERE qa.user_id = $1), 0)::numeric(5,2) AS my_best_score,
       COALESCE(COUNT(qa.id) FILTER (WHERE qa.user_id = $1), 0)::int AS my_attempts,
       COALESCE(COUNT(DISTINCT qa.user_id), 0)::int AS students_attempted
     FROM quizzes q
     LEFT JOIN quiz_attempts qa ON qa.quiz_id = q.id
     ${where}
     GROUP BY q.id, q.subject, q.chapter, q.difficulty, q.question_count, q.branch_id, q.semester_id, q.is_common
     ORDER BY q.subject, q.chapter`,
    params
  );
  res.json({ quizzes: rows });
});

router.post('/:id/attempts', requireAuth, async (req, res) => {
  const quizId = toNumber(req.params.id, -1);
  const scorePercent = toNumber(req.body.scorePercent, 0);
  const xpEarned = toNumber(req.body.xpEarned, 0);
  if (quizId < 1) return res.status(400).json({ error: 'Invalid quiz id' });

  const { rows } = await pool.query(
    'INSERT INTO quiz_attempts (user_id, quiz_id, score_percent, xp_earned) VALUES ($1, $2, $3, $4) RETURNING id, score_percent, xp_earned, attempted_at',
    [req.session.userId, quizId, scorePercent, xpEarned]
  );
  res.status(201).json({ attempt: rows[0] });
});

router.get('/attempts/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT qa.id, qa.quiz_id, q.subject, q.chapter, qa.score_percent, qa.xp_earned, qa.attempted_at
     FROM quiz_attempts qa
     JOIN quizzes q ON q.id = qa.quiz_id
     WHERE qa.user_id = $1
     ORDER BY qa.attempted_at DESC
     LIMIT 50`,
    [req.session.userId]
  );
  res.json({ attempts: rows });
});

module.exports = router;
