const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { ensureSupportSchema } = require('../utils/supportSchema');
const { sendEmail } = require('../utils/mailer');
const logger = require('../services/logger');
const { publishRealtimeEvent } = require('../services/realtimeBus');
const { requireFeatureEnabled } = require('../middleware/featureToggle');

const router = express.Router();

// Helper: Escape HTML strings to prevent stored XSS
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper: Non-blocking notification creator
async function notifyUser(userId, { type, kind, title, message, entityType, entityId, emailSubject, emailBody }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO notifications (user_id, type, kind, title, message, entity_type, entity_id, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, NOW())
       RETURNING id`,
      [
        userId,
        type || 'SUPPORT',
        kind || type || 'support_ticket',
        title || 'Support Update',
        message,
        entityType || 'support_ticket',
        entityId ? Number(entityId) : null
      ]
    );

    publishRealtimeEvent('notification_created', { userId, notificationId: rows[0]?.id });

    // Optional email dispatch (post-commit, non-blocking fault tolerant)
    if (emailSubject && emailBody) {
      setImmediate(() => {
        pool.query('SELECT email FROM users WHERE id = $1', [userId])
          .then((userRes) => {
            if (userRes.rows[0]?.email) {
              return sendEmail(userRes.rows[0].email, emailSubject, emailBody);
            }
          })
          .catch((mailErr) => {
            logger.warn(`[Support] Notification email failed for user ${userId}:`, mailErr.message);
          });
      });
    }
  } catch (err) {
    logger.error(`[Support] Failed to create notification for user ${userId}:`, err.message);
  }
}

// Generate unique human-friendly ticket number: SUP-2026-XXXXXX
async function generateTicketNumber() {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `SUP-${year}-${rand}`;
}

// Ensure database tables exist
router.use(async (_req, _res, next) => {
  try {
    await ensureSupportSchema();
    next();
  } catch (err) {
    next(err);
  }
});

// ─── STUDENT ROUTES ─────────────────────────────────────────────────────────

// Create Support Ticket
router.post('/tickets', requireFeatureEnabled('support'), requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { subject, category, description, priority, attachment_urls, entity_type, entity_id } = req.body || {};

  if (!subject || !description) {
    return res.status(400).json({ error: 'Subject and description are required.' });
  }

  const cleanSubject = escapeHtml(String(subject).trim().slice(0, 250));
  const cleanCategory = escapeHtml(String(category || 'General').trim().slice(0, 80));
  const cleanDescription = escapeHtml(String(description).trim().slice(0, 5000));
  
  // Priority selected by student is treated as request input; normalize to allowed set
  const allowedPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
  const inputPriority = String(priority || 'NORMAL').toUpperCase();
  const cleanPriority = allowedPriorities.includes(inputPriority) ? inputPriority : 'NORMAL';

  const safeAttachments = Array.isArray(attachment_urls)
    ? attachment_urls.filter((url) => typeof url === 'string').slice(0, 5)
    : [];

  try {
    const ticketNumber = await generateTicketNumber();

    const { rows: ticketRows } = await pool.query(
      `INSERT INTO support_tickets
         (ticket_number, user_id, category, issue_type, subject, description, priority, status, entity_type, entity_id, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, $9, NOW())
       RETURNING id, ticket_number, category, subject, description, priority, status, created_at, last_activity_at`,
      [ticketNumber, userId, cleanCategory, cleanCategory || cleanSubject, cleanSubject, cleanDescription, cleanPriority, entity_type || null, entity_id ? Number(entity_id) : null]
    );

    const ticket = ticketRows[0];

    // Create initial public message in conversation thread
    await pool.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message, visibility, attachment_urls)
       VALUES ($1, 'STUDENT', $2, $3, 'PUBLIC', $4::jsonb)`,
      [ticket.id, userId, cleanDescription, JSON.stringify(safeAttachments)]
    );

    // Notify user of successful creation
    notifyUser(userId, {
      type: 'SUPPORT_TICKET_CREATED',
      title: `Support Ticket Received: ${ticket.ticket_number}`,
      message: `Your support request "${cleanSubject}" has been submitted under ticket ${ticket.ticket_number}.`,
      entityType: 'support_ticket',
      entityId: ticket.id
    });

    res.status(201).json({ success: true, ticket });
  } catch (err) {
    logger.error('[Support] Failed to create ticket:', err);
    res.status(500).json({ error: 'Failed to create support ticket.', details: err.message });
  }
});

// Get My Tickets
router.get('/tickets/mine', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.ticket_number, t.category, t.subject, t.status, t.priority, t.last_activity_at, t.created_at, t.resolved_at
       FROM support_tickets t
       WHERE t.user_id = $1
       ORDER BY t.last_activity_at DESC`,
      [userId]
    );
    res.json({ success: true, tickets: rows });
  } catch (err) {
    logger.error('[Support] Failed to load my tickets:', err);
    res.status(500).json({ error: 'Failed to load tickets.' });
  }
});

// Get Student Ticket Detail (Strict Anti-IDOR)
router.get('/tickets/:id', requireAuth, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const userId = req.session.userId;

  if (!Number.isInteger(ticketId)) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  try {
    // Ownership filter strictly enforced
    const { rows: ticketRows } = await pool.query(
      `SELECT id, ticket_number, category, subject, description, status, priority, resolved_at, closed_at, resolution_summary, last_activity_at, created_at
       FROM support_tickets
       WHERE id = $1 AND user_id = $2`,
      [ticketId, userId]
    );

    if (ticketRows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found or access denied.' });
    }

    const ticket = ticketRows[0];

    // Fetch ONLY PUBLIC messages. Internal notes MUST NEVER leak to the student payload!
    const { rows: messages } = await pool.query(
      `SELECT m.id, m.sender_type, m.sender_id, m.message, m.attachment_urls, m.created_at, u.full_name AS sender_name
       FROM support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.ticket_id = $1 AND m.visibility = 'PUBLIC'
       ORDER BY m.created_at ASC`,
      [ticketId]
    );

    res.json({ success: true, ticket, messages });
  } catch (err) {
    logger.error('[Support] Failed to load ticket detail:', err);
    res.status(500).json({ error: 'Failed to load ticket detail.' });
  }
});

// Post Student Reply
router.post('/tickets/:id/reply', requireFeatureEnabled('support'), requireAuth, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const userId = req.session.userId;
  const { message, attachment_urls } = req.body || {};

  if (!Number.isInteger(ticketId) || !message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const cleanMessage = escapeHtml(String(message).trim().slice(0, 4000));
  const safeAttachments = Array.isArray(attachment_urls)
    ? attachment_urls.filter((url) => typeof url === 'string').slice(0, 5)
    : [];

  try {
    const { rows: ticketRows } = await pool.query(
      `SELECT id, ticket_number, status, assigned_admin_id FROM support_tickets WHERE id = $1 AND user_id = $2`,
      [ticketId, userId]
    );

    if (ticketRows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found or access denied.' });
    }

    const ticket = ticketRows[0];

    if (ticket.status === 'CLOSED') {
      return res.status(400).json({ error: 'Cannot reply to a closed ticket.' });
    }

    const { rows: msgRows } = await pool.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message, visibility, attachment_urls)
       VALUES ($1, 'STUDENT', $2, $3, 'PUBLIC', $4::jsonb)
       RETURNING id, sender_type, sender_id, message, attachment_urls, created_at`,
      [ticketId, userId, cleanMessage, JSON.stringify(safeAttachments)]
    );

    // Transition status to WAITING_FOR_ADMIN
    await pool.query(
      `UPDATE support_tickets
       SET status = 'WAITING_FOR_ADMIN', last_activity_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [ticketId]
    );

    res.json({ success: true, reply: msgRows[0] });
  } catch (err) {
    logger.error('[Support] Failed to post student reply:', err);
    res.status(500).json({ error: 'Failed to submit reply.' });
  }
});

// ─── ADMIN ROUTES ──────────────────────────────────────────────────────────

// Admin Ticket Queue
router.get(['/admin/tickets', '/admin/support/tickets', '/tickets'], requireAdmin, async (req, res) => {
  const { status, priority, category, assigned_admin_id, search, page } = req.query;
  const limit = 30;
  const offset = (Math.max(1, parseInt(page) || 1) - 1) * limit;

  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    params.push(String(status).toUpperCase());
    conditions.push(`t.status = $${params.length}`);
  }
  if (priority && priority !== 'all') {
    params.push(String(priority).toUpperCase());
    conditions.push(`t.priority = $${params.length}`);
  }
  if (category && category !== 'all') {
    params.push(String(category));
    conditions.push(`t.category = $${params.length}`);
  }
  if (assigned_admin_id && assigned_admin_id !== 'all') {
    if (assigned_admin_id === 'unassigned') {
      conditions.push(`t.assigned_admin_id IS NULL`);
    } else {
      params.push(parseInt(assigned_admin_id));
      conditions.push(`t.assigned_admin_id = $${params.length}`);
    }
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(t.ticket_number ILIKE $${params.length} OR t.subject ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT t.id, t.ticket_number, t.category, t.subject, t.status, t.priority, t.assigned_admin_id,
              t.last_activity_at, t.created_at, t.resolved_at,
              u.full_name AS student_name, u.email AS student_email,
              a.full_name AS assigned_admin_name
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN users a ON a.id = t.assigned_admin_id
       ${where}
       ORDER BY t.last_activity_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM support_tickets t JOIN users u ON u.id = t.user_id ${where}`,
      countParams
    );

    res.json({ success: true, tickets: rows, total: parseInt(countRows[0].total), page: Math.max(1, parseInt(page) || 1), limit });
  } catch (err) {
    logger.error('[Support] Admin queue fetch failed:', err);
    res.status(500).json({ error: 'Failed to load support queue.' });
  }
});

// Admin Ticket Detail (Includes Public Messages AND Staff Internal Notes)
router.get(['/admin/tickets/:id', '/admin/support/tickets/:id'], requireAdmin, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  if (!Number.isInteger(ticketId)) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  try {
    const { rows: ticketRows } = await pool.query(
      `SELECT t.*, u.full_name AS student_name, u.email AS student_email, a.full_name AS assigned_admin_name
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       LEFT JOIN users a ON a.id = t.assigned_admin_id
       WHERE t.id = $1`,
      [ticketId]
    );

    if (ticketRows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const ticket = ticketRows[0];

    const { rows: messages } = await pool.query(
      `SELECT m.id, m.sender_type, m.sender_id, m.message, m.visibility, m.attachment_urls, m.created_at, u.full_name AS sender_name
       FROM support_messages m
       JOIN users u ON u.id = m.sender_id
       WHERE m.ticket_id = $1
       ORDER BY m.created_at ASC`,
      [ticketId]
    );

    const { rows: internalNotes } = await pool.query(
      `SELECT n.id, n.admin_id, n.note, n.created_at, u.full_name AS admin_name
       FROM support_internal_notes n
       JOIN users u ON u.id = n.admin_id
       WHERE n.ticket_id = $1
       ORDER BY n.created_at ASC`,
      [ticketId]
    );

    res.json({ success: true, ticket, messages, internalNotes });
  } catch (err) {
    logger.error('[Support] Admin ticket detail fetch failed:', err);
    res.status(500).json({ error: 'Failed to load ticket detail.' });
  }
});

// Admin Ticket Assignment
router.post(['/admin/tickets/:id/assign', '/admin/support/tickets/:id/assign'], requireAdmin, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const { assigned_admin_id } = req.body || {};

  if (!Number.isInteger(ticketId)) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  const targetAdminId = assigned_admin_id ? parseInt(assigned_admin_id) : null;

  try {
    if (targetAdminId) {
      const adminCheck = await pool.query(`SELECT id, role FROM users WHERE id = $1 AND role IN ('admin', 'super_admin')`, [targetAdminId]);
      if (adminCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid assigned admin user.' });
      }
    }

    const { rowCount } = await pool.query(
      `UPDATE support_tickets
       SET assigned_admin_id = $1, last_activity_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [targetAdminId, ticketId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    res.json({ success: true, ticketId, assigned_admin_id: targetAdminId });
  } catch (err) {
    logger.error('[Support] Admin assign ticket failed:', err);
    res.status(500).json({ error: 'Failed to assign ticket.' });
  }
});

// Admin Update Status / Priority
router.put(['/admin/tickets/:id/status', '/admin/support/tickets/:id/status'], requireAdmin, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const { status, priority } = req.body || {};

  if (!Number.isInteger(ticketId)) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  const allowedStatuses = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_STUDENT', 'WAITING_FOR_ADMIN', 'RESOLVED', 'CLOSED'];
  const allowedPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

  const nextStatus = status ? String(status).toUpperCase() : null;
  const nextPriority = priority ? String(priority).toUpperCase() : null;

  if (nextStatus && !allowedStatuses.includes(nextStatus)) {
    return res.status(400).json({ error: 'Invalid status transition.' });
  }
  if (nextPriority && !allowedPriorities.includes(nextPriority)) {
    return res.status(400).json({ error: 'Invalid priority value.' });
  }

  try {
    const updates = [];
    const params = [];

    if (nextStatus) {
      params.push(nextStatus);
      updates.push(`status = $${params.length}`);

      if (nextStatus === 'RESOLVED') {
        params.push(req.session.userId);
        updates.push(`resolved_at = NOW()`, `resolved_by = $${params.length}`);
      } else if (nextStatus === 'CLOSED') {
        updates.push(`closed_at = NOW()`);
      }
    }

    if (nextPriority) {
      params.push(nextPriority);
      updates.push(`priority = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    updates.push(`last_activity_at = NOW()`, `updated_at = NOW()`);
    params.push(ticketId);

    const { rowCount } = await pool.query(
      `UPDATE support_tickets SET ${updates.join(', ')} WHERE id = $${params.length}`,
      params
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    res.json({ success: true, ok: true });
  } catch (err) {
    logger.error('[Support] Admin update status failed:', err);
    res.status(500).json({ error: 'Failed to update ticket.' });
  }
});

// Admin Post Public Reply
router.post(['/admin/tickets/:id/reply', '/admin/support/tickets/:id/reply'], requireAdmin, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const { message, attachment_urls, status } = req.body || {};

  if (!Number.isInteger(ticketId) || !message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const cleanMessage = escapeHtml(String(message).trim().slice(0, 4000));
  const safeAttachments = Array.isArray(attachment_urls)
    ? attachment_urls.filter((url) => typeof url === 'string').slice(0, 5)
    : [];

  const nextStatus = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_STUDENT', 'RESOLVED', 'CLOSED'].includes(String(status).toUpperCase())
    ? String(status).toUpperCase()
    : 'WAITING_FOR_STUDENT';

  try {
    const { rows: ticketRows } = await pool.query(
      `SELECT id, ticket_number, user_id, subject FROM support_tickets WHERE id = $1`,
      [ticketId]
    );

    if (ticketRows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const ticket = ticketRows[0];

    const { rows: msgRows } = await pool.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message, visibility, attachment_urls)
       VALUES ($1, 'ADMIN', $2, $3, 'PUBLIC', $4::jsonb)
       RETURNING id, sender_type, sender_id, message, attachment_urls, created_at`,
      [ticketId, req.session.userId, cleanMessage, JSON.stringify(safeAttachments)]
    );

    await pool.query(
      `UPDATE support_tickets
       SET status = $1, last_activity_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [nextStatus, ticketId]
    );

    // Notify Student
    notifyUser(ticket.user_id, {
      type: 'SUPPORT_REPLY',
      title: `Admin Reply: ${ticket.ticket_number}`,
      message: `Support team replied to your ticket "${ticket.subject}".`,
      entityType: 'support_ticket',
      entityId: ticket.id,
      emailSubject: `[College OS Support] Update on Ticket ${ticket.ticket_number}`,
      emailBody: `Hello,\n\nOur support team has replied to your ticket (${ticket.ticket_number}):\n\n"${cleanMessage}"\n\nLog in to your College OS account to view the full conversation.`
    });

    res.json({ success: true, reply: msgRows[0] });
  } catch (err) {
    logger.error('[Support] Admin post reply failed:', err);
    res.status(500).json({ error: 'Failed to post reply.' });
  }
});

// Admin Post Internal Staff Note (NEVER LEAKS TO STUDENT API)
router.post(['/admin/tickets/:id/internal-notes', '/admin/support/tickets/:id/internal-notes'], requireAdmin, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const { note } = req.body || {};

  if (!Number.isInteger(ticketId) || !note) {
    return res.status(400).json({ error: 'Internal note text is required.' });
  }

  const cleanNote = escapeHtml(String(note).trim().slice(0, 4000));

  try {
    const { rows: ticketRows } = await pool.query(`SELECT id FROM support_tickets WHERE id = $1`, [ticketId]);
    if (ticketRows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const { rows: noteRows } = await pool.query(
      `INSERT INTO support_internal_notes (ticket_id, admin_id, note)
       VALUES ($1, $2, $3)
       RETURNING id, admin_id, note, created_at`,
      [ticketId, req.session.userId, cleanNote]
    );

    await pool.query(
      `INSERT INTO support_messages (ticket_id, sender_type, sender_id, message, visibility)
       VALUES ($1, 'ADMIN', $2, $3, 'INTERNAL')`,
      [ticketId, req.session.userId, cleanNote]
    );

    await pool.query(
      `UPDATE support_tickets SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [ticketId]
    );

    res.json({ success: true, internalNote: noteRows[0] });
  } catch (err) {
    logger.error('[Support] Admin internal note failed:', err);
    res.status(500).json({ error: 'Failed to add internal note.' });
  }
});

// Admin Resolve Ticket
router.post(['/admin/tickets/:id/resolve', '/admin/support/tickets/:id/resolve'], requireAdmin, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const { resolution_summary } = req.body || {};

  if (!Number.isInteger(ticketId)) {
    return res.status(400).json({ error: 'Invalid ticket ID.' });
  }

  const cleanSummary = resolution_summary ? escapeHtml(String(resolution_summary).trim().slice(0, 2000)) : null;

  try {
    const { rows: ticketRows } = await pool.query(
      `SELECT id, ticket_number, user_id, subject FROM support_tickets WHERE id = $1`,
      [ticketId]
    );

    if (ticketRows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    const ticket = ticketRows[0];

    await pool.query(
      `UPDATE support_tickets
       SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = $1, resolution_summary = $2, last_activity_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [req.session.userId, cleanSummary, ticketId]
    );

    notifyUser(ticket.user_id, {
      type: 'TICKET_RESOLVED',
      title: `Ticket Resolved: ${ticket.ticket_number}`,
      message: `Your support ticket "${ticket.subject}" has been marked as resolved.`,
      entityType: 'support_ticket',
      entityId: ticket.id,
      emailSubject: `[College OS Support] Ticket ${ticket.ticket_number} Resolved`,
      emailBody: `Hello,\n\nYour support ticket (${ticket.ticket_number}) has been resolved.${cleanSummary ? `\n\nResolution:\n${cleanSummary}` : ''}\n\nThank you for using College OS.`
    });

    res.json({ success: true, ok: true });
  } catch (err) {
    logger.error('[Support] Admin resolve ticket failed:', err);
    res.status(500).json({ error: 'Failed to resolve ticket.' });
  }
});

module.exports = router;
