const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleLogs = [];
  const errors = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => errors.push(`[PAGE ERROR] ${err.toString()}`));

  console.log('--- 1. Navigating to http://localhost:3000/login ---');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle2' });

  console.log('Checking initial auth view state...');
  const initialLoginViewVisible = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  const initialSignupViewVisible = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`Initial: login visible=${initialLoginViewVisible}, signup visible=${initialSignupViewVisible}`);

  console.log('--- 2. Clicking Header "Create account →" button ---');
  const headerBtn = await page.$('.co-auth-header-btn[data-auth-tab="signup"]');
  if (headerBtn) {
    await headerBtn.click();
    await page.waitForTimeout(500);
  } else {
    console.error('Header button not found!');
  }

  let loginVisibleAfterHeaderClick = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  let signupVisibleAfterHeaderClick = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`After Header Click: login visible=${loginVisibleAfterHeaderClick}, signup visible=${signupVisibleAfterHeaderClick}`);
  console.log(`Current URL: ${page.url()}`);

  console.log('--- 3. Clicking "Sign In →" in Header ---');
  const headerSignInBtn = await page.$('.co-auth-header-btn[data-auth-tab="login"]');
  if (headerSignInBtn) {
    await headerSignInBtn.click();
    await page.waitForTimeout(500);
  } else {
    console.error('Header Sign In button not found!');
  }

  let loginVisibleAfterSignInClick = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  let signupVisibleAfterSignInClick = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`After Header Sign In Click: login visible=${loginVisibleAfterSignInClick}, signup visible=${signupVisibleAfterSignInClick}`);

  console.log('--- 4. Clicking bottom "Create your student account →" link ---');
  const bottomLink = await page.$('.co-card-switch-link[data-auth-tab="signup"]');
  if (bottomLink) {
    await bottomLink.click();
    await page.waitForTimeout(500);
  } else {
    console.error('Bottom switch link not found!');
  }

  let loginVisibleAfterBottomClick = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  let signupVisibleAfterBottomClick = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`After Bottom Link Click: login visible=${loginVisibleAfterBottomClick}, signup visible=${signupVisibleAfterBottomClick}`);

  console.log('--- 5. Direct navigation to http://localhost:3000/signup ---');
  await page.goto('http://localhost:3000/signup', { waitUntil: 'networkidle2' });
  const signupDirectLoginVisible = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  const signupDirectSignupVisible = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`On /signup directly: login visible=${signupDirectLoginVisible}, signup visible=${signupDirectSignupVisible}`);

  console.log('--- 6. Direct navigation to http://localhost:3000/login.html?mode=signup ---');
  await page.goto('http://localhost:3000/login.html?mode=signup', { waitUntil: 'networkidle2' });
  const modeSignupLoginVisible = await page.$eval('[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  const modeSignupSignupVisible = await page.$eval('[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log(`On login.html?mode=signup: login visible=${modeSignupLoginVisible}, signup visible=${modeSignupSignupVisible}`);

  console.log('\n--- Console Logs ---');
  consoleLogs.forEach(log => console.log(log));
  console.log('\n--- Page Errors ---');
  errors.forEach(err => console.error(err));

  await browser.close();
})();
