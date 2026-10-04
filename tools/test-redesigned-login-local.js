const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// 1. Create a lightweight local static server to serve the workspace
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '/login') reqPath = '/login.html';
  
  const filePath = path.join(process.cwd(), reqPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

async function runVisualTest() {
  await new Promise(resolve => server.listen(4567, '127.0.0.1', resolve));
  console.log('Local test server running on http://127.0.0.1:4567');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const artifactDir = path.resolve(process.cwd(), '../../.gemini/antigravity-ide/brain/4709391f-ce8b-4ebb-87f1-80d7b26986e1');

  // TEST 1: Desktop 1440x900
  console.log('Testing Desktop 1440x900...');
  const pageDesktop = await browser.newPage();
  await pageDesktop.setViewport({ width: 1440, height: 900 });
  await pageDesktop.goto('http://127.0.0.1:4567/login.html', { waitUntil: 'networkidle2' });

  const desktopScreenshot = path.join(artifactDir, 'login_redesign_desktop_1440.png');
  await pageDesktop.screenshot({ path: desktopScreenshot, fullPage: false });
  console.log('Desktop Screenshot saved:', desktopScreenshot);

  // Test Email tab vs OTP tab switching
  console.log('Testing OTP tab switch...');
  await pageDesktop.click('button[data-method="otp"]');
  await new Promise(r => setTimeout(r, 400));
  const otpScreenshot = path.join(artifactDir, 'login_redesign_otp_tab.png');
  await pageDesktop.screenshot({ path: otpScreenshot, fullPage: false });
  console.log('OTP Tab Screenshot saved:', otpScreenshot);

  // Switch back to Email tab
  await pageDesktop.click('button[data-method="email"]');
  await new Promise(r => setTimeout(r, 300));

  // Test password toggle
  console.log('Testing password show/hide toggle...');
  await pageDesktop.type('#loginPassword', 'SecretPass123!');
  await pageDesktop.click('#toggleLoginPassword');
  const passType = await pageDesktop.$eval('#loginPassword', el => el.type);
  console.log('Password input type after toggle:', passType);

  // TEST 2: Laptop 1280x800
  console.log('Testing Laptop 1280x800...');
  await pageDesktop.setViewport({ width: 1280, height: 800 });
  const laptopScreenshot = path.join(artifactDir, 'login_redesign_laptop_1280.png');
  await pageDesktop.screenshot({ path: laptopScreenshot, fullPage: false });
  console.log('Laptop Screenshot saved:', laptopScreenshot);

  // TEST 3: Mobile 390x844 (iPhone 14)
  console.log('Testing Mobile 390x844...');
  const pageMobile = await browser.newPage();
  await pageMobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await pageMobile.goto('http://127.0.0.1:4567/login.html', { waitUntil: 'networkidle2' });

  const mobileScreenshot = path.join(artifactDir, 'login_redesign_mobile_390.png');
  await pageMobile.screenshot({ path: mobileScreenshot, fullPage: true });
  console.log('Mobile Screenshot saved:', mobileScreenshot);

  // TEST 4: Small Mobile 375x812
  console.log('Testing Small Mobile 375x812...');
  await pageMobile.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
  const smallMobileScreenshot = path.join(artifactDir, 'login_redesign_mobile_375.png');
  await pageMobile.screenshot({ path: smallMobileScreenshot, fullPage: true });
  console.log('Small Mobile Screenshot saved:', smallMobileScreenshot);

  await browser.close();
  server.close();
  console.log('Visual tests completed successfully!');
}

runVisualTest().catch(err => {
  console.error(err);
  server.close();
});
