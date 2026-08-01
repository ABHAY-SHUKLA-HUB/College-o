const { pool } = require('../db/pool');

const DEFAULT_SUPPORT_GOVERNANCE = {
  enabled: true,
  moduleVisible: true,
  allowRequestCreation: true,
  allowAnswerCreation: true,
  allowMeetLinks: true,
  allowAttachments: true,
  allowStudentRewarding: true,
  allowSolvedFlow: true
};

const SUPPORT_GOVERNANCE_CACHE_TTL_MS = 30 * 1000;
const supportGovernanceCache = {
  payload: null,
  loadedAt: 0
};

function toBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeGovernanceConfig(raw = {}) {
  return {
    enabled: toBool(raw.enabled, true),
    moduleVisible: toBool(raw.moduleVisible, true),
    allowRequestCreation: toBool(raw.allowRequestCreation, true),
    allowAnswerCreation: toBool(raw.allowAnswerCreation, true),
    allowMeetLinks: toBool(raw.allowMeetLinks, true),
    allowAttachments: toBool(raw.allowAttachments, true),
    allowStudentRewarding: toBool(raw.allowStudentRewarding, true),
    allowSolvedFlow: toBool(raw.allowSolvedFlow, true)
  };
}

async function getSupportGovernanceConfig() {
  if (supportGovernanceCache.payload && Date.now() - supportGovernanceCache.loadedAt < SUPPORT_GOVERNANCE_CACHE_TTL_MS) {
    return supportGovernanceCache.payload;
  }

  const { rows } = await pool.query(
    `SELECT value_json
     FROM platform_settings
     WHERE key = 'support_feature_governance'
     LIMIT 1`
  );

  const config = rows.length
    ? normalizeGovernanceConfig(rows[0].value_json || {})
    : { ...DEFAULT_SUPPORT_GOVERNANCE };

  supportGovernanceCache.payload = config;
  supportGovernanceCache.loadedAt = Date.now();
  return config;
}

async function setSupportGovernanceConfig(nextConfig, updatedBy = null) {
  const normalized = normalizeGovernanceConfig(nextConfig || {});
  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ('support_feature_governance', $1::jsonb, $2, NOW())
     ON CONFLICT (key)
     DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(normalized), updatedBy]
  );
  supportGovernanceCache.payload = normalized;
  supportGovernanceCache.loadedAt = Date.now();
  return normalized;
}

async function isUserSupportSuspended(userId) {
  const { rows } = await pool.query(
    `SELECT support_suspended, support_suspended_until
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  const row = rows[0];
  if (!row) return false;
  if (!row.support_suspended) return false;

  if (!row.support_suspended_until) return true;
  return new Date(row.support_suspended_until).getTime() > Date.now();
}

async function guardSupportFeature(req, res, next) {
  try {
    const cfg = await getSupportGovernanceConfig();
    req.supportGovernance = cfg;
    if (!cfg.enabled || !cfg.moduleVisible) {
      return res.status(503).json({ error: 'Support feature is temporarily unavailable.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  DEFAULT_SUPPORT_GOVERNANCE,
  normalizeGovernanceConfig,
  getSupportGovernanceConfig,
  setSupportGovernanceConfig,
  isUserSupportSuspended,
  guardSupportFeature
};
