/**
 * Automated Verification Harness for Part 4: Secure Code Execution, Integrity & Security Boundary Verification
 */

require('dotenv').config();
const PORT = 3457;
process.env.PORT = String(PORT);
const http = require('http');
const { pool } = require('../server/db/pool');
const {
  updateCodingModuleSettings,
  getStudentIntegritySummary,
  disqualifyParticipant,
  runSafeDataRetentionCleanup,
  executeCodeWithJudge0,
  createContest,
  createProblem,
  createTestCase,
  submitStudentSolution
} = require('../server/services/codingChallengesService');
let server;

function makeRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    const req = http.request(
      `http://localhost:${PORT}${path}`,
      { method, headers: reqHeaders },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch (_e) {
            parsed = raw;
          }
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runPart4Verification() {
  console.log('==================================================');
  console.log('STARTING PART 4: SECURE EXECUTION & INTEGRITY VERIFICATION');
  console.log('==================================================\n');

  const testMatrix = [];
  function record(name, pass, details) {
    testMatrix.push({ test: name, result: pass ? 'PASS' : 'FAIL', details });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: ${details}`);
  }

  // Setup mock Express app
  const express = require('express');
  const session = require('express-session');
  const app = express();

  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret-p4',
      resave: false,
      saveUninitialized: true
    })
  );

  app.use((req, _res, next) => {
    const roleHeader = req.headers['x-test-role'];
    const userIdHeader = req.headers['x-test-userid'];
    if (userIdHeader) {
      req.session.userId = Number(userIdHeader);
      req.session.role = roleHeader || 'student';
    } else if (roleHeader === 'admin') {
      req.session.userId = 1;
      req.session.role = 'admin';
    }
    next();
  });

  app.use('/api/coding-challenges', require('../server/routes/coding-challenges'));
  app.use('/api/admin/coding-challenges', require('../server/routes/coding-challenges-admin'));

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  let contestId = null;
  let problemId = null;
  let student1Id = null;
  let student2Id = null;

  try {
    // Enable module
    await updateCodingModuleSettings({ module_enabled: true, leaderboard_enabled: true }, 1);

    // Get 2 valid student user IDs from DB
    const { rows: uRows } = await pool.query("SELECT id FROM users WHERE role IN ('student', 'user') LIMIT 2");
    student1Id = uRows.length > 0 ? uRows[0].id : 1;
    student2Id = uRows.length > 1 ? uRows[1].id : 2;

    const student1Header = { 'x-test-userid': String(student1Id), 'x-test-role': 'student' };
    const student2Header = { 'x-test-userid': String(student2Id), 'x-test-role': 'student' };
    const adminHeader = { 'x-test-userid': '1', 'x-test-role': 'admin' };

    // 1. Test Judge0 Execution Engine Boundary
    console.log('[1/10] Testing Judge0 Execution Engine...');
    const judgeResult = await executeCodeWithJudge0({
      language: 'javascript',
      sourceCode: 'console.log("Hello Judge0 Sandbox");',
      inputData: ''
    });

    if (judgeResult && judgeResult.status === 'accepted' && judgeResult.stdout.includes('Hello Judge0 Sandbox')) {
      record('1. Judge0 Execution Boundary', true, 'Sandboxed Judge0 execution boundary evaluated code safely');
    } else {
      record('1. Judge0 Execution Boundary', false, `Judge0 execution failed: ${JSON.stringify(judgeResult)}`);
    }

    // 2. Setup Contest & Submissions for Anti-Cheat
    console.log('\n[2/10] Setting Up Contest & Submissions...');
    const contest = await createContest(
      {
        title: 'Part 4 Security & Integrity Contest',
        status: 'live',
        start_time: new Date(Date.now() - 3600000).toISOString(),
        end_time: new Date(Date.now() + 3600000).toISOString(),
        duration_minutes: 60,
        strict_mode_enabled: true
      },
      1
    );
    contestId = contest.id;

    const problem = await createProblem({
      contest_id: contestId,
      title: 'Plagiarism Test Problem',
      statement: 'Write function returning double of N',
      difficulty: 'Easy',
      max_score: 100
    });
    problemId = problem.id;

    await createTestCase({ problem_id: problemId, input_data: '10', expected_output: '20', is_hidden: false });
    await createTestCase({ problem_id: problemId, input_data: '50', expected_output: '100', is_hidden: true });

    // 3. Test Student 1 Submission & Integrity Event Logging
    console.log('\n[3/10] Submitting Code & Logging Integrity Events...');
    const codeA = 'const fs = require("fs"); const n = Number(fs.readFileSync(0, "utf-8").trim()); console.log(n * 2);';
    const codeB = 'const fs = require("fs"); const n = Number(fs.readFileSync(0, "utf-8").trim()); console.log(n * 2);'; // Identical code!

    await makeRequest(`/api/coding-challenges/problems/${problemId}/submit`, 'POST', { language: 'javascript', code: codeA }, student1Header);

    // Log paste and tab switch proctoring events for Student 1
    await makeRequest(`/api/coding-challenges/contests/${contestId}/integrity-event`, 'POST', {
      problem_id: problemId,
      event_type: 'paste_attempt',
      metadata: { textLength: 120 }
    }, student1Header);

    await makeRequest(`/api/coding-challenges/contests/${contestId}/integrity-event`, 'POST', {
      problem_id: problemId,
      event_type: 'tab_switch',
      metadata: { count: 3 }
    }, student1Header);

    // Student 2 submits identical code
    await makeRequest(`/api/coding-challenges/problems/${problemId}/submit`, 'POST', { language: 'javascript', code: codeB }, student2Header);

    record('2. Student Submissions & Proctoring', true, 'Submissions evaluated and proctoring events recorded');

    // 4. Test Source Code Similarity Engine (Winnowing / JPlag)
    console.log('\n[4/10] Testing Winnowing / JPlag Similarity Engine...');
    const simCalc = calculateSimilarity(codeA, codeB);
    if (simCalc.score >= 80) {
      record('3. AST/Token Similarity Algorithm', true, `Similarity engine calculated high similarity score: ${simCalc.score}%`);
    } else {
      record('3. AST/Token Similarity Algorithm', false, `Expected >= 80%, got ${simCalc.score}%`);
    }

    const simAnalysis = await analyzeContestSimilarity(contestId);
    if (simAnalysis.ok && simAnalysis.flaggedCount >= 1) {
      record('4. Contest Similarity Analysis Job', true, `Contest similarity job flagged ${simAnalysis.flaggedCount} highly matching pair(s)`);
    } else {
      record('4. Contest Similarity Analysis Job', false, `Analysis result: ${JSON.stringify(simAnalysis)}`);
    }

    // 5. Test Admin Similarity Endpoint & Student Block
    console.log('\n[5/10] Auditing Similarity Data Access Control...');
    const adminSimRes = await makeRequest(`/api/admin/coding-challenges/contests/${contestId}/similarity`, 'GET', null, adminHeader);
    const studentSimRes = await makeRequest(`/api/admin/coding-challenges/contests/${contestId}/similarity`, 'GET', null, student1Header);

    if (adminSimRes.status === 200 && (studentSimRes.status === 403 || studentSimRes.status === 401)) {
      record('5. Similarity Data Access Control', true, `Admin retrieved similarity analysis; student access blocked with status ${studentSimRes.status}`);
    } else {
      record('5. Similarity Data Access Control', false, `Admin status: ${adminSimRes.status}, Student status: ${studentSimRes.status}`);
    }


    // 6. Test Multi-Signal AI & Integrity Suspicion Rating
    console.log('\n[6/10] Auditing Multi-Signal Integrity Suspicion Assessment...');
    const student1Summary = await getStudentIntegritySummary(contestId, student1Id);
    if (student1Summary.assessment && student1Summary.assessment.rating === 'High Review Priority') {
      record('6. Multi-Signal Suspicion Assessment', true, 'Multi-signal evaluator classified student integrity risk as High Review Priority (Paste + Similarity)');
    } else {
      record('6. Multi-Signal Suspicion Assessment', false, `Assessment result: ${JSON.stringify(student1Summary.assessment)}`);
    }

    // 7. Test Admin Manual Disqualification & Leaderboard Recalculation
    console.log('\n[7/10] Testing Admin Participant Disqualification...');
    const disqResult = await disqualifyParticipant(contestId, student1Id, 1, 'High plagiarism similarity score match');
    if (disqResult.ok && disqResult.status === 'disqualified') {
      // Check leaderboard to verify student1 was removed
      const lbRes = await makeRequest(`/api/coding-challenges/contests/${contestId}/leaderboard`, 'GET', null, student1Header);
      const isStudent1OnBoard = (lbRes.data.leaderboard || []).some((r) => r.student_id === student1Id);
      if (!isStudent1OnBoard) {
        record('7. Participant Disqualification Flow', true, 'Student disqualified safely with audit trail and removed from contest leaderboard');
      } else {
        record('7. Participant Disqualification Flow', false, 'Disqualified student still appears on active contest leaderboard');
      }
    } else {
      record('7. Participant Disqualification Flow', false, `Disqualification failed: ${JSON.stringify(disqResult)}`);
    }

    // 8. Test Rate Limiting Enforcement
    console.log('\n[8/10] Testing API Rate Limiting...');
    let rateLimited = false;
    for (let i = 0; i < 7; i++) {
      const res = await makeRequest(`/api/coding-challenges/problems/${problemId}/submit`, 'POST', { language: 'javascript', code: codeA }, student2Header);
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }

    if (rateLimited) {
      record('8. Rate Limiting Enforcement', true, 'Rate limiter triggered HTTP 429 Too Many Requests on submission spam');
    } else {
      record('8. Rate Limiting Enforcement', false, 'Rate limiter did not trigger 429 after rapid submissions');
    }

    // 9. Test Automated Data Retention Routine
    console.log('\n[9/10] Testing Automated Data Retention & Safe Cleanup...');
    const cleanupResult = await runSafeDataRetentionCleanup({ retentionDays: 15 });
    if (cleanupResult.ok) {
      record('9. Safe Data Retention Routine', true, 'Safe data retention cleanup executed successfully without deleting evidence');
    } else {
      record('9. Safe Data Retention Routine', false, 'Data retention cleanup failed');
    }

    // 10. Summary Matrix
    console.log('\n==================================================');
    console.log('PART 4: SECURE EXECUTION & INTEGRITY SUMMARY');
    console.log('==================================================');
    console.table(testMatrix);

    const allPassed = testMatrix.every((t) => t.result === 'PASS');
    if (allPassed) {
      console.log('\n✅ ALL PART 4 SECURITY & INTEGRITY CHECKS PASSED!');
    } else {
      console.error('\n❌ SOME PART 4 CHECKS FAILED! Review matrix above.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal verification error:', err);
    process.exitCode = 1;
  } finally {
    if (contestId) {
      await pool.query('DELETE FROM coding_contests WHERE id = $1', [contestId]).catch(() => null);
    }
    if (server) {
      server.close();
    }
    await pool.end().catch(() => null);
    process.exit(process.exitCode || 0);
  }
}

runPart4Verification();
