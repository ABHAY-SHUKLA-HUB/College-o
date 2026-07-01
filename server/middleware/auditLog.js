const { pool } = require('../db/pool');

/**
 * Security audit logging
 * Logs security-relevant events for monitoring and compliance
 * NEVER logs passwords, tokens, OTPs, or other sensitive data
 */

async function logSecurityEvent(eventType, details = {}) {
  try {
    const now = new Date().toISOString();
    const eventData = {
      timestamp: now,
      type: eventType,
      ...details
    };

    // Log to console in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[SecurityAudit] ${eventType}`, JSON.stringify(eventData, null, 2));
    }

    // Store in database if table exists
    try {
      await pool.query(
        `INSERT INTO security_audit_log (event_type, user_id, ip_address, details, created_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW())`,
        [eventType, details.userId || null, details.ip || null, JSON.stringify(eventData)]
      );
    } catch (err) {
      // Table might not exist; log to console only
      console.warn('[SecurityAudit] Could not write to audit log:', err.message);
    }
  } catch (err) {
    console.error('[SecurityAudit] Error logging event:', err.message);
  }
}

async function logLoginAttempt(email, userId, ip, success, reason = null) {
  await logSecurityEvent('LOGIN_ATTEMPT', {
    email: email || 'unknown',
    userId: userId || null,
    ip,
    success,
    reason
  });
}

async function logLogout(userId, ip) {
  await logSecurityEvent('LOGOUT', {
    userId,
    ip
  });
}

async function logAdminAction(userId, action, resourceType, resourceId, changes = null, ip) {
  await logSecurityEvent('ADMIN_ACTION', {
    userId,
    ip,
    action,
    resourceType,
    resourceId,
    changes
  });
}

async function logRoleChange(adminId, targetUserId, oldRole, newRole, ip) {
  await logSecurityEvent('ROLE_CHANGE', {
    adminId,
    targetUserId,
    oldRole,
    newRole,
    ip
  });
}

async function logUnauthorizedAccess(userId, ip, path, reason) {
  await logSecurityEvent('UNAUTHORIZED_ACCESS', {
    userId: userId || null,
    ip,
    path,
    reason
  });
}

async function logSuspiciousActivity(userId, ip, activityType, details) {
  await logSecurityEvent('SUSPICIOUS_ACTIVITY', {
    userId: userId || null,
    ip,
    activityType,
    details
  });
}

async function logPasswordChange(userId, ip) {
  await logSecurityEvent('PASSWORD_CHANGED', {
    userId,
    ip
  });
}

async function logAccountLocked(email, ip, reason) {
  await logSecurityEvent('ACCOUNT_LOCKED', {
    email,
    ip,
    reason
  });
}

async function logContentAccess(userId, ip, contentType, contentId, allowed) {
  await logSecurityEvent('CONTENT_ACCESS', {
    userId,
    ip,
    contentType,
    contentId,
    allowed
  });
}

/**
 * Middleware: Track security events from request context
 */
function auditLog(eventType) {
  return async (req, res, next) => {
    // Wrap res.json to capture response status
    const originalJson = res.json;
    res.json = function(data) {
      if (res.statusCode >= 400) {
        logSecurityEvent(eventType, {
          userId: req.session?.userId || null,
          ip: req.ip || 'unknown',
          path: req.path,
          method: req.method,
          status: res.statusCode
        });
      }
      return originalJson.call(this, data);
    };

    next();
  };
}

module.exports = {
  logSecurityEvent,
  logLoginAttempt,
  logLogout,
  logAdminAction,
  logRoleChange,
  logUnauthorizedAccess,
  logSuspiciousActivity,
  logPasswordChange,
  logAccountLocked,
  logContentAccess,
  auditLog
};
