const puppeteer = require('puppeteer');

async function testLogin() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3000/admin-login.html', { waitUntil: 'networkidle2' });

  const result = await page.evaluate(async () => {
    try {
      const loginResp = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@collegeo.in',
          password: 'Admin@123456',
          captcha: 'bypass'
        })
      });

      const data = await loginResp.json();
      return { status: loginResp.status, data };
    } catch (err) {
      return { error: err.message };
    }
  });

  console.log('Login Test Result:', JSON.stringify(result, null, 2));
  await browser.close();
}

testLogin().catch(console.error);
