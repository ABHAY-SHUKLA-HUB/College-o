const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const {
  requirePermission,
  writeAuditLog,
  isLastSuperAdmin,
  getUserPermissions,
  redactSensitiveFields
} = require('../middleware/rbac');
const { STABLE_PERMISSIONS, DEFAULT_SYSTEM_ROLES } = require('../utils/rbacSchema');
const { ensureUniversityCatalogSchema } = require('../utils/universities');
const { readStudentExperienceConfig, normalizeLiveHubConfig, invalidateExperienceConfigCache } = require('./dashboard');
const { invalidateUniversityCatalogCache } = require('./meta');
const { publishRealtimeEvent, publishContentChanged } = require('../services/realtimeBus');

const { readFeatureMatrix, updateFeatureStatus } = require('../middleware/featureToggle');
const { ensureMembershipSchema } = require('../services/entitlementResolver');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');

const router = express.Router();

let adminControlSchemaEnsured = false;

const CONTENT_MAP = {
  notes: { table: 'notes', idColumn: 'id' },
  materials: { table: 'materials', idColumn: 'id' },
  papers: { table: 'previous_papers', idColumn: 'id' },
  quizzes: { table: 'quizzes', idColumn: 'id' },
  mockTests: { table: 'mock_tests', idColumn: 'id' },
  roadmaps: { table: 'roadmaps', idColumn: 'id' },
  certificates: { table: 'certificates', idColumn: 'id' },
  notifications: { table: 'notifications', idColumn: 'id' },
  announcements: { table: 'announcements', idColumn: 'id' }
};

const DEFAULT_STUDENT_EXPERIENCE_CONFIG = {
  home: {
    hero: {
      title: 'Your Learning Command Center',
      description: 'Build momentum with daily tasks, topic-focused practice, and AI recommendations aligned to your branch.',
      ctaPrimary: { label: 'Start Learning', href: 'quiz-library.html' },
      ctaSecondary: { label: 'Continue Roadmap', href: 'study-roadmap.html' },
      bannerGraphicUrl: ''
    },
    sectionVisibility: {
      learningMetrics: true,
      studyPlan: true,
      continueLearning: true,
      smartRecommendations: true,
      weakTopics: true,
      analytics: true,
      achievements: true,
      gamification: true,
      assistantWidget: true,
      announcements: true
    }
  },
  liveHub: {
    enabled: true,
    title: 'Unified Live Hub',
    subtitle: 'Mentorship sessions and hands-on labs in one place.',
    mentorshipCycleDays: 15,
    labCycleDays: 7,
    defaultProvider: 'jitsi',
    sidebarLabel: 'Live Hub',
    sessions: [
      {
        id: 'mentor-resume-review',
        type: 'mentorship',
        title: 'Resume Review and Interview Prep',
        mentorName: 'Ananya Sharma',
        mentorAccessId: 'MENTOR-RESUME-001',
        startAt: '2026-05-05T10:00:00.000Z',
        endAt: '2026-05-05T11:00:00.000Z',
        durationMinutes: 60,
        provider: 'jitsi',
        roomId: 'resume-review-room',
        status: 'scheduled',
        summary: 'Live feedback on resumes, projects, and interview confidence.'
      },
      {
        id: 'mentor-placement-office',
        type: 'mentorship',
        title: 'Placement Strategy Office Hours',
        mentorName: 'Rohit Verma',
        mentorAccessId: 'MENTOR-PLACEMENT-002',
        startAt: '2026-05-08T09:30:00.000Z',
        endAt: '2026-05-08T10:45:00.000Z',
        durationMinutes: 75,
        provider: 'jitsi',
        roomId: 'placement-office-hours',
        status: 'scheduled',
        summary: 'Career planning and placement strategy for the next hiring cycle.'
      },
      {
        id: 'lab-az900-cloud-fundamentals',
        type: 'lab',
        title: 'AZ-900 Cloud Fundamentals Lab',
        mentorName: 'Priya Nair',
        mentorAccessId: 'LAB-AZ900-003',
        startAt: '2026-05-06T14:00:00.000Z',
        endAt: '2026-05-06T15:30:00.000Z',
        durationMinutes: 90,
        provider: 'jitsi',
        roomId: 'az900-lab-room',
        status: 'scheduled',
        summary: 'Hands-on walkthrough of cloud concepts, pricing, and lab exercises.'
      },
      {
        id: 'lab-ai900-applied-ai',
        type: 'lab',
        title: 'AI-900 Applied AI Lab',
        mentorName: 'Kunal Mehta',
        mentorAccessId: 'LAB-AI900-004',
        startAt: '2026-05-10T13:00:00.000Z',
        endAt: '2026-05-10T14:30:00.000Z',
        durationMinutes: 90,
        provider: 'agora',
        roomId: 'ai900-lab-room',
        status: 'scheduled',
        summary: 'Practical AI-900 walkthrough with prompt, vision, and language demos.'
      }
    ]
  },
  dashboard: {
    sectionVisibility: {
      learningStats: true,
      aiSuggestions: true,
      recommendedNotes: true,
      recommendedQuizzes: true,
      recommendedMockTests: true,
      achievements: true,
      analyticsCharts: true,
      studyPlan: true,
      activityTimeline: true,
      continueLearning: true,
      weakTopics: true
    },
    sectionOrder: [
      'hero',
      'stats',
      'continue-learning',
      'recommended-for-you',
      'weekly-analytics',
      'weak-topics',
      'recommended-content',
      'study-plan',
      'activity-timeline',
      'ai-suggestions',
      'quick-access',
      'achievements'
    ]
  },
  featureFlags: {
    aiTools: true,
    mockTests: true,
    roadmapSystem: true,
    certificates: true,
    leaderboard: true,
    analytics: true,
    academicContributions: true
  },
  contributions: {
    showHubEntryPoint: true
  },
  gamification: {
    xpMultiplier: 1,
    streakMinActionsPerDay: 1,
    badgeThresholds: {
      streak7: 7,
      streak14: 14,
      streak30: 30,
      xp500: 500,
      xp1000: 1000
    }
  }
};

const DEFAULT_MEMBERSHIP_CENTER_CONFIG = {
  hero: {
    title: 'Upgrade to College OS Premium',
    subtitle: 'Unlock unlimited learning with AI tools, premium mock tests, deep roadmaps, and verifiable certificates.',
    highlights: [
      'Unlimited notes',
      'AI tools access',
      'Mock tests and analytics',
      'Certificates and downloads',
      'Advanced roadmap access'
    ]
  },
  plans: {
    free: {
      name: 'Free Plan',
      description: 'Start learning with core resources.',
      priceInr: 0,
      billingLabel: 'forever',
      features: [
        'Limited notes access',
        'Basic dashboard and quizzes',
        '2 free mock attempts'
      ]
    },
    premium: {
      name: 'Premium Plan',
      description: 'Full platform access for serious learners.',
      priceInr: 49,
      billingLabel: 'month',
      durationDays: 30,
      features: [
        'Unlimited notes and downloads',
        'All AI tools enabled',
        'Unlimited mock tests',
        'Certificates and premium roadmaps'
      ]
    }
  },
  featureAccess: {
    notesAccess: { free: 'Limited', premium: 'Unlimited' },
    mockTests: { free: '2 attempts', premium: 'Unlimited' },
    aiTools: { free: false, premium: true },
    certificates: { free: false, premium: true },
    roadmapDepth: { free: 'Basic', premium: 'Advanced' },
    downloads: { free: false, premium: true }
  },
  payment: {
    upiId: 'shuklaabhayas0-1@okicici',
    qrCodeImageUrl: '',
    instructions: [
      'Scan the QR code or copy the UPI ID.',
      'Pay the premium amount shown on this page.',
      'Save payment screenshot (optional but recommended).',
      'Submit transaction ID and payment date.',
      'Wait for admin approval to activate premium.'
    ],
    supportText: 'Premium activates instantly after admin approval.'
  }
};

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

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function toInt(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (_error) {
      return fallback;
    }
  }
  return fallback;
}

function normalizeGoLiveStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'live' || raw === 'active') return 'live';
  if (raw === 'completed' || raw === 'ended') return 'completed';
  if (raw === 'ready' || raw === 'ready_to_go_live' || raw === 'ready-to-go-live') return 'ready';
  return 'scheduled';
}

function isActiveGoLiveStatus(status) {
  const normalized = normalizeGoLiveStatus(status);
  return normalized === 'ready' || normalized === 'live';
}

function parseMaybeDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
}

function windowsOverlap(left, right) {
  const leftStart = parseMaybeDate(left.startAt);
  const leftEnd = parseMaybeDate(left.endAt);
  const rightStart = parseMaybeDate(right.startAt);
  const rightEnd = parseMaybeDate(right.endAt);
  if (leftStart === null || leftEnd === null || rightStart === null || rightEnd === null) return true;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function normalizeGoLiveSession(session, index) {
  const type = String(session?.type || '').toLowerCase() === 'lab' ? 'lab' : 'mentorship';
  const mentorAccessId = String(session?.mentorAccessId || session?.liveAccessId || session?.accessId || '').trim();
  const mentorProfileKey = String(session?.mentorProfileKey || session?.mentorUid || session?.mentorEmail || session?.mentorUserId || '').trim();
  const inputStatus = String(session?.status || '').trim();
  const status = normalizeGoLiveStatus(inputStatus === 'scheduled' && mentorAccessId && mentorProfileKey ? 'ready' : inputStatus);

  return {
    ...session,
    id: String(session?.id || `${type}-${index + 1}`).trim(),
    type,
    mentorName: String(session?.mentorName || '').trim(),
    mentorAccessId,
    mentorProfileKey,
    status
  };
}

function validateGoLiveSessions(sessions = []) {
  const errors = [];
  const activeByAccessId = new Map();

  sessions.forEach((session, index) => {
    const row = index + 1;
    const status = normalizeGoLiveStatus(session.status);
    const accessId = String(session.mentorAccessId || '').trim();
    const mentorProfileKey = String(session.mentorProfileKey || '').trim();
    if ((status === 'ready' || status === 'live') && !accessId) {
      errors.push(`Session ${row}: Unique Mentor Go Live ID is required for Ready/Live sessions.`);
    }
    if ((status === 'ready' || status === 'live') && !mentorProfileKey) {
      errors.push(`Session ${row}: Mentor Profile Key is required to map the Go Live ID.`);
    }
    if (!isActiveGoLiveStatus(status) || !accessId) return;
    const key = accessId.toUpperCase();
    if (!activeByAccessId.has(key)) activeByAccessId.set(key, []);
    activeByAccessId.get(key).push({ row, session });
  });

  activeByAccessId.forEach((group, key) => {
    if (group.length < 2) return;
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (windowsOverlap(group[i].session, group[j].session)) {
          errors.push(`Go Live ID ${key} conflicts between sessions ${group[i].row} and ${group[j].row}.`);
        }
      }
    }
  });

  return errors;
}

async function ensureAdminControlSchema() {
  if (adminControlSchemaEnsured) return;

  await ensureUniversityCatalogSchema(pool);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS uid VARCHAR(40),
      ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS admin_role VARCHAR(40),
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS university_id INTEGER REFERENCES universities(id),
      ADD COLUMN IF NOT EXISTS university_name VARCHAR(220),
      ADD COLUMN IF NOT EXISTS custom_university VARCHAR(220)
  `);

  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_uid_unique_idx ON users(uid) WHERE uid IS NOT NULL');

  await pool.query(`
    ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id),
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id),
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id),
      ADD COLUMN IF NOT EXISTS learning_goals JSONB,
      ADD COLUMN IF NOT EXISTS onboarding_payload JSONB
  `);

  await pool.query(`
    ALTER TABLE academic_categories
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE academic_branches
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE academic_semesters
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE materials
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id),
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id),
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id),
      ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE previous_papers
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id),
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id),
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id),
      ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE mock_tests
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id),
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id),
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id),
      ADD COLUMN IF NOT EXISTS subject VARCHAR(120),
      ADD COLUMN IF NOT EXISTS topic VARCHAR(160),
      ADD COLUMN IF NOT EXISTS category_key VARCHAR(40) DEFAULT 'grand',
      ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20) DEFAULT 'medium',
      ADD COLUMN IF NOT EXISTS total_questions INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS syllabus TEXT,
      ADD COLUMN IF NOT EXISTS instructions TEXT,
      ADD COLUMN IF NOT EXISTS attempt_limit_free INTEGER DEFAULT 2,
      ADD COLUMN IF NOT EXISTS retake_allowed BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS explanations_visible BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS marks_per_question NUMERIC(6,2) DEFAULT 1,
      ADD COLUMN IF NOT EXISTS negative_marking_enabled BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS negative_marks NUMERIC(6,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS section_config JSONB DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mock_test_questions (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      mock_test_id INTEGER NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type VARCHAR(30) NOT NULL DEFAULT 'single_mcq',
      difficulty VARCHAR(20) DEFAULT 'medium',
      section_name VARCHAR(120),
      subject VARCHAR(120),
      topic VARCHAR(160),
      marks NUMERIC(6,2) DEFAULT 1,
      negative_marks NUMERIC(6,2) DEFAULT 0,
      explanation TEXT,
      options_json JSONB,
      correct_answer_json JSONB NOT NULL,
      order_no INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE mock_test_attempts
      ADD COLUMN IF NOT EXISTS total_questions INTEGER,
      ADD COLUMN IF NOT EXISTS correct_answers INTEGER,
      ADD COLUMN IF NOT EXISTS wrong_answers INTEGER,
      ADD COLUMN IF NOT EXISTS skipped_answers INTEGER,
      ADD COLUMN IF NOT EXISTS accuracy_percent NUMERIC(6,2),
      ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER,
      ADD COLUMN IF NOT EXISTS total_possible_marks NUMERIC(8,2),
      ADD COLUMN IF NOT EXISTS answers_json JSONB,
      ADD COLUMN IF NOT EXISTS section_breakdown JSONB,
      ADD COLUMN IF NOT EXISTS topic_breakdown JSONB
  `);

  await pool.query(`
    ALTER TABLE quizzes
      ADD COLUMN IF NOT EXISTS total_marks INTEGER DEFAULT 100,
      ADD COLUMN IF NOT EXISTS timer_minutes INTEGER DEFAULT 30,
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE roadmaps
      ADD COLUMN IF NOT EXISTS title VARCHAR(180),
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id),
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id),
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id),
      ADD COLUMN IF NOT EXISTS sequence_no INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE certificates
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id),
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id),
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id),
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'issued',
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS title VARCHAR(160),
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id),
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id),
      ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id),
      ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS is_announcement BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS forum_threads (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title VARCHAR(220) NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS forum_replies (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      thread_id INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_reply_id INTEGER REFERENCES forum_replies(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      is_best_answer BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE forum_threads
      ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE forum_replies
      ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
  `);

  await pool.query(`
    ALTER TABLE feedback
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'open',
      ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id)
  `);

  await pool.query(`
    ALTER TABLE referrals
      ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS reward_points INTEGER DEFAULT 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      title VARCHAR(160) NOT NULL,
      message TEXT NOT NULL,
      category_id INTEGER REFERENCES academic_categories(id),
      branch_id INTEGER REFERENCES academic_branches(id),
      semester_id INTEGER REFERENCES academic_semesters(id),
      status VARCHAR(30) DEFAULT 'published',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roadmap_milestones (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      roadmap_id INTEGER NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
      title VARCHAR(180) NOT NULL,
      description TEXT,
      sequence_no INTEGER NOT NULL DEFAULT 0,
      is_published BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS career_roadmaps (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      title VARCHAR(200),
      category_id INTEGER REFERENCES academic_categories(id),
      branch_id INTEGER REFERENCES academic_branches(id),
      semester_id INTEGER REFERENCES academic_semesters(id),
      deleted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_tools_catalog (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      title VARCHAR(200),
      category_id INTEGER REFERENCES academic_categories(id),
      branch_id INTEGER REFERENCES academic_branches(id),
      semester_id INTEGER REFERENCES academic_semesters(id),
      deleted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_permissions (
      admin_role VARCHAR(40) PRIMARY KEY,
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      actor_user_id INTEGER REFERENCES users(id),
      actor_role VARCHAR(40),
      action VARCHAR(120) NOT NULL,
      target_type VARCHAR(80),
      target_id VARCHAR(80),
      metadata JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(120) PRIMARY KEY,
      value_json JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_step_config (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      step_key VARCHAR(80) UNIQUE NOT NULL,
      title VARCHAR(180) NOT NULL,
      subtitle TEXT,
      is_enabled BOOLEAN DEFAULT TRUE,
      is_required BOOLEAN DEFAULT TRUE,
      position_order INTEGER DEFAULT 0,
      question_type VARCHAR(40) DEFAULT 'single_select',
      options_json JSONB DEFAULT '[]'::jsonb,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_option_catalog (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      option_group VARCHAR(80) NOT NULL,
      option_value VARCHAR(160) NOT NULL,
      option_label VARCHAR(200) NOT NULL,
      description TEXT,
      is_enabled BOOLEAN DEFAULT TRUE,
      is_default BOOLEAN DEFAULT FALSE,
      position_order INTEGER DEFAULT 0,
      category_id INTEGER REFERENCES academic_categories(id),
      branch_id INTEGER REFERENCES academic_branches(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(option_group, option_value)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS referral_rewards (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      referral_id INTEGER REFERENCES referrals(id),
      user_id INTEGER REFERENCES users(id),
      reward_points INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      assigned_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO admin_permissions (admin_role, permissions)
    VALUES
      ('super_admin', '["*"]'::jsonb),
      ('content_admin', '["content.manage","quizzes.manage","mock_tests.manage","roadmaps.manage","certificates.manage","notifications.manage"]'::jsonb),
      ('payment_admin', '["payments.manage","memberships.manage","reports.view"]'::jsonb),
      ('support_admin', '["feedback.manage","forum.moderate","notifications.manage","students.view"]'::jsonb)
    ON CONFLICT (admin_role) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO platform_settings (key, value_json)
    VALUES
      ('app_branding', '{"appName":"College OS","logo":"","primaryColor":"#2f6fed"}'::jsonb),
      ('feature_toggles', '{"forum":true,"mockTests":true,"roadmaps":true,"referrals":true}'::jsonb),
      ('membership_pricing', '{"monthly":49,"currency":"INR"}'::jsonb),
      ('maintenance_mode', '{"enabled":false,"message":""}'::jsonb),
      ('system_notice', '{"message":""}'::jsonb),
      ('onboarding_wizard_config', '{"enabled":true,"version":1,"steps":["academic_profile","career_interest","learning_goals","dashboard_setup"]}'::jsonb),
      ('student_experience_config', $1::jsonb),
      ('membership_center_config', $2::jsonb)
    ON CONFLICT (key) DO NOTHING
  `, [JSON.stringify(DEFAULT_STUDENT_EXPERIENCE_CONFIG), JSON.stringify(DEFAULT_MEMBERSHIP_CENTER_CONFIG)]);

  await pool.query(`
    INSERT INTO onboarding_step_config (step_key, title, subtitle, is_enabled, is_required, position_order, question_type)
    VALUES
      ('academic_profile', 'Confirm Academic Profile', 'Select category, branch/course and semester.', TRUE, TRUE, 1, 'single_select'),
      ('career_interest', 'Select Career Interest', 'Pick what you want to build towards.', TRUE, TRUE, 2, 'single_select'),
      ('learning_goals', 'Choose Learning Goals', 'Select one or more goals to personalize your dashboard.', TRUE, TRUE, 3, 'multi_select'),
      ('dashboard_setup', 'Finalize Dashboard Setup', 'Configure study mode and immediate learning target.', TRUE, FALSE, 4, 'form')
    ON CONFLICT (step_key) DO NOTHING
  `);

  await pool.query(`
    INSERT INTO onboarding_option_catalog (option_group, option_value, option_label, position_order)
    VALUES
      ('career_interest', 'Software Development', 'Software Development', 1),
      ('career_interest', 'Data Science', 'Data Science', 2),
      ('career_interest', 'AI and ML', 'AI and ML', 3),
      ('career_interest', 'Cloud Computing', 'Cloud Computing', 4),
      ('career_interest', 'Core Engineering', 'Core Engineering', 5),
      ('career_interest', 'Business Analytics', 'Business Analytics', 6),
      ('career_interest', 'Finance', 'Finance', 7),
      ('career_interest', 'Accounting', 'Accounting', 8),
      ('career_interest', 'Placement Preparation', 'Placement Preparation', 9),
      ('learning_goal', 'Improve core subjects', 'Improve core subjects', 1),
      ('learning_goal', 'Prepare for placements', 'Prepare for placements', 2),
      ('learning_goal', 'Build project portfolio', 'Build project portfolio', 3),
      ('learning_goal', 'Prepare for certifications', 'Prepare for certifications', 4),
      ('learning_goal', 'Improve mock test scores', 'Improve mock test scores', 5),
      ('study_mode', 'Self paced', 'Self paced', 1),
      ('study_mode', 'Guided', 'Guided', 2),
      ('study_mode', 'Intensive', 'Intensive', 3),
      ('study_mode', 'Weekend focused', 'Weekend focused', 4)
    ON CONFLICT (option_group, option_value) DO NOTHING
  `);

  await pool.query(`
    UPDATE users u
    SET uid = CONCAT('STU-', LPAD(u.id::text, 6, '0'))
    WHERE uid IS NULL AND u.role = 'student'
  `);

  await pool.query(`
    UPDATE users
    SET admin_role = 'super_admin'
    WHERE role = 'admin' AND admin_role IS NULL
  `);

  adminControlSchemaEnsured = true;
}

async function getCurrentAdminContext(req) {
  const { rows } = await pool.query(
    'SELECT id, role, admin_role FROM users WHERE id = $1',
    [req.session.userId]
  );
  return rows[0] || null;
}

function getContentConfig(type) {
  return CONTENT_MAP[type] || null;
}

router.use(requireAdmin);
router.use(async (_req, _res, next) => {
  try {
    await ensureAdminControlSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/me/permissions', async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const { role, permissions } = await getUserPermissions(req.session.userId);
  const userRes = await pool.query('SELECT id, email, full_name, role, admin_role FROM users WHERE id = $1', [req.session.userId]);
  const user = userRes.rows[0] || null;
  res.json({ role, permissions, user });
});

// Roles & Permissions Governance
router.get('/roles', requirePermission('manage_roles'), async (_req, res) => {
  const rolesRes = await pool.query('SELECT * FROM roles ORDER BY created_at ASC');
  const permMapRes = await pool.query('SELECT role_key, permission_key FROM role_permissions');

  const permMap = {};
  for (const row of permMapRes.rows) {
    if (!permMap[row.role_key]) permMap[row.role_key] = [];
    permMap[row.role_key].push(row.permission_key);
  }

  const roles = rolesRes.rows.map(r => ({
    ...r,
    permissions: permMap[r.key] || (r.key === 'super_admin' ? ['*'] : [])
  }));

  res.json({ roles });
});

router.get('/permissions', requirePermission('manage_roles'), async (_req, res) => {
  const permsRes = await pool.query('SELECT * FROM permissions ORDER BY module ASC, key ASC');
  res.json({ permissions: permsRes.rows });
});

router.post('/roles', requirePermission('manage_roles'), async (req, res) => {
  const key = String(req.body.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  const label = String(req.body.label || '').trim();
  const description = String(req.body.description || '').trim();
  const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : [];

  if (!key || key.length < 3) return res.status(400).json({ error: 'Role key must be at least 3 alphanumeric characters' });
  if (!label) return res.status(400).json({ error: 'Role label is required' });

  const existing = await pool.query('SELECT key FROM roles WHERE key = $1', [key]);
  if (existing.rowCount > 0) return res.status(409).json({ error: 'Role key already exists' });

  await pool.query(
    'INSERT INTO roles (key, label, description, is_system) VALUES ($1, $2, $3, FALSE)',
    [key, label, description]
  );

  for (const permKey of permissions) {
    await pool.query(
      'INSERT INTO role_permissions (role_key, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [key, permKey]
    );
  }

  await pool.query(
    'INSERT INTO admin_permissions (admin_role, permissions) VALUES ($1, $2::jsonb) ON CONFLICT (admin_role) DO UPDATE SET permissions = EXCLUDED.permissions',
    [key, JSON.stringify(permissions)]
  );

  await writeAuditLog(req, 'role.create', 'roles', key, null, { label, description, permissions });

  res.json({ success: true, role: { key, label, description, is_system: false, permissions } });
});

router.put('/roles/:key', requirePermission('manage_roles'), async (req, res) => {
  const roleKey = String(req.params.key || '').trim().toLowerCase();
  const label = String(req.body.label || '').trim();
  const description = String(req.body.description || '').trim();
  const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : [];

  const existingRes = await pool.query('SELECT * FROM roles WHERE key = $1', [roleKey]);
  if (existingRes.rowCount === 0) return res.status(404).json({ error: 'Role not found' });
  const oldRole = existingRes.rows[0];

  const oldPermsRes = await pool.query('SELECT permission_key FROM role_permissions WHERE role_key = $1', [roleKey]);
  const oldPerms = oldPermsRes.rows.map(r => r.permission_key);

  if (oldRole.is_system && roleKey === 'super_admin') {
    if (!permissions.includes('*') && permissions.length < STABLE_PERMISSIONS.length) {
      return res.status(400).json({ error: 'Cannot remove core permissions from Super Admin role.' });
    }
  }

  await pool.query('UPDATE roles SET label = $1, description = $2 WHERE key = $3', [label || oldRole.label, description, roleKey]);

  await pool.query('DELETE FROM role_permissions WHERE role_key = $1', [roleKey]);
  for (const permKey of permissions) {
    if (permKey !== '*') {
      await pool.query('INSERT INTO role_permissions (role_key, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roleKey, permKey]);
    }
  }

  await pool.query(
    'INSERT INTO admin_permissions (admin_role, permissions) VALUES ($1, $2::jsonb) ON CONFLICT (admin_role) DO UPDATE SET permissions = EXCLUDED.permissions',
    [roleKey, JSON.stringify(permissions)]
  );

  await writeAuditLog(req, 'role.update', 'roles', roleKey, { label: oldRole.label, permissions: oldPerms }, { label, description, permissions });

  res.json({ success: true, message: 'Role updated successfully' });
});

router.post('/users/:id/role', requirePermission('manage_roles'), async (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  const newRoleKey = String(req.body.role || req.body.role_key || '').trim().toLowerCase();

  if (!targetUserId || !newRoleKey) return res.status(400).json({ error: 'Target user ID and role key are required' });

  const roleCheck = await pool.query('SELECT key FROM roles WHERE key = $1', [newRoleKey]);
  if (roleCheck.rowCount === 0) return res.status(404).json({ error: 'Role key not found' });

  const userCheck = await pool.query('SELECT id, full_name, email, role, admin_role FROM users WHERE id = $1', [targetUserId]);
  if (userCheck.rowCount === 0) return res.status(404).json({ error: 'User not found' });
  const targetUser = userCheck.rows[0];

  const currentActorId = req.session.userId;
  const currentActorPermissions = await getUserPermissions(currentActorId);

  // Anti-Self Escalation Safeguard: Non-super_admins cannot promote anyone or themselves to super_admin!
  if (newRoleKey === 'super_admin' && currentActorPermissions.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only Super Administrators can assign the Super Admin role.', code: 'PRIVILEGE_ESCALATION_BLOCKED' });
  }

  // Last Super Admin Protection Safeguard
  const oldRoleKey = targetUser.admin_role || targetUser.role;
  if (oldRoleKey === 'super_admin' && newRoleKey !== 'super_admin') {
    const isLast = await isLastSuperAdmin(targetUserId);
    if (isLast) {
      return res.status(400).json({
        error: 'Cannot demote or change the role of the last active Super Admin account.',
        code: 'LAST_SUPER_ADMIN_PROTECTED'
      });
    }
  }

  const primaryRole = ['super_admin', 'admin'].includes(newRoleKey) ? newRoleKey : 'admin';

  await pool.query(
    'UPDATE users SET role = $1, admin_role = $2 WHERE id = $3',
    [primaryRole, newRoleKey, targetUserId]
  );

  await pool.query('DELETE FROM admin_user_roles WHERE user_id = $1', [targetUserId]);
  await pool.query('INSERT INTO admin_user_roles (user_id, role_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [targetUserId, newRoleKey]);

  await writeAuditLog(req, 'user.role_change', 'users', targetUserId, { role: oldRoleKey }, { role: newRoleKey });

  res.json({
    success: true,
    message: `Role for ${targetUser.full_name || targetUser.email} updated to ${newRoleKey}`,
    user: { id: targetUserId, role: primaryRole, admin_role: newRoleKey }
  });
});

// Centralized Audit Logs API
router.get('/audit-logs', requirePermission('view_audit_logs'), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const actorId = toInt(req.query.actorId);
  const action = String(req.query.action || '').trim();
  const entityType = String(req.query.entityType || '').trim();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();

  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(Math.max(1, toInt(req.query.limit, 25)), 100);
  const offset = (page - 1) * limit;

  const clauses = [];
  const params = [];

  if (actorId) {
    params.push(actorId);
    clauses.push(`a.actor_user_id = $${params.length}`);
  }
  if (action) {
    params.push(`%${action}%`);
    clauses.push(`a.action ILIKE $${params.length}`);
  }
  if (entityType) {
    params.push(entityType);
    clauses.push(`a.entity_type = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(a.action ILIKE $${params.length} OR COALESCE(u.full_name, '') ILIKE $${params.length} OR COALESCE(u.email, '') ILIKE $${params.length} OR COALESCE(a.entity_id, '') ILIKE $${params.length})`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`a.created_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    clauses.push(`a.created_at <= $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${where}`,
    params
  );
  const total = countRes.rows[0]?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  params.push(limit, offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const logsRes = await pool.query(
    `SELECT a.id, a.actor_user_id, a.actor_role, a.action, a.entity_type, a.entity_id,
            a.old_values, a.new_values, a.metadata, a.ip_address, a.user_agent, a.created_at,
            u.full_name AS actor_name, u.email AS actor_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  );

  res.json({
    logs: logsRes.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages
    }
  });
});

// Settings & Feature Governance APIs
router.get('/settings', requirePermission('manage_settings'), async (_req, res) => {
  const { rows } = await pool.query('SELECT key, value_json, updated_at FROM platform_settings');
  const settings = {};
  for (const r of rows) {
    settings[r.key] = redactSensitiveFields(r.value_json);
  }
  res.json({ settings });
});

router.put('/settings/:domain', requirePermission('manage_settings'), async (req, res) => {
  const domain = String(req.params.domain || '').trim();
  const valueJson = req.body.value || req.body;

  if (!domain) return res.status(400).json({ error: 'Domain key required' });

  const existing = await pool.query('SELECT value_json FROM platform_settings WHERE key = $1', [domain]);
  const oldVal = existing.rows[0]?.value_json || null;

  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO UPDATE
     SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [domain, JSON.stringify(valueJson), req.session.userId]
  );

  await writeAuditLog(req, 'settings.update', 'platform_settings', domain, oldVal, valueJson);

  res.json({ success: true, message: `Settings for ${domain} updated successfully.` });
});

router.get('/features', requirePermission('manage_features'), async (_req, res) => {
  const { rows } = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'feature_toggles' LIMIT 1");
  const features = rows[0]?.value_json || {};
  res.json({ success: true, features });
});

router.post('/features', requirePermission('manage_features'), async (req, res) => {
  try {
    const featureKey = String(req.body.featureKey || req.body.key || '').trim();
    if (!featureKey) return res.status(400).json({ error: 'featureKey or key is required' });

    const enabled = req.body.enabled !== undefined ? Boolean(req.body.enabled) : (req.body.status !== undefined ? Boolean(req.body.status) : (req.body.value !== undefined ? Boolean(req.body.value) : true));
    const { visibility, access_mode, message } = req.body;

    const INFRASTRUCTURE_TOGGLES = new Set(['authentication', 'authorization', 'csrf', 'security_middleware', 'database_connection']);
    if (INFRASTRUCTURE_TOGGLES.has(featureKey.toLowerCase())) {
      return res.status(400).json({ error: 'Cannot disable core infrastructure features.', code: 'INFRASTRUCTURE_PROTECTED' });
    }

    const existingRes = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'feature_toggles'");
    const currentToggles = existingRes.rows[0]?.value_json || {};
    const oldState = currentToggles[featureKey] || null;

    const updateResult = await updateFeatureStatus(featureKey, { enabled, visibility, access_mode, message }, req.session.userId);

    await writeAuditLog(req, 'feature.toggle', 'feature_toggles', featureKey, { oldState }, { newState: updateResult });

    return res.json({ success: true, featureKey, updated: updateResult });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to update feature toggle' });
  }
});

router.patch('/features/:key', requirePermission('manage_features'), async (req, res) => {
  const featureKey = String(req.params.key || '').trim();
  const { enabled, visibility, access_mode, message } = req.body;

  const INFRASTRUCTURE_TOGGLES = new Set(['authentication', 'authorization', 'csrf', 'security_middleware', 'database_connection']);
  if (INFRASTRUCTURE_TOGGLES.has(featureKey.toLowerCase())) {
    return res.status(400).json({ error: 'Cannot disable core infrastructure features.', code: 'INFRASTRUCTURE_PROTECTED' });
  }

  const existingRes = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'feature_toggles'");
  const currentToggles = existingRes.rows[0]?.value_json || {};
  const oldState = currentToggles[featureKey] || null;

  const updateResult = await updateFeatureStatus(featureKey, { enabled, visibility, access_mode, message }, req.session.userId);

  await writeAuditLog(req, 'feature.toggle', 'feature_toggles', featureKey, { oldState }, { newState: updateResult });

  res.json({ success: true, featureKey, updated: updateResult });
});

// Student Management
// Student Management System APIs
router.get('/students', requirePermission(['view_students', 'students.view'], { mode: 'ANY' }), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const membership = String(req.query.membership || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const collegeId = toInt(req.query.collegeId);
  const courseId = toInt(req.query.courseId);
  const branchId = toInt(req.query.branchId);
  const semesterId = toInt(req.query.semesterId);
  const includeDeleted = toBoolean(req.query.includeDeleted);

  const page = Math.max(1, toInt(req.query.page, 1));
  const limit = Math.min(Math.max(1, toInt(req.query.limit, 20)), 100);
  const offset = (page - 1) * limit;

  const sortBy = String(req.query.sortBy || 'created_at').toLowerCase();
  const sortDir = String(req.query.sortDir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const validSortColumns = {
    created_at: 'u.created_at',
    signup_date: 'u.created_at',
    name: 'u.full_name',
    email: 'u.email',
    last_login: 'u.last_login_at'
  };
  const sortCol = validSortColumns[sortBy] || 'u.created_at';

  const params = [];
  const clauses = ["u.role = 'student'"];

  if (!includeDeleted) {
    clauses.push('u.deleted_at IS NULL');
  }

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR COALESCE(u.uid, '') ILIKE $${params.length})`);
  }

  if (membership === 'free') {
    clauses.push("COALESCE(LOWER(u.subscription_tier), 'free') = 'free'");
  } else if (membership === 'premium' || membership === 'active') {
    clauses.push("LOWER(u.subscription_tier) = 'premium' AND (u.subscription_expiry IS NULL OR u.subscription_expiry > NOW())");
  } else if (membership === 'expired') {
    clauses.push("LOWER(u.subscription_tier) = 'premium' AND u.subscription_expiry <= NOW()");
  }

  if (status === 'blocked') clauses.push('u.is_blocked = TRUE');
  if (status === 'suspended') clauses.push('u.is_suspended = TRUE');
  if (status === 'active') clauses.push('u.is_blocked = FALSE AND u.is_suspended = FALSE');

  if (branchId) {
    params.push(branchId);
    clauses.push(`up.branch_id = $${params.length}`);
  }

  if (semesterId) {
    params.push(semesterId);
    clauses.push(`up.semester_id = $${params.length}`);
  }

  if (collegeId) {
    params.push(collegeId);
    clauses.push(`up.college_id = $${params.length}`);
  }

  if (courseId) {
    params.push(courseId);
    clauses.push(`up.course_id = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT u.id)::int AS total
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     ${where}`,
    params
  );
  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  params.push(limit);
  const limitParamIdx = params.length;
  params.push(offset);
  const offsetParamIdx = params.length;

  const { rows } = await pool.query(
    `SELECT
      u.id, u.uid, u.full_name, u.email, u.role, u.subscription_tier, u.payment_status,
      u.subscription_started_at, u.subscription_expiry, u.last_login_at, u.created_at AS signup_date,
      u.is_suspended, u.is_blocked, u.deleted_at,
      up.category_id, up.branch_id, up.semester_id, up.college_id, up.course_id, up.year_id,
      ac.name AS category_name,
      ab.name AS branch_name,
      asr.label AS semester_label,
      col.name AS college_name
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN academic_categories ac ON ac.id = up.category_id
     LEFT JOIN academic_branches ab ON ab.id = up.branch_id
     LEFT JOIN academic_semesters asr ON asr.id = up.semester_id
     LEFT JOIN academic_colleges col ON col.id = up.college_id
     ${where}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
    params
  );

  const statsResult = await pool.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_blocked = FALSE AND is_suspended = FALSE AND deleted_at IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE is_suspended = TRUE OR is_blocked = TRUE)::int AS suspended,
      COUNT(*) FILTER (WHERE subscription_tier = 'premium' AND (subscription_expiry IS NULL OR subscription_expiry > NOW()))::int AS premium
     FROM users
     WHERE role = 'student' ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`
  );

  res.json({
    students: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages
    },
    stats: statsResult.rows[0] || { total: 0, active: 0, suspended: 0, premium: 0 }
  });
});

router.get('/students/:id', requirePermission('students.view'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  try {
    const safeQuery = async (queryText, params, fallback = []) => {
      try {
        const result = await pool.query(queryText, params);
        return result.rows;
      } catch (_err) {
        return fallback;
      }
    };

    const studentRows = await pool.query(
      `SELECT id, uid, full_name, email, role, subscription_tier, payment_status,
              subscription_started_at, subscription_expiry, last_login_at, created_at AS signup_date,
              is_suspended, is_blocked, deleted_at
       FROM users u
       WHERE id = $1`,
      [studentId]
    );

    if (!studentRows.rows[0] || studentRows.rows[0].role !== 'student') {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = studentRows.rows[0];

    const [
      profiles,
      payments,
      quizzes,
      mocks,
      coding,
      certificates,
      auditHistory
    ] = await Promise.all([
      safeQuery(
        `SELECT up.*, ac.name AS category_name, ab.name AS branch_name, asr.label AS semester_label,
                col.name AS college_name, cou.name AS course_name, yr.label AS year_label
         FROM user_profiles up
         LEFT JOIN academic_categories ac ON ac.id = up.category_id
         LEFT JOIN academic_branches ab ON ab.id = up.branch_id
         LEFT JOIN academic_semesters asr ON asr.id = up.semester_id
         LEFT JOIN academic_colleges col ON col.id = up.college_id
         LEFT JOIN academic_courses cou ON cou.id = up.course_id
         LEFT JOIN academic_years yr ON yr.id = up.year_id
         WHERE up.user_id = $1`,
        [studentId]
      ),
      safeQuery(
        `SELECT id, payment_method, transaction_id, amount_inr, status, submitted_at, approved_at
         FROM membership_payment_requests
         WHERE user_id = $1
         ORDER BY submitted_at DESC
         LIMIT 20`,
        [studentId]
      ),
      safeQuery(
        `SELECT COUNT(*)::int AS attempts, COALESCE(ROUND(AVG(score_percent), 2), 0) AS avg_score
         FROM quiz_attempts
         WHERE user_id = $1`,
        [studentId]
      ),
      safeQuery(
        `SELECT COUNT(*)::int AS attempts, COALESCE(ROUND(AVG(accuracy_percent), 2), 0) AS avg_accuracy
         FROM mock_test_attempts
         WHERE user_id = $1`,
        [studentId]
      ),
      safeQuery(
        `SELECT
          (SELECT COUNT(*)::int FROM coding_submissions WHERE user_id = $1) AS total_submissions,
          (SELECT COUNT(DISTINCT problem_id)::int FROM coding_submissions WHERE user_id = $1 AND status = 'ACCEPTED') AS solved_problems`,
        [studentId]
      ),
      safeQuery(
        `SELECT id, COALESCE(verification_code, id::text) AS certificate_code, COALESCE(type, 'Certificate of Completion') AS title, COALESCE(status, 'active') AS status, COALESCE(issued_date, created_at) AS issued_at
         FROM certificates
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [studentId]
      ),
      safeQuery(
        `SELECT id, actor_role, action, target_type, target_id, metadata, created_at
         FROM admin_audit_logs
         WHERE target_id = $1 OR metadata->>'userId' = $1
         ORDER BY created_at DESC
         LIMIT 30`,
        [String(studentId)]
      )
    ]);

    const { getEffectiveFeatureMatrix } = require('../middleware/featureToggle');
    const effectiveFeatures = await getEffectiveFeatureMatrix({
      userId: student.id,
      role: student.role,
      isPaidMember: student.subscription_tier === 'premium' && (!student.subscription_expiry || new Date(student.subscription_expiry) > new Date())
    });

    res.json({
      student,
      profile: profiles[0] || null,
      payments,
      academicActivity: {
        quizzes: quizzes[0] || { attempts: 0, avg_score: 0 },
        mockTests: mocks[0] || { attempts: 0, avg_accuracy: 0 }
      },
      codingActivity: coding[0] || { total_submissions: 0, solved_problems: 0 },
      certificates,
      auditHistory,
      effectiveFeatures
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch student details' });
  }
});

router.put('/students/:id', requirePermission('students.manage'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  const {
    fullName,
    email,
    collegeName,
    uid,
    collegeId,
    courseId,
    yearId,
    categoryId,
    branchId,
    semesterId,
    targetExam,
    courseBranch,
    semester
  } = req.body;

  await pool.query(
    `UPDATE users
     SET full_name = COALESCE($1, full_name),
         email = COALESCE($2, email),
         college_name = COALESCE($3, college_name),
         uid = COALESCE($4, uid)
     WHERE id = $5 AND role = 'student'`,
    [fullName || null, email ? String(email).toLowerCase() : null, collegeName || null, uid || null, studentId]
  );

  await pool.query(
    `INSERT INTO user_profiles (user_id, category_id, branch_id, semester_id, college_id, course_id, year_id, target_exam, course_branch, semester, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id)
     DO UPDATE SET
       category_id = COALESCE(EXCLUDED.category_id, user_profiles.category_id),
       branch_id = COALESCE(EXCLUDED.branch_id, user_profiles.branch_id),
       semester_id = COALESCE(EXCLUDED.semester_id, user_profiles.semester_id),
       college_id = COALESCE(EXCLUDED.college_id, user_profiles.college_id),
       course_id = COALESCE(EXCLUDED.course_id, user_profiles.course_id),
       year_id = COALESCE(EXCLUDED.year_id, user_profiles.year_id),
       target_exam = COALESCE(EXCLUDED.target_exam, user_profiles.target_exam),
       course_branch = COALESCE(EXCLUDED.course_branch, user_profiles.course_branch),
       semester = COALESCE(EXCLUDED.semester, user_profiles.semester),
       updated_at = CURRENT_TIMESTAMP`,
    [
      studentId,
      toInt(categoryId),
      toInt(branchId),
      toInt(semesterId),
      toInt(collegeId),
      toInt(courseId),
      toInt(yearId),
      targetExam || null,
      courseBranch || null,
      semester || null
    ]
  );

  await writeAuditLog(req, 'student.update', 'student', studentId, req.body);
  publishContentChanged('students', 'updated', studentId, { userId: studentId });
  res.json({ message: 'Student profile updated successfully' });
});

router.post('/students/:id/reset-password', requirePermission('students.manage'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  const newPassword = String(req.body.newPassword || '').trim();
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'newPassword with minimum 6 characters is required' });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2 AND role = 'student'", [hash, studentId]);

  // Invalidate any active session store entries for this student
  try {
    await pool.query(
      `DELETE FROM session WHERE sess::text ILIKE $1`,
      [`%\"userId\":${studentId}%`]
    );
  } catch (_e) {
    // best-effort
  }

  await writeAuditLog(req, 'student.reset_password', 'student', studentId);
  publishContentChanged('student', 'updated', studentId, { userId: studentId, kind: 'password_reset' });
  res.json({ message: 'Student password reset successfully' });
});

router.post('/students/:id/status', requirePermission(['manage_students', 'students.manage'], { mode: 'ANY' }), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  const rawInput = String(req.body.status || req.body.action || '').toLowerCase();
  const status = rawInput === 'suspend' ? 'suspended' : (rawInput === 'block' ? 'blocked' : (['restore', 'unsuspend', 'un-suspend', 'unblock', 'un-block'].includes(rawInput) ? 'active' : rawInput));
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });
  if (!['active', 'suspended', 'blocked'].includes(status)) {
    return res.status(400).json({ error: 'status must be active, suspended, or blocked' });
  }

  const isSuspended = status === 'suspended';
  const isBlocked = status === 'blocked';

  await pool.query(
    `UPDATE users
     SET is_suspended = $1,
         is_blocked = $2
     WHERE id = $3 AND role = 'student'`,
    [isSuspended, isBlocked, studentId]
  );

  // When student becomes suspended or blocked, purge active backend session
  if (isSuspended || isBlocked) {
    try {
      await pool.query(
        `DELETE FROM session WHERE sess::text ILIKE $1`,
        [`%\"userId\":${studentId}%`]
      );
    } catch (_e) {
      // best-effort
    }
  }

  await writeAuditLog(req, 'student.status_change', 'student', studentId, { status });
  publishContentChanged('students', 'updated', studentId, { userId: studentId, status });
  res.json({ message: `Student status updated to ${status}` });
});

router.post('/students/:id/membership/grant', requirePermission('memberships.manage'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  const tier = String(req.body.tier || 'premium').toLowerCase();
  const durationDays = Math.max(1, toInt(req.body.durationDays, 30));
  const reason = String(req.body.reason || 'Admin Granted Membership').trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const expiryDate = new Date(Date.now() + (durationDays * 24 * 60 * 60 * 1000));
    await client.query(
      `UPDATE users
       SET subscription_tier = $1,
           payment_status = 'approved',
           subscription_started_at = NOW(),
           subscription_expiry = $2
       WHERE id = $3 AND role = 'student'`,
      [tier, expiryDate, studentId]
    );

    await writeAuditLog(req, 'student.membership.grant', 'student', studentId, {
      tier,
      durationDays,
      expiryDate,
      reason
    });

    await client.query('COMMIT');

    publishContentChanged('membership', 'updated', studentId, { userId: studentId, tier, expiryDate });
    res.json({ message: `Granted ${tier} membership for ${durationDays} days`, expiryDate });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message || 'Failed to grant membership' });
  } finally {
    client.release();
  }
});

router.post('/students/:id/membership/extend', requirePermission('memberships.manage'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  const days = Math.max(1, toInt(req.body.days, 30));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      'SELECT subscription_expiry FROM users WHERE id = $1 AND role = \'student\'',
      [studentId]
    );
    const currentExpiry = currentResult.rows[0]?.subscription_expiry
      ? new Date(currentResult.rows[0].subscription_expiry)
      : new Date();

    const baseDate = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(baseDate.getTime() + (days * 24 * 60 * 60 * 1000));

    await client.query(
      `UPDATE users
       SET subscription_tier = 'premium',
           payment_status = 'approved',
           subscription_expiry = $1
       WHERE id = $2 AND role = 'student'`,
      [newExpiry, studentId]
    );

    await writeAuditLog(req, 'student.membership.extend', 'student', studentId, {
      daysExtended: days,
      newExpiry
    });

    await client.query('COMMIT');

    publishContentChanged('membership', 'updated', studentId, { userId: studentId, newExpiry });
    res.json({ message: `Membership extended by ${days} days`, newExpiry });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message || 'Failed to extend membership' });
  } finally {
    client.release();
  }
});

router.post('/students/:id/membership/revoke', requirePermission('memberships.manage'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  const reason = String(req.body.reason || 'Admin Revoked Membership').trim();

  await pool.query(
    `UPDATE users
     SET subscription_tier = 'free',
         payment_status = 'expired',
         subscription_expiry = NOW()
     WHERE id = $1 AND role = 'student'`,
    [studentId]
  );

  await writeAuditLog(req, 'student.membership.revoke', 'student', studentId, { reason });
  publishContentChanged('membership', 'updated', studentId, { userId: studentId, revoked: true });
  res.json({ message: 'Student membership revoked successfully' });
});

router.put('/students/:id/membership', requirePermission('memberships.manage'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  const tier = String(req.body.tier || 'free').toLowerCase();
  const paymentStatus = String(req.body.paymentStatus || (tier === 'premium' ? 'approved' : 'free')).toLowerCase();
  const expiryDate = req.body.expiryDate || null;

  await pool.query(
    `UPDATE users
     SET subscription_tier = $1,
         payment_status = $2,
         subscription_started_at = CASE WHEN $1 = 'premium' THEN COALESCE(subscription_started_at, NOW()) ELSE NULL END,
         subscription_expiry = CASE WHEN $1 = 'premium' THEN COALESCE($3::timestamp, NOW() + INTERVAL '30 days') ELSE NULL END
     WHERE id = $4 AND role = 'student'`,
    [tier, paymentStatus, expiryDate, studentId]
  );

  await writeAuditLog(req, 'student.membership_change', 'student', studentId, { tier, paymentStatus, expiryDate });
  publishContentChanged('membership', 'updated', studentId, { userId: studentId, tier, paymentStatus, expiryDate });
  res.json({ message: 'Student membership updated successfully' });
});

router.delete('/students/:id', requirePermission('students.delete'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  await pool.query(
    `UPDATE users
     SET deleted_at = NOW(), deleted_by = $1
     WHERE id = $2 AND role = 'student'`,
    [req.session.userId, studentId]
  );

  await writeAuditLog(req, 'student.soft_delete', 'student', studentId);
  publishContentChanged('students', 'updated', studentId, { userId: studentId, deleted: true });
  res.json({ message: 'Student deleted (soft delete) successfully' });
});

router.post('/students/:id/restore', requirePermission('students.restore'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  await pool.query(
    "UPDATE users SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND role = 'student'",
    [studentId]
  );

  await writeAuditLog(req, 'student.restore', 'student', studentId);
  publishContentChanged('students', 'updated', studentId, { userId: studentId, restored: true });
  res.json({ message: 'Student restored successfully' });
});

router.post('/students/bulk-action', requirePermission('students.manage'), async (req, res) => {
  const action = String(req.body.action || '').toLowerCase();
  const studentIds = Array.isArray(req.body.studentIds) ? req.body.studentIds.map((id) => toInt(id)).filter(Boolean) : [];

  if (!studentIds.length) return res.status(400).json({ error: 'studentIds array is required' });

  let query = null;
  if (action === 'suspend') {
    query = "UPDATE users SET is_suspended = TRUE, is_blocked = FALSE WHERE id = ANY($1::int[]) AND role = 'student'";
  } else if (action === 'block') {
    query = "UPDATE users SET is_blocked = TRUE, is_suspended = FALSE WHERE id = ANY($1::int[]) AND role = 'student'";
  } else if (action === 'activate') {
    query = "UPDATE users SET is_blocked = FALSE, is_suspended = FALSE WHERE id = ANY($1::int[]) AND role = 'student'";
  } else if (action === 'delete') {
    query = "UPDATE users SET deleted_at = NOW(), deleted_by = $2 WHERE id = ANY($1::int[]) AND role = 'student'";
  } else {
    return res.status(400).json({ error: 'Unsupported bulk action' });
  }

  if (action === 'delete') {
    await pool.query(query, [studentIds, req.session.userId]);
  } else {
    await pool.query(query, [studentIds]);
  }

  await writeAuditLog(req, 'student.bulk_action', 'student', 'bulk', { action, studentIds });
  publishContentChanged('students', 'updated', 'bulk', { userIds: studentIds, action });
  res.json({ message: `Bulk action '${action}' completed`, count: studentIds.length });
});

// Membership and Payment Management
router.post('/payments/bulk-status', requirePermission('payments.manage'), async (req, res) => {
  const paymentIds = Array.isArray(req.body.paymentIds) ? req.body.paymentIds.map((id) => toInt(id)).filter(Boolean) : [];
  const status = String(req.body.status || '').toLowerCase();
  if (!paymentIds.length || !['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'paymentIds array and valid status are required' });
  }

  await pool.query(
    `UPDATE membership_payment_requests
     SET status = $1,
         approved_by = CASE WHEN $1 = 'approved' THEN $2 ELSE approved_by END,
         approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END,
         updated_at = NOW()
     WHERE id = ANY($3::int[])`,
    [status, req.session.userId, paymentIds]
  );

  if (status === 'approved') {
    const cfg = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'membership_center_config' LIMIT 1");
    const durationDays = Number(cfg.rows[0]?.value_json?.plans?.premium?.durationDays || 30);

    await pool.query(
      `UPDATE users u
       SET subscription_tier = 'premium',
           payment_status = 'approved',
           subscription_started_at = NOW(),
           subscription_expiry = NOW() + ($2::int * INTERVAL '1 day')
       FROM membership_payment_requests m
       WHERE m.id = ANY($1::int[]) AND m.user_id = u.id`,
      [paymentIds, durationDays]
    );
  }

  await writeAuditLog(req, 'payment.bulk_status', 'membership_payment_requests', 'bulk', { paymentIds, status });
  publishContentChanged('membership', 'updated', 'bulk', { paymentIds, status });
  res.json({ message: 'Bulk payment status update completed', count: paymentIds.length });
});

router.post('/payments/deactivate-expired', requirePermission('memberships.manage'), async (req, res) => {
  const result = await pool.query(
    `UPDATE users
     SET subscription_tier = 'free', payment_status = 'expired'
     WHERE role = 'student'
       AND subscription_tier = 'premium'
       AND subscription_expiry IS NOT NULL
       AND subscription_expiry < NOW()`
  );

  await writeAuditLog(req, 'membership.deactivate_expired', 'users', 'bulk', { affected: result.rowCount });
  publishContentChanged('membership', 'updated', 'bulk', { affected: result.rowCount, status: 'expired' });
  res.json({ message: 'Expired premium memberships deactivated', affected: result.rowCount });
});

router.get('/payments/revenue-summary', requirePermission('reports.view'), async (_req, res) => {
  const [monthly, total, pending, active, expired] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(amount_inr), 0)::numeric(10,2) AS amount FROM membership_payment_requests WHERE status = 'approved' AND approved_at >= DATE_TRUNC('month', NOW())`),
    pool.query(`SELECT COALESCE(SUM(amount_inr), 0)::numeric(10,2) AS amount FROM membership_payment_requests WHERE status = 'approved'`),
    pool.query(`SELECT COUNT(*)::int AS pending FROM membership_payment_requests WHERE status = 'pending'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'student' AND subscription_tier = 'premium' AND payment_status = 'approved'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'student' AND payment_status = 'expired'`)
  ]);

  res.json({
    monthlyRevenue: Number(monthly.rows[0].amount),
    lifetimeRevenue: Number(total.rows[0].amount),
    pendingApprovals: Number(pending.rows[0].pending),
    activeMemberships: Number(active.rows[0].count),
    expiredMemberships: Number(expired.rows[0].count)
  });
});

// Content and Bulk Operations
router.get('/content/overview', requirePermission('content.manage'), async (_req, res) => {
  const [notes, materials, papers, quizzes, mockTests, roadmaps, notifications, announcements] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'published')::int AS published FROM notes WHERE deleted_at IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'published')::int AS published FROM materials WHERE deleted_at IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'published')::int AS published FROM previous_papers WHERE deleted_at IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'published')::int AS published FROM quizzes WHERE deleted_at IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'published')::int AS published FROM mock_tests WHERE deleted_at IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_published = TRUE)::int AS published FROM roadmaps WHERE deleted_at IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'published')::int AS published FROM notifications WHERE deleted_at IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'published')::int AS published FROM announcements WHERE deleted_at IS NULL`)
  ]);

  res.json({
    notes: notes.rows[0],
    materials: materials.rows[0],
    papers: papers.rows[0],
    quizzes: quizzes.rows[0],
    mockTests: mockTests.rows[0],
    roadmaps: roadmaps.rows[0],
    notifications: notifications.rows[0],
    announcements: announcements.rows[0]
  });
});

router.get('/branches', requirePermission('content.manage'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
      ab.id,
      ab.category_id,
      ab.code,
      ab.name,
      ab.label,
      ab.description,
      ab.display_order,
      ac.name AS category_name,
      COALESCE(st.students, 0)::int AS students_count,
      COALESCE(ct.notes_count, 0)::int AS notes_count,
      COALESCE(ct.quizzes_count, 0)::int AS quizzes_count,
      COALESCE(ct.mock_tests_count, 0)::int AS mock_tests_count,
      COALESCE(ct.roadmaps_count, 0)::int AS roadmaps_count,
      COALESCE(ct.ai_tools_count, 0)::int AS ai_tools_count
     FROM academic_branches ab
     JOIN academic_categories ac ON ac.id = ab.category_id
     LEFT JOIN (
       SELECT branch_id, COUNT(*)::int AS students
       FROM user_profiles
       WHERE branch_id IS NOT NULL
       GROUP BY branch_id
     ) st ON st.branch_id = ab.id
     LEFT JOIN (
       SELECT
         b.id AS branch_id,
         COUNT(DISTINCT n.id) FILTER (WHERE n.deleted_at IS NULL) AS notes_count,
         COUNT(DISTINCT q.id) FILTER (WHERE q.deleted_at IS NULL) AS quizzes_count,
         COUNT(DISTINCT mt.id) FILTER (WHERE mt.deleted_at IS NULL) AS mock_tests_count,
         COUNT(DISTINCT r.id) FILTER (WHERE r.deleted_at IS NULL) AS roadmaps_count,
         COUNT(DISTINCT t.id) FILTER (WHERE t.deleted_at IS NULL) AS ai_tools_count
       FROM academic_branches b
       LEFT JOIN notes n ON n.branch_id = b.id
       LEFT JOIN quizzes q ON q.branch_id = b.id
       LEFT JOIN mock_tests mt ON mt.branch_id = b.id
       LEFT JOIN career_roadmaps r ON r.branch_id = b.id
       LEFT JOIN ai_tools_catalog t ON t.branch_id = b.id
       GROUP BY b.id
     ) ct ON ct.branch_id = ab.id
     ORDER BY ac.display_order ASC, ab.display_order ASC, ab.name ASC`
  );

  res.json({ branches: rows });
});

router.get('/universities', requirePermission('settings.manage'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const includeDisabled = toBoolean(req.query.includeDisabled);
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 10), 500);

  const params = [];
  const clauses = [];
  if (!includeDisabled) clauses.push('u.is_enabled = TRUE');
  if (q) {
    params.push(`%${q}%`);
    clauses.push(`(u.name ILIKE $${params.length} OR COALESCE(u.campus, '') ILIKE $${params.length} OR COALESCE(u.city, '') ILIKE $${params.length})`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.country_code, u.state, u.city, u.campus, u.is_featured, u.is_enabled, u.priority_rank,
            COUNT(users.id)::int AS users_count
     FROM universities u
     LEFT JOIN users ON users.university_id = u.id
     ${where}
     GROUP BY u.id
     ORDER BY u.is_featured DESC, u.priority_rank ASC, u.name ASC
     LIMIT $${params.length}`,
    params
  );

  res.json({ universities: rows });
});

router.post('/universities', requirePermission('settings.manage'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'University name is required' });

  const result = await pool.query(
    `INSERT INTO universities (name, country_code, state, city, campus, is_featured, is_enabled, priority_rank, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
     RETURNING id, name, country_code, state, city, campus, is_featured, is_enabled, priority_rank`,
    [
      name,
      String(req.body.countryCode || 'IN').trim().toUpperCase(),
      req.body.state ? String(req.body.state).trim() : null,
      req.body.city ? String(req.body.city).trim() : null,
      req.body.campus ? String(req.body.campus).trim() : null,
      toBoolean(req.body.isFeatured),
      req.body.isEnabled === undefined ? true : toBoolean(req.body.isEnabled),
      toInt(req.body.priorityRank, 999),
      req.session.userId
    ]
  );

  await writeAuditLog(req, 'university.create', 'university', result.rows[0].id, req.body);
  if (typeof invalidateUniversityCatalogCache === 'function') invalidateUniversityCatalogCache();
  res.status(201).json({ university: result.rows[0] });
});

router.put('/universities/:id', requirePermission('settings.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid university id' });

  const result = await pool.query(
    `UPDATE universities
     SET name = COALESCE($1, name),
         country_code = COALESCE($2, country_code),
         state = COALESCE($3, state),
         city = COALESCE($4, city),
         campus = COALESCE($5, campus),
         is_featured = COALESCE($6, is_featured),
         is_enabled = COALESCE($7, is_enabled),
         priority_rank = COALESCE($8, priority_rank),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $9
     RETURNING id, name, country_code, state, city, campus, is_featured, is_enabled, priority_rank`,
    [
      req.body.name ? String(req.body.name).trim() : null,
      req.body.countryCode ? String(req.body.countryCode).trim().toUpperCase() : null,
      req.body.state === undefined ? null : String(req.body.state).trim(),
      req.body.city === undefined ? null : String(req.body.city).trim(),
      req.body.campus === undefined ? null : String(req.body.campus).trim(),
      req.body.isFeatured === undefined ? null : toBoolean(req.body.isFeatured),
      req.body.isEnabled === undefined ? null : toBoolean(req.body.isEnabled),
      req.body.priorityRank === undefined ? null : toInt(req.body.priorityRank, null),
      id
    ]
  );

  if (!result.rows[0]) return res.status(404).json({ error: 'University not found' });

  await pool.query(
    `UPDATE users
     SET university_name = $1,
         college_name = $1
     WHERE university_id = $2`,
    [result.rows[0].name, id]
  );

  await writeAuditLog(req, 'university.update', 'university', id, req.body);
  if (typeof invalidateUniversityCatalogCache === 'function') invalidateUniversityCatalogCache();
  res.json({ university: result.rows[0] });
});

router.post('/universities/reorder', requirePermission('settings.manage'), async (req, res) => {
  const orderedIds = Array.isArray(req.body.orderedIds) ? req.body.orderedIds.map((id) => toInt(id)).filter(Boolean) : [];
  if (!orderedIds.length) return res.status(400).json({ error: 'orderedIds is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let rank = 1;
    for (const id of orderedIds) {
      await client.query('UPDATE universities SET priority_rank = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [rank, id]);
      rank += 1;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog(req, 'university.reorder', 'university', 'bulk', { orderedIds });
  if (typeof invalidateUniversityCatalogCache === 'function') invalidateUniversityCatalogCache();
  res.json({ message: 'University priority order updated', orderedIds });
});

router.delete('/universities/:id', requirePermission('settings.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid university id' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const info = await client.query('SELECT id, name FROM universities WHERE id = $1', [id]);
    if (!info.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'University not found' });
    }

    await client.query(
      `UPDATE users
       SET university_id = NULL,
           custom_university = COALESCE(custom_university, university_name)
       WHERE university_id = $1`,
      [id]
    );

    await client.query('DELETE FROM universities WHERE id = $1', [id]);
    await client.query('COMMIT');

    await writeAuditLog(req, 'university.delete', 'university', id, { name: info.rows[0].name });
    if (typeof invalidateUniversityCatalogCache === 'function') invalidateUniversityCatalogCache();
    return res.json({ message: 'University deleted', id });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.post('/branches', requirePermission('content.manage'), async (req, res) => {
  const {
    categoryId,
    code,
    name,
    label,
    description,
    displayOrder
  } = req.body;

  if (!toInt(categoryId) || !String(code || '').trim() || !String(name || '').trim()) {
    return res.status(400).json({ error: 'categoryId, code, and name are required' });
  }

  const result = await pool.query(
    `INSERT INTO academic_branches (category_id, code, name, label, description, display_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, category_id, code, name, label, description, display_order`,
    [
      toInt(categoryId),
      String(code).trim().toUpperCase(),
      String(name).trim(),
      label || null,
      description || null,
      toInt(displayOrder, 0)
    ]
  );

  await writeAuditLog(req, 'branch.create', 'academic_branch', result.rows[0].id, req.body);
  res.status(201).json({ branch: result.rows[0] });
});

router.put('/branches/:id', requirePermission('content.manage'), async (req, res) => {
  const branchId = toInt(req.params.id, -1);
  if (branchId < 1) return res.status(400).json({ error: 'Invalid branch id' });

  const {
    categoryId,
    code,
    name,
    label,
    description,
    displayOrder
  } = req.body;

  const result = await pool.query(
    `UPDATE academic_branches
     SET category_id = COALESCE($1, category_id),
         code = COALESCE($2, code),
         name = COALESCE($3, name),
         label = COALESCE($4, label),
         description = COALESCE($5, description),
         display_order = COALESCE($6, display_order)
     WHERE id = $7
     RETURNING id, category_id, code, name, label, description, display_order`,
    [
      toInt(categoryId),
      code ? String(code).trim().toUpperCase() : null,
      name ? String(name).trim() : null,
      label || null,
      description || null,
      toInt(displayOrder),
      branchId
    ]
  );

  if (!result.rows[0]) return res.status(404).json({ error: 'Branch not found' });

  await writeAuditLog(req, 'branch.update', 'academic_branch', branchId, req.body);
  res.json({ branch: result.rows[0] });
});

router.delete('/branches/:id', requirePermission('content.manage'), async (req, res) => {
  const branchId = toInt(req.params.id, -1);
  if (branchId < 1) return res.status(400).json({ error: 'Invalid branch id' });

  const usage = await pool.query(
    `SELECT
      (SELECT COUNT(*)::int FROM user_profiles WHERE branch_id = $1) AS students,
      (SELECT COUNT(*)::int FROM notes WHERE branch_id = $1 AND deleted_at IS NULL) AS notes,
      (SELECT COUNT(*)::int FROM quizzes WHERE branch_id = $1 AND deleted_at IS NULL) AS quizzes,
      (SELECT COUNT(*)::int FROM mock_tests WHERE branch_id = $1 AND deleted_at IS NULL) AS mock_tests,
      (SELECT COUNT(*)::int FROM career_roadmaps WHERE branch_id = $1 AND deleted_at IS NULL) AS roadmaps,
      (SELECT COUNT(*)::int FROM ai_tools_catalog WHERE branch_id = $1 AND deleted_at IS NULL) AS ai_tools`,
    [branchId]
  );

  const stats = usage.rows[0] || {};
  const totalUsage = Number(stats.students || 0) + Number(stats.notes || 0) + Number(stats.quizzes || 0) + Number(stats.mock_tests || 0) + Number(stats.roadmaps || 0) + Number(stats.ai_tools || 0);
  if (totalUsage > 0) {
    return res.status(409).json({ error: 'Branch is in use. Reassign content/students before deleting.', usage: stats });
  }

  const removed = await pool.query('DELETE FROM academic_branches WHERE id = $1 RETURNING id', [branchId]);
  if (!removed.rows[0]) return res.status(404).json({ error: 'Branch not found' });

  await writeAuditLog(req, 'branch.delete', 'academic_branch', branchId);
  res.json({ message: 'Branch deleted successfully', id: branchId });
});

router.post('/branches/assign', requirePermission('content.manage'), async (req, res) => {
  const contentType = String(req.body.contentType || '').toLowerCase();
  const contentId = toInt(req.body.contentId, -1);
  const branchId = toInt(req.body.branchId);
  const categoryId = toInt(req.body.categoryId);
  const semesterId = toInt(req.body.semesterId);

  if (contentId < 1 || !branchId) {
    return res.status(400).json({ error: 'contentId and branchId are required' });
  }

  const contentMap = {
    notes: 'notes',
    quizzes: 'quizzes',
    mock_tests: 'mock_tests',
    roadmaps: 'career_roadmaps',
    ai_tools: 'ai_tools_catalog'
  };

  const table = contentMap[contentType];
  if (!table) {
    return res.status(400).json({ error: 'Unsupported contentType. Use notes/quizzes/mock_tests/roadmaps/ai_tools' });
  }

  await pool.query(
    `UPDATE ${table}
     SET branch_id = $1,
         category_id = COALESCE($2, category_id),
         semester_id = COALESCE($3, semester_id)
     WHERE id = $4`,
    [branchId, categoryId, semesterId, contentId]
  );

  await writeAuditLog(req, 'branch.assignment.update', table, contentId, { branchId, categoryId, semesterId });
  res.json({ message: 'Content assignment updated successfully' });
});

router.get('/academic/categories', requirePermission('content.manage'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, code, name, label, description, display_order, is_active
     FROM academic_categories
     ORDER BY display_order ASC, name ASC`
  );
  res.json({ categories: rows });
});

router.post('/academic/categories', requirePermission('content.manage'), async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const name = String(req.body.name || '').trim();
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });

  const result = await pool.query(
    `INSERT INTO academic_categories (code, name, label, description, display_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, code, name, label, description, display_order, is_active`,
    [code, name, req.body.label || null, req.body.description || null, toInt(req.body.displayOrder, 0), typeof req.body.isActive === 'undefined' ? true : toBoolean(req.body.isActive)]
  );

  await writeAuditLog(req, 'academic_category.create', 'academic_category', result.rows[0].id, req.body);
  res.status(201).json({ category: result.rows[0] });
});

router.put('/academic/categories/:id', requirePermission('content.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid category id' });

  const result = await pool.query(
    `UPDATE academic_categories
     SET code = COALESCE($1, code),
         name = COALESCE($2, name),
         label = COALESCE($3, label),
         description = COALESCE($4, description),
         display_order = COALESCE($5, display_order),
         is_active = COALESCE($6, is_active)
     WHERE id = $7
     RETURNING id, code, name, label, description, display_order, is_active`,
    [
      req.body.code ? String(req.body.code).trim().toUpperCase() : null,
      req.body.name ? String(req.body.name).trim() : null,
      req.body.label || null,
      req.body.description || null,
      toInt(req.body.displayOrder),
      typeof req.body.isActive === 'undefined' ? null : toBoolean(req.body.isActive),
      id
    ]
  );

  if (!result.rows[0]) return res.status(404).json({ error: 'Category not found' });
  await writeAuditLog(req, 'academic_category.update', 'academic_category', id, req.body);
  res.json({ category: result.rows[0] });
});

router.get('/academic/semesters', requirePermission('content.manage'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, semester_number, year_number, label, description, display_order, is_active
     FROM academic_semesters
     ORDER BY display_order ASC, semester_number ASC`
  );
  res.json({ semesters: rows });
});

router.post('/academic/semesters', requirePermission('content.manage'), async (req, res) => {
  const result = await pool.query(
    `INSERT INTO academic_semesters (semester_number, year_number, label, description, display_order, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, semester_number, year_number, label, description, display_order, is_active`,
    [
      toInt(req.body.semesterNumber),
      toInt(req.body.yearNumber),
      req.body.label || null,
      req.body.description || null,
      toInt(req.body.displayOrder, 0),
      typeof req.body.isActive === 'undefined' ? true : toBoolean(req.body.isActive)
    ]
  );

  await writeAuditLog(req, 'academic_semester.create', 'academic_semester', result.rows[0].id, req.body);
  res.status(201).json({ semester: result.rows[0] });
});

router.put('/academic/semesters/:id', requirePermission('content.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid semester id' });

  const result = await pool.query(
    `UPDATE academic_semesters
     SET semester_number = COALESCE($1, semester_number),
         year_number = COALESCE($2, year_number),
         label = COALESCE($3, label),
         description = COALESCE($4, description),
         display_order = COALESCE($5, display_order),
         is_active = COALESCE($6, is_active)
     WHERE id = $7
     RETURNING id, semester_number, year_number, label, description, display_order, is_active`,
    [
      toInt(req.body.semesterNumber),
      toInt(req.body.yearNumber),
      req.body.label || null,
      req.body.description || null,
      toInt(req.body.displayOrder),
      typeof req.body.isActive === 'undefined' ? null : toBoolean(req.body.isActive),
      id
    ]
  );

  if (!result.rows[0]) return res.status(404).json({ error: 'Semester not found' });
  await writeAuditLog(req, 'academic_semester.update', 'academic_semester', id, req.body);
  res.json({ semester: result.rows[0] });
});

router.get('/onboarding/config', requirePermission('settings.manage'), async (_req, res) => {
  const [wizard, steps, options] = await Promise.all([
    pool.query(`SELECT value_json FROM platform_settings WHERE key = 'onboarding_wizard_config'`),
    pool.query(`
      SELECT id, step_key, title, subtitle, is_enabled, is_required, position_order, question_type, COALESCE(options_json, '[]'::jsonb) AS options_json
      FROM onboarding_step_config
      ORDER BY position_order ASC
    `),
    pool.query(`
      SELECT id, option_group, option_value, option_label, description, is_enabled, is_default, position_order, category_id, branch_id
      FROM onboarding_option_catalog
      ORDER BY option_group ASC, position_order ASC, option_label ASC
    `)
  ]);

  res.json({
    wizard: wizard.rows[0]?.value_json || { enabled: true, version: 1, steps: [] },
    steps: steps.rows,
    options: options.rows
  });
});

router.put('/onboarding/config', requirePermission('settings.manage'), async (req, res) => {
  const payload = req.body || {};
  const wizard = payload.wizard && typeof payload.wizard === 'object' ? payload.wizard : { enabled: true, version: 1, steps: [] };

  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ('onboarding_wizard_config', $1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(wizard), req.session.userId]
  );

  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  for (const step of steps) {
    const key = String(step.stepKey || step.step_key || '').trim();
    if (!key) continue;
    await pool.query(
      `UPDATE onboarding_step_config
       SET title = COALESCE($1, title),
           subtitle = COALESCE($2, subtitle),
           is_enabled = COALESCE($3, is_enabled),
           is_required = COALESCE($4, is_required),
           position_order = COALESCE($5, position_order),
           question_type = COALESCE($6, question_type),
           options_json = COALESCE($7::jsonb, options_json),
           updated_by = $8,
           updated_at = CURRENT_TIMESTAMP
       WHERE step_key = $9`,
      [
        step.title || null,
        step.subtitle || null,
        typeof step.isEnabled === 'undefined' ? null : toBoolean(step.isEnabled),
        typeof step.isRequired === 'undefined' ? null : toBoolean(step.isRequired),
        toInt(step.positionOrder),
        step.questionType || null,
        Array.isArray(step.options) ? JSON.stringify(step.options) : null,
        req.session.userId,
        key
      ]
    );
  }

  await writeAuditLog(req, 'onboarding.config.update', 'platform_settings', 'onboarding_wizard_config', { stepCount: steps.length });
  res.json({ message: 'Onboarding configuration updated successfully' });
});

router.get('/onboarding/options', requirePermission('settings.manage'), async (req, res) => {
  const group = String(req.query.group || '').trim();
  const params = [];
  const where = [];

  if (group) {
    params.push(group);
    where.push(`option_group = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, option_group, option_value, option_label, description, is_enabled, is_default, position_order, category_id, branch_id
     FROM onboarding_option_catalog
     ${whereSql}
     ORDER BY option_group ASC, position_order ASC, option_label ASC`,
    params
  );

  res.json({ options: rows });
});

router.post('/onboarding/options', requirePermission('settings.manage'), async (req, res) => {
  const group = String(req.body.optionGroup || req.body.option_group || '').trim();
  const value = String(req.body.optionValue || req.body.option_value || '').trim();
  const label = String(req.body.optionLabel || req.body.option_label || '').trim();
  if (!group || !value || !label) {
    return res.status(400).json({ error: 'optionGroup, optionValue, and optionLabel are required' });
  }

  const result = await pool.query(
    `INSERT INTO onboarding_option_catalog
      (option_group, option_value, option_label, description, is_enabled, is_default, position_order, category_id, branch_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, option_group, option_value, option_label, description, is_enabled, is_default, position_order, category_id, branch_id`,
    [
      group,
      value,
      label,
      req.body.description || null,
      typeof req.body.isEnabled === 'undefined' ? true : toBoolean(req.body.isEnabled),
      toBoolean(req.body.isDefault),
      toInt(req.body.positionOrder, 0),
      toInt(req.body.categoryId),
      toInt(req.body.branchId),
      req.session.userId
    ]
  );

  await writeAuditLog(req, 'onboarding.option.create', 'onboarding_option_catalog', result.rows[0].id, req.body);
  res.status(201).json({ option: result.rows[0] });
});

router.put('/onboarding/options/:id', requirePermission('settings.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid option id' });

  const result = await pool.query(
    `UPDATE onboarding_option_catalog
     SET option_group = COALESCE($1, option_group),
         option_value = COALESCE($2, option_value),
         option_label = COALESCE($3, option_label),
         description = COALESCE($4, description),
         is_enabled = COALESCE($5, is_enabled),
         is_default = COALESCE($6, is_default),
         position_order = COALESCE($7, position_order),
         category_id = COALESCE($8, category_id),
         branch_id = COALESCE($9, branch_id),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $10
     RETURNING id, option_group, option_value, option_label, description, is_enabled, is_default, position_order, category_id, branch_id`,
    [
      req.body.optionGroup || req.body.option_group || null,
      req.body.optionValue || req.body.option_value || null,
      req.body.optionLabel || req.body.option_label || null,
      req.body.description || null,
      typeof req.body.isEnabled === 'undefined' ? null : toBoolean(req.body.isEnabled),
      typeof req.body.isDefault === 'undefined' ? null : toBoolean(req.body.isDefault),
      toInt(req.body.positionOrder),
      toInt(req.body.categoryId),
      toInt(req.body.branchId),
      id
    ]
  );

  if (!result.rows[0]) return res.status(404).json({ error: 'Option not found' });
  await writeAuditLog(req, 'onboarding.option.update', 'onboarding_option_catalog', id, req.body);
  res.json({ option: result.rows[0] });
});

router.delete('/onboarding/options/:id', requirePermission('settings.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid option id' });

  await pool.query('UPDATE onboarding_option_catalog SET is_enabled = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  await writeAuditLog(req, 'onboarding.option.disable', 'onboarding_option_catalog', id);
  res.json({ message: 'Option disabled successfully' });
});

router.get('/recommendation-rules', requirePermission('reports.view'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
      dr.id,
      dr.content_type,
      dr.content_id,
      dr.title,
      dr.branch_id,
      dr.membership_tier,
      dr.is_featured,
      dr.position_order,
      ab.name AS branch_name
     FROM dashboard_recommendations dr
     LEFT JOIN academic_branches ab ON ab.id = dr.branch_id
     ORDER BY dr.is_featured DESC, dr.position_order ASC, dr.id DESC`
  );
  res.json({ rules: rows });
});

router.post('/recommendation-rules', requirePermission('content.manage'), async (req, res) => {
  const payload = req.body || {};
  const result = await pool.query(
    `INSERT INTO dashboard_recommendations
      (content_type, content_id, title, branch_id, membership_tier, is_featured, position_order, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, content_type, content_id, title, branch_id, membership_tier, is_featured, position_order`,
    [
      payload.contentType,
      toInt(payload.contentId),
      payload.title || null,
      toInt(payload.branchId),
      payload.membershipTier || null,
      toBoolean(payload.isFeatured),
      toInt(payload.positionOrder, 0),
      req.session.userId
    ]
  );

  await writeAuditLog(req, 'recommendation_rule.create', 'dashboard_recommendations', result.rows[0].id, payload);
  res.status(201).json({ rule: result.rows[0] });
});

router.put('/recommendation-rules/:id', requirePermission('content.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid rule id' });

  const payload = req.body || {};
  const result = await pool.query(
    `UPDATE dashboard_recommendations
     SET content_type = COALESCE($1, content_type),
         content_id = COALESCE($2, content_id),
         title = COALESCE($3, title),
         branch_id = COALESCE($4, branch_id),
         membership_tier = COALESCE($5, membership_tier),
         is_featured = COALESCE($6, is_featured),
         position_order = COALESCE($7, position_order),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $8
     RETURNING id, content_type, content_id, title, branch_id, membership_tier, is_featured, position_order`,
    [
      payload.contentType || null,
      toInt(payload.contentId),
      payload.title || null,
      toInt(payload.branchId),
      payload.membershipTier || null,
      typeof payload.isFeatured === 'undefined' ? null : toBoolean(payload.isFeatured),
      toInt(payload.positionOrder),
      id
    ]
  );

  if (!result.rows[0]) return res.status(404).json({ error: 'Recommendation rule not found' });
  await writeAuditLog(req, 'recommendation_rule.update', 'dashboard_recommendations', id, payload);
  res.json({ rule: result.rows[0] });
});

router.delete('/recommendation-rules/:id', requirePermission('content.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid rule id' });

  await pool.query('DELETE FROM dashboard_recommendations WHERE id = $1', [id]);
  await writeAuditLog(req, 'recommendation_rule.delete', 'dashboard_recommendations', id);
  res.json({ message: 'Recommendation rule deleted successfully' });
});

router.post('/content/:type/bulk', requirePermission('content.manage'), async (req, res) => {
  const config = getContentConfig(req.params.type);
  if (!config) return res.status(400).json({ error: 'Unsupported content type' });

  const ids = Array.isArray(req.body.ids) ? req.body.ids.map((id) => toInt(id)).filter(Boolean) : [];
  const action = String(req.body.action || '').toLowerCase();
  if (!ids.length) return res.status(400).json({ error: 'ids array is required' });

  if (action === 'publish') {
    if (config.table === 'roadmaps') {
      await pool.query(`UPDATE ${config.table} SET is_published = TRUE WHERE ${config.idColumn} = ANY($1::int[])`, [ids]);
    } else {
      await pool.query(`UPDATE ${config.table} SET status = 'published' WHERE ${config.idColumn} = ANY($1::int[])`, [ids]);
    }
  } else if (action === 'unpublish') {
    if (config.table === 'roadmaps') {
      await pool.query(`UPDATE ${config.table} SET is_published = FALSE WHERE ${config.idColumn} = ANY($1::int[])`, [ids]);
    } else {
      await pool.query(`UPDATE ${config.table} SET status = 'draft' WHERE ${config.idColumn} = ANY($1::int[])`, [ids]);
    }
  } else if (action === 'delete') {
    await pool.query(`UPDATE ${config.table} SET deleted_at = NOW() WHERE ${config.idColumn} = ANY($1::int[])`, [ids]);
  } else if (action === 'restore') {
    await pool.query(`UPDATE ${config.table} SET deleted_at = NULL WHERE ${config.idColumn} = ANY($1::int[])`, [ids]);
  } else {
    return res.status(400).json({ error: 'Unsupported bulk action' });
  }

  await writeAuditLog(req, 'content.bulk_action', config.table, 'bulk', { action, ids });
  publishContentChanged(req.params.type, action, 'bulk', { ids });
  res.json({ message: `Bulk action '${action}' applied on ${req.params.type}`, count: ids.length });
});

router.post('/quizzes/:id/reset-results', requirePermission('quizzes.manage'), async (req, res) => {
  const quizId = toInt(req.params.id, -1);
  if (quizId < 1) return res.status(400).json({ error: 'Invalid quiz id' });

  const deleted = await pool.query('DELETE FROM quiz_attempts WHERE quiz_id = $1', [quizId]);
  await writeAuditLog(req, 'quiz.reset_results', 'quiz', quizId, { removedAttempts: deleted.rowCount });
  res.json({ message: 'Quiz results reset successfully', removedAttempts: deleted.rowCount });
});

// Mock Tests Management
router.get('/mock-tests', requirePermission('mock_tests.manage'), async (req, res) => {
  const includeDeleted = toBoolean(req.query.includeDeleted);
  const clauses = includeDeleted ? [] : ['m.deleted_at IS NULL'];
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
      m.id, m.title, m.subject, m.topic, m.duration_minutes, m.total_marks,
      m.category_id, m.branch_id, m.semester_id, m.access_type, m.status, m.is_common,
      m.category_key, m.difficulty, m.total_questions, m.attempt_limit_free, m.retake_allowed,
      m.shuffle_questions, m.shuffle_options, m.explanations_visible, m.marks_per_question,
      m.negative_marking_enabled, m.negative_marks,
      ac.name AS category_name, ab.name AS branch_name, asr.label AS semester_label,
      COUNT(ma.id)::int AS attempts,
      COALESCE(ROUND(AVG(ma.marks_obtained), 2), 0)::numeric(8,2) AS avg_score,
      COALESCE(MAX(ma.marks_obtained), 0)::numeric(8,2) AS top_score,
      COALESCE(qstats.question_count, 0)::int AS question_count
     FROM mock_tests m
     LEFT JOIN academic_categories ac ON ac.id = m.category_id
     LEFT JOIN academic_branches ab ON ab.id = m.branch_id
     LEFT JOIN academic_semesters asr ON asr.id = m.semester_id
     LEFT JOIN mock_test_attempts ma ON ma.mock_test_id = m.id
     LEFT JOIN (
       SELECT mock_test_id, COUNT(*)::int AS question_count
       FROM mock_test_questions
       GROUP BY mock_test_id
     ) qstats ON qstats.mock_test_id = m.id
     ${where}
     GROUP BY m.id, ac.name, ab.name, asr.label, qstats.question_count
     ORDER BY m.created_at DESC`
  );

  res.json({ mockTests: rows });
});

router.post('/mock-tests', requirePermission('mock_tests.manage'), async (req, res) => {
  const {
    title,
    durationMinutes,
    totalMarks,
    totalQuestions,
    subject,
    topic,
    categoryKey,
    difficulty,
    syllabus,
    instructions,
    categoryId,
    branchId,
    semesterId,
    accessType,
    status,
    isCommon,
    attemptLimitFree,
    retakeAllowed,
    shuffleQuestions,
    shuffleOptions,
    explanationsVisible,
    marksPerQuestion,
    negativeMarkingEnabled,
    negativeMarks,
    sectionConfig,
    scheduledAt
  } = req.body;

  if (!title || !durationMinutes || !totalMarks) {
    return res.status(400).json({ error: 'title, durationMinutes, and totalMarks are required' });
  }

  const result = await pool.query(
    `INSERT INTO mock_tests (
      title, duration_minutes, total_marks, scheduled_at,
      total_questions, subject, topic, category_key, difficulty, syllabus, instructions,
      category_id, branch_id, semester_id, access_type, status, is_common,
      attempt_limit_free, retake_allowed, shuffle_questions, shuffle_options, explanations_visible,
      marks_per_question, negative_marking_enabled, negative_marks, section_config, created_by
     )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
     RETURNING *`,
    [
      title,
      toInt(durationMinutes),
      toInt(totalMarks),
      scheduledAt || null,
      toInt(totalQuestions, 0),
      subject || null,
      topic || null,
      (categoryKey || 'grand'),
      (difficulty || 'medium'),
      syllabus || null,
      instructions || null,
      toInt(categoryId),
      toInt(branchId),
      toInt(semesterId),
      accessType || 'free',
      status || 'published',
      toBoolean(isCommon),
      toInt(attemptLimitFree, 2),
      typeof retakeAllowed === 'undefined' ? true : toBoolean(retakeAllowed),
      toBoolean(shuffleQuestions),
      toBoolean(shuffleOptions),
      typeof explanationsVisible === 'undefined' ? true : toBoolean(explanationsVisible),
      Number(marksPerQuestion || 1),
      toBoolean(negativeMarkingEnabled),
      Number(negativeMarks || 0),
      JSON.stringify(Array.isArray(sectionConfig) ? sectionConfig : []),
      req.session.userId
    ]
  );

  await writeAuditLog(req, 'mock_test.create', 'mock_test', result.rows[0].id, req.body);
  publishContentChanged('mock_tests', 'created', result.rows[0].id);
  res.status(201).json({ mockTest: result.rows[0] });
});

router.put('/mock-tests/:id', requirePermission('mock_tests.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid mock test id' });

  const {
    title,
    durationMinutes,
    totalMarks,
    totalQuestions,
    subject,
    topic,
    categoryKey,
    difficulty,
    syllabus,
    instructions,
    categoryId,
    branchId,
    semesterId,
    accessType,
    status,
    isCommon,
    attemptLimitFree,
    retakeAllowed,
    shuffleQuestions,
    shuffleOptions,
    explanationsVisible,
    marksPerQuestion,
    negativeMarkingEnabled,
    negativeMarks,
    sectionConfig,
    scheduledAt
  } = req.body;

  await pool.query(
    `UPDATE mock_tests
     SET title = COALESCE($1, title),
         duration_minutes = COALESCE($2, duration_minutes),
         total_marks = COALESCE($3, total_marks),
         total_questions = COALESCE($4, total_questions),
         subject = COALESCE($5, subject),
         topic = COALESCE($6, topic),
         category_key = COALESCE($7, category_key),
         difficulty = COALESCE($8, difficulty),
         syllabus = COALESCE($9, syllabus),
         instructions = COALESCE($10, instructions),
         category_id = COALESCE($11, category_id),
         branch_id = COALESCE($12, branch_id),
         semester_id = COALESCE($13, semester_id),
         access_type = COALESCE($14, access_type),
         status = COALESCE($15, status),
         is_common = COALESCE($16, is_common),
         attempt_limit_free = COALESCE($17, attempt_limit_free),
         retake_allowed = COALESCE($18, retake_allowed),
         shuffle_questions = COALESCE($19, shuffle_questions),
         shuffle_options = COALESCE($20, shuffle_options),
         explanations_visible = COALESCE($21, explanations_visible),
         marks_per_question = COALESCE($22, marks_per_question),
         negative_marking_enabled = COALESCE($23, negative_marking_enabled),
         negative_marks = COALESCE($24, negative_marks),
         section_config = COALESCE($25::jsonb, section_config),
         scheduled_at = COALESCE($26, scheduled_at)
     WHERE id = $27`,
    [
      title || null,
      toInt(durationMinutes),
      toInt(totalMarks),
      toInt(totalQuestions),
      subject || null,
      topic || null,
      categoryKey || null,
      difficulty || null,
      syllabus || null,
      instructions || null,
      toInt(categoryId),
      toInt(branchId),
      toInt(semesterId),
      accessType || null,
      status || null,
      typeof isCommon === 'undefined' ? null : toBoolean(isCommon),
      toInt(attemptLimitFree),
      typeof retakeAllowed === 'undefined' ? null : toBoolean(retakeAllowed),
      typeof shuffleQuestions === 'undefined' ? null : toBoolean(shuffleQuestions),
      typeof shuffleOptions === 'undefined' ? null : toBoolean(shuffleOptions),
      typeof explanationsVisible === 'undefined' ? null : toBoolean(explanationsVisible),
      marksPerQuestion === undefined ? null : Number(marksPerQuestion),
      typeof negativeMarkingEnabled === 'undefined' ? null : toBoolean(negativeMarkingEnabled),
      negativeMarks === undefined ? null : Number(negativeMarks),
      sectionConfig ? JSON.stringify(sectionConfig) : null,
      scheduledAt || null,
      id
    ]
  );

  await writeAuditLog(req, 'mock_test.update', 'mock_test', id, req.body);
  publishContentChanged('mock_tests', 'updated', id);
  res.json({ message: 'Mock test updated successfully' });
});

router.delete('/mock-tests/:id', requirePermission('mock_tests.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid mock test id' });

  await pool.query('UPDATE mock_tests SET deleted_at = NOW() WHERE id = $1', [id]);
  await writeAuditLog(req, 'mock_test.soft_delete', 'mock_test', id);
  publishContentChanged('mock_tests', 'deleted', id);
  res.json({ message: 'Mock test deleted (soft delete)' });
});

router.post('/mock-tests/:id/restore', requirePermission('mock_tests.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid mock test id' });

  await pool.query('UPDATE mock_tests SET deleted_at = NULL WHERE id = $1', [id]);
  await writeAuditLog(req, 'mock_test.restore', 'mock_test', id);
  publishContentChanged('mock_tests', 'restored', id);
  res.json({ message: 'Mock test restored successfully' });
});

router.get('/mock-tests/:id/questions', requirePermission('mock_tests.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid mock test id' });

  const { rows } = await pool.query(
    `SELECT
      id,
      mock_test_id,
      question_text,
      question_type,
      difficulty,
      section_name,
      subject,
      topic,
      marks,
      negative_marks,
      explanation,
      options_json,
      correct_answer_json,
      order_no,
      created_at
     FROM mock_test_questions
     WHERE mock_test_id = $1
     ORDER BY order_no ASC, id ASC`,
    [id]
  );

  res.json({ questions: rows });
});

router.post('/mock-tests/:id/questions/manual', requirePermission('mock_tests.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid mock test id' });

  const {
    questionText,
    questionType,
    difficulty,
    sectionName,
    subject,
    topic,
    marks,
    negativeMarks,
    explanation,
    options,
    correctAnswer,
    orderNo
  } = req.body;

  if (!questionText || !correctAnswer) {
    return res.status(400).json({ error: 'questionText and correctAnswer are required' });
  }

  const result = await pool.query(
    `INSERT INTO mock_test_questions (
      mock_test_id,
      question_text,
      question_type,
      difficulty,
      section_name,
      subject,
      topic,
      marks,
      negative_marks,
      explanation,
      options_json,
      correct_answer_json,
      order_no
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)
    RETURNING *`,
    [
      id,
      questionText,
      questionType || 'single_mcq',
      difficulty || 'medium',
      sectionName || null,
      subject || null,
      topic || null,
      Number(marks || 1),
      Number(negativeMarks || 0),
      explanation || null,
      JSON.stringify(Array.isArray(options) ? options : []),
      JSON.stringify(correctAnswer),
      toInt(orderNo, 0)
    ]
  );

  await pool.query(
    `UPDATE mock_tests
     SET total_questions = (
       SELECT COUNT(*)::int FROM mock_test_questions WHERE mock_test_id = $1
     )
     WHERE id = $1`,
    [id]
  );

  await writeAuditLog(req, 'mock_test.question.create', 'mock_test', id, { questionId: result.rows[0].id });
  publishContentChanged('mock_tests', 'question_created', id, { questionId: result.rows[0].id });
  res.status(201).json({ question: result.rows[0] });
});

router.post('/mock-tests/:id/questions/bulk', requirePermission('mock_tests.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid mock test id' });

  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'rows array is required for bulk upload' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let inserted = 0;

    for (let idx = 0; idx < rows.length; idx += 1) {
      const row = rows[idx];
      if (!row.questionText || row.correctAnswer === undefined) continue;

      await client.query(
        `INSERT INTO mock_test_questions (
          mock_test_id,
          question_text,
          question_type,
          difficulty,
          section_name,
          subject,
          topic,
          marks,
          negative_marks,
          explanation,
          options_json,
          correct_answer_json,
          order_no
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)`,
        [
          id,
          row.questionText,
          row.questionType || 'single_mcq',
          row.difficulty || 'medium',
          row.sectionName || null,
          row.subject || null,
          row.topic || null,
          Number(row.marks || 1),
          Number(row.negativeMarks || 0),
          row.explanation || null,
          JSON.stringify(Array.isArray(row.options) ? row.options : []),
          JSON.stringify(row.correctAnswer),
          toInt(row.orderNo, idx)
        ]
      );
      inserted += 1;
    }

    await client.query(
      `UPDATE mock_tests
       SET total_questions = (
         SELECT COUNT(*)::int FROM mock_test_questions WHERE mock_test_id = $1
       )
       WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    await writeAuditLog(req, 'mock_test.question.bulk_upload', 'mock_test', id, { inserted });
    publishContentChanged('mock_tests', 'questions_bulk_created', id, { inserted });
    res.status(201).json({ inserted });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

router.delete('/mock-tests/:id/questions/:questionId', requirePermission('mock_tests.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  const questionId = toInt(req.params.questionId, -1);
  if (id < 1 || questionId < 1) return res.status(400).json({ error: 'Invalid ids' });

  await pool.query('DELETE FROM mock_test_questions WHERE id = $1 AND mock_test_id = $2', [questionId, id]);
  await pool.query(
    `UPDATE mock_tests
     SET total_questions = (
       SELECT COUNT(*)::int FROM mock_test_questions WHERE mock_test_id = $1
     )
     WHERE id = $1`,
    [id]
  );

  await writeAuditLog(req, 'mock_test.question.delete', 'mock_test', id, { questionId });
  publishContentChanged('mock_tests', 'question_deleted', id, { questionId });
  res.json({ message: 'Question deleted successfully' });
});

router.get('/mock-tests/analytics/overview', requirePermission('mock_tests.manage'), async (_req, res) => {
  const [summary, branchWise, questionAccuracy, topicWeakness, freeVsPremium] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*)::int AS total_attempts,
        COALESCE(ROUND(AVG(marks_obtained), 2), 0)::numeric(8,2) AS average_score,
        COALESCE(MAX(marks_obtained), 0)::numeric(8,2) AS top_score,
        COALESCE(ROUND(AVG(CASE WHEN total_questions > 0 THEN (correct_answers::numeric / total_questions) * 100 ELSE 0 END), 2), 0)::numeric(6,2) AS completion_rate
       FROM mock_test_attempts`
    ),
    pool.query(
      `SELECT
        COALESCE(ab.name, 'General') AS branch,
        COUNT(*)::int AS attempts
       FROM mock_test_attempts mta
       LEFT JOIN user_profiles up ON up.user_id = mta.user_id
       LEFT JOIN academic_branches ab ON ab.id = up.branch_id
       GROUP BY COALESCE(ab.name, 'General')
       ORDER BY attempts DESC`
    ),
    pool.query(
      `SELECT
        q.id AS question_id,
        q.question_text,
        q.topic,
        COUNT(*)::int AS appearances,
        COALESCE(ROUND(AVG(CASE WHEN (ans ->> 'isCorrect')::boolean THEN 1 ELSE 0 END) * 100, 2), 0)::numeric(6,2) AS accuracy
       FROM mock_test_attempts mta
       JOIN LATERAL jsonb_array_elements(COALESCE(mta.answers_json, '[]'::jsonb)) ans ON TRUE
       LEFT JOIN mock_test_questions q ON q.id = (ans ->> 'questionId')::int
       GROUP BY q.id, q.question_text, q.topic
       ORDER BY accuracy ASC NULLS LAST
       LIMIT 12`
    ),
    pool.query(
      `SELECT
        COALESCE(q.topic, mt.topic, 'General') AS topic,
        COALESCE(ROUND(AVG(CASE WHEN (ans ->> 'isCorrect')::boolean THEN 1 ELSE 0 END) * 100, 2), 0)::numeric(6,2) AS accuracy,
        COUNT(*)::int AS appearances
       FROM mock_test_attempts mta
       JOIN mock_tests mt ON mt.id = mta.mock_test_id
       JOIN LATERAL jsonb_array_elements(COALESCE(mta.answers_json, '[]'::jsonb)) ans ON TRUE
       LEFT JOIN mock_test_questions q ON q.id = (ans ->> 'questionId')::int
       GROUP BY COALESCE(q.topic, mt.topic, 'General')
       ORDER BY accuracy ASC
       LIMIT 12`
    ),
    pool.query(
      `SELECT
        COALESCE(mt.access_type, 'free') AS access_type,
        COUNT(*)::int AS attempts
       FROM mock_test_attempts mta
       JOIN mock_tests mt ON mt.id = mta.mock_test_id
       GROUP BY COALESCE(mt.access_type, 'free')`
    )
  ]);

  res.json({
    summary: summary.rows[0] || {},
    branchWiseAttempts: branchWise.rows,
    questionWiseAccuracy: questionAccuracy.rows,
    topicWiseWeakness: topicWeakness.rows,
    freeVsPremiumUsage: freeVsPremium.rows
  });
});

// Roadmap Management
router.get('/roadmaps', requirePermission('roadmaps.manage'), async (req, res) => {
  const includeDeleted = toBoolean(req.query.includeDeleted);
  const where = includeDeleted ? '' : 'WHERE r.deleted_at IS NULL';

  const roadmaps = await pool.query(
    `SELECT
      r.id, r.user_id, r.title, r.progress, r.sequence_no, r.is_published,
      r.category_id, r.branch_id, r.semester_id,
      ac.name AS category_name, ab.name AS branch_name, asr.label AS semester_label,
      r.updated_at
     FROM roadmaps r
     LEFT JOIN academic_categories ac ON ac.id = r.category_id
     LEFT JOIN academic_branches ab ON ab.id = r.branch_id
     LEFT JOIN academic_semesters asr ON asr.id = r.semester_id
     ${where}
     ORDER BY r.sequence_no ASC, r.updated_at DESC`
  );

  const milestones = await pool.query(
    `SELECT id, roadmap_id, title, description, sequence_no, is_published
     FROM roadmap_milestones
     ORDER BY roadmap_id, sequence_no`
  );

  const milestoneByRoadmap = milestones.rows.reduce((acc, row) => {
    acc[row.roadmap_id] = acc[row.roadmap_id] || [];
    acc[row.roadmap_id].push(row);
    return acc;
  }, {});

  res.json({
    roadmaps: roadmaps.rows.map((roadmap) => ({
      ...roadmap,
      milestones: milestoneByRoadmap[roadmap.id] || []
    }))
  });
});

router.post('/roadmaps', requirePermission('roadmaps.manage'), async (req, res) => {
  const { title, roadmapData, categoryId, branchId, semesterId, sequenceNo, isPublished } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });

  const result = await pool.query(
    `INSERT INTO roadmaps (
      user_id, title, roadmap_data, category_id, branch_id, semester_id, sequence_no, is_published, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
     RETURNING *`,
    [req.session.userId, title, roadmapData || {}, toInt(categoryId), toInt(branchId), toInt(semesterId), toInt(sequenceNo, 0), toBoolean(isPublished)]
  );

  await writeAuditLog(req, 'roadmap.create', 'roadmap', result.rows[0].id, req.body);
  publishContentChanged('roadmaps', 'created', result.rows[0].id);
  res.status(201).json({ roadmap: result.rows[0] });
});

router.put('/roadmaps/:id', requirePermission('roadmaps.manage'), async (req, res) => {
  const roadmapId = toInt(req.params.id, -1);
  if (roadmapId < 1) return res.status(400).json({ error: 'Invalid roadmap id' });

  const { title, roadmapData, categoryId, branchId, semesterId, sequenceNo, isPublished, progress } = req.body;

  await pool.query(
    `UPDATE roadmaps
     SET title = COALESCE($1, title),
         roadmap_data = COALESCE($2, roadmap_data),
         category_id = COALESCE($3, category_id),
         branch_id = COALESCE($4, branch_id),
         semester_id = COALESCE($5, semester_id),
         sequence_no = COALESCE($6, sequence_no),
         is_published = COALESCE($7, is_published),
         progress = COALESCE($8, progress),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $9`,
    [title || null, roadmapData || null, toInt(categoryId), toInt(branchId), toInt(semesterId), toInt(sequenceNo), typeof isPublished === 'undefined' ? null : toBoolean(isPublished), toInt(progress), roadmapId]
  );

  await writeAuditLog(req, 'roadmap.update', 'roadmap', roadmapId, req.body);
  publishContentChanged('roadmaps', 'updated', roadmapId);
  res.json({ message: 'Roadmap updated successfully' });
});

router.post('/roadmaps/:id/milestones', requirePermission('roadmaps.manage'), async (req, res) => {
  const roadmapId = toInt(req.params.id, -1);
  if (roadmapId < 1) return res.status(400).json({ error: 'Invalid roadmap id' });

  const milestones = Array.isArray(req.body.milestones) ? req.body.milestones : [];
  if (!milestones.length) return res.status(400).json({ error: 'milestones array is required' });

  await pool.query('DELETE FROM roadmap_milestones WHERE roadmap_id = $1', [roadmapId]);

  for (let i = 0; i < milestones.length; i += 1) {
    const milestone = milestones[i] || {};
    await pool.query(
      `INSERT INTO roadmap_milestones (roadmap_id, title, description, sequence_no, is_published)
       VALUES ($1, $2, $3, $4, $5)`,
      [roadmapId, milestone.title || `Milestone ${i + 1}`, milestone.description || null, toInt(milestone.sequenceNo, i + 1), toBoolean(milestone.isPublished)]
    );
  }

  await writeAuditLog(req, 'roadmap.milestones_replace', 'roadmap', roadmapId, { milestoneCount: milestones.length });
  publishContentChanged('roadmaps', 'milestones_updated', roadmapId, { milestoneCount: milestones.length });
  res.json({ message: 'Roadmap milestones updated', count: milestones.length });
});

router.post('/roadmaps/:id/publish', requirePermission('roadmaps.manage'), async (req, res) => {
  const roadmapId = toInt(req.params.id, -1);
  if (roadmapId < 1) return res.status(400).json({ error: 'Invalid roadmap id' });
  const result = await pool.query(
    "UPDATE roadmaps SET status = 'published', is_published = TRUE, published_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
    [roadmapId]
  );
  await writeAuditLog(req, 'roadmap.publish', 'roadmap', roadmapId);
  publishContentChanged('roadmaps', 'published', roadmapId);
  res.json({ message: 'Roadmap published', roadmap: result.rows[0] });
});

router.post('/roadmaps/:id/hide', requirePermission('roadmaps.manage'), async (req, res) => {
  const roadmapId = toInt(req.params.id, -1);
  if (roadmapId < 1) return res.status(400).json({ error: 'Invalid roadmap id' });
  await pool.query('UPDATE roadmaps SET is_published = FALSE WHERE id = $1', [roadmapId]);
  await writeAuditLog(req, 'roadmap.hide', 'roadmap', roadmapId);
  publishContentChanged('roadmaps', 'hidden', roadmapId);
  res.json({ message: 'Roadmap hidden' });
});

// Certificate controls
router.post('/certificates/bulk-assign', requirePermission('certificates.manage'), async (req, res) => {
  const userIds = Array.isArray(req.body.userIds) ? req.body.userIds.map((id) => toInt(id)).filter(Boolean) : [];
  const type = String(req.body.type || 'achievement');
  const issuedDate = req.body.issuedDate || new Date().toISOString().slice(0, 10);
  const certificateUrl = req.body.certificateUrl || null;

  if (!userIds.length) return res.status(400).json({ error: 'userIds array is required' });

  for (const userId of userIds) {
    const verificationCode = `CERT-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    await pool.query(
      `INSERT INTO certificates (user_id, type, issued_date, certificate_url, verification_code)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, type, issuedDate, certificateUrl, verificationCode]
    );
  }

  await writeAuditLog(req, 'certificate.bulk_assign', 'certificate', 'bulk', { userIds, type });
  publishContentChanged('certificates', 'bulk_assigned', 'bulk', { userIds, type });
  res.json({ message: 'Certificates assigned in bulk', count: userIds.length });
});

router.post('/certificates/:id/revoke', requirePermission('certificates.manage'), async (req, res) => {
  const certificateId = toInt(req.params.id, -1);
  if (certificateId < 1) return res.status(400).json({ error: 'Invalid certificate id' });

  await pool.query("UPDATE certificates SET status = 'revoked' WHERE id = $1", [certificateId]);
  await writeAuditLog(req, 'certificate.revoke', 'certificate', certificateId);
  publishContentChanged('certificates', 'revoked', certificateId);
  res.json({ message: 'Certificate revoked successfully' });
});

router.get('/certificates/verify/:code', async (req, res) => {
  const code = String(req.params.code || '').trim();
  const result = await pool.query(
    `SELECT c.id, c.user_id, c.type, c.issued_date, c.status, c.verification_code,
            u.full_name, u.email
     FROM certificates c
     JOIN users u ON u.id = c.user_id
     WHERE c.verification_code = $1`,
    [code]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'Certificate not found' });
  res.json({ certificate: result.rows[0] });
});

// Notifications and Announcements
router.post('/notifications/send', requirePermission('notifications.manage'), async (req, res) => {
  const {
    title,
    message,
    categoryId,
    branchId,
    semesterId,
    onlyPremium,
    isAnnouncement,
    membershipReminder
  } = req.body;

  if (!message) return res.status(400).json({ error: 'message is required' });

  const params = [];
  const clauses = ["u.role = 'student'", 'u.deleted_at IS NULL'];

  if (toBoolean(onlyPremium)) clauses.push("u.subscription_tier = 'premium'");
  if (toInt(branchId)) {
    params.push(toInt(branchId));
    clauses.push(`up.branch_id = $${params.length}`);
  }
  if (toInt(categoryId)) {
    params.push(toInt(categoryId));
    clauses.push(`up.category_id = $${params.length}`);
  }
  if (toInt(semesterId)) {
    params.push(toInt(semesterId));
    clauses.push(`up.semester_id = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const recipients = await pool.query(
    `SELECT u.id AS user_id
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     ${where}`,
    params
  );

  const kind = membershipReminder ? 'membership_reminder' : (toBoolean(isAnnouncement) ? 'announcement' : 'admin_broadcast');

  for (const row of recipients.rows) {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, kind, category_id, branch_id, semester_id, is_announcement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.user_id, title || null, message, kind, toInt(categoryId), toInt(branchId), toInt(semesterId), toBoolean(isAnnouncement)]
    );
  }

  await writeAuditLog(req, 'notification.broadcast', 'notification', 'bulk', {
    recipientCount: recipients.rowCount,
    categoryId,
    branchId,
    semesterId,
    onlyPremium,
    membershipReminder
  });

  publishContentChanged('notifications', 'broadcast_created', 'bulk', {
    recipientCount: recipients.rowCount,
    categoryId,
    branchId,
    semesterId,
    onlyPremium,
    membershipReminder
  });

  res.json({ message: 'Notifications sent successfully', recipientCount: recipients.rowCount });
});

router.get('/announcements', requirePermission('notifications.manage'), async (req, res) => {
  const includeDeleted = toBoolean(req.query.includeDeleted);
  const where = includeDeleted ? '' : 'WHERE a.deleted_at IS NULL';
  const result = await pool.query(
    `SELECT a.*, ac.name AS category_name, ab.name AS branch_name, asr.label AS semester_label
     FROM announcements a
     LEFT JOIN academic_categories ac ON ac.id = a.category_id
     LEFT JOIN academic_branches ab ON ab.id = a.branch_id
     LEFT JOIN academic_semesters asr ON asr.id = a.semester_id
     ${where}
     ORDER BY a.created_at DESC`
  );
  res.json({ announcements: result.rows });
});

router.post('/announcements', requirePermission('notifications.manage'), async (req, res) => {
  const { title, message, categoryId, branchId, semesterId, status } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message are required' });

  const result = await pool.query(
    `INSERT INTO announcements (title, message, category_id, branch_id, semester_id, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [title, message, toInt(categoryId), toInt(branchId), toInt(semesterId), status || 'published', req.session.userId]
  );

  await writeAuditLog(req, 'announcement.create', 'announcement', result.rows[0].id);
  publishContentChanged('announcements', 'created', result.rows[0].id);
  res.status(201).json({ announcement: result.rows[0] });
});

router.put('/announcements/:id', requirePermission('notifications.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid announcement id' });
  const { title, message, categoryId, branchId, semesterId, status } = req.body;

  await pool.query(
    `UPDATE announcements
     SET title = COALESCE($1, title),
         message = COALESCE($2, message),
         category_id = COALESCE($3, category_id),
         branch_id = COALESCE($4, branch_id),
         semester_id = COALESCE($5, semester_id),
         status = COALESCE($6, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $7`,
    [title || null, message || null, toInt(categoryId), toInt(branchId), toInt(semesterId), status || null, id]
  );

  await writeAuditLog(req, 'announcement.update', 'announcement', id);
  publishContentChanged('announcements', 'updated', id);
  res.json({ message: 'Announcement updated successfully' });
});

router.delete('/announcements/:id', requirePermission('notifications.manage'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid announcement id' });

  await pool.query('UPDATE announcements SET deleted_at = NOW() WHERE id = $1', [id]);
  await writeAuditLog(req, 'announcement.soft_delete', 'announcement', id);
  publishContentChanged('announcements', 'deleted', id);
  res.json({ message: 'Announcement deleted (soft delete)' });
});

// Forum and Feedback Moderation
router.get('/forum/posts', requirePermission('forum.moderate'), async (req, res) => {
  const includeHidden = toBoolean(req.query.includeHidden);
  const includeDeleted = toBoolean(req.query.includeDeleted);

  const clauses = [];
  if (!includeHidden) clauses.push('f.is_hidden = FALSE');
  if (!includeDeleted) clauses.push('f.deleted_at IS NULL');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
      f.id, f.title, f.body, f.category, f.tags, f.is_hidden, f.deleted_at, f.created_at,
      u.full_name, u.email,
      COUNT(r.id)::int AS replies
     FROM forum_threads f
     JOIN users u ON u.id = f.user_id
     LEFT JOIN forum_replies r ON r.thread_id = f.id AND r.deleted_at IS NULL
     ${where}
     GROUP BY f.id, u.full_name, u.email
     ORDER BY f.created_at DESC`
  );

  res.json({ posts: rows });
});

router.post('/forum/posts/:id/hide', requirePermission('forum.moderate'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  const hidden = toBoolean(req.body.hidden ?? true);
  if (id < 1) return res.status(400).json({ error: 'Invalid post id' });

  await pool.query('UPDATE forum_threads SET is_hidden = $1 WHERE id = $2', [hidden, id]);
  await writeAuditLog(req, 'forum.post_visibility', 'forum_thread', id, { hidden });
  res.json({ message: `Forum post ${hidden ? 'hidden' : 'unhidden'} successfully` });
});

router.delete('/forum/posts/:id', requirePermission('forum.moderate'), async (req, res) => {
  const id = toInt(req.params.id, -1);
  if (id < 1) return res.status(400).json({ error: 'Invalid post id' });

  await pool.query('UPDATE forum_threads SET deleted_at = NOW() WHERE id = $1', [id]);
  await writeAuditLog(req, 'forum.post_soft_delete', 'forum_thread', id);
  res.json({ message: 'Forum post deleted (soft delete)' });
});

router.get('/feedback', requirePermission('feedback.manage'), async (req, res) => {
  const status = String(req.query.status || '').toLowerCase();
  const params = [];
  const clauses = [];
  if (status) {
    params.push(status);
    clauses.push(`LOWER(f.status) = $${params.length}`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT f.id, f.user_id, f.rating, f.message, f.admin_reply, f.status, f.is_resolved, f.created_at,
            u.full_name, u.email
     FROM feedback f
     JOIN users u ON u.id = f.user_id
     ${where}
     ORDER BY f.created_at DESC`,
    params
  );
  res.json({ feedback: rows });
});

router.post('/feedback/:id/resolve', requirePermission('feedback.manage'), async (req, res) => {
  const feedbackId = toInt(req.params.id, -1);
  if (feedbackId < 1) return res.status(400).json({ error: 'Invalid feedback id' });

  await pool.query(
    `UPDATE feedback
     SET is_resolved = TRUE,
         status = 'resolved',
         resolved_at = NOW(),
         resolved_by = $1
     WHERE id = $2`,
    [req.session.userId, feedbackId]
  );

  await writeAuditLog(req, 'feedback.resolve', 'feedback', feedbackId);
  res.json({ message: 'Feedback marked as resolved' });
});

router.post('/feedback/:id/reply', requirePermission('feedback.manage'), async (req, res) => {
  const feedbackId = toInt(req.params.id, -1);
  const reply = String(req.body.reply || '').trim();
  if (feedbackId < 1) return res.status(400).json({ error: 'Invalid feedback id' });
  if (!reply) return res.status(400).json({ error: 'reply is required' });

  await pool.query(
    `UPDATE feedback
     SET admin_reply = $1,
         replied_by = $2,
         replied_at = NOW(),
         status = 'responded'
     WHERE id = $3`,
    [reply, req.session.userId, feedbackId]
  );

  await writeAuditLog(req, 'feedback.reply', 'feedback', feedbackId);
  res.json({ message: 'Reply sent successfully' });
});

// Referral and Reward Management
router.get('/referrals/history', requirePermission('reports.view'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
      r.id,
      r.code_used,
      r.status,
      r.is_blocked,
      r.reward_points,
      r.created_at,
      ru.full_name AS referrer_name,
      ru.email AS referrer_email,
      tu.full_name AS referred_name,
      tu.email AS referred_email
     FROM referrals r
     JOIN users ru ON ru.id = r.referrer_user_id
     JOIN users tu ON tu.id = r.referred_user_id
     ORDER BY r.created_at DESC`
  );
  res.json({ referrals: rows });
});

router.get('/referrals/top', requirePermission('reports.view'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
      u.id,
      u.full_name,
      u.email,
      COUNT(r.id)::int AS total_referrals,
      COALESCE(SUM(r.reward_points), 0)::int AS reward_points
     FROM users u
     LEFT JOIN referrals r ON r.referrer_user_id = u.id AND r.is_blocked = FALSE
     WHERE u.role = 'student'
     GROUP BY u.id
     ORDER BY total_referrals DESC, reward_points DESC
     LIMIT 20`
  );
  res.json({ topReferrers: rows });
});

router.post('/referrals/:id/reward', requirePermission('memberships.manage'), async (req, res) => {
  const referralId = toInt(req.params.id, -1);
  const rewardPoints = toInt(req.body.rewardPoints, 0);
  const note = String(req.body.note || '').trim() || null;

  if (referralId < 1) return res.status(400).json({ error: 'Invalid referral id' });
  if (rewardPoints <= 0) return res.status(400).json({ error: 'rewardPoints must be > 0' });

  const referral = await pool.query('SELECT id, referrer_user_id FROM referrals WHERE id = $1', [referralId]);
  if (!referral.rows[0]) return res.status(404).json({ error: 'Referral not found' });

  await pool.query(
    'UPDATE referrals SET reward_points = COALESCE(reward_points, 0) + $1 WHERE id = $2',
    [rewardPoints, referralId]
  );

  await pool.query(
    `INSERT INTO referral_rewards (referral_id, user_id, reward_points, note, assigned_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [referralId, referral.rows[0].referrer_user_id, rewardPoints, note, req.session.userId]
  );

  await writeAuditLog(req, 'referral.reward_assign', 'referral', referralId, { rewardPoints, note });
  res.json({ message: 'Referral reward assigned successfully' });
});

router.post('/referrals/:id/block', requirePermission('memberships.manage'), async (req, res) => {
  const referralId = toInt(req.params.id, -1);
  if (referralId < 1) return res.status(400).json({ error: 'Invalid referral id' });

  await pool.query('UPDATE referrals SET is_blocked = TRUE WHERE id = $1', [referralId]);
  await writeAuditLog(req, 'referral.block', 'referral', referralId);
  res.json({ message: 'Referral blocked successfully' });
});

// Advanced Analytics
router.get('/analytics/overview', requirePermission('reports.view'), async (_req, res) => {
  const [
    totals,
    activeStudents,
    branchWise,
    contentUsage,
    quizAttempts,
    roadmapStats,
    referralStats,
    feedbackStats,
    premiumRevenue
  ] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE role = 'student' AND deleted_at IS NULL)::int AS total_students,
        COUNT(*) FILTER (WHERE role = 'student' AND subscription_tier = 'premium' AND deleted_at IS NULL)::int AS premium_students,
        COUNT(*) FILTER (WHERE role = 'student' AND payment_status = 'expired' AND deleted_at IS NULL)::int AS expired_memberships,
        COUNT(*) FILTER (WHERE role = 'student' AND is_blocked = TRUE AND deleted_at IS NULL)::int AS blocked_students,
        COUNT(*) FILTER (WHERE role = 'student' AND is_suspended = TRUE AND deleted_at IS NULL)::int AS suspended_students
       FROM users`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS active_students
       FROM users
       WHERE role = 'student' AND deleted_at IS NULL AND is_blocked = FALSE AND is_suspended = FALSE`
    ),
    pool.query(
      `SELECT ac.name AS category, ab.name AS branch, COUNT(up.user_id)::int AS students
       FROM academic_branches ab
       LEFT JOIN academic_categories ac ON ac.id = ab.category_id
       LEFT JOIN user_profiles up ON up.branch_id = ab.id
       LEFT JOIN users u ON u.id = up.user_id AND u.deleted_at IS NULL
       GROUP BY ac.name, ab.name
       ORDER BY ac.name, ab.name`
    ),
    pool.query(
      `SELECT
        (SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL)::int AS notes,
        (SELECT COUNT(*) FROM materials WHERE deleted_at IS NULL)::int AS materials,
        (SELECT COUNT(*) FROM previous_papers WHERE deleted_at IS NULL)::int AS papers,
        (SELECT COUNT(*) FROM quizzes WHERE deleted_at IS NULL)::int AS quizzes,
        (SELECT COUNT(*) FROM mock_tests WHERE deleted_at IS NULL)::int AS mock_tests,
        (SELECT COUNT(*) FROM roadmaps WHERE deleted_at IS NULL)::int AS roadmaps`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total_attempts,
              COUNT(DISTINCT user_id)::int AS unique_students,
              COALESCE(ROUND(AVG(score_percent), 2), 0) AS avg_score
       FROM quiz_attempts`
    ),
    pool.query(
      `SELECT
        COUNT(*)::int AS total_roadmaps,
        COUNT(*) FILTER (WHERE is_published = TRUE)::int AS published_roadmaps,
        COALESCE(ROUND(AVG(progress), 2), 0) AS avg_completion
       FROM roadmaps
       WHERE deleted_at IS NULL`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total_referrals,
              COUNT(*) FILTER (WHERE is_blocked = TRUE)::int AS blocked_referrals,
              COALESCE(SUM(reward_points), 0)::int AS reward_points
       FROM referrals`
    ),
    pool.query(
      `SELECT
        COUNT(*)::int AS total_feedback,
        COUNT(*) FILTER (WHERE is_resolved = TRUE)::int AS resolved_feedback,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open_feedback
       FROM feedback`
    ),
    pool.query(
      `SELECT COALESCE(SUM(amount_inr), 0)::numeric(10,2) AS revenue
       FROM membership_payment_requests
       WHERE status = 'approved'`
    )
  ]);

  res.json({
    totals: totals.rows[0],
    activeStudents: activeStudents.rows[0],
    branchWise: branchWise.rows,
    contentUsage: contentUsage.rows[0],
    quizAttempts: quizAttempts.rows[0],
    roadmapStats: roadmapStats.rows[0],
    referralStats: referralStats.rows[0],
    feedbackStats: feedbackStats.rows[0],
    revenue: Number(premiumRevenue.rows[0].revenue)
  });
});

// Roles and Permissions
router.get('/roles', requirePermission('roles.manage'), async (_req, res) => {
  const [admins, permissions] = await Promise.all([
    pool.query(`SELECT id, full_name, email, admin_role FROM users WHERE role = 'admin' ORDER BY created_at DESC`),
    pool.query(`SELECT admin_role, permissions FROM admin_permissions ORDER BY admin_role`)
  ]);

  res.json({ admins: admins.rows, rolePermissions: permissions.rows });
});

router.put('/roles/:adminId', requirePermission('roles.manage'), async (req, res) => {
  const adminId = toInt(req.params.adminId, -1);
  const adminRole = String(req.body.adminRole || '').trim();
  if (adminId < 1 || !adminRole) return res.status(400).json({ error: 'adminRole is required' });

  await pool.query("UPDATE users SET admin_role = $1 WHERE id = $2 AND role = 'admin'", [adminRole, adminId]);
  await writeAuditLog(req, 'admin.role_assign', 'admin_user', adminId, { adminRole });
  res.json({ message: 'Admin role updated successfully' });
});

router.put('/roles/permissions/:role', requirePermission('roles.manage'), async (req, res) => {
  const role = String(req.params.role || '').trim();
  const permissions = Array.isArray(req.body.permissions) ? req.body.permissions : [];
  if (!role) return res.status(400).json({ error: 'role is required' });

  await pool.query(
    `INSERT INTO admin_permissions (admin_role, permissions, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (admin_role)
     DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = CURRENT_TIMESTAMP`,
    [role, JSON.stringify(permissions)]
  );

  await writeAuditLog(req, 'admin.permissions_update', 'admin_role', role, { permissions });
  res.json({ message: 'Role permissions updated successfully' });
});

// Platform Settings
router.get('/settings', requirePermission('settings.manage'), async (_req, res) => {
  const { rows } = await pool.query('SELECT key, value_json, updated_at FROM platform_settings ORDER BY key');
  const settings = rows.reduce((acc, row) => {
    acc[row.key] = row.value_json;
    return acc;
  }, {});
  res.json({ settings, rows });
});

router.get('/feature-visibility', requirePermission('settings.manage'), async (_req, res) => {
  try {
    const matrix = await readFeatureMatrix();
    res.json({ success: true, matrix });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch feature visibility matrix' });
  }
});

router.put('/feature-visibility', requirePermission('settings.manage'), async (req, res) => {
  const { featureKey, status, is_visible, is_enabled, maintenance_mode, access_mode, maintenanceMessage, reason } = req.body || {};
  if (!featureKey) {
    return res.status(400).json({ error: 'featureKey is required' });
  }

  try {
    const adminUser = await pool.query('SELECT email FROM users WHERE id = $1 LIMIT 1', [req.session.userId]);
    const adminEmail = adminUser.rows[0]?.email || `User #${req.session.userId}`;

    const result = await updateFeatureStatus(
      featureKey,
      { status, is_visible, is_enabled, maintenance_mode, access_mode, maintenanceMessage, reason },
      req.session.userId,
      adminEmail
    );

    if (typeof invalidateExperienceConfigCache === 'function') {
      invalidateExperienceConfigCache();
    }

    await writeAuditLog(req, 'settings.feature_visibility.update', 'platform_settings', featureKey, {
      previousStatus: result.previousState?.status,
      newStatus: result.newState?.status,
      maintenanceMessage: result.newState?.maintenanceMessage,
      reason: reason || 'Admin manual toggle'
    });

    res.json({
      success: true,
      message: `Feature ${featureKey} status updated to ${status}`,
      result
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update feature status' });
  }
});

router.put('/settings', requirePermission('settings.manage'), async (req, res) => {
  const updates = req.body && typeof req.body === 'object' ? req.body : {};
  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: 'No settings payload found' });

  for (const key of keys) {
    await pool.query(
      `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (key)
       DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(updates[key]), req.session.userId]
    );
  }

  await writeAuditLog(req, 'settings.update', 'platform_settings', 'bulk', { keys });
  res.json({ message: 'Platform settings updated successfully', keys });
});

router.get('/experience-config', requirePermission('settings.manage'), async (_req, res) => {
  const result = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'student_experience_config' LIMIT 1");
  const config = deepMerge(DEFAULT_STUDENT_EXPERIENCE_CONFIG, result.rows[0]?.value_json || {});
  res.json({ config });
});

router.get('/live-hub-visibility', requirePermission('settings.manage'), async (_req, res) => {
  const config = normalizeLiveHubConfig(await readStudentExperienceConfig());
  const enabled = config.liveHub.enabled !== false;
  res.json({
    enabled,
    statusLabel: enabled
      ? 'Live Hub is enabled for students'
      : 'Live Hub is hidden behind Work in Progress message',
    message: enabled
      ? 'Students can open Live Hub normally.'
      : 'Students will see a Work in Progress screen instead of Live Hub.'
  });
});

router.put('/live-hub-visibility', requirePermission('settings.manage'), async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  const currentResult = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'student_experience_config' LIMIT 1");
  const currentConfig = deepMerge(DEFAULT_STUDENT_EXPERIENCE_CONFIG, currentResult.rows[0]?.value_json || {});
  const merged = {
    ...currentConfig,
    liveHub: {
      ...(currentConfig.liveHub || {}),
      enabled
    }
  };

  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ('student_experience_config', $1::jsonb, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(merged), req.session.userId]
  );

  await writeAuditLog(req, 'settings.live_hub_visibility.update', 'platform_settings', 'student_experience_config', { enabled });

  res.json({
    message: enabled
      ? 'Live Hub is enabled for students.'
      : 'Live Hub is now hidden behind the Work in Progress screen.',
    enabled,
    statusLabel: enabled
      ? 'Live Hub is enabled for students'
      : 'Live Hub is hidden behind Work in Progress message'
  });
});

router.put('/experience-config', requirePermission('settings.manage'), async (req, res) => {
  const payload = req.body && typeof req.body === 'object' ? req.body : null;
  if (!payload) return res.status(400).json({ error: 'config payload is required' });

  const currentResult = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'student_experience_config' LIMIT 1");
  const currentConfig = deepMerge(DEFAULT_STUDENT_EXPERIENCE_CONFIG, currentResult.rows[0]?.value_json || {});
  const merged = deepMerge(currentConfig, payload);

  if (Array.isArray(merged.liveHub?.sessions)) {
    const normalizedSessions = merged.liveHub.sessions.map((session, index) => normalizeGoLiveSession(session, index));
    const validationErrors = validateGoLiveSessions(normalizedSessions);
    if (validationErrors.length) {
      return res.status(400).json({
        error: 'Live Hub Go Live configuration is invalid',
        details: validationErrors
      });
    }
    merged.liveHub.sessions = normalizedSessions;
  }

  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ('student_experience_config', $1::jsonb, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(merged), req.session.userId]
  );

  await writeAuditLog(req, 'settings.student_experience.update', 'platform_settings', 'student_experience_config', {
    updatedRootKeys: Object.keys(payload)
  });

  res.json({ message: 'Student experience configuration updated successfully', config: merged });
});

router.get('/membership-config', requirePermission('settings.manage'), async (_req, res) => {
  const result = await pool.query("SELECT value_json FROM platform_settings WHERE key = 'membership_center_config' LIMIT 1");
  const config = deepMerge(DEFAULT_MEMBERSHIP_CENTER_CONFIG, result.rows[0]?.value_json || {});
  res.json({ config });
});

router.put('/membership-config', requirePermission('settings.manage'), async (req, res) => {
  const payload = req.body && typeof req.body === 'object' ? req.body : null;
  if (!payload) return res.status(400).json({ error: 'config payload is required' });

  const merged = deepMerge(DEFAULT_MEMBERSHIP_CENTER_CONFIG, payload);

  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ('membership_center_config', $1::jsonb, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(merged), _req.session.userId]
  );

  await writeAuditLog(_req, 'settings.membership_center.update', 'platform_settings', 'membership_center_config', {
    updatedRootKeys: Object.keys(payload)
  });

  res.json({ message: 'Membership center configuration updated successfully', config: merged });
});

// Student Feature Control System APIs
router.get('/feature-visibility', requireAdmin, async (_req, res) => {
  try {
    const matrix = await readFeatureMatrix();
    res.json({ success: true, matrix });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read feature matrix' });
  }
});

router.put('/feature-visibility', requireAdmin, async (req, res) => {
  try {
    const { featureKey, status, is_visible, is_enabled, maintenance_mode, access_mode, maintenanceMessage, reason } = req.body;
    if (!featureKey) return res.status(400).json({ error: 'featureKey is required' });

    const result = await updateFeatureStatus(
      featureKey,
      { status, is_visible, is_enabled, maintenance_mode, access_mode, maintenanceMessage, reason },
      req.session.userId,
      req.session.email || req.session.username || 'admin'
    );

    if (typeof invalidateExperienceConfigCache === 'function') {
      invalidateExperienceConfigCache();
    }

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update feature status' });
  }
});

// Audit Logs
router.get('/audit-logs', requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(toInt(req.query.limit, 50), 1), 500);
  const { rows } = await pool.query(
    `SELECT l.id, l.actor_user_id, u.full_name AS actor_name, l.actor_role, l.action,
            l.target_type, l.target_id, l.metadata, l.created_at
     FROM admin_audit_logs l
     LEFT JOIN users u ON u.id = l.actor_user_id
     ORDER BY l.created_at DESC
     LIMIT $1`,
    [limit]
  );

  res.json({ logs: rows });
});

/* ============================================================
 * PART 6: MEMBERSHIP PLAN & ENTITLEMENT MANAGEMENT ENDPOINTS
 * ============================================================ */

// GET /api/admin/control/memberships/plans - List all plans with subscriber counts and entitlements
router.get('/memberships/plans', requireAdmin, async (_req, res) => {
  try {
    await ensureMembershipSchema();

    const plansRes = await pool.query(`
      SELECT 
        p.id,
        p.code,
        p.name,
        p.description,
        p.price,
        p.currency,
        p.duration_value,
        p.duration_unit,
        p.status,
        p.is_purchasable,
        p.display_order,
        p.display_benefits,
        p.created_at,
        p.updated_at,
        COUNT(DISTINCT m.id)::int AS active_subscribers_count
      FROM membership_plans p
      LEFT JOIN memberships m ON m.plan_id = p.id AND m.status = 'ACTIVE'
      GROUP BY p.id
      ORDER BY p.display_order ASC, p.id ASC
    `);

    // Fetch entitlements per plan
    const entRes = await pool.query(`
      SELECT plan_id, feature_key, access_level 
      FROM membership_plan_entitlements
    `);

    const entitlementsMap = {};
    entRes.rows.forEach(r => {
      if (!entitlementsMap[r.plan_id]) entitlementsMap[r.plan_id] = [];
      entitlementsMap[r.plan_id].push(r.feature_key);
    });

    const plans = plansRes.rows.map(p => ({
      ...p,
      price: Number(p.price),
      display_benefits: Array.isArray(p.display_benefits) ? p.display_benefits : (typeof p.display_benefits === 'string' ? JSON.parse(p.display_benefits) : []),
      entitlements: entitlementsMap[p.id] || []
    }));

    res.json({ success: true, plans });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch membership plans', details: err.message });
  }
});

// POST /api/admin/control/memberships/plans - Create new membership plan
router.post('/memberships/plans', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const {
      code,
      name,
      description,
      price,
      currency = 'INR',
      duration_value = 30,
      duration_unit = 'DAYS',
      status = 'ACTIVE',
      is_purchasable = true,
      display_order = 0,
      display_benefits = [],
      entitlements = []
    } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }

    const cleanCode = String(code).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const numericPrice = Math.max(0, Number(price || 0));
    const cleanDuration = Math.max(1, parseInt(duration_value, 10) || 30);
    const validUnits = ['DAYS', 'MONTHS', 'YEARS'];
    const cleanUnit = validUnits.includes(String(duration_unit).toUpperCase()) ? String(duration_unit).toUpperCase() : 'DAYS';
    const validStatuses = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
    const cleanStatus = validStatuses.includes(String(status).toUpperCase()) ? String(status).toUpperCase() : 'ACTIVE';

    const insertRes = await pool.query(`
      INSERT INTO membership_plans (
        code, name, description, price, currency, duration_value, duration_unit, status, is_purchasable, display_order, display_benefits, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $12)
      RETURNING *
    `, [
      cleanCode,
      String(name).trim(),
      description ? String(description).trim() : '',
      numericPrice,
      String(currency).toUpperCase().slice(0, 10),
      cleanDuration,
      cleanUnit,
      cleanStatus,
      Boolean(is_purchasable),
      parseInt(display_order, 10) || 0,
      JSON.stringify(Array.isArray(display_benefits) ? display_benefits : []),
      req.session.userId
    ]);

    const createdPlan = insertRes.rows[0];

    // Save initial entitlements if provided
    if (Array.isArray(entitlements) && entitlements.length > 0) {
      for (const featKey of entitlements) {
        await pool.query(`
          INSERT INTO membership_plan_entitlements (plan_id, feature_key, access_level)
          VALUES ($1, $2, 'enabled')
          ON CONFLICT (plan_id, feature_key) DO NOTHING
        `, [createdPlan.id, featKey]);
      }
    }

    await writeAuditLog(req, 'membership_plan.create', 'membership_plans', createdPlan.id, {
      code: createdPlan.code,
      name: createdPlan.name,
      price: createdPlan.price
    });

    res.json({ success: true, message: 'Membership plan created successfully', plan: createdPlan });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'A membership plan with this plan code already exists.' });
    }
    res.status(500).json({ error: 'Failed to create membership plan', details: err.message });
  }
});

// PUT /api/admin/control/memberships/plans/:id - Update existing plan
router.put('/memberships/plans/:id', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const planId = parseInt(req.params.id, 10);
    if (!planId) return res.status(400).json({ error: 'Invalid plan ID' });

    const existingRes = await pool.query('SELECT * FROM membership_plans WHERE id = $1', [planId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Membership plan not found' });
    }
    const existing = existingRes.rows[0];

    const {
      name = existing.name,
      description = existing.description,
      price = existing.price,
      currency = existing.currency,
      duration_value = existing.duration_value,
      duration_unit = existing.duration_unit,
      status = existing.status,
      is_purchasable = existing.is_purchasable,
      display_order = existing.display_order,
      display_benefits = existing.display_benefits
    } = req.body;

    const numericPrice = Math.max(0, Number(price));
    const cleanDuration = Math.max(1, parseInt(duration_value, 10) || 30);
    const validUnits = ['DAYS', 'MONTHS', 'YEARS'];
    const cleanUnit = validUnits.includes(String(duration_unit).toUpperCase()) ? String(duration_unit).toUpperCase() : 'DAYS';
    const validStatuses = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'];
    const cleanStatus = validStatuses.includes(String(status).toUpperCase()) ? String(status).toUpperCase() : 'ACTIVE';

    const updateRes = await pool.query(`
      UPDATE membership_plans
      SET 
        name = $1,
        description = $2,
        price = $3,
        currency = $4,
        duration_value = $5,
        duration_unit = $6,
        status = $7,
        is_purchasable = $8,
        display_order = $9,
        display_benefits = $10::jsonb,
        updated_by = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *
    `, [
      String(name).trim(),
      String(description || '').trim(),
      numericPrice,
      String(currency).toUpperCase().slice(0, 10),
      cleanDuration,
      cleanUnit,
      cleanStatus,
      Boolean(is_purchasable),
      parseInt(display_order, 10) || 0,
      JSON.stringify(Array.isArray(display_benefits) ? display_benefits : []),
      req.session.userId,
      planId
    ]);

    const updatedPlan = updateRes.rows[0];

    await writeAuditLog(req, 'membership_plan.update', 'membership_plans', planId, {
      oldPrice: existing.price,
      newPrice: updatedPlan.price,
      oldStatus: existing.status,
      newStatus: updatedPlan.status
    });

    res.json({ success: true, message: 'Membership plan updated successfully', plan: updatedPlan });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update membership plan', details: err.message });
  }
});

// POST /api/admin/control/memberships/plans/:id/entitlements - Update plan entitlements
router.post('/memberships/plans/:id/entitlements', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const planId = parseInt(req.params.id, 10);
    if (!planId) return res.status(400).json({ error: 'Invalid plan ID' });

    const { entitlements = [] } = req.body;

    // Delete existing entitlements
    await pool.query('DELETE FROM membership_plan_entitlements WHERE plan_id = $1', [planId]);

    // Insert new entitlements
    if (Array.isArray(entitlements)) {
      for (const featKey of entitlements) {
        await pool.query(`
          INSERT INTO membership_plan_entitlements (plan_id, feature_key, access_level)
          VALUES ($1, $2, 'enabled')
          ON CONFLICT (plan_id, feature_key) DO NOTHING
        `, [planId, featKey]);
      }
    }

    await writeAuditLog(req, 'membership_plan.entitlements_update', 'membership_plans', planId, {
      entitlementsCount: entitlements.length,
      entitlements
    });

    res.json({ success: true, message: 'Plan entitlements updated successfully', entitlements });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan entitlements', details: err.message });
  }
});

// DELETE /api/admin/control/memberships/plans/:id - Archive or delete plan safely
router.delete('/memberships/plans/:id', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const planId = parseInt(req.params.id, 10);
    if (!planId) return res.status(400).json({ error: 'Invalid plan ID' });

    // Check for active subscribers or payments
    const activeSubRes = await pool.query('SELECT COUNT(*)::int AS count FROM memberships WHERE plan_id = $1', [planId]);
    const hasHistory = (activeSubRes.rows[0]?.count || 0) > 0;

    if (hasHistory) {
      // Soft-archive to preserve historical financial & activation records
      await pool.query(`
        UPDATE membership_plans 
        SET status = 'ARCHIVED', is_purchasable = FALSE, updated_at = CURRENT_TIMESTAMP 
        WHERE id = $1
      `, [planId]);

      await writeAuditLog(req, 'membership_plan.archive', 'membership_plans', planId, {
        reason: 'Plan archived due to existing user subscription history'
      });

      return res.json({ success: true, message: 'Plan has subscription history and was archived safely.', archived: true });
    }

    // Unused plan can be safely deleted
    await pool.query('DELETE FROM membership_plans WHERE id = $1', [planId]);
    await writeAuditLog(req, 'membership_plan.delete', 'membership_plans', planId, {});

    res.json({ success: true, message: 'Membership plan deleted permanently' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete membership plan', details: err.message });
  }
});

// GET /api/admin/control/memberships/active - Paginated active student memberships
router.get('/memberships/active', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
    const offset = (page - 1) * limit;

    const countRes = await pool.query("SELECT COUNT(*)::int AS total FROM memberships WHERE status = 'ACTIVE'");
    const total = countRes.rows[0]?.total || 0;

    const { rows } = await pool.query(`
      SELECT 
        m.id,
        m.student_id,
        u.email AS student_email,
        u.full_name AS student_name,
        m.plan_id,
        mp.code AS plan_code,
        mp.name AS plan_name,
        m.status,
        m.started_at,
        m.expires_at,
        m.source,
        m.price_at_activation
      FROM memberships m
      JOIN users u ON u.id = m.student_id
      LEFT JOIN membership_plans mp ON mp.id = m.plan_id
      WHERE m.status = 'ACTIVE'
      ORDER BY m.started_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({
      success: true,
      activeMemberships: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active memberships', details: err.message });
  }
});

/* ============================================================
 * PART 7: PRODUCTION PAYMENTS + UPI + QR + MANUAL VERIFICATION SYSTEM
 * ============================================================ */

const paymentQrUpload = createUploadMiddleware({
  maxFileSize: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
  allowedExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
  invalidTypeMessage: 'Only PNG, JPG, or WEBP image files are allowed for Payment QR Code.'
});

const DEFAULT_PAYMENT_SETTINGS = {
  payment_enabled: true,
  upi_id: 'shuklaabhayas0-1@okicici',
  payee_name: 'College OS',
  qr_image_url: '',
  instructions: [
    'Scan the QR code or copy the UPI ID.',
    'Pay the exact membership plan amount shown.',
    'Save transaction screenshot or receipt.',
    'Enter correct UTR / Reference ID.',
    'Submit payment for admin verification.'
  ],
  support_message: 'Membership activates automatically after admin approval.',
  verification_required: true
};

async function getPaymentSettings() {
  const { rows } = await pool.query(
    "SELECT value_json FROM platform_settings WHERE key = 'payment_settings_config' LIMIT 1"
  );

  if (rows.length > 0 && rows[0].value_json && typeof rows[0].value_json === 'object') {
    return { ...DEFAULT_PAYMENT_SETTINGS, ...rows[0].value_json };
  }

  return { ...DEFAULT_PAYMENT_SETTINGS };
}

// GET /api/admin/control/payments/settings - Fetch persistent payment configuration
router.get('/payments/settings', requireAdmin, async (_req, res) => {
  try {
    const settings = await getPaymentSettings();
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment settings', details: err.message });
  }
});

// PUT /api/admin/control/payments/settings - Update persistent payment configuration
router.put('/payments/settings', requireAdmin, async (req, res) => {
  try {
    const current = await getPaymentSettings();
    const {
      payment_enabled = current.payment_enabled,
      upi_id = current.upi_id,
      payee_name = current.payee_name,
      instructions = current.instructions,
      support_message = current.support_message,
      verification_required = current.verification_required
    } = req.body;

    const cleanUpiId = String(upi_id || '').trim();
    if (!cleanUpiId) {
      return res.status(400).json({ error: 'UPI ID is required' });
    }

    const updatedSettings = {
      ...current,
      payment_enabled: Boolean(payment_enabled),
      upi_id: cleanUpiId,
      payee_name: String(payee_name || 'College OS').trim(),
      instructions: Array.isArray(instructions) ? instructions : (typeof instructions === 'string' ? instructions.split('\n').filter(Boolean) : current.instructions),
      support_message: String(support_message || '').trim(),
      verification_required: Boolean(verification_required),
      updated_at: new Date().toISOString(),
      updated_by: req.session.userId
    };

    await pool.query(
      `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
       VALUES ('payment_settings_config', $1::jsonb, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(updatedSettings), req.session.userId]
    );

    await writeAuditLog(req, 'payment_settings.update', 'platform_settings', 'payment_settings_config', {
      payment_enabled: updatedSettings.payment_enabled,
      upi_id: updatedSettings.upi_id,
      payee_name: updatedSettings.payee_name
    });

    res.json({ success: true, message: 'Payment settings updated successfully', settings: updatedSettings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update payment settings', details: err.message });
  }
});

const handlePaymentQrUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return paymentQrUpload.single('qrImage')(req, res, next);
  }
  return next();
};

// POST /api/admin/control/payments/settings/qr - Upload/replace payment QR image
router.post('/payments/settings/qr', requireAdmin, handlePaymentQrUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'QR Code image file is required' });
    }

    const stored = await saveUploadedFile({
      file: req.file,
      folder: 'payment-settings/qr',
      prefix: 'payment-qr',
      userId: req.session.userId,
      uploadedBy: req.session.userId,
      entityType: 'payment_qr'
    });

    const current = await getPaymentSettings();
    const updatedSettings = {
      ...current,
      qr_image_url: stored.url,
      updated_at: new Date().toISOString(),
      updated_by: req.session.userId
    };

    await pool.query(
      `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
       VALUES ('payment_settings_config', $1::jsonb, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(updatedSettings), req.session.userId]
    );

    await writeAuditLog(req, 'payment_settings.qr_update', 'platform_settings', 'payment_settings_config', {
      qr_image_url: stored.url
    });

    res.json({ success: true, message: 'Payment QR image updated successfully', qr_image_url: stored.url, settings: updatedSettings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to upload Payment QR image', details: err.message });
  }
});

// GET /api/admin/control/payments/queue - Paginated pending verification queue with duplicate UTR detection
router.get('/payments/queue', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
    const offset = (page - 1) * limit;

    const countRes = await pool.query("SELECT COUNT(*)::int AS total FROM membership_payment_requests WHERE status = 'pending'");
    const total = countRes.rows[0]?.total || 0;

    const { rows } = await pool.query(`
      SELECT 
        m.id,
        m.user_id AS student_id,
        u.email AS student_email,
        u.full_name AS student_name,
        m.plan_id,
        m.amount_inr,
        m.payment_method,
        m.transaction_id AS utr_reference,
        m.screenshot_url AS proof_url,
        m.note,
        m.status,
        m.submitted_at,
        (
          SELECT COUNT(*)::int 
          FROM membership_payment_requests dup 
          WHERE UPPER(TRIM(dup.transaction_id)) = UPPER(TRIM(m.transaction_id)) 
            AND dup.id != m.id
        ) AS duplicate_utr_count
      FROM membership_payment_requests m
      JOIN users u ON u.id = m.user_id
      WHERE m.status = 'pending'
      ORDER BY m.submitted_at ASC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const queue = rows.map(r => ({
      ...r,
      amount_inr: Number(r.amount_inr),
      is_duplicate_utr: (r.duplicate_utr_count || 0) > 0
    }));

    res.json({
      success: true,
      pendingQueue: queue,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending payment queue', details: err.message });
  }
});

// GET /api/admin/control/payments/transactions - Paginated historical payment transactions
router.get('/payments/transactions', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
    const offset = (page - 1) * limit;
    const statusFilter = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim();

    let whereConditions = [];
    let queryParams = [];
    let paramIdx = 1;

    if (statusFilter && statusFilter !== 'all') {
      whereConditions.push(`m.status = $${paramIdx++}`);
      queryParams.push(statusFilter);
    }

    if (search) {
      whereConditions.push(`(
        u.email ILIKE $${paramIdx} 
        OR u.full_name ILIKE $${paramIdx} 
        OR m.transaction_id ILIKE $${paramIdx}
      )`);
      queryParams.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM membership_payment_requests m JOIN users u ON u.id = m.user_id ${whereClause}`, queryParams);
    const total = countRes.rows[0]?.total || 0;

    const query = `
      SELECT 
        m.id,
        m.user_id AS student_id,
        u.email AS student_email,
        u.full_name AS student_name,
        m.plan_id,
        m.amount_inr,
        m.payment_method,
        m.transaction_id AS utr_reference,
        m.screenshot_url AS proof_url,
        m.note,
        m.status,
        m.rejection_reason,
        m.submitted_at,
        m.approved_at,
        approver.full_name AS approved_by_name
      FROM membership_payment_requests m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN users approver ON approver.id = m.approved_by
      ${whereClause}
      ORDER BY m.submitted_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    queryParams.push(limit, offset);
    const { rows } = await pool.query(query, queryParams);

    res.json({
      success: true,
      transactions: rows.map(r => ({ ...r, amount_inr: Number(r.amount_inr) })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch payment transactions', details: err.message });
  }
});

// POST /api/admin/control/payments/:id/approve - Atomic approval transaction with Part 6 membership activation
router.post('/payments/:id/approve', requirePermission('verify_payments'), async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);
  if (!paymentId) return res.status(400).json({ error: 'Invalid payment ID' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock payment row & check status
    const payRes = await client.query(
      "SELECT * FROM membership_payment_requests WHERE id = $1 FOR UPDATE",
      [paymentId]
    );

    if (payRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment request not found' });
    }

    const payment = payRes.rows[0];
    if (payment.status === 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'PAYMENT_ALREADY_PROCESSED', message: 'This payment has already been approved.' });
    }

    // 2. Fetch authoritative plan details from DB or snapshot
    let planId = payment.plan_id;
    let durationValue = 30;
    let durationUnit = 'DAYS';
    let planName = payment.plan_name_snapshot || 'Premium Membership';
    let planPrice = Number(payment.amount_inr || 49);

    if (planId) {
      const planRes = await client.query("SELECT * FROM membership_plans WHERE id = $1", [planId]);
      if (planRes.rows.length > 0) {
        durationValue = planRes.rows[0].duration_value;
        durationUnit = planRes.rows[0].duration_unit;
        planName = planRes.rows[0].name;
        planPrice = Number(planRes.rows[0].price);
      }
    } else {
      const planRes = await client.query("SELECT * FROM membership_plans WHERE code = 'premium' LIMIT 1");
      if (planRes.rows.length > 0) {
        planId = planRes.rows[0].id;
        durationValue = planRes.rows[0].duration_value;
        durationUnit = planRes.rows[0].duration_unit;
        planName = planRes.rows[0].name;
        planPrice = Number(planRes.rows[0].price);
      }
    }

    let intervalString = `${durationValue} days`;
    if (durationUnit === 'MONTHS') intervalString = `${durationValue} months`;
    if (durationUnit === 'YEARS') intervalString = `${durationValue} years`;

    // 3. Deactivate old active membership for student
    await client.query("UPDATE memberships SET status = 'EXPIRED', updated_at = CURRENT_TIMESTAMP WHERE student_id = $1 AND status = 'ACTIVE'", [payment.user_id]);

    // 4. Create active membership in `memberships` table
    const memRes = await client.query(`
      INSERT INTO memberships (student_id, plan_id, status, started_at, expires_at, source, plan_name_at_activation, price_at_activation)
      VALUES ($1, $2, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($3::interval), 'PAYMENT', $4, $5)
      RETURNING id, expires_at
    `, [payment.user_id, planId, intervalString, planName, planPrice]);

    const createdMembership = memRes.rows[0];

    // 5. Update student user flags
    await client.query(`
      UPDATE users
      SET subscription_tier = 'premium',
          payment_status = 'approved',
          subscription_started_at = CURRENT_TIMESTAMP,
          subscription_expiry = $1
      WHERE id = $2
    `, [createdMembership.expires_at, payment.user_id]);

    // 6. Update payment request status & link membership ID
    await client.query(`
      UPDATE membership_payment_requests
      SET status = 'approved',
          approved_at = CURRENT_TIMESTAMP,
          approved_by = $1,
          expiry_date = $2,
          membership_id = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
    `, [req.session.userId, createdMembership.expires_at, createdMembership.id, paymentId]);

    // 7. Write Audit Log
    await client.query(`
      INSERT INTO admin_audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata)
      VALUES ($1, 'admin', 'payment.approve', 'membership_payment_requests', $2, $3::jsonb)
    `, [
      req.session.userId,
      paymentId,
      JSON.stringify({
        studentId: payment.user_id,
        amount: payment.amount_inr,
        transactionId: payment.transaction_id,
        membershipId: createdMembership.id
      })
    ]);

    await client.query('COMMIT');

    // Async notification (failsafe, outside transaction)
    pool.query('INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)', [
      payment.user_id,
      'Your payment has been approved! Your premium membership is now active.',
      'payment_approved'
    ]).catch(() => {});

    res.json({
      success: true,
      message: 'Payment approved and membership activated atomically.',
      paymentId,
      membershipId: createdMembership.id,
      expiresAt: createdMembership.expires_at
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to approve payment', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/admin/control/payments/:id/reject - Reject pending payment with mandatory reason
router.post('/payments/:id/reject', requirePermission('verify_payments'), async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);
  const reason = String(req.body.reason || '').trim();

  if (!paymentId) return res.status(400).json({ error: 'Invalid payment ID' });
  if (!reason) return res.status(400).json({ error: 'Rejection reason is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const payRes = await client.query(
      "SELECT * FROM membership_payment_requests WHERE id = $1 FOR UPDATE",
      [paymentId]
    );

    if (payRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Payment request not found' });
    }

    const payment = payRes.rows[0];
    if (payment.status === 'rejected') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'PAYMENT_ALREADY_PROCESSED', message: 'This payment has already been rejected.' });
    }

    await client.query(`
      UPDATE membership_payment_requests
      SET status = 'rejected',
          rejection_reason = $1,
          approved_by = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
    `, [reason, req.session.userId, paymentId]);

    await client.query(`
      UPDATE users
      SET payment_status = 'rejected'
      WHERE id = $1 AND (subscription_tier IS NULL OR subscription_tier = 'free')
    `, [payment.user_id]);

    await client.query(`
      INSERT INTO admin_audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata)
      VALUES ($1, 'admin', 'payment.reject', 'membership_payment_requests', $2, $3::jsonb)
    `, [
      req.session.userId,
      paymentId,
      JSON.stringify({
        studentId: payment.user_id,
        reason,
        transactionId: payment.transaction_id
      })
    ]);

    await client.query('COMMIT');

    // Async notification
    pool.query('INSERT INTO notifications (user_id, message, kind) VALUES ($1, $2, $3)', [
      payment.user_id,
      `Your payment verification was not approved: ${reason}`,
      'payment_rejected'
    ]).catch(() => {});

    res.json({
      success: true,
      message: 'Payment rejected successfully.',
      paymentId,
      reason
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to reject payment', details: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.ensureAdminControlSchema = ensureAdminControlSchema;
module.exports.getPaymentSettings = getPaymentSettings;


