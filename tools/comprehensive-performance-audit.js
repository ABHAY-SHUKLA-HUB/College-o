const puppeteer = require('puppeteer');
const https = require('https');
const fs = require('fs');
const path = require('path');

const LIVE_BASE = process.env.AUDIT_TARGET_URL || 'https://collegeo.in';
const ADMIN_EMAIL = 'abhayshukla639362@gmail.com';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'CollegeOS_Admin_2026@Secure';
const STUDENT_EMAIL = 'abhayshukla639362@gmail.com'; // Valid active account
const STUDENT_PASS = process.env.ADMIN_PASSWORD || 'CollegeOS_Admin_2026@Secure';

async function measureHttpApiLatency(urlPath, method = 'GET', headers = {}, body = null) {
  const timings = [];
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    await new Promise((resolve) => {
      const parsed = new URL(urlPath.startsWith('http') ? urlPath : `${LIVE_BASE}${urlPath}`);
      const reqHeaders = {
        'User-Agent': 'CollegeOS-Perf-Auditor/1.0',
        'Accept': 'application/json',
        ...headers
      };
      let postData = null;
      if (body) {
        postData = typeof body === 'object' ? JSON.stringify(body) : String(body);
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(postData);
      }
      const req = https.request({
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        timeout: 15000
      }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          timings.push(Date.now() - start);
          resolve();
        });
      });
      req.on('error', () => { timings.push(Date.now() - start); resolve(); });
      req.on('timeout', () => { req.destroy(); timings.push(Date.now() - start); resolve(); });
      if (postData) req.write(postData);
      req.end();
    });
  }
  // Return average of runs (excluding extreme outliers)
  timings.sort((a, b) => a - b);
  return timings[1] || timings[0] || 0; // Median
}

async function measurePagePerformance(url, options = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();
  if (options.viewport) {
    await page.setViewport(options.viewport);
  } else {
    await page.setViewport({ width: 1440, height: 900 });
  }

  const requests = [];
  const responses = [];
  const consoleErrors = [];
  let totalBytes = 0;
  let jsBytes = 0;
  let cssBytes = 0;
  let imgBytes = 0;
  let apiBytes = 0;
  const apiRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  page.on('request', (req) => {
    requests.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      time: Date.now()
    });
  });

  page.on('response', async (res) => {
    try {
      const headers = res.headers();
      const length = Number(headers['content-length'] || 0);
      const resType = res.request().resourceType();
      totalBytes += length;
      if (resType === 'script') jsBytes += length;
      else if (resType === 'stylesheet') cssBytes += length;
      else if (resType === 'image') imgBytes += length;
      else if (resType === 'fetch' || resType === 'xhr') {
        apiBytes += length;
        apiRequests.push({
          url: res.url(),
          status: res.status(),
          length
        });
      }
      responses.push({
        url: res.url(),
        status: res.status(),
        length,
        type: resType
      });
    } catch {}
  });

  // Track long tasks (>50ms)
  await page.evaluateOnNewDocument(() => {
    window.__longTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push({
            name: entry.name,
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {}
  });

  const startTime = Date.now();
  const navResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const dclTime = Date.now() - startTime;

  // Wait for network idle or settled load
  try {
    await page.waitForNetworkIdle({ timeout: 6000, idleTime: 500 }).catch(() => {});
  } catch {}

  const fullLoadTime = Date.now() - startTime;

  // Collect Web Vitals & Performance metrics
  const perfMetrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const paint = performance.getEntriesByType('paint');
    const fcpEntry = paint.find((p) => p.name === 'first-contentful-paint');

    let lcpValue = 0;
    try {
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      if (lcpEntries && lcpEntries.length > 0) {
        lcpValue = lcpEntries[lcpEntries.length - 1].startTime;
      }
    } catch {}

    const ttfb = nav.responseStart ? nav.responseStart - nav.requestStart : (nav.responseStart || 0);

    return {
      ttfb: Math.round(ttfb),
      fcp: Math.round(fcpEntry ? fcpEntry.startTime : (nav.domInteractive || 0)),
      lcp: Math.round(lcpValue || (fcpEntry ? fcpEntry.startTime : nav.domContentLoadedEventEnd || 0)),
      domInteractive: Math.round(nav.domInteractive || 0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      longTasks: window.__longTasks || []
    };
  });

  return {
    browser,
    page,
    status: navResponse ? navResponse.status() : 0,
    metrics: {
      loadDuration: fullLoadTime,
      domContentLoaded: dclTime,
      ...perfMetrics,
      totalRequests: requests.length,
      totalBytes,
      jsBytes,
      cssBytes,
      imgBytes,
      apiBytes,
      apiRequestsCount: apiRequests.length,
      longTasksCount: perfMetrics.longTasks.length,
      longTasksDuration: Math.round(perfMetrics.longTasks.reduce((sum, t) => sum + (t.duration || 0), 0)),
      consoleErrors
    },
    requests,
    responses,
    apiRequests
  };
}

async function auditStudentFlow(targetBase) {
  console.log(`\n======================================================`);
  console.log(`  AUDITING STUDENT FLOW ON ${targetBase}`);
  console.log(`======================================================`);

  const loginUrl = `${targetBase}/login`;
  console.log(`[1/3] Measuring /login load...`);
  const loginAudit = await measurePagePerformance(loginUrl);

  console.log(`  - Login Page TTFB: ${loginAudit.metrics.ttfb}ms`);
  console.log(`  - Login Page FCP: ${loginAudit.metrics.fcp}ms`);
  console.log(`  - Login Page LCP: ${loginAudit.metrics.lcp}ms`);
  console.log(`  - Login Page Total Load: ${loginAudit.metrics.loadDuration}ms`);
  console.log(`  - Login Page Requests: ${loginAudit.metrics.totalRequests}`);
  console.log(`  - Login Page JS Transferred: ${Math.round(loginAudit.metrics.jsBytes / 1024)} KB`);
  console.log(`  - Login Page Total Transferred: ${Math.round(loginAudit.metrics.totalBytes / 1024)} KB`);

  // Measure Student Login POST & Navigation
  console.log(`[2/3] Performing Student Login API & Dashboard Navigation...`);
  const page = loginAudit.page;

  let authApiStartTime = 0;
  let authApiDuration = 0;
  let authApiResponseStatus = 0;
  let authApiDuplicates = 0;

  page.on('request', (req) => {
    if (req.url().includes('/api/auth/login') && req.method() === 'POST') {
      authApiDuplicates++;
      if (!authApiStartTime) authApiStartTime = Date.now();
    }
  });

  page.on('response', (res) => {
    if (res.url().includes('/api/auth/login') && res.request().method() === 'POST') {
      authApiDuration = Date.now() - (authApiStartTime || Date.now());
      authApiResponseStatus = res.status();
    }
  });

  try {
    await page.waitForSelector('#loginEmail', { timeout: 4000 });
    await page.type('#loginEmail', STUDENT_EMAIL);
    await page.type('#loginPassword', STUDENT_PASS);

    const clickTime = Date.now();
    await page.click('#loginSubmitBtn');

    // Wait for redirect to /dashboard or /admin-dashboard
    let redirected = false;
    try {
      await page.waitForFunction(
        () => window.location.pathname.includes('dashboard') || window.location.href.includes('dashboard'),
        { timeout: 8000 }
      );
      redirected = true;
    } catch {
      redirected = false;
    }
    const redirectDuration = Date.now() - clickTime;

    // Check dashboard usable / interactive
    let dashboardUsableTime = 0;
    if (redirected) {
      const dashStart = Date.now();
      try {
        await page.waitForFunction(
          () => {
            const greeting = document.getElementById('dashboardGreeting') || document.querySelector('.dash-hero') || document.getElementById('kpiStudents');
            return Boolean(greeting);
          },
          { timeout: 8000 }
        );
        dashboardUsableTime = Date.now() - dashStart;
      } catch {
        dashboardUsableTime = Date.now() - dashStart;
      }
    }

    const totalFlowTime = Date.now() - clickTime;

    await loginAudit.browser.close();

    return {
      pageLoad: loginAudit.metrics.loadDuration,
      ttfb: loginAudit.metrics.ttfb,
      fcp: loginAudit.metrics.fcp,
      lcp: loginAudit.metrics.lcp,
      totalRequests: loginAudit.metrics.totalRequests,
      totalBytes: loginAudit.metrics.totalBytes,
      jsBytes: loginAudit.metrics.jsBytes,
      longTasks: loginAudit.metrics.longTasksCount,
      longTasksDuration: loginAudit.metrics.longTasksDuration,
      consoleErrors: loginAudit.metrics.consoleErrors,
      authApiDuration,
      authApiResponseStatus,
      authApiDuplicates,
      redirectDuration,
      dashboardUsableTime,
      totalFlowTime
    };
  } catch (err) {
    console.error('Student login execution error:', err.message);
    await loginAudit.browser.close();
    return {
      pageLoad: loginAudit.metrics.loadDuration,
      ttfb: loginAudit.metrics.ttfb,
      fcp: loginAudit.metrics.fcp,
      lcp: loginAudit.metrics.lcp,
      totalRequests: loginAudit.metrics.totalRequests,
      totalBytes: loginAudit.metrics.totalBytes,
      jsBytes: loginAudit.metrics.jsBytes,
      longTasks: loginAudit.metrics.longTasksCount,
      longTasksDuration: loginAudit.metrics.longTasksDuration,
      consoleErrors: loginAudit.metrics.consoleErrors,
      authApiDuration: 0,
      authApiResponseStatus: 0,
      authApiDuplicates: 0,
      redirectDuration: 0,
      dashboardUsableTime: 0,
      totalFlowTime: 0,
      error: err.message
    };
  }
}

async function auditAdminFlow(targetBase) {
  console.log(`\n======================================================`);
  console.log(`  AUDITING ADMIN FLOW ON ${targetBase}`);
  console.log(`======================================================`);

  const loginUrl = `${targetBase}/admin-login`;
  console.log(`[1/3] Measuring /admin-login load...`);
  const loginAudit = await measurePagePerformance(loginUrl);

  console.log(`  - Admin Login Page TTFB: ${loginAudit.metrics.ttfb}ms`);
  console.log(`  - Admin Login Page FCP: ${loginAudit.metrics.fcp}ms`);
  console.log(`  - Admin Login Page LCP: ${loginAudit.metrics.lcp}ms`);
  console.log(`  - Admin Login Page Total Load: ${loginAudit.metrics.loadDuration}ms`);
  console.log(`  - Admin Login Requests: ${loginAudit.metrics.totalRequests}`);
  console.log(`  - Admin Login JS Transferred: ${Math.round(loginAudit.metrics.jsBytes / 1024)} KB`);
  console.log(`  - Admin Login Total Transferred: ${Math.round(loginAudit.metrics.totalBytes / 1024)} KB`);

  // Measure Admin Login POST & Navigation
  console.log(`[2/3] Performing Admin Login API & Dashboard Navigation...`);
  const page = loginAudit.page;

  let authApiStartTime = 0;
  let authApiDuration = 0;
  let authApiResponseStatus = 0;
  let authApiDuplicates = 0;

  page.on('request', (req) => {
    if (req.url().includes('/api/admin/login') && req.method() === 'POST') {
      authApiDuplicates++;
      if (!authApiStartTime) authApiStartTime = Date.now();
    }
  });

  page.on('response', (res) => {
    if (res.url().includes('/api/admin/login') && res.request().method() === 'POST') {
      authApiDuration = Date.now() - (authApiStartTime || Date.now());
      authApiResponseStatus = res.status();
    }
  });

  try {
    await page.waitForSelector('#adminEmail', { timeout: 4000 });
    await page.type('#adminEmail', ADMIN_EMAIL);
    await page.type('#adminPassword', ADMIN_PASS);

    // Solve Math Captcha
    const captchaAnswer = await page.evaluate(() => {
      const state = window.__adminCaptchaState;
      if (state && state.answer) return state.answer;
      const qText = document.getElementById('adminCaptchaQuestion')?.textContent || '';
      const match = qText.match(/(\d+)\s*([\+\-])\s*(\d+)/);
      if (match) {
        const n1 = parseInt(match[1]);
        const op = match[2];
        const n2 = parseInt(match[3]);
        return String(op === '+' ? n1 + n2 : n1 - n2);
      }
      return '0';
    });

    if (captchaAnswer) {
      await page.type('#adminCaptchaInput', captchaAnswer);
    }

    const clickTime = Date.now();
    await page.click('#loginBtn');

    // Wait for redirect to admin dashboard
    let redirected = false;
    try {
      await page.waitForFunction(
        () => window.location.pathname.includes('admin-dashboard') || window.location.href.includes('admin-dashboard'),
        { timeout: 8000 }
      );
      redirected = true;
    } catch {
      redirected = false;
    }
    const redirectDuration = Date.now() - clickTime;

    // Check admin dashboard usable / interactive (KPIs loaded)
    let dashboardUsableTime = 0;
    if (redirected) {
      const dashStart = Date.now();
      try {
        await page.waitForFunction(
          () => {
            const kpi = document.getElementById('kpiStudents');
            return kpi && kpi.textContent && kpi.textContent !== '...' && kpi.textContent !== '';
          },
          { timeout: 10000 }
        );
        dashboardUsableTime = Date.now() - dashStart;
      } catch {
        dashboardUsableTime = Date.now() - dashStart;
      }
    }

    const totalFlowTime = Date.now() - clickTime;

    await loginAudit.browser.close();

    return {
      pageLoad: loginAudit.metrics.loadDuration,
      ttfb: loginAudit.metrics.ttfb,
      fcp: loginAudit.metrics.fcp,
      lcp: loginAudit.metrics.lcp,
      totalRequests: loginAudit.metrics.totalRequests,
      totalBytes: loginAudit.metrics.totalBytes,
      jsBytes: loginAudit.metrics.jsBytes,
      longTasks: loginAudit.metrics.longTasksCount,
      longTasksDuration: loginAudit.metrics.longTasksDuration,
      consoleErrors: loginAudit.metrics.consoleErrors,
      authApiDuration,
      authApiResponseStatus,
      authApiDuplicates,
      redirectDuration,
      dashboardUsableTime,
      totalFlowTime
    };
  } catch (err) {
    console.error('Admin login execution error:', err.message);
    await loginAudit.browser.close();
    return {
      pageLoad: loginAudit.metrics.loadDuration,
      ttfb: loginAudit.metrics.ttfb,
      fcp: loginAudit.metrics.fcp,
      lcp: loginAudit.metrics.lcp,
      totalRequests: loginAudit.metrics.totalRequests,
      totalBytes: loginAudit.metrics.totalBytes,
      jsBytes: loginAudit.metrics.jsBytes,
      longTasks: loginAudit.metrics.longTasksCount,
      longTasksDuration: loginAudit.metrics.longTasksDuration,
      consoleErrors: loginAudit.metrics.consoleErrors,
      authApiDuration: 0,
      authApiResponseStatus: 0,
      authApiDuplicates: 0,
      redirectDuration: 0,
      dashboardUsableTime: 0,
      totalFlowTime: 0,
      error: err.message
    };
  }
}

async function runFullAudit() {
  const target = process.argv[2] || LIVE_BASE;
  console.log(`Starting Full Performance Benchmark against: ${target}`);

  // Measure Student and Admin Flows
  const studentResult = await auditStudentFlow(target);
  const adminResult = await auditAdminFlow(target);

  // Measure Core APIs Latencies
  console.log(`\n======================================================`);
  console.log(`  MEASURING CORE API LATENCIES`);
  console.log(`======================================================`);

  // Authenticate admin to test admin APIs
  const adminAuthRes = await new Promise((resolve) => {
    const postData = JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, captchaToken: 'math-verified' });
    const req = https.request({
      hostname: new URL(target).hostname,
      port: 443,
      path: '/api/admin/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        resolve({ cookies, status: res.statusCode });
      });
    });
    req.write(postData);
    req.end();
  });

  const adminCookies = adminAuthRes.cookies;

  const apis = {
    adminLoginPost: await measureHttpApiLatency('/api/admin/login', 'POST', {}, { email: ADMIN_EMAIL, password: ADMIN_PASS, captchaToken: 'math-verified' }),
    adminDashboardGet: await measureHttpApiLatency('/api/admin/dashboard', 'GET', { Cookie: adminCookies }),
    adminTrendsGet: await measureHttpApiLatency('/api/admin/trends', 'GET', { Cookie: adminCookies }),
    adminStudentsGet: await measureHttpApiLatency('/api/admin/students', 'GET', { Cookie: adminCookies }),
    adminFeedbackGet: await measureHttpApiLatency('/api/admin/feedback', 'GET', { Cookie: adminCookies }),
    adminPaymentsGet: await measureHttpApiLatency('/api/admin/membership-payments', 'GET', { Cookie: adminCookies }),
    adminIntelligenceOverviewGet: await measureHttpApiLatency('/api/admin/intelligence/overview', 'GET', { Cookie: adminCookies }),
    authConfigGet: await measureHttpApiLatency('/api/auth/config', 'GET'),
    dashboardBootstrapGet: await measureHttpApiLatency('/api/dashboard/bootstrap', 'GET', { Cookie: adminCookies }),
    dashboardPersonalizedGet: await measureHttpApiLatency('/api/dashboard/personalized', 'GET', { Cookie: adminCookies }),
    academicsCategoriesGet: await measureHttpApiLatency('/api/academics/categories', 'GET')
  };

  console.log('Core API Latencies (Median of 3 runs):', apis);

  const report = {
    target,
    timestamp: new Date().toISOString(),
    student: studentResult,
    admin: adminResult,
    apis
  };

  const reportPath = path.join(__dirname, '..', 'reports', 'performance-baseline.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`\n======================================================`);
  console.log(`  BASELINE BENCHMARK COMPLETE`);
  console.log(`  Report saved to: ${reportPath}`);
  console.log(`======================================================\n`);
  console.log(JSON.stringify(report, null, 2));
}

runFullAudit().catch(console.error);
