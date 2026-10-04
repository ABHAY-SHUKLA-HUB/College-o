const puppeteer = require('puppeteer');

const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = 'abhayshukla639362@gmail.com';
const ADMIN_PASS = 'CollegeOS_Admin_2026@Secure';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  console.log('Navigating to http://localhost:3000/admin-login ...');
  await page.goto(`${BASE_URL}/admin-login`, { waitUntil: 'networkidle2' });

  await page.type('#adminEmail', ADMIN_EMAIL);
  await page.type('#adminPassword', ADMIN_PASS);

  const questionText = await page.$eval('#adminCaptchaQuestion', el => el.textContent.trim());
  console.log('Solving captcha:', questionText);
  const match = questionText.match(/(\d+)\s*([\+\-])\s*(\d+)/);
  if (match) {
    const ans = match[2] === '+' ? Number(match[1]) + Number(match[3]) : Number(match[1]) - Number(match[3]);
    await page.type('#adminCaptchaInput', String(ans));
  } else {
    await page.type('#adminCaptchaInput', 'bypass');
  }

  console.log('Submitting login form...');
  await page.click('#loginBtn');

  // Wait for redirect to admin-dashboard
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 8000 }).catch(() => {});
  console.log('Post-login current URL:', page.url());

  const pageTitle = await page.title();
  console.log('Post-login page title:', pageTitle);

  const isDashboard = page.url().includes('admin-dashboard') || page.url().includes('admin-control');
  console.log('Admin Dashboard Access:', isDashboard ? 'PASS' : 'FAIL');

  await browser.close();
})();
