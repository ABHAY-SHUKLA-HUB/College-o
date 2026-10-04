const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true });

  await page.goto('http://localhost:3000/signup', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: path.join(__dirname, '..', 'signup_mobile_check.png'), fullPage: true });

  await browser.close();
})();
