const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const {
  DEFAULT_CONTRIBUTION_CONFIG,
  ensureContributionSchema,
  getContributionConfig,
  updateContributionConfig,
  validateAcademicScope,
  isAllowedResourceType,
  recomputeContributorProfile,
  addContributionPointEvent,
  addContributionModerationEvent,
  setContributorTrustState,
  notifyUser,
  toNumber
} = require('../services/academicContributions');

const router = express.Router();

router.use(requireAdmin);
router.use(async (_req, _res, next) => {
  try {
    await ensureContributionSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/config', async (_req, res, next) => {
  try {
    const config = await getContributionConfig();
    res.json({ config: { ...DEFAULT_CONTRIBUTION_CONFIG, ...config } });
  } catch (error) {
    next(error);
  }
});

router.put('/config', async (req, res, next) => {
  try {
    const payload = req.body?.config;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'config object is required' });
    }

    const updated = await updateContributionConfig(payload, req.session.userId);
    res.json({ message: 'Contribution configuration updated successfully', config: updated });
  } catch (error) {
    next(error);
  }
});

function toTrimmed(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toBoundedInt(value, min, max, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return Math.max(min, Math.min(max, rounded));
}

function toFlagsArray(input) {
  if (Array.isArray(input)) {
    return input
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);
  }
  const text = String(input || '').trim();
  if (!text) return [];
  return text
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeIdList(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 500);
  }

  return String(raw || '')
    .split(',')
    .map((part) => Number(String(part).trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
    .slice(0, 500);
}

function buildAiSuggestions(item) {
  const suggestions = [];
  if (Number(item.duplicate_score || 0) >= 78) {
    suggestions.push('possible_duplicate');
  }
  if (Number(item.quality_score || 0) <= 45) {
    suggestions.push('quality_risk');
  }
  if (Number(item.quality_score || 0) >= 85 && Number(item.duplicate_score || 0) <= 20) {
    suggestions.push('high_value_candidate');
  }
  const examType = String(item.exam_type || '').toLowerCase();
  const title = String(item.title || '').toLowerCase();
  if (examType && !title.includes(examType)) {
    suggestions.push('possible_exam_mismatch');
  }
  if (!String(item.subject_name || '').trim()) {
    suggestions.push('missing_subject_metadata');
  }
  return suggestions;
}

function buildPriorityScore(item) {
  let score = 0;
  if (item.status === 'pending') score += 30;
  if (Number(item.duplicate_score || 0) >= 70) score += 25;
  if (Number(item.quality_score || 0) <= 45) score += 20;
  if (item.status === 'needs_correction') score += 10;
  if (Number(item.download_count || 0) >= 25) score += 15;
  if (Number(item.quality_score || 0) >= 85) score += 12;
  if (item.is_featured) score += 8;
  return score;
}

router.get('/moderation', async (req, res, next) => {
  try {
    const status = String(req.query.status || 'pending').toLowerCase();
    const resourceType = String(req.query.resourceType || '').toLowerCase();
    const collegeName = String(req.query.college || '').trim();
    const branchId = toNumber(req.query.branchId);
    const search = String(req.query.search || '').trim();
    const issue = String(req.query.issue || '').trim().toLowerCase();
    const queueType = String(req.query.queueType || '').trim().toLowerCase();
    const onlyFeatured = String(req.query.onlyFeatured || '').toLowerCase() === 'true';
    const onlyHidden = String(req.query.onlyHidden || '').toLowerCase() === 'true';
    const limit = Math.max(20, Math.min(800, toBoundedInt(req.query.limit, 20, 800, 200)));

    const params = [];
    const clauses = [];

    if (status !== 'all') {
      params.push(status);
      clauses.push(`c.status = $${params.length}`);
    }

    if (resourceType) {
      params.push(resourceType);
      clauses.push(`c.resource_type = $${params.length}`);
    }

    if (collegeName) {
      params.push(collegeName);
      clauses.push(`c.college_name = $${params.length}`);
    }

    if (branchId) {
      params.push(branchId);
      clauses.push(`c.branch_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(c.title ILIKE $${params.length} OR c.subject_name ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
    }

    if (onlyFeatured) {
      clauses.push('c.is_featured = TRUE');
    }

    if (onlyHidden) {
      clauses.push('c.is_hidden = TRUE');
    }

    if (issue === 'duplicate') {
      clauses.push('c.duplicate_score >= 70');
    } else if (issue === 'quality_risk') {
      clauses.push('c.quality_score <= 45');
    } else if (issue === 'high_priority') {
      clauses.push(`(c.status = 'pending' AND (c.duplicate_score >= 70 OR c.quality_score <= 45 OR c.is_featured = TRUE))`);
    } else if (issue === 'correction_pending') {
      clauses.push(`c.status = 'needs_correction'`);
    } else if (issue === 'high_value') {
      clauses.push(`(c.quality_score >= 80 OR c.download_count >= 25)`);
    } else if (issue === 'flagged') {
      clauses.push(`(c.duplicate_score >= 70 OR c.quality_score <= 45 OR jsonb_array_length(COALESCE(c.quality_flags, '[]'::jsonb)) > 0)`);
    }

    if (queueType === 'high_priority') {
      clauses.push(`(c.status = 'pending' AND (c.duplicate_score >= 70 OR c.quality_score <= 45 OR c.is_featured = TRUE))`);
    }
    if (queueType === 'duplicate_risk') {
      clauses.push(`c.duplicate_score >= 70`);
    }
    if (queueType === 'low_quality') {
      clauses.push(`c.quality_score <= 45`);
    }
    if (queueType === 'correction_pending') {
      clauses.push(`c.status = 'needs_correction'`);
    }
    if (queueType === 'high_value') {
      clauses.push(`(c.quality_score >= 80 OR c.download_count >= 25)`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         c.id,
         c.user_id,
         c.college_name,
         c.title,
         c.resource_type,
         c.subject_name,
         c.exam_type,
         c.exam_session,
         c.description,
         c.tags_json,
         c.file_url,
         c.preview_image_url,
         c.status,
         c.moderation_reason,
         c.moderation_notes,
         c.quality_score,
         c.duplicate_score,
         c.duplicate_of_id,
         c.quality_flags,
         c.points_awarded,
         c.is_featured,
         c.is_premium,
         c.is_hidden,
         c.download_count,
         c.created_at,
         c.updated_at,
         c.moderated_at,
         ab.name AS branch_name,
         sem.label AS semester_label,
         u.full_name AS uploader_name,
         u.email AS uploader_email,
         u.contributor_level,
         u.contribution_trust_score,
         u.contribution_upload_suspended,
         mod.full_name AS moderated_by_name
       FROM academic_contributions c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users mod ON mod.id = c.moderated_by
       LEFT JOIN academic_branches ab ON ab.id = c.branch_id
       LEFT JOIN academic_semesters sem ON sem.id = c.semester_id
       ${where}
       ORDER BY
         CASE WHEN c.status = 'pending' THEN 0 ELSE 1 END,
         c.duplicate_score DESC,
         c.created_at DESC
       LIMIT $${params.length + 1}`,
      [...params, limit]
    );

    const queue = result.rows.map((item) => ({
      ...item,
      aiSuggestions: buildAiSuggestions(item),
      priorityScore: buildPriorityScore(item)
    }));

    queue.sort((a, b) => Number(b.priorityScore || 0) - Number(a.priorityScore || 0));
    res.json({ queue });
  } catch (error) {
    next(error);
  }
});

router.post('/moderation/bulk-action', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ids = normalizeIdList(req.body.ids);
    const action = String(req.body.action || '').trim().toLowerCase();
    const reason = toTrimmed(req.body.reason);
    const moderationNotes = toTrimmed(req.body.moderationNotes);
    const pointsAwarded = toBoundedInt(req.body.pointsAwarded, 0, 500);

    if (!ids.length) return res.status(400).json({ error: 'At least one contribution id is required' });
    if (!['approve', 'reject', 'needs_correction', 'feature', 'unfeature', 'archive', 'restore'].includes(action)) {
      return res.status(400).json({ error: 'Unsupported bulk action' });
    }

    await client.query('BEGIN');

    const target = await client.query(
      `SELECT id, user_id, status, points_awarded, title
       FROM academic_contributions
       WHERE id = ANY($1::int[])
       FOR UPDATE`,
      [ids]
    );

    if (!target.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No matching contributions found' });
    }

    let updatedRows = [];
    if (action === 'feature' || action === 'unfeature') {
      const flag = action === 'feature';
      const changed = await client.query(
        `UPDATE academic_contributions
         SET is_featured = $1,
             moderated_by = $2,
             moderated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ANY($3::int[])
         RETURNING id, user_id, status, title`,
        [flag, req.session.userId, ids]
      );
      updatedRows = changed.rows;
    } else if (action === 'archive' || action === 'restore') {
      const hideFlag = action === 'archive';
      const changed = await client.query(
        `UPDATE academic_contributions
         SET is_hidden = $1,
             moderated_by = $2,
             moderated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ANY($3::int[])
         RETURNING id, user_id, status, title`,
        [hideFlag, req.session.userId, ids]
      );
      updatedRows = changed.rows;
    } else {
      const nextStatus = action === 'approve' ? 'approved' : (action === 'reject' ? 'rejected' : 'needs_correction');
      const points = action === 'approve' ? (Number.isFinite(pointsAwarded) ? pointsAwarded : 20) : 0;
      const changed = await client.query(
        `UPDATE academic_contributions
         SET status = $1,
             moderation_reason = COALESCE($2, moderation_reason),
             moderation_notes = COALESCE($3, moderation_notes),
             points_awarded = $4,
             moderated_by = $5,
             moderated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ANY($6::int[])
         RETURNING id, user_id, status, title`,
        [nextStatus, reason, moderationNotes, points, req.session.userId, ids]
      );
      updatedRows = changed.rows;
    }

    await client.query('COMMIT');

    await Promise.all(updatedRows.map((row) => addContributionModerationEvent({
      contributionId: row.id,
      userId: row.user_id,
      action: `bulk_${action}`,
      previousStatus: null,
      nextStatus: row.status,
      payload: { reason, moderationNotes, pointsAwarded: pointsAwarded || null, count: updatedRows.length },
      actorAdminId: req.session.userId
    })));

    const contributorIds = [...new Set(updatedRows.map((row) => row.user_id).filter(Boolean))];
    await Promise.all(contributorIds.map((userId) => recomputeContributorProfile(userId)));

    res.json({
      message: `Bulk action '${action}' completed`,
      processed: updatedRows.length,
      contributionIds: updatedRows.map((row) => row.id)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.get('/moderation/:id', async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const detailResult = await pool.query(
      `SELECT
         c.*,
         ab.name AS branch_name,
         sem.label AS semester_label,
         u.full_name AS uploader_name,
         u.email AS uploader_email,
         u.contributor_level,
         u.contribution_trust_score,
         u.contribution_upload_suspended,
         mod.full_name AS moderated_by_name
       FROM academic_contributions c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users mod ON mod.id = c.moderated_by
       LEFT JOIN academic_branches ab ON ab.id = c.branch_id
       LEFT JOIN academic_semesters sem ON sem.id = c.semester_id
       WHERE c.id = $1
       LIMIT 1`,
      [id]
    );

    const contribution = detailResult.rows[0];
    if (!contribution) return res.status(404).json({ error: 'Contribution not found' });

    const duplicateCandidates = await pool.query(
      `SELECT id, title, resource_type, subject_name, exam_type, exam_session, status, duplicate_score, quality_score, created_at
       FROM academic_contributions
       WHERE college_name = $1
         AND id <> $2
         AND (
           file_sha256 = $3
           OR (
             branch_id = $4
             AND semester_id = $5
             AND LOWER(subject_name) = LOWER($6)
             AND resource_type = $7
             AND COALESCE(exam_type, '') = COALESCE($8, '')
             AND COALESCE(exam_session, '') = COALESCE($9, '')
           )
         )
       ORDER BY duplicate_score DESC, created_at DESC
       LIMIT 20`,
      [
        contribution.college_name,
        contribution.id,
        contribution.file_sha256 || null,
        contribution.branch_id,
        contribution.semester_id,
        contribution.subject_name,
        contribution.resource_type,
        contribution.exam_type || null,
        contribution.exam_session || null
      ]
    );

    const history = await pool.query(
      `SELECT e.id, e.action, e.previous_status, e.next_status, e.payload_json, e.created_at,
              a.full_name AS actor_name
       FROM contribution_moderation_events e
       LEFT JOIN users a ON a.id = e.actor_admin_id
       WHERE e.contribution_id = $1
       ORDER BY e.created_at DESC
       LIMIT 100`,
      [id]
    );

    res.json({
      contribution,
      duplicateCandidates: duplicateCandidates.rows,
      moderationHistory: history.rows
    });
  } catch (error) {
    next(error);
  }
});

router.put('/:id/metadata', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const updates = {
      title: toTrimmed(req.body.title),
      resourceType: toTrimmed(req.body.resourceType),
      branchId: toNumber(req.body.branchId),
      semesterId: toNumber(req.body.semesterId),
      subjectId: toNumber(req.body.subjectId),
      subjectName: toTrimmed(req.body.subjectName),
      examType: toTrimmed(req.body.examType),
      examSession: toTrimmed(req.body.examSession),
      moderationNotes: toTrimmed(req.body.moderationNotes),
      moderationReason: toTrimmed(req.body.moderationReason),
      qualityFlags: toFlagsArray(req.body.qualityFlags),
      qualityScore: toBoundedInt(req.body.qualityScore, 0, 100),
      duplicateScore: toBoundedInt(req.body.duplicateScore, 0, 100),
      isFeatured: typeof req.body.isFeatured === 'boolean' ? req.body.isFeatured : null,
      isPremium: typeof req.body.isPremium === 'boolean' ? req.body.isPremium : null,
      isHidden: typeof req.body.isHidden === 'boolean' ? req.body.isHidden : null
    };

    if (updates.resourceType && !isAllowedResourceType(updates.resourceType)) {
      return res.status(400).json({ error: 'Invalid resourceType' });
    }

    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id, user_id, status, branch_id, semester_id, subject_id, subject_name
       FROM academic_contributions
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (!existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contribution not found' });
    }

    if (updates.branchId || updates.semesterId || updates.subjectId || updates.subjectName) {
      const current = existing.rows[0];
      const scope = await validateAcademicScope({
        branchId: updates.branchId || current.branch_id,
        semesterId: updates.semesterId || current.semester_id,
        subjectId: updates.subjectId || current.subject_id,
        subjectName: updates.subjectName || current.subject_name
      });
      if (!scope.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: scope.error });
      }
      updates.branchId = scope.branchId;
      updates.semesterId = scope.semesterId;
      updates.subjectId = scope.subjectId;
      updates.subjectName = scope.subjectName;
    }

    const updated = await client.query(
      `UPDATE academic_contributions
       SET title = COALESCE($1, title),
           resource_type = COALESCE($2, resource_type),
           branch_id = COALESCE($3, branch_id),
           semester_id = COALESCE($4, semester_id),
           subject_id = COALESCE($5, subject_id),
           subject_name = COALESCE($6, subject_name),
           exam_type = COALESCE($7, exam_type),
           exam_session = COALESCE($8, exam_session),
           moderation_notes = COALESCE($9, moderation_notes),
           moderation_reason = COALESCE($10, moderation_reason),
           quality_flags = CASE WHEN $11::jsonb = '[]'::jsonb THEN quality_flags ELSE $11::jsonb END,
           quality_score = COALESCE($12, quality_score),
           duplicate_score = COALESCE($13, duplicate_score),
           is_featured = COALESCE($14, is_featured),
           is_premium = COALESCE($15, is_premium),
           is_hidden = COALESCE($16, is_hidden),
           moderated_by = $17,
           moderated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $18
       RETURNING id, title, resource_type, branch_id, semester_id, subject_name, status, quality_score, duplicate_score, is_featured, is_premium, is_hidden, moderation_notes`,
      [
        updates.title,
        updates.resourceType,
        updates.branchId,
        updates.semesterId,
        updates.subjectId,
        updates.subjectName,
        updates.examType,
        updates.examSession,
        updates.moderationNotes,
        updates.moderationReason,
        JSON.stringify(updates.qualityFlags || []),
        updates.qualityScore,
        updates.duplicateScore,
        updates.isFeatured,
        updates.isPremium,
        updates.isHidden,
        req.session.userId,
        id
      ]
    );

    await client.query('COMMIT');

    await addContributionModerationEvent({
      contributionId: id,
      userId: existing.rows[0].user_id,
      action: 'metadata_update',
      previousStatus: existing.rows[0].status,
      nextStatus: existing.rows[0].status,
      payload: {
        updatedBy: req.session.userId,
        title: updates.title,
        resourceType: updates.resourceType,
        branchId: updates.branchId,
        semesterId: updates.semesterId,
        subjectId: updates.subjectId,
        subjectName: updates.subjectName,
        examType: updates.examType,
        examSession: updates.examSession,
        qualityFlags: updates.qualityFlags,
        qualityScore: updates.qualityScore,
        duplicateScore: updates.duplicateScore,
        isFeatured: updates.isFeatured,
        isPremium: updates.isPremium,
        isHidden: updates.isHidden
      },
      actorAdminId: req.session.userId
    });

    res.json({ message: 'Contribution metadata updated', contribution: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.post('/:id/moderate', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = toNumber(req.params.id);
    const action = String(req.body.action || '').trim().toLowerCase();
    const reason = String(req.body.reason || '').trim() || null;
    const moderationNotes = String(req.body.moderationNotes || '').trim() || null;
    const pointsAwardedInput = Number(req.body.pointsAwarded);
    const usefulnessScoreInput = Number(req.body.usefulnessScore);
    const qualityScoreInput = Number(req.body.qualityScore);
    const isFeatured = typeof req.body.isFeatured === 'boolean' ? req.body.isFeatured : null;
    const isPremium = typeof req.body.isPremium === 'boolean' ? req.body.isPremium : null;
    const hide = typeof req.body.hide === 'boolean' ? req.body.hide : null;
    const qualityFlags = toFlagsArray(req.body.qualityFlags);

    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });
    if (![
      'approve',
      'reject',
      'needs_correction',
      'request_correction',
      'hide',
      'unhide',
      'feature',
      'unfeature',
      'mark_premium',
      'unmark_premium'
    ].includes(action)) {
      return res.status(400).json({ error: 'Invalid moderation action' });
    }

    await client.query('BEGIN');

    const rowRes = await client.query(
      `SELECT id, user_id, title, status, points_awarded, quality_score, duplicate_score, is_featured, is_premium, is_hidden
       FROM academic_contributions
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    const row = rowRes.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Contribution not found' });
    }

    const config = await getContributionConfig();
    const rewards = config.rewards || DEFAULT_CONTRIBUTION_CONFIG.rewards;

    if (action === 'hide' || action === 'unhide' || action === 'feature' || action === 'unfeature' || action === 'mark_premium' || action === 'unmark_premium') {
      const hideFlag = action === 'hide' ? true : false;
      const featureFlag = action === 'feature' ? true : (action === 'unfeature' ? false : null);
      const premiumFlag = action === 'mark_premium' ? true : (action === 'unmark_premium' ? false : null);

      await client.query(
        `UPDATE academic_contributions
         SET is_hidden = COALESCE($1, is_hidden),
             is_featured = COALESCE($2, is_featured),
             is_premium = COALESCE($3, is_premium),
             updated_at = CURRENT_TIMESTAMP,
             moderated_by = $4,
             moderated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [
          action === 'hide' || action === 'unhide' ? hideFlag : null,
          featureFlag,
          premiumFlag,
          req.session.userId,
          id
        ]
      );
      await client.query('COMMIT');

      await addContributionModerationEvent({
        contributionId: id,
        userId: row.user_id,
        action,
        previousStatus: row.status,
        nextStatus: row.status,
        payload: {
          isHidden: action === 'hide' ? true : (action === 'unhide' ? false : row.is_hidden),
          isFeatured: featureFlag,
          isPremium: premiumFlag
        },
        actorAdminId: req.session.userId
      });

      return res.json({ message: `Contribution ${action.replace('_', ' ')} action completed` });
    }

    let nextStatus = 'pending';
    if (action === 'approve') nextStatus = 'approved';
    if (action === 'reject') nextStatus = 'rejected';
    if (action === 'needs_correction' || action === 'request_correction') nextStatus = 'needs_correction';

    if (nextStatus === 'rejected' && config?.moderation?.requireReasonOnReject && !reason) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Rejection reason is required by moderation policy' });
    }

    let computedPoints = row.points_awarded || 0;

    if (nextStatus === 'approved') {
      if (Number.isFinite(pointsAwardedInput)) {
        computedPoints = Math.max(0, Math.min(500, Math.round(pointsAwardedInput)));
      } else {
        computedPoints = Number(rewards.baseApprovalPoints || 20);
        if (Number(row.quality_score || 0) >= 80) {
          computedPoints += Number(rewards.qualityBonusPoints || 10);
        }
      }

      if (isFeatured === true) {
        computedPoints += Number(rewards.featuredBonusPoints || 20);
      }
    } else {
      computedPoints = 0;
    }

    const qualityScore = Number.isFinite(qualityScoreInput)
      ? Math.max(0, Math.min(100, Math.round(qualityScoreInput)))
      : row.quality_score;

    const usefulnessScore = Number.isFinite(usefulnessScoreInput)
      ? Math.max(0, Math.min(100, Math.round(usefulnessScoreInput)))
      : 0;

    await client.query(
      `UPDATE academic_contributions
       SET status = $1,
           moderation_reason = $2,
           moderation_notes = COALESCE($3, moderation_notes),
           quality_flags = CASE WHEN $4::jsonb = '[]'::jsonb THEN quality_flags ELSE $4::jsonb END,
           points_awarded = $5,
           quality_score = $6,
           usefulness_score = $7,
           is_featured = COALESCE($8, is_featured),
           is_premium = COALESCE($9, is_premium),
           is_hidden = COALESCE($10, is_hidden),
           moderated_by = $11,
           moderated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $12`,
      [
        nextStatus,
        reason,
        moderationNotes,
        JSON.stringify(qualityFlags),
        computedPoints,
        qualityScore,
        usefulnessScore,
        isFeatured,
        isPremium,
        hide,
        req.session.userId,
        id
      ]
    );

    const pointDelta = Number(computedPoints || 0) - Number(row.points_awarded || 0);

    await client.query('COMMIT');

    if (pointDelta !== 0) {
      await addContributionPointEvent({
        contributionId: id,
        userId: row.user_id,
        pointsDelta: pointDelta,
        reason: `moderation_${nextStatus}`,
        actorAdminId: req.session.userId
      });
    }

    await addContributionModerationEvent({
      contributionId: id,
      userId: row.user_id,
      action,
      previousStatus: row.status,
      nextStatus,
      payload: {
        reason,
        moderationNotes,
        pointsAwarded: computedPoints,
        pointDelta,
        qualityScore,
        usefulnessScore,
        qualityFlags,
        isFeatured,
        isPremium,
        hide
      },
      actorAdminId: req.session.userId
    });

    await recomputeContributorProfile(row.user_id);

    if (nextStatus === 'approved') {
      await notifyUser(
        row.user_id,
        `Your contribution \"${row.title}\" was approved and earned ${computedPoints} points.`,
        'contribution_approved'
      );
      if (isFeatured === true) {
        await notifyUser(row.user_id, `Your contribution \"${row.title}\" was marked as featured by admin.`, 'contribution_featured');
      }
    } else if (nextStatus === 'rejected') {
      await notifyUser(
        row.user_id,
        reason
          ? `Your contribution \"${row.title}\" was rejected: ${reason}`
          : `Your contribution \"${row.title}\" was rejected by moderation.`,
        'contribution_rejected'
      );
    } else if (nextStatus === 'needs_correction') {
      await notifyUser(
        row.user_id,
        reason
          ? `Your contribution \"${row.title}\" needs correction: ${reason}`
          : `Your contribution \"${row.title}\" needs correction before approval.`,
        'contribution_correction'
      );
    }

    res.json({
      message: `Contribution marked as ${nextStatus}`,
      moderation: {
        id,
        status: nextStatus,
        pointsAwarded: computedPoints,
        qualityScore,
        usefulnessScore,
        qualityFlags,
        isPremium: isPremium === null ? row.is_premium : isPremium
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.post('/contributors/:userId/control', async (req, res, next) => {
  try {
    const userId = toNumber(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Invalid user id' });

    const contributorLevel = toTrimmed(req.body.contributorLevel);
    const trustScore = toBoundedInt(req.body.trustScore, 0, 100);
    const isTrusted = typeof req.body.isTrusted === 'boolean' ? req.body.isTrusted : null;
    const isVerified = typeof req.body.isVerified === 'boolean' ? req.body.isVerified : null;
    const suspendUploads = typeof req.body.suspendUploads === 'boolean' ? req.body.suspendUploads : null;
    const suspensionReason = toTrimmed(req.body.suspensionReason);

    const existing = await pool.query(
      `SELECT id, full_name, contribution_upload_suspended
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: 'Contributor not found' });

    await setContributorTrustState({
      userId,
      contributorLevel,
      trustScore,
      isTrusted,
      isVerified,
      uploadSuspended: suspendUploads,
      suspensionReason
    });

    await addContributionModerationEvent({
      contributionId: null,
      userId,
      action: 'contributor_control',
      previousStatus: null,
      nextStatus: null,
      payload: {
        contributorLevel,
        trustScore,
        isTrusted,
        isVerified,
        suspendUploads,
        suspensionReason
      },
      actorAdminId: req.session.userId
    });

    if (suspendUploads === true) {
      await notifyUser(
        userId,
        suspensionReason
          ? `Your contribution upload access was suspended: ${suspensionReason}`
          : 'Your contribution upload access was suspended by admin.',
        'contribution_access_suspended'
      );
    }
    if (suspendUploads === false) {
      await notifyUser(userId, 'Your contribution upload access has been restored.', 'contribution_access_restored');
    }
    if (isTrusted === true || isVerified === true) {
      await notifyUser(userId, 'Your contributor trust level was upgraded by admin.', 'contributor_trust_upgraded');
    }

    const updated = await pool.query(
      `SELECT id, full_name, contributor_level, contribution_trust_score, contribution_trusted, contribution_verified,
              contribution_upload_suspended, contribution_upload_suspended_reason
       FROM users
       WHERE id = $1`,
      [userId]
    );

    res.json({ message: 'Contributor trust controls updated', contributor: updated.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/contributors/bulk-control', async (req, res, next) => {
  try {
    const userIds = normalizeIdList(req.body.userIds);
    if (!userIds.length) return res.status(400).json({ error: 'At least one contributor id is required' });

    const payload = {
      contributorLevel: toTrimmed(req.body.contributorLevel),
      trustScore: toBoundedInt(req.body.trustScore, 0, 100),
      isTrusted: typeof req.body.isTrusted === 'boolean' ? req.body.isTrusted : null,
      isVerified: typeof req.body.isVerified === 'boolean' ? req.body.isVerified : null,
      suspendUploads: typeof req.body.suspendUploads === 'boolean' ? req.body.suspendUploads : null,
      suspensionReason: toTrimmed(req.body.suspensionReason)
    };

    await Promise.all(userIds.map((userId) => setContributorTrustState({
      userId,
      contributorLevel: payload.contributorLevel,
      trustScore: payload.trustScore,
      isTrusted: payload.isTrusted,
      isVerified: payload.isVerified,
      uploadSuspended: payload.suspendUploads,
      suspensionReason: payload.suspensionReason
    })));

    await Promise.all(userIds.map((userId) => addContributionModerationEvent({
      contributionId: null,
      userId,
      action: 'bulk_contributor_control',
      payload,
      actorAdminId: req.session.userId
    })));

    res.json({ message: 'Bulk contributor trust update completed', processed: userIds.length });
  } catch (error) {
    next(error);
  }
});

router.post('/contributors/:userId/points-adjust', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const userId = toNumber(req.params.userId);
    const pointsDelta = toBoundedInt(req.body.pointsDelta, -500, 500);
    const reason = toTrimmed(req.body.reason) || 'manual_admin_adjustment';
    if (!userId) return res.status(400).json({ error: 'Invalid user id' });
    if (!Number.isFinite(pointsDelta) || pointsDelta === 0) {
      return res.status(400).json({ error: 'pointsDelta must be a non-zero integer between -500 and 500' });
    }

    await client.query('BEGIN');

    const candidate = await client.query(
      `SELECT id
       FROM academic_contributions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    const contributionId = candidate.rows[0]?.id || null;

    if (contributionId) {
      await client.query(
        `UPDATE academic_contributions
         SET points_awarded = GREATEST(0, points_awarded + $1),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [pointsDelta, contributionId]
      );
    }

    await client.query('COMMIT');

    if (contributionId) {
      await addContributionPointEvent({
        contributionId,
        userId,
        pointsDelta,
        reason,
        actorAdminId: req.session.userId
      });
    }

    await recomputeContributorProfile(userId);
    await addContributionModerationEvent({
      contributionId,
      userId,
      action: 'manual_points_adjust',
      payload: { pointsDelta, reason },
      actorAdminId: req.session.userId
    });

    await notifyUser(userId, `Your contribution points were adjusted by ${pointsDelta} point(s).`, 'contribution_points_adjusted');

    const profile = await pool.query(
      `SELECT id, full_name, contribution_points, contributor_level, contribution_trust_score
       FROM users
       WHERE id = $1`,
      [userId]
    );

    res.json({ message: 'Contributor points adjusted', contributor: profile.rows[0], appliedContributionId: contributionId });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.get('/contributors', async (req, res, next) => {
  try {
    const search = toTrimmed(req.query.search);
    const status = String(req.query.status || '').trim().toLowerCase();

    const params = [];
    const where = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }

    if (status === 'suspended') {
      where.push('u.contribution_upload_suspended = TRUE');
    }
    if (status === 'trusted') {
      where.push('u.contribution_trusted = TRUE');
    }
    if (status === 'verified') {
      where.push('u.contribution_verified = TRUE');
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.college_name,
         u.contribution_points,
         u.contributor_level,
         u.contribution_trust_score,
         u.contribution_trusted,
         u.contribution_verified,
         u.contribution_upload_suspended,
         u.contribution_upload_suspended_reason,
         COUNT(c.id)::int AS total_submissions,
         COUNT(c.id) FILTER (WHERE c.status = 'approved')::int AS approved_submissions,
         COUNT(c.id) FILTER (WHERE c.status = 'rejected')::int AS rejected_submissions,
         COALESCE(SUM(c.download_count), 0)::int AS total_downloads
       FROM users u
       LEFT JOIN academic_contributions c ON c.user_id = u.id
       ${whereClause}
       GROUP BY u.id
       HAVING COUNT(c.id) > 0
       ORDER BY u.contribution_points DESC, approved_submissions DESC
       LIMIT 300`,
      params
    );

    res.json({ contributors: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/contributors/performance', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.college_name,
         u.contributor_level,
         COUNT(c.id)::int AS volume,
         COUNT(c.id) FILTER (WHERE c.status = 'approved')::int AS approved,
         COUNT(c.id) FILTER (WHERE c.status = 'rejected')::int AS rejected,
         ROUND(AVG(c.quality_score)::numeric, 1) AS avg_quality,
         ROUND(AVG(c.duplicate_score)::numeric, 1) AS avg_duplicate,
         COALESCE(SUM(c.download_count), 0)::int AS total_downloads,
         COALESCE(SUM(c.helpful_count), 0)::int AS total_helpful,
         ROUND((COUNT(c.id) FILTER (WHERE c.status = 'approved')::numeric / NULLIF(COUNT(c.id), 0)) * 100, 1) AS approval_rate,
         ROUND((COUNT(c.id) FILTER (WHERE c.status = 'rejected')::numeric / NULLIF(COUNT(c.id), 0)) * 100, 1) AS rejection_rate
       FROM users u
       JOIN academic_contributions c ON c.user_id = u.id
       GROUP BY u.id
       ORDER BY volume DESC, approval_rate DESC
       LIMIT 120`
    );

    const trend = await pool.query(
      `SELECT
         TO_CHAR(c.created_at::date, 'YYYY-MM-DD') AS day,
         ROUND(AVG(c.quality_score)::numeric, 1) AS avg_quality,
         ROUND(AVG(c.duplicate_score)::numeric, 1) AS avg_duplicate,
         COUNT(*)::int AS submissions
       FROM academic_contributions c
       WHERE c.created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY c.created_at::date
       ORDER BY day ASC`
    );

    res.json({ contributors: result.rows, qualityTrend30d: trend.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/archive/intelligence', async (_req, res, next) => {
  try {
    const [duplicates, lowValue, bestVersions] = await Promise.all([
      pool.query(
        `SELECT id, title, subject_name, resource_type, duplicate_score, quality_score, created_at
         FROM academic_contributions
         WHERE status = 'approved' AND duplicate_score >= 78 AND is_hidden = FALSE
         ORDER BY duplicate_score DESC, created_at DESC
         LIMIT 120`
      ),
      pool.query(
        `SELECT id, title, subject_name, resource_type, quality_score, download_count, helpful_count, created_at
         FROM academic_contributions
         WHERE status = 'approved'
           AND is_hidden = FALSE
           AND quality_score <= 45
           AND download_count <= 3
           AND helpful_count <= 1
         ORDER BY quality_score ASC, created_at ASC
         LIMIT 120`
      ),
      pool.query(
        `SELECT DISTINCT ON (college_name, branch_id, semester_id, subject_name, resource_type, COALESCE(exam_type,''), COALESCE(exam_session,''))
           id, title, subject_name, resource_type, exam_type, exam_session, quality_score, download_count, helpful_count
         FROM academic_contributions
         WHERE status = 'approved' AND is_hidden = FALSE
         ORDER BY college_name, branch_id, semester_id, subject_name, resource_type, COALESCE(exam_type,''), COALESCE(exam_session,''),
                  quality_score DESC, helpful_count DESC, download_count DESC, created_at DESC
         LIMIT 300`
      )
    ]);

    res.json({
      archiveSuggestions: {
        duplicateCandidates: duplicates.rows,
        lowValueCandidates: lowValue.rows,
        bestVersionCandidates: bestVersions.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/archive/merge-duplicates', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const sourceIds = normalizeIdList(req.body.sourceIds);
    const targetId = toNumber(req.body.targetId);
    if (!sourceIds.length || !targetId) {
      return res.status(400).json({ error: 'sourceIds and targetId are required' });
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE academic_contributions
       SET duplicate_of_id = $1,
           is_hidden = TRUE,
           moderation_notes = COALESCE(moderation_notes, '') || '\nMerged into #' || $1,
           moderated_by = $2,
           moderated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ANY($3::int[]) AND id <> $1`,
      [targetId, req.session.userId, sourceIds]
    );
    await client.query('COMMIT');

    await Promise.all(sourceIds.filter((id) => id !== targetId).map((id) => addContributionModerationEvent({
      contributionId: id,
      action: 'merge_duplicate_archive',
      payload: { targetId },
      actorAdminId: req.session.userId
    })));

    res.json({ message: 'Duplicate merge applied', mergedInto: targetId, affected: sourceIds.length - 1 });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

router.post('/archive/highlight-best-version', async (req, res, next) => {
  try {
    const id = toNumber(req.body.id);
    if (!id) return res.status(400).json({ error: 'id is required' });

    const updated = await pool.query(
      `UPDATE academic_contributions
       SET is_featured = TRUE,
           moderation_notes = COALESCE(moderation_notes, '') || '\nMarked as best version by archive intelligence',
           moderated_by = $1,
           moderated_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, title, subject_name, is_featured`,
      [req.session.userId, id]
    );

    if (!updated.rows[0]) return res.status(404).json({ error: 'Contribution not found' });

    await addContributionModerationEvent({
      contributionId: id,
      action: 'archive_best_version',
      payload: { autoSuggested: true },
      actorAdminId: req.session.userId
    });

    res.json({ message: 'Best version highlighted', resource: updated.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/rewards/suggest/:id', async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const row = await pool.query(
      `SELECT id, quality_score, usefulness_score, download_count, helpful_count, duplicate_score, is_featured
       FROM academic_contributions
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    const item = row.rows[0];
    if (!item) return res.status(404).json({ error: 'Contribution not found' });

    let suggestedPoints = 10;
    suggestedPoints += Math.round(Number(item.quality_score || 0) / 8);
    suggestedPoints += Math.round(Number(item.usefulness_score || 0) / 10);
    suggestedPoints += Math.min(30, Math.round(Number(item.download_count || 0) / 5));
    suggestedPoints += Math.min(20, Math.round(Number(item.helpful_count || 0) / 3));
    suggestedPoints -= Math.round(Number(item.duplicate_score || 0) / 5);
    if (item.is_featured) suggestedPoints += 15;
    suggestedPoints = Math.max(0, Math.min(120, suggestedPoints));

    const rationale = [];
    if (Number(item.quality_score || 0) >= 80) rationale.push('high_quality');
    if (Number(item.usefulness_score || 0) >= 60) rationale.push('high_usefulness');
    if (Number(item.download_count || 0) >= 25) rationale.push('high_engagement');
    if (Number(item.duplicate_score || 0) >= 70) rationale.push('duplicate_penalty');

    res.json({ suggestion: { contributionId: id, suggestedPoints, rationale } });
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/overview', async (_req, res, next) => {
  try {
    const [totals, typeBreakdown, collegeBreakdown, topContributors, topSubjects, duplicateTrend, qualityTrend, actionBreakdown] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
          COUNT(*) FILTER (WHERE status = 'needs_correction')::int AS needs_correction,
          COUNT(*) FILTER (WHERE is_featured = TRUE)::int AS featured,
          COUNT(*) FILTER (WHERE is_hidden = TRUE)::int AS hidden,
          COUNT(*) FILTER (WHERE is_premium = TRUE)::int AS premium,
          COUNT(*) FILTER (WHERE duplicate_score >= 70)::int AS duplicate_risk,
          COUNT(*) FILTER (WHERE quality_score <= 45)::int AS quality_risk,
          COALESCE(SUM(points_awarded), 0)::int AS points_awarded,
          COALESCE(SUM(download_count), 0)::int AS total_downloads
         FROM academic_contributions`
      ),
      pool.query(
        `SELECT resource_type, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
         FROM academic_contributions
         GROUP BY resource_type
         ORDER BY total DESC`
      ),
      pool.query(
        `SELECT college_name,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
         FROM academic_contributions
         GROUP BY college_name
         ORDER BY total DESC
         LIMIT 20`
      ),
      pool.query(
        `SELECT
           u.id,
           u.full_name,
           u.college_name,
           u.contribution_points,
           u.contributor_level,
           COUNT(c.id)::int AS total_uploads,
           COUNT(c.id) FILTER (WHERE c.status = 'approved')::int AS approved_uploads,
           COALESCE(SUM(c.download_count), 0)::int AS total_downloads
         FROM users u
         JOIN academic_contributions c ON c.user_id = u.id
         GROUP BY u.id
         ORDER BY u.contribution_points DESC, approved_uploads DESC
         LIMIT 15`
      ),
      pool.query(
        `SELECT subject_name,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
         FROM academic_contributions
         GROUP BY subject_name
         ORDER BY total DESC
         LIMIT 15`
      ),
      pool.query(
        `SELECT
           TO_CHAR(created_at::date, 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE duplicate_score >= 70)::int AS duplicate_risk,
           COUNT(*)::int AS total
         FROM academic_contributions
         WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY created_at::date
         ORDER BY day ASC`
      ),
      pool.query(
        `SELECT
           TO_CHAR(created_at::date, 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE quality_score <= 45)::int AS quality_issues,
           COUNT(*)::int AS total
         FROM academic_contributions
         WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY created_at::date
         ORDER BY day ASC`
      ),
      pool.query(
        `SELECT action, COUNT(*)::int AS total
         FROM contribution_moderation_events
         WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY action
         ORDER BY total DESC`
      )
    ]);

    res.json({
      totals: totals.rows[0] || {},
      byResourceType: typeBreakdown.rows,
      byCollege: collegeBreakdown.rows,
      topContributors: topContributors.rows,
      mostUploadedSubjects: topSubjects.rows,
      duplicateTrend30d: duplicateTrend.rows,
      qualityIssueTrend30d: qualityTrend.rows,
      moderationActions30d: actionBreakdown.rows
    });
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/advanced', async (_req, res, next) => {
  try {
    const [subjectDemand, examUsage, topUseful, lowQualityPatterns] = await Promise.all([
      pool.query(
        `SELECT subject_name,
                COUNT(*)::int AS uploads,
                COALESCE(SUM(download_count), 0)::int AS downloads,
                COALESCE(SUM(helpful_count), 0)::int AS helpful
         FROM academic_contributions
         GROUP BY subject_name
         ORDER BY downloads DESC, helpful DESC
         LIMIT 20`
      ),
      pool.query(
        `SELECT COALESCE(exam_type, 'general') AS exam_type,
                COUNT(*)::int AS total,
                COALESCE(SUM(download_count), 0)::int AS downloads,
                ROUND(AVG(quality_score)::numeric, 1) AS avg_quality
         FROM academic_contributions
         GROUP BY COALESCE(exam_type, 'general')
         ORDER BY downloads DESC, total DESC`
      ),
      pool.query(
        `SELECT id, title, subject_name, resource_type, quality_score, usefulness_score, download_count, helpful_count
         FROM academic_contributions
         WHERE status = 'approved' AND is_hidden = FALSE
         ORDER BY (usefulness_score + quality_score + download_count + helpful_count * 2) DESC
         LIMIT 30`
      ),
      pool.query(
        `SELECT resource_type,
                COUNT(*) FILTER (WHERE quality_score <= 45)::int AS low_quality,
                COUNT(*)::int AS total,
                ROUND((COUNT(*) FILTER (WHERE quality_score <= 45)::numeric / NULLIF(COUNT(*), 0)) * 100, 1) AS low_quality_rate
         FROM academic_contributions
         GROUP BY resource_type
         ORDER BY low_quality_rate DESC NULLS LAST`
      )
    ]);

    res.json({
      subjectDemandTrends: subjectDemand.rows,
      examWiseUsage: examUsage.rows,
      topUsefulResources: topUseful.rows,
      lowQualityUploadPatterns: lowQualityPatterns.rows
    });
  } catch (error) {
    next(error);
  }
});

router.get('/audit/logs', async (req, res, next) => {
  try {
    const limit = Math.max(20, Math.min(500, toBoundedInt(req.query.limit, 20, 500, 120)));
    const logs = await pool.query(
      `SELECT
         e.id,
         e.contribution_id,
         e.user_id,
         e.action,
         e.previous_status,
         e.next_status,
         e.payload_json,
         e.created_at,
         actor.full_name AS actor_name,
         contributor.full_name AS contributor_name
       FROM contribution_moderation_events e
       LEFT JOIN users actor ON actor.id = e.actor_admin_id
       LEFT JOIN users contributor ON contributor.id = e.user_id
       ORDER BY e.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ logs: logs.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/moderation/:id/rollback', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    await client.query('BEGIN');

    const last = await client.query(
      `SELECT id, previous_status, next_status, payload_json
       FROM contribution_moderation_events
       WHERE contribution_id = $1
         AND previous_status IS NOT NULL
         AND next_status IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [id]
    );

    const event = last.rows[0];
    if (!event) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No rollback event found for this contribution' });
    }

    const restored = await client.query(
      `UPDATE academic_contributions
       SET status = $1,
           updated_at = CURRENT_TIMESTAMP,
           moderated_at = CURRENT_TIMESTAMP,
           moderated_by = $2
       WHERE id = $3
       RETURNING id, status`,
      [event.previous_status, req.session.userId, id]
    );

    await client.query('COMMIT');

    await addContributionModerationEvent({
      contributionId: id,
      action: 'rollback_moderation',
      previousStatus: event.next_status,
      nextStatus: event.previous_status,
      payload: { rolledBackEventId: event.id },
      actorAdminId: req.session.userId
    });

    res.json({ message: 'Contribution moderation rolled back', contribution: restored.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
