require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../server/db/pool');

async function upsertUser(u) {
  const hash = await bcrypt.hash(u.pass, 10);
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [u.email]);

  let userId;
  if (existing.rowCount) {
    userId = existing.rows[0].id;
    const nextTier = u.role === 'admin' ? 'premium' : 'free';
    const nextPayment = u.role === 'admin' ? 'paid' : 'pending';
    await pool.query(
      `UPDATE users
       SET full_name = $1,
           password_hash = $2,
           role = $3,
           college_name = $4,
           subscription_tier = $5,
           payment_status = $6,
           support_suspended = FALSE,
           support_suspended_until = NULL,
           support_suspend_reason = NULL
       WHERE id = $7`,
      [u.full, hash, u.role, u.college, nextTier, nextPayment, userId]
    );
  } else {
    const nextTier = u.role === 'admin' ? 'premium' : 'free';
    const nextPayment = u.role === 'admin' ? 'paid' : 'pending';
    const expiry = u.role === 'admin' ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 5) : null;
    const insert = await pool.query(
      `INSERT INTO users (
         full_name, email, college_name, password_hash, referral_code, role,
         subscription_tier, payment_status, subscription_expiry, support_suspended
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, FALSE
       )
       RETURNING id`,
      [
        u.full,
        u.email,
        u.college,
        hash,
        `QA${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        u.role,
        nextTier,
        nextPayment,
        expiry
      ]
    );
    userId = insert.rows[0].id;
  }

  await pool.query(
    `INSERT INTO user_profiles (user_id, category_id, branch_id, semester_id, college_id, course_id, year_id, is_helper, helper_badge, support_points_earned, onboarding_completed)
     VALUES ($1, $2, $3, $4, 1, 1, 1, $5, $6, 0, TRUE)
     ON CONFLICT (user_id)
     DO UPDATE SET
       category_id = EXCLUDED.category_id,
       branch_id = EXCLUDED.branch_id,
       semester_id = EXCLUDED.semester_id,
       college_id = 1,
       course_id = 1,
       year_id = 1,
       is_helper = EXCLUDED.is_helper,
       helper_badge = EXCLUDED.helper_badge,
       onboarding_completed = TRUE`,
    [
      userId,
      u.cat,
      u.branch,
      u.sem,
      u.email.includes('helper') ? true : false,
      u.email.includes('helper') ? 'New Helper' : null
    ]
  );

  return userId;
}

async function main() {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS support_suspended BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS support_suspended_until TIMESTAMP,
      ADD COLUMN IF NOT EXISTS support_suspend_reason TEXT,
      ADD COLUMN IF NOT EXISTS helper_level VARCHAR(120)
  `);

  await pool.query(`
    ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS is_helper BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS helper_badge VARCHAR(120),
      ADD COLUMN IF NOT EXISTS support_points_earned INTEGER DEFAULT 0
  `);

  const users = [
    { full: 'QA Student One', email: 'qa.student1@collegeos.test', pass: 'QaPass#123', role: 'student', college: 'QA College', cat: 1, branch: 1, sem: 1 },
    { full: 'QA Student Two', email: 'qa.student2@collegeos.test', pass: 'QaPass#123', role: 'student', college: 'QA College', cat: 1, branch: 2, sem: 1 },
    { full: 'QA Helper One', email: 'qa.helper1@collegeos.test', pass: 'QaPass#123', role: 'student', college: 'QA College', cat: 1, branch: 1, sem: 1 },
    { full: 'QA Admin', email: 'qa.admin@collegeos.test', pass: 'QaAdmin#123', role: 'admin', college: 'QA College', cat: 1, branch: 1, sem: 1 }
  ];

  for (const u of users) {
    const id = await upsertUser(u);
    console.log(`${u.email}:${id}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
