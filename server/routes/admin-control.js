const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { ensureUniversityCatalogSchema } = require('../utils/universities');
const { readStudentExperienceConfig, normalizeLiveHubConfig } = require('./dashboard');
const { invalidateUniversityCatalogCache } = require('./meta');
const { publishRealtimeEvent, publishContentChanged } = require('../services/realtimeBus');

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
  const inputStatus = String(session?.status || '').trim();
  const status = normalizeGoLiveStatus(inputStatus === 'scheduled' && mentorAccessId ? 'ready' : inputStatus);

  return {
    ...session,
    id: String(session?.id || `${type}-${index + 1}`).trim(),
    type,
    mentorName: String(session?.mentorName || '').trim(),
    mentorAccessId,
    mentorProfileKey: String(session?.mentorProfileKey || session?.mentorUid || session?.mentorEmail || session?.mentorUserId || '').trim(),
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

async function writeAuditLog(req, action, targetType, targetId, metadata = {}) {
  const actor = await pool.query('SELECT admin_role FROM users WHERE id = $1', [req.session.userId]);
  const actorRole = actor.rows[0]?.admin_role || 'super_admin';

  await pool.query(
    `INSERT INTO admin_audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)` ,
    [req.session.userId, actorRole, action, targetType || null, targetId ? String(targetId) : null, metadata]
  );
}

async function getCurrentAdminContext(req) {
  const { rows } = await pool.query(
    'SELECT id, role, admin_role FROM users WHERE id = $1',
    [req.session.userId]
  );
  return rows[0] || null;
}

function requirePermission(permission) {
  return async (req, res, next) => {
    const admin = await getCurrentAdminContext(req);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }

    const effectiveRole = admin.admin_role || 'super_admin';
    if (effectiveRole === 'super_admin') return next();

    const rolePerm = await pool.query(
      'SELECT permissions FROM admin_permissions WHERE admin_role = $1',
      [effectiveRole]
    );

    const perms = rolePerm.rows[0]?.permissions || [];
    if (perms.includes('*') || perms.includes(permission)) return next();

    return res.status(403).json({ error: `Permission denied: ${permission}` });
  };
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
  const admin = await getCurrentAdminContext(req);
  if (!admin) return res.status(401).json({ error: 'Authentication required' });
  const role = admin.admin_role || 'super_admin';
  const permResult = await pool.query('SELECT permissions FROM admin_permissions WHERE admin_role = $1', [role]);
  const permissions = permResult.rows[0]?.permissions || (role === 'super_admin' ? ['*'] : []);
  res.json({ role, permissions });
});

// Student Management
router.get('/students', requirePermission('students.view'), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const membership = String(req.query.membership || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toLowerCase();
  const collegeId = toInt(req.query.collegeId);
  const courseId = toInt(req.query.courseId);
  const branchId = toInt(req.query.branchId);
  const semesterId = toInt(req.query.semesterId);
  const includeDeleted = toBoolean(req.query.includeDeleted);

  const params = [];
  const clauses = ["u.role = 'student'"];

  if (!includeDeleted) {
    clauses.push('u.deleted_at IS NULL');
  }

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR COALESCE(u.uid, '') ILIKE $${params.length})`);
  }

  if (membership) {
    params.push(membership);
    clauses.push(`LOWER(u.subscription_tier) = $${params.length}`);
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

  const { rows } = await pool.query(
    `SELECT
      u.id, u.uid, u.full_name, u.email, u.role, u.subscription_tier, u.payment_status,
      u.subscription_started_at, u.subscription_expiry, u.last_login_at, u.created_at AS signup_date,
      COALESCE(u.last_login_user_agent, (
        SELECT ase.user_agent
        FROM auth_security_events ase
        WHERE ase.user_id = u.id AND ase.user_agent IS NOT NULL
        ORDER BY ase.created_at DESC
        LIMIT 1
      )) AS device,
      u.is_suspended, u.is_blocked, u.deleted_at,
      up.category_id, up.branch_id, up.semester_id, up.college_id, up.course_id, up.year_id,
      up.onboarding_completed, up.onboarding_step,
      ac.name AS category_name,
      ab.name AS branch_name,
      asr.label AS semester_label,
      col.name AS college_name,
      cou.name AS course_name,
      yr.label AS year_label,
      COUNT(qa.id)::int AS quizzes_attempted,
      COALESCE(SUM(qa.xp_earned), 0)::int AS xp,
      COALESCE(ROUND(AVG(qa.score_percent), 2), 0) AS avg_score
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN academic_categories ac ON ac.id = up.category_id
     LEFT JOIN academic_branches ab ON ab.id = up.branch_id
     LEFT JOIN academic_semesters asr ON asr.id = up.semester_id
     LEFT JOIN academic_colleges col ON col.id = up.college_id
     LEFT JOIN academic_courses cou ON cou.id = up.course_id
     LEFT JOIN academic_years yr ON yr.id = up.year_id
     LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
     ${where}
     GROUP BY u.id, up.id, ac.name, ab.name, asr.label, col.name, cou.name, yr.label
     ORDER BY u.created_at DESC
     LIMIT 500`,
    params
  );

  res.json({ students: rows });
});

router.get('/students/:id', requirePermission('students.view'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  if (studentId < 1) return res.status(400).json({ error: 'Invalid student id' });

  const [student, profile, payments, referrals, feedback] = await Promise.all([
    pool.query(
      `SELECT id, uid, full_name, email, role, subscription_tier, payment_status,
              subscription_started_at, subscription_expiry, last_login_at, created_at AS signup_date,
              COALESCE(last_login_user_agent, (
                SELECT ase.user_agent
                FROM auth_security_events ase
                WHERE ase.user_id = u.id AND ase.user_agent IS NOT NULL
                ORDER BY ase.created_at DESC
                LIMIT 1
              )) AS device,
              is_suspended, is_blocked, deleted_at
       FROM users u
       WHERE id = $1`,
      [studentId]
    ),
    pool.query(
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
    pool.query(
      `SELECT id, payment_method, transaction_id, amount_inr, status, submitted_at, approved_at
       FROM membership_payment_requests
       WHERE user_id = $1
       ORDER BY submitted_at DESC
       LIMIT 20`,
      [studentId]
    ),
    pool.query(
      `SELECT id, code_used, status, is_blocked, reward_points, created_at
       FROM referrals
       WHERE referrer_user_id = $1 OR referred_user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [studentId]
    ),
    pool.query(
      `SELECT id, rating, message, admin_reply, status, is_resolved, created_at
       FROM feedback
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [studentId]
    )
  ]);

  if (!student.rows[0] || student.rows[0].role !== 'student') {
    return res.status(404).json({ error: 'Student not found' });
  }

  res.json({
    student: student.rows[0],
    profile: profile.rows[0] || null,
    payments: payments.rows,
    referrals: referrals.rows,
    feedback: feedback.rows
  });
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
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2 AND role = \'student\'', [hash, studentId]);

  await writeAuditLog(req, 'student.reset_password', 'student', studentId);
  publishContentChanged('student', 'updated', studentId, { userId: studentId, kind: 'password_reset' });
  res.json({ message: 'Student password reset successfully' });
});

router.post('/students/:id/status', requirePermission('students.manage'), async (req, res) => {
  const studentId = toInt(req.params.id, -1);
  const status = String(req.body.status || '').toLowerCase();
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

  await writeAuditLog(req, 'student.status_change', 'student', studentId, { status });
  publishContentChanged('students', 'updated', studentId, { userId: studentId, status });
  res.json({ message: `Student status updated to ${status}` });
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
    'UPDATE users SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND role = \'student\'',
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
    query = 'UPDATE users SET is_suspended = TRUE, is_blocked = FALSE WHERE id = ANY($1::int[]) AND role = \'student\'';
  } else if (action === 'block') {
    query = 'UPDATE users SET is_blocked = TRUE, is_suspended = FALSE WHERE id = ANY($1::int[]) AND role = \'student\'';
  } else if (action === 'activate') {
    query = 'UPDATE users SET is_blocked = FALSE, is_suspended = FALSE WHERE id = ANY($1::int[]) AND role = \'student\'';
  } else if (action === 'delete') {
    query = 'UPDATE users SET deleted_at = NOW(), deleted_by = $2 WHERE id = ANY($1::int[]) AND role = \'student\'';
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
  await pool.query('UPDATE roadmaps SET is_published = TRUE WHERE id = $1', [roadmapId]);
  await writeAuditLog(req, 'roadmap.publish', 'roadmap', roadmapId);
  publishContentChanged('roadmaps', 'published', roadmapId);
  res.json({ message: 'Roadmap published' });
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

// Audit Logs
router.get('/audit-logs', requirePermission('reports.view'), async (req, res) => {
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

module.exports = router;
module.exports.ensureAdminControlSchema = ensureAdminControlSchema;
