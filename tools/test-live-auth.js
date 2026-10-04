const puppeteer = require('puppeteer');

async function testLoginFlow() {
  console.log('=== TESTING LIVE LOGIN FLOW ON https://collegeo.in/login ===');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('https://collegeo.in/login', { waitUntil: 'networkidle2' });

  // Get captcha math question
  const captchaQuestion = await page.$eval('#loginCaptchaQuestion', el => el.textContent.trim()).catch(() => '');
  console.log('Captcha Question:', captchaQuestion);

  // Check login API config
  const config = await page.evaluate(async () => {
    const res = await fetch('/api/auth/config');
    return await res.json();
  });
  console.log('Auth config:', JSON.stringify(config, null, 2));

  await browser.close();
}

testLoginFlow().catch(console.error);
