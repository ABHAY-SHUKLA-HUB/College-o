const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { getStudentEntitlements, ensureMembershipSchema } = require('../services/entitlementResolver');
const { createSignedSupabaseUrl } = require('../services/supabaseStorage');
const { readFeatureMatrix, resolveEffectiveFeatureState } = require('../middleware/featureToggle');

const router = express.Router();

function toInt(val) {
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

// GET /api/academics/content/:type/:id/file & /view - Secured student academic file delivery
router.get(['/academics/content/:type/:id/file', '/academics/content/:type/:id/view'], requireAuth, async (req, res) => {
  const type = String(req.params.type || '').trim().toLowerCase();
  const contentId = toInt(req.params.id);

  if (!contentId || !['notes', 'materials', 'papers', 'previous_papers'].includes(type)) {
    return res.status(400).json({ error: 'Invalid content type or ID' });
  }

  try {
    await ensureMembershipSchema();

    // 1. Check Student Account Status (Part 5)
    const userRes = await pool.query(
      "SELECT is_suspended, is_blocked FROM users WHERE id = $1",
      [req.session.userId]
    );
    const user = userRes.rows[0];
    if (!user || user.is_suspended || user.is_blocked) {
      return res.status(403).json({
        error: 'ACCOUNT_SUSPENDED',
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended or blocked. Access to academic resources is denied.'
      });
    }

    // 2. Check Part 4 Global Feature Controls
    let featureKey = 'notes_library';
    if (type === 'materials') featureKey = 'study_materials';
    if (type === 'papers' || type === 'previous_papers') featureKey = 'previous_papers';

    const featureMatrix = await readFeatureMatrix();
    const featureConfig = featureMatrix[featureKey] || featureMatrix[featureKey + '_library'];
    if (featureConfig) {
      const effective = resolveEffectiveFeatureState(featureConfig, req.session);
      if (!effective.accessibleForCurrentStudent) {
        return res.status(403).json({
          error: 'FEATURE_DISABLED',
          code: 'FEATURE_DISABLED',
          message: effective.maintenanceMessage || `The ${featureKey.replace('_', ' ')} feature is currently disabled.`
        });
      }
    }

    // 3. Query Database Record & Verify Lifecycle Status (status = 'published')
    let query = '';
    if (type === 'notes') {
      query = "SELECT id, subject, chapter, pdf_url AS file_url, access_type, status, scope_type, university_id, course_id, batch_id FROM notes WHERE id = $1 AND deleted_at IS NULL";
    } else if (type === 'materials') {
      query = "SELECT id, title AS subject, description, file_url, access_type, status, scope_type, university_id, course_id, batch_id FROM materials WHERE id = $1 AND deleted_at IS NULL";
    } else if (type === 'papers' || type === 'previous_papers') {
      query = "SELECT id, subject, exam_name, paper_url AS file_url, access_type, status, scope_type, university_id, course_id, batch_id FROM previous_papers WHERE id = $1 AND deleted_at IS NULL";
    }

    const { rows } = await pool.query(query, [contentId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Content not found' });
    }

    const item = rows[0];

    // Enforce Draft & Archived Isolation for non-admin students
    const userRole = String(req.session.role || '').toLowerCase();
    const isAdmin = userRole === 'admin' || userRole === 'super_admin';
    if (item.status !== 'published' && !isAdmin) {
      return res.status(404).json({ error: 'Content not found or not published' });
    }

    // 4. Check Part 6 Membership Entitlements
    if (item.access_type === 'membership_required' && !isAdmin) {
      const entitlementData = await getStudentEntitlements(req.session.userId);
      const isEntitled = Boolean(entitlementData.membership?.hasActiveMembership);
      if (!isEntitled) {
        return res.status(403).json({
          error: 'MEMBERSHIP_REQUIRED',
          code: 'MEMBERSHIP_REQUIRED',
          message: 'Premium membership is required to access this academic material.'
        });
      }
    }

    // 4.5. Check Academic Scope Eligibility (Part 3 strict isolation)
    if (!isAdmin) {
      const { resolveStudentAcademicScope, canStudentAccessResource } = require('../utils/academic-scope');
      const studentScope = await resolveStudentAcademicScope(req.session.userId);
      if (!studentScope || !studentScope.profileComplete) {
        return res.status(403).json({
          error: 'ACADEMIC_PROFILE_REQUIRED',
          code: 'ACADEMIC_PROFILE_REQUIRED',
          message: 'Mandatory academic onboarding setup is required before downloading files.'
        });
      }

      const canAccess = canStudentAccessResource(studentScope, item);
      if (!canAccess) {
        return res.status(403).json({
          error: 'ACADEMIC_INELIGIBLE',
          code: 'ACADEMIC_INELIGIBLE',
          message: 'This file is not authorized for your academic scope.'
        });
      }
    }

    // 5. Deliver File / Signed URL
    const fileUrl = String(item.file_url || '').trim();
    if (!fileUrl) {
      return res.status(404).json({ error: 'FILE_UNAVAILABLE', message: 'No file attachment associated with this item.' });
    }

    // If file is an internal uploaded_files reference: /api/files/123
    const fileMatch = fileUrl.match(/\/api\/files\/(\d+)/);
    if (fileMatch) {
      const uploadedFileId = parseInt(fileMatch[1], 10);
      const fileRes = await pool.query(
        "SELECT bucket, storage_path FROM uploaded_files WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
        [uploadedFileId]
      );
      if (fileRes.rows.length > 0) {
        const fileObj = fileRes.rows[0];
        const signedUrl = await createSignedSupabaseUrl({
          bucket: fileObj.bucket,
          path: fileObj.storage_path,
          expiresIn: 15 * 60
        });
        return res.redirect(302, signedUrl);
      }
    }

    // If full HTTP/Supabase URL, return or redirect securely
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      return res.redirect(302, fileUrl);
    }

    return res.status(404).json({ error: 'FILE_UNAVAILABLE', message: 'File reference could not be resolved.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deliver academic file', details: err.message });
  }
});

module.exports = router;
