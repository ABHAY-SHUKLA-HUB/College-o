const https = require('https');

async function loginAdmin() {
  const body = JSON.stringify({
    email: 'abhayshukla639362@gmail.com',
    password: process.env.ADMIN_PASSWORD || 'CollegeOS_Admin_2026@Secure',
    turnstileToken: '1x00000000000000000000AA'
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({ cookies, csrfToken: json?.csrfToken, user: json?.user });
      });
    });
    req.write(body);
    req.end();
  });
}

function adminGet(path, cookies, csrfToken) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path,
      method: 'GET',
      headers: {
        'Cookie': cookies,
        'X-CSRF-Token': csrfToken || '',
        'Accept': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({ status: res.statusCode, json, body: data });
      });
    });
    req.end();
  });
}

async function probe() {
  const { cookies, csrfToken, user } = await loginAdmin();
  console.log('Admin logged in:', user?.email, 'Role:', user?.role);

  const endpoints = [
    '/api/admin/users',
    '/api/admin/control/academics/notes',
    '/api/admin/control/academics/materials',
    '/api/admin/control/academics/previous-papers',
    '/api/admin/control/assessments?type=quiz',
    '/api/admin/control/assessments?type=mock_test',
    '/api/admin/control/academic-structure/categories',
    '/api/admin/control/academic-structure/branches',
    '/api/admin/control/academic-structure/semesters',
    '/api/admin/control/academic-structure/subjects'
  ];

  for (const ep of endpoints) {
    const res = await adminGet(ep, cookies, csrfToken);
    const summary = res.json ? (Array.isArray(res.json) ? 'Array(' + res.json.length + ')' : JSON.stringify(res.json).slice(0, 120)) : res.body.slice(0, 80);
    console.log(`[${res.status}] ${ep.padEnd(48)} -> ${summary}`);
  }
}

probe().catch(console.error);
