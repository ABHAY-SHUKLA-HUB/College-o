const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const pages = [
  '/', '/features', '/notes', '/pyqs', '/quizzes', '/mock-tests',
  '/ai-study', '/career-roadmaps', '/community', '/live-study',
  '/certificates', '/pricing', '/about-us', '/help-center', '/contact-us'
];

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  if (!path.extname(reqPath)) reqPath += '.html';
  const filePath = path.join(__dirname, '..', reqPath);
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    const ct = ext === '.html' ? 'text/html' : (ext === '.css' ? 'text/css' : (ext === '.js' ? 'application/javascript' : 'text/plain'));
    res.writeHead(200, { 'Content-Type': ct });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(3345, async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  for (const p of pages) {
    await page.setViewport({ width: 375, height: 812 });
    await page.goto('http://localhost:3345' + p, { waitUntil: 'networkidle2' });
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`Page: ${p.padEnd(18)} | Mobile Overflow (375px): ${hasOverflow ? 'YES' : 'NO'}`);
  }
  
  await browser.close();
  server.close();
});
