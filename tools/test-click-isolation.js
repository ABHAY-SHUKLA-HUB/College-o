const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function createServer(port = 4567) {
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
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (pathname === '/api/auth/me' || pathname === '/api/admin/control/me/permissions') {
        return res.end(JSON.stringify({
          ok: true,
          authenticated: true,
          role: 'super_admin',
          permissions: ['*'],
          user: { id: 1, name: 'Admin', email: 'admin@collegeos.in', role: 'super_admin' }
        }));
      }
      return res.end(JSON.stringify({ ok: true, success: true, data: [], totals: {}, totals_today: 0, activeStudents: { active_students: 0 }, branchWise: [], quizAttempts: { total_attempts: 0 }, roadmapStats: { avg_completion: 0 } }));
    }

    let safePath = path.normalize(path.join(ROOT_DIR, pathname === '/' ? 'admin-dashboard.html' : pathname));
    if (!safePath.startsWith(ROOT_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
      if (fs.existsSync(safePath + '.html')) safePath = safePath + '.html';
      else {
        res.writeHead(404);
        return res.end('Not Found');
      }
    }

    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(safePath).pipe(res);
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const PORT = 4567;
  const server = await createServer(PORT);
  const baseUrl = `http://127.0.0.1:${PORT}`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('user', JSON.stringify({ id: 1, name: 'Super Admin', email: 'admin@collegeos.in', role: 'super_admin' }));
    localStorage.setItem('token', 'mock-token');
  });

  console.log('=== CLICK ISOLATION & NAVIGATION AUDIT ===\n');

  try {
    await page.goto(`${baseUrl}/admin-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1000));

    // Get all sidebar links
    const sidebarLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.co-admin-nav-link')).map((a, idx) => ({
        index: idx,
        text: a.querySelector('span')?.textContent?.trim() || a.textContent?.trim(),
        href: a.getAttribute('href'),
        target: a.dataset.tabTarget || ''
      }));
    });

    console.log(`Found ${sidebarLinks.length} sidebar navigation items:`);
    console.log(JSON.stringify(sidebarLinks, null, 2));

    for (const item of sidebarLinks) {
      console.log(`\nTesting click on [${item.text}] (href: ${item.href})...`);
      
      // Navigate to dashboard first to reset
      await page.goto(`${baseUrl}/admin-dashboard.html`, { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 400));

      const elemMetrics = await page.evaluate((targetText) => {
        const links = Array.from(document.querySelectorAll('.co-admin-nav-link'));
        const link = links.find(l => (l.querySelector('span')?.textContent?.trim() || l.textContent?.trim()) === targetText);
        if (!link) return { found: false };
        const rect = link.getBoundingClientRect();
        const style = window.getComputedStyle(link);
        const aside = document.querySelector('.co-admin-aside');
        const asideStyle = aside ? window.getComputedStyle(aside) : null;
        
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const elemAtPoint = document.elementFromPoint(centerX, centerY);

        return {
          found: true,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right },
          display: style.display,
          visibility: style.visibility,
          pointerEvents: style.pointerEvents,
          asideDisplay: asideStyle?.display,
          asideTransform: asideStyle?.transform,
          asideZIndex: asideStyle?.zIndex,
          elemAtPointTag: elemAtPoint?.tagName,
          elemAtPointClass: elemAtPoint?.className,
          isSelfOrChild: elemAtPoint === link || link.contains(elemAtPoint)
        };
      }, item.text);

      console.log(`  Element Debug Metrics:`, elemMetrics);

      // Scroll into view safely before clicking
      await page.evaluate((targetText) => {
        const links = Array.from(document.querySelectorAll('.co-admin-nav-link'));
        const link = links.find(l => (l.querySelector('span')?.textContent?.trim() || l.textContent?.trim()) === targetText);
        if (link) link.scrollIntoView({ block: 'center', inline: 'nearest' });
      }, item.text);

      await new Promise(r => setTimeout(r, 200));

      // Click via page.evaluate or mouse
      const clicked = await page.evaluate((targetText) => {
        const links = Array.from(document.querySelectorAll('.co-admin-nav-link'));
        const link = links.find(l => (l.querySelector('span')?.textContent?.trim() || l.textContent?.trim()) === targetText);
        if (!link) return false;
        link.click();
        return true;
      }, item.text);

      console.log(`  Click executed via DOM:`, clicked);
      await new Promise(r => setTimeout(r, 600));

      const afterUrl = page.url();
      const activeTabOrPage = await page.evaluate(() => {
        const activeTabs = Array.from(document.querySelectorAll('.co-admin-tab-content.active, .control-panel.active')).map(el => el.id);
        const activeLinks = Array.from(document.querySelectorAll('.co-admin-nav-link.active')).map(el => el.textContent.trim());
        return { activeTabs, activeLinks, title: document.title };
      });

      console.log(`  After click URL: ${afterUrl}`);
      console.log(`  Active UI state:`, activeTabOrPage);
    }

  } catch (err) {
    console.error('Audit Error:', err);
  } finally {
    await browser.close();
    server.close();
  }
})();
