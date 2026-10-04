const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('[Browser Console]', msg.type(), msg.text()));

  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0' });
  
  const switchLinks = await page.$$eval('[data-auth-tab]', els => els.map(el => ({
    tag: el.tagName,
    tab: el.dataset.authTab,
    text: el.innerText.trim(),
    classes: el.className
  })));
  console.log('Found data-auth-tab elements:', switchLinks);

  console.log('--- 1. Clicking signup link in login card footer ---');
  await page.click('.auth-view[data-auth-view="login"] .auth-switch-link');
  await new Promise(r => setTimeout(r, 300));
  let loginViewHidden = await page.$eval('.auth-view[data-auth-view="login"]', el => el.classList.contains('hidden'));
  let signupViewHidden = await page.$eval('.auth-view[data-auth-view="signup"]', el => el.classList.contains('hidden'));
  console.log('Login hidden:', loginViewHidden, 'Signup hidden:', signupViewHidden);

  console.log('--- 2. Clicking login link in signup card footer ---');
  await page.click('.auth-view[data-auth-view="signup"] .auth-switch-link');
  await new Promise(r => setTimeout(r, 300));
  loginViewHidden = await page.$eval('.auth-view[data-auth-view="login"]', el => el.classList.contains('hidden'));
  signupViewHidden = await page.$eval('.auth-view[data-auth-view="signup"]', el => el.classList.contains('hidden'));
  console.log('Login hidden:', loginViewHidden, 'Signup hidden:', signupViewHidden);

  console.log('--- 3. Clicking header Create account button ---');
  await page.click('.co-auth-header-btn');
  await new Promise(r => setTimeout(r, 300));
  loginViewHidden = await page.$eval('.auth-view[data-auth-view="login"]', el => el.classList.contains('hidden'));
  signupViewHidden = await page.$eval('.auth-view[data-auth-view="signup"]', el => el.classList.contains('hidden'));
  console.log('Login hidden:', loginViewHidden, 'Signup hidden:', signupViewHidden);

  console.log('--- 4. Clicking header Sign in button ---');
  await page.click('.co-auth-header-btn');
  await new Promise(r => setTimeout(r, 300));
  loginViewHidden = await page.$eval('.auth-view[data-auth-view="login"]', el => el.classList.contains('hidden'));
  signupViewHidden = await page.$eval('.auth-view[data-auth-view="signup"]', el => el.classList.contains('hidden'));
  console.log('Login hidden:', loginViewHidden, 'Signup hidden:', signupViewHidden);

  await browser.close();
})();
