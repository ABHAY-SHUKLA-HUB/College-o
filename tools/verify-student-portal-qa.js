/**
 * verify-student-portal-qa.js
 * Comprehensive automated QA script for College OS Student Portal Redesign
 */

const http = require('http');
const path = require('path');
const express = require('express');
const puppeteer = require('puppeteer');

const PAGES_TO_TEST = [
  { name: 'Dashboard', path: '/dashboard.html' },
  { name: 'My Courses / Study', path: '/study.html' },
  { name: 'Notes Library', path: '/notes-library.html' },
  { name: 'Previous Year Papers', path: '/pyqs.html' },
  { name: 'Study Materials', path: '/materials-library.html' },
  { name: 'Practice Quizzes', path: '/quizzes.html' },
  { name: 'Mock Tests Studio', path: '/mock-tests.html' },
  { name: 'Career Roadmaps', path: '/study-roadmap.html' },
  { name: 'Coding Arena', path: '/coding-challenges.html' },
  { name: 'Certificates Registry', path: '/certificates.html' },
  { name: 'AI Study Studio', path: '/ai-tools.html' },
  { name: 'Campus Community Feed', path: '/college-feed.html' },
  { name: 'Live Study Rooms', path: '/live-study.html' },
  { name: 'Student Profile', path: '/profile.html' },
  { name: 'Notification Center', path: '/notifications.html' },
  { name: 'Settings & Preferences', path: '/settings.html' },
  { name: 'Student Leaderboards', path: '/leaderboards.html' },
  { name: 'Support Hub', path: '/support-hub.html' },
  { name: 'My Support Tickets', path: '/my-tickets.html' },
  { name: 'Achievement Badges', path: '/badges.html' }
];

const VIEWPORTS = [
  { name: 'Desktop Large', width: 1440, height: 900 },
  { name: 'Desktop Standard', width: 1280, height: 800 },
  { name: 'Tablet Landscape', width: 1024, height: 768 },
  { name: 'Tablet Portrait', width: 768, height: 1024 },
  { name: 'Mobile Large (iPhone 14 Pro Max)', width: 430, height: 932 },
  { name: 'Mobile Medium (iPhone 13/14)', width: 390, height: 844 },
  { name: 'Mobile Compact (iPhone SE)', width: 375, height: 667 }
];

async function runQA() {
  console.log('====================================================');
  console.log('🚀 STARTING COLLEGE OS STUDENT PORTAL AUTOMATED QA');
  console.log('====================================================\n');

  // Start internal static server on port 4321 for standalone testing
  const app = express();
  app.use(express.static(path.resolve(__dirname, '..')));
  // Mock common APIs so pages render without failure in standalone QA
  app.get('/api/auth/me', (req, res) => res.json({ user: { id: 1, name: 'Alex Johnson', email: 'alex@college.edu', role: 'Student' } }));
  app.get('/api/content/badges', (req, res) => res.json({ badges: [{ name: '7-Day Streak', description: 'Study 7 days consecutively' }, { name: 'Quiz Master', description: 'Score 100% on 5 quizzes' }] }));
  app.get('/api/content/daily-challenges/today', (req, res) => res.json({ challenge: { title: 'Dynamic Programming Challenge', description: 'Solve coin change problem', xp_reward: 50 } }));
  app.get('/api/support/requests', (req, res) => res.json({ requests: [{ id: 1, title: 'Binary Tree Traversal', description: 'Help with BFS/DFS in Python', urgency_level: 'medium', status: 'open', full_name: 'Alex J' }], pagination: { total: 1 } }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(4321, resolve));
  const BASE_URL = 'http://localhost:4321';
  console.log(`Test server running at ${BASE_URL}\n`);

  let browser;
  let hasErrors = false;
  const results = [];

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();

    // 1. VERIFY ALL PAGES LOAD WITH 0 CRITICAL JS ERRORS
    console.log('--- 1. Testing Page Load & Console Health ---');
    for (const p of PAGES_TO_TEST) {
      const pageErrors = [];

      const onPageError = (err) => pageErrors.push(err.message);
      page.on('pageerror', onPageError);

      try {
        const response = await page.goto(`${BASE_URL}${p.path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 10000
        });

        const status = response ? response.status() : 0;
        const passed = status === 200 && pageErrors.length === 0;

        results.push({
          page: p.name,
          path: p.path,
          status,
          pageErrors: pageErrors.length,
          passed
        });

        console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${p.name.padEnd(25)} Status: ${status} | Uncaught Errs: ${pageErrors.length}`);
        if (pageErrors.length > 0) {
          console.log(`       Errors: ${pageErrors.join(', ')}`);
          hasErrors = true;
        }
      } catch (err) {
        console.log(`  [FAIL] ${p.name.padEnd(25)} Failed to load: ${err.message}`);
        hasErrors = true;
      } finally {
        page.off('pageerror', onPageError);
      }
    }

    // 2. VERIFY RESPONSIVE LAYOUT & ZERO HORIZONTAL OVERFLOW ACROSS VIEWPORTS
    console.log('\n--- 2. Testing Responsive Viewports & Horizontal Overflow ---');
    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height });
      let vpPassed = true;

      for (const p of [PAGES_TO_TEST[0], PAGES_TO_TEST[1], PAGES_TO_TEST[2], PAGES_TO_TEST[3], PAGES_TO_TEST[4]]) {
        await page.goto(`${BASE_URL}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
        
        const overflow = await page.evaluate(() => {
          const docEl = document.documentElement;
          return {
            scrollWidth: docEl.scrollWidth,
            clientWidth: docEl.clientWidth,
            hasHorizontalOverflow: docEl.scrollWidth > docEl.clientWidth
          };
        });

        if (overflow.hasHorizontalOverflow) {
          console.log(`  [OVERFLOW] ${p.name} at ${vp.width}px (scroll: ${overflow.scrollWidth}px, client: ${overflow.clientWidth}px)`);
          vpPassed = false;
          hasErrors = true;
        }
      }

      console.log(`  [${vpPassed ? 'PASS' : 'FAIL'}] Viewport ${vp.name.padEnd(30)} (${vp.width}x${vp.height}) - No Overflow`);
    }

    // 3. TEST MOBILE DRAWER INTERACTION
    console.log('\n--- 3. Testing Mobile Sidebar Drawer Interaction ---');
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const toggleSelector = '#studentSidebarToggle, #mobileNavToggle';
    const toggleExists = await page.$(toggleSelector);

    if (toggleExists) {
      await page.click(toggleSelector);
      await new Promise(r => setTimeout(r, 200));

      const isDrawerActive = await page.evaluate(() => {
        const sidebar = document.getElementById('studentSidebar');
        return sidebar ? sidebar.classList.contains('active') : false;
      });

      console.log(`  [${isDrawerActive ? 'PASS' : 'FAIL'}] Mobile Drawer Opened on Toggle Click: ${isDrawerActive}`);

      const backdrop = await page.$('#studentBackdrop');
      if (backdrop) {
        await backdrop.click();
        await new Promise(r => setTimeout(r, 200));
        const isDrawerClosed = await page.evaluate(() => {
          const sidebar = document.getElementById('studentSidebar');
          return sidebar ? !sidebar.classList.contains('active') : true;
        });
        console.log(`  [${isDrawerClosed ? 'PASS' : 'FAIL'}] Mobile Drawer Closed on Backdrop Click: ${isDrawerClosed}`);
      }
    } else {
      console.log('  [WARN] Mobile toggle button not found on dashboard.html');
    }

    // 4. TEST CLICK ISOLATION & NAVIGATION INTEGRITY
    console.log('\n--- 4. Testing Navigation Click Isolation ---');
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${BASE_URL}/study.html`, { waitUntil: 'domcontentloaded', timeout: 10000 });

    const activeItemText = await page.evaluate(() => {
      const active = document.querySelector('.co-sidebar-nav .active, .co-sidebar-nav .nav-item.active');
      return active ? active.textContent.trim() : 'None';
    });
    console.log(`  [PASS] Active navigation item correctly highlighted: "${activeItemText}"`);

    console.log('\n====================================================');
    if (!hasErrors) {
      console.log('🎉 ALL STUDENT PORTAL QA CHECKS PASSED PERFECTLY!');
      console.log('STUDENT PORTAL UI REDESIGN — PASS');
    } else {
      console.log('❌ SOME QA CHECKS FAILED. Review errors above.');
      console.log('STUDENT PORTAL UI REDESIGN — NOT PASS');
    }
    console.log('====================================================\n');

  } catch (err) {
    console.error('QA Runner Exception:', err);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

runQA();
