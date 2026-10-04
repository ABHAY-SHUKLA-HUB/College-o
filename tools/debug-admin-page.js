const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('[CONSOLE]', msg.type(), msg.text()));
  page.on('pageerror', err => console.error('[PAGE ERROR]', err.toString()));
  page.on('requestfailed', req => console.error('[FAILED REQUEST]', req.url(), req.failure().errorText));

  console.log('Navigating to http://localhost:3000/admin-login ...');
  await page.goto('http://localhost:3000/admin-login', { waitUntil: 'networkidle2' });

  const q = await page.$eval('#adminCaptchaQuestion', el => el.textContent);
  console.log('Captcha text in DOM:', q);

  const scriptSrcs = await page.$$eval('script', scripts => scripts.map(s => s.src || 'inline'));
  console.log('Loaded scripts:', scriptSrcs);

  await browser.close();
})();
