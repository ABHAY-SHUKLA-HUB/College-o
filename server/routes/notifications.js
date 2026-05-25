const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { subscribeRealtime, publishRealtimeEvent } = require('../services/realtimeBus');

const router = express.Router();

function setPrivateCacheHeaders(res, maxAgeSeconds = 5) {
  res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}, stale-while-revalidate=${Math.max(maxAgeSeconds * 2, 15)}`);
  res.setHeader('Vary', 'Cookie');
}

router.get('/stream', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const heartbeat = setInterval(() => {
    res.write('event: heartbeat\\n');
    res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\\n\\n`);
  }, 20000);

  const unsubscribe = subscribeRealtime((evt) => {
    const payload = evt?.payload || {};
    if (payload.userId && Number(payload.userId) !== Number(req.session.userId)) return;
    if (!['notification_changed', 'campus_post_moderated', 'campus_post_engagement', 'campus_post_comment', 'campus_official_post_published'].includes(evt.type)) return;

    res.write(`event: ${evt.type}\\n`);
    res.write(`data: ${JSON.stringify(payload)}\\n\\n`);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

router.get('/mine', requireAuth, async (req, res) => {
  setPrivateCacheHeaders(res, 5);
  const { rows } = await pool.query(
    'SELECT id, message, kind, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100',
    [req.session.userId]
  );

  const unreadResult = await pool.query(
    'SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [req.session.userId]
  );

  res.json({ notifications: rows, unreadCount: unreadResult.rows[0].unread_count });
});

router.get('/unread-count', requireAuth, async (req, res) => {
  setPrivateCacheHeaders(res, 5);
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS unread_count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [req.session.userId]
  );
  res.json({ unreadCount: rows[0].unread_count });
});

router.put('/mine/read-all', requireAuth, async (req, res) => {
  const result = await pool.query(
    `UPDATE notifications
     SET is_read = TRUE
     WHERE user_id = $1 AND is_read = FALSE`,
    [req.session.userId]
  );
  res.json({ message: 'All notifications marked as read', updatedCount: result.rowCount });
  publishRealtimeEvent('notification_changed', { userId: req.session.userId });
});

router.put('/mine/:id/read', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid notification id' });

  const { rows } = await pool.query(
    `UPDATE notifications
     SET is_read = TRUE
     WHERE id = $1 AND user_id = $2
     RETURNING id, is_read`,
    [id, req.session.userId]
  );

  if (!rows[0]) return res.status(404).json({ error: 'Notification not found' });
  publishRealtimeEvent('notification_changed', { userId: req.session.userId });
  res.json({ notification: rows[0], message: 'Notification marked as read' });
});

router.delete('/mine/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid notification id' });

  const result = await pool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [id, req.session.userId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Notification not found' });

  publishRealtimeEvent('notification_changed', { userId: req.session.userId });
  res.json({ message: 'Notification deleted successfully' });
});

module.exports = router;
