const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ARTIFACT_DIR = 'C:\\Users\\krish\\.gemini\\antigravity-ide\\brain\\4709391f-ce8b-4ebb-87f1-80d7b26986e1';

async function capture() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const viewports = [
    { name: 'desktop_1440x900', width: 1440, height: 900 },
    { name: 'desktop_1366x768', width: 1366, height: 768 },
    { name: 'desktop_1280x800', width: 1280, height: 800 },
    { name: 'tablet_768x1024', width: 768, height: 1024 },
    { name: 'mobile_390x844', width: 390, height: 844, isMobile: true },
    { name: 'mobile_375x812', width: 375, height: 812, isMobile: true }
  ];

  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.isMobile,
      deviceScaleFactor: 2
    });

    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));

    const outputPath = path.join(ARTIFACT_DIR, `login_${vp.name}.png`);
    await page.screenshot({ path: outputPath, fullPage: vp.isMobile });
    console.log(`Saved screenshot: ${outputPath}`);

    // If desktop 1440, also test OTP tab
    if (vp.name === 'desktop_1440x900') {
      const otpBtn = await page.$('.login-method-btn[data-method="otp"]');
      if (otpBtn) {
        await otpBtn.click();
        await new Promise(r => setTimeout(r, 500));
        const otpOut = path.join(ARTIFACT_DIR, `login_desktop_1440x900_otp_tab.png`);
        await page.screenshot({ path: otpOut });
        console.log(`Saved screenshot: ${otpOut}`);
      }
    }

    await page.close();
  }

  await browser.close();
  console.log('All screenshots captured.');
}

capture().catch(err => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
