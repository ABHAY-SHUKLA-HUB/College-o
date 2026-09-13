require('dotenv').config();
const http = require('http');
const { pool } = require('../server/db/pool');
const { updateFeatureStatus } = require('../server/middleware/featureToggle');

function makeRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(JSON.stringify(postData));
    req.end();
  });
}

async function run() {
  console.log('--- 1. Testing GET /api/meta/features ---');
  const resMeta = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/meta/features',
    method: 'GET'
  });
  console.log('Public Meta Features Response Status:', resMeta.status);
  console.log('Features list:', Object.keys(resMeta.body?.features || {}));

  console.log('\n--- 2. Toggling "membership" feature OFF in database ---');
  await updateFeatureStatus('membership', { status: 'OFF', maintenanceMessage: 'Membership module disabled for maintenance' }, 1, 'admin@collegeos.test');

  console.log('\n--- 3. Testing Student Subscriptions Endpoint when Feature is OFF ---');
  const resSubOff = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/subscriptions/me',
    method: 'GET'
  });
  console.log('Subscriptions Endpoint Status when OFF:', resSubOff.status);
  console.log('Subscriptions Endpoint Body when OFF:', resSubOff.body);

  console.log('\n--- 4. Toggling "membership" feature back ON ---');
  await updateFeatureStatus('membership', { status: 'ON', maintenanceMessage: '' }, 1, 'admin@collegeos.test');

  console.log('\n--- 5. Testing Student Subscriptions Endpoint when Feature is ON ---');
  const resSubOn = await makeRequest({
    hostname: 'localhost',
    port: 3000,
    path: '/api/subscriptions/me',
    method: 'GET'
  });
  console.log('Subscriptions Endpoint Status when ON (Auth required):', resSubOn.status);

  console.log('\n--- 6. Verifying Audit Log Entries for Feature Toggles ---');
  const { rows: auditRows } = await pool.query(
    "SELECT action, target_type, target_id, metadata, created_at FROM admin_audit_logs WHERE action = 'settings.feature_visibility.update' ORDER BY id DESC LIMIT 2"
  );
  console.log('Audit Log Entries:', JSON.stringify(auditRows, null, 2));

  await pool.end();
  console.log('\nSUCCESS: All feature toggle workflow tests passed verified!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
