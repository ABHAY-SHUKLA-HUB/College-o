const puppeteer = require('puppeteer');
const path = require('path');

async function captureLoginScreenshot() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to https://collegeo.in/login...');
  await page.goto('https://collegeo.in/login', { waitUntil: 'networkidle2' });

  const artifactDir = path.resolve(process.cwd(), '../../.gemini/antigravity-ide/brain/4709391f-ce8b-4ebb-87f1-80d7b26986e1');
  const screenshotPath = path.join(artifactDir, 'login_verified_live_1791038500000.png');

  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('Screenshot saved to:', screenshotPath);

  // Fill in email and password and click Sign In to observe real validation response
  await page.type('#loginEmail', 'student_demo_qa@collegeo.in');
  await page.type('#loginPassword', 'WrongPass123!');
  
  console.log('Attempting form submission to verify auth response...');
  // Click submit
  await page.click('#loginSubmitBtn');
  await new Promise(r => setTimeout(r, 2000));

  const errorText = await page.evaluate(() => {
    return document.querySelector('#loginError')?.textContent || '';
  });
  console.log('Displayed Error Text:', `"${errorText}"`);

  const screenshotPathSubmitted = path.join(artifactDir, 'login_submitted_live_1791038500000.png');
  await page.screenshot({ path: screenshotPathSubmitted, fullPage: false });
  console.log('Submitted Screenshot saved to:', screenshotPathSubmitted);

  await browser.close();
}

captureLoginScreenshot().catch(console.error);
