const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { resolveMembershipState } = require('../middleware/auth');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');

const { requireFeatureEnabled } = require('../middleware/featureToggle');

const router = express.Router();
router.use(requireFeatureEnabled('membership'));

const MEMBERSHIP_CONFIG_CACHE_TTL_MS = 30 * 1000;
const membershipConfigCache = { payload: null, loadedAt: 0 };

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

  if (membershipConfigCache.payload && Date.now() - membershipConfigCache.loadedAt < MEMBERSHIP_CONFIG_CACHE_TTL_MS) {
    return membershipConfigCache.payload;
  }

  const { rows } = await pool.query(
    "SELECT value_json FROM platform_settings WHERE key = 'membership_center_config' LIMIT 1"
  );
  const config = deepMerge(DEFAULT_MEMBERSHIP_CENTER_CONFIG, rows[0]?.value_json || {});
  membershipConfigCache.payload = config;
  membershipConfigCache.loadedAt = Date.now();
  return config;
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

const { ensureMembershipSchema, getStudentActiveMembership } = require('../services/entitlementResolver');

// GET /api/subscriptions/plans - Public student endpoint to fetch active, purchasable membership plans
router.get('/plans', async (_req, res) => {
  try {
    await ensureMembershipSchema();
    const { rows } = await pool.query(`
      SELECT 
        id,
        code,
        name,
        description,
        price,
        currency,
        duration_value,
        duration_unit,
        display_benefits,
        display_order
      FROM membership_plans
      WHERE status = 'ACTIVE' AND is_purchasable = TRUE
      ORDER BY display_order ASC, price ASC
    `);

    const formattedPlans = rows.map(p => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      priceInr: Number(p.price),
      price: Number(p.price),
      currency: p.currency,
      durationValue: p.duration_value,
      durationUnit: p.duration_unit,
      displayBenefits: Array.isArray(p.display_benefits) ? p.display_benefits : (typeof p.display_benefits === 'string' ? JSON.parse(p.display_benefits) : [])
    }));

    res.json({ success: true, plans: formattedPlans });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch membership plans', details: err.message });
  }
});

async function countMockAttempts(userId) {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM mock_test_attempts WHERE user_id = $1', [userId]);
    return rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

router.get('/me', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  await ensureMembershipSchema();

  const [membershipState, historyResult, attemptsCount, dbPlansRes] = await Promise.all([
    getStudentActiveMembership(userId),
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
    countMockAttempts(userId),
    pool.query(`
      SELECT id, code, name, description, price, currency, duration_value, duration_unit, display_benefits
      FROM membership_plans
      WHERE status = 'ACTIVE' AND is_purchasable = TRUE
      ORDER BY display_order ASC
    `)
  ]);

  const activePlanCode = membershipState.planCode || 'free';
  const premiumDbPlan = dbPlansRes.rows.find(p => p.code !== 'free') || dbPlansRes.rows[0];
  const premiumPrice = premiumDbPlan ? Number(premiumDbPlan.price) : 49;
  const durationDays = premiumDbPlan ? Number(premiumDbPlan.duration_value) : 30;

  const formattedPlans = dbPlansRes.rows.map(p => ({
    id: p.id,
    code: p.code,
    name: p.code,
    displayName: p.name,
    priceInr: Number(p.price),
    description: p.description,
    features: Array.isArray(p.display_benefits) ? p.display_benefits : (typeof p.display_benefits === 'string' ? JSON.parse(p.display_benefits) : [])
  }));

  const membershipConfig = await getMembershipCenterConfig();

  return res.json({
    plan: activePlanCode,
    tier: activePlanCode,
    amountInr: premiumPrice,
    billingDurationDays: durationDays,
    status: membershipState.status.toLowerCase(),
    statusLabel: membershipState.hasActiveMembership ? 'Active Member' : 'Free Learner',
    startDate: membershipState.startedAt,
    expiryDate: membershipState.expiresAt,
    remainingDays: membershipState.expiresAt ? Math.max(0, Math.ceil((new Date(membershipState.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : null,
    freeMockAttemptLimit: 2,
    freeMockAttemptsUsed: attemptsCount,
    freeMockAttemptsRemaining: Math.max(0, 2 - attemptsCount),
    membershipConfig,
    plans: formattedPlans,
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

const { getPaymentSettings } = require('./admin-control');

// GET /api/subscriptions/payment-settings - Public student endpoint to fetch persistent payment settings
router.get('/payment-settings', async (_req, res) => {
  try {
    const settings = await getPaymentSettings();
    res.json({
      success: true,
      paymentEnabled: settings.payment_enabled,
      upiId: settings.upi_id,
      payeeName: settings.payee_name,
      qrImageUrl: settings.qr_image_url,
      instructions: settings.instructions,
      supportMessage: settings.support_message
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment settings', details: err.message });
  }
});

const handlePaymentScreenshotUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return upload.single('paymentScreenshot')(req, res, next);
  }
  return next();
};

router.post('/payment-request', requireAuth, handlePaymentScreenshotUpload, async (req, res) => {
  console.log('[DEBUG payment-request] Handler started for user:', req.session.userId);
  const settings = await getPaymentSettings();
  if (!settings.payment_enabled) {
    return res.status(403).json({
      error: 'PAYMENTS_DISABLED',
      message: 'New payment submissions are currently disabled by administrator.'
    });
  }

  console.log('[DEBUG payment-request] Payment enabled. Fetching user profile...');
  const user = await getUserProfile(req.session.userId);
  console.log('[DEBUG payment-request] User profile fetched:', user?.email);
  await ensureMembershipSchema();
  console.log('[DEBUG payment-request] Membership schema ensured.');

  let targetPlanId = req.body.planId ? parseInt(req.body.planId, 10) : null;
  let targetPlanCode = req.body.planCode ? String(req.body.planCode).trim().toLowerCase() : null;

  let planRes;
  let matchedPlan = null;

  if (targetPlanId) {
    planRes = await pool.query("SELECT id, code, name, price FROM membership_plans WHERE id = $1 AND status = 'ACTIVE' AND is_purchasable = TRUE", [targetPlanId]);
  } else if (targetPlanCode) {
    planRes = await pool.query("SELECT id, code, name, price FROM membership_plans WHERE code = $1 AND status = 'ACTIVE' AND is_purchasable = TRUE", [targetPlanCode]);
  } else {
    planRes = await pool.query("SELECT id, code, name, price FROM membership_plans WHERE code = 'premium' AND status = 'ACTIVE' AND is_purchasable = TRUE LIMIT 1");
  }

  if (planRes.rows.length === 0) {
    planRes = await pool.query("SELECT id, code, name, price FROM membership_plans WHERE status = 'ACTIVE' AND is_purchasable = TRUE AND price > 0 ORDER BY display_order ASC LIMIT 1");
  }

  if (planRes.rows.length > 0) {
    matchedPlan = planRes.rows[0];
  }

  const authoritativePrice = matchedPlan ? Number(matchedPlan.price) : 49;
  const planIdSnapshot = matchedPlan ? matchedPlan.id : null;
  const planCodeSnapshot = matchedPlan ? matchedPlan.code : 'premium';
  const planNameSnapshot = matchedPlan ? matchedPlan.name : 'Premium Membership';

  if (!user) return res.status(404).json({ error: 'User not found' });

  const fullName = String(req.body.fullName || user.full_name || '').trim();
  const email = String(req.body.email || user.email || '').trim().toLowerCase();
  const paymentMethod = String(req.body.paymentMethod || 'UPI').trim();
  const rawUtr = String(req.body.transactionId || req.body.utr || '').trim();
  const transactionId = rawUtr.toUpperCase();
  const paymentDate = toIsoDate(req.body.paymentDate || new Date());
  const note = String(req.body.note || '').trim() || null;

  if (!fullName || !email || !paymentMethod || !transactionId || !paymentDate) {
    return res.status(400).json({ error: 'fullName, email, paymentMethod, transactionId (UTR), and paymentDate are required' });
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
        prefix: 'payment-proof',
        userId: req.session.userId,
        uploadedBy: req.session.userId,
        entityType: 'payment_screenshot'
      });
      screenshotUrl = stored.url;
    } catch (error) {
      if (error?.code === 'INVALID_UPLOAD_FILE' || error?.statusCode === 400) {
        return res.status(400).json({ error: error.message || 'Invalid file upload' });
      }
      return res.status(502).json({ error: 'Failed to upload payment screenshot' });
    }
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO membership_payment_requests
       (user_id, plan_id, full_name, email, payment_method, transaction_id, screenshot_url, payment_date, amount_inr, note, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, 'pending')
       RETURNING id, payment_date, transaction_id, amount_inr, status, submitted_at`,
      [req.session.userId, planIdSnapshot, fullName, email, paymentMethod, transactionId, screenshotUrl, paymentDate, authoritativePrice, note]
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

// GET /api/subscriptions/config - Public payment gateway & UPI config
router.get('/config', async (_req, res) => {
  try {
    const config = await getMembershipCenterConfig();
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID || null;
    const automatedAvailable = Boolean(razorpayKeyId && process.env.RAZORPAY_KEY_SECRET);

    res.json({
      success: true,
      plans: config.plans,
      featureAccess: config.featureAccess,
      upi: config.payment,
      gateway: {
        automatedAvailable,
        provider: automatedAvailable ? 'razorpay' : null,
        keyId: razorpayKeyId
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load subscription configuration' });
  }
});

// POST /api/subscriptions/create-order - Create automated payment order
router.post('/create-order', requireAuth, async (req, res) => {
  try {
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
    const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!razorpayKeyId || !razorpayKeySecret) {
      return res.status(503).json({
        success: false,
        gatewayAvailable: false,
        error: 'Automated payment gateway credentials are not configured. Please use the manual UPI payment option.'
      });
    }

    const config = await getMembershipCenterConfig();
    const amountInr = Number(config?.plans?.premium?.priceInr || 49);
    const amountPaise = amountInr * 100;
    const receipt = `rcpt_${req.session.userId}_${Date.now()}`;

    // Create order via Razorpay API
    const authHeader = 'Basic ' + Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
    const orderPayload = JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes: { userId: String(req.session.userId) }
    });

    const https = require('https');
    const orderPromise = new Promise((resolve, reject) => {
      const apiReq = https.request({
        hostname: 'api.razorpay.com',
        port: 443,
        path: '/v1/orders',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'Content-Length': Buffer.byteLength(orderPayload)
        }
      }, (apiRes) => {
        let body = '';
        apiRes.on('data', chunk => body += chunk);
        apiRes.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(data.error?.description || 'Razorpay order creation failed'));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      apiReq.on('error', reject);
      apiReq.write(orderPayload);
      apiReq.end();
    });

    const order = await orderPromise;
    res.json({
      success: true,
      gatewayAvailable: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId
    });
  } catch (error) {
    console.error('[Payment Gateway Error]', error.message);
    res.status(500).json({ success: false, error: error.message || 'Order creation failed' });
  }
});

// POST /api/subscriptions/verify-payment - Verify payment signature and activate subscription
router.post('/verify-payment', requireAuth, async (req, res) => {
  const crypto = require('crypto');
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: 'Missing payment verification parameters' });
  }

  const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!razorpayKeySecret) {
    return res.status(503).json({ success: false, error: 'Payment gateway secret not configured' });
  }

  const generatedSignature = crypto
    .createHmac('sha256', razorpayKeySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (generatedSignature !== razorpay_signature) {
    console.warn('[Payment Signature Mismatch]', { userId: req.session.userId, orderId: razorpay_order_id });
    return res.status(400).json({ success: false, error: 'Invalid payment signature' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date();
    const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await client.query(
      `UPDATE users
       SET subscription_tier = 'premium',
           payment_status = 'active',
           subscription_started_at = $1,
           subscription_expiry = $2
       WHERE id = $3`,
      [now, expiry, req.session.userId]
    );

    await client.query(
      `INSERT INTO payment_events
       (user_id, event_type, payload, created_at)
       VALUES ($1, 'razorpay.payment.verified', $2::jsonb, NOW())`,
      [req.session.userId, JSON.stringify({ orderId: razorpay_order_id, paymentId: razorpay_payment_id })]
    );

    await client.query(
      'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
      [req.session.userId, 'Your Premium Subscription has been activated for 30 days!', 'subscription_activated']
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Payment verified successfully. Premium subscription activated!',
      subscription: {
        tier: 'premium',
        status: 'active',
        expiryDate: expiry.toISOString()
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Subscription Activation Error]', err.message);
    res.status(500).json({ success: false, error: 'Failed to activate subscription' });
  } finally {
    client.release();
  }
});

// POST /api/subscriptions/webhook - Handle automated payment webhooks
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const crypto = require('crypto');
  const webhookSecret = process.env.SUBSCRIPTION_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return res.status(500).send('Webhook secret unconfigured');
  }

  const signature = req.headers['x-razorpay-signature'] || req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).send('Missing webhook signature');
  }

  const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
  const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');

  if (signature !== expectedSignature) {
    console.warn('[Webhook Invalid Signature]');
    return res.status(400).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).send('Invalid JSON payload');
  }

  try {
    const eventType = event.event || event.type;
    console.info(`[Payment Webhook Received]: ${eventType}`);

    if (eventType === 'payment.captured' || eventType === 'order.paid' || eventType === 'invoice.payment_succeeded') {
      const userId = event.payload?.payment?.entity?.notes?.userId || event.data?.object?.metadata?.userId;
      if (userId) {
        const now = new Date();
        const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        await pool.query(
          `UPDATE users
           SET subscription_tier = 'premium',
               payment_status = 'active',
               subscription_started_at = $1,
               subscription_expiry = $2
           WHERE id = $3`,
          [now, expiry, Number(userId)]
        );

        await pool.query(
          `INSERT INTO payment_events (user_id, event_type, payload, created_at)
           VALUES ($1, $2, $3::jsonb, NOW())`,
          [Number(userId), eventType, JSON.stringify(event)]
        );
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[Webhook Processing Error]', error.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
module.exports.ensureMembershipConfigSchema = ensureMembershipConfigSchema;

