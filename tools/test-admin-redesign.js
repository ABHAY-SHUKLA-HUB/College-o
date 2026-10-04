const puppeteer = require('puppeteer');
const path = require('path');

const BASE_URL = 'http://localhost:3000';
const ADMIN_EMAIL = 'abhayshukla639362@gmail.com';
const ADMIN_PASS = 'CollegeOS_Admin_2026@Secure';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(`[PAGE ERROR] ${err.toString()}`));

  console.log('====================================================');
  console.log('COLLEGE OS — ADMIN LOGIN REDESIGN AUDIT');
  console.log('====================================================\n');

  // TEST 1: Navigation to /admin/login & /admin-login
  console.log('--- TEST 1: Direct navigation to /admin/login ---');
  await page.setViewport({ width: 1440, height: 900 });
  const response = await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'networkidle2' });
  console.log(`HTTP Status for /admin/login: ${response.status()}`);
  
  const headline = await page.$eval('.co-admin-headline', el => el.textContent.replace(/\s+/g, ' ').trim());
  console.log(`Headline Found: "${headline}"`);

  // TEST 2: Password Toggle
  console.log('\n--- TEST 2: Password visibility toggle ---');
  let pwdType = await page.$eval('#adminPassword', el => el.type);
  console.log(`Initial password input type: "${pwdType}"`);
  await page.click('#pwdToggle');
  await page.waitForTimeout(100);
  pwdType = await page.$eval('#adminPassword', el => el.type);
  console.log(`After click #pwdToggle: "${pwdType}"`);
  await page.click('#pwdToggle');
  await page.waitForTimeout(100);
  pwdType = await page.$eval('#adminPassword', el => el.type);
  console.log(`After second click: "${pwdType}"`);

  // TEST 3: Captcha Refresh
  console.log('\n--- TEST 3: Captcha question & refresh ---');
  let q1 = await page.$eval('#adminCaptchaQuestion', el => el.textContent.trim());
  console.log(`Captcha Question 1: "${q1}"`);
  await page.click('#refreshAdminCaptcha');
  await page.waitForTimeout(200);
  let q2 = await page.$eval('#adminCaptchaQuestion', el => el.textContent.trim());
  console.log(`Captcha Question 2 (after refresh): "${q2}"`);

  // TEST 4: Empty form submission validation
  console.log('\n--- TEST 4: Empty form validation ---');
  await page.click('#loginBtn');
  await page.waitForTimeout(300);
  let emailInvalid = await page.$eval('#adminEmail', el => el.classList.contains('is-invalid'));
  let pwdInvalid = await page.$eval('#adminPassword', el => el.classList.contains('is-invalid'));
  let emailHintVisible = await page.$eval('#emailHint', el => el.classList.contains('visible'));
  console.log(`Email invalid marked: ${emailInvalid}, Hint visible: ${emailHintVisible}`);
  console.log(`Password invalid marked: ${pwdInvalid}`);

  // TEST 5: Wrong credentials attempt
  console.log('\n--- TEST 5: Wrong credentials error banner ---');
  await page.type('#adminEmail', 'wrongadmin@collegeos.in');
  await page.type('#adminPassword', 'WrongPassword123!');
  
  // Solve math captcha dynamically
  let questionText = await page.$eval('#adminCaptchaQuestion', el => el.textContent.trim());
  let match = questionText.match(/(\d+)\s*([\+\-])\s*(\d+)/);
  if (match) {
    let ans = match[2] === '+' ? Number(match[1]) + Number(match[3]) : Number(match[1]) - Number(match[3]);
    await page.type('#adminCaptchaInput', String(ans));
  } else {
    await page.type('#adminCaptchaInput', 'bypass');
  }

  await page.click('#loginBtn');
  await page.waitForTimeout(1000);

  let errorVisible = await page.$eval('#errorBanner', el => el.classList.contains('visible'));
  let errorText = await page.$eval('#errorBannerText', el => el.textContent.trim());
  console.log(`Error Banner Visible: ${errorVisible}`);
  console.log(`Polished Error Message: "${errorText}"`);

  // Take Desktop Screenshot
  await page.screenshot({ path: path.join(__dirname, '..', 'admin_login_desktop_1440x900.png') });
  console.log('Desktop Screenshot saved to admin_login_desktop_1440x900.png');

  // TEST 6: Tablet Viewport (768x1024)
  console.log('\n--- TEST 6: Tablet Viewport (768x1024) ---');
  await page.setViewport({ width: 768, height: 1024 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, '..', 'admin_login_tablet_768x1024.png') });
  console.log('Tablet Screenshot saved to admin_login_tablet_768x1024.png');

  // TEST 7: Mobile Viewport (390x844)
  console.log('\n--- TEST 7: Mobile Viewport (390x844) ---');
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, '..', 'admin_login_mobile_390x844.png'), fullPage: true });
  console.log('Mobile Screenshot saved to admin_login_mobile_390x844.png');

  console.log('\n--- Page Errors summary ---');
  if (pageErrors.length === 0) {
    console.log('ZERO page errors! Clean console.');
  } else {
    pageErrors.forEach(e => console.error(e));
  }

  await browser.close();
  console.log('\n====================================================');
  console.log('AUDIT COMPLETE');
  console.log('====================================================');
})();
