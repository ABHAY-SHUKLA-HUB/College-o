const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:\\Users\\ABHAY\\.gemini\\antigravity-ide\\brain\\8f057513-80b6-4439-8204-5b0d763c13f6';
const SCREENSHOT_DIR = path.join(ARTIFACT_DIR, 'qa-screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true }
];

const PAGES = [
  { slug: 'students_memberships', url: 'http://localhost:3000/admin-control.html#students-management' },
  { slug: 'student_contributions', url: 'http://localhost:3000/admin-academics.html#contributions' },
  { slug: 'certificates', url: 'http://localhost:3000/admin-certificates.html' },
  { slug: 'coding_governance', url: 'http://localhost:3000/admin-coding-challenges.html' },
  { slug: 'support_governance', url: 'http://localhost:3000/admin-support-governance.html' },
  { slug: 'campus_feed', url: 'http://localhost:3000/admin-campus-feed.html' },
  { slug: 'ai_tools_studio', url: 'http://localhost:3000/admin-ai-tools.html' },
  { slug: 'feature_toggles', url: 'http://localhost:3000/admin-control.html#system-settings' },
  { slug: 'audit_logs', url: 'http://localhost:3000/admin-control.html#audit-logs' }
];

async function runQA() {
  console.log('Starting Puppeteer Visual QA Sweep across 5 Viewports and 9 Modules...');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // 1. Establish session/login if needed
  try {
    await page.goto('http://localhost:3000/admin-login.html', { waitUntil: 'networkidle2', timeout: 10000 });
    // Fill credentials if present
    const emailInput = await page.$('input[name="email"], input[type="email"], #email');
    if (emailInput) {
      await page.type('input[name="email"], input[type="email"], #email', 'admin@collegeo.in');
      await page.type('input[name="password"], input[type="password"], #password', 'Admin@123456');
      await page.click('button[type="submit"], #loginBtn, .btn-primary');
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
    }
  } catch (err) {
    console.log('Login attempt note:', err.message);
  }

  const results = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n--- Auditing Viewport: ${vp.name} (${vp.width}x${vp.height}) ---`);
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.hasTouch
    });

    for (const pg of PAGES) {
      try {
        await page.goto(pg.url, { waitUntil: 'networkidle2', timeout: 15000 });
        await new Promise(r => setTimeout(r, 800)); // Allow dynamic tabs/render scripts to settle

        // Check horizontal scrollbar
        const hasHorizontalScroll = await page.evaluate(() => {
          return document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth;
        });

        // Capture screenshot
        const screenshotPath = path.join(SCREENSHOT_DIR, `${vp.name}_${pg.slug}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: false });

        results.push({
          viewport: vp.name,
          page: pg.slug,
          url: pg.url,
          hasHorizontalScroll,
          screenshotPath,
          status: 'SUCCESS'
        });

        console.log(`  ✓ [${vp.name}] ${pg.slug} captured | Horiz Scroll: ${hasHorizontalScroll ? 'YES (WARN)' : 'NO (OK)'}`);
      } catch (err) {
        console.error(`  ✗ [${vp.name}] ${pg.slug} error:`, err.message);
        results.push({
          viewport: vp.name,
          page: pg.slug,
          url: pg.url,
          error: err.message,
          status: 'ERROR'
        });
      }
    }
  }

  await browser.close();

  // Save QA summary report
  const reportPath = path.join(ARTIFACT_DIR, 'puppeteer_qa_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nVisual QA Sweep Complete! Results saved to ${reportPath}`);
}

runQA().catch(console.error);
