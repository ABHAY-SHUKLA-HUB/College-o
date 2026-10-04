const https = require('https');

const endpoints = [
  '/api/academics/categories',
  '/api/academics/colleges',
  '/api/academics/courses',
  '/api/academics/branches',
  '/api/academics/semesters',
  '/api/academics/subjects?branchId=1&semesterId=1',
  '/api/notes',
  '/api/notes?branch_id=1&semester_id=1',
  '/api/quizzes',
  '/api/quizzes?subject=all',
  '/api/mock-tests',
  '/api/previous-papers',
  '/api/materials',
  '/api/materials?branch_id=1&semester_id=1',
  '/api/roadmaps',
  '/api/campus-feed',
  '/api/certificates/verify/SAMPLE123'
];

async function check(path) {
  return new Promise((resolve) => {
    https.get('https://collegeo.in' + path, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch (e) {}
        const info = json ? (Array.isArray(json) ? 'Array(' + json.length + ')' : JSON.stringify(json).slice(0, 100)) : body.slice(0, 80);
        console.log(`[${res.statusCode}] ${path.padEnd(46)} -> len: ${String(body.length).padEnd(5)} | ${info}`);
        resolve({ path, status: res.statusCode, json, bodyLength: body.length });
      });
    }).on('error', (e) => {
      console.log(`[ERR] ${path}: ${e.message}`);
      resolve({ path, status: 0, error: e.message });
    });
  });
}

(async () => {
  console.log('=== PROBING STUDENT APIS ON https://collegeo.in ===\n');
  for (const ep of endpoints) {
    await check(ep);
  }
})();
