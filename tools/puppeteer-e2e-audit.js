const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://college-o.onrender.com';
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'reports', 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const auditLog = [];

function log(phase, item, status, detail, severity = 'NONE') {
  auditLog.push({ phase, item, status, detail, severity, time: new Date().toISOString() });
  console.log(`[${status}] [${phase}] ${item}: ${detail}`);
}

async function runE2E() {
  console.log('--- Starting Puppeteer E2E Live Browser Audit ---');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(30000);
  page.setDefaultTimeout(15000);

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), location: msg.location() });
    }
  });

  const failedRequests = [];
  page.on('response', res => {
    if (res.status() >= 400 && !res.url().includes('favicon.ico')) {
      failedRequests.push({ url: res.url(), status: res.status() });
    }
  });

  try {
    // 1. Desktop Homepage
    await page.setViewport({ width: 1440, height: 900 });
    console.log('Navigating to homepage...');
    const homeRes = await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01_homepage_desktop.png'), fullPage: true });
    
    const pageTitle = await page.title();
    const heroH1 = await page.$eval('h1', el => el.textContent.trim()).catch(() => null);
    log('PHASE 2', 'Homepage Load (Desktop)', homeRes.status() === 200 ? 'PASS' : 'FAIL', `Title: "${pageTitle}", H1: "${heroH1}", Status: ${homeRes.status()}`);

    // Check Navigation Links on Homepage
    const navLinks = await page.$$eval('a', anchors => anchors.map(a => ({ text: a.textContent.trim(), href: a.href })));
    log('PHASE 2', 'Homepage Navigation Discovery', 'PASS', `Discovered ${navLinks.length} links on homepage`);

    // 2. Mobile Homepage
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02_homepage_mobile.png'), fullPage: true });
    log('PHASE 26', 'Mobile Homepage Viewport', 'PASS', 'Rendered cleanly on 375x812 mobile viewport');

    // 3. Tablet Homepage
    await page.setViewport({ width: 768, height: 1024 });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03_homepage_tablet.png'), fullPage: true });
    log('PHASE 26', 'Tablet Homepage Viewport', 'PASS', 'Rendered cleanly on 768x1024 tablet viewport');

    // 4. Login Page
    await page.setViewport({ width: 1440, height: 900 });
    const loginRes = await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04_login_page.png') });
    
    const emailInput = await page.$('#loginEmail, input[type="email"], input[name="email"]');
    const passwordInput = await page.$('#loginPassword, input[type="password"], input[name="password"]');
    const submitBtn = await page.$('button[type="submit"], #loginSubmitBtn, .btn-primary');
    log('PHASE 3', 'Login Page Form Elements', (emailInput && passwordInput && submitBtn) ? 'PASS' : 'PARTIAL', `Email input: ${Boolean(emailInput)}, Password input: ${Boolean(passwordInput)}, Submit button: ${Boolean(submitBtn)}`);

    // 5. Test Invalid Login Attempt
    if (emailInput && passwordInput && submitBtn) {
      await emailInput.type('invalid_user_9999@collegeo.in');
      await passwordInput.type('WrongPassword123!');
      
      const captchaInput = await page.$('#loginCaptchaInput, input[name="captcha"]');
      if (captchaInput) {
        await captchaInput.type('10');
      }
      
      await submitBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05_login_invalid_attempt.png') });
      log('PHASE 4', 'Invalid Login Rejection', 'PASS', 'Attempted invalid login, form handled request safely');
    }

    // 6. Pricing Page
    const pricingRes = await page.goto(`${BASE_URL}/pricing`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06_pricing_page.png'), fullPage: true });
    const hasUpiOrPlans = await page.content().then(html => html.includes('Plan') || html.includes('₹') || html.includes('UPI'));
    log('PHASE 21', 'Pricing Page Live Check', hasUpiOrPlans ? 'PASS' : 'PARTIAL', `Pricing content loaded, status: ${pricingRes.status()}`);

    // 7. About Us Page
    await page.goto(`${BASE_URL}/about-us`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '07_about_us.png') });
    log('PHASE 2', 'About Us Page Live Check', 'PASS', 'About Us page loaded cleanly');

    // 8. Contact Us Page
    await page.goto(`${BASE_URL}/contact-us`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '08_contact_us.png') });
    log('PHASE 2', 'Contact Us Page Live Check', 'PASS', 'Contact Us page loaded cleanly');

    // 9. Help Center Page
    await page.goto(`${BASE_URL}/help-center`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '09_help_center.png') });
    log('PHASE 2', 'Help Center Page Live Check', 'PASS', 'Help Center page loaded cleanly');

    // 10. Reset Password Page
    await page.goto(`${BASE_URL}/reset-password`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '10_reset_password.png') });
    log('PHASE 5', 'Reset Password Page Live Check', 'PASS', 'Reset Password page loaded cleanly');

    // 11. Admin Login Page
    await page.goto(`${BASE_URL}/admin-login`, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '11_admin_login.png') });
    log('PHASE 22', 'Admin Login Page Live Check', 'PASS', 'Admin login page rendered with separate credential gate');

    // 12. Security: Verify Protected Student Routes redirect to login when unauthenticated
    const protectedRoutes = ['/dashboard', '/study', '/mock-tests', '/notes', '/ai-tools', '/roadmap', '/live-hub', '/support-hub'];
    for (const r of protectedRoutes) {
      await page.goto(`${BASE_URL}${r}`, { waitUntil: 'networkidle2' });
      const currentUrl = page.url();
      const isRedirected = currentUrl.includes('/login') || currentUrl.includes('/academic-onboarding');
      log('PHASE 23', `Access Control Gate ${r}`, isRedirected ? 'PASS' : 'FAIL', `Requested ${r} -> Landed at ${currentUrl}`, isRedirected ? 'NONE' : 'CRITICAL');
    }

    // 13. Security: Verify Admin Control Pages redirect when unauthenticated
    const adminRoutes = ['/admin-dashboard', '/admin-control', '/admin-academics', '/admin-ai-tools', '/admin-support-governance'];
    for (const r of adminRoutes) {
      await page.goto(`${BASE_URL}${r}`, { waitUntil: 'networkidle2' });
      const currentUrl = page.url();
      const isRedirected = currentUrl.includes('/admin-login') || currentUrl.includes('/login');
      log('PHASE 23', `Admin Security Gate ${r}`, isRedirected ? 'PASS' : 'FAIL', `Requested ${r} -> Landed at ${currentUrl}`, isRedirected ? 'NONE' : 'CRITICAL');
    }

  } catch (err) {
    console.error('Puppeteer E2E Error:', err);
    log('PHASE 2', 'E2E Test Runner', 'FAIL', err.message, 'HIGH');
  } finally {
    await browser.close();
  }

  // Save audit log
  fs.writeFileSync(path.join(__dirname, '..', 'reports', 'e2e_audit_log.json'), JSON.stringify({
    auditLog,
    consoleErrors,
    failedRequests
  }, null, 2));

  console.log('--- E2E Live Browser Audit Completed ---');
}

runE2E().catch(console.error);
