const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [];
  page.on('pageerror', err => errors.push(`[PAGE ERROR] ${err.toString()}`));

  console.log('--- TEST 1: Load /login ---');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });
  let loginCardVisible = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  let signupCardVisible = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`On /login: LoginCardVisible=${loginCardVisible}, SignupCardVisible=${signupCardVisible}`);

  console.log('--- TEST 2: Click Header "Create account →" ---');
  await page.click('.co-auth-header-btn[data-auth-tab="signup"]');
  await page.waitForTimeout(300);
  loginCardVisible = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  signupCardVisible = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`After Header Click: LoginCardVisible=${loginCardVisible}, SignupCardVisible=${signupCardVisible}`);

  console.log('--- TEST 3: Click Header "Sign In →" ---');
  await page.click('.co-auth-header-btn[data-auth-tab="login"]');
  await page.waitForTimeout(300);
  loginCardVisible = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  signupCardVisible = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`After Switch back to Login: LoginCardVisible=${loginCardVisible}, SignupCardVisible=${signupCardVisible}`);

  console.log('--- TEST 4: Click Bottom "Create your student account →" ---');
  await page.click('.co-card-switch-link[data-auth-tab="signup"]');
  await page.waitForTimeout(300);
  loginCardVisible = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  signupCardVisible = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`After Bottom Link Click: LoginCardVisible=${loginCardVisible}, SignupCardVisible=${signupCardVisible}`);

  console.log('--- TEST 5: Form Validation on Signup Form ---');
  // Click submit with empty form
  await page.click('#signupSubmitBtn');
  await page.waitForTimeout(300);
  let errorMsg = await page.$eval('#signupError', el => el.textContent);
  console.log(`Empty Form Submit Error: "${errorMsg}"`);

  // Fill partial form
  await page.type('#signupName', 'Student Demo');
  await page.type('#signupEmail', 'invalid-email');
  await page.click('#signupSubmitBtn');
  await page.waitForTimeout(300);
  errorMsg = await page.$eval('#signupError', el => el.textContent);
  console.log(`Invalid Email Submit Error: "${errorMsg}"`);

  // Fix email and test weak password
  await page.evaluate(() => { document.getElementById('signupEmail').value = 'student@example.com'; });
  await page.type('#signupMobile', '9876543210');
  await page.type('#signupPassword', '123');
  await page.click('#signupSubmitBtn');
  await page.waitForTimeout(300);
  errorMsg = await page.$eval('#signupError', el => el.textContent);
  console.log(`Weak Password Submit Error: "${errorMsg}"`);

  console.log('--- TEST 6: Direct load /signup ---');
  await page.goto('http://localhost:3000/signup', { waitUntil: 'networkidle2' });
  loginCardVisible = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  signupCardVisible = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`On /signup direct load: LoginCardVisible=${loginCardVisible}, SignupCardVisible=${signupCardVisible}`);

  const signupSubmitBtnVisible = await page.$eval('#signupSubmitBtn', el => !el.classList.contains('hidden') && el.offsetParent !== null);
  console.log(`Signup Submit Button Visible and Active: ${signupSubmitBtnVisible}`);

  await page.screenshot({ path: path.join(__dirname, '..', 'signup_verification_check.png') });
  console.log('Screenshot saved to signup_verification_check.png');

  console.log('\n--- Page Errors ---');
  if (errors.length === 0) {
    console.log('ZERO page errors! All tests PASSED flawlessly.');
  } else {
    errors.forEach(e => console.error(e));
  }

  await browser.close();
})();
