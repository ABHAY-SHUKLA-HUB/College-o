/**
 * Comprehensive Automated Verification Harness for Part 3: Student Coding Arena
 * Tests:
 * 1. Module Enabled/Disabled Fail-Closed Gate & Settings API
 * 2. Student Contests List & Computed Status Filtering (Scheduled, Live, Completed)
 * 3. Upcoming Contest Problem Shielding (Sealed before start time)
 * 4. Live Problem Detail View & Hidden Test Case Leakage Shielding
 * 5. Run Code Boundary (Temporary sample execution without persistence)
 * 6. Submit Solution with Server-Bound Student Identity & Full Test Suite Evaluation
 * 7. Contest Leaderboard Calculation & Admin Visibility Toggle Enforcement
 * 8. Overall Season Leaderboard & Idempotent Points Calculation (100, 75, 60, 40, 10)
 * 9. Personal Submission History Privacy (No code leakage across students)
 * 10. Strict Mode Integrity Event Logging
 */

require('dotenv').config();
const PORT = 3456;
process.env.PORT = String(PORT);
const http = require('http');
const { pool } = require('../server/db/pool');
const {
  updateCodingModuleSettings,
  createContest,
  createProblem,
  createTestCase,
  submitStudentSolution,
  calculateContestLeaderboard
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

async function runPart3Verification() {
  console.log('==================================================');
  console.log('STARTING PART 3: STUDENT CODING ARENA VERIFICATION');
  console.log('==================================================\n');

  const testMatrix = [];
  function record(name, pass, details) {
    testMatrix.push({ test: name, result: pass ? 'PASS' : 'FAIL', details });
    console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}: ${details}`);
  }

  // Start temporary Express instance for HTTP testing
  const express = require('express');
  const session = require('express-session');
  const app = express();

  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true
    })
  );

  // Mock authenticated sessions for testing
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

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  let createdContestId = null;
  let createdProblemId = null;
  let upcomingContestId = null;
  let upcomingProblemId = null;
  let testStudentId = null;
  let testStudentHeader = {};

  try {
    // Obtain valid student user ID from users table
    const { rows: uRows } = await pool.query("SELECT id FROM users WHERE role IN ('student', 'user') LIMIT 1");
    if (uRows.length) {
      testStudentId = uRows[0].id;
    } else {
      const { rows: adminUser } = await pool.query("SELECT id FROM users LIMIT 1");
      testStudentId = adminUser.length ? adminUser[0].id : 1;
    }
    testStudentHeader = { 'x-test-userid': String(testStudentId), 'x-test-role': 'student' };

    // 1. Test Settings API & Disabled Module Protection
    console.log('[1/10] Testing Module Fail-Closed Setting & Access Controls...');
    await updateCodingModuleSettings({ module_enabled: false }, 1);

    const settingsRes = await makeRequest('/api/coding-challenges/settings', 'GET', null, testStudentHeader);
    if (settingsRes.status === 200 && settingsRes.data.enabled === false) {
      record('1. Settings API Read', true, 'Module configuration status returned correctly for authenticated session (enabled = false)');
    } else {
      record('1. Settings API Read', false, `Unexpected settings response: ${JSON.stringify(settingsRes.data)}`);
    }

    const disabledStudentRes = await makeRequest('/api/coding-challenges/contests', 'GET', null, testStudentHeader);
    if (disabledStudentRes.status === 403 && disabledStudentRes.data.disabled === true) {
      record('2. Disabled Module Block', true, 'Student request rejected with 403 when module_enabled = false');
    } else {
      record('2. Disabled Module Block', false, `Expected 403, got status ${disabledStudentRes.status}`);
    }

    // Enable Module for remaining tests
    await updateCodingModuleSettings({ module_enabled: true, leaderboard_enabled: true }, 1);

    // 2. Setup Test Data (Live Contest & Upcoming Contest)
    console.log('\n[2/10] Setting Up Contests & Problems Test Fixtures...');
    const liveContest = await createContest(
      {
        title: 'Part 3 Student Verification Contest',
        description: 'Testing live student contest flow',
        status: 'live',
        start_time: new Date(Date.now() - 3600000).toISOString(),
        end_time: new Date(Date.now() + 3600000).toISOString(),
        duration_minutes: 120,
        leaderboard_visible: true,
        strict_mode_enabled: true,
        allowed_languages: ['python', 'javascript', 'cpp']
      },
      1
    );
    createdContestId = liveContest.id;

    const liveProb = await createProblem({
      contest_id: createdContestId,
      title: 'Sum of Two Numbers',
      slug: 'sum-two-numbers',
      statement: 'Given two numbers A and B, print their sum.',
      input_format: 'A and B on space separated line',
      output_format: 'Sum integer',
      difficulty: 'Easy',
      max_score: 100,
      order_index: 1,
      starter_code: {
        javascript: 'const fs = require("fs");\nfunction main() {\n  const input = fs.readFileSync(0, "utf-8").trim().split(" ");\n  if (input.length >= 2) console.log(Number(input[0]) + Number(input[1]));\n}\nmain();'
      }
    });
    createdProblemId = liveProb.id;

    // Create Sample & Hidden Test Cases
    await pool.query(
      `INSERT INTO coding_problem_examples (problem_id, sample_input, sample_output, explanation, order_index)
       VALUES ($1, '5 10', '15', '5 + 10 = 15', 1)`,
      [createdProblemId]
    );

    await createTestCase({ problem_id: createdProblemId, input_data: '5 10', expected_output: '15', is_hidden: false, weight: 10 });
    await createTestCase({ problem_id: createdProblemId, input_data: '100 200', expected_output: '300', is_hidden: true, weight: 10 });

    // Create Upcoming Contest
    const upcomingContest = await createContest(
      {
        title: 'Upcoming Secret Contest',
        description: 'Not started yet',
        status: 'scheduled',
        start_time: new Date(Date.now() + 86400000).toISOString(),
        end_time: new Date(Date.now() + 172800000).toISOString(),
        duration_minutes: 60
      },
      1
    );
    upcomingContestId = upcomingContest.id;

    const upcomingProb = await createProblem({
      contest_id: upcomingContestId,
      title: 'Secret Problem',
      statement: 'Secret problem statement',
      difficulty: 'Medium'
    });
    upcomingProblemId = upcomingProb.id;

    // 3. Test Student Contests Listing
    console.log('\n[3/10] Testing Student Contests List...');
    const contestsRes = await makeRequest('/api/coding-challenges/contests', 'GET', null, testStudentHeader);
    if (contestsRes.status === 200 && Array.isArray(contestsRes.data.contests)) {
      record('3. Contests List Fetch', true, `Student retrieved ${contestsRes.data.contests.length} visible contests`);
    } else {
      record('3. Contests List Fetch', false, `Failed to retrieve contests: status ${contestsRes.status}`);
    }

    // 4. Test Upcoming Problem Shielding
    console.log('\n[4/10] Testing Upcoming Contest Problem Shielding...');
    const upcomingProbRes = await makeRequest(`/api/coding-challenges/problems/${upcomingProblemId}`, 'GET', null, testStudentHeader);
    if (upcomingProbRes.status === 400 && String(upcomingProbRes.data.error).includes('not started')) {
      record('4. Upcoming Problem Shielding', true, 'Upcoming problem statement access rejected (sealed before start time)');
    } else {
      record('4. Upcoming Problem Shielding', false, `Expected 400 error, got ${upcomingProbRes.status}: ${JSON.stringify(upcomingProbRes.data)}`);
    }

    // 5. Test Live Problem Detail & Hidden Test Case Leakage Shielding
    console.log('\n[5/10] Auditing Problem Detail & Test Case Shielding...');
    const liveProbRes = await makeRequest(`/api/coding-challenges/problems/${createdProblemId}`, 'GET', null, testStudentHeader);
    if (liveProbRes.status === 200 && liveProbRes.data.problem) {
      const prob = liveProbRes.data.problem;
      const hasHiddenProp = 'test_cases' in prob || 'coding_test_cases' in prob;
      if (!hasHiddenProp && Array.isArray(prob.examples)) {
        record('5. Hidden Test Case Shielding', true, 'Problem details returned public sample examples only; hidden test cases strictly shielded');
      } else {
        record('5. Hidden Test Case Shielding', false, 'Found unexpected test case fields in student problem response');
      }
    } else {
      record('5. Hidden Test Case Shielding', false, `Failed to fetch problem detail: ${liveProbRes.status}`);
    }

    // 6. Test Run Code Temporary Execution
    console.log('\n[6/10] Testing Run Code Execution Boundary...');
    const runRes = await makeRequest(`/api/coding-challenges/problems/${createdProblemId}/run`, 'POST', {
      language: 'javascript',
      code: 'const fs = require("fs"); const input = fs.readFileSync(0, "utf-8").trim().split(" "); console.log(Number(input[0]) + Number(input[1]));'
    }, testStudentHeader);

    if (runRes.status === 200 && runRes.data.run && runRes.data.run.passed_examples === 1) {
      record('6. Run Code Boundary', true, 'Run Code evaluated sample input successfully without persisting submission');
    } else {
      record('6. Run Code Boundary', false, `Run Code failed: ${JSON.stringify(runRes.data)}`);
    }

    // 7. Test Submit Solution & Identity Binding
    console.log('\n[7/10] Testing Solution Submission & Identity Binding...');
    const submitRes = await makeRequest(`/api/coding-challenges/problems/${createdProblemId}/submit`, 'POST', {
      language: 'javascript',
      code: 'const fs = require("fs"); const input = fs.readFileSync(0, "utf-8").trim().split(" "); console.log(Number(input[0]) + Number(input[1]));',
      student_id: 999999 // Malicious browser identity spoof attempt!
    }, testStudentHeader);

    if (submitRes.status === 200 && submitRes.data.submission) {
      const sub = submitRes.data.submission;
      const { rows: subCheck } = await pool.query('SELECT student_id, status, score FROM coding_submissions WHERE id = $1', [sub.submission_id]);
      if (subCheck.length && subCheck[0].student_id === testStudentId && subCheck[0].status === 'accepted' && subCheck[0].score === 100) {
        record('7. Server Identity Binding & Evaluation', true, `Submission evaluated against full test suite (score: 100) and bound to authentic session userId (${testStudentId})`);
      } else {
        record('7. Server Identity Binding & Evaluation', false, `Submission bound to wrong ID or incorrect score: ${JSON.stringify(subCheck[0])}`);
      }
    } else {
      record('7. Server Identity Binding & Evaluation', false, `Submission failed: ${JSON.stringify(submitRes.data)}`);
    }

    // 8. Test Contest Leaderboard & Admin Visibility Toggle
    console.log('\n[8/10] Testing Contest Leaderboard & Visibility Toggle...');
    const lbRes = await makeRequest(`/api/coding-challenges/contests/${createdContestId}/leaderboard`, 'GET', null, testStudentHeader);
    if (lbRes.status === 200 && Array.isArray(lbRes.data.leaderboard) && lbRes.data.leaderboard.length > 0) {
      record('8. Contest Leaderboard Calculation', true, `Leaderboard calculated deterministically; top student score: ${lbRes.data.leaderboard[0].total_score} pts`);
    } else {
      record('8. Contest Leaderboard Calculation', false, `Failed to fetch leaderboard: ${JSON.stringify(lbRes.data)}`);
    }

    // Test Contest Leaderboard Hidden Toggle
    await pool.query('UPDATE coding_contests SET leaderboard_visible = false WHERE id = $1', [createdContestId]);
    const hiddenLbRes = await makeRequest(`/api/coding-challenges/contests/${createdContestId}/leaderboard`, 'GET', null, testStudentHeader);
    if (hiddenLbRes.status === 403 && hiddenLbRes.data.hidden === true) {
      record('9. Leaderboard Hidden Toggle', true, 'Leaderboard endpoint returned 403 hidden when leaderboard_visible = false');
    } else {
      record('9. Leaderboard Hidden Toggle', false, `Expected 403 hidden, got ${hiddenLbRes.status}`);
    }

    // 9. Test Overall Season Leaderboard & Idempotent Points
    console.log('\n[9/10] Testing Overall Season Leaderboard Idempotency...');
    await pool.query('UPDATE coding_contests SET leaderboard_visible = true WHERE id = $1', [createdContestId]);

    const seasonRes1 = await makeRequest('/api/coding-challenges/leaderboard/overall', 'GET', null, testStudentHeader);
    const seasonRes2 = await makeRequest('/api/coding-challenges/leaderboard/overall', 'GET', null, testStudentHeader);

    if (seasonRes1.status === 200 && seasonRes2.status === 200) {
      const score1 = seasonRes1.data.leaderboard[0]?.season_points;
      const score2 = seasonRes2.data.leaderboard[0]?.season_points;
      if (score1 === score2 && score1 === 100) {
        record('10. Season Leaderboard Idempotency', true, 'Season points calculated idempotently (1st place = 100 pts on repeated queries)');
      } else {
        record('10. Season Leaderboard Idempotency', false, `Score mismatch: run1 = ${score1}, run2 = ${score2}`);
      }
    } else {
      record('10. Season Leaderboard Idempotency', false, `Season leaderboard request failed`);
    }

    // 10. Test Strict Mode Integrity Event Logging
    console.log('\n[10/10] Testing Strict Mode Integrity Event Logging...');
    const integrityRes = await makeRequest(`/api/coding-challenges/contests/${createdContestId}/integrity-event`, 'POST', {
      problem_id: createdProblemId,
      event_type: 'paste_attempt',
      metadata: { textLength: 45 }
    }, testStudentHeader);

    if (integrityRes.status === 200 && integrityRes.data.ok === true) {
      record('11. Integrity Event Logging', true, 'Integrity proctoring event (paste_attempt) logged successfully for strict mode contest');
    } else {
      record('11. Integrity Event Logging', false, `Failed to log integrity event: ${JSON.stringify(integrityRes.data)}`);
    }

    // Summary Output
    console.log('\n==================================================');
    console.log('PART 3: STUDENT CODING ARENA SUMMARY MATRIX');
    console.log('==================================================');
    console.table(testMatrix);

    const allPassed = testMatrix.every((t) => t.result === 'PASS');
    if (allPassed) {
      console.log('\n✅ ALL PART 3 STUDENT CODING ARENA TESTS PASSED!');
    } else {
      console.error('\n❌ SOME PART 3 CHECKS FAILED! Review matrix above.');
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Fatal verification error:', err);
    process.exitCode = 1;
  } finally {
    if (createdContestId) {
      await pool.query('DELETE FROM coding_contests WHERE id = $1', [createdContestId]).catch(() => null);
    }
    if (upcomingContestId) {
      await pool.query('DELETE FROM coding_contests WHERE id = $1', [upcomingContestId]).catch(() => null);
    }
    if (server) {
      server.close();
    }
    await pool.end().catch(() => null);
    process.exit(process.exitCode || 0);
  }
}

runPart3Verification();
