const crypto = require('crypto');
const { pool } = require('../db/pool');
const { publishRealtimeEvent } = require('./realtimeBus');

const RESOURCE_TYPES = [
  'class_notes',
  'handwritten_notes',
  'mst1_paper',
  'mst2_paper',
  'final_exam_paper',
  'assignment',
  'lab_file',
  'pyq',
  'other'
];

const QUESTION_PAPER_TYPES = new Set(['mst1_paper', 'mst2_paper', 'final_exam_paper', 'pyq']);
const EXAM_TYPES = ['mst1', 'mst2', 'final', 'pyq', 'other'];

const CONTRIBUTOR_LEVELS = {
  NEW: 'New Contributor',
  TRUSTED: 'Trusted Contributor',
  VERIFIED: 'Verified Academic Contributor'
};

const DEFAULT_CONTRIBUTION_CONFIG = {
  enabled: true,
  visibility: {
    showHubEntryPoint: true
  },
  allowByType: {
    class_notes: true,
    handwritten_notes: true,
    mst1_paper: true,
    mst2_paper: true,
    final_exam_paper: true,
    assignment: true,
    lab_file: true,
    pyq: true,
    other: true
  },
  moderation: {
    requireReasonOnReject: true,
    duplicateAutoFlagThreshold: 70,
    qualityWarningThreshold: 45
  },
  seasonalControl: {
    enabled: false,
    mode: 'normal',
    examCampaignLabel: '',
    campaignMessage: '',
    campaignStartsAt: null,
    campaignEndsAt: null
  },
  limits: {
    maxFileSizeMb: 12,
    maxPreviewSizeMb: 4,
    maxTags: 10,
    maxDescriptionChars: 1200
  },
  rewards: {
    baseApprovalPoints: 20,
    qualityBonusPoints: 10,
    featuredBonusPoints: 20,
    duplicateOrWeakPoints: 0
  }
};

let schemaReady = false;

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (!isObject(base)) return typeof override === 'undefined' ? base : override;

  const output = { ...base };
  if (!isObject(override)) return output;

  Object.keys(override).forEach((key) => {
    output[key] = deepMerge(base[key], override[key]);
  });
  return output;
}

function toNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toSafeTags(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((tag) => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
  }

  const input = String(raw || '').trim();
  if (!input) return [];

  return input
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeExamSession(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  return value.slice(0, 40);
}

function normalizeTitle(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isQuestionPaperType(type) {
  return QUESTION_PAPER_TYPES.has(type);
}

function isAllowedResourceType(type) {
  return RESOURCE_TYPES.includes(String(type || '').trim().toLowerCase());
}

function computeQualityScore(payload) {
  let score = 30;

  if (payload.title && payload.title.length >= 10) score += 10;
  if (payload.description && payload.description.length >= 60) score += 15;
  if (payload.tags && payload.tags.length >= 2) score += 10;
  if (payload.subjectName && payload.subjectName.length >= 3) score += 10;
  if (payload.fileSizeBytes >= 60 * 1024) score += 10;
  if (payload.fileSizeBytes >= 250 * 1024) score += 10;
  if (payload.previewImageUrl) score += 5;

  return Math.max(0, Math.min(100, score));
}

function computeContributorLevel(totalPoints, approvedCount) {
  const points = Number(totalPoints || 0);
  const approvals = Number(approvedCount || 0);

  if (points >= 350 && approvals >= 15) {
    return CONTRIBUTOR_LEVELS.VERIFIED;
  }
  if (points >= 120 && approvals >= 5) {
    return CONTRIBUTOR_LEVELS.TRUSTED;
  }
  return CONTRIBUTOR_LEVELS.NEW;
}

async function ensureContributionSchema() {
  if (schemaReady) return;

  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  } catch (_error) {
    // Extension installation may be restricted on managed Postgres.
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(120) PRIMARY KEY,
      value_json JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS contribution_points INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS contributor_level VARCHAR(80) NOT NULL DEFAULT 'New Contributor',
      ADD COLUMN IF NOT EXISTS contribution_trust_score INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS contribution_upload_suspended BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS contribution_upload_suspended_reason TEXT,
      ADD COLUMN IF NOT EXISTS contribution_verified BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS contribution_trusted BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS contribution_subject_expert BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS contribution_admin_certified BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS contribution_verified_subjects_json JSONB NOT NULL DEFAULT '[]'::jsonb
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contributions (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      college_id INTEGER REFERENCES colleges(id),
      college_name VARCHAR(180) NOT NULL,
      title VARCHAR(220) NOT NULL,
      title_normalized VARCHAR(220) NOT NULL,
      resource_type VARCHAR(40) NOT NULL,
      category_id INTEGER REFERENCES academic_categories(id),
      branch_id INTEGER REFERENCES academic_branches(id),
      semester_id INTEGER REFERENCES academic_semesters(id),
      subject_id INTEGER REFERENCES academic_subjects(id),
      subject_name VARCHAR(180) NOT NULL,
      exam_type VARCHAR(20),
      exam_session VARCHAR(40),
      description TEXT,
      tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      file_url TEXT NOT NULL,
      preview_image_url TEXT,
      file_name VARCHAR(260),
      file_mime VARCHAR(120),
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      file_sha256 VARCHAR(64),
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      moderation_reason TEXT,
      moderation_notes TEXT,
      quality_score INTEGER NOT NULL DEFAULT 0,
      duplicate_score INTEGER NOT NULL DEFAULT 0,
      duplicate_of_id INTEGER REFERENCES academic_contributions(id),
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      is_premium BOOLEAN NOT NULL DEFAULT FALSE,
      quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      usefulness_score INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0,
      save_count INTEGER NOT NULL DEFAULT 0,
      helpful_count INTEGER NOT NULL DEFAULT 0,
      not_helpful_count INTEGER NOT NULL DEFAULT 0,
      current_version INTEGER NOT NULL DEFAULT 1,
      last_downloaded_at TIMESTAMP,
      moderated_by INTEGER REFERENCES users(id),
      moderated_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_academic_contrib_college_status_created
    ON academic_contributions(college_name, status, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_academic_contrib_filters
    ON academic_contributions(branch_id, semester_id, resource_type, exam_type)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_academic_contrib_file_hash
    ON academic_contributions(file_sha256)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_academic_contrib_fts
    ON academic_contributions
    USING GIN (to_tsvector('simple', COALESCE(title, '') || ' ' || COALESCE(subject_name, '') || ' ' || COALESCE(description, '')))
  `);

  await pool.query(`
    ALTER TABLE academic_contributions
      ADD COLUMN IF NOT EXISTS is_premium BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS quality_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS save_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS helpful_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS not_helpful_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS last_downloaded_at TIMESTAMP
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contribution_versions (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      contribution_id INTEGER NOT NULL REFERENCES academic_contributions(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      file_url TEXT NOT NULL,
      preview_image_url TEXT,
      file_name VARCHAR(260),
      file_mime VARCHAR(120),
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      file_sha256 VARCHAR(64),
      snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      change_notes TEXT,
      changed_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(contribution_id, version_number)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_versions_contribution
    ON academic_contribution_versions(contribution_id, version_number DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contribution_feedback (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      contribution_id INTEGER NOT NULL REFERENCES academic_contributions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_helpful BOOLEAN,
      is_saved BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(contribution_id, user_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_feedback_contribution
    ON academic_contribution_feedback(contribution_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contribution_collections (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(120) NOT NULL,
      description VARCHAR(320),
      color_hex VARCHAR(10) DEFAULT '#1d4ed8',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contribution_collection_items (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      collection_id INTEGER NOT NULL REFERENCES academic_contribution_collections(id) ON DELETE CASCADE,
      contribution_id INTEGER NOT NULL REFERENCES academic_contributions(id) ON DELETE CASCADE,
      notes VARCHAR(220),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(collection_id, contribution_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_collection_items_collection
    ON academic_contribution_collection_items(collection_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contribution_download_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      contribution_id INTEGER NOT NULL REFERENCES academic_contributions(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      college_name VARCHAR(180),
      downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_download_events_contribution
    ON academic_contribution_download_events(contribution_id, downloaded_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_download_events_date
    ON academic_contribution_download_events(downloaded_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contribution_preview_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      contribution_id INTEGER NOT NULL REFERENCES academic_contributions(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      page_number INTEGER,
      section_key VARCHAR(120),
      view_duration_ms INTEGER NOT NULL DEFAULT 0,
      viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_preview_events_contribution
    ON academic_contribution_preview_events(contribution_id, viewed_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contribution_resource_comments (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      contribution_id INTEGER NOT NULL REFERENCES academic_contributions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_comment_id INTEGER REFERENCES academic_contribution_resource_comments(id) ON DELETE CASCADE,
      kind VARCHAR(20) NOT NULL DEFAULT 'comment',
      body TEXT NOT NULL,
      is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
      upvote_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_comments_contribution
    ON academic_contribution_resource_comments(contribution_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_contribution_comment_votes (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      comment_id INTEGER NOT NULL REFERENCES academic_contribution_resource_comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(comment_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contribution_growth_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_key VARCHAR(100) NOT NULL,
      event_value INTEGER NOT NULL DEFAULT 0,
      meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contribution_growth_user
    ON contribution_growth_events(user_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_subject_aliases (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      alias_term VARCHAR(120) NOT NULL UNIQUE,
      canonical_subject VARCHAR(180) NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO academic_subject_aliases (alias_term, canonical_subject, weight)
    VALUES
      ('dbms', 'Database Management System', 20),
      ('database', 'Database Management System', 15),
      ('dsa', 'Data Structures and Algorithms', 20),
      ('os', 'Operating Systems', 20),
      ('oops', 'Object Oriented Programming', 18),
      ('oop', 'Object Oriented Programming', 16),
      ('cn', 'Computer Networks', 20),
      ('coa', 'Computer Organization and Architecture', 16),
      ('toc', 'Theory of Computation', 15)
    ON CONFLICT (alias_term) DO NOTHING
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contribution_point_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      contribution_id INTEGER NOT NULL REFERENCES academic_contributions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      points_delta INTEGER NOT NULL,
      reason VARCHAR(160),
      actor_admin_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contribution_moderation_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      contribution_id INTEGER REFERENCES academic_contributions(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(80) NOT NULL,
      previous_status VARCHAR(30),
      next_status VARCHAR(30),
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      actor_admin_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_moderation_events_contribution
    ON contribution_moderation_events(contribution_id, created_at DESC)
  `);

  // Schema extensions for intelligent admin features
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS last_quality_avg_7d NUMERIC(5, 1) DEFAULT 50,
      ADD COLUMN IF NOT EXISTS last_approval_rate_7d NUMERIC(5, 1) DEFAULT 50,
      ADD COLUMN IF NOT EXISTS spam_score INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_quality_check TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE academic_contributions
      ADD COLUMN IF NOT EXISTS effectiveness_score INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS suspicion_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS moderation_confidence_json JSONB NOT NULL DEFAULT '{"duplicate":"unknown","quality":"unknown","subject_match":"unknown"}'::jsonb,
      ADD COLUMN IF NOT EXISTS auto_action_flag BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS moderation_priority_tier VARCHAR(20) DEFAULT 'medium'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_moderation_filters (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filter_name VARCHAR(100) NOT NULL,
      filter_config JSONB NOT NULL,
      is_private BOOLEAN NOT NULL DEFAULT TRUE,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(admin_user_id, filter_name)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_intelligence_cache (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      cache_key VARCHAR(120) NOT NULL UNIQUE,
      cache_value JSONB NOT NULL,
      cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour')
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contributor_quality_history (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period_date DATE NOT NULL,
      avg_quality_score NUMERIC(5, 1),
      avg_duplicate_score NUMERIC(5, 1),
      approval_count INTEGER NOT NULL DEFAULT 0,
      rejection_count INTEGER NOT NULL DEFAULT 0,
      total_submissions INTEGER NOT NULL DEFAULT 0,
      recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, period_date)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_contrib_quality_history_user
    ON contributor_quality_history(user_id, period_date DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suspicious_activity_alerts (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      contribution_id INTEGER REFERENCES academic_contributions(id) ON DELETE CASCADE,
      alert_type VARCHAR(50) NOT NULL,
      alert_message TEXT NOT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'medium',
      is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
      admin_notes TEXT,
      resolved_by INTEGER REFERENCES users(id),
      resolved_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_suspicious_alerts_user
    ON suspicious_activity_alerts(user_id, is_resolved)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS resource_effectiveness_analysis (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      contribution_id INTEGER NOT NULL REFERENCES academic_contributions(id) ON DELETE CASCADE,
      effectiveness_score INTEGER,
      download_to_helpful_ratio NUMERIC(5, 2),
      speed_to_first_download_days INTEGER,
      save_to_download_ratio NUMERIC(5, 2),
      is_outdated BOOLEAN NOT NULL DEFAULT FALSE,
      archive_suggestion VARCHAR(50),
      analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(contribution_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subject_demand_heatmap (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      college_name VARCHAR(180),
      branch_id INTEGER,
      semester_id INTEGER,
      subject_name VARCHAR(180),
      resource_type VARCHAR(40),
      upload_volume_30d INTEGER DEFAULT 0,
      approval_rate NUMERIC(5, 1) DEFAULT 0,
      avg_download_velocity NUMERIC(10, 2) DEFAULT 0,
      is_high_demand BOOLEAN NOT NULL DEFAULT FALSE,
      analyzed_date DATE DEFAULT CURRENT_DATE,
      UNIQUE(college_name, branch_id, semester_id, subject_name, resource_type, analyzed_date)
    )
  `);

  await pool.query(`
    INSERT INTO platform_settings (key, value_json)
    VALUES ('academic_contribution_config', $1::jsonb)
    ON CONFLICT (key) DO NOTHING
  `, [JSON.stringify(DEFAULT_CONTRIBUTION_CONFIG)]);

  schemaReady = true;
}

async function getContributionConfig() {
  await ensureContributionSchema();
  const result = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'academic_contribution_config' LIMIT 1");
  return deepMerge(DEFAULT_CONTRIBUTION_CONFIG, result.rows[0]?.value_json || {});
}

async function updateContributionConfig(payload, updatedBy) {
  const merged = deepMerge(DEFAULT_CONTRIBUTION_CONFIG, payload || {});
  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ('academic_contribution_config', $1::jsonb, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(merged), updatedBy || null]
  );
  return merged;
}

async function getUserCollegeContext(userId) {
  const result = await pool.query(
    `SELECT u.id, u.college_name, c.id AS college_id
     FROM users u
     LEFT JOIN colleges c ON c.name = u.college_name
     WHERE u.id = $1`,
    [userId]
  );

  const row = result.rows[0] || null;
  if (!row || !row.college_name) return null;
  return {
    userId: row.id,
    collegeId: row.college_id || null,
    collegeName: row.college_name
  };
}

async function validateAcademicScope({ branchId, semesterId, subjectId, subjectName }) {
  const branch = toNumber(branchId);
  const semester = toNumber(semesterId);
  const subject = toNumber(subjectId);

  if (!branch || !semester) {
    return { ok: false, error: 'branchId and semesterId are required' };
  }

  const [branchRes, semesterRes] = await Promise.all([
    pool.query('SELECT id FROM academic_branches WHERE id = $1', [branch]),
    pool.query('SELECT id FROM academic_semesters WHERE id = $1', [semester])
  ]);

  if (branchRes.rowCount === 0) return { ok: false, error: 'Invalid branchId' };
  if (semesterRes.rowCount === 0) return { ok: false, error: 'Invalid semesterId' };

  if (subject) {
    const subjectRes = await pool.query(
      `SELECT id, name
       FROM academic_subjects
       WHERE id = $1 AND branch_id = $2 AND (semester_id = $3 OR semester_id IS NULL)
       LIMIT 1`,
      [subject, branch, semester]
    );

    if (!subjectRes.rows[0]) {
      return { ok: false, error: 'subjectId does not match selected branch/semester' };
    }

    return {
      ok: true,
      branchId: branch,
      semesterId: semester,
      subjectId: subject,
      subjectName: subjectRes.rows[0].name
    };
  }

  const cleanedSubjectName = String(subjectName || '').trim();
  if (!cleanedSubjectName || cleanedSubjectName.length < 2) {
    return { ok: false, error: 'subject is required' };
  }

  return {
    ok: true,
    branchId: branch,
    semesterId: semester,
    subjectId: null,
    subjectName: cleanedSubjectName.slice(0, 180)
  };
}

async function detectDuplicateSignals({
  collegeName,
  fileHash,
  branchId,
  semesterId,
  subjectName,
  resourceType,
  examType,
  examSession,
  titleNormalized
}) {
  let duplicateScore = 0;
  let duplicateOfId = null;

  if (fileHash) {
    const hashMatch = await pool.query(
      `SELECT id, status
       FROM academic_contributions
       WHERE college_name = $1
         AND file_sha256 = $2
         AND status <> 'rejected'
       ORDER BY created_at DESC
       LIMIT 1`,
      [collegeName, fileHash]
    );

    if (hashMatch.rows[0]) {
      duplicateScore = Math.max(duplicateScore, 95);
      duplicateOfId = hashMatch.rows[0].id;
    }
  }

  const metadataMatch = await pool.query(
    `SELECT id
     FROM academic_contributions
     WHERE college_name = $1
       AND branch_id = $2
       AND semester_id = $3
       AND LOWER(subject_name) = LOWER($4)
       AND resource_type = $5
       AND COALESCE(exam_type, '') = COALESCE($6, '')
       AND COALESCE(exam_session, '') = COALESCE($7, '')
       AND title_normalized = $8
       AND status <> 'rejected'
     ORDER BY created_at DESC
     LIMIT 1`,
    [collegeName, branchId, semesterId, subjectName, resourceType, examType || null, examSession || null, titleNormalized]
  );

  if (metadataMatch.rows[0]) {
    duplicateScore = Math.max(duplicateScore, 78);
    duplicateOfId = duplicateOfId || metadataMatch.rows[0].id;
  }

  return { duplicateScore, duplicateOfId };
}

function computeFileHash(file) {
  if (!file?.buffer) return null;
  return crypto.createHash('sha256').update(file.buffer).digest('hex');
}

async function recomputeContributorProfile(userId) {
  const totals = await pool.query(
    `SELECT
       COALESCE(SUM(points_awarded), 0)::int AS total_points,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count
     FROM academic_contributions
     WHERE user_id = $1`,
    [userId]
  );

  const totalPoints = Number(totals.rows[0]?.total_points || 0);
  const approvedCount = Number(totals.rows[0]?.approved_count || 0);
  const level = computeContributorLevel(totalPoints, approvedCount);
  const trustScore = Math.max(0, Math.min(100, Math.round((totalPoints / 10) + approvedCount * 2)));
  const trusted = level === CONTRIBUTOR_LEVELS.TRUSTED || level === CONTRIBUTOR_LEVELS.VERIFIED;
  const verified = level === CONTRIBUTOR_LEVELS.VERIFIED;

  await pool.query(
    `UPDATE users
     SET contribution_points = $1,
         contributor_level = $2,
         contribution_trust_score = $3,
         contribution_trusted = $4,
         contribution_verified = $5
     WHERE id = $6`,
    [totalPoints, level, trustScore, trusted, verified, userId]
  );

  return { totalPoints, approvedCount, level };
}

async function addContributionPointEvent({ contributionId, userId, pointsDelta, reason, actorAdminId }) {
  if (!Number.isFinite(Number(pointsDelta)) || Number(pointsDelta) === 0) return;

  await pool.query(
    `INSERT INTO contribution_point_events (contribution_id, user_id, points_delta, reason, actor_admin_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [contributionId, userId, Number(pointsDelta), reason || null, actorAdminId || null]
  );
}

async function notifyUser(userId, message, kind = 'academic_contribution') {
  await pool.query(
    `INSERT INTO notifications (user_id, message, kind)
     VALUES ($1, $2, $3)`,
    [userId, message, kind]
  );

  publishRealtimeEvent('notification_changed', {
    userId,
    kind,
    message
  });
}

async function setContributorTrustState({
  userId,
  contributorLevel,
  trustScore,
  isTrusted,
  isVerified,
  uploadSuspended,
  suspensionReason
}) {
  await pool.query(
    `UPDATE users
     SET contributor_level = COALESCE($1, contributor_level),
         contribution_trust_score = COALESCE($2, contribution_trust_score),
         contribution_trusted = COALESCE($3, contribution_trusted),
         contribution_verified = COALESCE($4, contribution_verified),
         contribution_upload_suspended = COALESCE($5, contribution_upload_suspended),
         contribution_upload_suspended_reason = CASE
           WHEN $5 = TRUE THEN COALESCE($6, contribution_upload_suspended_reason)
           WHEN $5 = FALSE THEN NULL
           ELSE contribution_upload_suspended_reason
         END
     WHERE id = $7`,
    [
      contributorLevel || null,
      Number.isFinite(Number(trustScore)) ? Math.max(0, Math.min(100, Math.round(Number(trustScore)))) : null,
      typeof isTrusted === 'boolean' ? isTrusted : null,
      typeof isVerified === 'boolean' ? isVerified : null,
      typeof uploadSuspended === 'boolean' ? uploadSuspended : null,
      suspensionReason || null,
      userId
    ]
  );
}

async function addContributionModerationEvent({
  contributionId,
  userId,
  action,
  previousStatus,
  nextStatus,
  payload,
  actorAdminId
}) {
  await pool.query(
    `INSERT INTO contribution_moderation_events (
       contribution_id,
       user_id,
       action,
       previous_status,
       next_status,
       payload_json,
       actor_admin_id
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      contributionId || null,
      userId || null,
      action || 'unknown',
      previousStatus || null,
      nextStatus || null,
      JSON.stringify(payload || {}),
      actorAdminId || null
    ]
  );
}

module.exports = {
  RESOURCE_TYPES,
  EXAM_TYPES,
  QUESTION_PAPER_TYPES,
  CONTRIBUTOR_LEVELS,
  DEFAULT_CONTRIBUTION_CONFIG,
  ensureContributionSchema,
  getContributionConfig,
  updateContributionConfig,
  getUserCollegeContext,
  validateAcademicScope,
  detectDuplicateSignals,
  computeFileHash,
  computeQualityScore,
  computeContributorLevel,
  recomputeContributorProfile,
  setContributorTrustState,
  addContributionPointEvent,
  addContributionModerationEvent,
  notifyUser,
  toSafeTags,
  normalizeExamSession,
  normalizeTitle,
  isAllowedResourceType,
  isQuestionPaperType,
  toNumber
};
