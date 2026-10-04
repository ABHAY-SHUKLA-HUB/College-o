const puppeteer = require('puppeteer');

async function testSignupClicks() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  
  console.log('=== TEST 1: OPENING /login AND CLICKING HEADER "Create account →" ===');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
  
  // Verify initially login view is visible and signup view is hidden
  let loginVisible = await page.$eval('.auth-view[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  let signupVisible = await page.$eval('.auth-view[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log('Initially: Login view visible =', loginVisible, '| Signup view visible =', signupVisible);
  if (!loginVisible || signupVisible) throw new Error('Initial state should show login view');

  // Click header button
  console.log('Clicking header ".co-auth-header-btn" (Create account →)...');
  await page.click('.co-auth-header-btn');
  await new Promise(r => setTimeout(r, 200));

  loginVisible = await page.$eval('.auth-view[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  signupVisible = await page.$eval('.auth-view[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log('After clicking Header CTA: Login view visible =', loginVisible, '| Signup view visible =', signupVisible);
  if (loginVisible || !signupVisible) throw new Error('Signup view should be visible after clicking header button');

  // Click "Sign In →" in the signup view footer
  console.log('Clicking "Sign In →" switch link in signup card...');
  await page.click('.auth-view[data-auth-view="signup"] .auth-switch-link');
  await new Promise(r => setTimeout(r, 200));

  loginVisible = await page.$eval('.auth-view[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  signupVisible = await page.$eval('.auth-view[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log('After switching back: Login view visible =', loginVisible, '| Signup view visible =', signupVisible);
  if (!loginVisible || signupVisible) throw new Error('Login view should be visible after switching back');

  // Click card footer "Create your student account →"
  console.log('Clicking card footer ".co-card-switch-link" (Create your student account →)...');
  await page.click('.auth-view[data-auth-view="login"] .auth-switch-link');
  await new Promise(r => setTimeout(r, 200));

  loginVisible = await page.$eval('.auth-view[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  signupVisible = await page.$eval('.auth-view[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log('After clicking Card CTA: Login view visible =', loginVisible, '| Signup view visible =', signupVisible);
  if (loginVisible || !signupVisible) throw new Error('Signup view should be visible after clicking card footer link');

  // Take screenshot of signup view
  const ARTIFACT_DIR = 'C:\\Users\\krish\\.gemini\\antigravity-ide\\brain\\4709391f-ce8b-4ebb-87f1-80d7b26986e1';
  await page.screenshot({ path: `${ARTIFACT_DIR}\\signup_view_desktop.png` });
  console.log('Saved screenshot: signup_view_desktop.png');

  console.log('=== TEST 2: DIRECT NAVIGATION TO http://localhost:3000/signup ===');
  await page.goto('http://localhost:3000/signup', { waitUntil: 'networkidle0' });
  loginVisible = await page.$eval('.auth-view[data-auth-view="login"]', el => !el.classList.contains('hidden'));
  signupVisible = await page.$eval('.auth-view[data-auth-view="signup"]', el => !el.classList.contains('hidden'));
  console.log('Direct /signup: Login view visible =', loginVisible, '| Signup view visible =', signupVisible);
  if (loginVisible || !signupVisible) throw new Error('Direct /signup must show signup view');

  console.log('=== ALL CREATE ACCOUNT CLICK TESTS PASSED! ===');
  await browser.close();
}

testSignupClicks().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
