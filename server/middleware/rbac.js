const { pool } = require('../db/pool');

/**
 * Enhanced Role-Based Access Control (RBAC) middleware
 * Provides reusable middleware for role and permission checks
 */

async function getUserRole(userId) {
  if (!userId) return null;
  const { rows } = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return rows[0]?.role || null;
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

/**
 * Require authentication (already logged in)
 */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.userId = req.session.userId;
  return next();
}

/**
 * Require specific role(s)
 * @param {string|string[]} allowedRoles - Role(s) to check against
 */
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

/**
 * Require admin role (admin or super_admin)
 */
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

/**
 * Require super admin role only
 */
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

/**
 * Require support or admin role
 */
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

/**
 * Require student role only
 */
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

/**
 * Require owner or admin access
 * Checks if requester is the resource owner or is an admin
 */
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

    // Check if owner
    const targetUserId = Number.parseInt(targetId, 10);
    if (req.session.userId === targetUserId) {
      req.userId = req.session.userId;
      req.userRole = userRole;
      return next();
    }

    return res.status(403).json({ error: 'Access denied' });
  };
}

/**
 * Audit middleware - log security-relevant actions
 */
function auditAction(actionType) {
  return async (req, res, next) => {
    // Store audit info in request for later logging
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
