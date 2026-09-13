const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\ABHAY\\.gemini\\antigravity-ide\\brain\\8f057513-80b6-4439-8204-5b0d763c13f6';

const ROUTE_TESTS = [
  { hash: '#students-management', targetId: 'panel-students', name: 'Student Management' },
  { hash: '#membership-management', targetId: 'panel-payments', name: 'Memberships & Payments' },
  { hash: '#analytics', targetId: 'panel-analytics', name: 'Analytics Dashboard' },
  { hash: '#roles-permissions', targetId: 'panel-roles', name: 'Roles & Permissions' },
  { hash: '#academic-structure', targetId: 'panel-academic-structure', name: 'Academic Structure' },
  { hash: '#content-governance', targetId: 'panel-content', name: 'Bulk Content' },
  { hash: '#system-settings', targetId: 'panel-settings', name: 'System Settings' },
  { hash: '#audit-logs', targetId: 'panel-audit', name: 'Audit Logs' },
  { hash: '#coding-challenges', targetId: 'panel-coding', name: 'Coding Governance' },
  { hash: '#live-sessions', targetId: 'panel-live-sessions', name: 'Live Sessions' },
  { hash: '#onboarding', targetId: 'panel-onboarding', name: 'Onboarding Config' },
  { hash: '#mock-tests', targetId: 'panel-mocktests', name: 'Mock Tests' },
  { hash: '#roadmaps', targetId: 'panel-roadmaps', name: 'Roadmaps' },
  { hash: '#notifications', targetId: 'panel-notify', name: 'Notifications' },
  { hash: '#moderation', targetId: 'panel-moderation', name: 'Forum & Moderation' },
  { hash: '#referrals', targetId: 'panel-referrals', name: 'Referrals' },
  { hash: '#experience', targetId: 'panel-experience', name: 'Experience Studio' },
  { hash: '#company', targetId: 'panel-company', name: 'Company & Support' }
];

async function runDomAssertions() {
  console.log('Starting Strict DOM Acceptance Assertions for Admin Control Routing...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  page.on('requestfailed', request => console.error('REQ FAILED:', request.url(), request.failure()?.errorText));

  // Load login page and authenticate admin session
  await page.goto('http://localhost:3000/admin-login.html', { waitUntil: 'networkidle2' });

  // Type credentials into the actual login form fields
  await page.type('#adminEmail', 'admin@collegeo.in');
  await page.type('#adminPassword', 'Admin@123456');

  // Solve CAPTCHA and submit login form via UI
  const captchaQuestion = await page.$eval('#adminCaptchaQuestion', el => el.textContent || '');
  console.log('Captcha question on page:', captchaQuestion);

  let answer = 'bypass';
  const match = captchaQuestion.match(/(\d+)\s*[\+\-\*]\s*(\d+)/);
  if (match) {
    const num1 = parseInt(match[1], 10);
    const num2 = parseInt(match[2], 10);
    if (captchaQuestion.includes('+')) answer = String(num1 + num2);
    else if (captchaQuestion.includes('-')) answer = String(num1 - num2);
    else if (captchaQuestion.includes('*')) answer = String(num1 * num2);
  }

  await page.type('#adminCaptchaInput', answer);

  const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await page.click('#loginBtn');
  await navPromise.catch(() => null);

  console.log('URL after form submit:', page.url());
  await new Promise(r => setTimeout(r, 500));

  const cookies = await page.cookies();
  console.log('Cookies after login:', JSON.stringify(cookies));

  // Explicitly ensure cookies are applied for localhost:3000
  if (cookies.length > 0) {
    await page.setCookie(...cookies);
  }

  // Navigate to admin-control.html
  await page.goto('http://localhost:3000/admin-control.html#students-management', { waitUntil: 'networkidle2' });
  console.log('URL after loading admin-control.html:', page.url());

  await page.setViewport({ width: 1440, height: 900 });

  let failures = 0;
  const results = [];

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
  page.on('requestfailed', request => console.error('REQ FAILED:', request.url(), request.failure()?.errorText));

  for (const route of ROUTE_TESTS) {
    await page.evaluate((h) => {
      window.location.hash = h;
      if (typeof activateAdminRoute === 'function') activateAdminRoute(h);
    }, route.hash);
    await new Promise(r => setTimeout(r, 400));

    const domState = await page.evaluate((expectedTargetId) => {
      const panels = Array.from(document.querySelectorAll('.control-panel'));
      
      const panelInfo = panels.map(p => {
        const rect = p.getBoundingClientRect();
        const style = window.getComputedStyle(p);
        const hasHidden = p.hasAttribute('hidden');
        const hasActive = p.classList.contains('active');
        const isVisible = !hasHidden && hasActive && style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0;
        return { id: p.id, hasHidden, hasActive, display: style.display, height: rect.height, isVisible };
      });

      const visiblePanels = panelInfo.filter(p => p.isVisible);
      const visibleIds = visiblePanels.map(p => p.id);
      const isTargetVisible = visibleIds.includes(expectedTargetId);

      return {
        currentUrl: window.location.href,
        totalPanelsCount: panels.length,
        visiblePanelsCount: visiblePanels.length,
        visibleIds,
        isTargetVisible,
        panelInfo
      };
    }, route.targetId);

    const isPass = domState.visiblePanelsCount === 1 && domState.isTargetVisible;
    if (!isPass) {
      failures++;
      console.log(`[✗ FAIL] Hash: ${route.hash} | Current URL: ${domState.currentUrl} | Visible Count: ${domState.visiblePanelsCount} | Visible IDs: ${domState.visibleIds.join(', ')}`);
      const targetPanelData = domState.panelInfo.find(p => p.id === route.targetId);
      console.log(`  Target panel '${route.targetId}' debug:`, targetPanelData || 'NOT FOUND IN DOM');
    } else {
      console.log(`[✓ PASS] Hash: ${route.hash} | Target '${route.targetId}' is ONLY visible panel.`);
    }

    results.push({
      route: route.name,
      hash: route.hash,
      expectedTargetId: route.targetId,
      visibleCount: domState.visiblePanelsCount,
      visibleIds: domState.visibleIds,
      status: isPass ? 'PASS' : 'FAIL'
    });
  }

  // Rapid switch test
  console.log('\nTesting rapid route switching between #students-management and #membership-management...');
  await page.goto('http://localhost:3000/admin-control.html#students-management', { waitUntil: 'networkidle2' });
  await page.goto('http://localhost:3000/admin-control.html#membership-management', { waitUntil: 'networkidle2' });
  await page.goto('http://localhost:3000/admin-control.html#students-management', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 600));

  const rapidState = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.control-panel'));
    const visiblePanels = panels.filter(p => {
      const rect = p.getBoundingClientRect();
      const style = window.getComputedStyle(p);
      return !p.hasAttribute('hidden') && p.classList.contains('active') && style.display !== 'none' && rect.height > 0;
    });
    return {
      count: visiblePanels.length,
      visibleId: visiblePanels[0] ? visiblePanels[0].id : null
    };
  });

  if (rapidState.count !== 1 || rapidState.visibleId !== 'panel-students') {
    console.error(`FAIL: Rapid switch left invalid DOM state! Count: ${rapidState.count}, Active: ${rapidState.visibleId}`);
    failures++;
  } else {
    console.log('✓ PASS: Rapid switch maintained exactly 1 active panel.');
  }

  await browser.close();

  const reportPath = path.join(ARTIFACT_DIR, 'dom_routing_test_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} DOM acceptance assertions failed!`);
    process.exit(1);
  } else {
    console.log('\nSUCCESS: All DOM acceptance assertions passed! Exactly 1 module visible per route.');
    process.exit(0);
  }
}

runDomAssertions().catch((err) => {
  console.error(err);
  process.exit(1);
});
