const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { randomInt, timingSafeEqual } = crypto;
const { pool } = require('../db/pool');
const { isEmail, isStrongPassword, normalizeEmail } = require('../utils/validation');
const { ensureUniversityCatalogSchema } = require('../utils/universities');
const { sendSystemEmail } = require('../utils/mailer');
const { buildOtpEmail, buildPasswordResetEmail } = require('../utils/emailTemplates');

const router = express.Router();
let authSchemaEnsured = false;

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 30 * 1000;
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const OTP_MAX_REQUESTS_PER_WINDOW = 5;
const OTP_REQUEST_WINDOW_MS = 10 * 60 * 1000;
const PASSWORD_POLICY_MESSAGE = 'Password must be at least 6 characters and include uppercase, lowercase, number, and special character.';

const LOGIN_LOCK_THRESHOLD = 5;
const LOGIN_LOCK_MINUTES = 15;
const LOGIN_FAILURE_DELAY_MS = 400;

const FORGOT_TOKEN_TTL_MS = 15 * 60 * 1000;

const REMEMBER_ME_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const STANDARD_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_STATE = new Map();

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const CAPTCHA_SECRET = process.env.AUTH_CAPTCHA_SECRET || process.env.SESSION_SECRET || 'dev-captcha-secret';
const OTP_QA_ASSIST_ENABLED = process.env.NODE_ENV !== 'production' && process.env.OTP_QA_ASSIST_ENABLED === 'true';
const OTP_QA_ASSIST_SECRET = String(process.env.OTP_QA_ASSIST_SECRET || '');
const OTP_MOBILE_ENABLED = String(process.env.OTP_MOBILE_ENABLED || '').toLowerCase() === 'true';

const otpStore = new Map();
const verifiedStore = new Map();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashSha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

async function revokeUserSessionsByUserId(userId, debugContext) {
  const normalizedId = Number(userId || 0);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) return 0;

  const result = await pool.query(
    `DELETE FROM session
     WHERE sess->>'userId' = $1
        OR sess->>'id' = $1
        OR sess #>> '{user,id}' = $1`,
    [String(normalizedId)]
  );

  if (process.env.DEBUG_AUTH === 'true') {
    console.log(`[${debugContext}] Deleted ${result.rowCount} sessions for userId ${normalizedId}`);
  }

  return result.rowCount;
}

function getRequesterIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.ip || 'unknown';
}

function getRateRecord(key) {
  const now = Date.now();
  const existing = RATE_LIMIT_STATE.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS, blockedUntil: 0 };
    RATE_LIMIT_STATE.set(key, fresh);
    return fresh;
  }
  return existing;
}

function enforceRateLimit(req, res, scope, maxAttempts = 20, blockMs = 10 * 60 * 1000) {
  const now = Date.now();
  const key = `${scope}:${getRequesterIp(req)}`;
  const record = getRateRecord(key);

  if (record.blockedUntil && record.blockedUntil > now) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  record.count += 1;
  if (record.count > maxAttempts) {
    record.blockedUntil = now + blockMs;
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  return null;
}

function buildCaptchaChallenge(req) {
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const expiresAt = Date.now() + CAPTCHA_TTL_MS;
  const nonce = crypto.randomBytes(12).toString('hex');
  const requesterIp = getRequesterIp(req);
  const payload = `${a}:${b}:${expiresAt}:${nonce}:${requesterIp}`;
  const signature = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('hex');
  return {
    question: `${a} + ${b} = ?`,
    a,
    b,
    expiresAt,
    nonce,
    signature
  };
}

function verifyCaptchaPayload(req, captcha) {
  // CRITICAL: Reject missing captcha (fail-closed, not fail-open)
  if (!captcha || typeof captcha !== 'object') return false;
  
  const answer = Number(captcha?.answer);
  const a = Number(captcha?.a);
  const b = Number(captcha?.b);
  const expiresAt = Number(captcha?.expiresAt);
  const nonce = String(captcha?.nonce || '');
  const signature = String(captcha?.signature || '');

  if (!Number.isInteger(answer) || !Number.isInteger(a) || !Number.isInteger(b) || !expiresAt || !nonce || !signature) {
    return false;
  }

  if (Date.now() > expiresAt) return false;

  const requesterIp = getRequesterIp(req);
  const payload = `${a}:${b}:${expiresAt}:${nonce}:${requesterIp}`;
  const expected = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('hex');
  if (expected !== signature) return false;

  return answer === a + b;
}

function getOtpStoreKey({ purpose, channel, target }) {
  return `${String(purpose || 'signup').toLowerCase()}_${String(channel || 'email').toLowerCase()}_${String(target || '').trim().toLowerCase()}`;
}

function clearExpiredOtps() {
  const now = Date.now();
  for (const [key, value] of otpStore.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) {
      otpStore.delete(key);
    }
  }
  for (const [key, value] of verifiedStore.entries()) {
    if (!value || Number(value.expiresAt || 0) <= now) {
      verifiedStore.delete(key);
    }
  }
}

async function sendOtpEmail({ otp, originalTarget, channel, purpose, targetEmail }) {
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const fallbackRecipient = isProduction ? '' : String(process.env.OTP_TEST_EMAIL || '').trim();
  const to = String(targetEmail || fallbackRecipient || '').trim();
  if (!to) {
    throw new Error('No OTP recipient available for this channel');
  }

  const template = buildOtpEmail({
    otp,
    target: originalTarget,
    channel,
    purpose,
    expiresMinutes: Math.floor(OTP_TTL_MS / (60 * 1000))
  });

  await sendSystemEmail({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html
  });
}

async function sendPasswordResetEmail({ email, token }) {
  const baseUrl = process.env.APP_BASE_URL || process.env.FRONTEND_PUBLIC_URL || 'https://college-o.vercel.app';
  const resetUrl = `${baseUrl.replace(/\/$/, '')}/login.html?resetToken=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const template = buildPasswordResetEmail({ resetUrl });

  await sendSystemEmail({
    to: email,
    subject: template.subject,
    text: template.text,
    html: template.html
  });
}

const DEFAULT_AUTH_EXPERIENCE_CONFIG = {
  modules: {
    leftPanel: true,
    loginForm: true,
    signupForm: true,
    supportModal: true
  },
  branding: {
    kicker: 'College OS Student Access',
    headline: 'A clean, secure student workspace for focused outcomes.',
    description: 'Sign in to continue your learning flow with profile-based recommendations, progress tracking, and verified access controls.',
    features: [
      'Secure sign-in with session protection',
      'Branch-aware learning paths',
      'Progress and mock analytics',
      'Certificates and achievement tracking'
    ],
    trustPoints: [
      'Trusted by colleges and independent learners',
      'OTP-ready account verification',
      'Privacy-first data handling'
    ],
    stats: {
      value: '10k+',
      label: 'active learners'
    }
  },
  text: {
    loginTitle: 'Welcome back',
    loginDescription: 'Sign in to continue with your personalized learning workspace.',
    signupTitle: 'Create your account',
    signupDescription: 'Set up your profile in a few steps to unlock a branch-aware dashboard.',
    supportLinkLabel: 'Need help? Contact support'
  },
  signup: {
    fieldVisibility: {
      mobile: true,
      category: true,
      branch: true,
      university: true,
      semester: true,
      targetCareerInterest: true
    }
  },
  support: {
    email: 'support@collegeos.in',
    whatsapp: '+919000000000',
    helpText: 'Share your issue and our team will help you quickly.'
  },
  legal: {
    termsTitle: 'Terms and Conditions',
    termsText: 'By creating an account, you agree to use College OS responsibly, provide accurate profile information, and follow platform policies for fair usage.',
    privacyTitle: 'Privacy Policy',
    privacyText: 'College OS uses your academic and usage data to personalize recommendations and improve learning outcomes. Your data is handled securely and is never sold to third parties.',
    updatedAt: 'March 2026'
  }
};

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (!isObject(base)) return typeof override === 'undefined' ? base : override;

  const output = { ...base };
  if (!isObject(override)) return output;

  Object.keys(override).forEach((key) => {
    output[key] = deepMerge(base[key], override[key]);
  });
  return output;
}

function toInt(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getVerifiedStoreKey({ purpose, channel, target }) {
  return getOtpStoreKey({ purpose, channel, target });
}

function createVerificationToken({ purpose, channel, target }) {
  const raw = crypto.randomBytes(24).toString('hex');
  const key = getVerifiedStoreKey({ purpose, channel, target });
  verifiedStore.set(key, {
    tokenHash: hashSha256(raw),
    expiresAt: Date.now() + OTP_TTL_MS
  });
  return raw;
}

function consumeVerificationToken({ purpose, channel, target, token }) {
  const key = getVerifiedStoreKey({ purpose, channel, target });
  const saved = verifiedStore.get(key);
  if (!saved || Date.now() > Number(saved.expiresAt || 0)) {
    verifiedStore.delete(key);
    return false;
  }
  const valid = saved.tokenHash === hashSha256(token || '');
  if (valid) verifiedStore.delete(key);
  return valid;
}

async function ensureAuthSchema() {
  if (authSchemaEnsured) return;

  await ensureUniversityCatalogSchema(pool);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS mobile VARCHAR(24),
      ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_mobile_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_failed_login_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS password_reset_token_hash VARCHAR(64),
      ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS university_id INTEGER REFERENCES universities(id),
      ADD COLUMN IF NOT EXISTS university_name VARCHAR(220),
      ADD COLUMN IF NOT EXISTS custom_university VARCHAR(220)
  `);

  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_mobile_unique_idx ON users(mobile) WHERE mobile IS NOT NULL');

  await pool.query(`
    ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS career_interest VARCHAR(200),
      ADD COLUMN IF NOT EXISTS weak_subjects JSONB,
      ADD COLUMN IF NOT EXISTS preferred_study_mode VARCHAR(50)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(120) PRIMARY KEY,
      value_json JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  authSchemaEnsured = true;
}

router.get('/config', async (_req, res) => {
  try {
    const [experienceResult, contactConfigResult] = await Promise.all([
      pool.query("SELECT value_json FROM platform_settings WHERE key = 'student_experience_config' LIMIT 1"),
      pool.query("SELECT value_json FROM platform_settings WHERE key = 'contact-us-config' LIMIT 1")
    ]);

    const experienceConfig = experienceResult.rows[0]?.value_json || {};
    const authConfig = deepMerge(DEFAULT_AUTH_EXPERIENCE_CONFIG, experienceConfig.auth || {});

    const contactConfig = contactConfigResult.rows[0]?.value_json || {};
    const contactChannels = Array.isArray(contactConfig.channels) ? contactConfig.channels : [];
    const emailChannel = contactChannels.find((item) => String(item?.label || '').toLowerCase().includes('email'));
    const whatsappChannel = contactChannels.find((item) => String(item?.label || '').toLowerCase().includes('whatsapp'));

    if (!authConfig.support.email && emailChannel?.value) {
      authConfig.support.email = String(emailChannel.value);
    }
    if (!authConfig.support.whatsapp && whatsappChannel?.value) {
      authConfig.support.whatsapp = String(whatsappChannel.value);
    }

    return res.json({ config: authConfig });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load authentication config' });
  }
});

router.get('/captcha/challenge', (req, res) => {
  // Light rate limiting on captcha requests (prevent script spam)
  const rateBlocked = enforceRateLimit(req, res, 'auth:captcha_challenge', 100, 1 * 60 * 1000);
  if (rateBlocked) return;
  
  const challenge = buildCaptchaChallenge(req);
  res.json({ captcha: challenge, expiresInSeconds: Math.floor(CAPTCHA_TTL_MS / 1000) });
});

router.post('/signup', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:signup', 12, 10 * 60 * 1000);
  if (rateBlocked) return;

  const {
    fullName,
    email,
    password,
    mobile,
    universityId,
    universityName,
    customUniversity,
    categoryId,
    branchId,
    semesterId,
    targetCareerInterest,
    verificationMethod,
    verificationToken,
    captcha
  } = req.body;

  if (!verifyCaptchaPayload(req, captcha)) {
    return res.status(400).json({ error: 'Captcha validation failed' });
  }

  if (!fullName || !isEmail(email) || !password) {
    return res.status(400).json({ error: 'Missing or invalid signup fields' });
  }

  if (!isStrongPassword(password)) {
    return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedMobile = String(mobile || '').trim() || null;
  const selectedVerificationMethod = String(verificationMethod || 'email').toLowerCase();
  if (!['email', 'mobile'].includes(selectedVerificationMethod)) {
    return res.status(400).json({ error: 'Invalid verification method' });
  }
  const selectedUniversityId = toInt(universityId, null);
  const typedUniversityName = String(universityName || '').trim();
  const typedCustomUniversity = String(customUniversity || '').trim();

  const verificationTarget = selectedVerificationMethod === 'mobile' ? normalizedMobile : normalizedEmail;
  if (!verificationTarget || !consumeVerificationToken({
    purpose: 'signup',
    channel: selectedVerificationMethod,
    target: verificationTarget,
    token: verificationToken
  })) {
    return res.status(400).json({ error: 'Please verify OTP before signup.' });
  }

  const client = await pool.connect();
  try {
    const exists = await client.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (exists.rowCount > 0) return res.status(409).json({ error: 'Email already registered' });

    if (normalizedMobile) {
      const mobileExists = await client.query('SELECT id FROM users WHERE mobile = $1', [normalizedMobile]);
      if (mobileExists.rowCount > 0) return res.status(409).json({ error: 'Mobile number already registered' });
    }

    let resolvedUniversityId = null;
    let resolvedUniversityName = '';
    let resolvedCustomUniversity = null;

    if (selectedUniversityId) {
      const university = await client.query(
        `SELECT id, name FROM universities WHERE id = $1 AND is_enabled = TRUE LIMIT 1`,
        [selectedUniversityId]
      );
      if (!university.rows[0]) {
        return res.status(400).json({ error: 'Please select your university' });
      }
      resolvedUniversityId = university.rows[0].id;
      resolvedUniversityName = university.rows[0].name;
    } else {
      const fallbackName = typedCustomUniversity || typedUniversityName;
      if (!fallbackName) {
        return res.status(400).json({ error: 'Please select your university' });
      }
      resolvedUniversityName = fallbackName;
      resolvedCustomUniversity = fallbackName;
    }

    const hash = await bcrypt.hash(password, 12);
    const referralCode = `COL${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const user = await client.query(
      `INSERT INTO users (full_name, email, mobile, college_name, university_id, university_name, custom_university, password_hash, referral_code, is_email_verified, is_mobile_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, full_name, email, mobile, college_name, university_id, university_name, custom_university, referral_code, role, subscription_tier`,
      [
        fullName,
        normalizedEmail,
        normalizedMobile,
        resolvedUniversityName,
        resolvedUniversityId,
        resolvedUniversityName,
        resolvedCustomUniversity,
        hash,
        referralCode,
        selectedVerificationMethod === 'email',
        selectedVerificationMethod === 'mobile'
      ]
    );

    await client.query(
      `INSERT INTO user_profiles (user_id, current_streak, category_id, branch_id, semester_id, career_interest, course_branch, semester)
       VALUES ($1, 0, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         category_id = COALESCE(EXCLUDED.category_id, user_profiles.category_id),
         branch_id = COALESCE(EXCLUDED.branch_id, user_profiles.branch_id),
         semester_id = COALESCE(EXCLUDED.semester_id, user_profiles.semester_id),
         career_interest = COALESCE(EXCLUDED.career_interest, user_profiles.career_interest),
         course_branch = COALESCE(EXCLUDED.course_branch, user_profiles.course_branch),
         semester = COALESCE(EXCLUDED.semester, user_profiles.semester)` ,
      [
        user.rows[0].id,
        toInt(categoryId),
        toInt(branchId),
        toInt(semesterId),
        targetCareerInterest || null,
        toInt(branchId) ? null : null,
        toInt(semesterId) ? null : null
      ]
    );

    await client.query(
      'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
      [user.rows[0].id, 'Welcome to College OS. Start your first quiz to earn XP.', 'welcome']
    );

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        return res.status(500).json({ error: 'Could not start secure session' });
      }

      req.session.userId = user.rows[0].id;
      req.session.user = user.rows[0];
      req.session.role = user.rows[0].role;
      req.session.cookie.maxAge = STANDARD_SESSION_MAX_AGE_MS;

      return res.status(201).json({ user: user.rows[0] });
    });
    return;
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:login', 25, 15 * 60 * 1000);
  if (rateBlocked) return;

  const { email, password, rememberMe, captcha } = req.body;
  if (!verifyCaptchaPayload(req, captcha)) {
    return res.status(400).json({ error: 'Captcha validation failed' });
  }

  if (!isEmail(email) || typeof password !== 'string' || !password) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const normalizedEmail = normalizeEmail(email);
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  if (!rows[0]) {
    await wait(LOGIN_FAILURE_DELAY_MS);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const userRow = rows[0];
  if (userRow.locked_until && new Date(userRow.locked_until).getTime() > Date.now()) {
    return res.status(429).json({ error: 'Too many failed attempts. Please try again later.' });
  }

  const valid = await bcrypt.compare(password, userRow.password_hash);
  if (!valid) {
    const failedAttempts = Number(userRow.failed_login_attempts || 0) + 1;
    const lockUntil = failedAttempts >= LOGIN_LOCK_THRESHOLD
      ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000)
      : null;

    await pool.query(
      `UPDATE users
       SET failed_login_attempts = $2,
           locked_until = $3,
           last_failed_login_at = NOW()
       WHERE id = $1`,
      [userRow.id, failedAttempts, lockUntil]
    );

    await wait(LOGIN_FAILURE_DELAY_MS);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = {
    id: userRow.id,
    full_name: userRow.full_name,
    email: userRow.email,
    college_name: userRow.college_name,
    university_id: userRow.university_id,
    university_name: userRow.university_name,
    custom_university: userRow.custom_university,
    referral_code: userRow.referral_code,
    role: userRow.role,
    subscription_tier: userRow.subscription_tier,
    payment_status: userRow.payment_status,
    subscription_expiry: userRow.subscription_expiry
  };

  await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL,
         last_login_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [user.id]
  );

  req.session.regenerate((sessionError) => {
    if (sessionError) {
      return res.status(500).json({ error: 'Could not start secure session' });
    }

    req.session.userId = user.id;
    req.session.user = user;
    req.session.role = user.role;
    req.session.cookie.maxAge = rememberMe ? REMEMBER_ME_MAX_AGE_MS : STANDARD_SESSION_MAX_AGE_MS;

    return res.json({ user });
  });
});

router.post('/verification/request', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:otp_request', 30, 15 * 60 * 1000);
  if (rateBlocked) return;

  const channel = String(req.body.channel || 'email').toLowerCase();
  const target = String(req.body.target || '').trim().toLowerCase();
  const purpose = String(req.body.purpose || 'signup').toLowerCase();
  const captcha = req.body.captcha;

  if (!verifyCaptchaPayload(req, captcha)) {
    return res.status(400).json({ error: 'Captcha validation failed' });
  }

  if (!['email', 'mobile'].includes(channel)) {
    return res.status(400).json({ error: 'channel must be email or mobile' });
  }

  if (!target) {
    return res.status(400).json({ error: 'target is required' });
  }

  if (channel === 'email' && !isEmail(target)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  if (channel === 'mobile' && !/^\d{10}$/.test(target)) {
    return res.status(400).json({ error: 'Valid 10-digit mobile is required' });
  }

  if (channel === 'mobile' && !OTP_MOBILE_ENABLED) {
    return res.status(400).json({ error: 'Mobile OTP is currently unavailable' });
  }

  clearExpiredOtps();
  const now = Date.now();
  const key = getOtpStoreKey({ purpose, channel, target });
  const existing = otpStore.get(key);

  // CRITICAL FIX: Enforce global per-IP rate limit (prevents spam of ANY target)
  const ipRateLimited = enforceRateLimit(req, res, 'auth:otp_request_global', 30, 15 * 60 * 1000);
  if (ipRateLimited) return;
  
  // Per-target rate limit (5 requests per 10min to SAME email/phone)
  if (existing?.requestWindowStartedAt && now - existing.requestWindowStartedAt <= OTP_REQUEST_WINDOW_MS) {
    if (Number(existing.requestCount || 0) >= OTP_MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({ error: 'Too many OTP requests. Please try again later.' });
    }
  }

  // Per-target rate limit (30-second cooldown between OTP sends)
  if (existing?.nextAllowedAt && now < existing.nextAllowedAt) {
    return res.status(429).json({ error: 'Please wait before requesting a new OTP/code', retryAfterMs: existing.nextAllowedAt - now });
  }

  const code = String(randomInt(100000, 999999));
  otpStore.set(key, {
    code,
    target,
    channel,
    purpose,
    attempts: 0,
    requestCount:
      existing && existing.requestWindowStartedAt && now - existing.requestWindowStartedAt <= OTP_REQUEST_WINDOW_MS
        ? Number(existing.requestCount || 0) + 1
        : 1,
    requestWindowStartedAt:
      existing && existing.requestWindowStartedAt && now - existing.requestWindowStartedAt <= OTP_REQUEST_WINDOW_MS
        ? existing.requestWindowStartedAt
        : now,
    expiresAt: now + OTP_TTL_MS,
    nextAllowedAt: now + OTP_RESEND_MS
  });

  try {
    if (purpose === 'login' && channel === 'email') {
      const existsResult = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [target]);
      if (existsResult.rowCount === 0) {
        otpStore.delete(key);
        return res.json({
          message: 'If the account exists, OTP has been sent.',
          expiresInSeconds: 300,
          resendAfterSeconds: 30
        });
      }
    }

    const targetEmail = channel === 'email' ? target : undefined;
    await sendOtpEmail({ otp: code, originalTarget: target, channel, purpose, targetEmail });
  } catch (error) {
    otpStore.delete(key);
    return res.status(500).json({ error: 'Failed to send OTP email. Please try again.' });
  }

  return res.json({
    message: 'OTP sent successfully',
    expiresInSeconds: 300,
    resendAfterSeconds: 30
  });
});

router.post('/verification/verify', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:otp_verify', 40, 15 * 60 * 1000);
  if (rateBlocked) return;

  const channel = String(req.body.channel || 'email').toLowerCase();
  const target = String(req.body.target || '').trim().toLowerCase();
  const purpose = String(req.body.purpose || 'signup').toLowerCase();
  const code = String(req.body.code || '').trim();

  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'OTP must be 6 digits' });

  clearExpiredOtps();
  const key = getOtpStoreKey({ purpose, channel, target });
  const record = otpStore.get(key);

  if (!record) return res.status(400).json({ error: 'Verification code not requested' });
  if (Date.now() > Number(record.expiresAt || 0)) {
    otpStore.delete(key);
    return res.status(400).json({ error: 'Verification code expired' });
  }
  
  let codeMatch = false;
  try {
    // Timing-safe comparison to prevent timing attacks
    codeMatch = timingSafeEqual(
      Buffer.from(record.code || ''),
      Buffer.from(code || '')
    );
  } catch {
    // Buffer lengths don't match
    codeMatch = false;
  }
  
  if (!codeMatch) {
    record.attempts = Number(record.attempts || 0) + 1;
    if (record.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      otpStore.delete(key);
      return res.status(429).json({ error: 'Too many incorrect attempts. Request a new OTP.' });
    }
    otpStore.set(key, record);
    return res.status(400).json({ error: 'Invalid verification code' });
  }

  otpStore.delete(key);
  const verificationToken = createVerificationToken({ purpose, channel, target });
  return res.json({ message: 'Verification successful', verified: true, verificationToken });
});

router.post('/qa/otp-assist', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:qa_otp_assist', 20, 10 * 60 * 1000);
  if (rateBlocked) return;

  if (!OTP_QA_ASSIST_ENABLED) {
    return res.status(404).json({ error: 'OTP QA assist is disabled' });
  }

  const secret = String(req.body.secret || req.headers['x-otp-qa-secret'] || '').trim();
  if (!OTP_QA_ASSIST_SECRET || secret !== OTP_QA_ASSIST_SECRET) {
    return res.status(403).json({ error: 'Invalid QA assist secret' });
  }

  const channel = String(req.body.channel || 'email').toLowerCase();
  const target = String(req.body.target || '').trim().toLowerCase();
  const purpose = String(req.body.purpose || 'signup').toLowerCase();
  const validPurposes = new Set(['signup', 'login', 'password_reset']);

  if (!target || !['email', 'mobile'].includes(channel) || !validPurposes.has(purpose)) {
    return res.status(400).json({ error: 'channel, target and valid purpose are required' });
  }

  clearExpiredOtps();
  const key = getOtpStoreKey({ purpose, channel, target });
  const record = otpStore.get(key);
  if (!record) return res.status(404).json({ error: 'No active OTP request for this target' });

  otpStore.delete(key);
  const verificationToken = createVerificationToken({ purpose, channel, target });

  return res.json({
    verified: true,
    verificationToken,
    mode: 'qa-assist',
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000)
  });
});

router.post('/login/email-otp', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:login_email_otp', 25, 15 * 60 * 1000);
  if (rateBlocked) return;

  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  const captcha = req.body.captcha;

  if (!verifyCaptchaPayload(req, captcha)) {
    return res.status(400).json({ error: 'Captcha validation failed' });
  }

  if (!isEmail(email)) return res.status(400).json({ error: 'Valid email is required' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'OTP must be 6 digits' });

  // Verify OTP
  clearExpiredOtps();
  const key = getOtpStoreKey({ purpose: 'login', channel: 'email', target: email });
  const record = otpStore.get(key);

  if (!record) return res.status(400).json({ error: 'Invalid email or OTP' });
  if (Date.now() > Number(record.expiresAt || 0)) {
    otpStore.delete(key);
    return res.status(400).json({ error: 'Invalid email or OTP' });
  }
  
  let codeMatch = false;
  try {
    // Timing-safe comparison to prevent timing attacks
    codeMatch = timingSafeEqual(
      Buffer.from(record.code || ''),
      Buffer.from(code || '')
    );
  } catch {
    // Buffer lengths don't match
    codeMatch = false;
  }
  
  if (!codeMatch) {
    record.attempts = Number(record.attempts || 0) + 1;
    if (record.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      otpStore.delete(key);
      return res.status(429).json({ error: 'Too many incorrect attempts. Request a new OTP.' });
    }
    otpStore.set(key, record);
    return res.status(400).json({ error: 'Invalid email or OTP' });
  }

  otpStore.delete(key);

  // Look up user
  const { rows } = await pool.query('SELECT id, full_name, email, role, subscription_tier, payment_status, subscription_expiry, college_name, university_id, university_name, custom_university, referral_code FROM users WHERE email = $1', [email]);
  
  if (!rows[0]) return res.status(401).json({ error: 'Invalid email or OTP' });

  const user = {
    id: rows[0].id,
    full_name: rows[0].full_name,
    email: rows[0].email,
    college_name: rows[0].college_name,
    university_id: rows[0].university_id,
    university_name: rows[0].university_name,
    custom_university: rows[0].custom_university,
    referral_code: rows[0].referral_code,
    role: rows[0].role,
    subscription_tier: rows[0].subscription_tier,
    payment_status: rows[0].payment_status,
    subscription_expiry: rows[0].subscription_expiry
  };

  await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL,
         last_login_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [user.id]
  );

  req.session.regenerate((sessionError) => {
    if (sessionError) {
      return res.status(500).json({ error: 'Could not start secure session' });
    }
    req.session.userId = user.id;
    req.session.user = user;
    req.session.role = user.role;
    req.session.cookie.maxAge = STANDARD_SESSION_MAX_AGE_MS;
    return res.json({ user, message: 'OTP login successful' });
  });
});

router.post('/password/forgot', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:forgot_password', 12, 15 * 60 * 1000);
  if (rateBlocked) return;

  const email = normalizeEmail(req.body?.email || '');
  const captcha = req.body?.captcha;
  if (!verifyCaptchaPayload(req, captcha)) {
    return res.status(400).json({ error: 'Captcha validation failed' });
  }

  // CRITICAL FIX: Add per-email rate limiting (max 3 per 30 min per email)
  const emailKey = `forgot:email:${email}`;
  const now = Date.now();
  const emailRecord = RATE_LIMIT_STATE.get(emailKey);
  
  if (!emailRecord || emailRecord.resetAt <= now) {
    RATE_LIMIT_STATE.set(emailKey, { count: 1, resetAt: now + (30 * 60 * 1000), blockedUntil: 0 });
  } else if (emailRecord.count >= 3) {
    // Still return success message to avoid email enumeration
    return res.json({ message: 'If an account exists, a reset link has been sent.' });
  } else {
    emailRecord.count += 1;
  }

  if (!isEmail(email)) {
    return res.json({ message: 'If an account exists, a reset link has been sent.' });
  }

  const userResult = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
  if (userResult.rowCount === 0) {
    return res.json({ message: 'If an account exists, a reset link has been sent.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSha256(token);
  const expiresAt = new Date(Date.now() + FORGOT_TOKEN_TTL_MS);

  await pool.query(
    `UPDATE users
     SET password_reset_token_hash = $2,
         password_reset_expires_at = $3
     WHERE id = $1`,
    [userResult.rows[0].id, tokenHash, expiresAt]
  );

  try {
    await sendPasswordResetEmail({ email, token });
  } catch {
    // Keep generic response to prevent account and infrastructure enumeration.
  }

  return res.json({ message: 'If an account exists, a reset link has been sent.' });
});

router.post('/password/reset', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:reset_password', 20, 15 * 60 * 1000);
  if (rateBlocked) return;

  const email = normalizeEmail(req.body?.email || '');
  const token = String(req.body?.token || '').trim();
  const newPassword = String(req.body?.newPassword || '');
  const captcha = req.body?.captcha;

  if (!verifyCaptchaPayload(req, captcha)) {
    return res.status(400).json({ error: 'Captcha validation failed' });
  }

  if (!isEmail(email) || !token) {
    return res.status(400).json({ error: 'Invalid reset request' });
  }

  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
  }

  const tokenHash = hashSha256(token);
  const userResult = await pool.query(
    `SELECT id, password_reset_expires_at
     FROM users
     WHERE email = $1 AND password_reset_token_hash = $2
     LIMIT 1`,
    [email, tokenHash]
  );

  if (userResult.rowCount === 0) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const expiresAt = userResult.rows[0].password_reset_expires_at ? new Date(userResult.rows[0].password_reset_expires_at) : null;
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `UPDATE users
     SET password_hash = $2,
         password_changed_at = NOW(),
         password_reset_token_hash = NULL,
         password_reset_expires_at = NULL,
         failed_login_attempts = 0,
         locked_until = NULL
     WHERE id = $1`,
    [userResult.rows[0].id, newHash]
  );

  try {
    await revokeUserSessionsByUserId(userResult.rows[0].id, 'password/reset');
  } catch (error) {
    // Non-fatal in local/in-memory modes, but log if debugging
    if (process.env.DEBUG_AUTH === 'true') {
      console.error('[password/reset] Session deletion error:', error.message);
    }
  }

  return res.json({ ok: true, message: 'Password reset successful. Please login again.' });
});

router.post('/logout-all', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const userId = req.session.userId;
  
  try {
    await revokeUserSessionsByUserId(userId, 'logout-all');
  } catch (error) {
    // Non-fatal in local/in-memory modes without real session table
    if (process.env.DEBUG_AUTH === 'true') {
      console.error('[logout-all] Session deletion error:', error.message);
    }
  }

  req.session.destroy((destroyError) => {
    if (destroyError && process.env.DEBUG_AUTH === 'true') {
      console.error('[logout-all] Session destroy error:', destroyError.message);
    }
    res.clearCookie('college_os_sid');
    res.json({ ok: true, message: 'Logged out from all devices' });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('college_os_sid');
    res.json({ ok: true });
  });
});

router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const { rows } = await pool.query(
    `SELECT id, full_name, email, mobile, college_name, university_id, university_name, custom_university, role, subscription_tier, payment_status, subscription_started_at, subscription_expiry,
            is_email_verified, is_mobile_verified, last_login_at
     FROM users
     WHERE id = $1`,
    [req.session.userId]
  );
  return res.json({ user: rows[0] || null });
});

module.exports = router;
module.exports.ensureAuthSchema = ensureAuthSchema;
