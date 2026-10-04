const https = require('https');

async function debugCreate() {
  const loginBody = JSON.stringify({
    email: 'abhayshukla639362@gmail.com',
    password: process.env.ADMIN_PASSWORD || 'CollegeOS_Admin_2026@Secure',
    turnstileToken: '1x00000000000000000000AA'
  });

  const loginRes = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) }
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        const cookies = (r.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        resolve({ cookies, json: JSON.parse(d) });
      });
    });
    req.write(loginBody);
    req.end();
  });

  const headers = {
    'Cookie': loginRes.cookies,
    'X-CSRF-Token': loginRes.json?.csrfToken || '',
    'Content-Type': 'application/json'
  };

  // 1. Note payload test
  const notePayload = JSON.stringify({
    subject: 'Data Structures & Algorithms',
    chapter: 'Chapter 1: Live Verification',
    content: 'Test content',
    categoryId: 1,
    branchId: 1,
    semesterId: 1,
    subjectId: 1,
    status: 'published',
    accessType: 'free',
    pdfUrl: 'https://collegeo.in/assets/sample-note.pdf'
  });

  const noteRes = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/admin/control/academics/notes',
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(notePayload) }
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.write(notePayload);
    req.end();
  });

  console.log('Note Create Response:', noteRes.status, noteRes.body);

  // 2. Material payload test
  const matPayload = JSON.stringify({
    title: 'Test Material Title',
    category: 'Lab Manual',
    subject: 'Data Structures',
    description: 'Test material description',
    file_url: 'https://collegeo.in/assets/sample-manual.pdf',
    categoryId: 1,
    branchId: 1,
    semesterId: 1,
    subjectId: 1,
    status: 'published',
    accessType: 'free'
  });

  const matRes = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/admin/control/academics/materials',
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(matPayload) }
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.write(matPayload);
    req.end();
  });

  console.log('Material Create Response:', matRes.status, matRes.body);

  // 3. PYQ payload test
  const pyqPayload = JSON.stringify({
    subject: 'Data Structures',
    examName: 'Mid Sem Exam',
    year: 2026,
    paperUrl: 'https://collegeo.in/assets/sample-paper.pdf',
    categoryId: 1,
    branchId: 1,
    semesterId: 1,
    subjectId: 1,
    status: 'published',
    accessType: 'free'
  });

  const pyqRes = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/admin/control/academics/previous-papers',
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(pyqPayload) }
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.write(pyqPayload);
    req.end();
  });

  console.log('PYQ Create Response:', pyqRes.status, pyqRes.body);

  // 4. Quiz payload test
  const quizPayload = JSON.stringify({
    type: 'quiz',
    title: 'Test Quiz DSA',
    subject: 'Data Structures',
    chapter: 'Arrays',
    difficulty: 'medium',
    durationMinutes: 10,
    totalMarks: 10,
    passingMarks: 4,
    branchId: 1,
    semesterId: 1,
    subjectId: 1,
    status: 'published',
    accessType: 'free'
  });

  const quizRes = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/admin/control/assessments',
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(quizPayload) }
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.write(quizPayload);
    req.end();
  });

  console.log('Quiz Create Response:', quizRes.status, quizRes.body);
}

debugCreate().catch(console.error);
