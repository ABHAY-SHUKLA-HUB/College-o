const https = require('https');

const pages = [
  { name: 'Home', path: '/' },
  { name: 'Features', path: '/features' },
  { name: 'Notes', path: '/notes' },
  { name: 'PYQs', path: '/pyqs' },
  { name: 'Quizzes', path: '/quizzes' },
  { name: 'Mock Tests', path: '/mock-tests' },
  { name: 'AI Study', path: '/ai-study' },
  { name: 'Career Roadmaps', path: '/career-roadmaps' },
  { name: 'Community', path: '/community' },
  { name: 'Live Study', path: '/live-study' },
  { name: 'Certificates', path: '/certificates' },
  { name: 'Pricing', path: '/pricing' },
  { name: 'About Us', path: '/about-us' },
  { name: 'Help Center', path: '/help-center' },
  { name: 'Contact Us', path: '/contact-us' },
  { name: 'Login', path: '/login' }
];

async function checkUrl(path) {
  return new Promise((resolve) => {
    const url = `https://collegeo.in${path}`;
    const req = https.get(url, { headers: { 'User-Agent': 'CollegeOS-Auditor/1.0' }, timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          url,
          status: res.statusCode,
          headers: res.headers,
          length: Buffer.byteLength(data),
          location: res.headers.location || null
        });
      });
    });

    req.on('error', (err) => {
      resolve({ url, status: 'ERROR', error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ url, status: 'TIMEOUT' });
    });
  });
}

async function run() {
  console.log('=== MULTI-PAGE LIVE PRODUCTION AUDIT (https://collegeo.in) ===\n');
  const results = [];
  for (const page of pages) {
    const res = await checkUrl(page.path);
    console.log(`${page.name.padEnd(16)} [${page.path.padEnd(18)}] -> Status: ${res.status} | Size: ${res.length || 0} bytes ${res.location ? `-> Redirect: ${res.location}` : ''}`);
    results.push({ page: page.name, path: page.path, ...res });
  }

  console.log('\n=== AUDIT FINISHED ===');
}

run();
