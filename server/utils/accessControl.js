/**
 * Access Control Utilities
 * Prevents IDOR (Insecure Direct Object Reference) vulnerabilities
 * Ensures users can only access their own resources unless properly authorized
 */

/**
 * Verify user owns resource before allowing access
 * @param {number} resourceUserId - The user_id of the resource owner
 * @param {number} requestingUserId - The ID of the user making the request
 * @param {object} req - Express request object (for logging)
 * @returns {boolean} true if access allowed, false otherwise
 * @throws {Error} if access denied (for logging purposes)
 */
function requireResourceOwnership(resourceUserId, requestingUserId, req = null) {
  if (Number(resourceUserId) !== Number(requestingUserId)) {
    const message = `User ${requestingUserId} attempted unauthorized access to user ${resourceUserId} resource`;
    if (req) {
      console.warn(`[IDOR Attempt] Path: ${req.path}, User: ${requestingUserId}, Target: ${resourceUserId}`);
    }
    throw new Error(message);
  }
  return true;
}

/**
 * Verify user is admin - prevents privilege escalation
 * @param {string} userRole - The role from session
 * @param {number} userId - User ID (for logging)
 * @returns {boolean} true if admin, false otherwise
 */
function requireAdminRole(userRole, userId) {
  if (userRole !== 'admin') {
    console.warn(`[Privilege Escalation Attempt] User ${userId} attempted admin action with role: ${userRole}`);
    return false;
  }
  return true;
}

/**
 * Verify user has paid access - prevents free/trial users from accessing premium features
 * @param {boolean} isPaidActive - Whether subscription is active
 * @param {number} userId - User ID (for logging)
 * @param {string} feature - Feature name (for logging)
 * @returns {boolean} true if paid, false otherwise
 */
function requirePaidAccess(isPaidActive, userId, feature = 'feature') {
  if (!isPaidActive) {
    console.warn(`[Payment Required] User ${userId} attempted to access ${feature} without payment`);
    return false;
  }
  return true;
}

/**
 * Build safe database WHERE clause from request params
 * Prevents SQL injection by whitelist approach
 * @param {object} params - Query parameters from request
 * @param {array} allowedFields - Whitelist of allowed field names
 * @returns {object} {clause: 'field1 = $1 AND field2 = $2', values: [val1, val2]}
 */
function buildSafeWhereClause(params, allowedFields = []) {
  if (!params || !allowedFields || allowedFields.length === 0) {
    return { clause: '', values: [] };
  }

  const clause = [];
  const values = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (field in params && params[field] !== undefined && params[field] !== null) {
      let value = params[field];
      
      // Type validation
      if (field.includes('id') && !Number.isInteger(Number(value))) {
        continue;  // Skip non-integer IDs
      }
      
      clause.push(`${field} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  return {
    clause: clause.length ? 'WHERE ' + clause.join(' AND ') : '',
    values
  };
}

/**
 * Validate that resource ID is integer before database query
 * Prevents SQL injection attempts via malformed IDs
 * @param {any} id - The resource ID to validate
 * @param {string} paramName - Parameter name (for error message)
 * @returns {number} The validated ID
 * @throws {Error} if ID is invalid
 */
function validateResourceId(id, paramName = 'id') {
  const numId = Number(id);
  
  if (!Number.isInteger(numId) || numId <= 0) {
    throw new Error(`Invalid ${paramName}: must be positive integer`);
  }
  
  return numId;
}

/**
 * Prevent parameter tampering by checking signature
 * @param {object} data - The data to sign
 * @param {string} secret - Secret key from environment
 * @returns {string} HMAC signature
 */
function signData(data, secret) {
  const crypto = require('crypto');
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify signed data hasn't been tampered with
 * @param {object} data - The data that was signed
 * @param {string} signature - The provided signature
 * @param {string} secret - Secret key from environment
 * @returns {boolean} true if signature valid
 */
function verifySignature(data, signature, secret) {
  const crypto = require('crypto');
  const expected = signData(data, secret);
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch (err) {
    return false;
  }
}

/**
 * Middleware factory to enforce resource ownership
 * @param {string} paramName - URL parameter name containing resource ID
 * @param {string} userIdField - Field name in database containing owner user_id
 * @param {function} queryFn - Function to query database: (id) => Promise<resourceObj>
 * @returns {function} Express middleware
 */
function ownershipMiddleware(paramName, userIdField = 'user_id', queryFn) {
  return async (req, res, next) => {
    try {
      const resourceId = validateResourceId(req.params[paramName], paramName);
      const requestingUserId = req.session.userId;

      if (!requestingUserId) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const resource = await queryFn(resourceId);

      if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      if (Number(resource[userIdField]) !== Number(requestingUserId)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      req.resource = resource;
      return next();
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  };
}

/**
 * Rate limit by user ID instead of IP
 * Prevents users from bypassing rate limits via shared IPs
 * @param {number} userId - User ID
 * @returns {string} Rate limit key
 */
function getRateKey(userId, endpoint = 'general') {
  return `ratelimit:${endpoint}:${userId}`;
}

module.exports = {
  requireResourceOwnership,
  requireAdminRole,
  requirePaidAccess,
  buildSafeWhereClause,
  validateResourceId,
  signData,
  verifySignature,
  ownershipMiddleware,
  getRateKey
};
