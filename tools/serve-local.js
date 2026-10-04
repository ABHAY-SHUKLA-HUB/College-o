const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BACKEND_TARGET = 'https://college-o.onrender.com';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf'
};

const ROUTE_MAP = {
  '/': 'index.html',
  '/index': 'index.html',
  '/login': 'login.html',
  '/signup': 'signup.html',
  '/features': 'features.html',
  '/notes': 'notes.html',
  '/pyqs': 'pyqs.html',
  '/quizzes': 'quizzes.html',
  '/mock-tests': 'mock-tests.html',
  '/ai-study': 'ai-study.html',
  '/career-roadmaps': 'career-roadmaps.html',
  '/community': 'community.html',
  '/pricing': 'pricing.html',
  '/about-us': 'about-us.html',
  '/contact-us': 'contact-us.html',
  '/help-center': 'help-center.html',
  '/privacy': 'privacy.html',
  '/terms': 'terms.html',
  '/dashboard': 'dashboard.html',
  '/profile': 'profile.html',
  '/settings': 'settings.html',
  '/notifications': 'notifications.html',
  '/admin-login': 'admin-login.html',
  '/admin/login': 'admin-login.html',
  '/admin-dashboard': 'admin-dashboard.html'
};

function proxyApiRequest(req, res) {
  const targetUrl = new URL(req.url, BACKEND_TARGET);
  
  const headers = { ...req.headers };
  headers.host = targetUrl.hostname;
  headers.origin = 'https://collegeo.in';
  headers.referer = 'https://collegeo.in/';

  const proxyReq = https.request({
    hostname: targetUrl.hostname,
    port: 443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: headers
  }, (proxyRes) => {
    // Forward headers
    const resHeaders = { ...proxyRes.headers };
    delete resHeaders['content-security-policy']; // Allow local dev
    res.writeHead(proxyRes.statusCode, resHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[API Proxy Error]', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Backend proxy error', details: err.message }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  // 1. Proxy API endpoints to backend
  if (urlPath.startsWith('/api/')) {
    return proxyApiRequest(req, res);
  }

  // 2. Resolve HTML routes
  let targetFile = ROUTE_MAP[urlPath];
  if (!targetFile) {
    if (urlPath.endsWith('.html') || path.extname(urlPath)) {
      targetFile = urlPath.replace(/^\//, '');
    } else {
      // Check if file.html exists
      const testHtml = urlPath.replace(/^\//, '') + '.html';
      if (fs.existsSync(path.join(process.cwd(), testHtml))) {
        targetFile = testHtml;
      }
    }
  }

  const filePath = path.join(process.cwd(), targetFile || 'index.html');

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1><p>The requested local file was not found.</p>');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('======================================================================');
  console.log('  🎓 COLLEGE OS — LOCAL DEVELOPMENT SERVER READY                      ');
  console.log(`  Local URL:   http://localhost:${PORT}/                              `);
  console.log(`  Login Page:  http://localhost:${PORT}/login                         `);
  console.log(`  Features:    http://localhost:${PORT}/features                      `);
  console.log(`  Notes:       http://localhost:${PORT}/notes                         `);
  console.log(`  PYQs:        http://localhost:${PORT}/pyqs                          `);
  console.log(`  Quizzes:     http://localhost:${PORT}/quizzes                       `);
  console.log(`  Mock Tests:  http://localhost:${PORT}/mock-tests                    `);
  console.log(`  API Target:  ${BACKEND_TARGET}                                       `);
  console.log('======================================================================\n');
});
