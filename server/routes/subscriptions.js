const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { resolveMembershipState } = require('../middleware/auth');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');

const router = express.Router();

const DEFAULT_MEMBERSHIP_CENTER_CONFIG = {
  hero: {
    title: 'Upgrade to College OS Premium',
    subtitle: 'Unlock unlimited learning with AI-powered study workflows, premium mock tests, and deeper career roadmaps.',
    highlights: [
      'Unlimited notes',
      'AI tools access',
      'Mock tests and analytics',
      'Certificates and downloads',
      'Advanced roadmap access'
    ]
  },
  plans: {
    free: {
      name: 'Free Plan',
      description: 'Start learning with core resources.',
      priceInr: 0,
      billingLabel: 'forever',
      features: [
        'Limited notes access',
        'Basic quiz and dashboard access',
        '2 free mock attempts'
      ]
    },
    premium: {
      name: 'Premium Plan',
      description: 'Full platform access for serious learners.',
      priceInr: 49,
      billingLabel: 'month',
      durationDays: 30,
      features: [
        'Unlimited notes and downloads',
        'All AI tools enabled',
        'Unlimited mock tests',
        'Certificates and premium roadmaps'
      ]
    }
  },
  featureAccess: {
    notesAccess: { free: 'Limited', premium: 'Unlimited' },
    mockTests: { free: '2 attempts', premium: 'Unlimited' },
    aiTools: { free: false, premium: true },
    certificates: { free: false, premium: true },
    roadmapDepth: { free: 'Basic', premium: 'Advanced' },
    downloads: { free: false, premium: true }
  },
  payment: {
    upiId: 'shuklaabhayas0-1@okicici',
    qrCodeImageUrl: '',
    instructions: [
      'Scan the QR code or copy the UPI ID.',
      'Pay the premium amount shown on this page.',
      'Save payment screenshot (optional but recommended).',
      'Submit transaction ID and payment date.',
      'Wait for admin approval to activate premium.'
    ],
    supportText: 'Premium activates instantly after admin approval.'
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

let membershipConfigSchemaEnsured = false;

async function ensureMembershipConfigSchema() {
  if (membershipConfigSchemaEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(120) PRIMARY KEY,
      value_json JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(
    `INSERT INTO platform_settings (key, value_json)
     VALUES ('membership_center_config', $1::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(DEFAULT_MEMBERSHIP_CENTER_CONFIG)]
  );
  membershipConfigSchemaEnsured = true;
}

async function getMembershipCenterConfig() {
  await ensureMembershipConfigSchema();
  const { rows } = await pool.query(
    "SELECT value_json FROM platform_settings WHERE key = 'membership_center_config' LIMIT 1"
  );
  return deepMerge(DEFAULT_MEMBERSHIP_CENTER_CONFIG, rows[0]?.value_json || {});
}

const upload = createUploadMiddleware({
  maxFileSize: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
  invalidTypeMessage: 'Only PNG/JPG/WEBP screenshots are allowed'
});

function toIsoDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

async function getUserProfile(userId) {
  const { rows } = await pool.query(
    'SELECT id, full_name, email FROM users WHERE id = $1',
    [userId]
  );
  return rows[0] || null;
}

async function countMockAttempts(userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM mock_test_attempts WHERE user_id = $1',
    [userId]
  );
  return rows[0]?.count || 0;
}

router.get('/me', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const membershipConfig = await getMembershipCenterConfig();
  const premiumPlan = membershipConfig?.plans?.premium || {};
  const premiumPrice = Number(premiumPlan.priceInr || 49);
  const durationDays = Number(premiumPlan.durationDays || 30);

  const [membership, historyResult, attemptsCount] = await Promise.all([
    resolveMembershipState(userId),
    pool.query(
      `SELECT
        id,
        payment_date,
        transaction_id,
        amount_inr,
        status,
        approved_at,
        expiry_date,
        payment_method,
        submitted_at,
        rejection_reason
       FROM membership_payment_requests
       WHERE user_id = $1
       ORDER BY submitted_at DESC`,
      [userId]
    ),
    countMockAttempts(userId)
  ]);

  if (!membership) return res.status(404).json({ error: 'User not found' });

  const plan = membership.premiumActive ? 'premium' : 'free';
  const status = membership.status;
  const statusLabel = membership.statusLabel;

  const comparison = {
    free: membershipConfig?.plans?.free?.features || ['Limited notes access', 'Basic dashboard', '2 mock attempts'],
    premium: membershipConfig?.plans?.premium?.features || ['Unlimited tests', 'Full notes', 'Roadmap access', 'Certificates', 'Downloads']
  };

  return res.json({
    plan,
    tier: plan,
    amountInr: premiumPrice,
    billingDurationDays: durationDays,
    status,
    statusLabel,
    startDate: membership.startDate,
    expiryDate: membership.expiryDate,
    remainingDays: membership.remainingDays,
    freeMockAttemptLimit: 2,
    freeMockAttemptsUsed: attemptsCount,
    freeMockAttemptsRemaining: Math.max(0, 2 - attemptsCount),
    membershipConfig,
    benefits: comparison,
    plans: [
      {
        name: 'free',
        priceInr: Number(membershipConfig?.plans?.free?.priceInr || 0),
        description: membershipConfig?.plans?.free?.description || 'Limited feature access'
      },
      {
        name: 'premium',
        priceInr: premiumPrice,
        description: premiumPlan.description || `Full access for ${durationDays} days after admin approval`
      }
    ],
    paymentHistory: historyResult.rows
  });
});

router.get('/payments', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT
      id,
      payment_date,
      transaction_id,
      amount_inr,
      status,
      approved_at,
      expiry_date,
      payment_method,
      submitted_at,
      rejection_reason,
      screenshot_url
     FROM membership_payment_requests
     WHERE user_id = $1
     ORDER BY submitted_at DESC`,
    [req.session.userId]
  );

  res.json({ payments: rows });
});

router.post('/payment-request', requireAuth, upload.single('paymentScreenshot'), async (req, res) => {
  const user = await getUserProfile(req.session.userId);
  const membershipConfig = await getMembershipCenterConfig();
  const premiumPlan = membershipConfig?.plans?.premium || {};
  const premiumPrice = Number(premiumPlan.priceInr || 49);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const fullName = String(req.body.fullName || user.full_name || '').trim();
  const email = String(req.body.email || user.email || '').trim().toLowerCase();
  const paymentMethod = String(req.body.paymentMethod || '').trim();
  const transactionId = String(req.body.transactionId || '').trim();
  const paymentDate = toIsoDate(req.body.paymentDate);
  const note = String(req.body.note || '').trim() || null;

  if (!fullName || !email || !paymentMethod || !transactionId || !paymentDate) {
    return res.status(400).json({ error: 'fullName, email, paymentMethod, transactionId, and paymentDate are required' });
  }

  if (email !== String(user.email || '').toLowerCase()) {
    return res.status(400).json({ error: 'Payment email must match your registered email' });
  }

  const existingPending = await pool.query(
    `SELECT id
     FROM membership_payment_requests
     WHERE user_id = $1 AND status = 'pending'
     LIMIT 1`,
    [req.session.userId]
  );

  if (existingPending.rowCount > 0) {
    return res.status(409).json({ error: 'A payment request is already pending admin approval' });
  }

  let screenshotUrl = null;
  if (req.file) {
    try {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'users/payments',
        prefix: 'payment-proof'
      });
      screenshotUrl = stored.url;
    } catch (error) {
      return res.status(502).json({ error: 'Failed to upload payment screenshot' });
    }
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO membership_payment_requests
       (user_id, full_name, email, payment_method, transaction_id, screenshot_url, payment_date, amount_inr, note, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, 'pending')
       RETURNING id, payment_date, transaction_id, amount_inr, status, submitted_at`,
      [req.session.userId, fullName, email, paymentMethod, transactionId, screenshotUrl, paymentDate, premiumPrice, note]
    );

    await pool.query(
      `UPDATE users
       SET payment_status = 'pending_approval', subscription_tier = 'free'
       WHERE id = $1`,
      [req.session.userId]
    );

    await pool.query(
      'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
      [req.session.userId, 'Payment submitted successfully. Waiting for admin verification.', 'payment_submitted']
    );

    const admins = await pool.query("SELECT id FROM users WHERE role = 'admin'");
    await Promise.all(
      admins.rows.map((admin) =>
        pool.query(
          'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
          [admin.id, `New membership payment request from ${fullName} (${email})`, 'admin_payment_request']
        )
      )
    );

    return res.status(201).json({
      paymentRequest: rows[0],
      message: 'Payment submitted successfully. Waiting for admin verification.'
    });
  } catch (error) {
    if (String(error.message || '').toLowerCase().includes('membership_payment_unique_txn')) {
      return res.status(409).json({ error: 'This transaction ID has already been submitted' });
    }
    throw error;
  }
});

module.exports = router;
module.exports.ensureMembershipConfigSchema = ensureMembershipConfigSchema;
