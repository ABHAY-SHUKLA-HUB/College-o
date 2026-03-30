const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/mine', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const goal = 25;
  const [codeResult, countResult, historyResult, leaderboardResult] = await Promise.all([
    pool.query('SELECT referral_code FROM users WHERE id = $1', [userId]),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE LOWER(status) = 'successful')::int AS successful_count,
         COUNT(*) FILTER (WHERE LOWER(status) = 'pending')::int AS pending_count
       FROM referrals
       WHERE referrer_user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT
         r.id,
         u.full_name AS referred_user_name,
         r.status,
         r.created_at
       FROM referrals r
       JOIN users u ON u.id = r.referred_user_id
       WHERE r.referrer_user_id = $1
       ORDER BY r.created_at DESC
       LIMIT 25`,
      [userId]
    ),
    pool.query(
      `SELECT
         u.full_name,
         COUNT(*) FILTER (WHERE LOWER(r.status) = 'successful')::int AS successful_referrals
       FROM referrals r
       JOIN users u ON u.id = r.referrer_user_id
       GROUP BY r.referrer_user_id, u.full_name
       ORDER BY successful_referrals DESC, u.full_name ASC
       LIMIT 5`
    )
  ]);

  const successfulReferrals = countResult.rows[0]?.successful_count || 0;
  const pendingReferrals = countResult.rows[0]?.pending_count || 0;
  const rewardProgress = Math.min(100, Math.round((successfulReferrals / goal) * 100));

  res.json({
    referralCode: codeResult.rows[0]?.referral_code || null,
    successfulReferrals,
    pendingReferrals,
    referralGoal: goal,
    rewardProgress,
    history: historyResult.rows.map((row) => ({
      id: row.id,
      referredUserName: row.referred_user_name,
      joinedAt: row.created_at,
      status: row.status
    })),
    topReferrers: leaderboardResult.rows.map((row, index) => ({
      rank: index + 1,
      name: row.full_name,
      successfulReferrals: row.successful_referrals
    }))
  });
});

router.post('/apply', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Referral code required' });

  const refUser = await pool.query('SELECT id FROM users WHERE referral_code = $1', [code]);
  if (!refUser.rows[0]) return res.status(404).json({ error: 'Invalid code' });

  if (refUser.rows[0].id === req.session.userId) {
    return res.status(400).json({ error: 'Cannot apply your own code' });
  }

  await pool.query(
    'INSERT INTO referrals (referrer_user_id, referred_user_id, code_used, status) VALUES ($1, $2, $3, $4)',
    [refUser.rows[0].id, req.session.userId, code, 'successful']
  );

  res.json({ ok: true });
});

module.exports = router;
