const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');

let performanceBootstrapPromise = null;

async function ensurePerformanceIndexes() {
  if (performanceBootstrapPromise) return performanceBootstrapPromise;

  performanceBootstrapPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid varchar NOT NULL COLLATE "default",
        sess json NOT NULL,
        expire timestamp(6) NOT NULL,
        CONSTRAINT session_pkey PRIMARY KEY (sid)
      ) WITH (OIDS=FALSE);

      CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
      CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles (user_id);
      CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts (user_id, attempted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mock_test_attempts_user_created ON mock_test_attempts (user_id, attempted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notes_created_by_created_at ON notes (created_by, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_certificates_user_created ON certificates (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_roadmaps_user_updated ON roadmaps (user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_membership_payments_status_submitted ON membership_payment_requests (status, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_academic_categories_active_order ON academic_categories (is_active, display_order);
      CREATE INDEX IF NOT EXISTS idx_academic_branches_category_active_order ON academic_branches (category_id, is_active, display_order);
      CREATE INDEX IF NOT EXISTS idx_academic_semesters_active_order ON academic_semesters (is_active, display_order);
      CREATE INDEX IF NOT EXISTS idx_announcements_status_branch_created ON announcements (status, branch_id, created_at DESC);
    `);
  })();

  return performanceBootstrapPromise;
}

async function ensureAdminAccount() {
  const email = (process.env.ADMIN_EMAIL || 'admin@collegeos.in').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin1234';
  const fullName = process.env.ADMIN_NAME || 'College OS Admin';
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (isProduction) {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required in production.');
    }
    if (password === 'admin1234' || email === 'admin@collegeos.in') {
      throw new Error('Default admin credentials are not allowed in production.');
    }
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount > 0) {
    await pool.query(
      "UPDATE users SET role = 'admin', subscription_tier = 'premium', payment_status = 'paid', subscription_expiry = NOW() + INTERVAL '10 years' WHERE email = $1",
      [email]
    );
    return;
  }

  const referralToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const referralCode = `ADMIN-${referralToken}`.slice(0, 20);

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (full_name, email, college_name, password_hash, referral_code, role, subscription_tier, payment_status, subscription_expiry)
     VALUES ($1, $2, $3, $4, $5, 'admin', 'premium', 'paid', NOW() + INTERVAL '10 years')`,
    [fullName, email, 'College OS', hash, referralCode]
  );
}

module.exports = { ensureAdminAccount, ensurePerformanceIndexes };
