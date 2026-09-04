const PORT = 5099;
process.env.PORT = String(PORT);
require('dotenv').config();
const http = require('http');
const { pool } = require('../server/db/pool');
const {
  ensureDefaultTemplate,
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  finalizeContest,
  approveCertificate,
  revokeCertificate,
  getPublicVerification,
  getOverallSeasonLeaderboard,
  generateCertificatePDF
} = require('../server/services/certificateService');

const {
  createContest,
  createProblem,
  submitStudentSolution,
  calculateContestLeaderboard
} = require('../server/services/codingChallengesService');

const BASE_URL = `http://127.0.0.1:${PORT}`;

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const reqOpts = {
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (options.cookie) {
      reqOpts.headers['Cookie'] = options.cookie;
    }

    const req = http.request(url, reqOpts, (res) => {
      let data = '';
      let cookies = [];
      if (res.headers['set-cookie']) {
        cookies = res.headers['set-cookie'].map((c) => c.split(';')[0]);
      }
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data,
          json,
          cookie: cookies.join('; ')
        });
      });
    });

    req.setTimeout(3000, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.on('error', reject);
    if (options.body) {
      if (typeof options.body === 'object') {
        req.setHeader('Content-Type', 'application/json');
        req.write(JSON.stringify(options.body));
      } else {
        req.write(options.body);
      }
    }
    req.end();
  });
}

async function runPart5VerificationHarness() {
  console.log('====================================================');
  console.log('STARTING PART 5: CERTIFICATES & FINAL REGRESSION VERIFICATION');
  console.log('====================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failedTests++;
    }
  }

  // Load express server (automatically listens on process.env.PORT = 5099)
  const app = require('../server/index');
  console.log(`[Test Setup] Awaiting College OS server startup on port ${PORT}...`);
  if (app.startPromise) {
    await app.startPromise;
  }
  console.log(`[Test Setup] College OS server ready on port ${PORT}\n`);

  try {
    // ----------------------------------------------------
    // TEST 1: Default Template Initialization
    // ----------------------------------------------------
    console.log('Test 1: Default Certificate Template Initialization');
    const defaultTemplateId = await ensureDefaultTemplate(1);
    assert(Boolean(defaultTemplateId), 'Default certificate template created/retrieved successfully');

    const templates = await getTemplates();
    assert(Array.isArray(templates) && templates.length > 0, 'Fetched active certificate templates list');

    // ----------------------------------------------------
    // TEST 2: Template Creation, Versioning & Duplication
    // ----------------------------------------------------
    console.log('\nTest 2: Template Manager CRUD, Versioning & Duplication');
    const newTpl = await createTemplate({
      name: 'Campus Champions Gold Template',
      description: 'Gold template for semester finals',
      configuration: {
        title: 'GOLD MERIT CERTIFICATE',
        subtitle: 'Presented to top coder',
        partner_name: 'Unstop',
        partner_label: 'Powered by'
      },
      adminId: 1
    });
    assert(newTpl.name === 'Campus Champions Gold Template', 'Created new custom certificate template');
    assert(newTpl.active_version.version_number === 1, 'Initial template version is v1');

    // Save as Version 2
    const updatedVer = await updateTemplate({
      templateId: newTpl.id,
      configuration: {
        title: 'GOLD MERIT CERTIFICATE V2',
        subtitle: 'Presented to top coder',
        partner_name: 'AWS Student Builder Group',
        partner_label: 'In Association With'
      },
      createNewVersion: true,
      adminId: 1
    });
    assert(updatedVer.activeVersion.version_number === 2, 'Template updated and incremented to v2');

    // Duplicate Template
    const duplicated = await duplicateTemplate(newTpl.id, 1);
    assert(duplicated.name.includes('(Copy)'), 'Template duplicated with copied configuration');

    // ----------------------------------------------------
    // TEST 3: Contest Setup & Finalization Flow
    // ----------------------------------------------------
    console.log('\nTest 3: Contest Creation & Finalization Flow');
    const startTime = new Date(Date.now() - 3600 * 1000).toISOString();
    const endTime = new Date(Date.now() - 600 * 1000).toISOString();

    const contest = await createContest(
      {
        title: 'Part 5 Final Championship Contest',
        description: 'Final contest for top 3 certificates',
        status: 'completed',
        start_time: startTime,
        end_time: endTime,
        duration_minutes: 60,
        certificate_enabled: true,
        certificate_template_id: newTpl.id
      },
      1
    );
    assert(Boolean(contest.id), 'Created completed test contest for finalization');

    // Add problem to contest
    const problem = await createProblem(
      {
        contest_id: contest.id,
        title: 'Sum of Two Numbers',
        slug: `sum-two-p5-${Date.now()}`,
        statement: 'Return sum of A and B',
        difficulty: 'Easy',
        max_score: 100
      },
      1
    );

    // Seed submissions & leaderboard for student 1 & student 2
    await submitStudentSolution(
      problem.id,
      { language: 'python', code: 'print(sum(map(int, input().split())))' },
      1
    );

    // Trigger contest finalization
    const finRes = await finalizeContest(contest.id, 1);
    assert(finRes.success === true, 'Contest finalized successfully');
    assert(finRes.certificatesCount > 0, 'Top 3 certificate eligibility generated');

    // Test Idempotency: Finalize again
    const finRes2 = await finalizeContest(contest.id, 1);
    assert(finRes2.message.includes('already finalized'), 'Running finalization twice is idempotent');

    // ----------------------------------------------------
    // TEST 4: Certificate Approval & PDF Generation
    // ----------------------------------------------------
    console.log('\nTest 4: Admin Certificate Approval & PDF Render');
    const certsRes = await pool.query('SELECT * FROM coding_certificates WHERE contest_id = $1', [contest.id]);
    const cert = certsRes.rows[0];
    assert(Boolean(cert), 'Found generated certificate record');

    const approvedCert = await approveCertificate(cert.id, 1);
    assert(approvedCert.status === 'approved', 'Certificate approved by admin');
    assert(Boolean(approvedCert.certificate_number), 'Unique certificate number generated');
    assert(Boolean(approvedCert.verification_token), 'Unique verification token generated');

    // Render PDF Buffer
    const pdfBuffer = await generateCertificatePDF(approvedCert);
    assert(Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 500, 'PDF buffer rendered cleanly');

    // ----------------------------------------------------
    // TEST 5: Template Version Immutability
    // ----------------------------------------------------
    console.log('\nTest 5: Template Version Immutability Guard');
    // Modify active template to V3
    await updateTemplate({
      templateId: newTpl.id,
      configuration: {
        title: 'ALTERED TITLE FOR FUTURE CONTESTS',
        partner_name: 'New Sponsor XYZ'
      },
      createNewVersion: true,
      adminId: 1
    });

    // Verify previously issued certificate snapshot remains UNCHANGED
    const certCheck = await pool.query('SELECT configuration_snapshot FROM coding_certificates WHERE id = $1', [cert.id]);
    const snapshot = certCheck.rows[0].configuration_snapshot;
    assert(snapshot.title !== 'ALTERED TITLE FOR FUTURE CONTESTS', 'Historical certificate retains immutable template snapshot');

    // ----------------------------------------------------
    // TEST 6: Public Verification & Privacy Shielding
    // ----------------------------------------------------
    console.log('\nTest 6: Public Verification & Privacy Shielding');
    const publicData = await getPublicVerification(approvedCert.verification_token);
    assert(publicData.verified === true, 'Public verification returns verified status');
    assert(publicData.student_name !== undefined, 'Public verification includes student display name');
    assert(publicData.email === undefined, 'Public verification NEVER exposes student email');
    assert(publicData.source_code === undefined, 'Public verification NEVER exposes code submissions');
    assert(publicData.proctoring === undefined, 'Public verification NEVER exposes anti-cheat logs');

    // Test API route HTTP request
    const pubHttp = await makeRequest(`/api/certificates/verify/${approvedCert.verification_token}`);
    assert(pubHttp.status === 200, 'Public verification HTTP endpoint returns 200 OK');
    assert(pubHttp.json.valid === true, 'HTTP verification payload valid');

    // ----------------------------------------------------
    // TEST 7: Certificate Revocation
    // ----------------------------------------------------
    console.log('\nTest 7: Admin Certificate Revocation');
    const revoked = await revokeCertificate(cert.id, 1, 'Plagiarism detected post-contest');
    assert(revoked.status === 'revoked', 'Certificate status updated to revoked');

    const pubRev = await getPublicVerification(approvedCert.verification_token);
    assert(pubRev.status === 'REVOKED', 'Public verification reflects REVOKED status');

    // ----------------------------------------------------
    // TEST 8: Overall Season Leaderboard
    // ----------------------------------------------------
    console.log('\nTest 8: Overall Season Leaderboard Calculation');
    const seasonLead = await getOverallSeasonLeaderboard();
    assert(Array.isArray(seasonLead), 'Fetched overall season leaderboard array');

    // ----------------------------------------------------
    // TEST 9: Zero Regression Audit (Parts 1 - 4)
    // ----------------------------------------------------
    console.log('\nTest 9: Executing Zero Regression Audit Across Parts 1 - 4');

    const p1 = require('child_process').spawnSync('node', ['tools/part1-verify.js'], { cwd: process.cwd(), stdio: 'inherit' });
    assert(p1.status === 0, 'Part 1 Foundation Verification passed (Exit Code 0)');

    const p2 = require('child_process').spawnSync('node', ['tools/part2-coding-admin-verify.js'], { cwd: process.cwd(), stdio: 'inherit' });
    assert(p2.status === 0, 'Part 2 Admin Governance Verification passed (Exit Code 0)');

    const p3 = require('child_process').spawnSync('node', ['tools/part3-coding-student-verify.js'], { cwd: process.cwd(), stdio: 'inherit' });
    assert(p3.status === 0, 'Part 3 Student Arena Verification passed (Exit Code 0)');

    const p4 = require('child_process').spawnSync('node', ['tools/part4-coding-security-verify.js'], { cwd: process.cwd(), stdio: 'inherit' });
    assert(p4.status === 0, 'Part 4 Secure Execution & Integrity Verification passed (Exit Code 0)');

  } catch (err) {
    console.error('❌ Verification harness error:', err);
    failedTests++;
  }

  console.log('\n====================================================');
  console.log(`PART 5 VERIFICATION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    console.log('🎉 ALL PART 5 & ZERO-REGRESSION AUDIT TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  }
}

runPart5VerificationHarness();
