const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { resolveMembershipState } = require('../middleware/auth');

const router = express.Router();

router.get('/mine', requireAuth, async (req, res) => {
  const membership = await resolveMembershipState(req.session.userId);
  if (!membership?.isAdmin && !membership?.premiumActive) {
    return res.status(403).json({
      error: 'Certificates are premium. Upgrade to Premium (Rs.49/month).',
      code: 'UPGRADE_REQUIRED',
      membershipStatus: membership?.status || 'free'
    });
  }

  const { rows } = await pool.query(
    `SELECT
      c.id,
      c.type,
      c.issued_date,
      c.certificate_url,
      c.verification_code,
      c.created_at,
      u.full_name AS student_name,
      'Active'::text AS status
     FROM certificates c
     JOIN users u ON u.id = c.user_id
     WHERE c.user_id = $1
     ORDER BY c.issued_date DESC`,
    [req.session.userId]
  );
  res.json({ certificates: rows });
});

router.post('/', requireAdmin, async (req, res) => {
  const { type, certificateUrl, issuedDate, userId } = req.body;
  if (!type) return res.status(400).json({ error: 'Certificate type is required' });
  if (!userId) return res.status(400).json({ error: 'userId is required for issuing a certificate' });

  const verificationCode = `COL-${uuidv4().slice(0, 8).toUpperCase()}`;
  const { rows } = await pool.query(
    `INSERT INTO certificates (user_id, type, issued_date, certificate_url, verification_code)
     VALUES ($1, $2, $3::date, $4, $5)
     RETURNING id, type, issued_date, certificate_url, verification_code`,
    [Number(userId), type, issuedDate || new Date().toISOString().slice(0, 10), certificateUrl || null, verificationCode]
  );

  res.status(201).json({ certificate: rows[0] });
});

router.get('/verify/:code', async (req, res) => {
  const token = req.params.code;
  try {
    const { getPublicVerification } = require('../services/certificateService');
    const publicVerification = await getPublicVerification(token);
    if (publicVerification) {
      return res.json({
        valid: publicVerification.verified,
        status: publicVerification.status,
        revoked: publicVerification.status === 'REVOKED',
        certificate: publicVerification
      });
    }
  } catch (err) {
    console.warn('[Certificates API] Coding cert verify check skipped:', err.message);
  }

  // Fallback to legacy certificates table
  const { rows } = await pool.query(
    `SELECT c.id, c.type, c.issued_date, c.verification_code, u.full_name, u.college_name
     FROM certificates c
     JOIN users u ON u.id = c.user_id
     WHERE c.verification_code = $1`,
    [token]
  );
  if (!rows[0]) return res.status(404).json({ valid: false, error: 'Certificate not found' });

  let revoked = false;
  try {
    const revokeCheck = await pool.query(
      `SELECT status
       FROM admin_certificate_issuances
       WHERE verification_code = $1
       LIMIT 1`,
      [token]
    );
    revoked = revokeCheck.rows[0]?.status === 'Revoked';
  } catch {
    revoked = false;
  }

  if (revoked) {
    return res.status(410).json({ valid: false, revoked: true, certificate: rows[0] });
  }

  res.json({ valid: true, certificate: rows[0] });
});

module.exports = router;

