const puppeteer = require('puppeteer');

const pagesToTest = [
  { name: 'Home', url: 'https://collegeo.in/' },
  { name: 'Features', url: 'https://collegeo.in/features' },
  { name: 'Notes', url: 'https://collegeo.in/notes' },
  { name: 'PYQs', url: 'https://collegeo.in/pyqs' },
  { name: 'Quizzes', url: 'https://collegeo.in/quizzes' },
  { name: 'Mock Tests', url: 'https://collegeo.in/mock-tests' },
  { name: 'AI Study', url: 'https://collegeo.in/ai-study' },
  { name: 'Career Roadmaps', url: 'https://collegeo.in/career-roadmaps' },
  { name: 'Community', url: 'https://collegeo.in/community' },
  { name: 'Live Study', url: 'https://collegeo.in/live-study' },
  { name: 'Certificates', url: 'https://collegeo.in/certificates' },
  { name: 'Pricing', url: 'https://collegeo.in/pricing' },
  { name: 'About Us', url: 'https://collegeo.in/about-us' },
  { name: 'Help Center', url: 'https://collegeo.in/help-center' },
  { name: 'Contact Us', url: 'https://collegeo.in/contact-us' }
];

async function verifyAll() {
  console.log('=== STARTING PUPPETEER MULTI-PAGE LIVE BROWSER VERIFICATION ===\n');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const results = [];

  for (const item of pagesToTest) {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    try {
      const response = await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 15000 });
      const status = response.status();
      const title = await page.title();
      const currentUrl = page.url();
      
      // Check mobile viewport
      await page.setViewport({ width: 375, height: 812 });
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });

      // Restore desktop viewport
      await page.setViewport({ width: 1440, height: 900 });

      const passed = status === 200 && !currentUrl.includes('/login') && !hasHorizontalScroll;
      
      results.push({
        page: item.name,
        targetUrl: item.url,
        finalUrl: currentUrl,
        status,
        title,
        hasHorizontalScroll,
        consoleErrorsCount: consoleErrors.length,
        verdict: passed ? 'PASS' : 'FAIL'
      });

      console.log(`[${passed ? 'PASS' : 'FAIL'}] ${item.name.padEnd(16)} -> Status: ${status} | Title: "${title}" | URL: ${currentUrl} | Mobile Overflow: ${hasHorizontalScroll ? 'YES' : 'NO'}`);
    } catch (err) {
      console.log(`[ERROR] ${item.name}: ${err.message}`);
      results.push({ page: item.name, verdict: 'ERROR', error: err.message });
    }
  }

  await browser.close();
  console.log('\n=== COMPLETED PUPPETEER LIVE AUDIT ===');
  console.log(JSON.stringify(results, null, 2));
}

verifyAll().catch(console.error);
