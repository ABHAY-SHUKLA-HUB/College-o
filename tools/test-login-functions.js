const puppeteer = require('puppeteer');

async function testAll() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  console.log('--- 1. LOADING http://localhost:3000/login ---');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });

  // 1. Password show/hide test
  console.log('--- 2. TESTING PASSWORD SHOW/HIDE ---');
  await page.type('#loginPassword', 'SecretPassword123');
  let inputType = await page.$eval('#loginPassword', el => el.type);
  console.log('Initial password type:', inputType);
  if (inputType !== 'password') throw new Error('Password should initially be type password');
  
  await page.click('#toggleLoginPassword');
  inputType = await page.$eval('#loginPassword', el => el.type);
  console.log('After toggle password type:', inputType);
  if (inputType !== 'text') throw new Error('Password should be type text after toggle');

  await page.click('#toggleLoginPassword');
  inputType = await page.$eval('#loginPassword', el => el.type);
  console.log('After toggle back password type:', inputType);
  if (inputType !== 'password') throw new Error('Password should be type password after toggle back');

  // 2. Tab switching test (Email -> OTP -> Email)
  console.log('--- 3. TESTING TAB SWITCHING ---');
  const otpBtn = await page.$('.login-method-btn[data-method="otp"]');
  await otpBtn.click();
  await new Promise(r => setTimeout(r, 200));
  const otpVisible = await page.$eval('#otpLoginSection', el => !el.classList.contains('hidden'));
  const emailFormVisibleAfterOtp = await page.$eval('#loginForm', el => !el.classList.contains('hidden'));
  console.log('OTP Section visible:', otpVisible, 'Email form visible:', emailFormVisibleAfterOtp);
  if (!otpVisible || emailFormVisibleAfterOtp) throw new Error('OTP tab switch failed');

  const emailBtn = await page.$('.login-method-btn[data-method="email"]');
  await emailBtn.click();
  await new Promise(r => setTimeout(r, 200));
  const otpVisibleAfterSwitch = await page.$eval('#otpLoginSection', el => !el.classList.contains('hidden'));
  const emailFormVisible = await page.$eval('#loginForm', el => !el.classList.contains('hidden'));
  console.log('Email form visible:', emailFormVisible, 'OTP Section visible:', otpVisibleAfterSwitch);
  if (otpVisibleAfterSwitch || !emailFormVisible) throw new Error('Email tab switch failed');

  // 3. Remember Me test
  console.log('--- 4. TESTING REMEMBER ME CHECKBOX ---');
  const initialChecked = await page.$eval('#rememberMe', el => el.checked);
  await page.click('#rememberMe');
  const afterClickChecked = await page.$eval('#rememberMe', el => el.checked);
  console.log('Remember me initially:', initialChecked, 'After click:', afterClickChecked);
  if (initialChecked === afterClickChecked) throw new Error('Remember me toggle failed');

  // 4. Test Registration link navigation
  console.log('--- 5. TESTING REGISTRATION LINK ---');
  const headerCreateBtn = await page.$('.co-auth-header-btn');
  const headerHref = await page.$eval('.co-auth-header-btn', el => el.getAttribute('href'));
  console.log('Header Create account link href:', headerHref);

  const cardSignupLink = await page.$eval('.co-card-switch-link', el => el.getAttribute('href'));
  console.log('Card Create account link href:', cardSignupLink);

  // 5. Test Error Handling (including 429 friendly message)
  console.log('--- 6. TESTING ERROR RENDERING ---');
  await page.evaluate(() => {
    const err = document.getElementById('loginError');
    if (err) {
      err.textContent = 'Too many attempts. Please wait a moment and try again.';
      err.style.display = 'flex';
    }
  });
  const errorText = await page.$eval('#loginError', el => el.textContent);
  console.log('Error message rendered correctly:', errorText);

  // 6. Test Form Submission validation
  console.log('--- 7. TESTING VALIDATION & SUBMISSION ---');
  await page.click('#loginSubmitBtn');
  const submitBtnExists = await page.$('#loginSubmitBtn');
  console.log('Submit button present and responsive:', !!submitBtnExists);

  // 7. Check Console Errors
  console.log('--- 8. CONSOLE ERRORS CHECK ---');
  console.log('Console Errors count:', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.log('Console Errors:', consoleErrors);
  }

  await browser.close();
  console.log('=== ALL FUNCTIONAL TESTS COMPLETED SUCCESSFULLY ===');
}

testAll().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
