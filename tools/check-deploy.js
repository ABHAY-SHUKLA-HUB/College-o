const https = require('https');

function checkLimit() {
  const req = https.request({
    hostname: 'collegeo.in',
    port: 443,
    path: '/api/health',
    method: 'GET',
    headers: {
      'User-Agent': 'DeployWatcher/1.0'
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('Deploy check:', res.statusCode, 'X-RateLimit-Limit:', res.headers['x-ratelimit-limit']);
    });
  });
  req.on('error', console.error);
  req.end();
}

checkLimit();
