const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

let profileColumnsPromise = null;

async function ensureProfileColumns() {
  if (!profileColumnsPromise) {
    profileColumnsPromise = Promise.all([
      pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS course_branch VARCHAR(120)'),
      pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS semester VARCHAR(40)'),
      pool.query('ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT')
    ]);
  }

  return profileColumnsPromise;
}

router.get('/me', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const [
    userResult,
    certResult,
    roadmapResult,
    notesResult,
    xpResult,
    streakResult,
    mockResult,
    roadmapProgressResult,
    mockPerformanceResult,
    recentNotesResult,
    recentMocksResult,
    recentCertsResult,
    lastRoadmapResult
  ] = await Promise.all([
    pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.college_name,
         u.created_at,
         up.current_streak,
         up.target_exam,
         up.course_branch,
         up.semester,
         up.avatar_url
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    ),
    pool.query('SELECT COUNT(*)::int AS count FROM certificates WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*)::int AS count FROM roadmaps WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*)::int AS count FROM notes WHERE created_by = $1', [userId]),
    pool.query('SELECT COALESCE(SUM(xp_earned), 0)::int AS xp FROM quiz_attempts WHERE user_id = $1', [userId]),
    pool.query('SELECT COALESCE(current_streak, 0)::int AS streak FROM user_profiles WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*)::int AS count FROM mock_test_attempts WHERE user_id = $1', [userId]),
    pool.query('SELECT COALESCE(ROUND(AVG(progress), 0), 0)::int AS pct FROM roadmaps WHERE user_id = $1', [userId]),
    pool.query(
      `SELECT
         COALESCE(ROUND(AVG(CASE WHEN mt.total_marks > 0 THEN (mta.marks_obtained * 100.0 / mt.total_marks) ELSE 0 END), 0), 0)::int AS avg_pct
       FROM mock_test_attempts mta
       JOIN mock_tests mt ON mt.id = mta.mock_test_id
       WHERE mta.user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT subject, chapter, created_at
       FROM notes
       WHERE created_by = $1
       ORDER BY created_at DESC
       LIMIT 3`,
      [userId]
    ),
    pool.query(
      `SELECT mt.title, mta.marks_obtained, mta.attempted_at
       FROM mock_test_attempts mta
       JOIN mock_tests mt ON mt.id = mta.mock_test_id
       WHERE mta.user_id = $1
       ORDER BY mta.attempted_at DESC
       LIMIT 3`,
      [userId]
    ),
    pool.query(
      `SELECT type, issued_date, created_at
       FROM certificates
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 3`,
      [userId]
    ),
    pool.query(
      `SELECT progress, updated_at
       FROM roadmaps
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    )
  ]);

  const user = userResult.rows[0] || null;
  const totalXp = xpResult.rows[0]?.xp || 0;
  const currentStreak = streakResult.rows[0]?.streak || 0;
  const mockTestsAttempted = mockResult.rows[0]?.count || 0;
  const certificatesEarned = certResult.rows[0]?.count || 0;
  const savedNotes = notesResult.rows[0]?.count || 0;
  const completedRoadmaps = roadmapResult.rows[0]?.count || 0;

  const roadmapCompletion = roadmapProgressResult.rows[0]?.pct || 0;
  const mockPerformance = mockPerformanceResult.rows[0]?.avg_pct || 0;
  const certificationProgress = Math.min(100, Math.round((certificatesEarned / 5) * 100));

  const achievements = [
    {
      title: '7 Day Streak',
      icon: 'fa-fire',
      unlocked: currentStreak >= 7,
      description: 'Maintain a learning streak for 7+ days.'
    },
    {
      title: 'Quiz Master',
      icon: 'fa-brain',
      unlocked: totalXp >= 200,
      description: 'Earn at least 200 XP from quizzes.'
    },
    {
      title: 'Roadmap Starter',
      icon: 'fa-map',
      unlocked: completedRoadmaps >= 1,
      description: 'Create your first roadmap.'
    },
    {
      title: 'Certificate Earner',
      icon: 'fa-award',
      unlocked: certificatesEarned >= 1,
      description: 'Earn your first certificate.'
    }
  ];

  res.json({
    user,
    totals: {
      certificates: certificatesEarned,
      myRoadmaps: completedRoadmaps,
      savedNotes,
      totalXp,
      currentStreak,
      mockTestsAttempted,
      certificatesEarned,
      completedRoadmaps
    },
    learningProgress: {
      roadmapCompletion,
      mockPerformance,
      certificationProgress
    },
    achievements,
    recentActivity: {
      recentNotes: recentNotesResult.rows,
      recentMocks: recentMocksResult.rows,
      recentCertificates: recentCertsResult.rows,
      lastRoadmap: lastRoadmapResult.rows[0] || null
    }
  });
});

router.put('/me', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const {
    fullName,
    collegeName,
    courseBranch,
    semester,
    targetExam,
    avatarUrl
  } = req.body || {};

  await pool.query(
    `UPDATE users
     SET full_name = COALESCE($1, full_name),
         college_name = COALESCE($2, college_name)
     WHERE id = $3`,
    [fullName || null, collegeName || null, userId]
  );

  await pool.query(
    `INSERT INTO user_profiles (user_id, target_exam, course_branch, semester, avatar_url, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       target_exam = COALESCE(EXCLUDED.target_exam, user_profiles.target_exam),
       course_branch = COALESCE(EXCLUDED.course_branch, user_profiles.course_branch),
       semester = COALESCE(EXCLUDED.semester, user_profiles.semester),
       avatar_url = COALESCE(EXCLUDED.avatar_url, user_profiles.avatar_url),
       updated_at = NOW()`,
    [userId, targetExam || null, courseBranch || null, semester || null, avatarUrl || null]
  );

  res.json({ message: 'Profile updated successfully' });
});

router.put('/me/password', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'currentPassword and valid newPassword (min 6 chars) are required' });
  }

  const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  const nextHash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [nextHash, userId]);
  res.json({ message: 'Password changed successfully' });
});

module.exports = router;
module.exports.ensureProfileColumns = ensureProfileColumns;
