const { pool } = require('../db/pool');
const { resolveMembershipState } = require('../middleware/auth');

let schemaReady = false;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function daysBetween(isoDate) {
  if (!isoDate) return 999;
  const start = new Date(isoDate);
  if (Number.isNaN(start.getTime())) return 999;
  const diff = Date.now() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

async function ensureSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS learner_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type VARCHAR(100) NOT NULL,
      source VARCHAR(80) DEFAULT 'web',
      event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_key VARCHAR(120) NOT NULL,
      intent VARCHAR(80),
      tokens_used INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      success BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS learner_state_snapshots (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      snapshot_json JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS next_action_log (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action_key VARCHAR(120) NOT NULL,
      action_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      score NUMERIC(8,4) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_progress (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mission_key VARCHAR(120) NOT NULL,
      progress NUMERIC(8,2) NOT NULL DEFAULT 0,
      target NUMERIC(8,2) NOT NULL DEFAULT 1,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      reward_json JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, mission_key, status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS growth_shares (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      share_type VARCHAR(80) NOT NULL,
      share_channel VARCHAR(80),
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  schemaReady = true;
}

async function getLearnerBaseSignals(userId) {
  const [profileRes, statsRes, weakRes, trendRes, aiRes] = await Promise.all([
    pool.query(
      `SELECT u.full_name, u.subscription_tier, u.last_login_at, u.created_at,
              up.current_streak, up.career_interest, up.learning_goals, up.preferred_study_mode
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT
        COALESCE((SELECT SUM(xp_earned) FROM quiz_attempts WHERE user_id = $1), 0)::int AS xp,
        COALESCE((SELECT COUNT(*) FROM quiz_attempts WHERE user_id = $1), 0)::int AS quiz_attempts,
        COALESCE((SELECT COUNT(*) FROM mock_test_attempts WHERE user_id = $1), 0)::int AS mock_attempts,
        COALESCE((SELECT COUNT(*) FROM notes WHERE created_by = $1), 0)::int AS note_events,
        COALESCE((SELECT COUNT(*) FROM certificates WHERE user_id = $1), 0)::int AS certificates,
        COALESCE((SELECT MAX(progress) FROM roadmaps WHERE user_id = $1), 0)::numeric AS roadmap_progress,
        COALESCE((SELECT AVG(score_percent) FROM quiz_attempts WHERE user_id = $1), 0)::numeric AS avg_quiz_score,
        COALESCE((SELECT AVG(percentile) FROM mock_test_attempts WHERE user_id = $1), 0)::numeric AS avg_mock_percentile,
        COALESCE((SELECT COUNT(*) FROM referrals WHERE referrer_user_id = $1), 0)::int AS referrals
      `,
      [userId]
    ),
    pool.query(
      `SELECT
         COALESCE(q.subject, 'General') AS topic,
         COUNT(*)::int AS attempts,
         COALESCE(AVG(qa.score_percent), 0)::numeric(6,2) AS avg_score,
         COALESCE(MAX(qa.attempted_at), CURRENT_TIMESTAMP) AS last_attempt_at
       FROM quiz_attempts qa
       LEFT JOIN quizzes q ON q.id = qa.quiz_id
       WHERE qa.user_id = $1
       GROUP BY COALESCE(q.subject, 'General')
       HAVING COUNT(*) >= 2
       ORDER BY avg_score ASC, attempts DESC
       LIMIT 6`,
      [userId]
    ),
    pool.query(
      `SELECT
         DATE(qa.attempted_at) AS day,
         COUNT(*)::int AS quiz_attempts,
         COALESCE(AVG(qa.score_percent), 0)::numeric(6,2) AS avg_score
       FROM quiz_attempts qa
       WHERE qa.user_id = $1 AND qa.attempted_at >= CURRENT_DATE - INTERVAL '13 days'
       GROUP BY DATE(qa.attempted_at)
       ORDER BY day ASC`,
      [userId]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(tokens_used), 0)::int AS tokens,
         COALESCE(COUNT(*), 0)::int AS runs
       FROM ai_usage_events
       WHERE user_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '29 days'`,
      [userId]
    )
  ]);

  return {
    profile: profileRes.rows[0] || {},
    stats: statsRes.rows[0] || {},
    weakTopics: weakRes.rows || [],
    trends: trendRes.rows || [],
    aiUsage: aiRes.rows[0] || { tokens: 0, runs: 0 }
  };
}

function buildAdvancedAnalytics(signals) {
  const avgQuiz = toNumber(signals.stats.avg_quiz_score);
  const roadmapProgress = toNumber(signals.stats.roadmap_progress);
  const streak = toNumber(signals.profile.current_streak);
  const activeDays = signals.trends.length;
  const avgMock = toNumber(signals.stats.avg_mock_percentile);

  const weakTopicScore = signals.weakTopics.length
    ? clamp(100 - signals.weakTopics.reduce((sum, item) => sum + toNumber(item.avg_score), 0) / signals.weakTopics.length, 0, 100)
    : clamp(55 - avgQuiz * 0.2, 0, 100);

  const consistencyScore = clamp((activeDays / 14) * 100 + streak * 3, 0, 100);
  const focusScore = clamp(
    avgQuiz * 0.35 + avgMock * 0.25 + roadmapProgress * 0.2 + consistencyScore * 0.2,
    0,
    100
  );

  const learningTrend = signals.trends.length >= 2
    ? toNumber(signals.trends[signals.trends.length - 1].avg_score) - toNumber(signals.trends[0].avg_score)
    : 0;

  return {
    focusScore: Math.round(focusScore),
    consistencyScore: Math.round(consistencyScore),
    weakTopicScore: Math.round(weakTopicScore),
    learningTrend: Number(learningTrend.toFixed(2)),
    weakTopicDetection: signals.weakTopics.map((row) => ({
      topic: row.topic,
      attempts: toNumber(row.attempts),
      avgScore: toNumber(row.avg_score),
      risk: toNumber(row.avg_score) < 55 ? 'high' : toNumber(row.avg_score) < 70 ? 'medium' : 'low'
    }))
  };
}

function buildPersonalizationModel(signals, analytics) {
  const attempts = toNumber(signals.stats.quiz_attempts) + toNumber(signals.stats.mock_attempts);
  const streak = toNumber(signals.profile.current_streak);
  const avgScore = toNumber(signals.stats.avg_quiz_score);
  const createdDaysAgo = daysBetween(signals.profile.created_at);

  let archetype = 'explorer';
  if (createdDaysAgo <= 7) archetype = 'starter';
  if (attempts >= 25 && avgScore >= 68) archetype = 'accelerator';
  if (streak >= 10 && avgScore >= 75) archetype = 'competitive';
  if (analytics.consistencyScore < 35 || daysBetween(signals.profile.last_login_at) >= 3) archetype = 'recovery';

  const dashboardVariant = {
    starter: 'guided_onboarding',
    explorer: 'balanced_mixed',
    accelerator: 'deep_work_mode',
    competitive: 'challenge_mode',
    recovery: 'low_friction_reentry'
  }[archetype] || 'balanced_mixed';

  const learningGoals = Array.isArray(signals.profile.learning_goals)
    ? signals.profile.learning_goals
    : [];

  return {
    archetype,
    dashboardVariant,
    preferredStudyMode: signals.profile.preferred_study_mode || 'Self paced',
    careerInterest: signals.profile.career_interest || null,
    learningGoals,
    dynamicModules: {
      hero: true,
      nextAction: true,
      weakTopics: analytics.weakTopicDetection.length > 0,
      mockDrills: attempts >= 5,
      aiCoach: true,
      leaderboardPush: archetype === 'competitive'
    }
  };
}

function buildNextActionEngine(signals, analytics, personalization) {
  const weak = analytics.weakTopicDetection[0] || null;
  const roadmapProgress = toNumber(signals.stats.roadmap_progress);
  const inactivityDays = daysBetween(signals.profile.last_login_at);

  const candidates = [
    {
      key: 'recovery_sprint',
      title: 'Complete a 12-minute comeback sprint',
      description: 'Quick quiz + one revision note to restore momentum.',
      ctaLabel: 'Start Recovery Sprint',
      ctaHref: 'quiz-library.html',
      score: inactivityDays >= 3 ? 0.92 : 0.38,
      rationale: 'You have been inactive recently. Short wins improve return rate.'
    },
    {
      key: 'weak_topic_drill',
      title: weak ? `Fix weak topic: ${weak.topic}` : 'Run a focused weak-topic drill',
      description: weak
        ? `Your average score in ${weak.topic} is ${Math.round(weak.avgScore)}%.`
        : 'Target your lowest-confidence subject with an adaptive quiz.',
      ctaLabel: 'Start Topic Drill',
      ctaHref: 'quiz-library.html',
      score: weak ? clamp((100 - weak.avgScore) / 100 + 0.35, 0, 0.97) : 0.52,
      rationale: 'Weak-topic correction gives the highest immediate mastery lift.'
    },
    {
      key: 'roadmap_milestone',
      title: 'Complete your next roadmap milestone',
      description: `Current roadmap completion is ${Math.round(roadmapProgress)}%. Keep sequence continuity.`,
      ctaLabel: 'Continue Roadmap',
      ctaHref: 'study-roadmap.html',
      score: clamp(0.7 - roadmapProgress / 240, 0.25, 0.84),
      rationale: 'Sequenced progression improves long-term completion and retention.'
    },
    {
      key: 'ai_plan_refresh',
      title: 'Generate today\'s adaptive study plan with AI Coach',
      description: 'Refresh plan using your recent performance and consistency trend.',
      ctaLabel: 'Generate Plan',
      ctaHref: 'ai-tools.html#planner',
      score: personalization.archetype === 'accelerator' || personalization.archetype === 'competitive' ? 0.83 : 0.48,
      rationale: 'High-intent users convert better when AI planning is surfaced early.'
    }
  ];

  candidates.sort((a, b) => b.score - a.score);
  const primary = candidates[0];

  return {
    primary,
    alternatives: candidates.slice(1, 3),
    decisionMeta: {
      candidateCount: candidates.length,
      decisionFatigueReduction: true,
      generatedAt: new Date().toISOString()
    }
  };
}

function buildGamification2(signals, analytics) {
  const xp = toNumber(signals.stats.xp);
  const level = Math.floor(xp / 500) + 1;
  const levelFloor = (level - 1) * 500;
  const levelCeil = level * 500;
  const progressToNextLevel = Math.round(((xp - levelFloor) / Math.max(1, levelCeil - levelFloor)) * 100);

  const missions = [
    {
      key: 'mission_consistency_7',
      title: '7-day consistency mission',
      target: 7,
      progress: clamp(toNumber(signals.profile.current_streak), 0, 7),
      reward: { xp: 180, unlock: 'Streak Shield' }
    },
    {
      key: 'mission_weak_topic',
      title: 'Improve weak-topic score by +12%',
      target: 12,
      progress: clamp(Math.round((100 - analytics.weakTopicScore) / 4), 0, 12),
      reward: { xp: 220, unlock: 'Precision Drill Pack' }
    },
    {
      key: 'mission_mock_mastery',
      title: 'Complete 3 mock tests this week',
      target: 3,
      progress: clamp(toNumber(signals.stats.mock_attempts), 0, 3),
      reward: { xp: 260, unlock: 'Advanced Analytics Lens' }
    }
  ];

  return {
    level,
    totalXp: xp,
    progressToNextLevel,
    unlocks: {
      aiDeepReview: level >= 3,
      examCrunchMode: level >= 5,
      premiumTrialBoost: level >= 4
    },
    missions
  };
}

function buildMonetizationState(signals, membership, nextAction) {
  const monthlyRuns = toNumber(signals.aiUsage.runs);
  const monthlyTokens = toNumber(signals.aiUsage.tokens);
  const isPremium = Boolean(membership?.premiumActive || membership?.isAdmin);
  const monthlyLimit = isPremium ? 1200 : 120;
  const tokenLimit = isPremium ? 600000 : 60000;

  const aiUsagePercent = Math.round((monthlyRuns / Math.max(1, monthlyLimit)) * 100);
  const tokenUsagePercent = Math.round((monthlyTokens / Math.max(1, tokenLimit)) * 100);
  const triggerUpgrade = !isPremium && (aiUsagePercent >= 70 || nextAction.primary.key === 'ai_plan_refresh');

  return {
    tier: membership?.tier || 'free',
    premiumActive: isPremium,
    aiUsage: {
      runsThisMonth: monthlyRuns,
      runLimit: monthlyLimit,
      tokensThisMonth: monthlyTokens,
      tokenLimit,
      usagePercent: aiUsagePercent,
      tokenUsagePercent
    },
    conversionTrigger: triggerUpgrade
      ? {
          type: 'value_moment',
          message: 'You are approaching AI limits while high-intent. Offer adaptive plan upgrade now.',
          recommendedOffer: '7-day Pro trial with AI quota boost'
        }
      : null,
    premiumGates: {
      deepWeakTopicAnalysis: !isPremium,
      adaptiveMockBlueprint: !isPremium,
      interviewReadinessCopilot: !isPremium
    }
  };
}

function buildRetentionState(signals, analytics) {
  const inactivityDays = daysBetween(signals.profile.last_login_at);
  const streak = toNumber(signals.profile.current_streak);

  const churnRisk = clamp(
    inactivityDays * 14 + (100 - analytics.consistencyScore) * 0.55 + (streak < 2 ? 12 : 0),
    0,
    100
  );

  const flows = [];
  if (inactivityDays >= 2) {
    flows.push({
      key: 'nudge_d2',
      channel: 'in_app+push',
      copy: 'Complete one 10-minute action to preserve streak momentum.'
    });
  }
  if (inactivityDays >= 5) {
    flows.push({
      key: 'comeback_challenge',
      channel: 'email+push',
      copy: 'Your weak-topic comeback challenge is ready with bonus XP.'
    });
  }

  return {
    inactivityDays,
    churnRisk: Math.round(churnRisk),
    streakRecovery: {
      eligible: streak > 0 && inactivityDays <= 2,
      message: streak > 0 ? 'Use streak shield before midnight to avoid losing streak.' : 'Start a new streak with one quick mission today.'
    },
    reengagementFlows: flows
  };
}

function buildStudyPlan(signals, nextAction, days = 7) {
  const plan = [];
  const weakTopic = nextAction.primary.key === 'weak_topic_drill'
    ? nextAction.primary.title.replace('Fix weak topic: ', '')
    : 'Core subject drill';

  for (let day = 1; day <= days; day += 1) {
    const isRecoveryDay = day % 3 === 0;
    plan.push({
      day,
      title: isRecoveryDay ? 'Consolidation and review' : 'Focused execution block',
      objective: isRecoveryDay ? 'Reinforce previous errors and close weak loops.' : `Progress on ${weakTopic} and roadmap milestone`,
      blocks: [
        { type: 'quiz', minutes: isRecoveryDay ? 18 : 25, action: 'Targeted topic drill' },
        { type: 'notes', minutes: 15, action: 'Revision summary + bookmarking' },
        { type: 'roadmap', minutes: isRecoveryDay ? 12 : 18, action: 'Milestone progression task' },
        { type: 'ai', minutes: 10, action: 'AI reflection and next-step planning' }
      ],
      successMetric: isRecoveryDay ? '>= 70% recall score' : '>= 75% session completion'
    });
  }

  return {
    horizonDays: days,
    generatedAt: new Date().toISOString(),
    primaryGoal: 'Increase mastery while preserving daily consistency',
    plan
  };
}

async function persistSnapshot(userId, payload) {
  await pool.query(
    `INSERT INTO learner_state_snapshots (user_id, snapshot_json, updated_at)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id)
     DO UPDATE SET snapshot_json = EXCLUDED.snapshot_json, updated_at = CURRENT_TIMESTAMP`,
    [userId, JSON.stringify(payload)]
  );
}

async function logNextAction(userId, nextAction) {
  await pool.query(
    `INSERT INTO next_action_log (user_id, action_key, action_payload, score)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [
      userId,
      nextAction.primary.key,
      JSON.stringify(nextAction.primary),
      toNumber(nextAction.primary.score)
    ]
  );
}

async function buildLearnerBrainPayload(userId, options = {}) {
  await ensureSchema();

  const signals = await getLearnerBaseSignals(userId);
  const membership = await resolveMembershipState(userId);

  const analytics = buildAdvancedAnalytics(signals);
  const personalization = buildPersonalizationModel(signals, analytics);
  const nextAction = buildNextActionEngine(signals, analytics, personalization);
  const gamification = buildGamification2(signals, analytics);
  const monetization = buildMonetizationState(signals, membership, nextAction);
  const retention = buildRetentionState(signals, analytics);
  const studyPlan = buildStudyPlan(signals, nextAction, options.horizonDays || 7);

  const payload = {
    userId,
    generatedAt: new Date().toISOString(),
    aiBrain: {
      behaviorSignals: {
        quizAttempts: toNumber(signals.stats.quiz_attempts),
        mockAttempts: toNumber(signals.stats.mock_attempts),
        noteEvents: toNumber(signals.stats.note_events),
        avgQuizScore: toNumber(signals.stats.avg_quiz_score),
        avgMockPercentile: toNumber(signals.stats.avg_mock_percentile),
        roadmapProgress: toNumber(signals.stats.roadmap_progress)
      },
      weakAreaDetection: analytics.weakTopicDetection,
      advancedAnalytics: analytics
    },
    nextAction,
    personalization,
    gamification,
    monetization,
    retention,
    studyPlan
  };

  await Promise.all([persistSnapshot(userId, payload), logNextAction(userId, nextAction)]);

  return payload;
}

async function recordLearnerEvent(userId, eventType, source = 'web', eventPayload = {}) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO learner_events (user_id, event_type, source, event_payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [userId, eventType, source, JSON.stringify(eventPayload || {})]
  );
}

async function recordAiUsage(userId, data = {}) {
  await ensureSchema();
  await pool.query(
    `INSERT INTO ai_usage_events (user_id, tool_key, intent, tokens_used, duration_ms, success)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      String(data.toolKey || 'general_ai_tool'),
      data.intent ? String(data.intent) : null,
      clamp(toNumber(data.tokensUsed, 0), 0, 1000000),
      clamp(toNumber(data.durationMs, 0), 0, 3600000),
      data.success !== false
    ]
  );
}

async function buildAdminIntelligenceOverview() {
  await ensureSchema();

  const [userStats, weakTopics, monetization, retention, aiOps] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total_users,
         COUNT(*) FILTER (WHERE role = 'student')::int AS total_students,
         COUNT(*) FILTER (WHERE subscription_tier = 'premium')::int AS premium_users,
         COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::int AS new_users_30d
       FROM users`
    ),
    pool.query(
      `SELECT COALESCE(q.subject, 'General') AS topic,
              COUNT(*)::int AS attempts,
              COALESCE(AVG(qa.score_percent), 0)::numeric(6,2) AS avg_score
       FROM quiz_attempts qa
       LEFT JOIN quizzes q ON q.id = qa.quiz_id
       WHERE qa.attempted_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY COALESCE(q.subject, 'General')
       HAVING COUNT(*) >= 5
       ORDER BY avg_score ASC, attempts DESC
       LIMIT 10`
    ),
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE subscription_tier = 'premium')::int AS premium_total,
         COUNT(*) FILTER (WHERE payment_status = 'pending_approval')::int AS payment_pending,
         COUNT(*) FILTER (WHERE payment_status = 'rejected')::int AS payment_rejected
       FROM users`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS at_risk
       FROM users
       WHERE last_login_at IS NULL OR last_login_at < CURRENT_DATE - INTERVAL '5 days'`
    ),
    pool.query(
      `SELECT
         COALESCE(COUNT(*), 0)::int AS ai_runs_30d,
         COALESCE(SUM(tokens_used), 0)::int AS ai_tokens_30d
       FROM ai_usage_events
       WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'`
    )
  ]);

  return {
    generatedAt: new Date().toISOString(),
    users: userStats.rows[0] || {},
    weakTopicHeatmap: weakTopics.rows || [],
    monetization: monetization.rows[0] || {},
    retention: retention.rows[0] || {},
    aiOperations: aiOps.rows[0] || {},
    recommendations: [
      'Prioritize AI-generated revision packs for top 3 weak topics by attempt volume.',
      'Trigger conversion flow for users crossing 70% free AI quota.',
      'Run streak-recovery campaign for users inactive >= 5 days.'
    ]
  };
}

module.exports = {
  ensureSchema,
  buildLearnerBrainPayload,
  buildAdminIntelligenceOverview,
  recordLearnerEvent,
  recordAiUsage
};
