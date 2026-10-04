const https = require('https');

async function debugCreateWithValidSubject() {
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

  // Get valid subjects for Branch 1, Semester 1
  const subjectsRes = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/academics/subjects?branchId=1&semesterId=1',
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve({ status: r.statusCode, json: JSON.parse(d) }));
    });
    req.end();
  });

  const validSubjects = subjectsRes.json?.subjects || [];
  console.log('Valid subjects for Branch 1, Sem 1:', validSubjects);
  const targetSub = validSubjects[0];
  const subId = targetSub?.id || null;
  const subName = targetSub?.name || 'Distributed Systems';

  // 1. Note with valid subject
  const notePayload = JSON.stringify({
    subject: subName,
    chapter: 'Chapter 1: Live Verification Fundamentals',
    content: 'Comprehensive test note content created by Admin to verify student flow on live production.',
    categoryId: 1,
    branchId: 1,
    semesterId: 1,
    subjectId: subId,
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
      r.on('end', () => resolve({ status: r.statusCode, json: JSON.parse(d) }));
    });
    req.write(notePayload);
    req.end();
  });
  console.log('Note Create Result (HTTP ' + noteRes.status + '):', noteRes.json);

  // 2. Material with valid subject
  const matPayload = JSON.stringify({
    title: 'QA LIVE TEST — ADMIN PDF — 2026-10-03',
    category: 'Lab Manual',
    subject: subName,
    description: 'Official test reference PDF uploaded by Admin for live QA verification.',
    file_url: 'https://collegeo.in/assets/sample-manual.pdf',
    categoryId: 1,
    branchId: 1,
    semesterId: 1,
    subjectId: subId,
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
      r.on('end', () => resolve({ status: r.statusCode, json: JSON.parse(d) }));
    });
    req.write(matPayload);
    req.end();
  });
  console.log('Material Create Result (HTTP ' + matRes.status + '):', matRes.json);

  // 3. PYQ with valid subject
  const pyqPayload = JSON.stringify({
    subject: subName,
    examName: 'QA LIVE TEST — ADMIN PYQ — 2026-10-03',
    year: 2026,
    paperUrl: 'https://collegeo.in/assets/sample-paper.pdf',
    categoryId: 1,
    branchId: 1,
    semesterId: 1,
    subjectId: subId,
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
      r.on('end', () => resolve({ status: r.statusCode, json: JSON.parse(d) }));
    });
    req.write(pyqPayload);
    req.end();
  });
  console.log('PYQ Create Result (HTTP ' + pyqRes.status + '):', pyqRes.json);

  // 4. Quiz with valid subject
  const quizPayload = JSON.stringify({
    type: 'quiz',
    title: 'QA LIVE TEST — ADMIN QUIZ — 2026-10-03',
    subject: subName,
    chapter: 'Live Verification Algorithms',
    difficulty: 'medium',
    durationMinutes: 10,
    totalMarks: 10,
    passingMarks: 4,
    branchId: 1,
    semesterId: 1,
    subjectId: subId,
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
      r.on('end', () => resolve({ status: r.statusCode, json: JSON.parse(d) }));
    });
    req.write(quizPayload);
    req.end();
  });
  console.log('Quiz Create Result (HTTP ' + quizRes.status + '):', quizRes.json);
}

debugCreateWithValidSubject().catch(console.error);
