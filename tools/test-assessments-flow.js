const https = require('https');

const LIVE_DOMAIN = 'https://collegeo.in';
const ADMIN_EMAIL = 'abhayshukla639362@gmail.com';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'CollegeOS_Admin_2026@Secure';

function request(urlPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve) => {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${LIVE_DOMAIN}${urlPath}`;
    const parsed = new URL(fullUrl);

    const reqHeaders = {
      'User-Agent': 'CollegeOS-Live-Auditor/1.0',
      'Accept': 'application/json, text/html, */*',
      ...headers
    };

    let postData = null;
    if (body) {
      if (typeof body === 'object') {
        postData = JSON.stringify(body);
        reqHeaders['Content-Type'] = 'application/json';
      } else {
        postData = String(body);
      }
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method,
      headers: reqHeaders,
      timeout: 20000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        const setCookies = res.headers['set-cookie'] || [];
        resolve({
          status: res.statusCode,
          headers: res.headers,
          setCookies,
          body: data,
          json
        });
      });
    });

    req.on('error', (err) => resolve({ status: 0, error: err.message, body: '', json: null, setCookies: [] }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 408, error: 'Timeout', body: '', json: null, setCookies: [] }); });

    if (postData) req.write(postData);
    req.end();
  });
}

async function testAssessments() {
  console.log('Logging in admin...');
  const loginRes = await request('/api/admin/login', 'POST', {}, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASS,
    captchaToken: 'math-verified'
  });
  console.log('Admin login status:', loginRes.status);
  const adminCookies = loginRes.setCookies.map(c => c.split(';')[0]).join('; ');
  const adminCsrfToken = loginRes.json?.csrfToken || '';
  const adminHeaders = {
    'Cookie': adminCookies,
    'X-CSRF-Token': adminCsrfToken,
    'Accept': 'application/json'
  };

  const ts = Date.now();
  const subjectName = 'Distributed Systems 1788677624366';
  const subjectId = 3;

  // 1. QUIZ TEST
  console.log('\n--- QUIZ TEST ---');
  const quizRes = await request('/api/admin/control/assessments', 'POST', adminHeaders, {
    type: 'quiz',
    title: `QA LIVE QUIZ ${ts}`,
    subject: subjectName,
    chapter: `Live Chapter ${ts}`,
    difficulty: 'medium',
    durationMinutes: 10,
    totalMarks: 10,
    passingMarks: 4,
    branchId: 1,
    semesterId: 1,
    subjectId: subjectId,
    accessType: 'free'
  });
  console.log('Create Quiz:', quizRes.status, quizRes.json);
  const quizId = quizRes.json?.assessment?.id;

  if (quizId) {
    const addQRes = await request(`/api/admin/control/assessments/${quizId}/questions`, 'POST', adminHeaders, {
      type: 'quiz',
      questionText: 'What is the time complexity of quicksort average case?',
      questionType: 'multiple_choice',
      options: ['O(n log n)', 'O(n^2)', 'O(n)', 'O(1)'],
      correctAnswer: 'O(n log n)',
      explanation: 'Average case of quicksort is O(n log n)',
      marks: 5
    });
    console.log('Add Question to Quiz:', addQRes.status, addQRes.json);

    const pubQuizRes = await request(`/api/admin/control/assessments/${quizId}/publish`, 'POST', adminHeaders, {
      type: 'quiz'
    });
    console.log('Publish Quiz:', pubQuizRes.status, pubQuizRes.json);

    // Fetch quiz via student quizzes endpoint
    const getQuizRes = await request(`/api/quizzes?subject=${encodeURIComponent(subjectName)}`, 'GET', adminHeaders);
    console.log('Student Quizzes API response status:', getQuizRes.status);
    const quizzes = getQuizRes.json?.quizzes || [];
    const foundQuiz = quizzes.find(q => q.id === quizId);
    console.log('Found published Quiz in student API:', foundQuiz ? 'YES' : 'NO', foundQuiz);

    // Start quiz attempt
    const startQuiz = await request(`/api/quizzes/${quizId}/start`, 'POST', adminHeaders);
    console.log('Start Quiz response:', startQuiz.status, startQuiz.json);

    // Clean up
    const archiveQuiz = await request(`/api/admin/control/assessments/${quizId}/archive`, 'POST', adminHeaders, { type: 'quiz' });
    console.log('Archive Quiz:', archiveQuiz.status, archiveQuiz.json);
  }

  // 2. MOCK TEST TEST
  console.log('\n--- MOCK TEST TEST ---');
  const mockRes = await request('/api/admin/control/assessments', 'POST', adminHeaders, {
    type: 'mock_test',
    title: `QA LIVE MOCK ${ts}`,
    subject: subjectName,
    topic: `Comprehensive Topic ${ts}`,
    difficulty: 'medium',
    durationMinutes: 30,
    totalMarks: 50,
    totalQuestions: 1,
    branchId: 1,
    semesterId: 1,
    subjectId: subjectId,
    accessType: 'free',
    syllabus: 'Full Unit 1 to Unit 5 syllabus coverage',
    instructions: 'Timed simulation exam with server-side authoritative evaluation.'
  });
  console.log('Create Mock Test:', mockRes.status, mockRes.json);
  const mockId = mockRes.json?.assessment?.id;

  if (mockId) {
    const addMockQRes = await request(`/api/admin/control/assessments/${mockId}/questions`, 'POST', adminHeaders, {
      type: 'mock_test',
      questionText: 'Which data structure follows FIFO order?',
      questionType: 'multiple_choice',
      options: ['Stack', 'Queue', 'Tree', 'Graph'],
      correctAnswer: 'Queue',
      explanation: 'Queue is First In First Out',
      marks: 10
    });
    console.log('Add Question to Mock Test:', addMockQRes.status, addMockQRes.json);

    const pubMockRes = await request(`/api/admin/control/assessments/${mockId}/publish`, 'POST', adminHeaders, {
      type: 'mock_test'
    });
    console.log('Publish Mock Test:', pubMockRes.status, pubMockRes.json);

    // Fetch Mock test via Admin catalog and student mock tests
    const getMockCatalog = await request(`/api/admin/control/assessments?type=mock_test&branchId=1&semesterId=1`, 'GET', adminHeaders);
    const tests = getMockCatalog.json?.assessments || [];
    const foundMockInCatalog = tests.find(m => m.id === mockId);
    console.log('Found published Mock Test in Catalog:', foundMockInCatalog ? 'YES' : 'NO', foundMockInCatalog);

    // Clean up
    const archiveMock = await request(`/api/admin/control/assessments/${mockId}/archive`, 'POST', adminHeaders, { type: 'mock_test' });
    console.log('Archive Mock Test:', archiveMock.status, archiveMock.json);
  }
}

testAssessments().catch(console.error);
