require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../server/db/pool');

async function resetPassword() {
  const hash = await bcrypt.hash('Admin@123456', 10);
  await pool.query("UPDATE users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL WHERE email = 'admin@collegeo.in'", [hash]);
  console.log('Password for admin@collegeo.in reset to Admin@123456');
  process.exit(0);
}

resetPassword().catch(console.error);
