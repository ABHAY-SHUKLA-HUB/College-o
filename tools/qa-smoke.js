#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const REPORT_DIR = path.join(process.cwd(), 'reports');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = path.join(REPORT_DIR, `smoke-report-${timestamp}.json`);

const screenshotsDir = path.join(REPORT_DIR, `screenshots-${timestamp}`);
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || process.env.SMOKE_TEST_EMAIL || '';
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || process.env.SMOKE_TEST_PASSWORD || '';

async function run() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  const failures = [];
  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), location: msg.location() });
    }
  });

  page.on('response', async (res) => {
    try {
      const status = res.status();
      if (status >= 400) {
        failedRequests.push({ url: res.url(), status, statusText: res.statusText() });
      }
    } catch (e) { /* ignore */ }
  });

  async function safeGoto(url, opts = {}) {
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
      return res;
    } catch (err) {
      failures.push({ step: `goto ${url}`, error: String(err) });
      try { if (page && !page.isClosed()) await page.screenshot({ path: path.join(screenshotsDir, `goto-fail-${Date.now()}.png`) }); } catch(e){}
      return null;
    }
  }

  function markFail(step, message) {
    const m = { step, message };
    failures.push(m);
    console.error('FAIL:', step, message);
  }

  try {
    // 1. Open login page
    await safeGoto(`${BASE}/login`);
    await page.waitForSelector('body');

    // Check captcha question
    try {
      await page.waitForSelector('#loginCaptchaQuestion', { timeout: 5000 });
      const q = await page.$eval('#loginCaptchaQuestion', n => n.textContent.trim());
      if (!q || /loading/i.test(q)) {
        markFail('captcha-load', `Captcha question missing or loading: "${q}"`);
      }
      // Also check challenge content
      const challengeExists = await page.$eval('#loginCaptchaChallenge', el => el && (el.innerText || el.innerHTML).trim().length > 0).catch(() => false);
      if (!challengeExists) {
        markFail('captcha-challenge', 'Captcha challenge area is empty');
      }
    } catch (e) {
      markFail('captcha-wait', 'Captcha failed to render in time');
    }

    // If test credentials provided, attempt login (solve captcha math)
    if (TEST_USER_EMAIL && TEST_USER_PASSWORD) {
      try {
        await page.type('#loginEmail', TEST_USER_EMAIL, { delay: 20 });
        await page.type('#loginPassword', TEST_USER_PASSWORD, { delay: 20 });
        // Solve captcha if math question present
        const qText = await page.$eval('#loginCaptchaQuestion', el => el.textContent || '').catch(() => '');
        const match = qText.match(/(\d+)\s*\+\s*(\d+)/);
        if (match) {
          const a = Number(match[1]), b = Number(match[2]);
          const ans = String(a + b);
          await page.type('#loginCaptchaInput', ans, { delay: 10 });
        }
        await Promise.all([
          page.click('#loginSubmitBtn'),
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => null)
        ]);

        // Basic post-login check
        const url = page.url();
        if (!/dashboard|home|study/.test(url)) {
          // check visible nav or user menu
          const userMenu = await page.$('nav, .user-menu, #profile');
          if (!userMenu) markFail('login', `Login may have failed, landed at ${url}`);
        }
      } catch (err) {
        markFail('login-exception', String(err));
      }
    }

    // API health
    try {
      const health = await page.evaluate(async (base) => {
        const res = await fetch(base + '/api/health');
        return { ok: res.ok, status: res.status, text: await res.text() };
      }, BASE);
      if (!health.ok) markFail('api-health', `Health endpoint returned ${health.status}`);
    } catch (err) {
      markFail('api-health-ex', String(err));
    }

    // Check several clean routes
    const routes = ['/dashboard','/study','/mock-tests','/notes','/profile','/reset-password','/live-hub'];
    for (const r of routes) {
      const res = await safeGoto(`${BASE}${r}`);
      if (!res) continue;
      const status = res.status ? res.status() : 200;
      if (status >= 400) {
        markFail('route-load', `Route ${r} returned ${status}`);
      }
      // quick DOM check
      await page.waitForTimeout(400);
      const bodyText = await page.content();
      if (/not found|404/i.test(bodyText)) markFail('route-404', `Route ${r} appears to show 404 content`);
    }

    // Test forgot password API call (no email send verification)
    if (TEST_USER_EMAIL) {
      try {
        const forgot = await page.evaluate(async (base, email) => {
          const res = await fetch(base + '/api/auth/password/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
          return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
        }, BASE, TEST_USER_EMAIL);
        if (!forgot.ok) markFail('forgot-password', `Forgot password request failed: ${forgot.status}`);
      } catch (e) {
        markFail('forgot-ex', String(e));
      }
    }

    // Socket endpoint basic check (polling handshake)
    try {
      const socketProbe = await page.evaluate(async (base) => {
        try {
          const res = await fetch(base + '/socket.io/?EIO=4&transport=polling', { method: 'GET' });
          return { status: res.status, ok: res.ok };
        } catch (e) { return { error: String(e) }; }
      }, BASE);
      if (socketProbe.error) markFail('socket-probe', socketProbe.error);
      else if (!socketProbe.ok) markFail('socket-probe', `Socket probe returned ${socketProbe.status}`);
    } catch (e) {
      markFail('socket-ex', String(e));
    }

    // Mobile responsiveness: set viewport and check login page
    try {
      await page.setViewport({ width: 375, height: 812 });
      await safeGoto(`${BASE}/login`);
      await page.waitForSelector('body', { timeout: 5000 });
    } catch (e) {
      markFail('mobile', String(e));
    }

    // Logout if logged in
    try {
      await page.evaluate(async (base) => {
        await fetch(base + '/api/auth/logout', { method: 'POST' }).catch(() => null);
      }, BASE);
    } catch (e) { /* ignore */ }

    // Collect final errors
    const result = { timestamp, base: BASE, failures, consoleErrors, failedRequests };
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));

    if (failures.length) {
      // take screenshot for first failure
      try { if (page && !page.isClosed()) await page.screenshot({ path: path.join(screenshotsDir, 'failure-overview.png'), fullPage: true }); } catch(e){}
    }

    await browser.close();
    console.log('Smoke test complete. Report:', reportPath);
    if (failures.length) {
      console.error('Failures detected:', failures.length);
      process.exit(2);
    }
    process.exit(0);
  } catch (err) {
    console.error('Smoke run error:', err);
    try { if (page && !page.isClosed()) await page.screenshot({ path: path.join(screenshotsDir, `error-${Date.now()}.png`) }); } catch(e){}
    try { await browser.close(); } catch(e){}
    process.exit(3);
  }
}

run();
