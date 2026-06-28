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

const RESET_TOKEN_TTL_MS = 20 * 60 * 1000;

const REMEMBER_ME_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const STANDARD_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_STATE = new Map();

const IS_DEV = String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
const DEV_RATE_LIMIT_MULTIPLIER = IS_DEV ? Number(process.env.AUTH_RATE_LIMIT_DEV_MULTIPLIER || 4) : 1;

const CAPTCHA_TTL_MS = 5 * 60 * 1000;
const CAPTCHA_SECRET = process.env.AUTH_CAPTCHA_SECRET || process.env.SESSION_SECRET || 'dev-captcha-secret';
const CAPTCHA_DEV_BYPASS = String(process.env.AUTH_CAPTCHA_DEV_BYPASS || '').toLowerCase() === 'true';
const CAPTCHA_CHALLENGE_CACHE_CONTROL = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0';
const OTP_QA_ASSIST_ENABLED = process.env.NODE_ENV !== 'production' && process.env.OTP_QA_ASSIST_ENABLED === 'true';
const OTP_QA_ASSIST_SECRET = String(process.env.OTP_QA_ASSIST_SECRET || '');
const OTP_MOBILE_ENABLED = String(process.env.OTP_MOBILE_ENABLED || '').toLowerCase() === 'true';
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
const GOOGLE_CALLBACK_URL = String(process.env.GOOGLE_CALLBACK_URL || process.env.GOOGLE_OAUTH_CALLBACK_URL || '').trim();
const FRONTEND_URL = String(process.env.FRONTEND_URL || process.env.FRONTEND_PUBLIC_URL || process.env.APP_BASE_URL || 'http://localhost:3000').trim() || 'http://localhost:3000';
const GOOGLE_OAUTH_CLIENT_ID = GOOGLE_CLIENT_ID;
const GOOGLE_OAUTH_SCOPES = 'openid email profile';

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
  return req.ip || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function setCacheHeaders(res, value) {
  const maxAge = Number(value || 0);
  if (Number.isFinite(maxAge) && maxAge > 0) {
    res.setHeader('Cache-Control', `private, max-age=${maxAge}, stale-while-revalidate=${Math.max(maxAge * 3, 30)}`);
  } else {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  res.setHeader('Vary', 'Origin, Cookie');
}

function sendRateLimitedResponse(res, retryAfterSeconds, message) {
  const retryAfter = Math.max(1, Math.ceil(Number(retryAfterSeconds || 0)));
  res.setHeader('Retry-After', String(retryAfter));
  console.warn('[RATE_LIMIT_RESPONSE]', { retryAfter, message });
  return res.status(429).json({
    success: false,
    ok: false,
    code: 'RATE_LIMITED',
    message: message || `Too many requests. Please wait ${retryAfter} seconds.`,
    retryAfter
  });
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
    const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
    console.warn('[RATE_LIMIT] blocked', {
      route: req.path,
      method: req.method,
      ip: getRequesterIp(req),
      userId: req.session?.userId || null,
      origin: req.headers.origin || '',
      userAgent: req.headers['user-agent'] || '',
      key,
      retryAfter
    });
    return sendRateLimitedResponse(res, retryAfter);
  }

  record.count += 1;
  if (record.count > maxAttempts) {
    record.blockedUntil = now + blockMs;
    const retryAfter = Math.ceil(blockMs / 1000);
    console.warn('[RATE_LIMIT] blocked', {
      route: req.path,
      method: req.method,
      ip: getRequesterIp(req),
      userId: req.session?.userId || null,
      origin: req.headers.origin || '',
      userAgent: req.headers['user-agent'] || '',
      key,
      retryAfter
    });
    return sendRateLimitedResponse(res, retryAfter);
  }

  return null;
}

function buildCaptchaChallenge(_req) {
  // Do NOT include requester IP in the signed payload. Signing IP caused
  // brittle verification failures when proxies/multiple XFF entries changed
  // the apparent client IP between requests. Using nonce+expires is sufficient
  // to prevent trivial replay while keeping verification reliable.
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const expiresAt = Date.now() + CAPTCHA_TTL_MS;
  const nonce = crypto.randomBytes(12).toString('hex');
  const payload = `${a}:${b}:${expiresAt}:${nonce}`;
  const signature = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest('hex');
  return {
    id: nonce,
    question: `${a} + ${b} = ?`,
    challengeText: `${a} + ${b} = ?`,
    prompt: `${a} + ${b} = ?`,
    captchaText: `${a} + ${b} = ?`,
    a,
    b,
    expiresAt,
    nonce,
    signature
  };
}

function verifyCaptchaPayload(req, captcha) {
  // CRITICAL: Reject missing captcha (fail-closed, not fail-open)
  if (!captcha || typeof captcha !== 'object') {
    if (process.env.NODE_ENV !== 'production' && CAPTCHA_DEV_BYPASS) {
      console.warn('[auth:captcha] dev bypass enabled - missing captcha accepted');
      return true;
    }
    console.warn('[auth:captcha] verification failed - missing captcha');
    // Track failures per IP to throttle abusive clients
    try {
      const ip = getRequesterIp(req);
      const rec = getRateRecord(`auth:captcha_fail:${ip}`);
      rec.count += 1;
      if (rec.count > 10) rec.blockedUntil = Date.now() + (15 * 60 * 1000);
    } catch (e) { /* best-effort */ }
    return false;
  }

  const answer = Number(captcha?.answer);
  const a = Number(captcha?.a);
  const b = Number(captcha?.b);
  const expiresAt = Number(captcha?.expiresAt);
  const nonce = String(captcha?.nonce || '');
  const signature = String(captcha?.signature || '');

  if (!Number.isInteger(answer) || !Number.isInteger(a) || !Number.isInteger(b) || !expiresAt || !nonce || !signature) {
    console.warn('[auth:captcha] verification failed - malformed captcha payload', { ip: getRequesterIp(req) });
    try {
      const ip = getRequesterIp(req);
      const rec = getRateRecord(`auth:captcha_fail:${ip}`);
      rec.count += 1;
      if (rec.count > 10) rec.blockedUntil = Date.now() + (15 * 60 * 1000);
    } catch (e) { /* best-effort */ }
    return false;
  }

  if (Date.now() > expiresAt) {
    console.warn('[auth:captcha] verification failed - captcha expired', { ip: getRequesterIp(req), expiresAt });
    return false;
  }

  try {
    const payload = `${a}:${b}:${expiresAt}:${nonce}`;
    const expected = crypto.createHmac('sha256', CAPTCHA_SECRET).update(payload).digest();
    const provided = Buffer.from(signature, 'hex');
    const ok = provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!ok) {
      console.warn('[auth:captcha] verification failed - signature mismatch', { ip: getRequesterIp(req) });
      try {
        const ip = getRequesterIp(req);
        const rec = getRateRecord(`auth:captcha_fail:${ip}`);
        rec.count += 1;
        if (rec.count > 10) rec.blockedUntil = Date.now() + (15 * 60 * 1000);
      } catch (e) { /* best-effort */ }
      return false;
    }
  } catch (err) {
    console.warn('[auth:captcha] verification error', { err: err && err.message });
    return false;
  }

  const correct = answer === a + b;
  if (!correct) {
    console.warn('[auth:captcha] verification failed - incorrect answer', { ip: getRequesterIp(req) });
    try {
      const ip = getRequesterIp(req);
      const rec = getRateRecord(`auth:captcha_fail:${ip}`);
      rec.count += 1;
      if (rec.count > 10) rec.blockedUntil = Date.now() + (15 * 60 * 1000);
    } catch (e) { /* best-effort */ }
  }
  return correct;
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

  return await sendSystemEmail({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html
  });
}

function getOtpEmailFailureResponse(result, error) {
  const reason = String(result?.reason || error?.safeReason || '').trim();
  if (reason === 'config missing') return { status: 503, reason: 'config missing' };
  if (reason === 'SMTP auth failed') return { status: 503, reason: 'SMTP auth failed' };
  if (reason === 'timeout') return { status: 503, reason: 'timeout' };
  if (reason === 'provider blocked') return { status: 503, reason: 'provider blocked' };
  return { status: 500, reason: reason || 'provider blocked' };
}

async function sendPasswordResetEmail({ email, token }) {
  const resetUrl = new URL('/reset-password', FRONTEND_URL);
  resetUrl.searchParams.set('token', token);
  const template = buildPasswordResetEmail({
    resetUrl: resetUrl.toString(),
    expiresMinutes: Math.floor(RESET_TOKEN_TTL_MS / (60 * 1000)),
    supportEmail: process.env.SUPPORT_EMAIL || 'support@collegeos.in'
  });

  await sendSystemEmail({
    to: email,
    subject: template.subject,
    text: template.text,
    html: template.html
  });
}

function buildFrontendUrl(pathname, searchParams = {}) {
  const url = new URL(pathname, FRONTEND_URL);
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value === null || typeof value === 'undefined' || value === '') return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function buildAuthErrorRedirect(code, message) {
  return buildFrontendUrl('/login', {
    auth_error: code || 'google_auth_failed',
    auth_error_message: message || ''
  });
}

function buildGoogleAuthorizationUrl(state) {
  // Google Cloud Console setup reminder:
  // Authorized JavaScript origin: http://localhost:3000
  // Authorized redirect URI: http://localhost:3000/api/auth/google/callback
  // Production redirect URI: https://YOUR_BACKEND_DOMAIN/api/auth/google/callback
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', GOOGLE_CALLBACK_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_OAUTH_SCOPES);
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeGoogleAuthorizationCode(code) {
  const tokenRequest = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: GOOGLE_CALLBACK_URL,
    grant_type: 'authorization_code'
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: tokenRequest.toString()
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || 'Google authorization code exchange failed');
  }

  if (!payload.id_token) {
    throw new Error('Google authorization response did not include an ID token');
  }

  return payload;
}

async function verifyGoogleIdToken(idToken) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || 'Google ID token validation failed');
  }

  const issuer = String(payload.iss || '').trim();
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(issuer)) {
    throw new Error('Google token issuer is invalid');
  }

  if (String(payload.aud || '') !== GOOGLE_CLIENT_ID) {
    throw new Error('Google token audience mismatch');
  }

  if (String(payload.email_verified || '').toLowerCase() !== 'true') {
    throw new Error('Google email must be verified');
  }

  const normalizedEmail = normalizeEmail(payload.email || '');
  if (!isEmail(normalizedEmail)) {
    throw new Error('Google email is invalid');
  }

  return {
    googleId: String(payload.sub || '').trim(),
    email: normalizedEmail,
    fullName: String(payload.name || payload.given_name || normalizedEmail.split('@')[0] || 'Student').trim(),
    profilePicture: String(payload.picture || '').trim(),
    emailVerified: true,
    raw: payload
  };
}

async function upsertGoogleUser(client, googleProfile) {
  const googleId = String(googleProfile?.googleId || '').trim();
  const normalizedEmail = normalizeEmail(googleProfile?.email || '');
  const fullName = String(googleProfile?.fullName || '').trim() || 'Student';
  const profilePicture = String(googleProfile?.profilePicture || '').trim();

  if (!googleId) {
    throw new Error('Google account id is missing');
  }
  if (!isEmail(normalizedEmail)) {
    throw new Error('Google email is invalid');
  }
  if (!googleProfile?.emailVerified) {
    throw new Error('Google email must be verified');
  }

  const byGoogleResult = await client.query(
    'SELECT * FROM users WHERE google_id = $1 LIMIT 1 FOR UPDATE',
    [googleId]
  );
  let userRow = byGoogleResult.rows[0] || null;

  if (!userRow) {
    const byEmailResult = await client.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1 FOR UPDATE',
      [normalizedEmail]
    );
    userRow = byEmailResult.rows[0] || null;
  }

  const referralCode = `COL${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  if (!userRow) {
    const insertResult = await client.query(
      `INSERT INTO users (
         full_name, email, password_hash, referral_code, role, subscription_tier,
         signup_provider, auth_provider, google_id, profile_picture,
         is_email_verified, email_verified, email_verified_at,
         is_mobile_verified, phone_verified, last_login_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, 'student', 'free',
         'google', 'google', $5, $6,
         TRUE, TRUE, CURRENT_TIMESTAMP,
         FALSE, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       RETURNING *`,
      [
        fullName,
        normalizedEmail,
        await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12),
        referralCode,
        googleId,
        profilePicture || null
      ]
    );
    userRow = insertResult.rows[0];
  } else {
    const updateResult = await client.query(
      `UPDATE users
       SET full_name = COALESCE(NULLIF($2, ''), full_name),
           email = $3,
           google_id = COALESCE(google_id, $4),
           profile_picture = COALESCE(NULLIF($5, ''), profile_picture),
           auth_provider = 'google',
           signup_provider = 'google',
           is_email_verified = TRUE,
           email_verified = TRUE,
           email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
           last_login_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [
        userRow.id,
        fullName,
        normalizedEmail,
        googleId,
        profilePicture
      ]
    );
    userRow = updateResult.rows[0] || userRow;
  }

  await client.query(
    `INSERT INTO user_profiles (user_id, current_streak, onboarding_completed, onboarding_step, academic_scope)
     VALUES ($1, 0, FALSE, 'academic_profile', '{}'::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET
       updated_at = CURRENT_TIMESTAMP`,
    [userRow.id]
  );

  return userRow;
}

async function resolveGoogleLandingPath(client, userId) {
  const profileResult = await client.query(
    `SELECT onboarding_completed
     FROM user_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  const onboardingCompleted = Boolean(profileResult.rows[0]?.onboarding_completed);
  return onboardingCompleted ? '/dashboard' : '/academic-onboarding';
}

function maskEmailForLog(email) {
  const value = String(email || '').trim().toLowerCase();
  const [local, domain] = value.split('@');
  if (!local || !domain) return 'unknown';
  return `${local.slice(0, 2)}***@${domain}`;
}

async function logAuthSecurityEvent({ eventType, userId = null, email = '', req, meta = {} }) {
  const safeEventType = String(eventType || '').trim().slice(0, 80) || 'auth_event';
  const normalizedEmail = normalizeEmail(email || '');
  const emailHash = normalizedEmail ? hashSha256(normalizedEmail) : null;
  const ip = getRequesterIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 1024);

  try {
    await pool.query(
      `INSERT INTO auth_security_events (event_type, user_id, email_hash, ip, user_agent, meta)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [safeEventType, userId, emailHash, ip, userAgent, JSON.stringify(meta || {})]
    );
  } catch (_error) {
    // Best-effort logging, do not break auth flow if audit insert fails.
  }
}

async function createPasswordResetToken({ userId, req }) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSha256(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  const requestedIp = getRequesterIp(req);
  const requestedUserAgent = String(req.headers['user-agent'] || '').slice(0, 1024);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE password_reset_tokens
       SET invalidated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
         AND used_at IS NULL
         AND invalidated_at IS NULL`,
      [userId]
    );

    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip, requested_user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, tokenHash, expiresAt, requestedIp, requestedUserAgent]
    );

    // Legacy compatibility while old paths still exist.
    await client.query(
      `UPDATE users
       SET password_reset_token_hash = $2,
           password_reset_expires_at = $3
       WHERE id = $1`,
      [userId, tokenHash, expiresAt]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return { rawToken, expiresAt };
}

async function findPasswordResetTokenRecord(token) {
  const tokenHash = hashSha256(token || '');
  const tokenResult = await pool.query(
    `SELECT prt.id,
            prt.user_id,
            prt.expires_at,
            prt.used_at,
            prt.invalidated_at,
            u.email,
            u.password_reset_expires_at,
            u.password_reset_token_hash
     FROM password_reset_tokens prt
     INNER JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  if (tokenResult.rowCount > 0) {
    return {
      type: 'table',
      tokenHash,
      row: tokenResult.rows[0]
    };
  }

  const legacyResult = await pool.query(
    `SELECT id AS user_id,
            email,
            password_reset_expires_at
     FROM users
     WHERE password_reset_token_hash = $1
     LIMIT 1`,
    [tokenHash]
  );

  if (legacyResult.rowCount === 0) {
    return null;
  }

  return {
    type: 'legacy',
    tokenHash,
    row: legacyResult.rows[0]
  };
}

function evaluatePasswordResetTokenState(tokenRecord) {
  if (!tokenRecord || !tokenRecord.row) {
    return { valid: false, code: 'TOKEN_INVALID', message: 'Invalid reset link.' };
  }

  const row = tokenRecord.row;
  const expiresAt = row.expires_at ? new Date(row.expires_at) : row.password_reset_expires_at ? new Date(row.password_reset_expires_at) : null;

  if (tokenRecord.type === 'table' && row.used_at) {
    return { valid: false, code: 'TOKEN_USED', message: 'This reset link has already been used.' };
  }

  if (tokenRecord.type === 'table' && row.invalidated_at) {
    return { valid: false, code: 'TOKEN_INVALIDATED', message: 'This reset link is no longer valid.' };
  }

  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    return { valid: false, code: 'TOKEN_EXPIRED', message: 'This reset link has expired.' };
  }

  return {
    valid: true,
    code: 'TOKEN_VALID',
    expiresAt,
    userId: Number(row.user_id)
  };
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
  oauth: {
    googleClientId: GOOGLE_OAUTH_CLIENT_ID || '',
    googleEnabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL),
    googleCallbackUrl: GOOGLE_CALLBACK_URL || '',
    googleClientSecretConfigured: Boolean(GOOGLE_CLIENT_SECRET)
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
      ADD COLUMN IF NOT EXISTS phone VARCHAR(24),
      ADD COLUMN IF NOT EXISTS google_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS profile_picture TEXT,
      ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(40) DEFAULT 'email',
      ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_mobile_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS signup_provider VARCHAR(40) DEFAULT 'email',
      ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_lower_idx ON users (LOWER(email))');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_unique_idx ON users (google_id) WHERE google_id IS NOT NULL');

  await pool.query(`
    ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS onboarding_step VARCHAR(40) DEFAULT 'academic_profile',
      ADD COLUMN IF NOT EXISTS batch_year INTEGER,
      ADD COLUMN IF NOT EXISTS course_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS career_interest VARCHAR(200),
      ADD COLUMN IF NOT EXISTS weak_subjects JSONB,
      ADD COLUMN IF NOT EXISTS preferred_study_mode VARCHAR(50),
      ADD COLUMN IF NOT EXISTS academic_scope JSONB DEFAULT '{}'::jsonb
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
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      invalidated_at TIMESTAMP,
      requested_ip VARCHAR(64),
      requested_user_agent TEXT,
      used_ip VARCHAR(64),
      used_user_agent TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_active ON password_reset_tokens(user_id, expires_at)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_security_events (
      id BIGSERIAL PRIMARY KEY,
      event_type VARCHAR(80) NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email_hash VARCHAR(64),
      ip VARCHAR(64),
      user_agent TEXT,
      meta JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_auth_security_events_type_created ON auth_security_events(event_type, created_at DESC)');

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
    authConfig.oauth = {
      ...(authConfig.oauth || {}),
      googleClientId: GOOGLE_CLIENT_ID || String(experienceConfig?.auth?.oauth?.googleClientId || ''),
      googleEnabled: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_CALLBACK_URL),
      googleCallbackUrl: GOOGLE_CALLBACK_URL || String(experienceConfig?.auth?.oauth?.googleCallbackUrl || ''),
      googleClientSecretConfigured: Boolean(GOOGLE_CLIENT_SECRET)
    };

    if (process.env.DEBUG_AUTH === 'true') {
      console.log('[auth:config] google oauth', {
        enabled: authConfig.oauth.googleEnabled,
        clientIdConfigured: Boolean(authConfig.oauth.googleClientId),
        callbackUrl: authConfig.oauth.googleCallbackUrl || '',
        origin: _req.headers.origin || ''
      });
    }

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

    setCacheHeaders(res, 300);
    return res.json({ config: authConfig });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load authentication config' });
  }
});

router.get('/captcha/challenge', (req, res) => {
  const startedAt = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');
  // CAPTCHA gets its own limiter so normal refreshes do not trip the login limiter.
  const rateBlocked = enforceRateLimit(req, res, 'auth:captcha_challenge', 180, 60 * 1000);
  if (rateBlocked) {
    console.warn('[auth:captcha] challenge rate-limited', {
      requestId,
      ip: getRequesterIp(req),
      path: req.path,
      responseTimeMs: Date.now() - startedAt
    });
    return;
  }

  console.info('[auth:captcha] request received', {
    requestId,
    ip: getRequesterIp(req),
    path: req.path,
    origin: req.headers.origin || '',
    userAgent: req.headers['user-agent'] || ''
  });

  res.setHeader('Cache-Control', CAPTCHA_CHALLENGE_CACHE_CONTROL);
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const challenge = buildCaptchaChallenge(req);
    res.json({
      ok: true,
      captchaId: challenge.id,
      captcha: challenge,
      question: challenge.question,
      challenge: challenge.challengeText,
      challengeText: challenge.challengeText,
      prompt: challenge.prompt,
      captchaText: challenge.captchaText,
      expiresAt: challenge.expiresAt,
      expiresInSeconds: Math.floor(CAPTCHA_TTL_MS / 1000)
    });
    console.info('[auth:captcha] captcha generated', {
      requestId,
      responseTimeMs: Date.now() - startedAt,
      captchaId: challenge.id
    });
  } catch (error) {
    console.warn('[auth:captcha] captcha failed', {
      requestId,
      responseTimeMs: Date.now() - startedAt,
      reason: error?.message || String(error)
    });
    res.status(500).json({ ok: false, error: 'Captcha generation failed' });
  }
});

router.get('/google', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:google_start', 20, 15 * 60 * 1000);
  if (rateBlocked) return;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    return res.redirect(303, buildAuthErrorRedirect('google_unavailable', 'Google login is not configured on this server'));
  }

  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleOAuth = {
    state,
    createdAt: Date.now()
  };

  req.session.save((saveError) => {
    if (saveError) {
      return res.redirect(303, buildAuthErrorRedirect('google_session_error', 'Could not prepare Google login'));
    }

    return res.redirect(302, buildGoogleAuthorizationUrl(state));
  });
});

router.get('/google/callback', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:google_callback', 20, 15 * 60 * 1000);
  if (rateBlocked) return;

  const oauthError = String(req.query?.error || '').trim();
  if (oauthError) {
    return res.redirect(303, buildAuthErrorRedirect('google_denied', 'Google sign-in was cancelled or denied'));
  }

  const code = String(req.query?.code || '').trim();
  const state = String(req.query?.state || '').trim();
  const sessionState = String(req.session?.googleOAuth?.state || '').trim();

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_CALLBACK_URL) {
    return res.redirect(303, buildAuthErrorRedirect('google_unavailable', 'Google login is not configured on this server'));
  }

  if (!code || !state || !sessionState || state !== sessionState) {
    return res.redirect(303, buildAuthErrorRedirect('google_state_invalid', 'Your Google login session expired. Please try again.'));
  }

  delete req.session.googleOAuth;

  try {
    const tokenPayload = await exchangeGoogleAuthorizationCode(code);
    const googleProfile = await verifyGoogleIdToken(tokenPayload.id_token);

    const client = await pool.connect();
    let landingPath = '/dashboard';
    let userRow = null;

    try {
      await client.query('BEGIN');
      userRow = await upsertGoogleUser(client, googleProfile);
      landingPath = await resolveGoogleLandingPath(client, userRow.id);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        return res.redirect(303, buildAuthErrorRedirect('google_session_error', 'Could not start a secure session'));
      }

      req.session.userId = userRow.id;
      req.session.user = {
        id: userRow.id,
        full_name: userRow.full_name,
        email: userRow.email,
        role: userRow.role,
        subscription_tier: userRow.subscription_tier,
        auth_provider: 'google',
        signup_provider: userRow.signup_provider,
        profile_picture: userRow.profile_picture || null
      };
      req.session.role = userRow.role;
      req.session.cookie.maxAge = STANDARD_SESSION_MAX_AGE_MS;
      req.session.save(() => {
        return res.redirect(303, buildFrontendUrl(landingPath));
      });
    });
  } catch (error) {
    console.error('[auth:google] callback failed', error.message);
    return res.redirect(303, buildAuthErrorRedirect('google_auth_failed', 'Google sign-in failed. Please try again.'));
  }
});

router.post('/signup', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:signup', 12, 10 * 60 * 1000);
  if (rateBlocked) return;

  const {
    fullName,
    email,
    password,
    mobile,
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
  if (selectedVerificationMethod !== 'email') {
    return res.status(400).json({ error: 'Email verification is required for signup' });
  }

  const verificationTarget = normalizedEmail;
  if (!verificationTarget || !consumeVerificationToken({
    purpose: 'signup',
    channel: selectedVerificationMethod,
    target: verificationTarget,
    token: verificationToken
  })) {
    return res.status(400).json({ error: 'Please verify OTP before signup.' });
  }

  console.log('[auth:signup] OTP verified', { email: normalizedEmail, channel: selectedVerificationMethod });

  const client = await pool.connect();
  try {
    console.log('[auth:signup] creating user', { email: normalizedEmail, hasMobile: Boolean(normalizedMobile) });

    const exists = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [normalizedEmail]);
    if (exists.rowCount > 0) return res.status(409).json({ error: 'Email already registered' });

    if (normalizedMobile) {
      const mobileExists = await client.query('SELECT id FROM users WHERE mobile = $1 OR phone = $1', [normalizedMobile]);
      if (mobileExists.rowCount > 0) return res.status(409).json({ error: 'Mobile number already registered' });
    }

    const hash = await bcrypt.hash(password, 12);
    const referralCode = `COL${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const user = await client.query(
      `INSERT INTO users (full_name, email, mobile, phone, college_name, password_hash, referral_code, signup_provider, is_email_verified, is_mobile_verified, phone_verified, email_verified_at)
       VALUES ($1, $2, $3, $4, NULL, $5, $6, 'email', TRUE, $7, $7, CURRENT_TIMESTAMP)
       RETURNING id, full_name, email, mobile, phone, college_name, referral_code, role, subscription_tier, signup_provider, is_email_verified, is_mobile_verified, phone_verified`,
      [
        fullName,
        normalizedEmail,
        normalizedMobile,
        null,
        hash,
        referralCode,
        Boolean(normalizedMobile)
      ]
    );

    await client.query(
      `INSERT INTO user_profiles (user_id, current_streak, onboarding_completed, onboarding_step, academic_scope)
       VALUES ($1, 0, FALSE, 'academic_profile', '{}'::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET
         onboarding_completed = FALSE,
         onboarding_step = 'academic_profile',
         updated_at = CURRENT_TIMESTAMP`
      , [user.rows[0].id]
    );

    await client.query(
      'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
      [user.rows[0].id, 'Welcome to College OS. Start your first quiz to earn XP.', 'welcome']
    );

    console.log('[auth:signup] user created', { userId: user.rows[0].id, role: user.rows[0].role });

    req.session.regenerate((sessionError) => {
      if (sessionError) {
        return res.status(500).json({ error: 'Could not start secure session' });
      }

      req.session.userId = user.rows[0].id;
      req.session.user = user.rows[0];
      req.session.role = user.rows[0].role;
      req.session.cookie.maxAge = STANDARD_SESSION_MAX_AGE_MS;
      req.session.save((saveError) => {
        if (saveError) {
          return res.status(500).json({ error: 'Could not save secure session' });
        }

        console.log('[auth:signup] session created', { userId: user.rows[0].id, role: user.rows[0].role });
        console.log('[auth:signup] redirecting to dashboard', { userId: user.rows[0].id, redirectUrl: '/dashboard' });

        return res.status(201).json({
          success: true,
          message: 'Signup successful',
          user: user.rows[0],
          role: user.rows[0].role,
          token: null,
          redirectUrl: '/dashboard'
        });
      });
    });
    return;
  } catch (error) {
    console.error('[auth:signup] signup completion failed', { email: normalizedEmail, error: error?.message || 'unknown_error' });
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Signup could not be completed. Please try again.' });
    }
  } finally {
    client.release();
  }
});

router.post('/google', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:google', 20, 15 * 60 * 1000);
  if (rateBlocked) return;

  const credential = String(req.body?.credential || req.body?.idToken || '').trim();
  if (!credential) {
    return res.status(400).json({ error: 'Google credential is required' });
  }
  if (!GOOGLE_OAUTH_CLIENT_ID) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server' });
  }

  try {
    const tokenInfoResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const tokenInfo = await tokenInfoResponse.json().catch(() => ({}));
    if (!tokenInfoResponse.ok) {
      return res.status(400).json({ error: 'Invalid Google sign-in credential' });
    }

    const googleEmail = normalizeEmail(tokenInfo.email || '');
    if (!isEmail(googleEmail)) {
      return res.status(400).json({ error: 'Google account email is invalid' });
    }
    if (String(tokenInfo.aud || '') !== GOOGLE_OAUTH_CLIENT_ID) {
      return res.status(400).json({ error: 'Google sign-in audience mismatch' });
    }
    if (String(tokenInfo.email_verified || '').toLowerCase() !== 'true') {
      return res.status(400).json({ error: 'Google email must be verified' });
    }

    const fullName = String(tokenInfo.name || tokenInfo.given_name || googleEmail.split('@')[0] || 'Student').trim();
    const client = await pool.connect();
    try {
      const existing = await client.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [googleEmail]);
      let userRow = existing.rows[0] || null;

      if (!userRow) {
        const referralCode = `COL${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const temporaryPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
        const created = await client.query(
          `INSERT INTO users (full_name, email, college_name, password_hash, referral_code, signup_provider, is_email_verified, email_verified_at, is_mobile_verified, phone_verified)
           VALUES ($1, $2, NULL, $3, $4, 'google', TRUE, CURRENT_TIMESTAMP, FALSE, FALSE)
           RETURNING *`,
          [fullName, googleEmail, temporaryPassword, referralCode]
        );
        userRow = created.rows[0];

        await client.query(
          `INSERT INTO user_profiles (user_id, current_streak, onboarding_completed, onboarding_step, academic_scope)
           VALUES ($1, 0, FALSE, 'academic_profile', '{}'::jsonb)
           ON CONFLICT (user_id) DO UPDATE SET
             onboarding_completed = FALSE,
             onboarding_step = 'academic_profile',
             updated_at = CURRENT_TIMESTAMP`,
          [userRow.id]
        );
      } else {
        await client.query(
          `UPDATE users
           SET full_name = COALESCE(NULLIF(full_name, ''), $2),
               signup_provider = 'google',
               is_email_verified = TRUE,
               email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
               last_login_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [userRow.id, fullName]
        );
        userRow = (await client.query('SELECT * FROM users WHERE id = $1', [userRow.id])).rows[0];
      }

      req.session.regenerate((sessionError) => {
        if (sessionError) {
          return res.status(500).json({ error: 'Could not start secure session' });
        }

        req.session.userId = userRow.id;
        req.session.user = {
          id: userRow.id,
          full_name: userRow.full_name,
          email: userRow.email,
          role: userRow.role,
          signup_provider: userRow.signup_provider
        };
        req.session.role = userRow.role;
        req.session.cookie.maxAge = STANDARD_SESSION_MAX_AGE_MS;
        return res.json({
          user: req.session.user,
          onboardingCompleted: false,
          provider: 'google'
        });
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[auth:google] sign-in failed', error.message);
    return res.status(400).json({ error: 'Google sign-in failed' });
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
    const retryAfter = Math.ceil((new Date(userRow.locked_until).getTime() - Date.now()) / 1000);
    return sendRateLimitedResponse(res, retryAfter, 'Too many failed attempts. Please wait before trying again.');
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
  // Apply a slightly relaxed rate limit in development to ease debugging.
  const maxAttempts = Math.max(5, Math.floor(30 * DEV_RATE_LIMIT_MULTIPLIER));
  // lightweight dedupe: if the same IP+target+purpose repeats within 1.5s, don't consume rate-limit counters
  const channel = String(req.body.channel || 'email').toLowerCase();
  const target = String(req.body.target || '').trim().toLowerCase();
  const purpose = String(req.body.purpose || 'signup').toLowerCase();
  const now = Date.now();
  const fingerprint = `recentreq:${getRequesterIp(req)}:${channel}:${purpose}:${target}`;
  const recent = RATE_LIMIT_STATE.get(fingerprint);
  if (recent && (now - (recent.lastAt || 0)) < 1500) {
    // Return a short retry response but do NOT increment global counters to avoid accidental DOS from duplicate client calls
    const retryAfter = Math.ceil((1500 - (now - recent.lastAt || 0)) / 1000) || 1;
    console.warn('[RATE_LIMIT_DEDUPE] duplicate rapid request', { ip: getRequesterIp(req), channel, target, purpose });
    return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.', retryAfter });
  }
  RATE_LIMIT_STATE.set(fingerprint, { lastAt: now, resetAt: now + 5000 });
  const rateBlocked = enforceRateLimit(req, res, 'auth:otp_request', maxAttempts, 15 * 60 * 1000);
  if (rateBlocked) return;

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
  // reuse earlier `now` from dedupe region
  const key = getOtpStoreKey({ purpose, channel, target });
  const existing = otpStore.get(key);

  // CRITICAL FIX: Enforce global per-IP rate limit (prevents spam of ANY target)
  const ipMax = Math.max(10, Math.floor(30 * DEV_RATE_LIMIT_MULTIPLIER));
  const ipRateLimited = enforceRateLimit(req, res, 'auth:otp_request_global', ipMax, 15 * 60 * 1000);
  if (ipRateLimited) return;
  
  // Per-target rate limit (5 requests per 10min to SAME email/phone)
  if (existing?.requestWindowStartedAt && now - existing.requestWindowStartedAt <= OTP_REQUEST_WINDOW_MS) {
    if (Number(existing.requestCount || 0) >= OTP_MAX_REQUESTS_PER_WINDOW) {
      return sendRateLimitedResponse(res, OTP_RESEND_MS / 1000, 'Too many OTP requests. Please try again later.');
    }
  }

  // Per-target rate limit (30-second cooldown between OTP sends)
  if (existing?.nextAllowedAt && now < existing.nextAllowedAt) {
    const retryAfter = Math.ceil((existing.nextAllowedAt - now) / 1000);
    console.warn('[OTP_RATE_LIMIT] resend cooldown', { ip: getRequesterIp(req), target, purpose, retryAfter, requestCount: existing.requestCount });
    return sendRateLimitedResponse(res, retryAfter, 'Please wait before requesting a new OTP/code');
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
    const emailResult = await sendOtpEmail({ otp: code, originalTarget: target, channel, purpose, targetEmail });
    if (emailResult && emailResult.sent === false) {
      throw new Error('Failed to send OTP email. Please try again.');
    }
  } catch (error) {
    otpStore.delete(key);
    console.error('[OTP_EMAIL] request failed', {
      name: error?.name,
      code: error?.code,
      command: error?.command,
      response: error?.response,
      message: error?.message
    });
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP email. Please try again.'
    });
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
      return sendRateLimitedResponse(res, OTP_RESEND_MS / 1000, 'Too many incorrect attempts. Request a new OTP.');
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
      return sendRateLimitedResponse(res, OTP_RESEND_MS / 1000, 'Too many incorrect attempts. Request a new OTP.');
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
  if (captcha && !verifyCaptchaPayload(req, captcha)) {
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
    await logAuthSecurityEvent({
      eventType: 'password_reset_requested',
      email,
      req,
      meta: { accepted: true, accountFound: false }
    });
    return res.json({ message: 'If an account exists, a reset link has been sent.' });
  }

  const userResult = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
  if (userResult.rowCount === 0) {
    await logAuthSecurityEvent({
      eventType: 'password_reset_requested',
      email,
      req,
      meta: { accepted: true, accountFound: false }
    });
    return res.json({ message: 'If an account exists, a reset link has been sent.' });
  }

  const userId = Number(userResult.rows[0].id);
  const { rawToken } = await createPasswordResetToken({ userId, req });

  try {
    await sendPasswordResetEmail({ email, token: rawToken });
  } catch {
    // Keep generic response to prevent account and infrastructure enumeration.
  }

  await logAuthSecurityEvent({
    eventType: 'password_reset_requested',
    userId,
    email,
    req,
    meta: { accepted: true, accountFound: true, emailMasked: maskEmailForLog(email) }
  });

  return res.json({ message: 'If an account exists, a reset link has been sent.' });
});

router.get('/password/reset/validate', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:reset_password_validate', 100, 15 * 60 * 1000);
  if (rateBlocked) return;

  const token = String(req.query?.token || '').trim();
  if (!token || token.length < 32) {
    return res.status(400).json({ valid: false, code: 'TOKEN_INVALID', message: 'Invalid reset link.' });
  }

  const tokenRecord = await findPasswordResetTokenRecord(token);
  const state = evaluatePasswordResetTokenState(tokenRecord);

  if (!state.valid) {
    const eventType = state.code === 'TOKEN_EXPIRED'
      ? 'password_reset_token_expired'
      : state.code === 'TOKEN_USED'
        ? 'password_reset_token_reused'
        : 'password_reset_failed';
    await logAuthSecurityEvent({
      eventType,
      userId: tokenRecord?.row?.user_id || null,
      email: tokenRecord?.row?.email || '',
      req,
      meta: { code: state.code }
    });
    return res.status(400).json({ valid: false, code: state.code, message: state.message });
  }

  const remainingSeconds = Math.max(1, Math.floor((state.expiresAt.getTime() - Date.now()) / 1000));
  await logAuthSecurityEvent({
    eventType: 'password_reset_token_validated',
    userId: state.userId,
    email: tokenRecord?.row?.email || '',
    req,
    meta: { remainingSeconds }
  });

  return res.json({ valid: true, expiresInSeconds: remainingSeconds });
});

router.post('/password/reset', async (req, res) => {
  const rateBlocked = enforceRateLimit(req, res, 'auth:reset_password', 20, 15 * 60 * 1000);
  if (rateBlocked) return;

  const token = String(req.body?.token || '').trim();
  const newPassword = String(req.body?.newPassword || '');
  const confirmPassword = String(req.body?.confirmPassword || '');

  if (!token || token.length < 32) {
    return res.status(400).json({ error: 'Invalid reset request' });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
  }

  const tokenRecord = await findPasswordResetTokenRecord(token);
  const state = evaluatePasswordResetTokenState(tokenRecord);
  if (!state.valid) {
    const eventType = state.code === 'TOKEN_EXPIRED'
      ? 'password_reset_token_expired'
      : state.code === 'TOKEN_USED'
        ? 'password_reset_token_reused'
        : 'password_reset_failed';
    await logAuthSecurityEvent({
      eventType,
      userId: tokenRecord?.row?.user_id || null,
      email: tokenRecord?.row?.email || '',
      req,
      meta: { code: state.code }
    });
    return res.status(400).json({ error: state.message });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const userId = state.userId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (tokenRecord.type === 'table') {
      const lockTokenResult = await client.query(
        `SELECT id, used_at, invalidated_at, expires_at
         FROM password_reset_tokens
         WHERE id = $1
         FOR UPDATE`,
        [tokenRecord.row.id]
      );

      const locked = lockTokenResult.rows[0];
      if (!locked || locked.used_at || locked.invalidated_at || new Date(locked.expires_at).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        await logAuthSecurityEvent({
          eventType: 'password_reset_failed',
          userId,
          email: tokenRecord?.row?.email || '',
          req,
          meta: { code: 'TOKEN_NO_LONGER_VALID' }
        });
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }
    }

    await client.query(
      `UPDATE users
       SET password_hash = $2,
           password_changed_at = NOW(),
           password_reset_token_hash = NULL,
           password_reset_expires_at = NULL,
           failed_login_attempts = 0,
           locked_until = NULL
       WHERE id = $1`,
      [userId, newHash]
    );

    if (tokenRecord.type === 'table') {
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = CURRENT_TIMESTAMP,
             used_ip = $2,
             used_user_agent = $3
         WHERE id = $1`,
        [tokenRecord.row.id, getRequesterIp(req), String(req.headers['user-agent'] || '').slice(0, 1024)]
      );

      await client.query(
        `UPDATE password_reset_tokens
         SET invalidated_at = CURRENT_TIMESTAMP
         WHERE user_id = $1
           AND id <> $2
           AND used_at IS NULL
           AND invalidated_at IS NULL`,
        [userId, tokenRecord.row.id]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  try {
    await revokeUserSessionsByUserId(userId, 'password/reset');
  } catch (error) {
    // Non-fatal in local/in-memory modes, but log if debugging
    if (process.env.DEBUG_AUTH === 'true') {
      console.error('[password/reset] Session deletion error:', error.message);
    }
  }

  await logAuthSecurityEvent({
    eventType: 'password_reset_success',
    userId,
    email: tokenRecord?.row?.email || '',
    req,
    meta: { sessionRevoked: true }
  });

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
  setCacheHeaders(res, 15);
  if (!req.session.userId) return res.json({ user: null });
  const { rows } = await pool.query(
    `SELECT id, full_name, email, mobile, college_name, university_id, university_name, custom_university, role, subscription_tier, payment_status, subscription_started_at, subscription_expiry,
            google_id, profile_picture, auth_provider, email_verified, is_email_verified, is_mobile_verified, last_login_at, updated_at
     FROM users
     WHERE id = $1`,
    [req.session.userId]
  );
  return res.json({ user: rows[0] || null });
});

module.exports = router;
module.exports.buildCaptchaChallenge = buildCaptchaChallenge;
module.exports.ensureAuthSchema = ensureAuthSchema;
