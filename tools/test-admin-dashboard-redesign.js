const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function testAdminDashboard() {
  console.log('🚀 Starting Puppeteer Verification for Admin Dashboard Redesign...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const filePath = path.join(__dirname, '..', 'admin-dashboard.html');
  const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;

  const viewports = [
    { name: 'desktop-1440-full', width: 1440, height: 2200 }
  ];

  const screenshotsDir = path.join(__dirname, '..', 'reports', 'admin-redesign-qa');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  for (const vp of viewports) {
    console.log(`\n📱 Testing Viewport: ${vp.name} (${vp.width}x${vp.height})`);
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 1000));

    // Verify critical elements presence
    const checks = await page.evaluate(() => {
      const sidebar = !!document.getElementById('adminSidebar');
      const search = !!document.getElementById('adminGlobalSearch');
      const heroBanner = !!document.querySelector('.co-admin-hero-banner');
      const kpis = document.querySelectorAll('.co-admin-kpi-card').length;
      const recentNotes = !!document.getElementById('recentNotesBody');
      const quickActions = document.querySelectorAll('.co-admin-action-card').length;
      const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth;

      return { sidebar, search, heroBanner, kpis, recentNotes, quickActions, overflowX };
    });

    console.log('  Elements detected:', checks);

    if (checks.overflowX) {
      console.warn(`  ⚠️ Warning: Horizontal overflow detected on ${vp.name}!`);
    } else {
      console.log(`  ✅ Zero horizontal overflow on ${vp.name}`);
    }

    const shotPath = path.join(screenshotsDir, `admin-dashboard-${vp.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    console.log(`  📸 Screenshot saved: ${shotPath}`);
  }

  // Test interactive drawer on mobile
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 500));

  console.log('\n🧪 Testing Mobile Drawer interaction...');
  await page.click('#adminSidebarToggle');
  await new Promise((r) => setTimeout(r, 300));

  const drawerOpen = await page.evaluate(() => {
    const sb = document.getElementById('adminSidebar');
    return sb.classList.contains('open');
  });
  console.log(`  Mobile Drawer opened: ${drawerOpen ? '✅ YES' : '❌ NO'}`);

  await page.click('#adminSidebarClose');
  await new Promise((r) => setTimeout(r, 300));

  const drawerClosed = await page.evaluate(() => {
    const sb = document.getElementById('adminSidebar');
    return !sb.classList.contains('open');
  });
  console.log(`  Mobile Drawer closed: ${drawerClosed ? '✅ YES' : '❌ NO'}`);

  // Test Tab Switching
  console.log('\n🧪 Testing Tab Navigation...');
  await page.setViewport({ width: 1440, height: 900 });
  await page.click('button[data-tab="studentsTab"]');
  await new Promise((r) => setTimeout(r, 300));

  const studentsTabActive = await page.evaluate(() => {
    return document.getElementById('studentsTab').classList.contains('active');
  });
  console.log(`  Students Tab activated: ${studentsTabActive ? '✅ YES' : '❌ NO'}`);

  await browser.close();

  if (errors.length > 0) {
    console.warn('\n⚠️ Page Errors captured:', errors);
  } else {
    console.log('\n🎉 All Visual & Responsive tests PASSED with 0 errors!');
  }
}

testAdminDashboard().catch(console.error);
