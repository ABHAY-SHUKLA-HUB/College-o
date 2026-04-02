const crypto = require('crypto');
const { pool } = require('../db/pool');
const logger = require('./logger');
const { generateToolOutput } = require('./aiToolEngine');

const TOOL_KEYS = [
  'notes-summary',
  'quiz-generator',
  'flashcards-generator',
  'doubt-solver',
  'resume-builder',
  'career-suggestion',
  'study-planner',
  'concept-explainer',
  'interview-generator',
  'roadmap-recommender'
];

const TONE_VALUES = ['exam-oriented', 'beginner-friendly', 'professional', 'hinglish', 'concise'];
const PLAN_VALUES = ['free', 'premium', 'custom'];
const RESPONSE_MODE_VALUES = ['short', 'medium', 'detailed'];
const PROVIDER_MODE_VALUES = ['azure_openai', 'fallback_only'];
const SECRET_PREFIX = 'enc:v1:';

let schemaReady = false;

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function toNumber(value, fallback = 0, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function safeText(value, max = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function clampTone(value) {
  const tone = String(value || '').trim().toLowerCase();
  return TONE_VALUES.includes(tone) ? tone : 'exam-oriented';
}

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function getEncryptionSecret() {
  const secret = String(process.env.AI_SETTINGS_ENCRYPTION_KEY || process.env.SESSION_SECRET || '').trim();
  if (!secret) return '';
  if (secret === 'unsafe-dev-secret' || secret === 'replace-with-strong-secret') return '';
  return secret;
}

function getEncryptionKey() {
  const secret = getEncryptionSecret();
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptSecretValue(value) {
  const text = String(value || '');
  if (!text) return null;

  const key = getEncryptionKey();
  if (!key) return text;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${SECRET_PREFIX}${iv.toString('base64')}.${encrypted.toString('base64')}.${tag.toString('base64')}`;
}

function decryptSecretValue(value) {
  const text = String(value || '');
  if (!text.startsWith(SECRET_PREFIX)) return text;

  const key = getEncryptionKey();
  if (!key) return '';

  const parts = text.slice(SECRET_PREFIX.length).split('.');
  if (parts.length !== 3) return '';

  try {
    const [ivB64, encryptedB64, tagB64] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, 'base64')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (error) {
    logger.warn('AI secret decryption failed', {
      code: 'AI_SECRET_DECRYPT_FAILED',
      message: error.message
    });
    return '';
  }
}

function serializeGlobalSettingsForAdmin(cfg) {
  return {
    aiEnabled: Boolean(cfg?.aiEnabled),
    providerMode: String(cfg?.providerMode || 'fallback_only'),
    azureEndpoint: safeText(cfg?.azureEndpoint || '', 500),
    azureDeployment: safeText(cfg?.azureDeployment || '', 200),
    azureApiVersion: safeText(cfg?.azureApiVersion || '', 80),
    azureConfigured: Boolean(cfg?.azureConfigured),
    azureApiKeyMasked: maskSecret(cfg?.azureApiKey),
    azureApiKeyConfigured: Boolean(cfg?.azureApiKey),
    updatedBy: cfg?.updatedBy || null,
    updatedAt: cfg?.updatedAt || null
  };
}

function envDefaults() {
  return {
    aiEnabled: toBool(process.env.AI_ENABLED, true),
    providerMode: PROVIDER_MODE_VALUES.includes(String(process.env.AI_PROVIDER || '').trim())
      ? String(process.env.AI_PROVIDER || '').trim()
      : 'fallback_only',
    azureEndpoint: String(process.env.AZURE_OPENAI_ENDPOINT || '').trim(),
    azureApiKey: String(process.env.AZURE_OPENAI_API_KEY || '').trim(),
    azureDeployment: String(process.env.AZURE_OPENAI_DEPLOYMENT || '').trim(),
    azureApiVersion: String(process.env.AZURE_OPENAI_API_VERSION || '').trim() || '2024-02-15-preview'
  };
}

function isAzureConfigured(cfg = null) {
  const target = cfg && typeof cfg === 'object' ? cfg : envDefaults();
  return Boolean(target.azureEndpoint && target.azureApiKey && target.azureDeployment && target.azureApiVersion);
}

async function isAIEnabled() {
  try {
    const cfg = await getGlobalSettingsRaw();
    return Boolean(cfg.aiEnabled);
  } catch (error) {
    logger.warn('AI enabled-state check failed, defaulting to fallback-safe mode', {
      code: 'AI_ENABLED_CHECK_FAILED',
      message: error.message
    });
    return false;
  }
}

async function resolveProviderRuntime() {
  try {
    const cfg = await getGlobalSettingsRaw();
    const enabled = Boolean(cfg.aiEnabled);
    const azureReady = isAzureConfigured(cfg);
    const providerMode = String(cfg.providerMode || 'fallback_only');

    if (!enabled) {
      return {
        aiEnabled: false,
        providerMode: 'fallback_only',
        azureConfigured: azureReady,
        canUseAzure: false,
        reason: 'ai_disabled',
        config: cfg
      };
    }

    if (providerMode !== 'azure_openai') {
      return {
        aiEnabled: true,
        providerMode: 'fallback_only',
        azureConfigured: azureReady,
        canUseAzure: false,
        reason: 'provider_forced_fallback',
        config: cfg
      };
    }

    if (!azureReady) {
      return {
        aiEnabled: true,
        providerMode: 'fallback_only',
        azureConfigured: false,
        canUseAzure: false,
        reason: 'azure_not_configured',
        config: cfg
      };
    }

    return {
      aiEnabled: true,
      providerMode: 'azure_openai',
      azureConfigured: true,
      canUseAzure: true,
      reason: 'azure_ready',
      config: cfg
    };
  } catch (error) {
    logger.warn('AI provider runtime resolution failed, falling back safely', {
      code: 'AI_PROVIDER_RUNTIME_RESOLVE_FAILED',
      message: error.message
    });
    return {
      aiEnabled: false,
      providerMode: 'fallback_only',
      azureConfigured: false,
      canUseAzure: false,
      reason: 'runtime_resolve_failed',
      config: {
        aiEnabled: false,
        providerMode: 'fallback_only',
        azureConfigured: false
      }
    };
  }
}

function buildPromptTemplate(promptRow, context) {
  const systemPrompt = safeText(
    promptRow?.system_prompt ||
      'You are College OS AI assistant. Be helpful, accurate, concise, and exam-focused for students.',
    8000
  );
  const userTemplate = String(
    promptRow?.user_prompt_template ||
      'Feature: {feature}\nGoal: {goal}\nTopic: {topic}\nQuestion: {question}\nNotes: {notes}\nSkills: {skills}\nProjects: {projects}\nProfile: {branch} semester {semester}\nUser: {user_name}'
  );

  const replacementMap = {
    '{user_name}': safeText(context.userName || 'Student', 120),
    '{branch}': safeText(context.branch || 'General', 120),
    '{semester}': safeText(context.semester || 'N/A', 80),
    '{goal}': safeText(context.goal || '', 700),
    '{notes}': safeText(context.notes || '', 3000),
    '{topic}': safeText(context.topic || '', 300),
    '{question}': safeText(context.question || '', 1000),
    '{skills}': safeText(context.skills || '', 700),
    '{projects}': safeText(context.projects || '', 700),
    '{feature}': safeText(context.feature || '', 200)
  };

  const userPrompt = Object.keys(replacementMap).reduce((acc, key) => {
    return acc.split(key).join(replacementMap[key]);
  }, userTemplate);

  return {
    systemPrompt,
    userPrompt,
    fallbackPrompt: safeText(promptRow?.fallback_prompt || 'Use deterministic structured fallback output.', 5000),
    outputStyleRules: safeText(promptRow?.output_style_rules || 'Respond in clear sections with bullets.', 2500),
    tone: clampTone(promptRow?.tone || 'exam-oriented')
  };
}

async function ensureAiOpsSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_global_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      provider_mode VARCHAR(40) NOT NULL DEFAULT 'fallback_only',
      azure_endpoint TEXT,
      azure_api_key TEXT,
      azure_deployment TEXT,
      azure_api_version VARCHAR(80),
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_feature_settings (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      tool_key VARCHAR(120) UNIQUE NOT NULL,
      feature_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
      plan_access VARCHAR(30) NOT NULL DEFAULT 'free',
      is_free BOOLEAN NOT NULL DEFAULT TRUE,
      monthly_credit_cost INTEGER NOT NULL DEFAULT 1,
      per_request_message_cost NUMERIC(10,4) NOT NULL DEFAULT 0,
      daily_usage_limit INTEGER NOT NULL DEFAULT 30,
      monthly_usage_limit INTEGER NOT NULL DEFAULT 400,
      max_output_tokens INTEGER NOT NULL DEFAULT 700,
      response_mode VARCHAR(30) NOT NULL DEFAULT 'medium',
      temperature NUMERIC(5,2) NOT NULL DEFAULT 0.30,
      timeout_ms INTEGER NOT NULL DEFAULT 12000,
      retry_count INTEGER NOT NULL DEFAULT 1,
      provider_preference VARCHAR(40) NOT NULL DEFAULT 'azure_openai',
      allow_azure BOOLEAN NOT NULL DEFAULT TRUE,
      admin_notes TEXT,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_prompt_settings (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      tool_key VARCHAR(120) UNIQUE NOT NULL,
      system_prompt TEXT NOT NULL,
      user_prompt_template TEXT NOT NULL,
      fallback_prompt TEXT NOT NULL,
      output_style_rules TEXT,
      tone VARCHAR(40) NOT NULL DEFAULT 'exam-oriented',
      active_version INTEGER NOT NULL DEFAULT 1,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_prompt_versions (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      tool_key VARCHAR(120) NOT NULL,
      version_number INTEGER NOT NULL,
      system_prompt TEXT NOT NULL,
      user_prompt_template TEXT NOT NULL,
      fallback_prompt TEXT NOT NULL,
      output_style_rules TEXT,
      tone VARCHAR(40) NOT NULL DEFAULT 'exam-oriented',
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tool_key, version_number)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_credit_wallets (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      credits_balance INTEGER NOT NULL DEFAULT 50,
      free_trial_credits INTEGER NOT NULL DEFAULT 50,
      monthly_plan_credits INTEGER NOT NULL DEFAULT 120,
      hidden_token_mode BOOLEAN NOT NULL DEFAULT TRUE,
      visible_credits_left BOOLEAN NOT NULL DEFAULT TRUE,
      abuse_blocked BOOLEAN NOT NULL DEFAULT FALSE,
      abuse_reason TEXT,
      usage_override_daily_limit INTEGER,
      usage_override_monthly_limit INTEGER,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_credit_ledger (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_key VARCHAR(120),
      delta_credits INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason VARCHAR(120) NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_request_logs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      tool_key VARCHAR(120) NOT NULL,
      request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      provider_used VARCHAR(40) NOT NULL DEFAULT 'fallback',
      azure_attempted BOOLEAN NOT NULL DEFAULT FALSE,
      fallback_used BOOLEAN NOT NULL DEFAULT TRUE,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      error_code VARCHAR(120),
      error_summary TEXT,
      response_ms INTEGER NOT NULL DEFAULT 0,
      estimated_tokens INTEGER NOT NULL DEFAULT 0,
      credits_charged INTEGER NOT NULL DEFAULT 0,
      plan_tier VARCHAR(40) DEFAULT 'free',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_plan_entitlements (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      plan_code VARCHAR(40) NOT NULL,
      plan_label VARCHAR(120) NOT NULL,
      price_inr INTEGER NOT NULL DEFAULT 0,
      tool_key VARCHAR(120) NOT NULL,
      unlocked BOOLEAN NOT NULL DEFAULT FALSE,
      monthly_credits INTEGER NOT NULL DEFAULT 0,
      per_day_limit INTEGER NOT NULL DEFAULT 10,
      free_user_limit INTEGER NOT NULL DEFAULT 5,
      paid_user_limit INTEGER NOT NULL DEFAULT 100,
      campaign_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (plan_code, tool_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_admin_audit_logs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(160) NOT NULL,
      target_type VARCHAR(80) NOT NULL,
      target_key VARCHAR(180),
      before_state JSONB,
      after_state JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_request_logs_tool_created
    ON ai_request_logs(tool_key, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_request_logs_user_created
    ON ai_request_logs(user_id, created_at DESC)
  `);

  await pool.query(`
    INSERT INTO ai_global_settings (id, ai_enabled, provider_mode, azure_api_version)
    VALUES (1, TRUE, 'fallback_only', '2024-02-15-preview')
    ON CONFLICT (id) DO NOTHING
  `);

  for (const toolKey of TOOL_KEYS) {
    await pool.query(
      `INSERT INTO ai_feature_settings (
        tool_key,
        feature_enabled,
        maintenance_mode,
        plan_access,
        is_free,
        monthly_credit_cost,
        per_request_message_cost,
        daily_usage_limit,
        monthly_usage_limit,
        max_output_tokens,
        response_mode,
        temperature,
        timeout_ms,
        retry_count,
        provider_preference,
        allow_azure,
        admin_notes
      ) VALUES (
        $1::text,
        TRUE,
        FALSE,
        $2::text,
        $3::boolean,
        1,
        0,
        30,
        500,
        700,
        'medium',
        0.3,
        12000,
        1,
        'azure_openai',
        TRUE,
        'Default generated control config.'
      ) ON CONFLICT (tool_key) DO NOTHING`,
      [toolKey, ['quiz-generator', 'flashcards-generator', 'resume-builder', 'interview-generator', 'roadmap-recommender'].includes(toolKey) ? 'premium' : 'free', !['quiz-generator', 'flashcards-generator', 'resume-builder', 'interview-generator', 'roadmap-recommender'].includes(toolKey)]
    );

    await pool.query(
      `INSERT INTO ai_prompt_settings (
        tool_key,
        system_prompt,
        user_prompt_template,
        fallback_prompt,
        output_style_rules,
        tone,
        active_version
      ) VALUES (
        $1::text,
        $2::text,
        $3::text,
        $4::text,
        $5::text,
        'exam-oriented',
        1
      ) ON CONFLICT (tool_key) DO NOTHING`,
      [
        toolKey,
        `You are College OS assistant for ${toolKey}. Keep responses factual, structured, and practical for college students.`,
        'Feature: {feature}\nGoal: {goal}\nTopic: {topic}\nQuestion: {question}\nNotes: {notes}\nSkills: {skills}\nProjects: {projects}\nUser: {user_name} ({branch}, semester {semester})',
        'If provider fails, return deterministic sections with clear next actions.',
        'Use short headings, bullet points, and avoid unsupported claims.'
      ]
    );

    await pool.query(
      `INSERT INTO ai_prompt_versions (
        tool_key,
        version_number,
        system_prompt,
        user_prompt_template,
        fallback_prompt,
        output_style_rules,
        tone
      )
      SELECT $1::text, 1::int, s.system_prompt, s.user_prompt_template, s.fallback_prompt, s.output_style_rules, s.tone
      FROM ai_prompt_settings s
      WHERE s.tool_key = $1::text
      ON CONFLICT (tool_key, version_number) DO NOTHING`,
      [toolKey]
    );

    for (const planCode of ['free', 'premium_49']) {
      const isFreePlan = planCode === 'free';
      await pool.query(
        `INSERT INTO ai_plan_entitlements (
          plan_code,
          plan_label,
          price_inr,
          tool_key,
          unlocked,
          monthly_credits,
          per_day_limit,
          free_user_limit,
          paid_user_limit,
          campaign_rules
        ) VALUES (
          $1::text,
          $2::text,
          $3::int,
          $4::text,
          $5::boolean,
          $6::int,
          $7::int,
          $8::int,
          $9::int,
          $10::jsonb
        ) ON CONFLICT (plan_code, tool_key) DO NOTHING`,
        [
          planCode,
          isFreePlan ? 'Free' : 'INR 49',
          isFreePlan ? 0 : 49,
          toolKey,
          isFreePlan
            ? !['quiz-generator', 'flashcards-generator', 'resume-builder', 'interview-generator', 'roadmap-recommender'].includes(toolKey)
            : true,
          isFreePlan ? 120 : 1200,
          isFreePlan ? 8 : 60,
          isFreePlan ? 8 : 0,
          isFreePlan ? 0 : 250,
          JSON.stringify({ firstUsersBonus: 50, temporaryFreeUntil: null })
        ]
      );
    }
  }

  schemaReady = true;
}

async function logAudit({ actorUserId, action, targetType, targetKey, beforeState, afterState }) {
  await pool.query(
    `INSERT INTO ai_admin_audit_logs (actor_user_id, action, target_type, target_key, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      actorUserId || null,
      String(action || 'unknown').slice(0, 160),
      String(targetType || 'unknown').slice(0, 80),
      targetKey ? String(targetKey).slice(0, 180) : null,
      JSON.stringify(beforeState || null),
      JSON.stringify(afterState || null)
    ]
  );
}

async function getGlobalSettingsRaw() {
  await ensureAiOpsSchema();
  const env = envDefaults();
  const { rows } = await pool.query('SELECT * FROM ai_global_settings WHERE id = 1 LIMIT 1');
  const row = rows[0] || {};
  const out = {
    aiEnabled: row.ai_enabled == null ? env.aiEnabled : row.ai_enabled,
    providerMode: PROVIDER_MODE_VALUES.includes(String(row.provider_mode || '').trim())
      ? String(row.provider_mode).trim()
      : env.providerMode,
    azureEndpoint: safeText(row.azure_endpoint || env.azureEndpoint, 500),
    azureApiKey: decryptSecretValue(row.azure_api_key || env.azureApiKey || ''),
    azureApiKeyStored: row.azure_api_key || env.azureApiKey || '',
    azureApiKeySource: row.azure_api_key ? 'db' : (env.azureApiKey ? 'env' : 'none'),
    azureDeployment: safeText(row.azure_deployment || env.azureDeployment, 200),
    azureApiVersion: safeText(row.azure_api_version || env.azureApiVersion, 80),
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at || null,
    azureConfigured: false
  };
  out.azureConfigured = isAzureConfigured(out);
  return out;
}

async function getGlobalSettingsForAdmin() {
  const cfg = await getGlobalSettingsRaw();
  return serializeGlobalSettingsForAdmin(cfg);
}

async function updateGlobalSettings(payload, actorUserId) {
  await ensureAiOpsSchema();
  const before = await getGlobalSettingsRaw();

  const providerMode = PROVIDER_MODE_VALUES.includes(String(payload?.providerMode || '').trim())
    ? String(payload.providerMode).trim()
    : before.providerMode;

  const aiEnabled = payload?.aiEnabled == null ? before.aiEnabled : toBool(payload.aiEnabled, before.aiEnabled);
  const azureEndpoint = payload?.azureEndpoint == null ? before.azureEndpoint : String(payload.azureEndpoint || '').trim();
  const azureDeployment = payload?.azureDeployment == null ? before.azureDeployment : String(payload.azureDeployment || '').trim();
  const azureApiVersion = payload?.azureApiVersion == null ? before.azureApiVersion : String(payload.azureApiVersion || '').trim();

  let azureApiKey = before.azureApiKeySource === 'db' ? before.azureApiKeyStored : '';
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'azureApiKey')) {
    const incoming = String(payload.azureApiKey || '').trim();
    if (incoming && !incoming.includes('*')) {
      azureApiKey = encryptSecretValue(incoming) || incoming;
    }
  }

  await pool.query(
    `UPDATE ai_global_settings
     SET
      ai_enabled = $1,
      provider_mode = $2,
      azure_endpoint = $3,
      azure_api_key = $4,
      azure_deployment = $5,
      azure_api_version = $6,
      updated_by = $7,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [
      aiEnabled,
      providerMode,
      azureEndpoint || null,
      azureApiKey || null,
      azureDeployment || null,
      azureApiVersion || null,
      actorUserId || null
    ]
  );

  const after = await getGlobalSettingsRaw();
  await logAudit({
    actorUserId,
    action: 'ai.global_settings.updated',
    targetType: 'ai_global_settings',
    targetKey: 'singleton',
    beforeState: serializeGlobalSettingsForAdmin(before),
    afterState: serializeGlobalSettingsForAdmin(after)
  });

  return getGlobalSettingsForAdmin();
}

async function listFeatureSettings() {
  await ensureAiOpsSchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_feature_settings ORDER BY tool_key ASC`
  );
  return rows;
}

async function getFeatureSetting(toolKey) {
  await ensureAiOpsSchema();
  const { rows } = await pool.query('SELECT * FROM ai_feature_settings WHERE tool_key = $1 LIMIT 1', [toolKey]);
  return rows[0] || null;
}

function normalizeFeaturePayload(prev, payload = {}) {
  const planAccess = PLAN_VALUES.includes(String(payload.planAccess || '').trim())
    ? String(payload.planAccess).trim()
    : String(prev.plan_access || 'free');

  const responseMode = RESPONSE_MODE_VALUES.includes(String(payload.responseMode || '').trim())
    ? String(payload.responseMode).trim()
    : String(prev.response_mode || 'medium');

  const providerPreference = PROVIDER_MODE_VALUES.includes(String(payload.providerPreference || '').trim())
    ? String(payload.providerPreference).trim()
    : String(prev.provider_preference || 'azure_openai');

  return {
    featureEnabled: payload.featureEnabled == null ? prev.feature_enabled : toBool(payload.featureEnabled, prev.feature_enabled),
    maintenanceMode: payload.maintenanceMode == null ? prev.maintenance_mode : toBool(payload.maintenanceMode, prev.maintenance_mode),
    planAccess,
    isFree: payload.isFree == null ? prev.is_free : toBool(payload.isFree, prev.is_free),
    monthlyCreditCost: toNumber(payload.monthlyCreditCost, prev.monthly_credit_cost, 0, 10000),
    perRequestMessageCost: toNumber(payload.perRequestMessageCost, prev.per_request_message_cost, 0, 1000),
    dailyUsageLimit: toNumber(payload.dailyUsageLimit, prev.daily_usage_limit, 1, 20000),
    monthlyUsageLimit: toNumber(payload.monthlyUsageLimit, prev.monthly_usage_limit, 1, 200000),
    maxOutputTokens: toNumber(payload.maxOutputTokens, prev.max_output_tokens, 50, 32000),
    responseMode,
    temperature: toNumber(payload.temperature, prev.temperature, 0, 1.2),
    timeoutMs: toNumber(payload.timeoutMs, prev.timeout_ms, 1500, 120000),
    retryCount: toNumber(payload.retryCount, prev.retry_count, 0, 5),
    providerPreference,
    allowAzure: payload.allowAzure == null ? prev.allow_azure : toBool(payload.allowAzure, prev.allow_azure),
    adminNotes: safeText(payload.adminNotes == null ? prev.admin_notes : payload.adminNotes, 2500)
  };
}

async function updateFeatureSetting(toolKey, payload, actorUserId) {
  await ensureAiOpsSchema();
  const before = await getFeatureSetting(toolKey);
  if (!before) throw new Error('Unknown AI feature tool key.');

  const normalized = normalizeFeaturePayload(before, payload);

  await pool.query(
    `UPDATE ai_feature_settings
     SET
      feature_enabled = $1,
      maintenance_mode = $2,
      plan_access = $3,
      is_free = $4,
      monthly_credit_cost = $5,
      per_request_message_cost = $6,
      daily_usage_limit = $7,
      monthly_usage_limit = $8,
      max_output_tokens = $9,
      response_mode = $10,
      temperature = $11,
      timeout_ms = $12,
      retry_count = $13,
      provider_preference = $14,
      allow_azure = $15,
      admin_notes = $16,
      updated_by = $17,
      updated_at = CURRENT_TIMESTAMP
     WHERE tool_key = $18`,
    [
      normalized.featureEnabled,
      normalized.maintenanceMode,
      normalized.planAccess,
      normalized.isFree,
      normalized.monthlyCreditCost,
      normalized.perRequestMessageCost,
      normalized.dailyUsageLimit,
      normalized.monthlyUsageLimit,
      normalized.maxOutputTokens,
      normalized.responseMode,
      normalized.temperature,
      normalized.timeoutMs,
      normalized.retryCount,
      normalized.providerPreference,
      normalized.allowAzure,
      normalized.adminNotes || null,
      actorUserId || null,
      toolKey
    ]
  );

  const after = await getFeatureSetting(toolKey);
  await logAudit({
    actorUserId,
    action: 'ai.feature_settings.updated',
    targetType: 'ai_feature_settings',
    targetKey: toolKey,
    beforeState: before,
    afterState: after
  });
  return after;
}

async function getPrompt(toolKey) {
  await ensureAiOpsSchema();
  const { rows } = await pool.query('SELECT * FROM ai_prompt_settings WHERE tool_key = $1 LIMIT 1', [toolKey]);
  return rows[0] || null;
}

async function listPromptVersions(toolKey, limit = 25) {
  await ensureAiOpsSchema();
  const { rows } = await pool.query(
    `SELECT id, tool_key, version_number, tone, created_by, created_at
     FROM ai_prompt_versions
     WHERE tool_key = $1
     ORDER BY version_number DESC
     LIMIT $2`,
    [toolKey, toNumber(limit, 25, 1, 200)]
  );
  return rows;
}

async function updatePrompt(toolKey, payload, actorUserId) {
  await ensureAiOpsSchema();
  const before = await getPrompt(toolKey);
  if (!before) throw new Error('Prompt config not found for this tool.');

  const next = {
    systemPrompt: safeText(payload?.systemPrompt ?? before.system_prompt, 16000),
    userPromptTemplate: String(payload?.userPromptTemplate ?? before.user_prompt_template).slice(0, 20000),
    fallbackPrompt: safeText(payload?.fallbackPrompt ?? before.fallback_prompt, 12000),
    outputStyleRules: safeText(payload?.outputStyleRules ?? before.output_style_rules, 6000),
    tone: clampTone(payload?.tone ?? before.tone)
  };

  const versionNumber = toNumber(before.active_version, 1, 1, 99999) + 1;

  await pool.query(
    `UPDATE ai_prompt_settings
      SET
        system_prompt = $1,
        user_prompt_template = $2,
        fallback_prompt = $3,
        output_style_rules = $4,
        tone = $5,
        active_version = $6,
        updated_by = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE tool_key = $8`,
    [
      next.systemPrompt,
      next.userPromptTemplate,
      next.fallbackPrompt,
      next.outputStyleRules,
      next.tone,
      versionNumber,
      actorUserId || null,
      toolKey
    ]
  );

  await pool.query(
    `INSERT INTO ai_prompt_versions (
      tool_key,
      version_number,
      system_prompt,
      user_prompt_template,
      fallback_prompt,
      output_style_rules,
      tone,
      created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (tool_key, version_number) DO NOTHING`,
    [
      toolKey,
      versionNumber,
      next.systemPrompt,
      next.userPromptTemplate,
      next.fallbackPrompt,
      next.outputStyleRules,
      next.tone,
      actorUserId || null
    ]
  );

  const after = await getPrompt(toolKey);
  await logAudit({
    actorUserId,
    action: 'ai.prompts.updated',
    targetType: 'ai_prompt_settings',
    targetKey: toolKey,
    beforeState: { toolKey, activeVersion: before.active_version },
    afterState: { toolKey, activeVersion: after.active_version }
  });

  return after;
}

async function restorePromptVersion(toolKey, versionId, actorUserId) {
  await ensureAiOpsSchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_prompt_versions WHERE id = $1 AND tool_key = $2 LIMIT 1`,
    [toNumber(versionId, 0, 1, 100000000), toolKey]
  );
  const version = rows[0];
  if (!version) throw new Error('Prompt version not found.');

  const before = await getPrompt(toolKey);

  await pool.query(
    `UPDATE ai_prompt_settings
      SET
        system_prompt = $1,
        user_prompt_template = $2,
        fallback_prompt = $3,
        output_style_rules = $4,
        tone = $5,
        active_version = $6,
        updated_by = $7,
        updated_at = CURRENT_TIMESTAMP
      WHERE tool_key = $8`,
    [
      version.system_prompt,
      version.user_prompt_template,
      version.fallback_prompt,
      version.output_style_rules,
      version.tone,
      version.version_number,
      actorUserId || null,
      toolKey
    ]
  );

  const after = await getPrompt(toolKey);
  await logAudit({
    actorUserId,
    action: 'ai.prompts.restored',
    targetType: 'ai_prompt_settings',
    targetKey: toolKey,
    beforeState: { toolKey, activeVersion: before.active_version },
    afterState: { toolKey, activeVersion: after.active_version, restoredFromVersionId: versionId }
  });

  return after;
}

async function ensureWallet(userId) {
  await ensureAiOpsSchema();
  await pool.query(
    `INSERT INTO ai_credit_wallets (user_id, credits_balance, free_trial_credits, monthly_plan_credits)
     VALUES ($1, 50, 50, 120)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const { rows } = await pool.query('SELECT * FROM ai_credit_wallets WHERE user_id = $1 LIMIT 1', [userId]);
  return rows[0];
}

async function getWalletSummary(userId) {
  return ensureWallet(userId);
}

async function appendCreditLedger({ userId, toolKey, delta, balanceAfter, reason, metadata, actorUserId }) {
  await pool.query(
    `INSERT INTO ai_credit_ledger (user_id, tool_key, delta_credits, balance_after, reason, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [userId, toolKey || null, delta, balanceAfter, reason, JSON.stringify(metadata || {}), actorUserId || null]
  );
}

async function updateCredits({ userId, delta, reason, toolKey, metadata, actorUserId }) {
  const wallet = await ensureWallet(userId);
  const nextBalance = Math.max(0, toNumber(wallet.credits_balance, 0) + toNumber(delta, 0));
  await pool.query(
    `UPDATE ai_credit_wallets SET credits_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
    [nextBalance, userId]
  );
  await appendCreditLedger({
    userId,
    toolKey,
    delta,
    balanceAfter: nextBalance,
    reason,
    metadata,
    actorUserId
  });
  return getWalletSummary(userId);
}

async function resetUserCredits(userId, payload, actorUserId) {
  const wallet = await ensureWallet(userId);
  const resetTo = toNumber(payload?.resetTo, wallet.monthly_plan_credits || 120, 0, 1000000);
  await pool.query(
    `UPDATE ai_credit_wallets
     SET credits_balance = $1,
         free_trial_credits = $2,
         monthly_plan_credits = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $4`,
    [resetTo, toNumber(payload?.freeTrialCredits, wallet.free_trial_credits, 0, 1000000), toNumber(payload?.monthlyPlanCredits, wallet.monthly_plan_credits, 0, 1000000), userId]
  );

  await appendCreditLedger({
    userId,
    toolKey: null,
    delta: resetTo - toNumber(wallet.credits_balance, 0),
    balanceAfter: resetTo,
    reason: 'admin_reset',
    metadata: payload || {},
    actorUserId
  });

  await logAudit({
    actorUserId,
    action: 'ai.credits.reset',
    targetType: 'ai_credit_wallets',
    targetKey: String(userId),
    beforeState: wallet,
    afterState: await getWalletSummary(userId)
  });

  return getWalletSummary(userId);
}

async function applyUserCreditBonus(userId, payload, actorUserId) {
  const delta = toNumber(payload?.bonusCredits, 0, -1000000, 1000000);
  if (delta === 0) throw new Error('bonusCredits cannot be zero');
  const updated = await updateCredits({
    userId,
    delta,
    reason: delta > 0 ? 'admin_bonus' : 'admin_deduction',
    toolKey: null,
    metadata: { note: safeText(payload?.note || '', 300) },
    actorUserId
  });

  await logAudit({
    actorUserId,
    action: 'ai.credits.bonus',
    targetType: 'ai_credit_wallets',
    targetKey: String(userId),
    beforeState: null,
    afterState: { delta, wallet: updated }
  });

  return updated;
}

async function updateUserUsageOverride(userId, payload, actorUserId) {
  const before = await ensureWallet(userId);
  await pool.query(
    `UPDATE ai_credit_wallets
     SET
      usage_override_daily_limit = $1,
      usage_override_monthly_limit = $2,
      hidden_token_mode = $3,
      visible_credits_left = $4,
      updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $5`,
    [
      payload?.dailyLimitOverride == null ? before.usage_override_daily_limit : toNumber(payload.dailyLimitOverride, 0, 0, 100000),
      payload?.monthlyLimitOverride == null ? before.usage_override_monthly_limit : toNumber(payload.monthlyLimitOverride, 0, 0, 1000000),
      payload?.hiddenTokenMode == null ? before.hidden_token_mode : toBool(payload.hiddenTokenMode, before.hidden_token_mode),
      payload?.visibleCreditsLeft == null ? before.visible_credits_left : toBool(payload.visibleCreditsLeft, before.visible_credits_left),
      userId
    ]
  );
  const after = await ensureWallet(userId);
  await logAudit({
    actorUserId,
    action: 'ai.usage.override_updated',
    targetType: 'ai_credit_wallets',
    targetKey: String(userId),
    beforeState: before,
    afterState: after
  });
  return after;
}

async function setAbuseBlocked(userId, payload, actorUserId) {
  const before = await ensureWallet(userId);
  await pool.query(
    `UPDATE ai_credit_wallets
      SET abuse_blocked = $1,
          abuse_reason = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $3`,
    [toBool(payload?.blocked, false), safeText(payload?.reason || '', 500) || null, userId]
  );
  const after = await ensureWallet(userId);
  await logAudit({
    actorUserId,
    action: 'ai.abuse.block_toggle',
    targetType: 'ai_credit_wallets',
    targetKey: String(userId),
    beforeState: before,
    afterState: after
  });
  return after;
}

function planForMembership(membership) {
  if (membership?.isAdmin) return 'premium_49';
  if (membership?.premiumActive) return 'premium_49';
  return 'free';
}

async function getPlanEntitlements() {
  await ensureAiOpsSchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_plan_entitlements ORDER BY plan_code ASC, tool_key ASC`
  );
  return rows;
}

async function updatePlanEntitlements(planCode, toolEntitlements, actorUserId, meta = {}) {
  await ensureAiOpsSchema();
  const normalizedPlan = String(planCode || '').trim() || 'free';
  const items = Array.isArray(toolEntitlements) ? toolEntitlements : [];

  const before = await pool.query('SELECT * FROM ai_plan_entitlements WHERE plan_code = $1', [normalizedPlan]);

  for (const item of items) {
    const toolKey = String(item.toolKey || '').trim();
    if (!TOOL_KEYS.includes(toolKey)) continue;

    await pool.query(
      `INSERT INTO ai_plan_entitlements (
        plan_code,
        plan_label,
        price_inr,
        tool_key,
        unlocked,
        monthly_credits,
        per_day_limit,
        free_user_limit,
        paid_user_limit,
        campaign_rules,
        updated_by,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,CURRENT_TIMESTAMP
      )
      ON CONFLICT (plan_code, tool_key)
      DO UPDATE SET
        plan_label = EXCLUDED.plan_label,
        price_inr = EXCLUDED.price_inr,
        unlocked = EXCLUDED.unlocked,
        monthly_credits = EXCLUDED.monthly_credits,
        per_day_limit = EXCLUDED.per_day_limit,
        free_user_limit = EXCLUDED.free_user_limit,
        paid_user_limit = EXCLUDED.paid_user_limit,
        campaign_rules = EXCLUDED.campaign_rules,
        updated_by = EXCLUDED.updated_by,
        updated_at = CURRENT_TIMESTAMP`,
      [
        normalizedPlan,
        safeText(item.planLabel || (normalizedPlan === 'free' ? 'Free' : 'INR 49'), 120),
        toNumber(item.priceInr, normalizedPlan === 'free' ? 0 : 49, 0, 100000),
        toolKey,
        toBool(item.unlocked, normalizedPlan !== 'free'),
        toNumber(item.monthlyCredits, normalizedPlan === 'free' ? 120 : 1200, 0, 1000000),
        toNumber(item.perDayLimit, normalizedPlan === 'free' ? 8 : 60, 0, 100000),
        toNumber(item.freeUserLimit, normalizedPlan === 'free' ? 8 : 0, 0, 100000),
        toNumber(item.paidUserLimit, normalizedPlan === 'free' ? 0 : 250, 0, 100000),
        JSON.stringify({
          firstUsersBonus: toNumber(item.firstUsersBonus, 0, 0, 100000),
          temporaryFreeUntil: item.temporaryFreeUntil || null,
          notes: safeText(item.notes || '', 200),
          ...meta
        }),
        actorUserId || null
      ]
    );
  }

  const after = await pool.query('SELECT * FROM ai_plan_entitlements WHERE plan_code = $1', [normalizedPlan]);

  await logAudit({
    actorUserId,
    action: 'ai.plan_entitlements.updated',
    targetType: 'ai_plan_entitlements',
    targetKey: normalizedPlan,
    beforeState: before.rows,
    afterState: after.rows
  });

  return after.rows;
}

async function resolveEntitlement(toolKey, membership) {
  const plan = planForMembership(membership);
  const { rows } = await pool.query(
    `SELECT * FROM ai_plan_entitlements WHERE plan_code = $1 AND tool_key = $2 LIMIT 1`,
    [plan, toolKey]
  );
  return rows[0] || null;
}

function extractContextFromInputs(toolKey, inputs, profile = {}, user = {}) {
  return {
    feature: toolKey,
    userName: user?.full_name || user?.name || '',
    branch: profile?.branch_name || profile?.branch || '',
    semester: profile?.semester_label || profile?.semester || '',
    goal: inputs.goal || inputs.targetGoal || '',
    notes: inputs.content || inputs.notes || '',
    topic: inputs.topic || inputs.subject || inputs.concept || '',
    question: inputs.question || inputs.doubt || '',
    skills: inputs.skills || '',
    projects: inputs.projects || ''
  };
}

async function callAzureCompletion({ cfg, prompt, temperature, maxTokens, timeoutMs }) {
  const url = `${String(cfg.azureEndpoint).replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(cfg.azureDeployment)}/chat/completions?api-version=${encodeURIComponent(cfg.azureApiVersion)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': cfg.azureApiKey
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: prompt.systemPrompt },
          { role: 'user', content: `${prompt.userPrompt}\n\nStyle rules: ${prompt.outputStyleRules}\nTone: ${prompt.tone}` }
        ],
        temperature: toNumber(temperature, 0.3, 0, 1.2),
        max_tokens: toNumber(maxTokens, 700, 50, 32000)
      }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const msg = data?.error?.message || `Azure completion failed (${response.status})`;
      const code = data?.error?.code || `AZURE_HTTP_${response.status}`;
      const error = new Error(msg);
      error.code = code;
      error.status = response.status;
      throw error;
    }

    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    const usageTokens = toNumber(data?.usage?.total_tokens, 0, 0, 1000000);
    return { text, usageTokens };
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutErr = new Error('Azure request timed out');
      timeoutErr.code = 'AZURE_TIMEOUT';
      throw timeoutErr;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function toStructuredSectionsFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return [{ heading: 'AI Answer', type: 'paragraphs', items: ['No AI content returned.'] }];
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => /^[-*\d.]/.test(line)).map((line) => line.replace(/^[-*\d.\s]+/, '').trim());
  if (bullets.length >= 3) {
    return [{ heading: 'AI Enhanced Output', type: 'bullets', items: bullets.slice(0, 16) }];
  }
  const paragraphs = raw.split(/\n\n+/).map((chunk) => chunk.trim()).filter(Boolean);
  return [{ heading: 'AI Enhanced Output', type: 'paragraphs', items: paragraphs.slice(0, 8) }];
}

async function logAiRequest(payload) {
  await pool.query(
    `INSERT INTO ai_request_logs (
      user_id,
      tool_key,
      request_payload,
      provider_used,
      azure_attempted,
      fallback_used,
      success,
      error_code,
      error_summary,
      response_ms,
      estimated_tokens,
      credits_charged,
      plan_tier
    ) VALUES (
      $1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
    )`,
    [
      payload.userId || null,
      payload.toolKey,
      JSON.stringify(payload.requestPayload || {}),
      payload.providerUsed || 'fallback',
      Boolean(payload.azureAttempted),
      Boolean(payload.fallbackUsed),
      Boolean(payload.success),
      payload.errorCode || null,
      safeText(payload.errorSummary || '', 800) || null,
      toNumber(payload.responseMs, 0, 0, 3600000),
      toNumber(payload.estimatedTokens, 0, 0, 100000000),
      toNumber(payload.creditsCharged, 0, 0, 1000000),
      payload.planTier || 'free'
    ]
  );
}

async function usageCount(userId, toolKey, period) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ai_request_logs
     WHERE user_id = $1 AND tool_key = $2 AND success = TRUE
      AND created_at >= CURRENT_DATE - ($3::text || ' days')::interval`,
    [userId, toolKey, String(period)]
  );
  return toNumber(rows[0]?.count, 0, 0, 100000000);
}

async function validateUsageAndCredits({ userId, toolKey, featureCfg, membership }) {
  const wallet = await ensureWallet(userId);
  if (wallet.abuse_blocked) {
    const err = new Error('Your AI access is temporarily restricted due to policy checks.');
    err.code = 'ABUSE_BLOCKED';
    err.status = 403;
    throw err;
  }

  const entitlement = await resolveEntitlement(toolKey, membership);
  if (featureCfg.plan_access === 'premium' && !(membership?.premiumActive || membership?.isAdmin)) {
    const err = new Error('This AI tool is available on paid plan.');
    err.code = 'UPGRADE_REQUIRED';
    err.status = 403;
    throw err;
  }

  if (entitlement && !entitlement.unlocked) {
    const err = new Error('This AI tool is currently locked for your plan.');
    err.code = 'PLAN_TOOL_LOCKED';
    err.status = 403;
    throw err;
  }

  const dailyCount = await usageCount(userId, toolKey, 1);
  const monthlyCount = await usageCount(userId, toolKey, 30);

  const dailyLimit = toNumber(wallet.usage_override_daily_limit, featureCfg.daily_usage_limit, 0, 1000000) || toNumber(featureCfg.daily_usage_limit, 30, 1, 1000000);
  const monthlyLimit = toNumber(wallet.usage_override_monthly_limit, featureCfg.monthly_usage_limit, 0, 1000000) || toNumber(featureCfg.monthly_usage_limit, 500, 1, 1000000);

  if (dailyCount >= dailyLimit) {
    const err = new Error('Daily usage limit reached for this feature.');
    err.code = 'DAILY_LIMIT_REACHED';
    err.status = 429;
    throw err;
  }
  if (monthlyCount >= monthlyLimit) {
    const err = new Error('Monthly usage limit reached for this feature.');
    err.code = 'MONTHLY_LIMIT_REACHED';
    err.status = 429;
    throw err;
  }

  const creditCost = toNumber(featureCfg.monthly_credit_cost, 1, 0, 100000);
  if (toNumber(wallet.credits_balance, 0, 0, 100000000) < creditCost) {
    const err = new Error('Insufficient credits for this request.');
    err.code = 'CREDITS_EXHAUSTED';
    err.status = 402;
    throw err;
  }

  return { wallet, entitlement, creditCost, dailyCount, monthlyCount, dailyLimit, monthlyLimit };
}

async function testAzureConnection(payload = null) {
  const stored = await getGlobalSettingsRaw();
  const cfg = payload
    ? {
        aiEnabled: payload.aiEnabled == null ? stored.aiEnabled : toBool(payload.aiEnabled, true),
        providerMode: String(payload.providerMode || stored.providerMode || 'azure_openai').trim() || 'azure_openai',
        azureEndpoint: String(payload.azureEndpoint == null ? stored.azureEndpoint : payload.azureEndpoint || '').trim(),
        azureApiKey: (() => {
          if (!Object.prototype.hasOwnProperty.call(payload, 'azureApiKey')) return stored.azureApiKey;
          const incoming = String(payload.azureApiKey || '').trim();
          return incoming && !incoming.includes('*') ? incoming : stored.azureApiKey;
        })(),
        azureDeployment: String(payload.azureDeployment == null ? stored.azureDeployment : payload.azureDeployment || '').trim(),
        azureApiVersion: String(payload.azureApiVersion == null ? stored.azureApiVersion : payload.azureApiVersion || '').trim() || '2024-02-15-preview'
      }
    : stored;

  if (!cfg.aiEnabled) {
    return {
      ok: false,
      mode: 'disabled',
      message: 'AI is disabled globally. Fallback mode is active.'
    };
  }

  if (!isAzureConfigured(cfg)) {
    return {
      ok: false,
      mode: 'fallback_only',
      message: 'Azure OpenAI config is incomplete. App will continue in fallback mode.'
    };
  }

  const started = Date.now();
  try {
    const prompt = {
      systemPrompt: 'Return exactly one short line: HEALTHY',
      userPrompt: 'Connection test from College OS admin panel.',
      outputStyleRules: 'Single line output only.',
      tone: 'professional'
    };
    const result = await callAzureCompletion({
      cfg,
      prompt,
      temperature: 0,
      maxTokens: 16,
      timeoutMs: 8000
    });

    return {
      ok: true,
      mode: 'azure_openai',
      message: 'Azure OpenAI connection is healthy.',
      latencyMs: Date.now() - started,
      sample: safeText(result.text, 120),
      azureConfigured: true
    };
  } catch (error) {
    logger.warn('Azure connection test failed', {
      code: error.code || 'AZURE_TEST_FAILED',
      message: error.message
    });
    return {
      ok: false,
      mode: 'fallback_only',
      message: 'Azure OpenAI connection failed. Fallback mode remains available.',
      errorCode: String(error.code || 'AZURE_TEST_FAILED')
    };
  }
}

function applyPromptStyleToResult(result, promptCfg) {
  const toneBadge = `Tone: ${promptCfg.tone}`;
  const badges = Array.isArray(result.badges) ? result.badges.slice(0) : [];
  if (!badges.includes(toneBadge)) badges.push(toneBadge);
  return {
    ...result,
    badges
  };
}

async function runAIOrFallback(feature, payload) {
  const featureKey = String(feature || '').trim();
  const context = payload && typeof payload === 'object' ? payload : {};

  let providerUsed = 'fallback';
  let azureAttempted = false;
  let estimatedTokens = 0;
  let azureError = null;
  let resultData = context.resultData;

  const providerRuntime = context.providerRuntime && typeof context.providerRuntime === 'object'
    ? context.providerRuntime
    : await resolveProviderRuntime();

  const featureCfg = context.featureCfg || {};
  const canUseAzureForFeature =
    providerRuntime.canUseAzure &&
    featureCfg.allow_azure &&
    String(featureCfg.provider_preference || 'fallback_only') === 'azure_openai';

  if (!canUseAzureForFeature) {
    return {
      providerUsed,
      azureAttempted,
      estimatedTokens,
      azureError,
      resultData,
      providerRuntime
    };
  }

  azureAttempted = true;
  const prompt = buildPromptTemplate(
    context.promptCfg,
    extractContextFromInputs(featureKey, context.inputs || {}, context.profile || {}, context.userMeta || {})
  );

  for (let attempt = 0; attempt <= toNumber(featureCfg.retry_count, 0, 0, 5); attempt += 1) {
    try {
      const azureResult = await callAzureCompletion({
        cfg: providerRuntime.config,
        prompt,
        temperature: featureCfg.temperature,
        maxTokens: featureCfg.max_output_tokens,
        timeoutMs: featureCfg.timeout_ms
      });

      estimatedTokens = azureResult.usageTokens;
      providerUsed = 'azure_openai';

      const mergedResult = {
        ...resultData.result,
        sections: toStructuredSectionsFromText(azureResult.text).concat(resultData.result.sections || [])
      };

      resultData = {
        ...resultData,
        result: applyPromptStyleToResult(mergedResult, prompt),
        meta: {
          ...resultData.meta,
          provider: 'azure_openai'
        }
      };
      azureError = null;
      break;
    } catch (error) {
      azureError = error;
    }
  }

  if (azureError) {
    providerUsed = 'fallback';
    logger.warn('Azure provider failed; using fallback', {
      toolKey: featureKey,
      userId: context.userId,
      code: azureError.code || 'AZURE_FAILED',
      message: azureError.message
    });
  }

  return {
    providerUsed,
    azureAttempted,
    estimatedTokens,
    azureError,
    resultData,
    providerRuntime
  };
}

async function executeManagedAiToolGeneration({
  userId,
  toolKey,
  tool,
  inputs,
  membership,
  profile,
  roadmaps,
  sessionMemory,
  userMeta
}) {
  const started = Date.now();
  await ensureAiOpsSchema();

  const providerRuntime = await resolveProviderRuntime();
  const globalCfg = providerRuntime.config || { aiEnabled: false, providerMode: 'fallback_only', azureConfigured: false };
  const featureCfg = await getFeatureSetting(toolKey);
  const promptCfg = await getPrompt(toolKey);

  if (!featureCfg || !promptCfg) {
    return {
      ok: false,
      status: 404,
      error: 'AI feature configuration missing for this tool.',
      details: []
    };
  }

  if (!featureCfg.feature_enabled) {
    return {
      ok: false,
      status: 503,
      error: 'This AI feature is disabled by admin.',
      details: []
    };
  }

  if (featureCfg.maintenance_mode) {
    return {
      ok: false,
      status: 503,
      error: 'This AI feature is currently under maintenance. Please try later.',
      details: []
    };
  }

  let creditContext;
  try {
    creditContext = await validateUsageAndCredits({ userId, toolKey, featureCfg, membership });
  } catch (error) {
    return {
      ok: false,
      status: error.status || 400,
      error: error.message || 'Usage policy blocked this request.',
      code: error.code || 'USAGE_POLICY_BLOCKED',
      details: []
    };
  }

  const fallback = generateToolOutput({
    toolKey,
    inputs,
    profile,
    membership,
    roadmaps,
    tool,
    sessionMemory
  });

  if (!fallback.ok) {
    await logAiRequest({
      userId,
      toolKey,
      requestPayload: inputs,
      providerUsed: 'fallback',
      azureAttempted: false,
      fallbackUsed: true,
      success: false,
      errorCode: 'FALLBACK_VALIDATION_FAILED',
      errorSummary: fallback.error,
      responseMs: Date.now() - started,
      estimatedTokens: 0,
      creditsCharged: 0,
      planTier: membership?.tier || 'free'
    });

    return fallback;
  }

  const providerResult = await runAIOrFallback(toolKey, {
    userId,
    inputs,
    profile,
    userMeta,
    resultData: fallback.data,
    promptCfg,
    featureCfg,
    providerRuntime
  });

  const providerUsed = providerResult.providerUsed;
  const azureAttempted = providerResult.azureAttempted;
  const estimatedTokens = providerResult.estimatedTokens;
  const azureError = providerResult.azureError;
  const resultData = providerResult.resultData;

  const chargedCredits = toNumber(featureCfg.monthly_credit_cost, 1, 0, 100000);
  const walletAfter = await updateCredits({
    userId,
    delta: -chargedCredits,
    reason: `tool_use:${toolKey}`,
    toolKey,
    metadata: { providerUsed, responseMode: featureCfg.response_mode },
    actorUserId: userId
  });

  await logAiRequest({
    userId,
    toolKey,
    requestPayload: inputs,
    providerUsed,
    azureAttempted,
    fallbackUsed: providerUsed !== 'azure_openai',
    success: true,
    errorCode: azureError?.code || null,
    errorSummary: azureError ? 'Provider fallback applied successfully.' : null,
    responseMs: Date.now() - started,
    estimatedTokens,
    creditsCharged: chargedCredits,
    planTier: membership?.tier || 'free'
  });

  return {
    ok: true,
    status: 200,
    data: {
      ...resultData,
      aiMeta: {
        provider: providerUsed,
        fallbackActive: providerUsed !== 'azure_openai',
        creditsCharged: chargedCredits,
        creditsLeft: toNumber(walletAfter.credits_balance, 0),
        hiddenTokenMode: walletAfter.hidden_token_mode,
        visibleCreditsLeft: walletAfter.visible_credits_left,
        azureConfigured: Boolean(globalCfg.azureConfigured),
        globalAiEnabled: globalCfg.aiEnabled
      }
    }
  };
}

async function listAiRequestLogs(filters = {}) {
  await ensureAiOpsSchema();
  const clauses = [];
  const params = [];

  if (filters.toolKey) {
    params.push(String(filters.toolKey).trim());
    clauses.push(`tool_key = $${params.length}`);
  }
  if (filters.provider) {
    params.push(String(filters.provider).trim());
    clauses.push(`provider_used = $${params.length}`);
  }
  if (filters.failedOnly) {
    clauses.push('success = FALSE');
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(toNumber(filters.limit, 100, 1, 1000));

  const { rows } = await pool.query(
    `SELECT id, user_id, tool_key, provider_used, success, error_code, error_summary,
            response_ms, estimated_tokens, credits_charged, plan_tier, created_at
     FROM ai_request_logs
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function listAiAuditLogs(limit = 120) {
  await ensureAiOpsSchema();
  const { rows } = await pool.query(
    `SELECT id, actor_user_id, action, target_type, target_key, created_at
     FROM ai_admin_audit_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [toNumber(limit, 120, 1, 1000)]
  );
  return rows;
}

async function getAiAnalytics(days = 30) {
  await ensureAiOpsSchema();
  const safeDays = toNumber(days, 30, 1, 180);
  const sinceExpr = `${safeDays} days`;

  const [summary, features, providers, topUsers, trend, suspicious] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(*)::int AS total_requests,
        COUNT(*) FILTER (WHERE success = TRUE)::int AS success_count,
        COUNT(*) FILTER (WHERE success = FALSE)::int AS failure_count,
        COALESCE(AVG(response_ms), 0)::numeric(10,2) AS avg_response_ms,
        COALESCE(SUM(credits_charged), 0)::int AS credits_consumed,
        COALESCE(SUM(CASE WHEN provider_used = 'azure_openai' THEN estimated_tokens ELSE 0 END), 0)::int AS azure_tokens,
        COALESCE(SUM(CASE WHEN provider_used = 'azure_openai' THEN estimated_tokens * 0.000002 ELSE 0 END), 0)::numeric(12,4) AS estimated_ai_cost
      FROM ai_request_logs
      WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval`,
      [sinceExpr]
    ),
    pool.query(
      `SELECT tool_key,
              COUNT(*)::int AS uses,
              COUNT(*) FILTER (WHERE success = FALSE)::int AS failures,
              COALESCE(SUM(credits_charged), 0)::int AS credits
       FROM ai_request_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval
       GROUP BY tool_key
       ORDER BY uses DESC`,
      [sinceExpr]
    ),
    pool.query(
      `SELECT provider_used,
              COUNT(*)::int AS requests,
              COUNT(*) FILTER (WHERE success = TRUE)::int AS success,
              COUNT(*) FILTER (WHERE success = FALSE)::int AS failures
       FROM ai_request_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval
       GROUP BY provider_used
       ORDER BY requests DESC`,
      [sinceExpr]
    ),
    pool.query(
      `SELECT user_id,
              COUNT(*)::int AS requests,
              COALESCE(SUM(credits_charged), 0)::int AS credits
       FROM ai_request_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval
       GROUP BY user_id
       ORDER BY requests DESC
       LIMIT 10`,
      [sinceExpr]
    ),
    pool.query(
      `SELECT DATE(created_at) AS day,
              COUNT(*)::int AS requests,
              COALESCE(SUM(credits_charged), 0)::int AS credits
       FROM ai_request_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [sinceExpr]
    ),
    pool.query(
      `SELECT user_id,
              COUNT(*)::int AS requests,
              COUNT(*) FILTER (WHERE success = FALSE)::int AS failures,
              COALESCE(SUM(credits_charged), 0)::int AS credits
       FROM ai_request_logs
       WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval
       GROUP BY user_id
       HAVING COUNT(*) >= 20 AND (COUNT(*) FILTER (WHERE success = FALSE) >= 5 OR SUM(credits_charged) >= 120)
       ORDER BY failures DESC, requests DESC
       LIMIT 20`,
      [sinceExpr]
    )
  ]);

  const summaryRow = summary.rows[0] || {};
  const total = toNumber(summaryRow.total_requests, 0);
  const premiumResult = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE plan_tier <> 'free')::int AS paid_requests,
      COUNT(*)::int AS total_requests
     FROM ai_request_logs
     WHERE created_at >= CURRENT_TIMESTAMP - ($1::text)::interval`,
    [sinceExpr]
  );
  const p = premiumResult.rows[0] || {};
  const premiumConversionImpact = toNumber(p.total_requests, 0) > 0
    ? Math.round((toNumber(p.paid_requests, 0) / toNumber(p.total_requests, 1)) * 100)
    : 0;

  return {
    generatedAt: nowIso(),
    days: safeDays,
    totals: {
      totalRequests: total,
      successCount: toNumber(summaryRow.success_count, 0),
      failureCount: toNumber(summaryRow.failure_count, 0),
      avgResponseMs: toNumber(summaryRow.avg_response_ms, 0),
      creditsConsumed: toNumber(summaryRow.credits_consumed, 0),
      estimatedAiCost: toNumber(summaryRow.estimated_ai_cost, 0),
      premiumConversionImpactPercent: premiumConversionImpact
    },
    featureUsage: features.rows,
    providerHealth: providers.rows,
    topUsers: topUsers.rows,
    trend,
    suspiciousUsers: suspicious.rows
  };
}

async function getStudentAiRuntimeConfig(userId, membership) {
  await ensureAiOpsSchema();
  const wallet = await ensureWallet(userId);
  const plan = planForMembership(membership);
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(monthly_credits), 0)::int AS plan_credits
      FROM ai_plan_entitlements
      WHERE plan_code = $1`,
    [plan]
  );

  return {
    creditsLeft: toNumber(wallet.credits_balance, 0),
    hiddenTokenMode: wallet.hidden_token_mode,
    visibleCreditsLeft: wallet.visible_credits_left,
    abuseBlocked: wallet.abuse_blocked,
    planCode: plan,
    planCredits: toNumber(rows[0]?.plan_credits, 0),
    freeTrialCredits: toNumber(wallet.free_trial_credits, 0),
    monthlyPlanCredits: toNumber(wallet.monthly_plan_credits, 0)
  };
}

async function simulatePromptAndOutput({ toolKey, inputs, profile, membership, userMeta }) {
  await ensureAiOpsSchema();
  const prompt = await getPrompt(toolKey);
  const context = extractContextFromInputs(toolKey, inputs || {}, profile || {}, userMeta || {});
  const renderedPrompt = buildPromptTemplate(prompt, context);

  const fallback = generateToolOutput({
    toolKey,
    inputs,
    profile,
    membership,
    roadmaps: [],
    tool: { title: toolKey },
    sessionMemory: {}
  });

  return {
    toolKey,
    renderedPrompt,
    fallbackPreview: fallback.ok ? fallback.data.result : null,
    generatedAt: nowIso()
  };
}

module.exports = {
  TOOL_KEYS,
  ensureAiOpsSchema,
  isAIEnabled,
  isAzureConfigured,
  runAIOrFallback,
  getGlobalSettingsForAdmin,
  updateGlobalSettings,
  testAzureConnection,
  listFeatureSettings,
  getFeatureSetting,
  updateFeatureSetting,
  getPrompt,
  listPromptVersions,
  updatePrompt,
  restorePromptVersion,
  getWalletSummary,
  resetUserCredits,
  applyUserCreditBonus,
  updateUserUsageOverride,
  setAbuseBlocked,
  getPlanEntitlements,
  updatePlanEntitlements,
  executeManagedAiToolGeneration,
  listAiRequestLogs,
  listAiAuditLogs,
  getAiAnalytics,
  getStudentAiRuntimeConfig,
  simulatePromptAndOutput
};
