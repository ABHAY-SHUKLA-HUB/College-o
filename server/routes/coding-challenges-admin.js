/**
 * Admin Coding Challenges API Router (Part 2 Complete REST endpoints)
 * Handles admin contest CRUD, problem manager, test case manager, and contest results.
 * All routes strictly enforce requireAdmin authorization.
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const {
  SUPPORTED_LANGUAGES,
  getCodingModuleSettings,
  updateCodingModuleSettings,
  getContestStats,
  getAdminContests,
  getContestById,
  createContest,
  updateContest,
  duplicateContest,
  deleteContest,
  updateContestStatus,
  getContestProblems,
  createProblem,
  updateProblem,
  deleteProblem,
  reorderProblems,
  getProblemTestCases,
  createTestCase,
  updateTestCase,
  deleteTestCase,
  bulkImportTestCases,
  getContestResults
} = require('../services/codingChallengesService');

// All admin coding APIs require a valid server-side admin session
router.use(requireAdmin);

/**
 * GET /api/admin/coding-challenges/languages
 * Returns supported programming languages configuration.
 */
router.get('/languages', (_req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

/**
 * GET /api/admin/coding-challenges/settings
 * Fetch current module settings for Admin Portal.
 */
router.get('/settings', async (_req, res) => {
  try {
    const settings = await getCodingModuleSettings();
    res.json({ settings });
  } catch (error) {
    console.error('[Admin Coding API] Error reading settings:', error.message || error);
    res.status(500).json({ error: 'Failed to read coding module settings' });
  }
});

/**
 * PUT /api/admin/coding-challenges/settings
 * Update global module settings.
 */
router.put('/settings', async (req, res) => {
  try {
    const { module_enabled, leaderboard_enabled, certificates_enabled, strict_mode_default } = req.body || {};
    const updated = await updateCodingModuleSettings(
      { module_enabled, leaderboard_enabled, certificates_enabled, strict_mode_default },
      req.session.userId
    );
    res.json({ message: 'Coding Challenges settings updated successfully', settings: updated });
  } catch (error) {
    console.error('[Admin Coding API] Error updating settings:', error.message || error);
    res.status(500).json({ error: 'Failed to update coding module settings' });
  }
});

/**
 * GET /api/admin/coding-challenges/stats
 * Overview dashboard metrics.
 */
router.get('/stats', async (_req, res) => {
  try {
    const stats = await getContestStats();
    res.json({ stats });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching stats:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch contest statistics' });
  }
});

/**
 * GET /api/admin/coding-challenges/contests
 * Fetch all contests for admin management.
 */
router.get('/contests', async (_req, res) => {
  try {
    const contests = await getAdminContests();
    res.json({ contests });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching contests:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch admin contests' });
  }
});

/**
 * POST /api/admin/coding-challenges/contests
 * Create a new contest.
 */
router.post('/contests', async (req, res) => {
  try {
    const contest = await createContest(req.body || {}, req.session.userId);
    res.status(201).json({ message: 'Contest created successfully', contest });
  } catch (error) {
    console.error('[Admin Coding API] Error creating contest:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to create contest' });
  }
});

/**
 * GET /api/admin/coding-challenges/contests/:id
 * Get contest details.
 */
router.get('/contests/:id', async (req, res) => {
  try {
    const contest = await getContestById(req.params.id);
    if (!contest) return res.status(404).json({ error: 'Contest not found' });
    res.json({ contest });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching contest:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch contest details' });
  }
});

/**
 * PUT /api/admin/coding-challenges/contests/:id
 * Update contest.
 */
router.put('/contests/:id', async (req, res) => {
  try {
    const contest = await updateContest(req.params.id, req.body || {}, req.session.userId);
    res.json({ message: 'Contest updated successfully', contest });
  } catch (error) {
    console.error('[Admin Coding API] Error updating contest:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to update contest' });
  }
});

/**
 * POST /api/admin/coding-challenges/contests/:id/duplicate
 * Duplicate contest with all its problems and test cases.
 */
router.post('/contests/:id/duplicate', async (req, res) => {
  try {
    const duplicated = await duplicateContest(req.params.id, req.session.userId);
    res.status(201).json({ message: 'Contest duplicated successfully', contest: duplicated });
  } catch (error) {
    console.error('[Admin Coding API] Error duplicating contest:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to duplicate contest' });
  }
});

/**
 * DELETE /api/admin/coding-challenges/contests/:id
 * Delete draft contest safely.
 */
router.delete('/contests/:id', async (req, res) => {
  try {
    const result = await deleteContest(req.params.id);
    res.json({ message: 'Contest deleted successfully', result });
  } catch (error) {
    console.error('[Admin Coding API] Error deleting contest:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to delete contest' });
  }
});

/**
 * PATCH /api/admin/coding-challenges/contests/:id/status
 * Publish, cancel, or reopen contest.
 */
router.patch('/contests/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    const updated = await updateContestStatus(req.params.id, status, req.session.userId);
    res.json({ message: `Contest status changed to ${status}`, contest: updated });
  } catch (error) {
    console.error('[Admin Coding API] Error updating contest status:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to update contest status' });
  }
});

/**
 * GET /api/admin/coding-challenges/contests/:id/results
 * Fetch contest results overview for admin.
 */
router.get('/contests/:id/results', async (req, res) => {
  try {
    const results = await getContestResults(req.params.id);
    res.json({ results });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching contest results:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch contest results' });
  }
});

/**
 * GET /api/admin/coding-challenges/contests/:id/problems
 * Get problems for a contest.
 */
router.get('/contests/:id/problems', async (req, res) => {
  try {
    const problems = await getContestProblems(req.params.id);
    res.json({ problems });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching problems:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch contest problems' });
  }
});

/**
 * POST /api/admin/coding-challenges/contests/:id/problems
 * Create problem in a contest.
 */
router.post('/contests/:id/problems', async (req, res) => {
  try {
    const problem = await createProblem({ ...(req.body || {}), contest_id: req.params.id });
    res.status(201).json({ message: 'Problem created successfully', problem });
  } catch (error) {
    console.error('[Admin Coding API] Error creating problem:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to create problem' });
  }
});

/**
 * PUT /api/admin/coding-challenges/problems/:id
 * Update problem.
 */
router.put('/problems/:id', async (req, res) => {
  try {
    const problem = await updateProblem(req.params.id, req.body || {});
    res.json({ message: 'Problem updated successfully', problem });
  } catch (error) {
    console.error('[Admin Coding API] Error updating problem:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to update problem' });
  }
});

/**
 * DELETE /api/admin/coding-challenges/problems/:id
 * Delete problem.
 */
router.delete('/problems/:id', async (req, res) => {
  try {
    const result = await deleteProblem(req.params.id);
    res.json({ message: 'Problem deleted successfully', result });
  } catch (error) {
    console.error('[Admin Coding API] Error deleting problem:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to delete problem' });
  }
});

/**
 * PUT /api/admin/coding-challenges/contests/:id/problems/reorder
 * Reorder problems in a contest.
 */
router.put('/contests/:id/problems/reorder', async (req, res) => {
  try {
    const { problemOrders } = req.body || {};
    const result = await reorderProblems(req.params.id, problemOrders);
    res.json({ message: 'Problems reordered successfully', result });
  } catch (error) {
    console.error('[Admin Coding API] Error reordering problems:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to reorder problems' });
  }
});

/**
 * GET /api/admin/coding-challenges/problems/:id/test-cases
 * Get test cases for a problem (ADMIN ONLY - includes hidden test cases).
 */
router.get('/problems/:id/test-cases', async (req, res) => {
  try {
    const testCases = await getProblemTestCases(req.params.id);
    res.json({ testCases });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching test cases:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch test cases' });
  }
});

/**
 * POST /api/admin/coding-challenges/problems/:id/test-cases/bulk
 * Bulk import test cases for a problem.
 */
router.post('/problems/:id/test-cases/bulk', async (req, res) => {
  try {
    const result = await bulkImportTestCases(req.params.id, req.body);
    res.status(201).json({ message: 'Test cases bulk imported successfully', result, imported_count: result?.count || 0 });
  } catch (error) {
    console.error('[Admin Coding API] Error bulk importing test cases:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to bulk import test cases', debug_received_body: req.body });
  }
});

/**
 * POST /api/admin/coding-challenges/problems/:id/test-cases
 * Create a single test case.
 */
router.post('/problems/:id/test-cases', async (req, res) => {
  try {
    const testCase = await createTestCase({ ...(req.body || {}), problem_id: req.params.id });
    res.status(201).json({ message: 'Test case created successfully', testCase });
  } catch (error) {
    console.error('[Admin Coding API] Error creating test case:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to create test case' });
  }
});

/**
 * PUT /api/admin/coding-challenges/test-cases/:id
 * Update a test case.
 */
router.put('/test-cases/:id', async (req, res) => {
  try {
    const testCase = await updateTestCase(req.params.id, req.body || {});
    res.json({ message: 'Test case updated successfully', testCase });
  } catch (error) {
    console.error('[Admin Coding API] Error updating test case:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to update test case' });
  }
});


/**
 * DELETE /api/admin/coding-challenges/test-cases/:id
 * Delete a test case.
 */
router.delete('/test-cases/:id', async (req, res) => {
  try {
    const result = await deleteTestCase(req.params.id);
    res.json({ message: 'Test case deleted successfully', result });
  } catch (error) {
    console.error('[Admin Coding API] Error deleting test case:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to delete test case' });
  }
});

const { disqualifyParticipant } = require('../services/codingChallengesService');
const { analyzeContestSimilarity, getContestSimilarityResults, updateSimilarityStatus } = require('../services/codeSimilarityService');
const { getStudentIntegritySummary, getContestIntegrityOverview } = require('../services/integrityAssessmentService');
const {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  finalizeContest,
  approveCertificate,
  revokeCertificate,
  generateCertificatePDF
} = require('../services/certificateService');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');

const brandingUploadMiddleware = createUploadMiddleware({ maxFileSizeMB: 2 });

/**
 * GET /api/admin/coding-challenges/contests/:id/similarity
 * Fetch source code similarity analysis results for a contest.
 */
router.get('/contests/:id/similarity', async (req, res) => {
  try {
    const similarityResults = await getContestSimilarityResults(req.params.id);
    res.json({ similarityResults });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching similarity results:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch code similarity results' });
  }
});

/**
 * POST /api/admin/coding-challenges/contests/:id/similarity/analyze
 * Trigger AST/Token Winnowing plagiarism similarity analysis for a contest.
 */
router.post('/contests/:id/similarity/analyze', async (req, res) => {
  try {
    const result = await analyzeContestSimilarity(req.params.id);
    res.json({ message: 'Code similarity analysis completed successfully', ...result });
  } catch (error) {
    console.error('[Admin Coding API] Error analyzing code similarity:', error.message || error);
    res.status(500).json({ error: error.message || 'Similarity analysis failed' });
  }
});

/**
 * PATCH /api/admin/coding-challenges/similarity/:id/status
 * Update review status of a similarity flag ('reviewed', 'cleared').
 */
router.patch('/similarity/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    const updated = await updateSimilarityStatus(req.params.id, status);
    res.json({ message: 'Similarity status updated', result: updated });
  } catch (error) {
    console.error('[Admin Coding API] Error updating similarity status:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to update similarity status' });
  }
});

/**
 * GET /api/admin/coding-challenges/contests/:id/students/:studentId/integrity
 * Fetch detailed integrity event log timeline & suspicion report for a student.
 */
router.get('/contests/:id/students/:studentId/integrity', async (req, res) => {
  try {
    const summary = await getStudentIntegritySummary(req.params.id, Number(req.params.studentId));
    res.json({ integrity: summary });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching student integrity report:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch student integrity report' });
  }
});

/**
 * POST /api/admin/coding-challenges/contests/:id/participants/:studentId/disqualify
 * Disqualify participant manually with reason and audit trail.
 */
router.post('/contests/:id/participants/:studentId/disqualify', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const adminId = req.session.userId;
    const result = await disqualifyParticipant(req.params.id, Number(req.params.studentId), adminId, reason);
    res.json({ message: 'Participant disqualified successfully', result });
  } catch (error) {
    console.error('[Admin Coding API] Error disqualifying participant:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to disqualify participant' });
  }
});

// =================================================================
// PART 5: CERTIFICATE TEMPLATE & MANAGEMENT ENDPOINTS
// =================================================================

/**
 * GET /api/admin/coding-challenges/templates
 * List certificate templates with active version info.
 */
router.get('/templates', async (req, res) => {
  try {
    const templates = await getTemplates({ status: req.query.status });
    res.json({ templates });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching templates:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch certificate templates' });
  }
});

/**
 * GET /api/admin/coding-challenges/templates/:id
 * Fetch detailed certificate template with versions.
 */
router.get('/templates/:id', async (req, res) => {
  try {
    const template = await getTemplateById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching template:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch template details' });
  }
});

/**
 * POST /api/admin/coding-challenges/templates
 * Create new certificate template.
 */
router.post('/templates', async (req, res) => {
  try {
    const { name, description, configuration } = req.body || {};
    const adminId = req.session.userId;
    const template = await createTemplate({ name, description, configuration, adminId });
    res.status(201).json({ message: 'Certificate template created', template });
  } catch (error) {
    console.error('[Admin Coding API] Error creating template:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to create template' });
  }
});

/**
 * PUT /api/admin/coding-challenges/templates/:id
 * Update existing template (optionally creating a new version).
 */
router.put('/templates/:id', async (req, res) => {
  try {
    const { name, description, configuration, createNewVersion } = req.body || {};
    const adminId = req.session.userId;
    const result = await updateTemplate({
      templateId: req.params.id,
      name,
      description,
      configuration,
      createNewVersion: Boolean(createNewVersion),
      adminId
    });
    res.json({ message: 'Template updated successfully', result });
  } catch (error) {
    console.error('[Admin Coding API] Error updating template:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to update template' });
  }
});

/**
 * POST /api/admin/coding-challenges/templates/:id/duplicate
 * Duplicate certificate template.
 */
router.post('/templates/:id/duplicate', async (req, res) => {
  try {
    const adminId = req.session.userId;
    const template = await duplicateTemplate(req.params.id, adminId);
    res.json({ message: 'Template duplicated successfully', template });
  } catch (error) {
    console.error('[Admin Coding API] Error duplicating template:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to duplicate template' });
  }
});

/**
 * POST /api/admin/coding-challenges/templates/preview
 * Generate sample/test certificate PDF preview.
 */
router.post('/templates/preview', async (req, res) => {
  try {
    const sampleCert = {
      student_name: req.body.sample_student_name || 'Alex Morgan',
      rank: req.body.sample_rank || 1,
      position_text: req.body.sample_position_text || '1st Position',
      contest_name: req.body.sample_contest_name || 'Weekly Coding Challenge #1',
      contest_date: new Date().toLocaleDateString(),
      issue_date: new Date().toLocaleDateString(),
      certificate_number: 'CO-CODE-SAMPLE-0001',
      verification_token: 'SAMPLE_VERIFICATION_TOKEN',
      configuration: req.body.configuration,
      is_sample: true
    };
    const pdfBuffer = await generateCertificatePDF(sampleCert);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="sample-certificate.pdf"');
    res.send(pdfBuffer);
  } catch (error) {
    console.error('[Admin Coding API] Error generating certificate preview:', error.message || error);
    res.status(500).json({ error: 'Failed to generate certificate preview PDF' });
  }
});

/**
 * POST /api/admin/coding-challenges/branding/upload
 * Upload logo, signature, or background image for certificate templates.
 */
router.post('/branding/upload', brandingUploadMiddleware.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });
    const uploaded = await saveUploadedFile(req.file, {
      folder: 'coding-branding',
      prefix: 'logo',
      uploadedBy: req.session.userId,
      userId: req.session.userId,
      entityType: 'certificate_branding'
    });
    res.json({ message: 'Branding asset uploaded successfully', fileUrl: uploaded.url, asset: uploaded });
  } catch (error) {
    console.error('[Admin Coding API] Error uploading branding file:', error.message || error);
    res.status(400).json({ error: error.message || 'File upload failed' });
  }
});

/**
 * POST /api/admin/coding-challenges/contests/:id/finalize
 * Finalize contest result, freeze rankings, award season points, and generate Top 3 certificates.
 */
router.post('/contests/:id/finalize', async (req, res) => {
  try {
    const adminId = req.session.userId;
    const result = await finalizeContest(req.params.id, adminId);
    res.json({ message: 'Contest finalized successfully', result });
  } catch (error) {
    console.error('[Admin Coding API] Error finalizing contest:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to finalize contest' });
  }
});

/**
 * GET /api/admin/coding-challenges/contests/:id/certificates
 * Get certificates generated for a contest.
 */
router.get('/contests/:id/certificates', async (req, res) => {
  try {
    const { pool } = require('../db/pool');
    const { rows } = await pool.query(
      `SELECT c.*, u.full_name as student_name, u.email as student_email
       FROM coding_certificates c
       JOIN users u ON u.id = c.student_id
       WHERE c.contest_id = $1
       ORDER BY c.rank ASC`,
      [req.params.id]
    );
    res.json({ certificates: rows });
  } catch (error) {
    console.error('[Admin Coding API] Error fetching contest certificates:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch contest certificates' });
  }
});

/**
 * POST /api/admin/coding-challenges/certificates/:id/approve
 * Approve certificate for issuance.
 */
router.post('/certificates/:id/approve', async (req, res) => {
  try {
    const adminId = req.session.userId;
    const certificate = await approveCertificate(req.params.id, adminId);
    res.json({ message: 'Certificate approved successfully', certificate });
  } catch (error) {
    console.error('[Admin Coding API] Error approving certificate:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to approve certificate' });
  }
});

/**
 * POST /api/admin/coding-challenges/certificates/:id/revoke
 * Revoke issued certificate.
 */
router.post('/certificates/:id/revoke', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const adminId = req.session.userId;
    const certificate = await revokeCertificate(req.params.id, adminId, reason);
    res.json({ message: 'Certificate revoked successfully', certificate });
  } catch (error) {
    console.error('[Admin Coding API] Error revoking certificate:', error.message || error);
    res.status(400).json({ error: error.message || 'Failed to revoke certificate' });
  }
});

/**
 * GET /api/admin/coding-challenges/certificates/:id/pdf
 * Download certificate PDF for admin preview/verification.
 */
router.get('/certificates/:id/pdf', async (req, res) => {
  try {
    const { pool } = require('../db/pool');
    const { rows } = await pool.query(
      `SELECT c.*, u.full_name as student_name, ct.title as contest_name, ct.start_time as contest_date
       FROM coding_certificates c
       JOIN users u ON u.id = c.student_id
       JOIN coding_contests ct ON ct.id = c.contest_id
       WHERE c.id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Certificate not found' });
    const cert = rows[0];

    const pdfBuffer = await generateCertificatePDF(cert);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificate-${cert.certificate_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('[Admin Coding API] Error generating certificate PDF:', error.message || error);
    res.status(500).json({ error: 'Failed to generate certificate PDF' });
  }
});

module.exports = router;

