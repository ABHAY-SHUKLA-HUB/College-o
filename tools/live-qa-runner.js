const https = require('https');
const http = require('http');

const BASE_URL = process.env.TARGET_URL || 'https://college-o.onrender.com';
const DOMAIN_URL = 'https://collegeo.in';

const testResults = [];

function record(phase, feature, testCase, status, evidence, severity = 'NONE', notes = '') {
  const item = { phase, feature, testCase, status, evidence, severity, notes, timestamp: new Date().toISOString() };
  testResults.push(item);
  console.log(`[${status}] [${phase}] ${feature} - ${testCase}: ${evidence}`);
}

function request(url, options = {}, postData = null) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    const parsed = new URL(url);

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 15000,
    };

    const req = client.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json,
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        statusCode: 0,
        error: err.message,
        headers: {},
        body: '',
        json: null,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        statusCode: 408,
        error: 'Request Timeout',
        headers: {},
        body: '',
        json: null,
      });
    });

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runLiveAudit() {
  console.log(`\n==================================================`);
  console.log(`Starting LIVE QA & Security Audit on ${BASE_URL} and ${DOMAIN_URL}`);
  console.log(`==================================================\n`);

  // 1. Primary Domain check
  const domRes = await request(DOMAIN_URL);
  if (domRes.statusCode === 404) {
    record('PHASE 1', 'Custom Domain DNS/Hosting', 'Navigate to https://collegeo.in/', 'FAIL', `HTTP 404 Not Found returned by host/Vercel edge`, 'CRITICAL', 'Domain is not routing to the active server');
  } else if (domRes.statusCode >= 200 && domRes.statusCode < 400) {
    record('PHASE 1', 'Custom Domain DNS/Hosting', 'Navigate to https://collegeo.in/', 'PASS', `HTTP ${domRes.statusCode} OK`, 'NONE');
  } else {
    record('PHASE 1', 'Custom Domain DNS/Hosting', 'Navigate to https://collegeo.in/', 'FAIL', `Status: ${domRes.statusCode}, Error: ${domRes.error}`, 'CRITICAL');
  }

  // 2. Health & API check on live instance
  const healthRes = await request(`${BASE_URL}/api/health`);
  if (healthRes.statusCode === 200 && healthRes.json?.ok) {
    record('PHASE 2', 'Backend Health API', 'GET /api/health', 'PASS', `HTTP 200 OK - payload: ${JSON.stringify(healthRes.json)}`);
  } else {
    record('PHASE 2', 'Backend Health API', 'GET /api/health', 'FAIL', `HTTP ${healthRes.statusCode} - ${healthRes.body}`, 'CRITICAL');
  }

  // 3. Public Pages & Clean Routes
  const publicPages = [
    { path: '/', name: 'Homepage (Landing)' },
    { path: '/login', name: 'Login Page' },
    { path: '/pricing', name: 'Pricing Page' },
    { path: '/about-us', name: 'About Us Page' },
    { path: '/contact-us', name: 'Contact Us Page' },
    { path: '/help-center', name: 'Help Center Page' },
    { path: '/academic-onboarding', name: 'Academic Onboarding' },
    { path: '/reset-password', name: 'Reset Password Page' }
  ];

  for (const page of publicPages) {
    const res = await request(`${BASE_URL}${page.path}`);
    if (res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302) {
      const hasContent = res.body && res.body.length > 500;
      record('PHASE 2', page.name, `GET ${page.path}`, hasContent ? 'PASS' : 'PARTIAL', `HTTP ${res.statusCode}, size: ${res.body.length} bytes`);
    } else {
      record('PHASE 2', page.name, `GET ${page.path}`, 'FAIL', `HTTP ${res.statusCode} ${res.error || ''}`, 'HIGH');
    }
  }

  // 4. Captcha Challenge API
  const captchaRes = await request(`${BASE_URL}/api/auth/captcha/challenge`);
  let captchaId = null;
  let captchaQuestion = null;
  if (captchaRes.statusCode === 200 && captchaRes.json?.success) {
    captchaId = captchaRes.json.challenge?.id;
    captchaQuestion = captchaRes.json.challenge?.question;
    record('PHASE 3', 'CAPTCHA API', 'GET /api/auth/captcha/challenge', 'PASS', `Challenge generated ID: ${captchaId}, Question: "${captchaQuestion}"`);
  } else {
    record('PHASE 3', 'CAPTCHA API', 'GET /api/auth/captcha/challenge', 'FAIL', `HTTP ${captchaRes.statusCode} - ${captchaRes.body}`, 'HIGH');
  }

  // 5. Auth Config API
  const authConfigRes = await request(`${BASE_URL}/api/auth/config`);
  if (authConfigRes.statusCode === 200 && authConfigRes.json) {
    record('PHASE 3', 'Auth Config API', 'GET /api/auth/config', 'PASS', `Config returned: turnstileEnabled=${authConfigRes.json.turnstileEnabled}, googleAuthEnabled=${authConfigRes.json.googleAuthEnabled}`);
  } else {
    record('PHASE 3', 'Auth Config API', 'GET /api/auth/config', 'FAIL', `HTTP ${authConfigRes.statusCode}`, 'MEDIUM');
  }

  // 6. Test Unauthenticated Access to Protected APIs & Pages
  const protectedPaths = [
    { path: '/dashboard', isPage: true },
    { path: '/admin-dashboard', isPage: true },
    { path: '/admin-control', isPage: true },
    { path: '/api/dashboard/overview', isPage: false },
    { path: '/api/admin/control/overview', isPage: false },
    { path: '/api/ai/execute', isPage: false, method: 'POST', body: {} },
    { path: '/api/mock-tests', isPage: false },
    { path: '/api/notes', isPage: false }
  ];

  for (const item of protectedPaths) {
    const res = await request(`${BASE_URL}${item.path}`, { method: item.method || 'GET' }, item.body);
    if (item.isPage) {
      if (res.statusCode === 302 || res.statusCode === 301 || (res.statusCode === 200 && res.body.includes('login'))) {
        record('PHASE 4', 'Protected Page Access Control', `GET ${item.path} without auth`, 'PASS', `Redirected or blocked properly (HTTP ${res.statusCode})`);
      } else {
        record('PHASE 4', 'Protected Page Access Control', `GET ${item.path} without auth`, 'FAIL', `Exposed without session: HTTP ${res.statusCode}`, 'CRITICAL');
      }
    } else {
      if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 409 || res.statusCode === 302) {
        record('PHASE 23', 'API Access Control', `${item.method || 'GET'} ${item.path} without auth`, 'PASS', `Rejected with HTTP ${res.statusCode} ${JSON.stringify(res.json || {})}`);
      } else {
        record('PHASE 23', 'API Access Control', `${item.method || 'GET'} ${item.path} without auth`, 'FAIL', `Expected 401/403, received HTTP ${res.statusCode}`, 'CRITICAL');
      }
    }
  }

  // 7. Academic Hierarchy Public Read APIs
  const acadEndpoints = [
    '/api/academics/categories',
    '/api/academics/colleges',
    '/api/academics/courses',
    '/api/academics/years',
    '/api/academics/branches',
    '/api/academics/semesters',
    '/api/academics/subjects'
  ];

  for (const endpoint of acadEndpoints) {
    const res = await request(`${BASE_URL}${endpoint}`);
    if (res.statusCode === 200 && (Array.isArray(res.json) || Array.isArray(res.json?.data) || res.json?.categories || res.json?.colleges || res.json?.branches)) {
      const count = Array.isArray(res.json) ? res.json.length : (res.json?.data?.length || Object.keys(res.json).length);
      record('PHASE 6', 'Academic Taxonomy API', `GET ${endpoint}`, 'PASS', `HTTP 200 OK, retrieved items: ${count}`);
    } else {
      record('PHASE 6', 'Academic Taxonomy API', `GET ${endpoint}`, 'FAIL', `HTTP ${res.statusCode}: ${res.body.slice(0, 100)}`, 'HIGH');
    }
  }

  // 8. Public Roadmaps API
  const roadmapRes = await request(`${BASE_URL}/api/roadmaps`);
  if (roadmapRes.statusCode === 200 && (Array.isArray(roadmapRes.json) || roadmapRes.json?.roadmaps)) {
    record('PHASE 14', 'Roadmaps API', 'GET /api/roadmaps', 'PASS', `HTTP 200 OK, roadmaps list available`);
  } else {
    record('PHASE 14', 'Roadmaps API', 'GET /api/roadmaps', 'FAIL', `HTTP ${roadmapRes.statusCode}: ${roadmapRes.body.slice(0, 100)}`, 'MEDIUM');
  }

  // 9. Public Certificates Verification API
  const certVerifyInvalid = await request(`${BASE_URL}/api/certificates/verify?code=INVALID_HASH_12345`);
  if (certVerifyInvalid.statusCode === 404 || (certVerifyInvalid.statusCode === 200 && certVerifyInvalid.json?.valid === false)) {
    record('PHASE 20', 'Certificate Public Verification', 'GET /api/certificates/verify?code=INVALID', 'PASS', `Rejected invalid code with HTTP ${certVerifyInvalid.statusCode}`);
  } else {
    record('PHASE 20', 'Certificate Public Verification', 'GET /api/certificates/verify?code=INVALID', 'FAIL', `Unexpected response: HTTP ${certVerifyInvalid.statusCode} - ${certVerifyInvalid.body}`, 'MEDIUM');
  }

  // 10. Security Checks - CSRF & Header validation
  const rootHeaders = await request(`${BASE_URL}/`);
  const headers = rootHeaders.headers || {};
  const hasHsts = Boolean(headers['strict-transport-security']);
  const hasXContentType = Boolean(headers['x-content-type-options']);
  const hasXFrame = Boolean(headers['x-frame-options']);
  record('PHASE 25', 'Security Headers', 'Inspect Helmet security headers', hasXContentType && hasXFrame ? 'PASS' : 'PARTIAL', `HSTS: ${hasHsts}, X-Content-Type: ${hasXContentType}, X-Frame-Options: ${hasXFrame}`);

  // 11. PWA Manifest & Service Worker Check
  const manifestRes = await request(`${BASE_URL}/manifest.json`);
  const swRes = await request(`${BASE_URL}/sw.js`);
  record('PHASE 27', 'PWA Manifest', 'GET /manifest.json', manifestRes.statusCode === 200 ? 'PASS' : 'NOT IMPLEMENTED', `Status ${manifestRes.statusCode}`);
  record('PHASE 27', 'PWA Service Worker', 'GET /sw.js', swRes.statusCode === 200 ? 'PASS' : 'NOT IMPLEMENTED', `Status ${swRes.statusCode}`);

  // Write JSON report
  const fs = require('fs');
  fs.writeFileSync('reports/live_audit_results.json', JSON.stringify(testResults, null, 2));
  console.log(`\nAudit completed. Total checks recorded: ${testResults.length}`);
}

runLiveAudit().catch(console.error);
