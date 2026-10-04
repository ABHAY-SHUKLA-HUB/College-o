const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 768, height: 1024 });

  await page.goto('http://localhost:3000/admin/login', { waitUntil: 'networkidle2' });
  await page.screenshot({ path: path.join(__dirname, '..', 'admin_login_tablet_full.png'), fullPage: true });

  await browser.close();
})();
