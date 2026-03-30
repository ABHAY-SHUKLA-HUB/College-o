const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { resolveMembershipState } = require('../middleware/auth');
const { buildLearnerBrainPayload } = require('../services/intelligence-brain');

const router = express.Router();

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

async function readStudentExperienceConfig() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(120) PRIMARY KEY,
      value_json JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [experienceRow, featureRow] = await Promise.all([
    pool.query("SELECT value_json FROM platform_settings WHERE key = 'student_experience_config' LIMIT 1"),
    pool.query("SELECT value_json FROM platform_settings WHERE key = 'feature_toggles' LIMIT 1")
  ]);

  const baseConfig = deepMerge(DEFAULT_STUDENT_EXPERIENCE_CONFIG, experienceRow.rows[0]?.value_json || {});
  const featureToggles = featureRow.rows[0]?.value_json || {};

  const mergedFeatureFlags = {
    ...baseConfig.featureFlags,
    aiTools: typeof featureToggles.aiTools === 'boolean' ? featureToggles.aiTools : baseConfig.featureFlags.aiTools,
    mockTests: typeof featureToggles.mockTests === 'boolean' ? featureToggles.mockTests : baseConfig.featureFlags.mockTests,
    roadmapSystem: typeof featureToggles.roadmaps === 'boolean' ? featureToggles.roadmaps : baseConfig.featureFlags.roadmapSystem
  };

  return {
    ...baseConfig,
    featureFlags: mergedFeatureFlags
  };
}

router.get('/stats', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  const [xpData, certData, roadmapData, notesData, streakData] = await Promise.all([
    pool.query('SELECT COALESCE(SUM(xp_earned), 0) AS xp FROM quiz_attempts WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*)::int AS count FROM certificates WHERE user_id = $1', [userId]),
    pool.query('SELECT COALESCE(MAX(progress), 0) AS progress FROM roadmaps WHERE user_id = $1', [userId]),
    pool.query("SELECT COUNT(*)::int AS count FROM notes WHERE created_by = $1 AND bookmarks IS NOT NULL", [userId]),
    pool.query('SELECT current_streak FROM user_profiles WHERE user_id = $1', [userId])
  ]);

  return res.json({
    xp: Number(xpData.rows[0].xp),
    certificates: certData.rows[0].count,
    roadmapProgress: Number(roadmapData.rows[0].progress),
    savedNotes: notesData.rows[0].count,
    streak: streakData.rows[0]?.current_streak || 0
  });
});

router.get('/personalized', requireAuth, async (req, res) => {
  const userId = req.session.userId;

  let intelligence = null;
  try {
    intelligence = await buildLearnerBrainPayload(userId, { horizonDays: 7 });
  } catch {
    intelligence = null;
  }

  const [profileResult, statsResult, membership] = await Promise.all([
    pool.query(
      `SELECT up.category_id, up.branch_id, up.semester_id, up.career_interest, up.learning_goals,
              u.full_name, u.subscription_tier,
              ac.name AS category_name,
              ab.name AS branch_name,
              sem.label AS semester_label
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN academic_categories ac ON ac.id = up.category_id
       LEFT JOIN academic_branches ab ON ab.id = up.branch_id
       LEFT JOIN academic_semesters sem ON sem.id = up.semester_id
       WHERE u.id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT
        COALESCE((SELECT SUM(xp_earned) FROM quiz_attempts WHERE user_id = $1), 0)::int AS xp,
        COALESCE((SELECT current_streak FROM user_profiles WHERE user_id = $1), 0)::int AS streak,
        COALESCE((SELECT MAX(progress) FROM roadmaps WHERE user_id = $1), 0)::int AS roadmap_progress,
        (SELECT COUNT(*)::int FROM certificates WHERE user_id = $1) AS certificates,
        (SELECT COUNT(*)::int FROM notes WHERE created_by = $1 AND bookmarks IS NOT NULL) AS saved_notes`,
      [userId]
    ),
    resolveMembershipState(userId)
  ]);

  const profile = profileResult.rows[0] || {};
  const stats = statsResult.rows[0] || {};
  const isPremium = Boolean(membership?.premiumActive || membership?.isAdmin);

  const params = [];
  const branchClauses = [];
  if (profile.category_id) {
    params.push(profile.category_id);
    branchClauses.push(`(category_id IS NULL OR category_id = $${params.length})`);
  }
  if (profile.branch_id) {
    params.push(profile.branch_id);
    branchClauses.push(`(branch_id IS NULL OR branch_id = $${params.length})`);
  }
  if (profile.semester_id) {
    params.push(profile.semester_id);
    branchClauses.push(`(semester_id IS NULL OR semester_id = $${params.length})`);
  }

  const scopedWhere = branchClauses.length ? `AND ${branchClauses.join(' AND ')}` : '';
  const accessClause = isPremium ? '' : `AND COALESCE(access_type, 'free') <> 'premium'`;

  const [recommendedNotes, recommendedQuizzes, recommendedMockTests, recommendedRoadmaps, aiTools, announcements] = await Promise.all([
    pool.query(
      `SELECT id, subject, chapter, access_type
       FROM notes
       WHERE deleted_at IS NULL AND status = 'published'
       ${scopedWhere}
       ${accessClause}
       ORDER BY created_at DESC
       LIMIT 5`,
      params
    ),
    pool.query(
      `SELECT id, subject, chapter, difficulty, access_type
       FROM quizzes
       WHERE deleted_at IS NULL AND status = 'published'
       ${scopedWhere}
       ${accessClause}
       ORDER BY created_at DESC
       LIMIT 5`,
      params
    ),
    pool.query(
      `SELECT id, title, subject, difficulty, access_type
       FROM mock_tests
       WHERE deleted_at IS NULL AND status = 'published'
       ${scopedWhere}
       ${accessClause}
       ORDER BY created_at DESC
       LIMIT 5`,
      params
    ),
    pool.query(
      `SELECT id, title, career_track, access_type, is_featured
       FROM career_roadmaps
       WHERE deleted_at IS NULL AND is_published = TRUE AND status = 'published'
       ${scopedWhere}
       ${accessClause}
       ORDER BY is_featured DESC, sort_order ASC
       LIMIT 4`,
      params
    ),
    pool.query(
      `SELECT id, tool_key, title, tagline, access_type, is_featured
       FROM ai_tools_catalog
       WHERE deleted_at IS NULL AND is_enabled = TRUE AND is_visible = TRUE AND status = 'published'
       ${scopedWhere}
       ${accessClause}
       ORDER BY is_featured DESC, sort_order ASC
       LIMIT 6`,
      params
    ),
    pool.query(
      `SELECT id, title, message, created_at
       FROM announcements
       WHERE deleted_at IS NULL AND status = 'published'
       ${scopedWhere}
       ORDER BY created_at DESC
       LIMIT 5`,
      params
    )
  ]);

  const goals = Array.isArray(profile.learning_goals) ? profile.learning_goals : [];
  const goalText = goals.length ? goals.join(', ') : 'Improve core subjects';

  res.json({
    profile: {
      fullName: profile.full_name || 'Student',
      categoryId: profile.category_id || null,
      branchId: profile.branch_id || null,
      semesterId: profile.semester_id || null,
      categoryName: profile.category_name || null,
      branchName: profile.branch_name || null,
      semesterLabel: profile.semester_label || null,
      careerInterest: profile.career_interest || null,
      learningGoals: goals
    },
    membership: {
      tier: membership?.tier || profile.subscription_tier || 'free',
      premiumActive: isPremium,
      status: membership?.status || 'free',
      statusLabel: membership?.statusLabel || 'Free'
    },
    stats: {
      xp: Number(stats.xp || 0),
      streak: Number(stats.streak || 0),
      roadmapProgress: Number(stats.roadmap_progress || 0),
      certificates: Number(stats.certificates || 0),
      savedNotes: Number(stats.saved_notes || 0)
    },
    hero: {
      title: `Welcome back, ${String(profile.full_name || 'Student').split(' ')[0]}`,
      subtitle: profile.branch_name
        ? `Your ${profile.branch_name} dashboard is personalized for ${goalText.toLowerCase()}.`
        : 'Complete your academic profile to unlock full branch-based personalization.'
    },
    sections: {
      recommendedNotes: recommendedNotes.rows,
      recommendedQuizzes: recommendedQuizzes.rows,
      recommendedMockTests: recommendedMockTests.rows,
      recommendedRoadmaps: recommendedRoadmaps.rows,
      aiSuggestions: aiTools.rows,
      announcements: announcements.rows,
      todaysTasks: [
        { key: 'task_notes', label: `Revise one ${profile.branch_name || 'core'} note` },
        { key: 'task_quiz', label: 'Attempt one targeted quiz' },
        { key: 'task_goal', label: `Focus on: ${goalText}` }
      ]
    },
    intelligence: intelligence
      ? {
          nextAction: intelligence.nextAction,
          analytics: intelligence.aiBrain?.advancedAnalytics,
          personalization: intelligence.personalization,
          monetization: intelligence.monetization,
          retention: intelligence.retention,
          gamification: intelligence.gamification,
          studyPlan: intelligence.studyPlan
        }
      : null
  });
});

router.get('/experience-config', requireAuth, async (req, res) => {
  const [config, announcements] = await Promise.all([
    readStudentExperienceConfig(),
    pool.query(
      `SELECT id, title, message, created_at
       FROM announcements
       WHERE deleted_at IS NULL AND status = 'published'
         AND (branch_id IS NULL OR branch_id = (SELECT branch_id FROM user_profiles WHERE user_id = $1))
       ORDER BY created_at DESC
       LIMIT 6`,
      [req.session.userId]
    )
  ]);

  res.json({
    config,
    announcements: announcements.rows
  });
});

module.exports = router;
