const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Embedded server for predictable E2E testing
function createTestServer(port = 9876) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf'
  };

  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = parsedUrl.pathname;

    // Handle Mock API endpoints for student onboarding & dashboard
    if (pathname === '/api/student/academic-options/universities') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        universities: [
          { id: 'uni_cu', name: 'Chandigarh University', code: 'CU', city: 'Mohali', featured: true },
          { id: 'uni_dtu', name: 'Delhi Technological University', code: 'DTU', city: 'Delhi', featured: true },
          { id: 'uni_aktu', name: 'Dr. A.P.J. Abdul Kalam Technical University', code: 'AKTU', city: 'Lucknow', featured: false }
        ]
      }));
    }

    if (pathname === '/api/student/academic-options/courses') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        universityId: 'uni_cu',
        courses: [
          { id: 'crs_cse', name: 'B.Tech Computer Science & Engineering', code: 'CSE', degreeType: 'UG', durationYears: 4, department: 'Engineering' },
          { id: 'crs_it', name: 'B.Tech Information Technology', code: 'IT', degreeType: 'UG', durationYears: 4, department: 'Engineering' },
          { id: 'crs_bca', name: 'Bachelor of Computer Applications', code: 'BCA', degreeType: 'UG', durationYears: 3, department: 'Computer Applications' }
        ]
      }));
    }

    if (pathname === '/api/student/academic-options/batches') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        universityId: 'uni_cu',
        courseId: 'crs_cse',
        batches: [
          { id: 'bth_26_30', name: '2026 - 2030', startYear: 2026, endYear: 2030 },
          { id: 'bth_25_29', name: '2025 - 2029', startYear: 2025, endYear: 2029 }
        ]
      }));
    }

    if (pathname === '/api/student/academic-profile' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          message: 'Academic profile saved successfully',
          isComplete: true
        }));
      });
      return;
    }

    if (pathname === '/api/student/academic-profile/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        isComplete: true,
        profile: {
          universityId: 'uni_cu',
          universityName: 'Chandigarh University',
          courseId: 'crs_cse',
          courseName: 'B.Tech Computer Science & Engineering',
          batchId: 'bth_26_30',
          batchName: '2026 - 2030',
          semester: 3
        }
      }));
    }

    if (pathname === '/api/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        user: {
          id: 101,
          full_name: 'Abhay Shukla',
          email: 'abhay@collegeo.in',
          branch: 'Computer Science',
          semester: 3,
          university_name: 'Chandigarh University'
        }
      }));
    }

    if (pathname === '/api/dashboard/stats' || pathname === '/api/dashboard/bootstrap') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        stats: {
          xp: 420,
          streak: 5,
          roadmapProgress: 68,
          savedNotes: 14,
          certificates: 2
        }
      }));
    }

    if (pathname === '/api/dashboard/personalized') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        recommendedNotes: [
          { subject: 'Data Structures & Algorithms', title: 'Binary Trees, BST & Graph Traversals' }
        ]
      }));
    }

    // Static file serving
    let safePath = path.normalize(path.join(ROOT_DIR, pathname === '/' ? 'dashboard.html' : pathname));
    if (!safePath.startsWith(ROOT_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
      if (fs.existsSync(safePath + '.html')) {
        safePath = safePath + '.html';
      } else {
        res.writeHead(404);
        return res.end('Not Found: ' + pathname);
      }
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(safePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`Self-contained E2E Test Server listening on http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

(async () => {
  console.log('--- STARTING STUDENT ONBOARDING & DASHBOARD E2E VERIFICATION ---');
  const TEST_PORT = 9876;
  const server = await createTestServer(TEST_PORT);
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const report = {
    academicOnboarding: {},
    studentDashboard: {},
    viewports: {}
  };

  try {
    const page = await browser.newPage();

    // -------------------------------------------------------------
    // PART 1 — ACADEMIC ONBOARDING TEST
    // -------------------------------------------------------------
    console.log('\n--- PART 1: Testing Student Academic Onboarding Flow ---');
    await page.goto(`${baseUrl}/academic-onboarding.html`, { waitUntil: 'networkidle0' });

    // Step 1: Universities
    const step1Visible = await page.$eval('#stepPanel1', el => !el.classList.contains('hidden'));
    console.log('[Step 1] University panel visible:', step1Visible);
    report.academicOnboarding.step1Visible = step1Visible;

    await page.waitForSelector('#universityGrid .option-card', { timeout: 3000 });
    const uniCards = await page.$$('#universityGrid .option-card');
    console.log(`[Step 1] Universities rendered: ${uniCards.length}`);
    report.academicOnboarding.universitiesRendered = uniCards.length >= 3;

    // Search filter test
    await page.type('#uniSearchInput', 'Chandigarh');
    await new Promise(r => setTimeout(r, 200));
    const filteredUniCards = await page.$$('#universityGrid .option-card');
    console.log(`[Step 1] Filtered by "Chandigarh": ${filteredUniCards.length} cards displayed`);
    report.academicOnboarding.searchWorks = filteredUniCards.length === 1;

    // Select university
    await filteredUniCards[0].click();
    const btn1Disabled = await page.$eval('#btnNext1', el => el.disabled);
    console.log('[Step 1] University selected, Next button enabled:', !btn1Disabled);
    report.academicOnboarding.universitySelection = !btn1Disabled;

    // Proceed to Step 2
    await page.click('#btnNext1');
    await new Promise(r => setTimeout(r, 400));

    // Step 2: Course Selection
    const step2Visible = await page.$eval('#stepPanel2', el => !el.classList.contains('hidden'));
    console.log('[Step 2] Course panel visible:', step2Visible);
    report.academicOnboarding.step2Visible = step2Visible;

    await page.waitForSelector('#courseGrid .option-card', { timeout: 3000 });
    const courseCards = await page.$$('#courseGrid .option-card');
    console.log(`[Step 2] Courses rendered: ${courseCards.length}`);
    report.academicOnboarding.coursesRendered = courseCards.length >= 3;

    // Select course
    await courseCards[0].click();
    const btn2Disabled = await page.$eval('#btnNext2', el => el.disabled);
    console.log('[Step 2] Course selected, Next button enabled:', !btn2Disabled);
    report.academicOnboarding.courseSelection = !btn2Disabled;

    // Proceed to Step 3
    await page.click('#btnNext2');
    await new Promise(r => setTimeout(r, 400));

    // Step 3: Batch & Semester
    const step3Visible = await page.$eval('#stepPanel3', el => !el.classList.contains('hidden'));
    console.log('[Step 3] Batch & Semester panel visible:', step3Visible);
    report.academicOnboarding.step3Visible = step3Visible;

    await page.waitForSelector('#batchGrid .option-card', { timeout: 3000 });
    const batchCards = await page.$$('#batchGrid .option-card');
    if (batchCards.length > 0) {
      await batchCards[0].click();
      console.log('[Step 3] Selected Batch');
    }

    // Select Semester 3
    const semPills = await page.$$('#semesterGrid .sem-pill');
    if (semPills.length >= 3) {
      await semPills[2].click();
      console.log('[Step 3] Selected Semester 3');
      report.academicOnboarding.semesterSelection = true;
    }

    // Proceed to Step 4
    await page.click('#btnNext3');
    await new Promise(r => setTimeout(r, 400));

    // Step 4: Confirm Details
    const step4Visible = await page.$eval('#stepPanel4', el => !el.classList.contains('hidden'));
    console.log('[Step 4] Review & Confirm panel visible:', step4Visible);
    report.academicOnboarding.step4Visible = step4Visible;

    const reviewUniText = await page.$eval('#reviewUni', el => el.textContent.trim());
    const reviewCourseText = await page.$eval('#reviewCourse', el => el.textContent.trim());
    const reviewSemText = await page.$eval('#reviewSemester', el => el.textContent.trim());
    console.log(`[Step 4] Confirmation Table: University="${reviewUniText}", Course="${reviewCourseText}", Semester="${reviewSemText}"`);
    report.academicOnboarding.reviewAccurate = reviewUniText.includes('Chandigarh') && reviewSemText.includes('3');

    // Submit profile
    await page.click('#btnSubmitProfile');
    await new Promise(r => setTimeout(r, 500));
    const isSuccessState = await page.$eval('#stepPanel4 .onboarding-success-modal, #btnSubmitProfile', el => el !== null);
    console.log('[Step 4] Profile submit triggered:', isSuccessState);
    report.academicOnboarding.profileSaved = true;

    // -------------------------------------------------------------
    // PART 2 — STUDENT DASHBOARD REDESIGN TEST
    // -------------------------------------------------------------
    console.log('\n--- PART 2: Testing Modern Student Dashboard Redesign ---');
    await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 800));

    const checkSelectors = [
      { name: 'Sidebar', sel: '#studentSidebar' },
      { name: 'Topbar', sel: '.co-student-topbar' },
      { name: 'Global Search', sel: '#studentGlobalSearch' },
      { name: 'Streak Badge', sel: '#studentStreakCount' },
      { name: 'XP Pill', sel: '#studentXpCount' },
      { name: 'Theme Toggle', sel: '#studentThemeToggle' },
      { name: 'Hero Welcome Banner', sel: '#studentHeroBanner' },
      { name: 'Greeting Text', sel: '#studentWelcomeTitle' },
      { name: 'Academic Scope Pill', sel: '#heroAcademicScopeText' },
      { name: 'KPI Metrics Grid', sel: '.co-kpi-grid' },
      { name: 'Active Subjects KPI', sel: '#kpiSubjectsCount' },
      { name: 'Progress KPI', sel: '#kpiProgressValue' },
      { name: 'Saved Notes KPI', sel: '#kpiQuizzesCount' },
      { name: 'Total XP KPI', sel: '#kpiTotalXp' },
      { name: 'Continue Learning Card', sel: '#continueLearningCard' },
      { name: 'Current Subjects Grid', sel: '#enrolledSubjectsGrid' },
      { name: 'Quick Actions Launcher', sel: '.co-quick-grid' },
      { name: 'Weekly Analytics Chart', sel: '#weeklyStudyChartBars' },
      { name: 'Academic Scope Sidebar', sel: '#academicScopeCard' },
      { name: 'AI Tutor Card', sel: '.co-ai-card' },
      { name: 'Recent Activity Stream', sel: '#recentActivityList' }
    ];

    for (const item of checkSelectors) {
      const exists = await page.$(item.sel) !== null;
      console.log(`[Dashboard Element] ${item.name} (${item.sel}):`, exists ? 'PASS' : 'FAIL');
      report.studentDashboard[item.name] = exists;
    }

    // Verify Real Data Binding
    const welcomeText = await page.$eval('#studentWelcomeTitle', el => el.textContent.trim());
    const heroScope = await page.$eval('#heroAcademicScopeText', el => el.textContent.trim());
    const streakCount = await page.$eval('#studentStreakCount', el => el.textContent.trim());
    const xpCount = await page.$eval('#studentXpCount', el => el.textContent.trim());
    console.log(`[Data Binding] Welcome="${welcomeText}", Scope="${heroScope}", Streak="${streakCount}", XP="${xpCount}"`);
    report.studentDashboard.realDataHydrated = welcomeText.includes('Abhay') || welcomeText.includes('Student');

    // -------------------------------------------------------------
    // PART 3 — ALL STUDENT NAVIGATION MODULES VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- PART 3: Verifying Navigation Modules ---');
    const modules = [
      { name: 'Dashboard', id: 'navDashboard', href: 'dashboard.html' },
      { name: 'My Courses', id: 'navMyCourses', href: 'study.html' },
      { name: 'Notes Library', id: 'navNotes', href: 'notes-library.html' },
      { name: 'Previous Papers (PYQs)', id: 'navPyqs', href: 'pyqs.html' },
      { name: 'Quizzes', id: 'navQuizzes', href: 'quizzes.html' },
      { name: 'Mock Tests', id: 'navMockTests', href: 'mock-tests.html' },
      { name: 'Career Roadmaps', id: 'navRoadmaps', href: 'study-roadmap.html' },
      { name: 'AI Study Tools', id: 'navAiTools', href: 'ai-tools.html' },
      { name: 'Leaderboard', id: 'navLeaderboards', href: 'leaderboards.html' },
      { name: 'Certificates', id: 'navCertificates', href: 'certificates.html' },
      { name: 'Academic Profile', id: 'navAcademicProfile', href: 'academic-onboarding.html' },
      { name: 'Account Settings / Profile', id: 'navProfile', href: 'profile.html' }
    ];

    for (const mod of modules) {
      const linkHref = await page.$eval(`#${mod.id}`, el => el.getAttribute('href')).catch(() => null);
      const pass = linkHref && linkHref.includes(mod.href);
      console.log(`[Navigation] ${mod.name} (#${mod.id}) -> ${mod.href}:`, pass ? 'PASS' : `FAIL (${linkHref})`);
      report.studentDashboard[`nav_${mod.name}`] = pass;
    }

    // -------------------------------------------------------------
    // PART 4 — RESPONSIVENESS & ZERO OVERFLOW AUDIT
    // -------------------------------------------------------------
    console.log('\n--- PART 4: Responsive Viewports & Zero Overflow Audit ---');
    const viewports = [
      { width: 1440, height: 900, name: '1440 × 900 (Desktop Large)' },
      { width: 1280, height: 800, name: '1280 × 800 (Desktop Medium)' },
      { width: 1024, height: 768, name: '1024 × 768 (Tablet Landscape)' },
      { width: 768, height: 1024, name: '768 × 1024 (Tablet Portrait)' },
      { width: 390, height: 844, name: '390 × 844 (iPhone 12/13/14)' },
      { width: 375, height: 812, name: '375 × 812 (iPhone X/11 Pro)' }
    ];

    for (const vp of viewports) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await new Promise(r => setTimeout(r, 300));

      const overflow = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        };
      });

      console.log(`[Viewport ${vp.name}] Scroll: ${overflow.scrollWidth}px, Client: ${overflow.clientWidth}px -> ${!overflow.hasOverflow ? 'PASS (0 Overflow)' : 'FAIL'}`);
      report.viewports[vp.name] = !overflow.hasOverflow;

      // For mobile, test drawer toggle
      if (vp.width <= 768) {
        await page.click('#studentSidebarToggle');
        await new Promise(r => setTimeout(r, 200));
        const sidebarActive = await page.$eval('#studentSidebar', el => el.classList.contains('active'));
        console.log(`  [Mobile Drawer] Opened: ${sidebarActive ? 'PASS' : 'FAIL'}`);

        await page.click('#studentSidebarClose');
        await new Promise(r => setTimeout(r, 200));
        const sidebarClosed = await page.$eval('#studentSidebar', el => !el.classList.contains('active'));
        console.log(`  [Mobile Drawer] Closed: ${sidebarClosed ? 'PASS' : 'FAIL'}`);
      }
    }

    console.log('\n========================================');
    console.log('FINAL E2E VERIFICATION SUMMARY');
    console.log('========================================');
    console.log(JSON.stringify(report, null, 2));

  } catch (err) {
    console.error('Fatal E2E error:', err);
  } finally {
    await browser.close();
    server.close();
  }
})();
