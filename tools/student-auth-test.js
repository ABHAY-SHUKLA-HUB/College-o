const https = require('https');

async function testStudentAuth() {
  const students = [
    { email: 'student@collegeos.in', pass: 'Student@1234' },
    { email: 'student@collegeo.in', pass: 'Student@1234' },
    { email: 'test.student@collegeos.in', pass: 'TestPass@123' },
    { email: 'demo.student@collegeos.in', pass: 'DemoPass@123' },
    { email: 'qa.student1@collegeos.test', pass: 'QaPass#123' }
  ];

  for (const s of students) {
    const body = JSON.stringify({
      email: s.email,
      password: s.pass,
      turnstileToken: '1x00000000000000000000AA'
    });

    const res = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'collegeo.in',
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          let j = null;
          try { j = JSON.parse(d); } catch(e) {}
          resolve({ status: r.statusCode, json: j, cookies: r.headers['set-cookie'] });
        });
      });
      req.write(body);
      req.end();
    });

    console.log(`Student ${s.email} -> Status: ${res.status} | JSON: ${JSON.stringify(res.json)}`);
  }
}

testStudentAuth().catch(console.error);
