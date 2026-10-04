const https = require('https');

async function testOtpRequest() {
  const body = JSON.stringify({
    channel: 'email',
    target: 'qa.student.flow@gmail.com',
    purpose: 'signup',
    turnstileToken: '1x00000000000000000000AA'
  });

  const res = await new Promise((resolve) => {
    const req = https.request({
      hostname: 'collegeo.in',
      path: '/api/auth/verification/request',
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
        resolve({ status: r.statusCode, json: j, body: d });
      });
    });
    req.write(body);
    req.end();
  });

  console.log('OTP Request Response:', res.status, res.json || res.body);
}

testOtpRequest().catch(console.error);
