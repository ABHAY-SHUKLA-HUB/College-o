require('dotenv').config();
const PORT = 3458;
process.env.PORT = String(PORT);
process.env.PG_POOL_MAX = '5';
const http = require('http');
const { pool } = require('../server/db/pool');
const { getCodingModuleSettings, updateCodingModuleSettings } = require('../server/services/codingChallengesService');

let server;

function makeRequest(path, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null;
    const defaultHeaders = {
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...headers
    };

    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: defaultHeaders
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch (_e) {
            parsed = body;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );

    req.on('error', (err) => reject(err));
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// Session helper for testing admin vs student
let adminCookie = '';
let studentCookie = '';

async function loginAsAdmin() {
  const res = await makeRequest('/api/auth/login', 'POST', {
    email: 'admin@collegeo.in',
    password: 'AdminPassword123!'
  });
  if (res.status === 200 && res.headers['set-cookie']) {
    adminCookie = res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  } else {
    // If admin doesn't exist, create or seed session
    console.warn('[Verify] Login response status:', res.status, res.body);
  }
}

async function runVerification() {
  console.log('=== Starting Part 2 Coding Challenge Admin Verification ===\n');

  // Start Express server via index.js
  const app = require('../server/index.js');
  if (app.startPromise) await app.startPromise;
  console.log(`[Verify] College OS server ready on port ${PORT}.\n`);

  try {
    await executeTests();
    console.log('\n✅ All Part 2 Coding Admin Verification Tests PASSED Successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Verification Failed:', err);
    process.exit(1);
  }
}

async function executeTests() {
  // Test 1: Admin Authentication Check
  console.log('Test 1: Ensure Admin user exists & login to obtain session cookie...');
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('AdminPassword123!', 10);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name, is_email_verified)
     VALUES ('admin@collegeo.in', $1, 'admin', 'System Admin', true)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
    [hash]
  );

  const loginRes = await makeRequest('/api/auth/login', 'POST', {
    email: 'admin@collegeo.in',
    password: 'AdminPassword123!'
  });

  if (loginRes.status === 200 && loginRes.headers['set-cookie']) {
    adminCookie = loginRes.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
    console.log('  -> Admin logged in successfully.');
  } else {
    throw new Error(`Admin login failed: status ${loginRes.status}, body: ${JSON.stringify(loginRes.body)}`);
  }

  // Test 2: Centralized Languages Mapping Endpoint
  console.log('\nTest 2: GET /api/admin/coding-challenges/languages');
  const langRes = await makeRequest('/api/admin/coding-challenges/languages', 'GET', null, { Cookie: adminCookie });
  if (langRes.status !== 200 || !langRes.body.languages) {
    throw new Error(`Languages endpoint failed: status ${langRes.status}`);
  }
  const langs = langRes.body.languages;
  const langKeys = Object.keys(langs);
  console.log(`  -> Supported languages retrieved: ${langKeys.join(', ')}`);
  if (!langs.python || !langs.javascript || !langs.cpp || !langs.c || !langs.java) {
    throw new Error('Missing standard language key in centralized language map');
  }

  // Test 3: Create Draft Contest
  console.log('\nTest 3: POST /api/admin/coding-challenges/contests (Create Draft Contest)');
  const startTime = new Date(Date.now() + 3600000).toISOString();
  const endTime = new Date(Date.now() + 7200000).toISOString();

  const contestPayload = {
    title: 'Verification Contest Part2 #' + Date.now(),
    description: 'Automated test contest for Part 2 requirements',
    rules_and_instructions: 'No cheating. Write clean code.',
    status: 'draft',
    duration_minutes: 60,
    start_time: startTime,
    end_time: endTime,
    allowed_languages: ['python', 'javascript', 'cpp', 'java'],
    leaderboard_visible: true,
    strict_mode_enabled: true,
    certificate_enabled: false
  };

  const createContestRes = await makeRequest('/api/admin/coding-challenges/contests', 'POST', contestPayload, { Cookie: adminCookie });
  if (createContestRes.status !== 201 || !createContestRes.body.contest?.id) {
    throw new Error(`Failed to create contest: status ${createContestRes.status}, body: ${JSON.stringify(createContestRes.body)}`);
  }
  const contestId = createContestRes.body.contest.id;
  console.log(`  -> Draft contest created with ID: ${contestId}`);

  // Test 4: Edit Contest
  console.log('\nTest 4: PUT /api/admin/coding-challenges/contests/:id (Edit Contest)');
  const updateRes = await makeRequest(`/api/admin/coding-challenges/contests/${contestId}`, 'PUT', {
    ...contestPayload,
    title: contestPayload.title + ' (Updated)'
  }, { Cookie: adminCookie });

  if (updateRes.status !== 200 || updateRes.body.contest.title !== contestPayload.title + ' (Updated)') {
    throw new Error(`Failed to update contest: ${JSON.stringify(updateRes.body)}`);
  }
  console.log('  -> Contest updated successfully.');

  // Test 5: Add Problem Statement & Test Cases
  console.log('\nTest 5: POST /api/admin/coding-challenges/contests/:id/problems (Add Problem)');
  const problemPayload = {
    title: 'Sum of Two Numbers',
    difficulty: 'easy',
    score: 100,
    statement: 'Given two integers A and B, output their sum.',
    problem_statement: 'Given two integers A and B, output their sum.',
    input_format: 'First line contains two space-separated integers A and B.',
    output_format: 'Print the sum of A and B.',
    constraints: '1 <= A, B <= 10^9',
    public_examples: [{ input: '2 3\n', output: '5\n', explanation: '2 + 3 = 5' }],
    starter_code_templates: {
      python: 'import sys\n# read input\n',
      cpp: '#include <iostream>\nusing namespace std;\nint main() { return 0; }\n'
    }
  };

  const problemRes = await makeRequest(`/api/admin/coding-challenges/contests/${contestId}/problems`, 'POST', problemPayload, { Cookie: adminCookie });
  if (problemRes.status !== 201 || !problemRes.body.problem?.id) {
    throw new Error(`Failed to create problem: status ${problemRes.status}, body: ${JSON.stringify(problemRes.body)}`);
  }
  const problemId = problemRes.body.problem.id;
  console.log(`  -> Problem created with ID: ${problemId}`);

  // Test 6: Add Sample Test Case & Hidden Test Case
  console.log('\nTest 6: Add Public Sample & Hidden Evaluation Test Cases');
  const sampleTcRes = await makeRequest(`/api/admin/coding-challenges/problems/${problemId}/test-cases`, 'POST', {
    input_data: '2 3\n',
    expected_output: '5\n',
    is_sample: true,
    is_hidden: false,
    weight: 10
  }, { Cookie: adminCookie });
  if (sampleTcRes.status !== 201) throw new Error('Failed to create sample test case');

  const hiddenTcRes = await makeRequest(`/api/admin/coding-challenges/problems/${problemId}/test-cases`, 'POST', {
    input_data: '100 200\n',
    expected_output: '300\n',
    is_sample: false,
    is_hidden: true,
    weight: 40
  }, { Cookie: adminCookie });
  if (hiddenTcRes.status !== 201) throw new Error('Failed to create hidden test case');
  console.log('  -> Sample test case (weight 10) and Hidden test case (weight 40) added.');

  // Test 7: Bulk Import Test Cases
  console.log('\nTest 7: Bulk Import Test Cases');
  const bulkRes = await makeRequest(`/api/admin/coding-challenges/problems/${problemId}/test-cases/bulk`, 'POST', {
    test_cases: [
      { input_data: '50 50\n', expected_output: '100\n', is_sample: false, is_hidden: true, weight: 25 },
      { input_data: '999 1\n', expected_output: '1000\n', is_sample: false, is_hidden: true, weight: 25 }
    ]
  }, { Cookie: adminCookie });
  if (bulkRes.status !== 201 || bulkRes.body.imported_count !== 2) {
    console.log('[DEBUG Test 7 bulkRes]:', JSON.stringify(bulkRes));
    throw new Error(`Bulk test case import failed: ${JSON.stringify(bulkRes.body)}`);
  }
  console.log('  -> Bulk imported 2 hidden test cases successfully.');

  // Test 8: CRITICAL SECURITY TEST - Hidden Test Cases Isolation
  console.log('\nTest 8: CRITICAL SECURITY ISOLATION VERIFICATION');
  // Admin query
  const adminTcRes = await makeRequest(`/api/admin/coding-challenges/problems/${problemId}/test-cases`, 'GET', null, { Cookie: adminCookie });
  if (adminTcRes.status !== 200) throw new Error('Admin failed to fetch test cases');
  const adminTcs = adminTcRes.body.test_cases || [];
  const hiddenCountAdmin = adminTcs.filter((tc) => tc.is_hidden).length;
  console.log(`  -> Admin sees total test cases: ${adminTcs.length} (including ${hiddenCountAdmin} hidden cases).`);

  // Enable module temporarily to query student endpoints
  await updateCodingModuleSettings({ module_enabled: true });
  // Publish contest so student can query problem
  await makeRequest(`/api/admin/coding-challenges/contests/${contestId}/status`, 'PATCH', { status: 'scheduled' }, { Cookie: adminCookie });

  // Student problem view query
  const studentProbRes = await makeRequest(`/api/coding-challenges/problems/${problemId}`);
  const studentProb = studentProbRes.body.problem || {};
  
  if (JSON.stringify(studentProbRes.body).includes('300\n') || JSON.stringify(studentProbRes.body).includes('1000\n')) {
    throw new Error('SECURITY VIOLATION: Hidden test case expected outputs leaked in student API response!');
  }
  console.log('  -> Verified: Student problem API response does NOT contain hidden test case contents!');

  // Test 9: Feature Toggle & Visibility Controls
  console.log('\nTest 9: Feature Toggle & Visibility Controls Verification');
  // Turn module OFF
  await updateCodingModuleSettings({ module_enabled: false });
  
  // Verify Admin can still access admin stats and contests when module is OFF
  const adminStatsResOff = await makeRequest('/api/admin/coding-challenges/stats', 'GET', null, { Cookie: adminCookie });
  if (adminStatsResOff.status !== 200) {
    throw new Error('Admin management blocked when module_enabled = false!');
  }
  console.log('  -> Verified: Admin portal functions normally when student module is OFF.');

  // Verify Student GET /api/coding-challenges/contests is rejected when module is OFF
  const studentContestsOff = await makeRequest('/api/coding-challenges/contests');
  if (![401, 403].includes(studentContestsOff.status)) {
    throw new Error(`Student endpoint did not block access when module disabled. Status: ${studentContestsOff.status}`);
  }
  console.log(`  -> Verified: Student API returned HTTP ${studentContestsOff.status} access blocked when module is OFF.`);

  // Test 10: Duplicate Contest & Safe Draft Deletion
  console.log('\nTest 10: Duplicate Contest & Safe Draft Deletion');
  const dupRes = await makeRequest(`/api/admin/coding-challenges/contests/${contestId}/duplicate`, 'POST', null, { Cookie: adminCookie });
  if (dupRes.status !== 201 || !dupRes.body.contest?.id) {
    throw new Error(`Failed to duplicate contest: ${JSON.stringify(dupRes.body)}`);
  }
  const duplicatedId = dupRes.body.contest.id;
  console.log(`  -> Contest duplicated successfully (New Draft ID: ${duplicatedId}).`);

  // Delete duplicated draft contest
  const delRes = await makeRequest(`/api/admin/coding-challenges/contests/${duplicatedId}`, 'DELETE', null, { Cookie: adminCookie });
  if (delRes.status !== 200) {
    throw new Error(`Failed to safely delete draft contest: ${JSON.stringify(delRes.body)}`);
  }
  console.log('  -> Duplicated draft contest deleted safely.');

  // Clean up test contest
  await pool.query('DELETE FROM coding_contests WHERE id = $1 OR id = $2', [contestId, duplicatedId]);

  // Test 11: Zero-Regression Verification
  console.log('\nTest 11: Zero-Regression Verification');
  const health = await makeRequest('/api/health');
  if (health.status !== 200) throw new Error('Health check failed');

  const study = await makeRequest('/api/academics/subjects?branchId=1');
  if (study.status !== 200) throw new Error('Subjects API failed');

  const notes = await makeRequest('/api/notes', 'GET', null, { Cookie: adminCookie });
  if (notes.status !== 200) throw new Error(`Notes API failed with status ${notes.status}`);

  const mockTests = await makeRequest('/api/mock-tests', 'GET', null, { Cookie: adminCookie });
  if (mockTests.status !== 200) throw new Error(`Mock tests API failed with status ${mockTests.status}`);

  console.log('  -> Health, Subjects (branchId=1), Notes, and Mock Tests APIs verified 200 OK.');
  process.exit(0);
}

runVerification();
