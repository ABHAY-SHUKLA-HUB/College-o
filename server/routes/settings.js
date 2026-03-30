const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/icons', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT icon_size, icon_style, preferences FROM user_icons WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [req.session.userId]);
  res.json({ settings: rows[0] || { icon_size: 'medium', icon_style: 'fontawesome', preferences: {} } });
});

router.put('/icons', requireAuth, async (req, res) => {
  const { iconSize, iconStyle, preferences } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO user_icons (user_id, icon_size, icon_style, preferences)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING icon_size, icon_style, preferences`,
    [req.session.userId, iconSize || 'medium', iconStyle || 'fontawesome', JSON.stringify(preferences || {})]
  );
  res.json({ settings: rows[0] });
});

router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sid, expire, sess::text AS sess_text
       FROM session
       WHERE sess::text ILIKE $1
       ORDER BY expire DESC
       LIMIT 20`,
      [`%\"userId\":${req.session.userId}%`]
    );

    const sessions = rows.map((row) => ({
      sessionId: row.sid,
      expiresAt: row.expire,
      isCurrent: row.sid === req.sessionID
    }));

    res.json({ sessions });
  } catch {
    // Session table may be unavailable in some local modes.
    res.json({ sessions: [] });
  }
});

router.post('/sessions/logout-all', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM session
       WHERE sess::text ILIKE $1
         AND sid <> $2`,
      [`%\"userId\":${req.session.userId}%`, req.sessionID]
    );
    res.json({ ok: true, message: 'Logged out from all other devices' });
  } catch {
    res.status(200).json({ ok: true, message: 'No active session store found' });
  }
});

module.exports = router;
