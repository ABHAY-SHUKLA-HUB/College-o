const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { buildAcademicScopeClauses } = require('../middleware/contentFilter');
const { resolveMembershipState } = require('../middleware/auth');

const router = express.Router();

router.get('/previous-papers', requireAuth, async (req, res) => {
  const user = await pool.query('SELECT college_name FROM users WHERE id = $1', [req.session.userId]);
  const profile = await pool.query(
    `SELECT category_id, branch_id, semester_id, college_id, course_id, year_id FROM user_profiles WHERE user_id = $1`,
    [req.session.userId]
  );
  const userCollege = user.rows[0]?.college_name;
  const membership = await resolveMembershipState(req.session.userId);
  if (!membership?.isAdmin && !membership?.premiumActive) {
    return res.status(403).json({ error: 'Upgrade to Premium (Rs.49/month) to access papers.', code: 'UPGRADE_REQUIRED' });
  }

  const requestedCollege = req.query.college || userCollege;
  const scope = buildAcademicScopeClauses(profile.rows[0], '');
  const params = [...scope.params];
  const clauses = [`COALESCE(status, 'published') = 'published'`, ...scope.clauses];
  if (requestedCollege) {
    params.push(requestedCollege);
    clauses.push(`(college_name = $${params.length} OR college_name IS NULL)`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, subject, exam_name, year, paper_url, summary_note_url, college_name, category_id, branch_id, semester_id, college_id, course_id, year_id, status, is_common
     FROM previous_papers ${where}
     ORDER BY year DESC`,
    params
  );
  res.json({ papers: rows });
});

router.get('/daily-challenges/today', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, title, description, xp_reward, active_date FROM daily_challenges WHERE active_date = CURRENT_DATE LIMIT 1');
  res.json({ challenge: rows[0] || null });
});

router.get('/badges', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, description, icon FROM badges ORDER BY id');
  res.json({ badges: rows });
});

router.get('/badges/mine', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id, b.name, b.description, b.icon, ub.earned_at
     FROM user_badges ub
     JOIN badges b ON b.id = ub.badge_id
     WHERE ub.user_id = $1
     ORDER BY ub.earned_at DESC`,
    [req.session.userId]
  );
  res.json({ badges: rows });
});

router.post('/support/tickets', requireAuth, async (req, res) => {
  const { issueType, priority, description } = req.body;
  if (!issueType || !priority || !description) {
    return res.status(400).json({ error: 'issueType, priority, description are required' });
  }

  const { rows } = await pool.query(
    `INSERT INTO support_tickets (user_id, issue_type, priority, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id, issue_type, priority, description, status, created_at`,
    [req.session.userId, issueType, priority, description]
  );

  res.status(201).json({ ticket: rows[0] });
});

module.exports = router;
