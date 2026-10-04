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

async function testQuizRoutes() {
  const loginRes = await request('/api/admin/login', 'POST', {}, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASS,
    captchaToken: 'math-verified'
  });
  const adminCookies = loginRes.setCookies.map(c => c.split(';')[0]).join('; ');
  const adminCsrfToken = loginRes.json?.csrfToken || '';
  const adminHeaders = {
    'Cookie': adminCookies,
    'X-CSRF-Token': adminCsrfToken,
    'Accept': 'application/json'
  };

  const ts = Date.now();
  const subjectName = 'Distributed Systems 1788677624366';

  // Test 1: POST /api/admin/academics/quizzes
  const createQ1 = await request('/api/admin/academics/quizzes', 'POST', adminHeaders, {
    subject: subjectName,
    chapter: `Live Quiz Verification Chapter ${ts}`,
    difficulty: 'medium',
    questionCount: 5,
    categoryId: 1,
    branchId: 1,
    semesterId: 1,
    accessType: 'free',
    status: 'published'
  });
  console.log('Create Quiz via /api/admin/academics/quizzes:', createQ1.status, createQ1.json);

  const quizId = createQ1.json?.quiz?.id;
  if (quizId) {
    // Check student quizzes query
    const studentQ = await request(`/api/quizzes?subject=${encodeURIComponent(subjectName)}`, 'GET', adminHeaders);
    console.log('Fetch Student Quizzes:', studentQ.status, studentQ.json?.quizzes?.length, 'quizzes found');
    const found = (studentQ.json?.quizzes || []).find(q => q.id === quizId);
    console.log('Found created quiz in student API:', found ? 'PASS' : 'FAIL', found);

    // Delete quiz cleanup
    const delQ = await request(`/api/admin/academics/quizzes/${quizId}`, 'DELETE', adminHeaders);
    console.log('Delete Quiz cleanup:', delQ.status, delQ.json);
  }
}

testQuizRoutes().catch(console.error);
