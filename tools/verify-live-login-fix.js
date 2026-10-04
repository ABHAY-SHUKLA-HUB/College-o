const https = require('https');
const puppeteer = require('puppeteer');

const LIVE_DOMAIN = 'https://collegeo.in';

function request(urlPath, method = 'GET', headers = {}, body = null) {
  return new Promise((resolve) => {
    const fullUrl = urlPath.startsWith('http') ? urlPath : `${LIVE_DOMAIN}${urlPath}`;
    const parsed = new URL(fullUrl);

    const reqHeaders = {
      'User-Agent': 'CollegeOS-Live-Login-Auditor/1.0',
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

async function verifyLive() {
  console.log('======================================================================');
  console.log('  COLLEGE OS — LIVE PRODUCTION LOGIN & 429 FIX VERIFICATION           ');
  console.log('  Target: https://collegeo.in | Date: 2026-10-03                     ');
  console.log('======================================================================\n');

  // 1. Health check
  console.log('--- [TEST 1] API HEALTH CHECK ---');
  const healthRes = await request('/api/health');
  console.log(`  /api/health -> HTTP ${healthRes.status} (Status: ${healthRes.json?.status || 'OK'})`);

  // 2. Auth probe with invalid password (must return 401, NOT 429)
  console.log('\n--- [TEST 2] STUDENT LOGIN PROBE (WRONG PASSWORD) ---');
  const probeRes = await request('/api/auth/login', 'POST', {}, {
    email: 'verification_student_qa@collegeo.in',
    password: 'IncorrectPassword123!',
    captchaToken: 'math-verified'
  });
  console.log(`  POST /api/auth/login -> HTTP ${probeRes.status}`);
  console.log(`  Response Error: "${probeRes.json?.error || probeRes.json?.message || probeRes.body}"`);
  console.log(`  X-RateLimit-Limit: ${probeRes.headers['x-ratelimit-limit'] || 'N/A'}`);
  console.log(`  X-RateLimit-Remaining: ${probeRes.headers['x-ratelimit-remaining'] || 'N/A'}`);
  const wrongPassOk = probeRes.status === 401 && probeRes.json?.error === 'Invalid email or password';
  console.log(`  Wrong password returns proper 401 auth error: ${wrongPassOk ? 'PASS' : 'FAIL'}`);

  // 3. Admin login verification
  console.log('\n--- [TEST 3] ADMIN LOGIN VERIFICATION ---');
  const adminRes = await request('/api/admin/login', 'POST', {}, {
    email: 'abhayshukla639362@gmail.com',
    password: process.env.ADMIN_PASSWORD || 'CollegeOS_Admin_2026@Secure',
    captchaToken: 'math-verified'
  });
  const adminOk = adminRes.status === 200 && Boolean(adminRes.json?.user);
  console.log(`  POST /api/admin/login -> HTTP ${adminRes.status} (User: ${adminRes.json?.user?.email || 'N/A'})`);
  console.log(`  Admin Login: ${adminOk ? 'PASS' : 'FAIL'}`);

  // 4. Puppeteer Live Browser UI Check
  console.log('\n--- [TEST 4] PUPPETEER BROWSER UI VERIFICATION ---');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(`${LIVE_DOMAIN}/login`, { waitUntil: 'networkidle2' });
  const title = await page.title();
  const content = await page.content();
  console.log(`  Page Title: "${title}"`);
  const hasLoginForm = content.includes('loginPassword') || content.includes('Sign In');
  console.log(`  Login Form Rendered: ${hasLoginForm ? 'PASS' : 'FAIL'}`);

  await browser.close();

  console.log('\n======================================================================');
  console.log(`  VERIFICATION RESULT: ${wrongPassOk && adminOk && hasLoginForm ? '🟢 ALL PASS' : '🟠 NEEDS REVIEW'}`);
  console.log('======================================================================\n');
}

verifyLive().catch(console.error);
