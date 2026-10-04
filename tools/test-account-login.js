const https = require('https');

async function tryLogin(email, password) {
  const body = JSON.stringify({
    email,
    password,
    turnstileToken: '1x00000000000000000000AA'
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 Live-QA-Tester'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const cookies = res.headers['set-cookie'] || [];
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({
          email,
          statusCode: res.statusCode,
          json,
          hasSessionCookie: cookies.some(c => c.includes('connect.sid') || c.includes('sid')),
          setCookie: cookies
        });
      });
    });
    req.on('error', (e) => resolve({ email, statusCode: 0, error: e.message }));
    req.write(body);
    req.end();
  });
}

async function testAccounts() {
  console.log('Testing live login candidates...');
  
  // Test candidate admin & student accounts
  const candidates = [
    { email: 'qa.admin@collegeos.test', pass: 'QaAdmin#123' },
    { email: 'qa.student1@collegeos.test', pass: 'QaPass#123' },
    { email: 'admin@collegeos.in', pass: 'CollegeOS_Admin_2026@Secure' },
    { email: 'admin@collegeos.in', pass: 'admin1234' },
    { email: 'abhayshukla639362@gmail.com', pass: 'CollegeOS_Admin_2026@Secure' }
  ];

  for (const c of candidates) {
    const res = await tryLogin(c.email, c.pass);
    console.log(`Account ${c.email.padEnd(32)} -> Status: ${res.statusCode} | Result: ${JSON.stringify(res.json)} | Cookie: ${res.hasSessionCookie}`);
  }
}

testAccounts().catch(console.error);
