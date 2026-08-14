require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { pool } = require('../server/db/pool');

const BASE_URL = 'http://127.0.0.1:3000';

function request(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const reqHeaders = { ...headers };
    let payload = null;

    if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !headers['Content-Type']?.includes('multipart/form-data')) {
      payload = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    } else if (Buffer.isBuffer(body)) {
      payload = body;
      reqHeaders['Content-Length'] = payload.length;
    }

    const req = http.request(url, { method, headers: reqHeaders }, (res) => {
      let data = [];
      const cookieHeader = res.headers['set-cookie'];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        const text = buffer.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch(e){}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          cookies: cookieHeader,
          text,
          json,
          buffer
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function extractCookie(res) {
  if (!res || !res.cookies) return '';
  return res.cookies.map(c => c.split(';')[0]).join('; ');
}

function extractCsrfToken(res) {
  if (!res || !res.cookies) return '';
  for (const cookieStr of res.cookies) {
    const match = cookieStr.match(/_csrf=([^;]+)/);
    if (match) return match[1];
  }
  return '';
}

async function runTests() {
  console.log('--- STARTING COMPREHENSIVE COLLEGE-OS INTEGRATION TEST ---');
  let failures = [];

  // 1. Health Check
  try {
    const health = await request('GET', '/api/health');
    if (health.statusCode === 200 && health.json?.ok) {
      console.log('✅ 1. API Health Check PASSED');
    } else {
      failures.push(`API Health Check failed: ${health.statusCode} ${health.text}`);
    }
  } catch (e) {
    failures.push(`API Health Check error: ${e.message}`);
  }

  // 2. Database Connectivity & Data Integrity Check
  try {
    const dbRes = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    console.log(`✅ 2. Database Connectivity & User Count PASSED (Users in DB: ${dbRes.rows[0].count})`);
  } catch (e) {
    failures.push(`Database Check error: ${e.message}`);
  }

  // 3. Student Portal Auth & Session
  let studentCookie = '';
  let csrfToken = '';
  try {
    const loginRes = await request('POST', '/api/auth/login', {
      email: 'qa.student1@collegeos.test',
      password: 'QaPass#123',
      turnstileToken: 'dev-bypass'
    });
    if (loginRes.statusCode === 200 && (loginRes.json?.success || loginRes.json?.user)) {
      studentCookie = extractCookie(loginRes);
      csrfToken = extractCsrfToken(loginRes);
      console.log('✅ 3. Student Portal Login PASSED');
    } else {
      failures.push(`Student Login failed: status=${loginRes.statusCode}, body=${loginRes.text}`);
    }
  } catch (e) {
    failures.push(`Student Login error: ${e.message}`);
  }

  // 4. Student Dashboard & Profile APIs
  if (studentCookie) {
    try {
      const profileRes = await request('GET', '/api/profile/me', null, { Cookie: studentCookie });
      if (profileRes.statusCode === 200) {
        if (!csrfToken) csrfToken = extractCsrfToken(profileRes);
        console.log('✅ 4. Student Profile API PASSED (/api/profile/me)');
      } else {
        failures.push(`Student Profile API failed: status=${profileRes.statusCode}, body=${profileRes.text}`);
      }

      const dashRes = await request('GET', '/api/dashboard/bootstrap', null, { Cookie: studentCookie });
      if (dashRes.statusCode === 200) {
        console.log('✅ 5. Student Dashboard Bootstrap API PASSED (/api/dashboard/bootstrap)');
      } else {
        failures.push(`Student Dashboard Config API failed: status=${dashRes.statusCode}`);
      }
    } catch (e) {
      failures.push(`Student Profile/Dashboard error: ${e.message}`);
    }
  }

  // 5. Admin Portal Auth & Session
  let adminCookie = '';
  try {
    const adminLoginRes = await request('POST', '/api/auth/login', {
      email: 'qa.admin@collegeos.test',
      password: 'QaAdmin#123',
      turnstileToken: 'dev-bypass'
    });
    if (adminLoginRes.statusCode === 200 && (adminLoginRes.json?.success || adminLoginRes.json?.user)) {
      adminCookie = extractCookie(adminLoginRes);
      console.log('✅ 6. Admin Portal Login PASSED');
    } else {
      failures.push(`Admin Login failed: status=${adminLoginRes.statusCode}, body=${adminLoginRes.text}`);
    }
  } catch (e) {
    failures.push(`Admin Login error: ${e.message}`);
  }

  // 6. Admin Dashboard & Control APIs
  if (adminCookie) {
    try {
      const adminDashRes = await request('GET', '/api/admin/dashboard', null, { Cookie: adminCookie });
      if (adminDashRes.statusCode === 200 && adminDashRes.json?.totalStudents !== undefined) {
        console.log('✅ 7. Admin Dashboard Summary API PASSED');
      } else {
        failures.push(`Admin Dashboard Summary API failed: status=${adminDashRes.statusCode}, body=${adminDashRes.text}`);
      }

      const adminPaymentsRes = await request('GET', '/api/admin/membership-payments', null, { Cookie: adminCookie });
      if (adminPaymentsRes.statusCode === 200) {
        console.log('✅ 8. Admin Payments & Governance API PASSED');
      } else {
        failures.push(`Admin Payments & Governance API failed: status=${adminPaymentsRes.statusCode}`);
      }
    } catch (e) {
      failures.push(`Admin API error: ${e.message}`);
    }
  }

  // 7. File Upload System Verification (Multipart Upload & Static Serving)
  if (studentCookie) {
    try {
      const boundary = '--------------------------' + Math.random().toString(36).substring(2);
      const pdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Test QA PDF) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
      
      let bodyParts = [];
      bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nQA Contribution Note Upload Test\r\n`));
      bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resourceType"\r\n\r\nhandwritten_notes\r\n`));
      bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="categoryId"\r\n\r\n1\r\n`));
      bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="branchId"\r\n\r\n1\r\n`));
      bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="semesterId"\r\n\r\n1\r\n`));
      bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\nComputer Science\r\n`));
      bodyParts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resourceFile"; filename="qa-sample-note.pdf"\r\nContent-Type: application/pdf\r\n\r\n`));
      bodyParts.push(pdfContent);
      bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const multipartBody = Buffer.concat(bodyParts);

      const headers = {
        Cookie: studentCookie,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      };
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
      }

      const uploadRes = await request('POST', '/api/contributions/submit', multipartBody, headers);

      if ((uploadRes.statusCode === 200 || uploadRes.statusCode === 201) && (uploadRes.json?.success || uploadRes.json?.data || uploadRes.json?.submission || uploadRes.json?.contribution)) {
        const submission = uploadRes.json?.submission || uploadRes.json?.contribution || uploadRes.json?.data;
        const uploadedUrl = submission?.file_url || submission?.url || uploadRes.json?.file_url;
        console.log(`✅ 9. File Upload API PASSED (Submission ID: ${submission?.id || 'OK'}, Status: ${submission?.status || 'pending'})`);

        // Test static file serving of the uploaded file if URL returned
        if (uploadedUrl && uploadedUrl.startsWith('/uploads/')) {
          const staticRes = await request('GET', uploadedUrl);
          if (staticRes.statusCode === 200 && staticRes.buffer.length > 0) {
            console.log(`✅ 10. File Download & Static Serving PASSED (${staticRes.buffer.length} bytes fetched)`);
          } else {
            failures.push(`Static File Download failed: status=${staticRes.statusCode}`);
          }
        }
      } else {
        failures.push(`File Upload API failed: status=${uploadRes.statusCode}, response=${uploadRes.text}`);
      }
    } catch (e) {
      failures.push(`File Upload error: ${e.message}`);
    }
  }

  console.log('\n---------------- RESULTS SUMMARY ----------------');
  if (failures.length === 0) {
    console.log('🎉 ALL INTEGRATION TESTS PASSED PERFECTLY!');
    process.exit(0);
  } else {
    console.error('❌ FAILURES ENCOUNTERED:');
    failures.forEach((f, idx) => console.error(`   ${idx + 1}. ${f}`));
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
