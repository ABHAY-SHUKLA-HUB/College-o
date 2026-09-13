const { pool } = require('../db/pool');

const SENSITIVE_FIELD_PATTERNS = [
  /password/i, /secret/i, /token/i, /otp/i, /key$/i, /auth/i, /cookie/i, /jwt/i, /proof_data/i
];

function redactSensitiveFields(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(redactSensitiveFields);
  if (typeof val === 'object') {
    const clean = {};
    for (const [key, v] of Object.entries(val)) {
      if (SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(key))) {
        clean[key] = '[REDACTED]';
      } else {
        clean[key] = redactSensitiveFields(v);
      }
    }
    return clean;
  }
  return val;
}

async function getUserRole(userId) {
  if (!userId) return null;
  const { rows } = await pool.query('SELECT role, admin_role FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return null;
  return rows[0].admin_role || rows[0].role || null;
}

async function getUserPermissions(userId) {
  if (!userId) return { role: null, permissions: [] };

  const { rows } = await pool.query(
    'SELECT id, role, admin_role, is_suspended, is_blocked, deleted_at FROM users WHERE id = $1',
    [userId]
  );
  const user = rows[0];
  if (!user || user.deleted_at || user.is_suspended || user.is_blocked) {
    return { role: null, permissions: [], isInactive: true };
  }

  const effectiveRole = user.admin_role || (user.role === 'super_admin' ? 'super_admin' : user.role);

  if (effectiveRole === 'super_admin' || user.role === 'super_admin') {
    return { role: 'super_admin', permissions: ['*'] };
  }

  // Query permissions mapped to effectiveRole in DB
  const permRes = await pool.query(
    `SELECT permission_key FROM role_permissions WHERE role_key = $1
     UNION
     SELECT jsonb_array_elements_text(permissions) AS permission_key FROM admin_permissions WHERE admin_role = $1`,
    [effectiveRole]
  );

  const permissions = Array.from(new Set(permRes.rows.map(r => r.permission_key).filter(Boolean)));
  return { role: effectiveRole, permissions };
}

/**
 * Require permission middleware
 * @param {string|string[]} requiredPermissions - Required permission key(s)
 * @param {Object} options - { mode: 'ANY' | 'ALL' }
 */
function requirePermission(requiredPermissions, options = {}) {
  const mode = (options.mode || 'ALL').toUpperCase();
  const reqPerms = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

  return async (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }

    const { role, permissions, isInactive } = await getUserPermissions(req.session.userId);
    if (isInactive) {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        message: 'Your account has been suspended or deactivated by an administrator.'
      });
    }

    if (!role || !['admin', 'super_admin', 'content_manager', 'support_agent', 'moderator'].includes(role)) {
      // Fallback check on users.role
      const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [req.session.userId]);
      if (!rows[0] || !['admin', 'super_admin'].includes(rows[0].role)) {
        return res.status(403).json({ error: 'Admin role required', code: 'PERMISSION_DENIED' });
      }
    }

    if (role === 'super_admin' || permissions.includes('*')) {
      req.userRole = role;
      req.userPermissions = permissions;
      return next();
    }

    let hasAccess = false;
    if (mode === 'ANY') {
      hasAccess = reqPerms.some(p => permissions.includes(p));
    } else {
      hasAccess = reqPerms.every(p => permissions.includes(p));
    }

    if (!hasAccess) {
      return res.status(403).json({
        error: `Permission denied: ${reqPerms.join(', ')}`,
        code: 'PERMISSION_DENIED',
        requiredPermissions: reqPerms
      });
    }

    req.userRole = role;
    req.userPermissions = permissions;
    return next();
  };
}

/**
 * Last Super Admin Safeguard
 * Returns true if targetUserId is a Super Admin AND demoting/suspending them would leave 0 active Super Admins.
 */
async function isLastSuperAdmin(targetUserId) {
  const { rows: targetUser } = await pool.query(
    'SELECT role, admin_role, is_suspended, is_blocked, deleted_at FROM users WHERE id = $1',
    [targetUserId]
  );
  if (!targetUser[0]) return false;

  const isSuperAdmin = targetUser[0].role === 'super_admin' || targetUser[0].admin_role === 'super_admin';
  if (!isSuperAdmin) return false;

  const { rows: countRes } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM users
     WHERE (role = 'super_admin' OR admin_role = 'super_admin')
       AND is_suspended = FALSE
       AND is_blocked = FALSE
       AND deleted_at IS NULL`
  );

  const totalActive = countRes[0]?.total || 0;
  return totalActive <= 1;
}

/**
 * Write Centralized Audit Log
 */
async function writeAuditLog(req, action, targetType, targetId, oldValues = null, newValues = null, metadata = {}) {
  try {
    const actorUserId = req?.session?.userId || req?.userId || null;
    let actorRole = req?.session?.role || req?.userRole || null;

    if (actorUserId && !actorRole) {
      const { rows } = await pool.query('SELECT role, admin_role FROM users WHERE id = $1', [actorUserId]);
      actorRole = rows[0]?.admin_role || rows[0]?.role || 'admin';
    }

    const cleanOld = redactSensitiveFields(oldValues);
    const cleanNew = redactSensitiveFields(newValues);
    const cleanMeta = redactSensitiveFields(metadata);

    const ipAddress = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.ip || '127.0.0.1';
    const userAgent = req?.headers?.['user-agent'] || 'unknown';

    // Insert into audit_logs
    await pool.query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, old_values, new_values, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [actorUserId, actorRole, action, targetType || null, targetId ? String(targetId) : null, cleanOld, cleanNew, cleanMeta, ipAddress, userAgent]
    );

    // Sync to admin_audit_logs if existing table
    await pool.query(
      `INSERT INTO admin_audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorUserId, actorRole, action, targetType || null, targetId ? String(targetId) : null, cleanMeta]
    );
  } catch (err) {
    console.error('[Audit Log Error]', err);
  }
}

async function getUserAcademicProfile(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT id, category_id, branch_id, semester_id, batch_year
     FROM student_academic_profile
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.userId = req.session.userId;
  return next();
}

function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const userRole = req.session.role || '';
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.userId = req.session.userId;
    req.userRole = userRole;
    return next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const role = req.session.role || '';
  if (!['admin', 'super_admin'].includes(role)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.userId = req.session.userId;
  req.userRole = role;
  return next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.session.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  req.userId = req.session.userId;
  return next();
}

function requireSupport(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const role = req.session.role || '';
  if (!['support', 'support_admin', 'admin', 'super_admin'].includes(role)) {
    return res.status(403).json({ error: 'Support access required' });
  }
  req.userId = req.session.userId;
  req.userRole = role;
  return next();
}

function requireStudent(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.session.role !== 'student') {
    return res.status(403).json({ error: 'Student access only' });
  }
  req.userId = req.session.userId;
  return next();
}

function requireOwnerOrAdmin(paramName = 'id') {
  return async (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const targetId = req.params[paramName];
    const userRole = req.session.role || '';
    const isAdmin = ['admin', 'super_admin'].includes(userRole);

    if (isAdmin) {
      req.userId = req.session.userId;
      req.userRole = userRole;
      return next();
    }

    const targetUserId = Number.parseInt(targetId, 10);
    if (req.session.userId === targetUserId) {
      req.userId = req.session.userId;
      req.userRole = userRole;
      return next();
    }

    return res.status(403).json({ error: 'Access denied' });
  };
}

function auditAction(actionType) {
  return async (req, res, next) => {
    req.auditAction = {
      type: actionType,
      userId: req.session?.userId || null,
      userRole: req.session?.role || null,
      ip: req.ip || 'unknown',
      method: req.method,
      path: req.path,
      timestamp: new Date().toISOString()
    };
    next();
  };
}

module.exports = {
  getUserRole,
  getUserPermissions,
  requirePermission,
  isLastSuperAdmin,
  writeAuditLog,
  redactSensitiveFields,
  getUserAcademicProfile,
  requireAuth,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requireSupport,
  requireStudent,
  requireOwnerOrAdmin,
  auditAction
};
