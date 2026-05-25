const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { resolveMembershipState } = require('../middleware/auth');
const { buildLearnerBrainPayload } = require('../services/intelligence-brain');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

const router = express.Router();
let experienceSettingsPromise = null;

function setPrivateCacheHeaders(res, maxAgeSeconds = 10) {
  res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}, stale-while-revalidate=${Math.max(maxAgeSeconds * 3, 30)}`);
  res.setHeader('Vary', 'Cookie');
}

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

function normalizeSessionId(value) {
  return String(value || '').trim();
}

function normalizeIdentityToken(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLiveHubConfig(config) {
  const liveHub = isObject(config.liveHub) ? config.liveHub : {};
  return {
    ...config,
    liveHub: {
      enabled: liveHub.enabled !== false,
      title: String(liveHub.title || 'Unified Live Hub'),
      subtitle: String(liveHub.subtitle || 'Mentorship sessions and hands-on labs in one place.'),
      mentorshipCycleDays: Number(liveHub.mentorshipCycleDays || 15),
      labCycleDays: Number(liveHub.labCycleDays || 7),
      defaultProvider: String(liveHub.defaultProvider || 'jitsi').toLowerCase(),
      sidebarLabel: String(liveHub.sidebarLabel || 'Live Hub'),
      activeSessionId: String(liveHub.activeSessionId || ''),
      sessions: Array.isArray(liveHub.sessions) ? liveHub.sessions : []
    }
  };
}

async function saveStudentExperienceConfig(config, updatedBy = null) {
  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ('student_experience_config', $1::jsonb, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(config), updatedBy]
  );
}

function mentorAccessMatches(session, accessId, isAdmin) {
  if (isAdmin) return true;
  const expected = normalizeSessionId(session?.mentorAccessId || session?.liveAccessId || session?.accessId);
  if (!expected) return false;
  return expected === normalizeSessionId(accessId);
}

async function mentorProfileMatchesUser(session, userId) {
  const expected = normalizeIdentityToken(
    session?.assignedHostUserRef
    || session?.assignedHostEmail
    || session?.assignedHostUserId
    || session?.assignedHostUid
    || session?.mentorProfileKey
    || session?.mentorUid
    || session?.mentorEmail
    || session?.mentorUserId
  );
  if (!expected) return true;

  const { rows } = await pool.query(
    'SELECT id, uid, email, full_name FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
  const user = rows[0];
  if (!user) return false;

  const candidates = new Set([
    normalizeIdentityToken(user.id),
    normalizeIdentityToken(user.uid),
    normalizeIdentityToken(user.email),
    normalizeIdentityToken(user.full_name),
    normalizeIdentityToken(String(user.full_name || '').replace(/\s+/g, '.'))
  ].filter(Boolean));

  return candidates.has(expected);
}

function buildAgoraRtcToken({ appId, appCertificate, channelName, uid = 0, role = 'subscriber', expireSeconds = 3600 }) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expireAt = nowSeconds + Math.max(300, Number(expireSeconds) || 3600);
  const roleValue = String(role).toLowerCase() === 'publisher'
    ? (RtcRole.PUBLISHER ?? RtcRole.Role_Publisher ?? 1)
    : (RtcRole.SUBSCRIBER ?? RtcRole.Role_Subscriber ?? 2);
  return RtcTokenBuilder.buildTokenWithUid(
    String(appId),
    String(appCertificate),
    String(channelName),
    Number(uid) || 0,
    roleValue,
    expireAt
  );
}

async function updateLiveHubSession(sessionId, updater, updatedBy) {
  const config = normalizeLiveHubConfig(await readStudentExperienceConfig());
  const sessions = Array.isArray(config.liveHub.sessions) ? [...config.liveHub.sessions] : [];
  const index = sessions.findIndex((session) => normalizeSessionId(session.id) === normalizeSessionId(sessionId));
  if (index < 0) return null;

  const nextSession = updater({ ...sessions[index] });
  sessions[index] = nextSession;
  const nextActiveSessionId = nextSession.status === 'live'
    ? nextSession.id
    : (normalizeSessionId(config.liveHub.activeSessionId) === normalizeSessionId(nextSession.id) ? '' : config.liveHub.activeSessionId);

  const nextConfig = {
    ...config,
    liveHub: {
      ...config.liveHub,
      sessions,
      activeSessionId: nextActiveSessionId,
      lastUpdatedAt: new Date().toISOString()
    }
  };

  await saveStudentExperienceConfig(nextConfig, updatedBy);
  return { config: nextConfig, session: nextSession };
}

async function readStudentExperienceConfig() {
  if (!experienceSettingsPromise) {
    experienceSettingsPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key VARCHAR(120) PRIMARY KEY,
        value_json JSONB NOT NULL,
        updated_by INTEGER REFERENCES users(id),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  await experienceSettingsPromise;

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
  setPrivateCacheHeaders(res, 10);

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
  setPrivateCacheHeaders(res, 10);

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
  setPrivateCacheHeaders(res, 15);
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

router.post('/live-hub/start', requireAuth, async (req, res) => {
  const sessionId = normalizeSessionId(req.body?.sessionId);
  const accessId = normalizeSessionId(req.body?.accessId);
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const isAdmin = req.session.role === 'admin' || req.session.role === 'super_admin';
  const config = normalizeLiveHubConfig(await readStudentExperienceConfig());
  const targetSession = (config.liveHub.sessions || []).find((item) => normalizeSessionId(item.id) === sessionId);
  if (!targetSession) return res.status(404).json({ error: 'Session not found' });

  if (!isAdmin) {
    const profileMatch = await mentorProfileMatchesUser(targetSession, req.session.userId);
    if (!profileMatch) {
      return res.status(403).json({ error: 'This host code is not assigned to your portal account' });
    }
  }

  const result = await updateLiveHubSession(sessionId, (session) => {
    if (!mentorAccessMatches(session, accessId, isAdmin)) {
      const error = new Error('Invalid host access code');
      error.status = 403;
      throw error;
    }
    return {
      ...session,
      status: 'live',
      liveStartedAt: new Date().toISOString(),
      liveEndedAt: null,
      liveStartedBy: req.session.userId,
      liveAccessValidatedAt: new Date().toISOString()
    };
  }, req.session.userId).catch((error) => ({ error }));

  if (result.error) {
    const status = Number(result.error.status || 500);
    return res.status(status).json({ error: result.error.message || 'Unable to start live session' });
  }

  return res.json({ message: 'Session started successfully', ...result });
});

router.post('/live-hub/end', requireAuth, async (req, res) => {
  const sessionId = normalizeSessionId(req.body?.sessionId);
  const accessId = normalizeSessionId(req.body?.accessId);
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const isAdmin = req.session.role === 'admin' || req.session.role === 'super_admin';
  const config = normalizeLiveHubConfig(await readStudentExperienceConfig());
  const targetSession = (config.liveHub.sessions || []).find((item) => normalizeSessionId(item.id) === sessionId);
  if (!targetSession) return res.status(404).json({ error: 'Session not found' });

  if (!isAdmin) {
    const profileMatch = await mentorProfileMatchesUser(targetSession, req.session.userId);
    if (!profileMatch) {
      return res.status(403).json({ error: 'This host code is not assigned to your portal account' });
    }
  }

  const result = await updateLiveHubSession(sessionId, (session) => {
    if (!mentorAccessMatches(session, accessId, isAdmin)) {
      const error = new Error('Invalid host access code');
      error.status = 403;
      throw error;
    }
    return {
      ...session,
      status: 'completed',
      liveEndedAt: new Date().toISOString(),
      liveEndedBy: req.session.userId
    };
  }, req.session.userId).catch((error) => ({ error }));

  if (result.error) {
    const status = Number(result.error.status || 500);
    return res.status(status).json({ error: result.error.message || 'Unable to end live session' });
  }

  return res.json({ message: 'Session ended successfully', ...result });
});

router.post('/live-hub/agora-token', requireAuth, async (req, res) => {
  const sessionId = normalizeSessionId(req.body?.sessionId || req.query?.sessionId);
  const accessId = normalizeSessionId(req.body?.accessId || req.query?.accessId);
  const uid = Number(req.body?.uid || req.query?.uid || req.session.userId || 0) || 0;
  const isAdmin = req.session.role === 'admin' || req.session.role === 'super_admin';

  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const appId = String(process.env.AGORA_APP_ID || '').trim();
  const appCertificate = String(process.env.AGORA_APP_CERTIFICATE || '').trim();
  if (!appId || !appCertificate) {
    return res.status(503).json({ error: 'Agora is not configured on this server' });
  }

  const config = normalizeLiveHubConfig(await readStudentExperienceConfig());
  const session = (config.liveHub.sessions || []).find((item) => normalizeSessionId(item.id) === sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const profileMatch = isAdmin ? true : await mentorProfileMatchesUser(session, req.session.userId);
  const canPublish = mentorAccessMatches(session, accessId, isAdmin) && profileMatch;
  const role = canPublish ? 'publisher' : 'subscriber';
  const channelName = session.roomId || session.id;
  const token = buildAgoraRtcToken({
    appId,
    appCertificate,
    channelName,
    uid,
    role,
    expireSeconds: 3600
  });

  return res.json({
    appId,
    channelName,
    uid,
    token,
    role,
    canPublish,
    sessionId: session.id
  });
});

module.exports = router;
module.exports.readStudentExperienceConfig = readStudentExperienceConfig;
