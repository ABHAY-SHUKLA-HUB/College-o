/**
 * server/routes/roadmaps.js
 * Student Study Roadmaps Router with Backend Progress Tracking & Feature Control
 */

const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, resolveMembershipState } = require('../middleware/auth');
const { requireFeatureEnabled } = require('../middleware/featureToggle');
const { toNumber } = require('../utils/validation');

const router = express.Router();
router.use(requireAuth);

async function ensureUserNotSuspended(userId) {
  const res = await pool.query('SELECT is_suspended FROM users WHERE id = $1', [userId]);
  if (res.rows[0]?.is_suspended) {
    throw { statusCode: 403, error: 'ACCOUNT_SUSPENDED', message: 'Account is suspended.' };
  }
}

// GET AVAILABLE STUDY ROADMAPS
router.get('/', requireFeatureEnabled('roadmaps'), async (req, res) => {
  try {
    await ensureUserNotSuspended(req.session.userId);

    const [profileResult, membership] = await Promise.all([
      pool.query(
        `SELECT category_id, branch_id, semester_id, course_branch FROM user_profiles WHERE user_id = $1`,
        [req.session.userId]
      ),
      resolveMembershipState(req.session.userId)
    ]);

    const { resolveStudentAcademicScope, applyAcademicScopeToQuery } = require('../utils/academic-scope');
    const studentScope = await resolveStudentAcademicScope(req.session.userId);
    const userRole = String(req.session?.role || '').toLowerCase();
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';

    if (!isAdmin) {
      if (!studentScope || !studentScope.profileComplete) {
        return res.status(403).json({
          error: 'ACADEMIC_PROFILE_REQUIRED',
          code: 'ACADEMIC_PROFILE_REQUIRED',
          message: 'Mandatory academic onboarding setup is required before accessing roadmaps.'
        });
      }

      const scopeFilter = applyAcademicScopeToQuery(studentScope, { alias: 'r', startIndex: params.length + 1, legacySupport: true });
      clauses.push(scopeFilter.sqlClause);
      params.push(...scopeFilter.params);
    }

    if (!premiumActive) {
      clauses.push(`COALESCE(r.access_type, 'free') <> 'premium'`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const roadmapsResult = await pool.query(
      `SELECT
        r.id,
        r.title,
        r.description,
        r.category_id,
        r.branch_id,
        r.semester_id,
        r.subject_id,
        r.access_type,
        r.status,
        r.created_at,
        r.published_at,
        ab.name as branch_name,
        asr.label as semester_label,
        sub.name as subject_name,
        COALESCE(step_count.total_steps, 0)::int as total_steps,
        COALESCE(prog.completed_steps, 0)::int as completed_steps
       FROM roadmaps r
       LEFT JOIN academic_branches ab ON ab.id = r.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = r.semester_id
       LEFT JOIN academic_subjects sub ON sub.id = r.subject_id
       LEFT JOIN (
         SELECT roadmap_id, COUNT(*)::int as total_steps
         FROM roadmap_steps
         GROUP BY roadmap_id
       ) step_count ON step_count.roadmap_id = r.id
       LEFT JOIN (
         SELECT roadmap_id, COUNT(*)::int as completed_steps
         FROM student_roadmap_progress
         WHERE student_id = $1 AND status = 'completed'
         GROUP BY roadmap_id
       ) prog ON prog.roadmap_id = r.id
       ${where}
       ORDER BY r.published_at DESC NULLS LAST, r.id DESC`,
      params
    );

    res.json({
      roadmaps: roadmapsResult.rows.map((r) => {
        const total = Number(r.total_steps || 0);
        const completed = Number(r.completed_steps || 0);
        const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
        return {
          ...r,
          progressPercent
        };
      })
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message });
  }
});

// GET ROADMAP DETAIL WITH STEPS & PROGRESS
router.get('/:id', requireFeatureEnabled('roadmaps'), async (req, res) => {
  try {
    await ensureUserNotSuspended(req.session.userId);
    const roadmapId = toNumber(req.params.id, -1);
    if (roadmapId < 1) return res.status(400).json({ error: 'Invalid roadmap id' });

    const membership = await resolveMembershipState(req.session.userId);
    const premiumActive = Boolean(membership?.premiumActive || membership?.isAdmin);

    const roadmapRes = await pool.query(
      `SELECT r.*, ab.name as branch_name, asr.label as semester_label, sub.name as subject_name
       FROM roadmaps r
       LEFT JOIN academic_branches ab ON ab.id = r.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = r.semester_id
       LEFT JOIN academic_subjects sub ON sub.id = r.subject_id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [roadmapId]
    );

    const roadmap = roadmapRes.rows[0];
    if (!roadmap) return res.status(404).json({ error: 'Roadmap not found' });

    const status = String(roadmap.status || 'published').toLowerCase();
    if (status !== 'published' && !membership?.isAdmin) {
      return res.status(403).json({ error: 'This roadmap is not published.' });
    }

    if (String(roadmap.access_type || 'free').toLowerCase() === 'premium' && !premiumActive) {
      return res.status(403).json({ error: 'Premium membership required for this roadmap.', code: 'UPGRADE_REQUIRED' });
    }

    const [stepsRes, progressRes] = await Promise.all([
      pool.query(
        `SELECT id, roadmap_id, title, description, step_order, resource_type, resource_id, resource_url, is_required
         FROM roadmap_steps
         WHERE roadmap_id = $1
         ORDER BY step_order ASC, id ASC`,
        [roadmapId]
      ),
      pool.query(
        `SELECT step_id, status, completed_at
         FROM student_roadmap_progress
         WHERE student_id = $1 AND roadmap_id = $2`,
        [req.session.userId, roadmapId]
      )
    ]);

    const progressMap = new Map(
      progressRes.rows.map((p) => [Number(p.step_id), p])
    );

    const steps = stepsRes.rows.map((s) => {
      const prog = progressMap.get(Number(s.id));
      return {
        id: s.id,
        title: s.title,
        description: s.description,
        stepOrder: s.step_order,
        resourceType: s.resource_type,
        resourceId: s.resource_id,
        resourceUrl: s.resource_url,
        isRequired: s.is_required,
        isCompleted: Boolean(prog && prog.status === 'completed'),
        completedAt: prog?.completed_at || null,
        isAvailable: true // Gracefully handled client-side if linked resource deleted
      };
    });

    const completedCount = steps.filter((s) => s.isCompleted).length;
    const progressPercent = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

    res.json({
      roadmap: {
        id: roadmap.id,
        title: roadmap.title,
        description: roadmap.description,
        accessType: roadmap.access_type,
        branchName: roadmap.branch_name,
        semesterLabel: roadmap.semester_label,
        subjectName: roadmap.subject_name,
        status: roadmap.status,
        progressPercent,
        completedCount,
        totalSteps: steps.length
      },
      steps
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message });
  }
});

// MARK STEP COMPLETE IN BACKEND DB
router.post('/:id/steps/:stepId/complete', requireFeatureEnabled('roadmaps'), async (req, res) => {
  try {
    await ensureUserNotSuspended(req.session.userId);
    const roadmapId = toNumber(req.params.id, -1);
    const stepId = toNumber(req.params.stepId, -1);
    if (roadmapId < 1 || stepId < 1) {
      return res.status(400).json({ error: 'Invalid roadmap or step id' });
    }

    const stepRes = await pool.query(
      `SELECT id FROM roadmap_steps WHERE id = $1 AND roadmap_id = $2`,
      [stepId, roadmapId]
    );
    if (!stepRes.rows[0]) {
      return res.status(404).json({ error: 'Roadmap step not found' });
    }

    const { rows } = await pool.query(
      `INSERT INTO student_roadmap_progress (student_id, roadmap_id, step_id, status, completed_at)
       VALUES ($1, $2, $3, 'completed', NOW())
       ON CONFLICT (student_id, roadmap_id, step_id)
       DO UPDATE SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       RETURNING *`,
      [req.session.userId, roadmapId, stepId]
    );

    res.json({
      message: 'Roadmap step marked complete',
      progress: rows[0]
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.error || error.message });
  }
});

// BACKWARD COMPATIBLE ME ENDPOINTS
router.get('/me', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, roadmap_data, progress, goals, updated_at FROM roadmaps WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1',
      [req.session.userId]
    );
    res.json({ roadmap: rows[0] || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/me', async (req, res) => {
  try {
    const { roadmapData, goals, progress } = req.body;
    const numericProgress = toNumber(progress, 0);
    const { rows } = await pool.query(
      `INSERT INTO roadmaps (user_id, roadmap_data, goals, progress, status, is_published)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, 'published', true)
       RETURNING id, roadmap_data, goals, progress, updated_at`,
      [req.session.userId, JSON.stringify(roadmapData || []), JSON.stringify(goals || {}), numericProgress]
    );
    res.status(201).json({ roadmap: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/me/:id', async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
