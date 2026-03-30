const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');

async function ensureAdminAccount() {
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS stream VARCHAR(120)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS year_of_study VARCHAR(40)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'pending'");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expiry TIMESTAMP');
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS upi_payment_requests (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      payment_ref VARCHAR(80) UNIQUE NOT NULL,
      plan_cycle VARCHAR(20) NOT NULL,
      amount_inr NUMERIC(10,2) NOT NULL,
      upi_id VARCHAR(120) NOT NULL,
      upi_uri TEXT NOT NULL,
      qr_image_url TEXT,
      transaction_id VARCHAR(120),
      status VARCHAR(30) NOT NULL DEFAULT 'initiated',
      gateway_payload JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS membership_payment_requests (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      full_name VARCHAR(120) NOT NULL,
      email VARCHAR(180) NOT NULL,
      payment_method VARCHAR(60) NOT NULL,
      transaction_id VARCHAR(120) NOT NULL,
      screenshot_url TEXT,
      payment_date DATE NOT NULL,
      amount_inr NUMERIC(10,2) NOT NULL DEFAULT 49,
      note TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      approved_at TIMESTAMP,
      expiry_date TIMESTAMP,
      approved_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );

  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS membership_payment_unique_txn ON membership_payment_requests (transaction_id)');

  // Ensure auxiliary tables that are not guaranteed to exist in all DB environments
  await pool.query(`
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      title VARCHAR(200) NOT NULL,
      category VARCHAR(80) NOT NULL,
      subject VARCHAR(120) NOT NULL,
      description TEXT,
      file_url TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_quizzes (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      title VARCHAR(200) NOT NULL,
      subject VARCHAR(120) NOT NULL,
      description TEXT,
      time_limit INTEGER,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_quiz_questions (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      quiz_id INTEGER NOT NULL REFERENCES admin_quizzes(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_answer VARCHAR(1) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
      question_order INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_roadmaps (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      title VARCHAR(200) NOT NULL,
      track VARCHAR(80) NOT NULL,
      level VARCHAR(30),
      duration VARCHAR(60),
      description TEXT,
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(120) PRIMARY KEY,
      value_json JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      subject VARCHAR(220) NOT NULL,
      category VARCHAR(80) NOT NULL DEFAULT 'General Query',
      message TEXT NOT NULL,
      priority VARCHAR(10) NOT NULL DEFAULT 'medium',
      status VARCHAR(20) NOT NULL DEFAULT 'open',
      admin_reply TEXT,
      replied_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Dashboard Manager tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_sections (
      id SERIAL PRIMARY KEY,
      section_key VARCHAR(100) UNIQUE NOT NULL,
      section_name VARCHAR(200) NOT NULL,
      icon VARCHAR(100),
      description TEXT,
      is_enabled BOOLEAN DEFAULT TRUE,
      category VARCHAR(50) DEFAULT 'main',
      default_position INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_section_visibility (
      id SERIAL PRIMARY KEY,
      section_id INTEGER NOT NULL REFERENCES dashboard_sections(id) ON DELETE CASCADE,
      branch_id VARCHAR(100),
      membership_tier VARCHAR(50),
      is_visible BOOLEAN DEFAULT TRUE,
      position_order INTEGER DEFAULT 0,
      title_override VARCHAR(200),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_section_visibility_unique
      ON dashboard_section_visibility (section_id, COALESCE(branch_id, ''), COALESCE(membership_tier, ''))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_announcements (
      id SERIAL PRIMARY KEY,
      title VARCHAR(300) NOT NULL,
      message TEXT,
      banner_type VARCHAR(50) DEFAULT 'info',
      target_branches JSONB,
      target_tiers JSONB,
      is_active BOOLEAN DEFAULT TRUE,
      start_date TIMESTAMP,
      end_date TIMESTAMP,
      position INTEGER DEFAULT 0,
      icon VARCHAR(100),
      action_url VARCHAR(500),
      action_label VARCHAR(100),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_hero_config (
      id SERIAL PRIMARY KEY,
      title VARCHAR(300),
      subtitle VARCHAR(500),
      featured_message TEXT,
      featured_image_url TEXT,
      cta_primary_label VARCHAR(100),
      cta_primary_url VARCHAR(500),
      cta_secondary_label VARCHAR(100),
      cta_secondary_url VARCHAR(500),
      background_gradient VARCHAR(200),
      is_active BOOLEAN DEFAULT TRUE,
      branch_id VARCHAR(100),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_stats_config (
      id SERIAL PRIMARY KEY,
      stat_key VARCHAR(100) UNIQUE NOT NULL,
      stat_label VARCHAR(200),
      icon VARCHAR(100),
      is_enabled BOOLEAN DEFAULT TRUE,
      is_visible_free BOOLEAN DEFAULT TRUE,
      is_visible_premium BOOLEAN DEFAULT TRUE,
      position_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_quick_access (
      id SERIAL PRIMARY KEY,
      card_key VARCHAR(100) UNIQUE NOT NULL,
      card_label VARCHAR(200),
      icon VARCHAR(100),
      url VARCHAR(500),
      is_enabled BOOLEAN DEFAULT TRUE,
      is_visible_free BOOLEAN DEFAULT TRUE,
      is_visible_premium BOOLEAN DEFAULT TRUE,
      position_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_recommendations (
      id SERIAL PRIMARY KEY,
      content_type VARCHAR(50),
      content_id INTEGER,
      title VARCHAR(300),
      branch_id VARCHAR(100),
      membership_tier VARCHAR(50),
      is_featured BOOLEAN DEFAULT FALSE,
      position_order INTEGER DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

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

module.exports = { ensureAdminAccount };
