const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const { pool } = require('../db/pool');

// Verify a join token (JWT) and validate its JTI against the DB token store.
async function verifySessionToken({ token, cookies = {} } = {}) {
  const joinTokenSecret = process.env.LIVE_SESSION_TOKEN_SECRET || process.env.JOIN_TOKEN_SECRET || process.env.SESSION_SECRET || 'unsafe-dev-secret';
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

  // try session cookie (fallback) - not decoding; should integrate with session store in prod
  try {
    const rawCookie = typeof cookies === 'string' ? cookies : cookie.serialize('cookie', '');
    return { user: null, authInfo: {} };
  } catch (err) {
    return { user: null, authInfo: {} };
  }
}

module.exports = {
  verifySessionToken
};
