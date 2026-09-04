/**
 * Student Coding Challenges API Router
 * Handles student-facing endpoints with strict authentication, session binding, and module status validation.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const {
  getCodingModuleSettings,
  getStudentContests,
  getStudentContestById,
  registerStudentForContest,
  getStudentProblemById,
  runStudentCode,
  submitStudentSolution,
  calculateContestLeaderboard,
  getSeasonLeaderboard,
  getStudentSubmissions,
  recordIntegrityEvent
} = require('../services/codingChallengesService');

// All student coding APIs require a valid server-side session
router.use(requireAuth);

/**
 * Middleware: Verify coding challenges module is enabled for student access.
 */
async function requireCodingModuleEnabled(req, res, next) {
  const role = req.session.role || '';
  if (role === 'admin' || role === 'super_admin') {
    return next();
  }

  const settings = await getCodingModuleSettings();
  if (!settings.module_enabled) {
    return res.status(403).json({
      error: 'Coding Challenges module is currently disabled by administrator',
      disabled: true
    });
  }
  next();
}

/**
 * GET /api/coding-challenges/settings
 * Public/student read endpoint for module configuration status.
 */
router.get('/settings', async (_req, res) => {
  const settings = await getCodingModuleSettings();
  res.json({
    enabled: settings.module_enabled,
    leaderboard_enabled: settings.leaderboard_enabled,
    certificates_enabled: settings.certificates_enabled,
    strict_mode_default: settings.strict_mode_default
  });
});

/**
 * GET /api/coding-challenges/contests
 * Fetch active/visible contests for students.
 */
router.get('/contests', requireCodingModuleEnabled, async (req, res) => {
  try {
    const contests = await getStudentContests(req.session.userId);
    res.json({ contests });
  } catch (error) {
    console.error('[Coding API] Error fetching contests:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch coding contests' });
  }
});

/**
 * GET /api/coding-challenges/contests/:id
 * Fetch detailed contest view with rules, schedule, registration state, and problem list (if started).
 */
router.get('/contests/:id', requireCodingModuleEnabled, async (req, res) => {
  try {
    const contest = await getStudentContestById(req.params.id, req.session.userId);
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found or unavailable' });
    }
    res.json({ contest });
  } catch (error) {
    console.error('[Coding API] Error fetching contest detail:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch contest detail' });
  }
});

/**
 * POST /api/coding-challenges/contests/:id/register
 * Register student for contest.
 */
router.get('/my-submissions', requireCodingModuleEnabled, async (req, res) => {
  try {
    const submissions = await getStudentSubmissions(req.session.userId);
    res.json({ submissions });
  } catch (error) {
    console.error('[Coding API] Error fetching my submissions:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch submission history' });
  }
});

/**
 * GET /api/coding-challenges/leaderboard/overall
 * Fetch Overall / Season Leaderboard.
 */
router.get('/leaderboard/overall', requireCodingModuleEnabled, async (_req, res) => {
  try {
    const result = await getSeasonLeaderboard();
    if (result.hidden) {
      return res.status(403).json(result);
    }
    res.json(result);
  } catch (error) {
    console.error('[Coding API] Error fetching season leaderboard:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch overall leaderboard' });
  }
});

/**
 * POST /api/coding-challenges/contests/:id/register
 * Register authenticated student for contest.
 */
router.post('/contests/:id/register', requireCodingModuleEnabled, async (req, res) => {
  try {
    const participant = await registerStudentForContest(req.params.id, req.session.userId);
    res.json({ ok: true, participant });
  } catch (error) {
    console.error('[Coding API] Error registering for contest:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to register for contest' });
  }
});

/**
 * GET /api/coding-challenges/problems/:id
 * Fetch student problem details (sample test cases only, shielding hidden test cases).
 */
router.get('/problems/:id', requireCodingModuleEnabled, async (req, res) => {
  try {
    const problem = await getStudentProblemById(req.params.id, req.session.userId);
    if (!problem) {
      return res.status(404).json({ error: 'Problem not found or contest unavailable' });
    }
    res.json({ problem });
  } catch (error) {
    console.error('[Coding API] Error fetching problem detail:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to fetch problem detail' });
  }
});

const { runCodeLimiter, submitLimiter, integrityLimiter } = require('../middleware/codingRateLimiter');

/**
 * POST /api/coding-challenges/problems/:id/run
 * Execute temporary code runner against sample test cases or custom input (Does NOT save submission).
 */
router.post('/problems/:id/run', requireCodingModuleEnabled, runCodeLimiter, async (req, res) => {
  try {
    const { language, code, customInput } = req.body;
    if (!language || !code) {
      return res.status(400).json({ error: 'Language and source code are required' });
    }

    const runResult = await runStudentCode(req.params.id, { language, code, customInput });
    res.json({ ok: true, run: runResult });
  } catch (error) {
    console.error('[Coding API] Error running code:', error.message || error);
    res.status(400).json({ error: error.message || 'Code execution failed' });
  }
});

/**
 * POST /api/coding-challenges/problems/:id/submit
 * Submit solution for full evaluation against test cases (Binds student_id from session).
 */
router.post('/problems/:id/submit', requireCodingModuleEnabled, submitLimiter, async (req, res) => {
  try {
    const { language, code } = req.body;
    if (!language || !code) {
      return res.status(400).json({ error: 'Language and source code are required' });
    }

    // Force student_id from server-side session to prevent identity spoofing
    const studentId = req.session.userId;
    const submission = await submitStudentSolution(req.params.id, { language, code }, studentId);

    res.json({ ok: true, submission });
  } catch (error) {
    console.error('[Coding API] Error submitting solution:', error.message || error);
    res.status(400).json({ error: error.message || 'Submission failed' });
  }
});

/**
 * GET /api/coding-challenges/contests/:id/leaderboard
 * Fetch Contest Leaderboard (Subject to global & per-contest leaderboard_visible settings).
 */
router.get('/contests/:id/leaderboard', requireCodingModuleEnabled, async (req, res) => {
  try {
    const leaderboard = await calculateContestLeaderboard(req.params.id, req.session.userId);
    if (leaderboard.hidden) {
      return res.status(403).json(leaderboard);
    }
    res.json(leaderboard);
  } catch (error) {
    console.error('[Coding API] Error fetching contest leaderboard:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch contest leaderboard' });
  }
});

/**
 * GET /api/coding-challenges/season-leaderboard
 * Fetch Overall Season Coding Leaderboard.
 */
router.get('/season-leaderboard', requireCodingModuleEnabled, async (req, res) => {
  try {
    const { getOverallSeasonLeaderboard } = require('../services/certificateService');
    const leaderboard = await getOverallSeasonLeaderboard();
    res.json({ leaderboard });
  } catch (error) {
    console.error('[Coding API] Error fetching overall season leaderboard:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch season leaderboard' });
  }
});

/**
 * POST /api/coding-challenges/contests/:id/integrity-event
 * Record anti-cheat proctoring event for active strict-mode contests.
 */
router.post('/contests/:id/integrity-event', requireCodingModuleEnabled, integrityLimiter, async (req, res) => {
  try {
    const { problem_id, event_type, metadata } = req.body;
    const result = await recordIntegrityEvent({
      contestId: req.params.id,
      problemId: problem_id,
      studentId: req.session.userId,
      eventType: event_type,
      eventData: metadata
    });
    res.json(result);
  } catch (error) {
    console.error('[Coding API] Error recording integrity event:', error.message || error);
    res.status(400).json({ error: 'Failed to log integrity event' });
  }
});

// =================================================================
// PART 5: STUDENT CERTIFICATES ENDPOINTS
// =================================================================

/**
 * GET /api/coding-challenges/my-certificates
 * Fetch authenticated student's coding certificates.
 */
router.get('/my-certificates', requireCodingModuleEnabled, async (req, res) => {
  try {
    const { pool } = require('../db/pool');
    const { rows } = await pool.query(
      `SELECT c.id, c.contest_id, c.rank, c.position_text, c.certificate_number, c.verification_token, c.status, c.issued_at, c.created_at,
              ct.title as contest_name, ct.start_time as contest_date
       FROM coding_certificates c
       JOIN coding_contests ct ON ct.id = c.contest_id
       WHERE c.student_id = $1
       ORDER BY c.created_at DESC`,
      [req.session.userId]
    );
    res.json({ certificates: rows });
  } catch (error) {
    console.error('[Coding API] Error fetching my certificates:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch your certificates' });
  }
});

/**
 * GET /api/coding-challenges/my-certificates/:id/pdf
 * Download PDF for student's approved certificate.
 */
router.get('/my-certificates/:id/pdf', requireCodingModuleEnabled, async (req, res) => {
  try {
    const { pool } = require('../db/pool');
    const { generateCertificatePDF } = require('../services/certificateService');

    const { rows } = await pool.query(
      `SELECT c.*, u.full_name as student_name, ct.title as contest_name, ct.start_time as contest_date
       FROM coding_certificates c
       JOIN users u ON u.id = c.student_id
       JOIN coding_contests ct ON ct.id = c.contest_id
       WHERE c.id = $1 AND c.student_id = $2`,
      [req.params.id, req.session.userId]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Certificate not found or access denied' });
    const cert = rows[0];

    if (cert.status !== 'approved') {
      return res.status(403).json({ error: 'Certificate is pending admin approval or revoked' });
    }

    const pdfBuffer = await generateCertificatePDF(cert);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.certificate_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('[Coding API] Error generating student certificate PDF:', error.message || error);
    res.status(500).json({ error: 'Failed to download certificate PDF' });
  }
});

module.exports = router;



