const { pool } = require('../db/pool');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { jsPDF } = require('jspdf');

/**
 * Certificate Helper: Default Configuration Structure
 */
const DEFAULT_TEMPLATE_CONFIG = {
  template_name: 'College OS Official Winner Certificate',
  title: 'CERTIFICATE OF ACHIEVEMENT',
  subtitle: 'This is proudly presented to',
  body: 'for securing {{position}} Position in {{contest_name}} held on {{contest_date}}.',
  footer: 'College OS Verified Academic Credential',
  organization_name: 'College OS',
  organizer_name: 'College OS Coding Platform',
  partner_label: 'Powered by',
  partner_name: '',
  sponsor_label: 'Sponsored by',
  sponsor_name: '',
  association_label: 'In Association With',
  association_name: '',
  tech_partner_label: 'Technology Partner',
  tech_partner_name: '',
  organized_by_label: 'Organized by',
  organized_by_name: 'College OS',
  logos: {
    main_logo: { enabled: true, url: '/assets/images/logo.png', alt: 'College OS' },
    partner_logo: { enabled: false, url: '', alt: 'Partner Logo' },
    sponsor_logo: { enabled: false, url: '', alt: 'Sponsor Logo' },
    signature_logo: { enabled: true, url: '/assets/images/signature.png', title: 'Authorized Signatory', name: 'Dean of Academics' }
  },
  styling: {
    theme_accent: 'gold', // 'gold', 'silver', 'bronze', 'classic_blue'
    title_size: 28,
    name_size: 24,
    body_size: 14,
    show_qr: true,
    show_cert_id: true,
    show_border: true
  }
};

/**
 * Text Placeholder Parser & Sanitizer
 */
function sanitizeText(text) {
  if (!text) return '';
  return String(text)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function renderPlaceholders(templateStr, vars = {}) {
  if (!templateStr) return '';
  let result = String(templateStr);
  const replacements = {
    '{{student_name}}': sanitizeText(vars.student_name || 'Abhay Shukla'),
    '{{position}}': sanitizeText(vars.position || '1st Position'),
    '{{rank}}': String(vars.rank || 1),
    '{{contest_name}}': sanitizeText(vars.contest_name || 'Weekly Coding Challenge'),
    '{{contest_date}}': sanitizeText(vars.contest_date || new Date().toLocaleDateString()),
    '{{issue_date}}': sanitizeText(vars.issue_date || new Date().toLocaleDateString()),
    '{{certificate_id}}': sanitizeText(vars.certificate_id || 'SAMPLE-CO-CODE-0001'),
    '{{organization_name}}': sanitizeText(vars.organization_name || 'College OS'),
    '{{partner_name}}': sanitizeText(vars.partner_name || ''),
    '{{sponsor_name}}': sanitizeText(vars.sponsor_name || ''),
    '{{association_name}}': sanitizeText(vars.association_name || ''),
    '{{tech_partner_name}}': sanitizeText(vars.tech_partner_name || ''),
    '{{powered_by_name}}': sanitizeText(vars.powered_by_name || vars.partner_name || ''),
    '{{organizer_name}}': sanitizeText(vars.organizer_name || 'College OS')
  };

  for (const [key, value] of Object.entries(replacements)) {
    const reg = new RegExp(key.replace(/[{()}]/g, '\\$&'), 'g');
    result = result.replace(reg, value);
  }
  return result;
}

/**
 * Ensure at least one default certificate template exists
 */
async function ensureDefaultTemplate(adminId = null) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT id FROM coding_certificate_templates LIMIT 1');
    if (rows.length > 0) return rows[0].id;

    await client.query('BEGIN');
    const templateRes = await client.query(
      `INSERT INTO coding_certificate_templates (name, description, status, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ['College OS Official Winner Certificate', 'Default template for Top 3 contest winners', 'active', adminId]
    );
    const templateId = templateRes.rows[0].id;

    await client.query(
      `INSERT INTO coding_certificate_template_versions (template_id, version_number, configuration, is_active, created_by)
       VALUES ($1, 1, $2, true, $3)`,
      [templateId, JSON.stringify(DEFAULT_TEMPLATE_CONFIG), adminId]
    );

    await client.query('COMMIT');
    return templateId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null);
    console.error('[CertificateService] ensureDefaultTemplate error:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Template Management API
 */
async function getTemplates({ status = null } = {}) {
  await ensureDefaultTemplate();
  let query = `
    SELECT t.*, v.id as active_version_id, v.version_number as active_version_number, v.configuration as active_configuration
    FROM coding_certificate_templates t
    LEFT JOIN coding_certificate_template_versions v ON v.template_id = t.id AND v.is_active = true
  `;
  const params = [];
  if (status) {
    query += ` WHERE t.status = $1`;
    params.push(status);
  }
  query += ` ORDER BY t.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

async function getTemplateById(id) {
  const tRes = await pool.query('SELECT * FROM coding_certificate_templates WHERE id = $1', [id]);
  if (tRes.rows.length === 0) return null;

  const template = tRes.rows[0];
  const vRes = await pool.query(
    'SELECT * FROM coding_certificate_template_versions WHERE template_id = $1 ORDER BY version_number DESC',
    [id]
  );
  template.versions = vRes.rows;
  template.active_version = vRes.rows.find((v) => v.is_active) || vRes.rows[0] || null;
  return template;
}

async function createTemplate({ name, description, configuration, adminId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tRes = await client.query(
      `INSERT INTO coding_certificate_templates (name, description, status, created_by)
       VALUES ($1, $2, 'active', $3) RETURNING *`,
      [name, description || '', adminId]
    );
    const template = tRes.rows[0];

    const configToSave = configuration || DEFAULT_TEMPLATE_CONFIG;
    const vRes = await client.query(
      `INSERT INTO coding_certificate_template_versions (template_id, version_number, configuration, is_active, created_by)
       VALUES ($1, 1, $2, true, $3) RETURNING *`,
      [template.id, JSON.stringify(configToSave), adminId]
    );

    await client.query('COMMIT');
    template.active_version = vRes.rows[0];
    return template;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

async function updateTemplate({ templateId, configuration, createNewVersion = false, name, description, adminId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (name || description !== undefined) {
      await client.query(
        `UPDATE coding_certificate_templates
         SET name = COALESCE($1, name), description = COALESCE($2, description), updated_at = NOW()
         WHERE id = $3`,
        [name, description, templateId]
      );
    }

    let activeVersion;
    if (createNewVersion) {
      // Deactivate all previous versions
      await client.query(
        `UPDATE coding_certificate_template_versions SET is_active = false WHERE template_id = $1`,
        [templateId]
      );

      const maxRes = await client.query(
        `SELECT COALESCE(MAX(version_number), 0) + 1 as next_ver FROM coding_certificate_template_versions WHERE template_id = $1`,
        [templateId]
      );
      const nextVer = maxRes.rows[0].next_ver;

      const vRes = await client.query(
        `INSERT INTO coding_certificate_template_versions (template_id, version_number, configuration, is_active, created_by)
         VALUES ($1, $2, $3, true, $4) RETURNING *`,
        [templateId, nextVer, JSON.stringify(configuration), adminId]
      );
      activeVersion = vRes.rows[0];
    } else {
      // Update existing active version configuration
      const vRes = await client.query(
        `UPDATE coding_certificate_template_versions
         SET configuration = $1, created_at = NOW()
         WHERE template_id = $2 AND is_active = true
         RETURNING *`,
        [JSON.stringify(configuration), templateId]
      );
      if (vRes.rows.length === 0) {
        // Create v1 if none existed
        const newV = await client.query(
          `INSERT INTO coding_certificate_template_versions (template_id, version_number, configuration, is_active, created_by)
           VALUES ($1, 1, $2, true, $3) RETURNING *`,
          [templateId, JSON.stringify(configuration), adminId]
        );
        activeVersion = newV.rows[0];
      } else {
        activeVersion = vRes.rows[0];
      }
    }

    await client.query('COMMIT');
    return { templateId, activeVersion };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}

async function duplicateTemplate(templateId, adminId) {
  const original = await getTemplateById(templateId);
  if (!original) throw new Error('Template not found');

  const newName = `${original.name} (Copy)`;
  const activeConfig = original.active_version ? original.active_version.configuration : DEFAULT_TEMPLATE_CONFIG;

  return createTemplate({
    name: newName,
    description: `Duplicated from ${original.name}`,
    configuration: activeConfig,
    adminId
  });
}

/**
 * Contest Finalization & Eligibility Generator
 */
async function finalizeContest(contestId, adminId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Verify contest
    const cRes = await client.query('SELECT * FROM coding_contests WHERE id = $1', [contestId]);
    if (cRes.rows.length === 0) throw new Error('Contest not found');
    const contest = cRes.rows[0];

    if (contest.status === 'finalized') {
      await client.query('COMMIT');
      return { message: 'Contest is already finalized', contestId };
    }

    // 2. Fetch Top 3 Leaders
    const lRes = await client.query(
      `SELECT l.*, u.full_name, u.email
       FROM coding_leaderboard l
       JOIN users u ON u.id = l.student_id
       WHERE l.contest_id = $1
       ORDER BY l.total_score DESC, l.problems_solved DESC, l.penalty_time ASC, l.last_score_update ASC
       LIMIT 3`,
      [contestId]
    );
    let topLeaders = lRes.rows;

    if (topLeaders.length === 0) {
      const subRes = await client.query(
        `SELECT sub.student_id,
                COALESCE(u.full_name, u.email, 'Student #' || sub.student_id) as full_name,
                u.email,
                SUM(best.max_prob_score)::integer as total_score,
                COUNT(CASE WHEN best.has_accepted THEN 1 END)::integer as problems_solved,
                0 as penalty_time
         FROM (
           SELECT DISTINCT student_id FROM coding_submissions WHERE contest_id = $1
         ) sub
         JOIN users u ON u.id = sub.student_id
         JOIN (
           SELECT contest_id, problem_id, student_id,
                  MAX(score) as max_prob_score,
                  BOOL_OR(status = 'accepted') as has_accepted
           FROM coding_submissions
           WHERE contest_id = $1
           GROUP BY contest_id, problem_id, student_id
         ) best ON best.student_id = sub.student_id AND best.contest_id = $1
         GROUP BY sub.student_id, u.full_name, u.email
         ORDER BY total_score DESC, problems_solved DESC
         LIMIT 3`,
        [contestId]
      );
      topLeaders = subRes.rows;
    }

    // 3. Award Season Leaderboard Points (Idempotent)
    const pointTable = [100, 75, 60];
    for (let i = 0; i < topLeaders.length; i++) {
      const student = topLeaders[i];
      await client.query(
        `UPDATE coding_participants
         SET status = 'completed'
         WHERE contest_id = $1 AND student_id = $2`,
        [contestId, student.student_id]
      );
    }

    // 4. Select active template for contest
    let templateId = contest.certificate_template_id;
    if (!templateId) {
      templateId = await ensureDefaultTemplate(adminId);
    }

    const tObj = await getTemplateById(templateId);
    const templateVersion = tObj ? tObj.active_version : null;
    const configSnapshot = templateVersion ? templateVersion.configuration : DEFAULT_TEMPLATE_CONFIG;

    // 5. Generate Certificate Eligibility for Top 3
    const generatedCerts = [];
    const posTexts = ['1st Position', '2nd Position', '3rd Position'];

    for (let i = 0; i < topLeaders.length; i++) {
      const leader = topLeaders[i];
      const rank = i + 1;

      // Check unresolved integrity flags
      const flagRes = await client.query(
        `SELECT COUNT(*) as flag_count
         FROM coding_integrity_events
         WHERE contest_id = $1 AND student_id = $2
           AND event_type IN ('paste_attempt', 'bulk_insert', 'disqualified')`,
        [contestId, leader.student_id]
      );
      const hasFlags = parseInt(flagRes.rows[0].flag_count || 0, 10) > 0;

      // Also check similarity flags
      const simRes = await client.query(
        `SELECT COUNT(*) as sim_count
         FROM coding_similarity_results
         WHERE contest_id = $1 AND (student_a = $2 OR student_b = $2) AND status = 'flagged' AND similarity_score >= 75.00`,
        [contestId, leader.student_id]
      );
      const hasHighSim = parseInt(simRes.rows[0].sim_count || 0, 10) > 0;

      const certStatus = (hasFlags || hasHighSim) ? 'pending_review' : 'pending_approval';

      // Generate preliminary non-guessable token & number
      const certNum = `CO-CODE-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const vToken = crypto.randomBytes(16).toString('hex');

      const existingCert = await client.query(
        'SELECT * FROM coding_certificates WHERE contest_id = $1 AND student_id = $2 LIMIT 1',
        [contestId, leader.student_id]
      );

      let certRes;
      if (existingCert.rows.length > 0) {
        certRes = await client.query(
          `UPDATE coding_certificates
           SET rank = $1, position_text = $2, template_id = $3, template_version_id = $4, configuration_snapshot = $5, status = $6
           WHERE contest_id = $7 AND student_id = $8
           RETURNING *`,
          [
            rank,
            posTexts[i],
            templateId,
            templateVersion ? templateVersion.id : null,
            JSON.stringify(configSnapshot),
            certStatus,
            contestId,
            leader.student_id
          ]
        );
      } else {
        certRes = await client.query(
          `INSERT INTO coding_certificates 
           (contest_id, student_id, rank, position_text, certificate_number, verification_token, template_id, template_version_id, configuration_snapshot, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            contestId,
            leader.student_id,
            rank,
            posTexts[i],
            certNum,
            vToken,
            templateId,
            templateVersion ? templateVersion.id : null,
            JSON.stringify(configSnapshot),
            certStatus
          ]
        );
      }

      generatedCerts.push(certRes.rows[0]);
    }

    // 6. Update contest status to 'finalized'
    await client.query(
      `UPDATE coding_contests
       SET status = 'finalized', finalized_at = NOW(), finalized_by = $1
       WHERE id = $2`,
      [adminId, contestId]
    );

    await client.query('COMMIT');
    return {
      success: true,
      contestId,
      certificatesCount: generatedCerts.length,
      certificates: generatedCerts
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null);
    console.error('[CertificateService] finalizeContest error:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Approve Certificate
 */
async function approveCertificate(certificateId, adminId) {
  const { rows } = await pool.query(
    `UPDATE coding_certificates
     SET status = 'approved', approved_by = $1, approved_at = NOW(), issued_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [adminId, certificateId]
  );
  if (rows.length === 0) throw new Error('Certificate not found');
  return rows[0];
}

/**
 * Revoke Certificate
 */
async function revokeCertificate(certificateId, adminId, reason) {
  const { rows } = await pool.query(
    `UPDATE coding_certificates
     SET status = 'revoked', revoked_by = $1, revoked_at = NOW(), revoke_reason = $2
     WHERE id = $3
     RETURNING *`,
    [adminId, reason || 'Administrative decision', certificateId]
  );
  if (rows.length === 0) throw new Error('Certificate not found');
  return rows[0];
}

/**
 * Reissue Certificate
 */
async function reissueCertificate(certificateId, adminId, newPositionText = null) {
  const { rows } = await pool.query(
    `UPDATE coding_certificates
     SET status = 'approved',
         approved_by = $1,
         approved_at = NOW(),
         issued_at = NOW(),
         position_text = COALESCE($2, position_text),
         revoked_at = NULL,
         revoked_by = NULL,
         revoke_reason = NULL
     WHERE id = $3
     RETURNING *`,
    [adminId, newPositionText, certificateId]
  );
  if (rows.length === 0) throw new Error('Certificate not found');
  return rows[0];
}

/**
 * Public Verification Service
 */
async function getPublicVerification(verificationToken) {
  const { rows } = await pool.query(
    `SELECT c.id, c.rank, c.position_text, c.certificate_number, c.verification_token, c.status, c.issued_at, c.revoked_at, c.revoke_reason, c.configuration_snapshot,
            u.full_name as student_name,
            ct.title as contest_name, ct.start_time as contest_date
     FROM coding_certificates c
     JOIN users u ON u.id = c.student_id
     JOIN coding_contests ct ON ct.id = c.contest_id
     WHERE c.verification_token = $1`,
    [verificationToken]
  );

  if (rows.length === 0) return null;
  const cert = rows[0];
  const config = cert.configuration_snapshot || DEFAULT_TEMPLATE_CONFIG;

  return {
    verified: cert.status === 'approved',
    status: cert.status === 'approved' ? 'VERIFIED' : cert.status === 'revoked' ? 'REVOKED' : 'PENDING',
    student_name: cert.student_name,
    contest_name: cert.contest_name,
    position: cert.position_text || `${cert.rank} Position`,
    rank: cert.rank,
    contest_date: cert.contest_date ? new Date(cert.contest_date).toLocaleDateString() : '',
    issue_date: cert.issued_at ? new Date(cert.issued_at).toLocaleDateString() : '',
    certificate_number: cert.certificate_number,
    organization_name: config.organization_name || 'College OS',
    partner_name: config.partner_name || '',
    partner_label: config.partner_label || 'Powered by',
    sponsor_name: config.sponsor_name || '',
    sponsor_label: config.sponsor_label || 'Sponsored by',
    association_name: config.association_name || '',
    association_label: config.association_label || 'In Association With',
    tech_partner_name: config.tech_partner_name || '',
    tech_partner_label: config.tech_partner_label || 'Technology Partner',
    revoked_reason: cert.status === 'revoked' ? cert.revoke_reason : undefined,
    verified_at: new Date().toISOString()
  };
}

/**
 * Overall Season Leaderboard Service
 */
async function getOverallSeasonLeaderboard() {
  const query = `
    SELECT 
      u.id as student_id,
      u.full_name,
      u.email,
      COALESCE(SUM(CASE WHEN c.rank = 1 THEN 100 WHEN c.rank = 2 THEN 75 WHEN c.rank = 3 THEN 60 ELSE 0 END), 0) as total_points,
      COUNT(DISTINCT cp.contest_id) as contests_participated,
      COUNT(DISTINCT CASE WHEN c.rank = 1 THEN c.contest_id END) as wins,
      COUNT(DISTINCT CASE WHEN c.rank IN (1, 2, 3) THEN c.contest_id END) as top3_finishes,
      COALESCE(SUM(l.problems_solved), 0) as problems_solved
    FROM users u
    JOIN coding_participants cp ON cp.student_id = u.id
    LEFT JOIN coding_leaderboard l ON l.contest_id = cp.contest_id AND l.student_id = u.id
    LEFT JOIN coding_certificates c ON c.contest_id = cp.contest_id AND c.student_id = u.id AND c.status = 'approved'
    WHERE u.role = 'student' OR u.role IS NULL
    GROUP BY u.id, u.full_name, u.email
    ORDER BY total_points DESC, wins DESC, top3_finishes DESC, problems_solved DESC
    LIMIT 100
  `;
  const { rows } = await pool.query(query);

  return rows.map((row, idx) => ({
    overall_rank: idx + 1,
    student_id: row.student_id,
    student_name: row.full_name,
    total_points: parseInt(row.total_points || 0, 10),
    contests_participated: parseInt(row.contests_participated || 0, 10),
    wins: parseInt(row.wins || 0, 10),
    top3_finishes: parseInt(row.top3_finishes || 0, 10),
    problems_solved: parseInt(row.problems_solved || 0, 10)
  }));
}

/**
 * Certificate PDF Generator
 */
async function generateCertificatePDF(certData) {
  // Landscape A4 (297mm x 210mm)
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  const config = certData.configuration_snapshot || certData.configuration || DEFAULT_TEMPLATE_CONFIG;
  const isSample = Boolean(certData.is_sample);

  // Rank Theme Accents
  let accentColor = '#D4AF37'; // Gold
  let rankLabel = '1st Position';
  if (certData.rank === 2) {
    accentColor = '#A0A0A0'; // Silver
    rankLabel = '2nd Position';
  } else if (certData.rank === 3) {
    accentColor = '#CD7F32'; // Bronze
    rankLabel = '3rd Position';
  }

  // Draw Background Border
  doc.setLineWidth(2);
  doc.setDrawColor(212, 175, 55);
  doc.rect(10, 10, width - 20, height - 20);

  doc.setLineWidth(0.5);
  doc.rect(13, 13, width - 26, height - 26);

  // Header Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(30, 41, 59);
  doc.text(config.title || 'CERTIFICATE OF ACHIEVEMENT', width / 2, 35, { align: 'center' });

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(100, 116, 139);
  doc.text(config.subtitle || 'This is proudly presented to', width / 2, 48, { align: 'center' });

  // Student Name
  const studentName = certData.student_name || 'Abhay Shukla';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(15, 23, 42);
  doc.text(studentName, width / 2, 65, { align: 'center' });

  // Underline under name
  doc.setLineWidth(0.5);
  doc.setDrawColor(212, 175, 55);
  doc.line(width / 2 - 40, 68, width / 2 + 40, 68);

  // Achievement Body
  const contestName = certData.contest_name || 'Weekly Coding Challenge';
  const posText = certData.position_text || rankLabel;
  const contestDate = certData.contest_date || new Date().toLocaleDateString();

  let bodyText = config.body || 'for securing {{position}} Position in {{contest_name}} held on {{contest_date}}.';
  bodyText = renderPlaceholders(bodyText, {
    student_name: studentName,
    position: posText,
    rank: certData.rank || 1,
    contest_name: contestName,
    contest_date: contestDate,
    issue_date: certData.issue_date || new Date().toLocaleDateString(),
    certificate_id: certData.certificate_number || 'SAMPLE-CO-CODE-0001',
    organization_name: config.organization_name || 'College OS',
    partner_name: config.partner_name || '',
    sponsor_name: config.sponsor_name || '',
    association_name: config.association_name || '',
    tech_partner_name: config.tech_partner_name || '',
    powered_by_name: config.partner_name || '',
    organizer_name: config.organizer_name || 'College OS'
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(51, 65, 85);
  doc.text(bodyText, width / 2, 85, { align: 'center', maxWidth: 220 });

  // Branding Blocks (Partner, Sponsor, Association, Tech Partner)
  let currY = 110;
  const brandingParts = [];
  if (config.partner_name) brandingParts.push(`${config.partner_label || 'Powered by'}: ${config.partner_name}`);
  if (config.sponsor_name) brandingParts.push(`${config.sponsor_label || 'Sponsored by'}: ${config.sponsor_name}`);
  if (config.association_name) brandingParts.push(`${config.association_label || 'In Association With'}: ${config.association_name}`);
  if (config.tech_partner_name) brandingParts.push(`${config.tech_partner_label || 'Technology Partner'}: ${config.tech_partner_name}`);

  if (brandingParts.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text(brandingParts.join('  |  '), width / 2, currY, { align: 'center', maxWidth: 240 });
    currY += 12;
  }

  // QR Code Verification
  const token = certData.verification_token || 'PREVIEW_TOKEN';
  const verifyUrl = `${process.env.APP_URL || 'http://localhost:3000'}/certificate/verify/${token}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 100 });
    doc.addImage(qrDataUrl, 'PNG', width / 2 - 15, currY, 30, 30);
  } catch (qrErr) {
    doc.setFontSize(9);
    doc.text(`Verification Token: ${token}`, width / 2, currY + 15, { align: 'center' });
  }

  // Footer & Certificate ID
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  const certNum = certData.certificate_number || 'SAMPLE-CO-CODE-0001';
  doc.text(`Certificate ID: ${certNum}`, 20, height - 20);
  doc.text(`Issued: ${certData.issue_date || new Date().toLocaleDateString()}`, 20, height - 15);
  doc.text(config.footer || 'College OS Verified Academic Credential', width - 20, height - 20, { align: 'right' });

  // Sample / Status Watermark
  if (isSample || certData.status === 'pending_review' || certData.status === 'pending_approval') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(55);
    doc.setTextColor(220, 220, 220);
    const watermarkText = isSample ? 'SAMPLE / PREVIEW' : certData.status === 'pending_review' ? 'PENDING INTEGRITY REVIEW' : 'PENDING APPROVAL';
    doc.text(watermarkText, width / 2, height / 2, {
      align: 'center',
      angle: 25
    });
  }

  return Buffer.from(doc.output('arraybuffer'));
}

/**
 * Generate Admin Certificate Preview (Renders PDF buffer & placeholder metadata for live preview)
 */
async function generateCertificatePreview({ templateId, contestId, studentName, rank = 1, positionText, customConfig }) {
  let config = customConfig || null;
  if (!config && templateId) {
    const tpl = await getTemplateById(templateId);
    config = tpl?.active_version?.configuration || null;
  }
  if (!config) config = DEFAULT_TEMPLATE_CONFIG;

  let contestName = 'Sample Coding Grand Championship';
  let contestDate = new Date().toLocaleDateString();

  if (contestId) {
    const { rows } = await pool.query('SELECT title, start_time FROM coding_contests WHERE id = $1', [contestId]);
    if (rows.length > 0) {
      contestName = rows[0].title;
      if (rows[0].start_time) contestDate = new Date(rows[0].start_time).toLocaleDateString();
    }
  }

  const sampleName = studentName || 'Abhay Shukla';
  const posText = positionText || (rank === 1 ? '1st Position' : rank === 2 ? '2nd Position' : rank === 3 ? '3rd Position' : `${rank}th Position`);

  const sampleCertData = {
    is_sample: true,
    student_name: sampleName,
    contest_name: contestName,
    contest_date: contestDate,
    position_text: posText,
    rank: Number(rank) || 1,
    certificate_number: 'PREVIEW-CO-CODE-0001',
    verification_token: 'PREVIEW_TOKEN_SAMPLE',
    issue_date: new Date().toLocaleDateString(),
    configuration_snapshot: config
  };

  const pdfBuffer = await generateCertificatePDF(sampleCertData);

  const renderedTitle = renderPlaceholders(config.title || 'CERTIFICATE OF ACHIEVEMENT', sampleCertData);
  const renderedSubtitle = renderPlaceholders(config.subtitle || 'This is proudly presented to', sampleCertData);
  const renderedBody = renderPlaceholders(config.body || 'for securing {{position}} Position in {{contest_name}} held on {{contest_date}}.', sampleCertData);

  return {
    pdfBuffer,
    certData: sampleCertData,
    renderedText: {
      title: renderedTitle,
      subtitle: renderedSubtitle,
      studentName: sampleName,
      body: renderedBody,
      footer: config.footer || 'College OS Verified Academic Credential'
    }
  };
}

module.exports = {
  DEFAULT_TEMPLATE_CONFIG,
  renderPlaceholders,
  sanitizeText,
  ensureDefaultTemplate,
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  finalizeContest,
  approveCertificate,
  revokeCertificate,
  reissueCertificate,
  getPublicVerification,
  getOverallSeasonLeaderboard,
  generateCertificatePDF,
  generateCertificatePreview
};
