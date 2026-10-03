const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://college-o.onrender.com';

function request(urlPath, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(BASE_URL + urlPath);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...headers
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      const setCookies = res.headers['set-cookie'] || [];
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          setCookies,
          body: data,
          json
        });
      });
    });

    req.on('error', (err) => resolve({ statusCode: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 408, error: 'Timeout' }); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function probe() {
  console.log('--- Probing Live APIs on Render ---');
  
  const endpoints = [
    { path: '/api/health', method: 'GET' },
    { path: '/api/auth/config', method: 'GET' },
    { path: '/api/auth/me', method: 'GET' },
    { path: '/api/auth/captcha/challenge', method: 'GET' },
    { path: '/api/auth/captcha', method: 'GET' },
    { path: '/api/auth/otp/send', method: 'POST', body: { email: 'test@collegeo.in' } },
    { path: '/api/auth/password/forgot', method: 'POST', body: { email: 'test@collegeo.in' } },
    { path: '/api/academics/categories', method: 'GET' },
    { path: '/api/academics/colleges', method: 'GET' },
    { path: '/api/academics/courses', method: 'GET' },
    { path: '/api/academics/years', method: 'GET' },
    { path: '/api/academics/branches', method: 'GET' },
    { path: '/api/academics/semesters', method: 'GET' },
    { path: '/api/academics/subjects?branchId=1&semesterId=1', method: 'GET' },
    { path: '/api/career/roadmaps', method: 'GET' },
    { path: '/api/roadmaps', method: 'GET' },
    { path: '/api/certificates/verify?code=12345', method: 'GET' },
    { path: '/api/subscriptions/config', method: 'GET' },
    { path: '/api/subscriptions/membership-center-config', method: 'GET' },
    { path: '/api/live-sessions', method: 'GET' },
    { path: '/api/support/requests', method: 'GET' },
    { path: '/api/support/top-helpers', method: 'GET' },
    { path: '/api/campus-feed', method: 'GET' },
    { path: '/api/student/notes/unified', method: 'GET' },
    { path: '/api/student/papers/unified', method: 'GET' }
  ];

  const results = [];
  for (const ep of endpoints) {
    const res = await request(ep.path, ep.method, ep.body);
    const summary = {
      path: ep.path,
      method: ep.method,
      statusCode: res.statusCode,
      hasJson: Boolean(res.json),
      sample: res.json || res.body?.slice(0, 150)
    };
    results.push(summary);
    console.log(`${ep.method} ${ep.path} -> HTTP ${res.statusCode}`);
  }

  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(path.join(reportsDir, 'api_probe_summary.json'), JSON.stringify(results, null, 2));
  console.log('Summary written to reports/api_probe_summary.json');
}

probe().catch(console.error);
