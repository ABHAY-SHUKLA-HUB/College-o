const { pool } = require('../db/pool');

function toDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function addNotificationIfMissing(userId, kind, message) {
  const existing = await pool.query(
    `SELECT id
     FROM notifications
     WHERE user_id = $1 AND kind = $2 AND created_at::date = CURRENT_DATE
     LIMIT 1`,
    [userId, kind]
  );

  if (existing.rowCount > 0) return;
  await pool.query(
    'INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)',
    [userId, message, kind]
  );
}

async function resolveMembershipState(userId) {
  const { rows } = await pool.query(
    `SELECT
      id,
      role,
      subscription_tier,
      payment_status,
      subscription_started_at,
      subscription_expiry
     FROM users
     WHERE id = $1`,
    [userId]
  );

  const user = rows[0];
  if (!user) return null;

  const now = new Date();
  const isAdmin = user.role === 'admin';
  const startedAt = toDate(user.subscription_started_at);
  const expiryAt = toDate(user.subscription_expiry);
  const paymentStatus = String(user.payment_status || '').toLowerCase();

  let tier = user.subscription_tier || 'free';
  let status = 'free';
  let statusLabel = 'Free';
  let premiumActive = false;

  if (isAdmin) {
    tier = 'premium';
    status = 'active';
    statusLabel = 'Active';
    premiumActive = true;
  } else if (tier === 'premium' && expiryAt && expiryAt > now) {
    status = 'active';
    statusLabel = 'Active';
    premiumActive = true;
  } else if (paymentStatus === 'pending_approval') {
    status = 'pending_approval';
    statusLabel = 'Pending Approval';
  } else if (paymentStatus === 'rejected') {
    status = 'rejected';
    statusLabel = 'Rejected';
  } else if (paymentStatus === 'expired' || (tier === 'premium' && expiryAt && expiryAt <= now)) {
    status = 'expired';
    statusLabel = 'Expired';
    tier = 'free';
    if (user.subscription_tier !== 'free' || paymentStatus !== 'expired') {
      await pool.query(
        `UPDATE users
         SET subscription_tier = 'free', payment_status = 'expired'
         WHERE id = $1`,
        [userId]
      );
      await addNotificationIfMissing(
        userId,
        'membership_expired',
        'Your premium membership has expired. Renew to continue full access.'
      );
    }
  }

  if (!premiumActive && status === 'free') {
    const pendingCheck = await pool.query(
      `SELECT status
       FROM membership_payment_requests
       WHERE user_id = $1
       ORDER BY submitted_at DESC
       LIMIT 1`,
      [userId]
    );

    const requestStatus = String(pendingCheck.rows[0]?.status || '').toLowerCase();
    if (requestStatus === 'pending') {
      status = 'pending_approval';
      statusLabel = 'Pending Approval';
    } else if (requestStatus === 'rejected') {
      status = 'rejected';
      statusLabel = 'Rejected';
    }
  }

  let remainingDays = 0;
  if (premiumActive && expiryAt) {
    remainingDays = Math.max(0, Math.ceil((expiryAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    if (remainingDays === 7 || remainingDays === 3 || remainingDays === 0) {
      const suffix = String(remainingDays);
      const message =
        remainingDays === 0
          ? 'Your premium membership expires today. Renew now to avoid losing access.'
          : `Your premium membership will expire in ${remainingDays} day${remainingDays === 1 ? '' : 's'}. Renew to continue full access.`;
      await addNotificationIfMissing(userId, `membership_expiry_${suffix}`, message);
    }
  }

  return {
    userId,
    role: user.role,
    isAdmin,
    tier,
    premiumActive,
    status,
    statusLabel,
    startDate: startedAt,
    expiryDate: expiryAt,
    remainingDays
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return next();
}

async function getAccessSnapshot(userId) {
  const membership = await resolveMembershipState(userId);
  if (!membership) return null;

  return {
    userId: membership.userId,
    role: membership.role,
    isAdmin: membership.isAdmin,
    paidActive: membership.premiumActive,
    trialUsed: false,
    trialActive: false,
    paymentStatus: membership.status,
    subscriptionExpiry: membership.expiryDate,
    trialStartsAt: null,
    trialEndsAt: null,
    membership
  };
}

async function requirePaidAccess(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const access = await getAccessSnapshot(req.session.userId);
  if (!access) return res.status(401).json({ error: 'Authentication required' });
  if (access.paidActive || access.isAdmin) {
    req.access = access;
    return next();
  }

  return res.status(402).json({
    error: 'Payment required to access this feature.',
    code: 'PAYMENT_REQUIRED',
    access
  });
}

async function requireTrialOrPaid(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const access = await getAccessSnapshot(req.session.userId);
  if (!access) return res.status(401).json({ error: 'Authentication required' });
  if (access.paidActive || access.trialActive || access.isAdmin) {
    req.access = access;
    return next();
  }

  return res.status(402).json({
    error: 'Start trial or complete payment to continue.',
    code: 'PAYMENT_REQUIRED',
    access
  });
}

async function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (req.session.role === 'admin' || req.session.role === 'super_admin') {
    return next();
  }

  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.session.userId]);
  if (!rows[0] || !['admin', 'super_admin'].includes(rows[0].role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Heal stale sessions so subsequent checks are instant.
  req.session.role = rows[0].role;
  return next();
}

module.exports = {
  requireAuth,
  requireAdmin,
  requirePaidAccess,
  requireTrialOrPaid,
  getAccessSnapshot,
  resolveMembershipState
};
