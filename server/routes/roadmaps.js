const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { resolveMembershipState } = require('../middleware/auth');
const { toNumber } = require('../utils/validation');

const router = express.Router();

async function ensurePremiumRoadmapAccess(req, res) {
  const membership = await resolveMembershipState(req.session.userId);
  if (membership?.isAdmin || membership?.premiumActive) return true;
  res.status(403).json({
    error: 'Roadmap modules are premium. Upgrade to Premium (Rs.49/month).',
    code: 'UPGRADE_REQUIRED',
    membershipStatus: membership?.status || 'free'
  });
  return false;
}

router.get('/me', requireAuth, async (req, res) => {
  if (!(await ensurePremiumRoadmapAccess(req, res))) return;
  const { rows } = await pool.query(
    'SELECT id, roadmap_data, progress, goals, updated_at FROM roadmaps WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [req.session.userId]
  );
  res.json({ roadmap: rows[0] || null });
});

router.post('/me', requireAuth, async (req, res) => {
  if (!(await ensurePremiumRoadmapAccess(req, res))) return;
  const { roadmapData, goals, progress } = req.body;
  const numericProgress = toNumber(progress, 0);
  const { rows } = await pool.query(
    `INSERT INTO roadmaps (user_id, roadmap_data, goals, progress)
     VALUES ($1, $2::jsonb, $3::jsonb, $4)
     RETURNING id, roadmap_data, goals, progress, updated_at`,
    [req.session.userId, JSON.stringify(roadmapData || []), JSON.stringify(goals || {}), numericProgress]
  );
  res.status(201).json({ roadmap: rows[0] });
});

router.put('/me/:id', requireAuth, async (req, res) => {
  if (!(await ensurePremiumRoadmapAccess(req, res))) return;
  const id = toNumber(req.params.id, -1);
  const { roadmapData, goals, progress } = req.body;
  const numericProgress = toNumber(progress, 0);

  const { rows } = await pool.query(
    `UPDATE roadmaps SET roadmap_data = $1::jsonb, goals = $2::jsonb, progress = $3, updated_at = NOW()
     WHERE id = $4 AND user_id = $5
     RETURNING id, roadmap_data, goals, progress, updated_at`,
    [JSON.stringify(roadmapData || []), JSON.stringify(goals || {}), numericProgress, id, req.session.userId]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Roadmap not found' });
  res.json({ roadmap: rows[0] });
});

module.exports = router;
