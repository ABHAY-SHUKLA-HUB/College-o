const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { pool } = require('../db/pool');

// Verify a join token (JWT) and validate its JTI against the DB token store.
async function verifySessionToken({ token, cookies = {} } = {}) {
  const joinTokenSecret = process.env.LIVE_SESSION_TOKEN_SECRET || process.env.JOIN_TOKEN_SECRET || process.env.SESSION_SECRET || 'unsafe-dev-secret';
  const sessionCookieName = process.env.SESSION_COOKIE_NAME || 'college_os_sid';

  async function loadUserFromSessionId(sessionId) {
    if (!sessionId) return { user: null, authInfo: {} };

    try {
      const { rows } = await pool.query(
        `SELECT sess
         FROM session
         WHERE sid = $1
         LIMIT 1`,
        [String(sessionId)]
      );

      const sessionRow = rows[0];
      if (!sessionRow?.sess) return { user: null, authInfo: {} };

      const sessionData = typeof sessionRow.sess === 'string' ? JSON.parse(sessionRow.sess) : sessionRow.sess;
      const userId = Number(sessionData?.userId || sessionData?.user?.id || 0);
      if (!userId) {
        return { user: null, authInfo: { sessionData } };
      }

      const { rows: userRows } = await pool.query(
        `SELECT id, full_name, email, role, subscription_tier, payment_status, college_name, university_id, university_name, custom_university
         FROM users
         WHERE id = $1
         LIMIT 1`,
        [userId]
      );

      const user = userRows[0] || null;
      return { user, authInfo: { sessionData, sessionId: String(sessionId) } };
    } catch (_error) {
      return { user: null, authInfo: {} };
    }
  }

  if (token) {
    try {
      const payload = jwt.verify(String(token), String(joinTokenSecret), { issuer: 'college-os', audience: 'live-session' });
      // If token has a jti, ensure it exists in DB and is not expired/used.
      const jti = payload.jti || null;
      if (jti) {
        try {
          const { rows } = await pool.query('SELECT id, live_session_id, user_id, expires_at, used, meta FROM live_session_tokens WHERE jti = $1 LIMIT 1', [String(jti)]);
          const row = rows[0];
          if (!row) return { user: null, authInfo: {} };
          if (new Date(row.expires_at).getTime() < Date.now()) return { user: null, authInfo: { tokenPayload: payload, tokenRow: row, expired: true } };
          // return token row info for callers to decide marking as used
          return { user: payload.uid ? { id: payload.uid } : null, authInfo: { tokenPayload: payload, tokenRow: row } };
        } catch (e) {
          return { user: null, authInfo: {} };
        }
      }
      return { user: payload.uid ? { id: payload.uid } : null, authInfo: { tokenPayload: payload } };
    } catch (err) {
      return { user: null, authInfo: {} };
    }
  }

  const rawCookie = typeof cookies === 'string' ? cookies : cookie.serialize('cookie', '');
  try {
    const parsed = cookie.parse(rawCookie || '');
    const sessionId = parsed[sessionCookieName] || parsed['connect.sid'] || null;
    if (sessionId) {
      return await loadUserFromSessionId(sessionId);
    }
    return { user: null, authInfo: {} };
  } catch (err) {
    return { user: null, authInfo: {} };
  }
}

module.exports = {
  verifySessionToken
};
