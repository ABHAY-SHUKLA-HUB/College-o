const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { buildAcademicScopeClauses } = require('../middleware/contentFilter');
const { resolveMembershipState } = require('../middleware/auth');

const router = express.Router();

const { resolveStudentAcademicScope, applyAcademicScopeToQuery } = require('../utils/academic-scope');

router.get('/previous-papers', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const role = String(req.session.role || '').toLowerCase();
  const isAdmin = role === 'admin' || role === 'super_admin';
  const membership = await resolveMembershipState(userId);
  const isPremium = Boolean(membership?.isAdmin || membership?.premiumActive);

  const { college, search, categoryId, branchId, semesterId } = req.query;

  const params = [];
  const clauses = [
    "COALESCE(pp.status, 'published') = 'published'",
    "pp.deleted_at IS NULL"
  ];

  if (!isAdmin) {
    const studentScope = await resolveStudentAcademicScope(userId);
    if (!studentScope || !studentScope.profileComplete) {
      return res.status(403).json({
        error: 'ACADEMIC_PROFILE_REQUIRED',
        message: 'Please complete your academic profile setup before accessing previous papers.'
      });
    }

    const { sqlClause, params: scopeParams } = applyAcademicScopeToQuery(studentScope, {
      alias: 'pp',
      startIndex: params.length + 1,
      legacySupport: true
    });
    params.push(...scopeParams);
    clauses.push(sqlClause);
  }

  if (categoryId) {
    params.push(Number(categoryId));
    clauses.push(`pp.category_id = $${params.length}`);
  }

  if (branchId) {
    params.push(Number(branchId));
    clauses.push(`(pp.branch_id = $${params.length} OR pp.is_common = TRUE)`);
  }

  if (semesterId) {
    params.push(Number(semesterId));
    clauses.push(`(pp.semester_id = $${params.length} OR pp.semester_id IS NULL)`);
  }

  if (college) {
    params.push(college);
    clauses.push(`(pp.college_name = $${params.length} OR pp.college_name IS NULL)`);
  }

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(LOWER(pp.subject) LIKE $${params.length} OR LOWER(pp.exam_name) LIKE $${params.length})`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT
      pp.id, pp.subject, pp.exam_name, pp.year, pp.paper_url, pp.summary_note_url,
      pp.college_name, pp.category_id, pp.branch_id, pp.semester_id, pp.status, pp.is_common, pp.access_type,
      ac.name AS category_name, ab.name AS branch_name, asem.label AS semester_label
     FROM previous_papers pp
     LEFT JOIN academic_categories ac ON ac.id = pp.category_id
     LEFT JOIN academic_branches ab ON ab.id = pp.branch_id
     LEFT JOIN academic_semesters asem ON asem.id = pp.semester_id
     ${where}
     ORDER BY pp.year DESC, pp.created_at DESC`,
    params
  );

  res.json({ papers: rows, isPremium });
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
