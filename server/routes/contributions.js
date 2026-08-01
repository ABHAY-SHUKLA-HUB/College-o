const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');
const { subscribeRealtime, publishRealtimeEvent } = require('../services/realtimeBus');
const {
  RESOURCE_TYPES,
  EXAM_TYPES,
  DEFAULT_CONTRIBUTION_CONFIG,
  ensureContributionSchema,
  getContributionConfig,
  getUserCollegeContext,
  validateAcademicScope,
  detectDuplicateSignals,
  computeFileHash,
  computeQualityScore,
  addContributionModerationEvent,
  notifyUser,
  toSafeTags,
  normalizeExamSession,
  normalizeTitle,
  isAllowedResourceType,
  isQuestionPaperType,
  toNumber
} = require('../services/academicContributions');

const router = express.Router();

const SUBJECT_ALIASES = {
  dbms: ['database', 'database management system', 'dbms'],
  os: ['operating system', 'operating systems', 'os'],
  cn: ['computer networks', 'networking', 'cn'],
  oop: ['object oriented programming', 'oops', 'oop'],
  dsa: ['data structures', 'algorithms', 'dsa'],
  coa: ['computer organization', 'architecture', 'coa']
};

const EXAM_ALIASES = {
  mst1: ['mst 1', 'mst1', 'mid sem 1', 'mid-term 1', 'midterm 1'],
  mst2: ['mst 2', 'mst2', 'mid sem 2', 'mid-term 2', 'midterm 2'],
  final: ['final', 'end sem', 'end semester', 'semester exam'],
  pyq: ['pyq', 'previous year', 'previous year question', 'past paper']
};

const allowedAcademicMime = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp'
];

const upload = createUploadMiddleware({
  maxFileSize: 12 * 1024 * 1024,
  allowedMimeTypes: allowedAcademicMime,
  allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
  invalidTypeMessage: 'Only PDF, JPG, PNG, or WEBP files are allowed'
});

router.use(async (_req, _res, next) => {
  try {
    await ensureContributionSchema();
    next();
  } catch (error) {
    next(error);
  }
});

function getSortClause(sortBy) {
  const normalized = String(sortBy || 'latest').toLowerCase();
  if (normalized === 'most_downloaded') return 'c.download_count DESC, c.created_at DESC';
  if (normalized === 'most_useful') return 'c.usefulness_score DESC, c.download_count DESC, c.created_at DESC';
  if (normalized === 'trending') return '(c.download_count + c.helpful_count * 2 + c.save_count) DESC, c.last_downloaded_at DESC NULLS LAST, c.created_at DESC';
  return 'c.created_at DESC';
}

function expandSubjectTerms(subjectInput) {
  const raw = String(subjectInput || '').trim().toLowerCase();
  if (!raw) return [];

  const output = new Set([raw]);
  Object.entries(SUBJECT_ALIASES).forEach(([key, values]) => {
    if (raw.includes(key) || values.some((v) => raw.includes(v) || v.includes(raw))) {
      values.forEach((value) => output.add(value));
    }
  });
  return Array.from(output).slice(0, 12);
}

function normalizeForFuzzy(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a, b) {
  const left = normalizeForFuzzy(a);
  const right = normalizeForFuzzy(b);
  if (!left) return right.length;
  if (!right) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
}

function fuzzyScore(text, query) {
  const a = normalizeForFuzzy(text);
  const b = normalizeForFuzzy(query);
  if (!a || !b) return 0;
  if (a.includes(b)) return 1;
  const distance = levenshteinDistance(a.slice(0, Math.max(12, b.length + 6)), b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length, 1));
}

function inferExamType(searchInput) {
  const raw = String(searchInput || '').trim().toLowerCase();
  if (!raw) return null;
  for (const [examType, aliases] of Object.entries(EXAM_ALIASES)) {
    if (aliases.some((item) => raw.includes(item))) return examType;
  }
  return null;
}

function computeResourceBadges(resource) {
  const badges = [];
  if (resource.is_featured) badges.push('admin_recommended');
  if (resource.quality_score >= 85) badges.push('high_quality');
  if (Number(resource.download_count || 0) >= 50) badges.push('most_downloaded');
  if (['mst1_paper', 'mst2_paper', 'final_exam_paper', 'pyq'].includes(String(resource.resource_type || ''))) {
    badges.push('exam_focused');
  }
  if (String(resource.contributor_level || '').toLowerCase().includes('verified')) {
    badges.push('verified');
  }
  if (resource.contribution_subject_expert) badges.push('subject_expert');
  if (resource.contribution_admin_certified) badges.push('admin_certified');
  if (Number(resource.contribution_trust_score || 0) >= 80) badges.push('trusted');
  return badges;
}

async function getSubjectAliasesFromDb(searchTerm = '') {
  const term = String(searchTerm || '').trim().toLowerCase();
  const params = [];
  let where = '';
  if (term) {
    params.push(`%${term}%`);
    where = `WHERE LOWER(alias_term) LIKE $1 OR LOWER(canonical_subject) LIKE $1`;
  }

  const result = await pool.query(
    `SELECT alias_term, canonical_subject, weight
     FROM academic_subject_aliases
     ${where}
     ORDER BY weight DESC, alias_term ASC
     LIMIT 30`,
    params
  );
  return result.rows;
}

router.get('/live/stream', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const collegeContext = await getUserCollegeContext(userId);

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
    if (payload.userId && Number(payload.userId) !== Number(userId)) return;
    if (payload.collegeName && collegeContext?.collegeName && payload.collegeName !== collegeContext.collegeName) return;

    if (![
      'contribution_download_updated',
      'contribution_leaderboard_updated',
      'contribution_popularity_updated',
      'notification_created',
      'notification_updated',
      'student_updated',
      'membership_updated',
      'certificate_updated',
      'support_updated',
      'live_session_updated'
    ].includes(evt.type)) {
      return;
    }

    res.write(`event: ${evt.type}\\n`);
    res.write(`data: ${JSON.stringify(payload)}\\n\\n`);
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

router.get('/search/suggestions', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const collegeContext = await getUserCollegeContext(userId);
    if (!collegeContext) {
      return res.status(400).json({ error: 'Your account must be linked to a college to use smart search.' });
    }

    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q) return res.json({ suggestions: [], correctedQuery: null });

    const aliases = await getSubjectAliasesFromDb(q);

    const [subjectRows, titleRows] = await Promise.all([
      pool.query(
        `SELECT DISTINCT subject_name
         FROM academic_contributions
         WHERE college_name = $1
           AND status = 'approved'
           AND subject_name ILIKE $2
         ORDER BY subject_name ASC
         LIMIT 10`,
        [collegeContext.collegeName, `%${q}%`]
      ),
      pool.query(
        `SELECT DISTINCT title
         FROM academic_contributions
         WHERE college_name = $1
           AND status = 'approved'
           AND title ILIKE $2
         ORDER BY title ASC
         LIMIT 10`,
        [collegeContext.collegeName, `%${q}%`]
      )
    ]);

    const canonicalCandidates = [
      ...new Set([
        ...aliases.map((a) => a.canonical_subject),
        ...subjectRows.rows.map((s) => s.subject_name)
      ])
    ];

    let correctedQuery = null;
    let minDistance = Number.MAX_SAFE_INTEGER;
    canonicalCandidates.forEach((candidate) => {
      const d = levenshteinDistance(candidate, q);
      if (d < minDistance) {
        minDistance = d;
        correctedQuery = candidate;
      }
    });
    if (minDistance > 4) correctedQuery = null;

    const suggestions = [
      ...aliases.map((a) => ({ type: 'alias', value: a.alias_term, canonical: a.canonical_subject })),
      ...subjectRows.rows.map((s) => ({ type: 'subject', value: s.subject_name })),
      ...titleRows.rows.map((t) => ({ type: 'title', value: t.title }))
    ]
      .slice(0, 15);

    res.json({ suggestions, correctedQuery });
  } catch (error) {
    next(error);
  }
});

router.get('/config', requireAuth, async (_req, res, next) => {
  try {
    const config = await getContributionConfig();
    res.json({ config: { ...DEFAULT_CONTRIBUTION_CONFIG, ...config } });
  } catch (error) {
    next(error);
  }
});

router.get('/options', requireAuth, async (_req, res, next) => {
  try {
    const config = await getContributionConfig();
    res.json({
      resourceTypes: RESOURCE_TYPES,
      examTypes: EXAM_TYPES,
      config
    });
  } catch (error) {
    next(error);
  }
});

router.get('/guidance', requireAuth, async (_req, res) => {
  res.json({
    tips: [
      'Use clear, readable scans with proper lighting and no blur.',
      'Choose the correct branch, semester, subject, and exam type.',
      'Use descriptive titles with session/year where relevant.',
      'Upload complete files instead of partial screenshots.',
      'Add 2-5 meaningful tags for easier discovery.',
      'Avoid duplicate uploads when similar resources already exist.'
    ],
    checklist: {
      readable: true,
      correctSubject: true,
      completePages: true,
      properTagging: true
    }
  });
});

router.post(
  '/submit',
  requireAuth,
  upload.fields([
    { name: 'resourceFile', maxCount: 1 },
    { name: 'previewImage', maxCount: 1 }
  ]),
  async (req, res, next) => {
    try {
      const userId = req.session.userId;
      const config = await getContributionConfig();

      if (!config.enabled) {
        return res.status(403).json({ error: 'Academic contributions are currently disabled by admin.' });
      }

      const collegeContext = await getUserCollegeContext(userId);
      if (!collegeContext) {
        return res.status(400).json({ error: 'Your account must be linked to a college to submit contributions.' });
      }

      const userState = await pool.query(
        `SELECT contribution_upload_suspended, contribution_upload_suspended_reason
         FROM users
         WHERE id = $1`,
        [userId]
      );
      if (userState.rows[0]?.contribution_upload_suspended) {
        return res.status(403).json({
          error: userState.rows[0]?.contribution_upload_suspended_reason
            ? `Your contribution access is suspended: ${userState.rows[0].contribution_upload_suspended_reason}`
            : 'Your contribution access is currently suspended by admin.'
        });
      }

      const title = String(req.body.title || '').trim();
      const resourceType = String(req.body.resourceType || '').trim().toLowerCase();
      const description = String(req.body.description || '').trim();
      const examType = String(req.body.examType || '').trim().toLowerCase() || null;
      const examSession = normalizeExamSession(req.body.examSession);
      const subjectNameInput = String(req.body.subject || req.body.subjectName || '').trim();
      const tags = toSafeTags(req.body.tags);

      const branchId = toNumber(req.body.branchId);
      const semesterId = toNumber(req.body.semesterId);
      const categoryId = toNumber(req.body.categoryId);
      const subjectId = toNumber(req.body.subjectId);

      if (!title || title.length < 5) {
        return res.status(400).json({ error: 'title is required with at least 5 characters' });
      }
      if (!isAllowedResourceType(resourceType)) {
        return res.status(400).json({ error: 'Invalid resourceType' });
      }
      if (!config.allowByType?.[resourceType]) {
        return res.status(403).json({ error: 'This resource category is currently disabled by admin.' });
      }
      const resourceFile = req.files?.resourceFile?.[0] || null;
      const previewImage = req.files?.previewImage?.[0] || null;

      if (!resourceFile) {
        return res.status(400).json({ error: 'resourceFile is required' });
      }
      if (description && description.length > Number(config.limits?.maxDescriptionChars || 1200)) {
        return res.status(400).json({ error: 'description exceeds maximum length' });
      }
      if (tags.length > Number(config.limits?.maxTags || 10)) {
        return res.status(400).json({ error: 'Too many tags' });
      }

      if (isQuestionPaperType(resourceType)) {
        if (!examType || !EXAM_TYPES.includes(examType)) {
          return res.status(400).json({ error: 'examType is required for question paper uploads' });
        }
        if (!examSession) {
          return res.status(400).json({ error: 'examSession is required for question paper uploads' });
        }
      }

      const scopeCheck = await validateAcademicScope({
        branchId,
        semesterId,
        subjectId,
        subjectName: subjectNameInput
      });

      if (!scopeCheck.ok) {
        return res.status(400).json({ error: scopeCheck.error });
      }

      const maxResourceBytes = Number(config.limits?.maxFileSizeMb || 12) * 1024 * 1024;
      if (resourceFile.size > maxResourceBytes) {
        return res.status(400).json({ error: 'resourceFile exceeds file size limit' });
      }

      if (resourceFile.mimetype.startsWith('image/') && !/handwritten|notes|lab|assignment|other/.test(resourceType)) {
        return res.status(400).json({ error: 'Image uploads are only allowed for note-style academic resources.' });
      }

      if (previewImage && !previewImage.mimetype.startsWith('image/')) {
        return res.status(400).json({ error: 'previewImage must be an image file.' });
      }

      const maxPreviewBytes = Number(config.limits?.maxPreviewSizeMb || 4) * 1024 * 1024;
      if (previewImage && previewImage.size > maxPreviewBytes) {
        return res.status(400).json({ error: 'previewImage exceeds file size limit' });
      }

      let previewImageUrl = null;
      if (req.body.previewImageUrl) {
        previewImageUrl = String(req.body.previewImageUrl);
      }

      if (previewImage) {
        const previewStored = await saveUploadedFile({
          file: previewImage,
          folder: 'academic-contributions/previews',
          prefix: 'preview'
        });
        previewImageUrl = previewStored?.url || null;
      }

      const stored = await saveUploadedFile({
        file: resourceFile,
        folder: 'academic-contributions/files',
        prefix: 'resource'
      });

      const fileHash = computeFileHash(resourceFile);
      const titleNormalized = normalizeTitle(title);

      const duplicate = await detectDuplicateSignals({
        collegeName: collegeContext.collegeName,
        fileHash,
        branchId: scopeCheck.branchId,
        semesterId: scopeCheck.semesterId,
        subjectName: scopeCheck.subjectName,
        resourceType,
        examType,
        examSession,
        titleNormalized
      });

      const qualityScore = computeQualityScore({
        title,
        description,
        tags,
        subjectName: scopeCheck.subjectName,
        fileSizeBytes: resourceFile.size,
        previewImageUrl
      });

      const inserted = await pool.query(
        `INSERT INTO academic_contributions (
          user_id, college_id, college_name, title, title_normalized, resource_type,
          category_id, branch_id, semester_id, subject_id, subject_name,
          exam_type, exam_session, description, tags_json,
          file_url, preview_image_url, file_name, file_mime, file_size_bytes, file_sha256,
          status, quality_score, duplicate_score, duplicate_of_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15::jsonb,
          $16, $17, $18, $19, $20, $21,
          'pending', $22, $23, $24
        )
        RETURNING id, title, resource_type, status, created_at, duplicate_score, quality_score`,
        [
          userId,
          collegeContext.collegeId,
          collegeContext.collegeName,
          title,
          titleNormalized,
          resourceType,
          categoryId,
          scopeCheck.branchId,
          scopeCheck.semesterId,
          scopeCheck.subjectId,
          scopeCheck.subjectName,
          examType,
          examSession,
          description || null,
          JSON.stringify(tags),
          stored?.url,
          previewImageUrl,
          resourceFile.originalname || null,
          resourceFile.mimetype || null,
          resourceFile.size || 0,
          fileHash,
          qualityScore,
          duplicate.duplicateScore,
          duplicate.duplicateOfId
        ]
      );

      res.status(201).json({
        message: 'Contribution submitted for moderation',
        submission: inserted.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const status = String(req.query.status || '').trim().toLowerCase();
    const params = [userId];
    let where = 'WHERE c.user_id = $1';

    if (status) {
      params.push(status);
      where += ` AND c.status = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT
         c.id,
         c.title,
         c.resource_type,
         c.subject_name,
         c.exam_type,
         c.exam_session,
         c.status,
         c.moderation_reason,
         c.moderation_notes,
         c.points_awarded,
         c.quality_score,
         c.duplicate_score,
         c.current_version,
         c.updated_at,
         c.download_count,
         c.created_at,
         c.file_url,
         c.preview_image_url,
         ab.name AS branch_name,
         sem.label AS semester_label
       FROM academic_contributions c
       LEFT JOIN academic_branches ab ON ab.id = c.branch_id
       LEFT JOIN academic_semesters sem ON sem.id = c.semester_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT 300`,
      params
    );

    res.json({ submissions: result.rows });
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;

    const [totals, userRow] = await Promise.all([
      pool.query(
        `SELECT
          COUNT(*)::int AS total_uploads,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_uploads,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_uploads,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_uploads,
          COUNT(*) FILTER (WHERE status = 'needs_correction')::int AS needs_correction_uploads,
          COALESCE(SUM(points_awarded), 0)::int AS total_points
         FROM academic_contributions
         WHERE user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT contribution_points, contributor_level
         FROM users
         WHERE id = $1`,
        [userId]
      )
    ]);

    const stats = totals.rows[0] || {};
    const profile = userRow.rows[0] || {};

    res.json({
      stats: {
        totalUploads: stats.total_uploads || 0,
        pendingUploads: stats.pending_uploads || 0,
        approvedUploads: stats.approved_uploads || 0,
        rejectedUploads: stats.rejected_uploads || 0,
        needsCorrectionUploads: stats.needs_correction_uploads || 0,
        totalPoints: profile.contribution_points ?? stats.total_points ?? 0,
        contributorLevel: profile.contributor_level || 'New Contributor'
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/library', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const collegeContext = await getUserCollegeContext(userId);
    if (!collegeContext) {
      return res.status(400).json({ error: 'Your account must be linked to a college to view this library.' });
    }

    const branchId = toNumber(req.query.branchId);
    const semesterId = toNumber(req.query.semesterId);
    const resourceType = String(req.query.resourceType || '').trim().toLowerCase();
    const examType = String(req.query.examType || '').trim().toLowerCase();
    const subject = String(req.query.subject || '').trim();
    const search = String(req.query.search || '').trim();
    const sortBy = String(req.query.sortBy || 'latest');
    const subjectTerms = expandSubjectTerms(subject || search);
    const inferredExamType = inferExamType(search);

    const params = [collegeContext.collegeName];
    const clauses = [
      "c.status = 'approved'",
      'c.is_hidden = FALSE',
      'c.college_name = $1'
    ];

    if (branchId) {
      params.push(branchId);
      clauses.push(`c.branch_id = $${params.length}`);
    }

    if (semesterId) {
      params.push(semesterId);
      clauses.push(`c.semester_id = $${params.length}`);
    }

    if (resourceType) {
      params.push(resourceType);
      clauses.push(`c.resource_type = $${params.length}`);
    }

    if (examType || inferredExamType) {
      const effectiveExamType = examType || inferredExamType;
      params.push(effectiveExamType);
      clauses.push(`COALESCE(c.exam_type, '') = COALESCE($${params.length}, '')`);
    }

    if (subjectTerms.length) {
      const startIndex = params.length + 1;
      subjectTerms.forEach((term) => params.push(`%${term}%`));
      const parts = subjectTerms.map((_, idx) => `c.subject_name ILIKE $${startIndex + idx}`);
      clauses.push(`(${parts.join(' OR ')})`);
    }

    let tsQueryParamIndex = null;
    let likeParamIndex = null;
    if (search) {
      params.push(search);
      tsQueryParamIndex = params.length;
      params.push(`%${search}%`);
      likeParamIndex = params.length;
      clauses.push(`(
        to_tsvector('simple', COALESCE(c.title, '') || ' ' || COALESCE(c.subject_name, '') || ' ' || COALESCE(c.description, '')) @@ websearch_to_tsquery('simple', $${tsQueryParamIndex})
        OR c.title ILIKE $${likeParamIndex}
        OR c.subject_name ILIKE $${likeParamIndex}
        OR c.description ILIKE $${likeParamIndex}
      )`);
    }

    const searchRankSelect = search
      ? `ts_rank(
           to_tsvector('simple', COALESCE(c.title, '') || ' ' || COALESCE(c.subject_name, '') || ' ' || COALESCE(c.description, '')),
           websearch_to_tsquery('simple', $${tsQueryParamIndex})
         ) AS search_rank,`
      : '0::float AS search_rank,';

    const orderClause = search
      ? 'search_rank DESC, (c.download_count + c.helpful_count * 2 + c.save_count) DESC, c.created_at DESC'
      : getSortClause(sortBy);

    const result = await pool.query(
      `SELECT
         c.id,
         c.title,
         c.resource_type,
         c.subject_name,
         c.exam_type,
         c.exam_session,
         c.description,
         c.tags_json,
         c.file_url,
         c.preview_image_url,
         c.download_count,
         c.usefulness_score,
         c.points_awarded,
         c.is_premium,
         c.is_featured,
         c.save_count,
         c.helpful_count,
         c.not_helpful_count,
         c.current_version,
         ${searchRankSelect}
         c.created_at,
         ab.name AS branch_name,
         sem.label AS semester_label,
         u.full_name AS contributor_name,
         u.contributor_level,
         u.contribution_trust_score,
         u.contribution_subject_expert,
         u.contribution_admin_certified,
         fb.is_helpful AS my_helpful_vote,
         fb.is_saved AS saved_by_me
       FROM academic_contributions c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN academic_contribution_feedback fb ON fb.contribution_id = c.id AND fb.user_id = $${params.length + 1}
       LEFT JOIN academic_branches ab ON ab.id = c.branch_id
       LEFT JOIN academic_semesters sem ON sem.id = c.semester_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY ${orderClause}
       LIMIT 500`,
      [...params, userId]
    );

    const resources = result.rows
      .map((row) => {
        const composite = `${row.title || ''} ${row.subject_name || ''} ${row.description || ''}`;
        const fuzzy = search ? fuzzyScore(composite, search) : 0;
        return {
          ...row,
          fuzzy_score: fuzzy,
          badges: computeResourceBadges(row)
        };
      })
      .filter((row) => {
        if (!search) return true;
        return Number(row.search_rank || 0) > 0 || Number(row.fuzzy_score || 0) >= 0.34;
      })
      .sort((a, b) => {
        if (!search) return 0;
        const aScore = Number(a.search_rank || 0) + Number(a.fuzzy_score || 0);
        const bScore = Number(b.search_rank || 0) + Number(b.fuzzy_score || 0);
        return bScore - aScore;
      })
      .slice(0, 300);

    res.json({ resources });
  } catch (error) {
    next(error);
  }
});

router.get('/search/instant', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ results: [] });

    const collegeContext = await getUserCollegeContext(userId);
    if (!collegeContext) {
      return res.status(400).json({ error: 'Your account must be linked to a college to use instant search.' });
    }

    const result = await pool.query(
      `SELECT
         c.id,
         c.title,
         c.subject_name,
         c.resource_type,
         c.download_count,
         c.helpful_count,
         c.file_url,
         c.preview_image_url,
         ts_rank(
           to_tsvector('simple', COALESCE(c.title, '') || ' ' || COALESCE(c.subject_name, '') || ' ' || COALESCE(c.description, '')),
           websearch_to_tsquery('simple', $2)
         ) AS rank,
         u.full_name AS contributor_name,
         u.contributor_level,
         u.contribution_subject_expert,
         u.contribution_admin_certified
       FROM academic_contributions c
       JOIN users u ON u.id = c.user_id
       WHERE c.college_name = $1
         AND c.status = 'approved'
         AND c.is_hidden = FALSE
         AND (
           to_tsvector('simple', COALESCE(c.title, '') || ' ' || COALESCE(c.subject_name, '') || ' ' || COALESCE(c.description, '')) @@ websearch_to_tsquery('simple', $2)
           OR c.title ILIKE $3
           OR c.subject_name ILIKE $3
         )
       ORDER BY rank DESC, c.download_count DESC, c.created_at DESC
       LIMIT 12`,
      [collegeContext.collegeName, q, `%${q}%`]
    );

    res.json({
      results: result.rows.map((row) => ({
        ...row,
        badges: computeResourceBadges(row)
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get('/resource/:id', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const userId = req.session.userId;
    const collegeContext = await getUserCollegeContext(userId);
    if (!collegeContext) {
      return res.status(400).json({ error: 'Your account must be linked to a college to access this resource.' });
    }

    const result = await pool.query(
      `SELECT
         c.*,
         ab.name AS branch_name,
         sem.label AS semester_label,
         u.full_name AS contributor_name,
         u.contributor_level,
         fb.is_helpful AS my_helpful_vote,
         fb.is_saved AS saved_by_me
       FROM academic_contributions c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN academic_contribution_feedback fb ON fb.contribution_id = c.id AND fb.user_id = $1
       LEFT JOIN academic_branches ab ON ab.id = c.branch_id
       LEFT JOIN academic_semesters sem ON sem.id = c.semester_id
       WHERE c.id = $2
         AND c.college_name = $3
         AND (c.status = 'approved' OR c.user_id = $1)
       LIMIT 1`,
      [userId, id, collegeContext.collegeName]
    );

    const resource = result.rows[0];
    if (!resource) return res.status(404).json({ error: 'Resource not found' });

    const [versions, moderation] = await Promise.all([
      pool.query(
        `SELECT version_number, file_url, preview_image_url, file_name, file_mime, file_size_bytes, change_notes, created_at
         FROM academic_contribution_versions
         WHERE contribution_id = $1
         ORDER BY version_number DESC
         LIMIT 20`,
        [id]
      ),
      pool.query(
        `SELECT action, payload_json, created_at
         FROM contribution_moderation_events
         WHERE contribution_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [id]
      )
    ]);

    res.json({
      resource: {
        ...resource,
        badges: computeResourceBadges(resource)
      },
      versions: versions.rows,
      moderationTrail: moderation.rows
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/preview', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const userId = req.session.userId;
    const collegeContext = await getUserCollegeContext(userId);
    if (!collegeContext) {
      return res.status(400).json({ error: 'Your account must be linked to a college to access preview.' });
    }

    const resource = await pool.query(
      `SELECT id, title, file_url, file_mime, subject_name, resource_type
       FROM academic_contributions
       WHERE id = $1
         AND college_name = $2
         AND status = 'approved'
         AND is_hidden = FALSE
       LIMIT 1`,
      [id, collegeContext.collegeName]
    );

    if (!resource.rows[0]) return res.status(404).json({ error: 'Resource not found' });

    res.json({
      resource: resource.rows[0],
      preview: {
        mode: String(resource.rows[0].file_mime || '').includes('pdf') ? 'pdf' : 'basic',
        zoomMin: 0.6,
        zoomMax: 2.4,
        defaultZoom: 1
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/preview/events', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const userId = req.session.userId;
    const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 50) : [];
    if (!events.length) return res.status(400).json({ error: 'events[] is required' });

    const values = [];
    const placeholders = [];
    events.forEach((evt, idx) => {
      const base = idx * 5;
      values.push(
        id,
        userId,
        Number.isFinite(Number(evt.pageNumber)) ? Number(evt.pageNumber) : null,
        String(evt.sectionKey || '').trim().slice(0, 120) || null,
        Math.max(0, Math.min(600000, Number(evt.viewDurationMs || 0)))
      );
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    });

    await pool.query(
      `INSERT INTO academic_contribution_preview_events
       (contribution_id, user_id, page_number, section_key, view_duration_ms)
       VALUES ${placeholders.join(', ')}`,
      values
    );

    res.status(201).json({ ok: true, accepted: events.length });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/preview/insights', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const [sections, pages] = await Promise.all([
      pool.query(
        `SELECT COALESCE(section_key, CONCAT('page-', COALESCE(page_number, 0))) AS section,
                SUM(view_duration_ms)::int AS total_view_ms,
                COUNT(*)::int AS view_events
         FROM academic_contribution_preview_events
         WHERE contribution_id = $1
         GROUP BY COALESCE(section_key, CONCAT('page-', COALESCE(page_number, 0)))
         ORDER BY total_view_ms DESC
         LIMIT 8`,
        [id]
      ),
      pool.query(
        `SELECT page_number,
                SUM(view_duration_ms)::int AS total_view_ms,
                COUNT(*)::int AS hits
         FROM academic_contribution_preview_events
         WHERE contribution_id = $1 AND page_number IS NOT NULL
         GROUP BY page_number
         ORDER BY total_view_ms DESC
         LIMIT 10`,
        [id]
      )
    ]);

    res.json({
      mostViewedSections: sections.rows,
      pageHeatmap: pages.rows
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/community', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const rows = await pool.query(
      `SELECT
         c.id,
         c.parent_comment_id,
         c.kind,
         c.body,
         c.is_resolved,
         c.upvote_count,
         c.created_at,
         c.user_id,
         u.full_name,
        u.contribution_verified,
         u.contribution_subject_expert
       FROM academic_contribution_resource_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.contribution_id = $1
       ORDER BY c.created_at ASC
       LIMIT 300`,
      [id]
    );

    res.json({ comments: rows.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/community', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const userId = req.session.userId;
    const body = String(req.body.body || '').trim();
    const kind = String(req.body.kind || 'comment').trim().toLowerCase();
    const parentCommentId = toNumber(req.body.parentCommentId);

    if (!body || body.length < 2) return res.status(400).json({ error: 'Comment must be at least 2 characters' });
    if (!['comment', 'question', 'answer'].includes(kind)) {
      return res.status(400).json({ error: 'kind must be comment, question, or answer' });
    }

    const created = await pool.query(
      `INSERT INTO academic_contribution_resource_comments
       (contribution_id, user_id, parent_comment_id, kind, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, contribution_id, user_id, parent_comment_id, kind, body, is_resolved, upvote_count, created_at`,
      [id, userId, parentCommentId || null, kind, body.slice(0, 3000)]
    );

    publishRealtimeEvent('contribution_popularity_updated', {
      contributionId: id,
      metric: 'community_activity',
      delta: 1
    });

    res.status(201).json({ message: 'Community post added', comment: created.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/community/:commentId/upvote', requireAuth, async (req, res, next) => {
  try {
    const commentId = toNumber(req.params.commentId);
    if (!commentId) return res.status(400).json({ error: 'Invalid comment id' });

    const userId = req.session.userId;
    await pool.query(
      `INSERT INTO academic_contribution_comment_votes (comment_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (comment_id, user_id) DO NOTHING`,
      [commentId, userId]
    );

    const update = await pool.query(
      `UPDATE academic_contribution_resource_comments c
       SET upvote_count = (
         SELECT COUNT(*)::int
         FROM academic_contribution_comment_votes v
         WHERE v.comment_id = c.id
       ),
       updated_at = CURRENT_TIMESTAMP
       WHERE c.id = $1
       RETURNING c.id, c.contribution_id, c.upvote_count`,
      [commentId]
    );

    if (!update.rows[0]) return res.status(404).json({ error: 'Comment not found' });

    publishRealtimeEvent('contribution_popularity_updated', {
      contributionId: update.rows[0].contribution_id,
      metric: 'comment_upvotes',
      value: update.rows[0].upvote_count
    });

    res.json({ comment: update.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.post('/community/:commentId/resolve', requireAuth, async (req, res, next) => {
  try {
    const commentId = toNumber(req.params.commentId);
    if (!commentId) return res.status(400).json({ error: 'Invalid comment id' });

    const resolved = await pool.query(
      `UPDATE academic_contribution_resource_comments
       SET is_resolved = TRUE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, contribution_id, is_resolved`,
      [commentId]
    );
    if (!resolved.rows[0]) return res.status(404).json({ error: 'Comment not found' });

    res.json({ comment: resolved.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/ai-insights', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const resource = await pool.query(
      `SELECT id, title, subject_name, description, tags_json
       FROM academic_contributions
       WHERE id = $1
       LIMIT 1`,
      [id]
    );
    if (!resource.rows[0]) return res.status(404).json({ error: 'Resource not found' });

    const commentQuestions = await pool.query(
      `SELECT body
       FROM academic_contribution_resource_comments
       WHERE contribution_id = $1 AND kind IN ('question', 'comment')
       ORDER BY upvote_count DESC, created_at DESC
       LIMIT 8`,
      [id]
    );

    const row = resource.rows[0];
    const description = String(row.description || '').trim();
    const raw = `${row.title || ''}. ${description}`.trim();
    const sentences = raw
      .split(/[.!?]\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const keyPoints = sentences.slice(0, 5);
    const revision = [
      `Focus first on ${row.subject_name || 'the core subject'} fundamentals.`,
      ...keyPoints.slice(0, 3).map((s) => `Revise: ${s}`)
    ];
    const tags = Array.isArray(row.tags_json) ? row.tags_json : [];

    const importantQuestions = [
      ...commentQuestions.rows.map((q) => String(q.body || '').trim()).filter(Boolean),
      ...sentences.filter((s) => /why|how|what|explain|derive|prove/i.test(s)).slice(0, 4)
    ].slice(0, 8);

    res.json({
      summary: raw || row.title,
      keyPoints,
      quickRevisionMode: revision,
      importantQuestions,
      topicSignals: tags
    });
  } catch (error) {
    next(error);
  }
});

router.get('/growth/status', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;

    const [referrals, profile, uploads] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE LOWER(status) = 'successful')::int AS successful_referrals
         FROM referrals
         WHERE referrer_user_id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT contribution_points, contributor_level
         FROM users
         WHERE id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS approved_uploads,
                COALESCE(SUM(download_count), 0)::int AS total_downloads
         FROM academic_contributions
         WHERE user_id = $1 AND status = 'approved'`,
        [userId]
      )
    ]);

    const successfulReferrals = Number(referrals.rows[0]?.successful_referrals || 0);
    const approvedUploads = Number(uploads.rows[0]?.approved_uploads || 0);
    const totalDownloads = Number(uploads.rows[0]?.total_downloads || 0);
    const contributionPoints = Number(profile.rows[0]?.contribution_points || 0);

    const milestones = [
      { key: 'invite_3', title: 'Invite 3 Friends', target: 3, current: successfulReferrals, reward: 50 },
      { key: 'approve_5', title: '5 Approved Contributions', target: 5, current: approvedUploads, reward: 80 },
      { key: 'download_250', title: '250 Total Downloads', target: 250, current: totalDownloads, reward: 120 },
      { key: 'points_500', title: '500 Contribution Points', target: 500, current: contributionPoints, reward: 150 }
    ].map((m) => ({
      ...m,
      completed: m.current >= m.target,
      progressPercent: Math.min(100, Math.round((m.current / m.target) * 100))
    }));

    res.json({
      contributorLevel: profile.rows[0]?.contributor_level || 'New Contributor',
      milestones,
      rewardsSummary: {
        totalRewardsUnlocked: milestones.filter((m) => m.completed).reduce((sum, m) => sum + m.reward, 0),
        nextMilestone: milestones.find((m) => !m.completed) || null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/download-intelligence', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const collegeContext = await getUserCollegeContext(userId);
    if (!collegeContext) {
      return res.status(400).json({ error: 'Your account must be linked to a college to access download intelligence.' });
    }

    const windowDays = Math.max(7, Math.min(120, toNumber(req.query.windowDays, 30)));
    const [daily, subjectTrends, examFocused] = await Promise.all([
      pool.query(
        `SELECT TO_CHAR(e.downloaded_at::date, 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS downloads
         FROM academic_contribution_download_events e
         JOIN academic_contributions c ON c.id = e.contribution_id
         WHERE c.college_name = $1
           AND e.downloaded_at >= CURRENT_DATE - ($2::text || ' days')::interval
         GROUP BY e.downloaded_at::date
         ORDER BY day ASC`,
        [collegeContext.collegeName, windowDays]
      ),
      pool.query(
        `SELECT c.subject_name,
                COUNT(*)::int AS downloads
         FROM academic_contribution_download_events e
         JOIN academic_contributions c ON c.id = e.contribution_id
         WHERE c.college_name = $1
           AND e.downloaded_at >= CURRENT_DATE - ($2::text || ' days')::interval
         GROUP BY c.subject_name
         ORDER BY downloads DESC
         LIMIT 8`,
        [collegeContext.collegeName, windowDays]
      ),
      pool.query(
        `SELECT c.title,
                c.subject_name,
                c.exam_type,
                COUNT(*)::int AS exam_window_downloads
         FROM academic_contribution_download_events e
         JOIN academic_contributions c ON c.id = e.contribution_id
         WHERE c.college_name = $1
           AND e.downloaded_at >= CURRENT_DATE - INTERVAL '14 days'
           AND COALESCE(c.exam_type, '') <> ''
         GROUP BY c.id
         ORDER BY exam_window_downloads DESC
         LIMIT 10`,
        [collegeContext.collegeName]
      )
    ]);

    const series = daily.rows.map((row) => Number(row.downloads || 0));
    const avg = series.length ? series.reduce((sum, n) => sum + n, 0) / series.length : 0;
    const spikes = daily.rows.filter((row) => Number(row.downloads || 0) > avg * 1.8 && Number(row.downloads || 0) >= 12);

    res.json({
      windowDays,
      dailyDownloads: daily.rows,
      examTimeSpikes: spikes,
      subjectPopularityTrends: subjectTrends.rows,
      mostDownloadedBeforeExam: examFocused.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  '/:id/resubmit',
  requireAuth,
  upload.fields([
    { name: 'resourceFile', maxCount: 1 },
    { name: 'previewImage', maxCount: 1 }
  ]),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const id = toNumber(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

      const userId = req.session.userId;
      await client.query('BEGIN');

      const existingRes = await client.query(
        `SELECT *
         FROM academic_contributions
         WHERE id = $1 AND user_id = $2
         FOR UPDATE`,
        [id, userId]
      );

      const current = existingRes.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Contribution not found' });
      }
      if (current.status !== 'needs_correction') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only contributions marked as needs_correction can be resubmitted' });
      }

      await client.query(
        `INSERT INTO academic_contribution_versions (
           contribution_id, version_number, file_url, preview_image_url, file_name, file_mime, file_size_bytes, file_sha256,
           snapshot_json, change_notes, changed_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
         ON CONFLICT (contribution_id, version_number) DO NOTHING`,
        [
          current.id,
          Number(current.current_version || 1),
          current.file_url,
          current.preview_image_url,
          current.file_name,
          current.file_mime,
          current.file_size_bytes,
          current.file_sha256,
          JSON.stringify({
            title: current.title,
            subjectName: current.subject_name,
            examType: current.exam_type,
            examSession: current.exam_session,
            description: current.description,
            tags: current.tags_json
          }),
          String(req.body.changeNotes || '').trim() || 'Student resubmission',
          userId
        ]
      );

      const incomingTitle = String(req.body.title || '').trim() || current.title;
      const incomingResourceType = String(req.body.resourceType || '').trim().toLowerCase() || current.resource_type;
      const incomingDescription = String(req.body.description || '').trim() || current.description;
      const incomingExamType = String(req.body.examType || '').trim().toLowerCase() || current.exam_type;
      const incomingExamSession = normalizeExamSession(req.body.examSession || current.exam_session);
      const incomingSubjectName = String(req.body.subject || req.body.subjectName || '').trim() || current.subject_name;
      const incomingTags = req.body.tags ? toSafeTags(req.body.tags) : (Array.isArray(current.tags_json) ? current.tags_json : []);

      if (!isAllowedResourceType(incomingResourceType)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid resourceType' });
      }

      if (isQuestionPaperType(incomingResourceType)) {
        if (!incomingExamType || !EXAM_TYPES.includes(incomingExamType)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'examType is required for question paper uploads' });
        }
        if (!incomingExamSession) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'examSession is required for question paper uploads' });
        }
      }

      const scopeCheck = await validateAcademicScope({
        branchId: toNumber(req.body.branchId, current.branch_id),
        semesterId: toNumber(req.body.semesterId, current.semester_id),
        subjectId: toNumber(req.body.subjectId, current.subject_id),
        subjectName: incomingSubjectName
      });

      if (!scopeCheck.ok) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: scopeCheck.error });
      }

      const resourceFile = req.files?.resourceFile?.[0] || null;
      const previewImage = req.files?.previewImage?.[0] || null;

      let fileUrl = current.file_url;
      let fileName = current.file_name;
      let fileMime = current.file_mime;
      let fileSizeBytes = current.file_size_bytes;
      let fileHash = current.file_sha256;

      if (resourceFile) {
        const stored = await saveUploadedFile({
          file: resourceFile,
          folder: 'academic-contributions/files',
          prefix: 'resource'
        });
        fileUrl = stored?.url || current.file_url;
        fileName = resourceFile.originalname || current.file_name;
        fileMime = resourceFile.mimetype || current.file_mime;
        fileSizeBytes = resourceFile.size || current.file_size_bytes;
        fileHash = computeFileHash(resourceFile);
      }

      let previewImageUrl = current.preview_image_url;
      if (previewImage) {
        const previewStored = await saveUploadedFile({
          file: previewImage,
          folder: 'academic-contributions/previews',
          prefix: 'preview'
        });
        previewImageUrl = previewStored?.url || current.preview_image_url;
      }

      const duplicate = await detectDuplicateSignals({
        collegeName: current.college_name,
        fileHash,
        branchId: scopeCheck.branchId,
        semesterId: scopeCheck.semesterId,
        subjectName: scopeCheck.subjectName,
        resourceType: incomingResourceType,
        examType: incomingExamType,
        examSession: incomingExamSession,
        titleNormalized: normalizeTitle(incomingTitle)
      });

      const qualityScore = computeQualityScore({
        title: incomingTitle,
        description: incomingDescription,
        tags: incomingTags,
        subjectName: scopeCheck.subjectName,
        fileSizeBytes,
        previewImageUrl
      });

      const updated = await client.query(
        `UPDATE academic_contributions
         SET title = $1,
             title_normalized = $2,
             resource_type = $3,
             branch_id = $4,
             semester_id = $5,
             subject_id = $6,
             subject_name = $7,
             exam_type = $8,
             exam_session = $9,
             description = $10,
             tags_json = $11::jsonb,
             file_url = $12,
             preview_image_url = $13,
             file_name = $14,
             file_mime = $15,
             file_size_bytes = $16,
             file_sha256 = $17,
             status = 'pending',
             moderation_reason = NULL,
             duplicate_score = $18,
             duplicate_of_id = $19,
             quality_score = $20,
             current_version = current_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $21
         RETURNING id, status, current_version, quality_score, duplicate_score`,
        [
          incomingTitle,
          normalizeTitle(incomingTitle),
          incomingResourceType,
          scopeCheck.branchId,
          scopeCheck.semesterId,
          scopeCheck.subjectId,
          scopeCheck.subjectName,
          incomingExamType,
          incomingExamSession,
          incomingDescription,
          JSON.stringify(incomingTags),
          fileUrl,
          previewImageUrl,
          fileName,
          fileMime,
          fileSizeBytes,
          fileHash,
          duplicate.duplicateScore,
          duplicate.duplicateOfId,
          qualityScore,
          id
        ]
      );

      await client.query('COMMIT');

      await addContributionModerationEvent({
        contributionId: id,
        userId,
        action: 'student_resubmission',
        previousStatus: 'needs_correction',
        nextStatus: 'pending',
        payload: {
          changeNotes: String(req.body.changeNotes || '').trim() || null,
          hasNewFile: Boolean(resourceFile),
          hasNewPreview: Boolean(previewImage),
          version: updated.rows[0]?.current_version
        }
      });

      res.json({
        message: 'Contribution resubmitted for moderation',
        submission: updated.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally {
      client.release();
    }
  }
);

router.post('/:id/feedback', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const userId = req.session.userId;
    const collegeContext = await getUserCollegeContext(userId);
    if (!collegeContext) {
      return res.status(400).json({ error: 'Your account must be linked to a college to provide feedback.' });
    }

    const helpful = typeof req.body.helpful === 'boolean' ? req.body.helpful : null;
    const saved = typeof req.body.saved === 'boolean' ? req.body.saved : null;

    const exists = await pool.query(
      `SELECT id
       FROM academic_contributions
       WHERE id = $1 AND college_name = $2 AND status = 'approved'
       LIMIT 1`,
      [id, collegeContext.collegeName]
    );
    if (!exists.rows[0]) return res.status(404).json({ error: 'Resource not found' });

    await pool.query(
      `INSERT INTO academic_contribution_feedback (contribution_id, user_id, is_helpful, is_saved, updated_at)
       VALUES ($1, $2, $3, COALESCE($4, FALSE), CURRENT_TIMESTAMP)
       ON CONFLICT (contribution_id, user_id)
       DO UPDATE SET
         is_helpful = COALESCE(EXCLUDED.is_helpful, academic_contribution_feedback.is_helpful),
         is_saved = COALESCE($4, academic_contribution_feedback.is_saved),
         updated_at = CURRENT_TIMESTAMP`,
      [id, userId, helpful, saved]
    );

    const totals = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE is_saved = TRUE)::int AS save_count,
         COUNT(*) FILTER (WHERE is_helpful = TRUE)::int AS helpful_count,
         COUNT(*) FILTER (WHERE is_helpful = FALSE)::int AS not_helpful_count
       FROM academic_contribution_feedback
       WHERE contribution_id = $1`,
      [id]
    );

    await pool.query(
      `UPDATE academic_contributions
       SET save_count = $2,
           helpful_count = $3,
           not_helpful_count = $4,
           usefulness_score = LEAST(100, GREATEST(0, ($3 * 3 + $2 * 2) - ($4 * 2))),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        id,
        Number(totals.rows[0]?.save_count || 0),
        Number(totals.rows[0]?.helpful_count || 0),
        Number(totals.rows[0]?.not_helpful_count || 0)
      ]
    );

    publishRealtimeEvent('contribution_popularity_updated', {
      contributionId: id,
      metric: 'feedback',
      helpfulCount: Number(totals.rows[0]?.helpful_count || 0),
      saveCount: Number(totals.rows[0]?.save_count || 0),
      notHelpfulCount: Number(totals.rows[0]?.not_helpful_count || 0)
    });

    res.json({ message: 'Feedback updated', stats: totals.rows[0] || {} });
  } catch (error) {
    next(error);
  }
});

router.get('/collections', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const collections = await pool.query(
      `SELECT c.id, c.name, c.description, c.color_hex, c.created_at,
              COUNT(i.id)::int AS item_count
       FROM academic_contribution_collections c
       LEFT JOIN academic_contribution_collection_items i ON i.collection_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC`,
      [userId]
    );
    res.json({ collections: collections.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/collections', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const name = String(req.body.name || '').trim();
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Collection name must be at least 2 characters' });
    }
    const created = await pool.query(
      `INSERT INTO academic_contribution_collections (user_id, name, description, color_hex)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, color_hex, created_at`,
      [
        userId,
        name.slice(0, 120),
        String(req.body.description || '').trim().slice(0, 320) || null,
        String(req.body.color || '#1d4ed8').slice(0, 10)
      ]
    );
    res.status(201).json({ message: 'Collection created', collection: created.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/collections/:id/items', requireAuth, async (req, res, next) => {
  try {
    const collectionId = toNumber(req.params.id);
    if (!collectionId) return res.status(400).json({ error: 'Invalid collection id' });

    const userId = req.session.userId;
    const items = await pool.query(
      `SELECT
         i.id,
         i.notes,
         i.created_at,
         r.id AS resource_id,
         r.title,
         r.resource_type,
         r.subject_name,
         r.file_url,
         r.preview_image_url,
         r.download_count,
         r.save_count,
         r.helpful_count
       FROM academic_contribution_collection_items i
       JOIN academic_contribution_collections c ON c.id = i.collection_id AND c.user_id = $1
       JOIN academic_contributions r ON r.id = i.contribution_id
       WHERE i.collection_id = $2
       ORDER BY i.created_at DESC`,
      [userId, collectionId]
    );
    res.json({ items: items.rows });
  } catch (error) {
    next(error);
  }
});

router.post('/collections/:id/items', requireAuth, async (req, res, next) => {
  try {
    const collectionId = toNumber(req.params.id);
    const contributionId = toNumber(req.body.contributionId);
    if (!collectionId || !contributionId) {
      return res.status(400).json({ error: 'collection id and contributionId are required' });
    }

    const userId = req.session.userId;
    const collection = await pool.query(
      `SELECT id FROM academic_contribution_collections WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [collectionId, userId]
    );
    if (!collection.rows[0]) return res.status(404).json({ error: 'Collection not found' });

    await pool.query(
      `INSERT INTO academic_contribution_collection_items (collection_id, contribution_id, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (collection_id, contribution_id)
       DO UPDATE SET notes = COALESCE(EXCLUDED.notes, academic_contribution_collection_items.notes)`,
      [collectionId, contributionId, String(req.body.notes || '').trim().slice(0, 220) || null]
    );

    await pool.query(
      `INSERT INTO academic_contribution_feedback (contribution_id, user_id, is_saved)
       VALUES ($1, $2, TRUE)
       ON CONFLICT (contribution_id, user_id)
       DO UPDATE SET is_saved = TRUE, updated_at = CURRENT_TIMESTAMP`,
      [contributionId, userId]
    );

    res.json({ message: 'Resource saved to collection' });
  } catch (error) {
    next(error);
  }
});

router.delete('/collections/:id/items/:resourceId', requireAuth, async (req, res, next) => {
  try {
    const collectionId = toNumber(req.params.id);
    const resourceId = toNumber(req.params.resourceId);
    if (!collectionId || !resourceId) return res.status(400).json({ error: 'Invalid id' });

    const userId = req.session.userId;
    const deleted = await pool.query(
      `DELETE FROM academic_contribution_collection_items i
       USING academic_contribution_collections c
       WHERE i.collection_id = c.id
         AND c.user_id = $1
         AND i.collection_id = $2
         AND i.contribution_id = $3
       RETURNING i.id`,
      [userId, collectionId, resourceId]
    );

    if (!deleted.rows[0]) return res.status(404).json({ error: 'Saved resource not found in this collection' });
    res.json({ message: 'Resource removed from collection' });
  } catch (error) {
    next(error);
  }
});

router.get('/contributor/:userId/profile', requireAuth, async (req, res, next) => {
  try {
    const targetUserId = toNumber(req.params.userId);
    if (!targetUserId) return res.status(400).json({ error: 'Invalid contributor id' });

    const profile = await pool.query(
          `SELECT id, full_name, college_name, contributor_level, contribution_points, contribution_verified,
            contribution_trusted, contribution_trust_score, contribution_subject_expert,
            contribution_admin_certified, contribution_verified_subjects_json
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [targetUserId]
    );
    if (!profile.rows[0]) return res.status(404).json({ error: 'Contributor not found' });

    const [stats, topResources, expertise] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total_uploads,
           COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_uploads,
           COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_uploads,
           COALESCE(SUM(download_count), 0)::int AS total_downloads,
           COALESCE(SUM(helpful_count), 0)::int AS total_helpful
         FROM academic_contributions
         WHERE user_id = $1`,
        [targetUserId]
      ),
      pool.query(
        `SELECT id, title, resource_type, subject_name, download_count, helpful_count, is_featured, quality_score
         FROM academic_contributions
         WHERE user_id = $1 AND status = 'approved'
         ORDER BY (download_count + helpful_count * 2 + quality_score) DESC, created_at DESC
         LIMIT 8`,
        [targetUserId]
      ),
      pool.query(
        `SELECT subject_name, COUNT(*)::int AS uploads
         FROM academic_contributions
         WHERE user_id = $1
         GROUP BY subject_name
         ORDER BY uploads DESC
         LIMIT 5`,
        [targetUserId]
      )
    ]);

    const s = stats.rows[0] || {};
    const approvalRate = Number(s.total_uploads || 0) > 0
      ? Math.round((Number(s.approved_uploads || 0) / Number(s.total_uploads || 0)) * 100)
      : 0;

    res.json({
      contributor: profile.rows[0],
      metrics: {
        totalUploads: Number(s.total_uploads || 0),
        approvedUploads: Number(s.approved_uploads || 0),
        rejectedUploads: Number(s.rejected_uploads || 0),
        totalDownloads: Number(s.total_downloads || 0),
        totalHelpful: Number(s.total_helpful || 0),
        approvalRate
      },
      topResources: topResources.rows.map((item) => ({ ...item, badges: computeResourceBadges(item) })),
      subjectExpertise: expertise.rows,
      badges: [
        profile.rows[0].contribution_verified ? 'verified_academic_contributor' : null,
        profile.rows[0].contribution_subject_expert ? 'subject_expert' : null,
        profile.rows[0].contribution_admin_certified ? 'admin_certified' : null,
        approvalRate >= 80 && Number(s.total_uploads || 0) >= 6 ? 'high_approval_rate' : null,
        Number(s.total_downloads || 0) >= 200 ? 'most_helpful_contributor' : null
      ].filter(Boolean)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/leaderboard', requireAuth, async (req, res, next) => {
  try {
    const range = String(req.query.range || 'monthly').trim().toLowerCase();
    let windowClause = '';
    if (range === 'weekly') windowClause = "AND c.created_at >= CURRENT_DATE - INTERVAL '7 days'";
    if (range === 'monthly') windowClause = "AND c.created_at >= CURRENT_DATE - INTERVAL '30 days'";

    const result = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.college_name,
         u.contributor_level,
         u.contribution_verified,
        u.contribution_subject_expert,
        u.contribution_admin_certified,
         COUNT(c.id)::int AS uploads,
         COUNT(c.id) FILTER (WHERE c.status = 'approved')::int AS approved,
         COALESCE(SUM(c.points_awarded), 0)::int AS points,
         COALESCE(SUM(c.download_count), 0)::int AS downloads,
         COALESCE(SUM(c.helpful_count), 0)::int AS helpful
       FROM users u
       JOIN academic_contributions c ON c.user_id = u.id
       WHERE 1=1 ${windowClause}
       GROUP BY u.id
       ORDER BY points DESC, helpful DESC, downloads DESC
       LIMIT 50`
    );

    res.json({
      range,
      leaderboard: result.rows,
      highlights: {
        bestNotesUploader: result.rows[0] || null,
        mostHelpfulContributor: [...result.rows].sort((a, b) => Number(b.helpful || 0) - Number(a.helpful || 0))[0] || null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/season-mode', requireAuth, async (req, res, next) => {
  try {
    const windowDays = Math.max(7, Math.min(120, toNumber(req.query.windowDays, 30)));
    const month = new Date().getMonth() + 1;
    const examMode = [3, 4, 5, 10, 11, 12].includes(month);

    const [subjectTrends, examTrends] = await Promise.all([
      pool.query(
        `SELECT c.subject_name,
                COUNT(e.id)::int AS recent_downloads
         FROM academic_contribution_download_events e
         JOIN academic_contributions c ON c.id = e.contribution_id
         WHERE e.downloaded_at >= CURRENT_DATE - ($1::text || ' days')::interval
         GROUP BY c.subject_name
         ORDER BY recent_downloads DESC
         LIMIT 10`,
        [windowDays]
      ),
      pool.query(
        `SELECT COALESCE(c.exam_type, 'general') AS exam_type,
                COUNT(e.id)::int AS recent_downloads
         FROM academic_contribution_download_events e
         JOIN academic_contributions c ON c.id = e.contribution_id
         WHERE e.downloaded_at >= CURRENT_DATE - ($1::text || ' days')::interval
         GROUP BY COALESCE(c.exam_type, 'general')
         ORDER BY recent_downloads DESC`,
        [windowDays]
      )
    ]);

    res.json({
      windowDays,
      examMode,
      modeLabel: examMode ? 'Exam Mode' : 'Learning Mode',
      trendingBySubject: subjectTrends.rows,
      mostUsedBeforeExam: examTrends.rows
    });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/download', requireAuth, async (req, res, next) => {
  try {
    const id = toNumber(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid contribution id' });

    const userId = req.session.userId;
    const collegeContext = await getUserCollegeContext(userId);
    if (!collegeContext) {
      return res.status(400).json({ error: 'Your account must be linked to a college to access this resource.' });
    }

    const entitlement = await pool.query(
      `SELECT role, subscription_tier
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const result = await pool.query(
      `UPDATE academic_contributions
       SET download_count = download_count + 1,
           last_downloaded_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND college_name = $2
         AND status = 'approved'
         AND is_hidden = FALSE
         AND (
           is_premium = FALSE
           OR $3 = 'admin'
           OR COALESCE($4, 'free') = 'premium'
         )
       RETURNING id, user_id, title, file_url, download_count, is_premium`,
      [id, collegeContext.collegeName, entitlement.rows[0]?.role || 'student', entitlement.rows[0]?.subscription_tier || 'free']
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Resource not found or unavailable for your account tier' });
    }

    await pool.query(
      `INSERT INTO academic_contribution_download_events (contribution_id, user_id, college_name)
       VALUES ($1, $2, $3)`,
      [id, userId, collegeContext.collegeName]
    );

    const downloads = Number(result.rows[0].download_count || 0);
    if (downloads === 50 || downloads === 100 || downloads === 250) {
      await notifyUser(
        result.rows[0].user_id,
        `Your resource \"${result.rows[0].title}\" reached ${downloads} downloads.`,
        'contribution_growth_milestone'
      );
    }

    const trendCheck = await pool.query(
      `SELECT COUNT(*)::int AS weekly_downloads
       FROM academic_contribution_download_events
       WHERE contribution_id = $1
         AND downloaded_at >= CURRENT_DATE - INTERVAL '7 days'`,
      [id]
    );

    if (Number(trendCheck.rows[0]?.weekly_downloads || 0) === 25) {
      await notifyUser(
        result.rows[0].user_id,
        `Your resource \"${result.rows[0].title}\" is trending this week.`,
        'contribution_trending'
      );
    }

    const uploaderMilestones = [100, 250, 500, 1000];
    if (uploaderMilestones.includes(downloads)) {
      await pool.query(
        `INSERT INTO contribution_growth_events (user_id, event_key, event_value, meta_json)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          result.rows[0].user_id,
          'download_milestone',
          downloads,
          JSON.stringify({ contributionId: id, title: result.rows[0].title })
        ]
      );
      await notifyUser(
        result.rows[0].user_id,
        `Milestone unlocked: ${downloads} downloads on \"${result.rows[0].title}\".`,
        'contribution_milestone'
      );
    }

    publishRealtimeEvent('contribution_download_updated', {
      contributionId: result.rows[0].id,
      collegeName: collegeContext.collegeName,
      downloadCount: downloads,
      title: result.rows[0].title
    });

    publishRealtimeEvent('contribution_leaderboard_updated', {
      collegeName: collegeContext.collegeName,
      source: 'download'
    });

    res.json({
      resource: result.rows[0],
      downloadUrl: result.rows[0].file_url
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
