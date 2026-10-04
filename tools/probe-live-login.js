const https = require('https');

function testLiveLogin() {
  const data = JSON.stringify({
    email: 'test_student_probe@collegeo.in',
    password: 'WrongPassword123!',
    captchaToken: 'math-verified'
  });

  const options = {
    hostname: 'collegeo.in',
    port: 443,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  };

  console.log('Sending POST https://collegeo.in/api/auth/login...');
  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('HTTP Status:', res.statusCode);
      console.log('Headers:', res.headers);
      console.log('Body:', body);
    });
  });

  req.on('error', console.error);
  req.write(data);
  req.end();
}

testLiveLogin();
