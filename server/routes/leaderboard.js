const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const scope = String(req.query.scope || 'india').toLowerCase(); // india | city | college
  const timeframe = String(req.query.timeframe || 'all').toLowerCase(); // all | month | week | today
  const search = String(req.query.search || '').trim().toLowerCase();

  let intervalWhere = '';
  if (timeframe === 'month') intervalWhere = `AND qa.attempted_at >= NOW() - INTERVAL '30 days'`;
  if (timeframe === 'week') intervalWhere = `AND qa.attempted_at >= NOW() - INTERVAL '7 days'`;
  if (timeframe === 'today') intervalWhere = `AND qa.attempted_at >= DATE_TRUNC('day', NOW())`;

  const viewerId = req.session?.userId || null;
  let viewerCollege = null;
  let viewerCity = null;

  if (viewerId) {
    const viewer = await pool.query(
      `SELECT u.college_name, c.city
       FROM users u
       LEFT JOIN colleges c ON c.name = u.college_name
       WHERE u.id = $1`,
      [viewerId]
    );
    viewerCollege = viewer.rows[0]?.college_name || null;
    viewerCity = viewer.rows[0]?.city || null;
  }

  const params = [];
  const where = ["u.role = 'student'"];

  if (search) {
    params.push(`%${search}%`);
    where.push(`LOWER(u.full_name) LIKE $${params.length}`);
  }

  if (scope === 'college' && viewerCollege) {
    params.push(viewerCollege);
    where.push(`u.college_name = $${params.length}`);
  }

  if (scope === 'city' && viewerCity) {
    params.push(viewerCity);
    where.push(`c.city = $${params.length}`);
  }

  const { rows } = await pool.query(
    `SELECT
      u.id,
      u.full_name,
      u.college_name,
      COALESCE(c.city, 'N/A') AS city,
      COALESCE(qa_stats.xp, 0)::int AS xp,
      COALESCE(up.current_streak, 0)::int AS study_streak,
      COALESCE(mt_stats.completed_mock_tests, 0)::int AS mock_tests_completed,
      COALESCE(cert_stats.certificates_earned, 0)::int AS certificates_earned
     FROM users u
     LEFT JOIN colleges c ON c.name = u.college_name
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN (
       SELECT qa.user_id, COALESCE(SUM(qa.xp_earned), 0)::int AS xp
       FROM quiz_attempts qa
       WHERE 1=1 ${intervalWhere}
       GROUP BY qa.user_id
     ) qa_stats ON qa_stats.user_id = u.id
     LEFT JOIN (
       SELECT mta.user_id, COUNT(DISTINCT mta.mock_test_id)::int AS completed_mock_tests
       FROM mock_test_attempts mta
       GROUP BY mta.user_id
     ) mt_stats ON mt_stats.user_id = u.id
     LEFT JOIN (
       SELECT cert.user_id, COUNT(*)::int AS certificates_earned
       FROM certificates cert
       GROUP BY cert.user_id
     ) cert_stats ON cert_stats.user_id = u.id
     WHERE ${where.join(' AND ')}
     ORDER BY xp DESC, study_streak DESC, u.full_name ASC
     LIMIT 200`,
    params
  );

  res.json({
    leaderboard: rows,
    meta: {
      scope,
      timeframe,
      viewerUserId: viewerId,
      viewerCollege,
      viewerCity
    }
  });
});

module.exports = router;
