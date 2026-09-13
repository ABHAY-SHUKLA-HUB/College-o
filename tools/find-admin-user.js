require('dotenv').config();
const { pool } = require('../server/db/pool');

async function findAdmin() {
  const { rows } = await pool.query("SELECT id, email, full_name, role FROM users WHERE role = 'admin' OR role = 'super_admin' OR email LIKE '%admin%'");
  console.log('Admin users:', rows);
  process.exit(0);
}

findAdmin().catch(console.error);
