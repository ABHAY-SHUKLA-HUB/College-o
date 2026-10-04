const https = require('https');

const candidates = [
  { email: 'student_a_part3@collegeo.in', pass: 'Part3Pass#123' },
  { email: 'student_a_part3@collegeo.in', pass: 'StudentPass@123' },
  { email: 'student_a_part3@collegeo.in', pass: 'CollegeOS_Admin_2026@Secure' },
  { email: 'studenta_part15@collegeo.in', pass: 'Part15Pass#123' },
  { email: 'studenta_part13@collegeo.in', pass: 'Part13Pass#123' },
  { email: 'test_student_part11@collegeo.in', pass: 'Part11Pass#123' },
  { email: 'free_part9@collegeos.test', pass: 'Part9Pass#123' },
  { email: 'free_part9@collegeos.test', pass: 'TestPass#123' },
  { email: 'free_part9@collegeos.test', pass: 'QaPass#123' },
  { email: 'shuklaabhayas0@gmail.com', pass: 'CollegeOS_Admin_2026@Secure' }
];

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
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        let j = null;
        try { j = JSON.parse(d); } catch(e) {}
        const cookies = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        resolve({ email, password, status: r.statusCode, json: j, cookies });
      });
    });
    req.write(body);
    req.end();
  });
}

async function run() {
  for (const c of candidates) {
    const res = await tryLogin(c.email, c.pass);
    if (res.status === 200) {
      console.log(`>>> SUCCESSFUL STUDENT LOGIN: ${c.email} -> Role: ${res.json?.user?.role}, ID: ${res.json?.user?.id}`);
    } else {
      console.log(`Failed: ${c.email} (Status ${res.status})`);
    }
  }
}

run().catch(console.error);
