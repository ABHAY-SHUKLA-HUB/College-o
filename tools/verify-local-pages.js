const puppeteer = require('puppeteer');
const path = require('path');

async function verifyLocalPages() {
  console.log('Launching browser to test local server on http://localhost:3000...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const artifactDir = path.resolve(process.cwd(), '../../.gemini/antigravity-ide/brain/4709391f-ce8b-4ebb-87f1-80d7b26986e1');

  // 1. Redesigned Desktop Login Page
  const pageLogin = await browser.newPage();
  await pageLogin.setViewport({ width: 1440, height: 900 });
  await pageLogin.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });
  const loginScreenshotDesktop = path.join(artifactDir, 'login_redesign_desktop_local.png');
  await pageLogin.screenshot({ path: loginScreenshotDesktop, fullPage: false });
  console.log('Captured: Desktop Login ->', loginScreenshotDesktop);

  // 2. Redesigned Mobile Login Page
  const pageLoginMobile = await browser.newPage();
  await pageLoginMobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await pageLoginMobile.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });
  const loginScreenshotMobile = path.join(artifactDir, 'login_redesign_mobile_local.png');
  await pageLoginMobile.screenshot({ path: loginScreenshotMobile, fullPage: true });
  console.log('Captured: Mobile Login ->', loginScreenshotMobile);

  // 3. Homepage
  const pageHome = await browser.newPage();
  await pageHome.setViewport({ width: 1440, height: 900 });
  await pageHome.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  const homeScreenshot = path.join(artifactDir, 'homepage_local.png');
  await pageHome.screenshot({ path: homeScreenshot, fullPage: false });
  console.log('Captured: Homepage ->', homeScreenshot);

  // 4. Notes Page
  const pageNotes = await browser.newPage();
  await pageNotes.setViewport({ width: 1440, height: 900 });
  await pageNotes.goto('http://localhost:3000/notes', { waitUntil: 'networkidle2' });
  const notesScreenshot = path.join(artifactDir, 'notes_page_local.png');
  await pageNotes.screenshot({ path: notesScreenshot, fullPage: false });
  console.log('Captured: Notes Page ->', notesScreenshot);

  await browser.close();
  console.log('All local page verifications complete!');
}

verifyLocalPages().catch(console.error);
