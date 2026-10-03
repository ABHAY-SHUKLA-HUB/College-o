const https = require('https');
const http = require('http');
const dns = require('dns').promises;

const DOMAIN = 'collegeo.in';
const WWW_DOMAIN = 'www.collegeo.in';
const RENDER_HOST = 'college-o.onrender.com';

const liveResults = {
  dns: {},
  httpChecks: [],
  apiChecks: [],
  headerAudit: {},
  pwaChecks: []
};

async function checkDns(domain) {
  try {
    const aRecords = await dns.resolve4(domain).catch(() => []);
    const cnameRecords = await dns.resolveCname(domain).catch(() => []);
    return { domain, aRecords, cnameRecords, status: (aRecords.length || cnameRecords.length) ? 'RESOLVED' : 'UNRESOLVED' };
  } catch (err) {
    return { domain, error: err.message, status: 'FAILED' };
  }
}

function probeUrl(url, method = 'GET', headers = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        ...headers
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({
          url,
          statusCode: res.statusCode,
          headers: res.headers,
          bodyLength: data.length,
          bodyPreview: data.slice(0, 200),
          json
        });
      });
    });

    req.on('error', (err) => resolve({ url, statusCode: 0, error: err.message, headers: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ url, statusCode: 408, error: 'Timeout', headers: {} }); });
    req.end();
  });
}

async function runLiveVerification() {
  console.log('=== STARTING LIVE DOMAIN AND API VERIFICATION ===\n');

  // 1. DNS Resolution
  console.log('1. Checking DNS for collegeo.in and www.collegeo.in...');
  liveResults.dns['root'] = await checkDns(DOMAIN);
  liveResults.dns['www'] = await checkDns(WWW_DOMAIN);
  console.log('Root DNS:', liveResults.dns['root']);
  console.log('WWW DNS:', liveResults.dns['www']);

  // 2. HTTP & HTTPS endpoints on collegeo.in
  const pagesToTest = [
    'https://collegeo.in/',
    'http://collegeo.in/',
    'https://www.collegeo.in/',
    'https://collegeo.in/login',
    'https://collegeo.in/pricing',
    'https://collegeo.in/about-us',
    'https://collegeo.in/contact-us',
    'https://collegeo.in/help-center',
    'https://collegeo.in/manifest.json',
    'https://collegeo.in/sw.js'
  ];

  console.log('\n2. Testing Public HTTP/HTTPS Page Endpoints on collegeo.in...');
  for (const p of pagesToTest) {
    const res = await probeUrl(p);
    liveResults.httpChecks.push(res);
    console.log(`${p} -> Status: ${res.statusCode} (Length: ${res.bodyLength || 0}) ${res.error || ''}`);
  }

  // 3. API Proxy Endpoints on collegeo.in
  const apisToTest = [
    'https://collegeo.in/api/health',
    'https://collegeo.in/api/auth/config',
    'https://collegeo.in/api/academics/categories',
    'https://collegeo.in/api/academics/colleges',
    'https://collegeo.in/api/academics/courses',
    'https://collegeo.in/api/academics/years',
    'https://collegeo.in/api/academics/branches',
    'https://collegeo.in/api/academics/semesters',
    'https://collegeo.in/api/academics/subjects?branchId=1&semesterId=1',
    'https://collegeo.in/api/subscriptions/config',
    'https://collegeo.in/api/certificates/verify/12345'
  ];

  console.log('\n3. Testing API Endpoints via collegeo.in...');
  for (const api of apisToTest) {
    const res = await probeUrl(api, 'GET', { 'Accept': 'application/json' });
    liveResults.apiChecks.push(res);
    console.log(`${api} -> Status: ${res.statusCode} ${res.json ? JSON.stringify(res.json).slice(0, 80) : res.bodyPreview?.slice(0, 80) || res.error || ''}`);
  }

  // 4. Also probe direct backend instance for comparison telemetry
  console.log('\n4. Probing Live Cloud Host (college-o.onrender.com)...');
  const renderHealth = await probeUrl(`https://${RENDER_HOST}/api/health`);
  const renderRoot = await probeUrl(`https://${RENDER_HOST}/`);
  const renderPricing = await probeUrl(`https://${RENDER_HOST}/pricing`);
  console.log(`Render /api/health -> Status: ${renderHealth.statusCode}`, renderHealth.json);
  console.log(`Render / -> Status: ${renderRoot.statusCode}, size: ${renderRoot.bodyLength}`);
  console.log(`Render /pricing -> Status: ${renderPricing.statusCode}, size: ${renderPricing.bodyLength}`);

  const fs = require('fs');
  fs.writeFileSync('reports/final_live_verification.json', JSON.stringify(liveResults, null, 2));
  console.log('\nVerification raw telemetry saved to reports/final_live_verification.json');
}

runLiveVerification().catch(console.error);
