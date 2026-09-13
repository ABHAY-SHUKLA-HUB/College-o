const { pool } = require('../db/pool');
const logger = require('../services/logger');

/**
 * COLLEGE OS — CENTRAL STUDENT FEATURE REGISTRY
 * 17 Discovered Student Capabilities mapped cleanly to Admin Module IDs
 */
const STUDENT_FEATURE_REGISTRY = [
  {
    key: 'study_materials',
    label: 'Study Materials',
    description: 'Curated course materials, syllabus notes, and lecture resources.',
    studentRoute: '/materials-library.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-03',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Study materials library is under maintenance.',
    defaultAccessMode: 'EVERYONE',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'notes_library',
    label: 'Notes Library',
    description: 'Community and verified student notes repository.',
    studentRoute: '/notes-library.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-04',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Notes library is under maintenance.',
    defaultAccessMode: 'EVERYONE',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'previous_papers',
    label: 'Previous Papers',
    description: 'University and college past exam question papers.',
    studentRoute: '/previous-papers.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-05',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Previous papers archive is under maintenance.',
    defaultAccessMode: 'EVERYONE',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'quizzes',
    label: 'Quizzes',
    description: 'Subject-wise diagnostic quizzes and practice assessments.',
    studentRoute: '/quiz-library.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-06',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Quiz practice is under maintenance.',
    defaultAccessMode: 'EVERYONE',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'mock_tests',
    label: 'Mock Test Studio',
    description: 'Full-length practice exams and timed mock tests.',
    studentRoute: '/mock-tests.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-07',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Mock Test Studio is under maintenance.',
    defaultAccessMode: 'EVERYONE',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'study_roadmaps',
    label: 'Study Roadmaps',
    description: 'Personalized career and academic learning paths.',
    studentRoute: '/study-roadmap.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-08',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Study roadmaps system is under maintenance.',
    defaultAccessMode: 'EVERYONE',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'academic_structure',
    label: 'Academic Structure',
    description: 'Branch selection, category setup, and semester mapping.',
    studentRoute: '/academic-profile-setup.html',
    navigationSection: 'Main',
    adminModuleId: 'ADM-09',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Academic structure mapping is under maintenance.',
    defaultAccessMode: 'AUTHENTICATED',
    supportsMembershipRestriction: false,
    supportsMaintenanceMode: true
  },
  {
    key: 'coding_challenges',
    label: 'Coding Challenges',
    description: 'Algorithmic contests, code execution, and practice problems.',
    studentRoute: '/coding-challenges.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-14',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Coding challenges system is under maintenance.',
    defaultAccessMode: 'EVERYONE',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'certificates',
    label: 'Certificates & Credentials',
    description: 'Earned certificates, verification badges, and credentials.',
    studentRoute: '/certificates.html',
    navigationSection: 'Account',
    adminModuleId: 'ADM-13',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Certificates portal is under maintenance.',
    defaultAccessMode: 'AUTHENTICATED',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'student_contributions',
    label: 'Student Contributions',
    description: 'Student academic uploads, note sharing, and review hub.',
    studentRoute: '/academic-contribution-hub.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-12',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Student contribution hub is under maintenance.',
    defaultAccessMode: 'AUTHENTICATED',
    supportsMembershipRestriction: false,
    supportsMaintenanceMode: true
  },
  {
    key: 'campus_feed',
    label: 'Campus Feed',
    description: 'College discussions, news, updates, and community posts.',
    studentRoute: '/college-feed.html',
    navigationSection: 'Community',
    adminModuleId: 'ADM-16',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Campus feed is under maintenance.',
    defaultAccessMode: 'AUTHENTICATED',
    supportsMembershipRestriction: false,
    supportsMaintenanceMode: true
  },
  {
    key: 'ai_tools',
    label: 'AI Tools Studio',
    description: 'AI-assisted study notes, quiz generators, and career helpers.',
    studentRoute: '/ai-tools.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-17',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'AI Tools Studio is under maintenance.',
    defaultAccessMode: 'MEMBERSHIP_REQUIRED',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'support',
    label: 'Support Governance',
    description: 'Peer academic help, ticket creation, and support hub.',
    studentRoute: '/support-hub.html',
    navigationSection: 'Community',
    adminModuleId: 'ADM-15',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Support system is under maintenance.',
    defaultAccessMode: 'AUTHENTICATED',
    supportsMembershipRestriction: false,
    supportsMaintenanceMode: true
  },
  {
    key: 'live_sessions',
    label: 'Live Sessions',
    description: 'Mentorship webinars, live labs, and instructor sessions.',
    studentRoute: '/live-hub.html',
    navigationSection: 'Learning',
    adminModuleId: 'ADM-21',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Live Sessions Hub is under maintenance.',
    defaultAccessMode: 'AUTHENTICATED',
    supportsMembershipRestriction: true,
    supportsMaintenanceMode: true
  },
  {
    key: 'referrals',
    label: 'Referrals & Rewards',
    description: 'Invite classmates and earn platform points and rewards.',
    studentRoute: '/referrals.html',
    navigationSection: 'Account',
    adminModuleId: 'ADM-22',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Referrals center is under maintenance.',
    defaultAccessMode: 'AUTHENTICATED',
    supportsMembershipRestriction: false,
    supportsMaintenanceMode: true
  },
  {
    key: 'student_experience',
    label: 'Student Experience',
    description: 'Product feedback, feature requests, and discussion forum.',
    studentRoute: '/feedback.html',
    navigationSection: 'Community',
    adminModuleId: 'ADM-23',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Student experience portal is under maintenance.',
    defaultAccessMode: 'AUTHENTICATED',
    supportsMembershipRestriction: false,
    supportsMaintenanceMode: true
  },
  {
    key: 'membership',
    label: 'Memberships & Subscriptions',
    description: 'Pro membership, billing, plans, and feature unlocks.',
    studentRoute: '/pricing.html',
    navigationSection: 'Account',
    adminModuleId: 'ADM-11',
    defaultVisible: true,
    defaultEnabled: true,
    defaultMaintenance: false,
    defaultMaintenanceMessage: 'Student membership center is under maintenance.',
    defaultAccessMode: 'EVERYONE',
    supportsMembershipRestriction: false,
    supportsMaintenanceMode: true
  }
];

const DEFAULT_FEATURE_MATRIX = STUDENT_FEATURE_REGISTRY.reduce((acc, feat) => {
  acc[feat.key] = {
    key: feat.key,
    label: feat.label,
    description: feat.description,
    studentRoute: feat.studentRoute,
    navigationSection: feat.navigationSection,
    adminModuleId: feat.adminModuleId,
    status: feat.defaultEnabled ? 'ON' : 'OFF',
    is_visible: feat.defaultVisible,
    is_enabled: feat.defaultEnabled,
    maintenance_mode: feat.defaultMaintenance,
    maintenance_message: feat.defaultMaintenanceMessage,
    access_mode: feat.defaultAccessMode,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system'
  };
  return acc;
}, {});

// System infrastructure features that cannot be disabled via Student Feature Toggles
const PROTECTED_INFRASTRUCTURE_KEYS = new Set([
  'login', 'auth', 'session', 'csrf', 'password_reset', 'security'
]);

let featureMatrixCache = null;
let featureMatrixCacheTime = 0;
const CACHE_TTL_MS = 5000; // 5 seconds cache TTL

function invalidateFeatureCache() {
  featureMatrixCache = null;
  featureMatrixCacheTime = 0;
}

async function readFeatureMatrix(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && featureMatrixCache && (now - featureMatrixCacheTime) < CACHE_TTL_MS) {
    return featureMatrixCache;
  }

  try {
    const { rows } = await pool.query(
      "SELECT value_json FROM platform_settings WHERE key = 'feature_visibility_matrix' LIMIT 1"
    );

    let matrix = { ...DEFAULT_FEATURE_MATRIX };
    if (rows.length > 0 && rows[0].value_json && typeof rows[0].value_json === 'object') {
      // Merge stored rows over defaults, guaranteeing missing keys are filled in from registry
      Object.keys(DEFAULT_FEATURE_MATRIX).forEach((k) => {
        const stored = rows[0].value_json[k];
        if (stored && typeof stored === 'object') {
          const is_visible = stored.is_visible !== undefined ? Boolean(stored.is_visible) : (stored.status !== 'HIDDEN');
          const maintenance_mode = stored.maintenance_mode !== undefined ? Boolean(stored.maintenance_mode) : (stored.status === 'MAINTENANCE');
          const is_enabled = stored.is_enabled !== undefined ? Boolean(stored.is_enabled) : (stored.status === 'ON');

          matrix[k] = {
            ...DEFAULT_FEATURE_MATRIX[k],
            ...stored,
            is_visible,
            is_enabled,
            maintenance_mode,
            status: maintenance_mode ? 'MAINTENANCE' : (is_enabled ? 'ON' : 'OFF')
          };
        }
      });
    }

    featureMatrixCache = matrix;
    featureMatrixCacheTime = now;
    return matrix;
  } catch (error) {
    logger.error('[FeatureToggle] Failed to read feature visibility matrix from database', { error: error.message });
    return featureMatrixCache || DEFAULT_FEATURE_MATRIX;
  }
}

function resolveEffectiveFeatureState(featureConfig, userContext = null) {
  const visible = featureConfig.is_visible !== false;
  const enabled = featureConfig.is_enabled !== false;
  const maintenance = Boolean(featureConfig.maintenance_mode);
  const accessMode = featureConfig.access_mode || 'EVERYONE';

  let accessible = visible && enabled && !maintenance;
  let reason = null;

  if (!visible) {
    reason = 'FEATURE_HIDDEN';
    accessible = false;
  } else if (maintenance) {
    reason = 'FEATURE_MAINTENANCE';
    accessible = false;
  } else if (!enabled) {
    reason = 'FEATURE_DISABLED';
    accessible = false;
  } else if (accessMode === 'AUTHENTICATED' && (!userContext || !userContext.userId)) {
    reason = 'UNAUTHENTICATED';
    accessible = false;
  } else if (accessMode === 'MEMBERSHIP_REQUIRED') {
    const isMember = userContext && (
      userContext.role === 'admin'
      || userContext.role === 'super_admin'
      || userContext.isPaidMember === true
      || userContext.subscriptionStatus === 'active'
    );
    if (!isMember) {
      reason = 'MEMBERSHIP_REQUIRED';
      accessible = false;
    }
  }

  return {
    key: featureConfig.key,
    label: featureConfig.label,
    studentRoute: featureConfig.studentRoute,
    navigationSection: featureConfig.navigationSection,
    adminModuleId: featureConfig.adminModuleId,
    visible,
    enabled,
    maintenance,
    accessMode,
    accessibleForCurrentStudent: accessible,
    unavailableReason: reason,
    maintenanceMessage: featureConfig.maintenance_message || featureConfig.defaultMaintenanceMessage || 'This feature is temporarily unavailable.'
  };
}

async function getEffectiveFeatureMatrix(userContext = null) {
  const matrix = await readFeatureMatrix();
  const effective = {};
  Object.keys(matrix).forEach((key) => {
    effective[key] = resolveEffectiveFeatureState(matrix[key], userContext);
  });
  return effective;
}

async function updateFeatureStatus(rawFeatureKey, payload = {}, actorUserId = null, actorEmail = 'admin') {
  const featureKey = KEY_ALIASES[rawFeatureKey] || rawFeatureKey;
  if (PROTECTED_INFRASTRUCTURE_KEYS.has(featureKey)) {
    throw new Error(`Cannot modify system infrastructure feature: ${featureKey}`);
  }

  if (!DEFAULT_FEATURE_MATRIX[featureKey]) {
    throw new Error(`Invalid student feature key: ${rawFeatureKey}`);
  }

  const currentMatrix = await readFeatureMatrix();
  const previousState = currentMatrix[featureKey] || DEFAULT_FEATURE_MATRIX[featureKey];

  // Parse controls cleanly
  let is_visible = previousState.is_visible;
  if (payload.is_visible !== undefined) {
    is_visible = Boolean(payload.is_visible);
  } else if (payload.status === 'HIDDEN') {
    is_visible = false;
  }

  let is_enabled = previousState.is_enabled;
  if (payload.is_enabled !== undefined) {
    is_enabled = Boolean(payload.is_enabled);
  } else if (payload.status === 'OFF') {
    is_enabled = false;
  } else if (payload.status === 'ON') {
    is_enabled = true;
  }

  let maintenance_mode = previousState.maintenance_mode;
  if (payload.maintenance_mode !== undefined) {
    maintenance_mode = Boolean(payload.maintenance_mode);
  } else if (payload.status === 'MAINTENANCE') {
    maintenance_mode = true;
  } else if (payload.status === 'ON' || payload.status === 'OFF') {
    maintenance_mode = false;
  }

  const access_mode = payload.access_mode
    ? String(payload.access_mode).toUpperCase()
    : (previousState.access_mode || 'EVERYONE');

  const validAccessModes = ['EVERYONE', 'AUTHENTICATED', 'MEMBERSHIP_REQUIRED', 'SPECIFIC_ENTITLEMENT'];
  if (!validAccessModes.includes(access_mode)) {
    throw new Error(`Invalid access_mode: ${payload.access_mode}. Allowed: ${validAccessModes.join(', ')}`);
  }

  const maintenance_message = payload.maintenanceMessage != null
    ? String(payload.maintenanceMessage).trim()
    : (payload.maintenance_message != null ? String(payload.maintenance_message).trim() : previousState.maintenance_message);

  const status = maintenance_mode ? 'MAINTENANCE' : (is_enabled ? 'ON' : 'OFF');

  const updatedFeature = {
    ...previousState,
    status,
    is_visible,
    is_enabled,
    maintenance_mode,
    access_mode,
    maintenance_message,
    maintenanceMessage: maintenance_message,
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail || `User #${actorUserId}`
  };

  const nextMatrix = {
    ...currentMatrix,
    [featureKey]: updatedFeature
  };

  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ('feature_visibility_matrix', $1::jsonb, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [JSON.stringify(nextMatrix), actorUserId]
  );

  try {
    await pool.query(
      `INSERT INTO admin_audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        actorUserId || null,
        'admin',
        'settings.feature_visibility.update',
        'platform_settings',
        featureKey,
        JSON.stringify({
          previousState,
          newState: updatedFeature,
          reason: payload.reason || 'Admin Student Feature Control update'
        })
      ]
    );
  } catch (logErr) {
    logger.warn('[FeatureToggle] Failed to record audit log', { error: logErr.message });
  }

  invalidateFeatureCache();

  return {
    featureKey,
    previousState,
    newState: updatedFeature
  };
}

const KEY_ALIASES = {
  contributions: 'student_contributions',
  feedback: 'student_experience',
  forum: 'campus_feed',
  sessions: 'live_sessions',
  live_session: 'live_sessions',
  referral: 'referrals',
  onboarding: 'academic_structure'
};

function requireFeatureEnabled(rawFeatureKey) {
  const featureKey = KEY_ALIASES[rawFeatureKey] || rawFeatureKey;
  return async (req, res, next) => {
    // Admins bypass student feature availability checks on admin API calls
    if (req.session && (req.session.role === 'admin' || req.session.role === 'super_admin' || req.session.isAdmin)) {
      return next();
    }

    try {
      const matrix = await readFeatureMatrix(true);
      const featureConfig = matrix[featureKey] || DEFAULT_FEATURE_MATRIX[featureKey];

      if (!featureConfig) {
        return next();
      }

      const effective = resolveEffectiveFeatureState(featureConfig, req.session);

      if (!effective.accessibleForCurrentStudent) {
        return res.status(403).json({
          error: 'FEATURE_UNAVAILABLE',
          code: effective.unavailableReason || 'FEATURE_DISABLED',
          featureKey,
          status: effective.maintenance ? 'MAINTENANCE' : (effective.enabled ? 'ON' : 'OFF'),
          message: effective.maintenanceMessage || 'This feature is temporarily unavailable.',
          maintenanceMessage: effective.maintenanceMessage || 'This feature is temporarily unavailable.'
        });
      }

      next();
    } catch (error) {
      logger.error('[FeatureToggle] Route guard failed cleanly', { featureKey, error: error.message });
      return res.status(403).json({
        error: 'FEATURE_UNAVAILABLE',
        code: 'FEATURE_DISABLED',
        featureKey,
        status: 'OFF',
        message: 'This feature is temporarily unavailable.'
      });
    }
  };
}

module.exports = {
  STUDENT_FEATURE_REGISTRY,
  DEFAULT_FEATURE_MATRIX,
  readFeatureMatrix,
  resolveEffectiveFeatureState,
  getEffectiveFeatureMatrix,
  updateFeatureStatus,
  invalidateFeatureCache,
  requireFeatureEnabled
};
