const crypto = require('crypto');
const { pool } = require('../../db/pool');
const logger = require('../../services/logger');
const { TOOL_KEYS, DEFAULT_PROVIDER_KEYS } = require('./constants');
const { encryptSecretValue, decryptSecretValue, maskSecret } = require('./crypto');

let schemaReady = false;

function nowIsoDay() {
  return new Date().toISOString().slice(0, 10);
}

function nowIsoMonth() {
  return new Date().toISOString().slice(0, 7);
}

function safeText(value, max = 4000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function toInt(value, fallback, min = 0, max = 1000000) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function cacheKeyFor(toolKey, inputs, providerKey, promptVersion) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({ toolKey, inputs, providerKey, promptVersion }), 'utf8')
    .digest('hex');
  return `ai:${toolKey}:${digest}`;
}

async function ensureAiGatewaySchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_provider_configs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      provider_key VARCHAR(80) UNIQUE NOT NULL,
      display_name VARCHAR(120) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
      region VARCHAR(120),
      model_name VARCHAR(200),
      endpoint_url TEXT,
      api_key_enc TEXT,
      access_key_enc TEXT,
      secret_key_enc TEXT,
      session_token_enc TEXT,
      api_version VARCHAR(120),
      deployment_name VARCHAR(200),
      headers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      request_template TEXT,
      max_tokens INTEGER NOT NULL DEFAULT 900,
      temperature NUMERIC(5,2) NOT NULL DEFAULT 0.30,
      timeout_ms INTEGER NOT NULL DEFAULT 15000,
      retry_count INTEGER NOT NULL DEFAULT 1,
      maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
      extra_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_tool_configs (
      tool_key VARCHAR(120) PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      premium_only BOOLEAN NOT NULL DEFAULT FALSE,
      daily_limit INTEGER NOT NULL DEFAULT 20,
      monthly_limit INTEGER NOT NULL DEFAULT 300,
      token_quota INTEGER NOT NULL DEFAULT 10000,
      max_tokens INTEGER NOT NULL DEFAULT 900,
      temperature NUMERIC(5,2) NOT NULL DEFAULT 0.30,
      timeout_ms INTEGER NOT NULL DEFAULT 15000,
      retry_count INTEGER NOT NULL DEFAULT 1,
      cache_ttl_sec INTEGER NOT NULL DEFAULT 1800,
      maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
      allow_stream BOOLEAN NOT NULL DEFAULT TRUE,
      provider_override VARCHAR(80),
      fallback_provider_override VARCHAR(80),
      model_override VARCHAR(240),
      endpoint_override TEXT,
      fallback_model_override VARCHAR(240),
      dedupe_window_ms INTEGER NOT NULL DEFAULT 8000,
      free_daily_limit INTEGER NOT NULL DEFAULT 5,
      free_monthly_limit INTEGER NOT NULL DEFAULT 120,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER REFERENCES users(id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_logs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      tool_key VARCHAR(120) NOT NULL,
      provider_key VARCHAR(80) NOT NULL,
      request_tokens INTEGER NOT NULL DEFAULT 0,
      response_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      quality_score NUMERIC(5,2),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_response_cache (
      cache_key VARCHAR(160) PRIMARY KEY,
      tool_key VARCHAR(120) NOT NULL,
      provider_key VARCHAR(80) NOT NULL,
      response_payload JSONB NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_prompt_templates (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      tool_key VARCHAR(120) NOT NULL,
      template_version INTEGER NOT NULL DEFAULT 1,
      system_prompt TEXT NOT NULL,
      user_prompt TEXT NOT NULL,
      output_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by INTEGER REFERENCES users(id),
      UNIQUE (tool_key, template_version)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_user_usage (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_key VARCHAR(120) NOT NULL,
      day_bucket DATE NOT NULL,
      month_bucket VARCHAR(7) NOT NULL,
      daily_count INTEGER NOT NULL DEFAULT 0,
      monthly_count INTEGER NOT NULL DEFAULT 0,
      daily_tokens INTEGER NOT NULL DEFAULT 0,
      monthly_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, tool_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_cost_tracking (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      day_bucket DATE NOT NULL,
      provider_key VARCHAR(80) NOT NULL,
      tool_key VARCHAR(120) NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0,
      tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (day_bucket, provider_key, tool_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_failover_logs (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      tool_key VARCHAR(120) NOT NULL,
      primary_provider VARCHAR(80) NOT NULL,
      fallback_provider VARCHAR(80),
      error_code VARCHAR(120),
      error_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created
    ON ai_usage_logs(created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires
    ON ai_response_cache(expires_at)
  `);

  await pool.query(`ALTER TABLE ai_provider_configs ADD COLUMN IF NOT EXISTS session_token_enc TEXT`);
  await pool.query(`ALTER TABLE ai_provider_configs ADD COLUMN IF NOT EXISTS api_version VARCHAR(120)`);
  await pool.query(`ALTER TABLE ai_provider_configs ADD COLUMN IF NOT EXISTS deployment_name VARCHAR(200)`);
  await pool.query(`ALTER TABLE ai_provider_configs ADD COLUMN IF NOT EXISTS headers_json JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`ALTER TABLE ai_provider_configs ADD COLUMN IF NOT EXISTS request_template TEXT`);

  await pool.query(`ALTER TABLE ai_tool_configs ADD COLUMN IF NOT EXISTS model_override VARCHAR(240)`);
  await pool.query(`ALTER TABLE ai_tool_configs ADD COLUMN IF NOT EXISTS endpoint_override TEXT`);
  await pool.query(`ALTER TABLE ai_tool_configs ADD COLUMN IF NOT EXISTS fallback_model_override VARCHAR(240)`);
  await pool.query(`ALTER TABLE ai_tool_configs ADD COLUMN IF NOT EXISTS dedupe_window_ms INTEGER NOT NULL DEFAULT 8000`);

  for (const providerKey of DEFAULT_PROVIDER_KEYS) {
    await pool.query(
      `INSERT INTO ai_provider_configs (provider_key, display_name, is_active, is_fallback, region, model_name)
       VALUES ($1, $2, FALSE, FALSE, $3, $4)
       ON CONFLICT (provider_key) DO NOTHING`,
      [providerKey, providerKey.replace('_', ' ').toUpperCase(), providerKey === 'aws_bedrock' ? 'us-east-1' : null, providerKey === 'aws_bedrock' ? 'anthropic.claude-3-haiku-20240307-v1:0' : null]
    );
  }

  await pool.query(`
    UPDATE ai_provider_configs
    SET is_active = TRUE
    WHERE provider_key = 'aws_bedrock'
      AND NOT EXISTS (
        SELECT 1 FROM ai_provider_configs WHERE is_active = TRUE
      )
  `);

  for (const toolKey of TOOL_KEYS) {
    await pool.query(
      `INSERT INTO ai_tool_configs (tool_key, premium_only, provider_override, fallback_provider_override)
       VALUES ($1, $2, NULL, 'openai')
       ON CONFLICT (tool_key) DO NOTHING`,
      [toolKey, ['quiz-generator', 'flashcards-generator', 'resume-builder', 'interview-generator', 'roadmap-recommender'].includes(toolKey)]
    );

    await pool.query(
      `INSERT INTO ai_prompt_templates (tool_key, template_version, system_prompt, user_prompt, output_schema, is_active)
       VALUES ($1, 1, $2, $3, '{}'::jsonb, TRUE)
       ON CONFLICT (tool_key, template_version) DO NOTHING`,
      [
        toolKey,
        `You are College OS ${toolKey} assistant. Return practical, accurate, and concise output for students.`,
        'Tool: {toolKey}\nUser: {userName}\nProfile: {profileLabel}\nMode: {mode}\nInput:\n{inputJson}'
      ]
    );
  }

  schemaReady = true;
}

function hydrateProviderSecrets(row) {
  if (!row) return null;
  return {
    ...row,
    api_key: decryptSecretValue(row.api_key_enc || ''),
    access_key: decryptSecretValue(row.access_key_enc || ''),
    secret_key: decryptSecretValue(row.secret_key_enc || ''),
    session_token: decryptSecretValue(row.session_token_enc || '')
  };
}

function redactProvider(row) {
  return {
    ...row,
    api_key_masked: maskSecret(decryptSecretValue(row.api_key_enc || '')),
    access_key_masked: maskSecret(decryptSecretValue(row.access_key_enc || '')),
    secret_key_masked: maskSecret(decryptSecretValue(row.secret_key_enc || '')),
    session_token_masked: maskSecret(decryptSecretValue(row.session_token_enc || '')),
    api_key_enc: undefined,
    access_key_enc: undefined,
    secret_key_enc: undefined,
    session_token_enc: undefined
  };
}

async function listProviderConfigsForAdmin() {
  await ensureAiGatewaySchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_provider_configs ORDER BY is_active DESC, provider_key ASC`
  );
  return rows.map(redactProvider);
}

async function getProviderConfig(providerKey) {
  await ensureAiGatewaySchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_provider_configs WHERE provider_key = $1 LIMIT 1`,
    [providerKey]
  );
  return hydrateProviderSecrets(rows[0] || null);
}

async function getActiveProviderConfig() {
  await ensureAiGatewaySchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_provider_configs WHERE is_active = TRUE ORDER BY updated_at DESC LIMIT 1`
  );
  return hydrateProviderSecrets(rows[0] || null);
}

async function getFallbackProviders(excludeProviderKey = '') {
  await ensureAiGatewaySchema();
  const params = [];
  const clauses = ['maintenance_mode = FALSE'];
  if (excludeProviderKey) {
    params.push(excludeProviderKey);
    clauses.push(`provider_key <> $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT * FROM ai_provider_configs
     WHERE ${clauses.join(' AND ')}
     ORDER BY is_fallback DESC, is_active DESC, updated_at DESC`,
    params
  );
  return rows.map(hydrateProviderSecrets);
}

async function activateProvider(providerKey, actorUserId) {
  await ensureAiGatewaySchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE ai_provider_configs SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP`);
    await client.query(
      `UPDATE ai_provider_configs
       SET is_active = TRUE, updated_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE provider_key = $2`,
      [actorUserId || null, providerKey]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return listProviderConfigsForAdmin();
}

async function upsertProviderConfig(payload, actorUserId) {
  await ensureAiGatewaySchema();
  const providerKey = safeText(payload?.providerKey || '', 80);
  if (!providerKey) throw new Error('providerKey is required');

  const existing = await getProviderConfig(providerKey);
  const next = {
    displayName: safeText(payload?.displayName || existing?.display_name || providerKey, 120),
    isActive: payload?.isActive == null ? Boolean(existing?.is_active) : toBool(payload.isActive, false),
    isFallback: payload?.isFallback == null ? Boolean(existing?.is_fallback) : toBool(payload.isFallback, false),
    region: safeText(payload?.region || existing?.region || '', 120) || null,
    modelName: safeText(payload?.modelName || existing?.model_name || '', 200) || null,
    endpointUrl: safeText(payload?.endpointUrl || existing?.endpoint_url || '', 1000) || null,
    maxTokens: toInt(payload?.maxTokens, existing?.max_tokens || 900, 100, 64000),
    temperature: Number(payload?.temperature == null ? existing?.temperature || 0.3 : payload.temperature),
    timeoutMs: toInt(payload?.timeoutMs, existing?.timeout_ms || 15000, 1000, 120000),
    retryCount: toInt(payload?.retryCount, existing?.retry_count || 1, 0, 6),
    maintenanceMode: payload?.maintenanceMode == null ? Boolean(existing?.maintenance_mode) : toBool(payload.maintenanceMode, false),
    apiVersion: safeText(payload?.apiVersion || existing?.api_version || '', 120) || null,
    deploymentName: safeText(payload?.deploymentName || existing?.deployment_name || '', 200) || null,
    headersJson: payload?.headersJson && typeof payload.headersJson === 'object'
      ? payload.headersJson
      : (existing?.headers_json || {}),
    requestTemplate: safeText(payload?.requestTemplate || existing?.request_template || '', 12000) || null,
    apiKeyEnc: existing?.api_key_enc || null,
    accessKeyEnc: existing?.access_key_enc || null,
    secretKeyEnc: existing?.secret_key_enc || null,
    sessionTokenEnc: existing?.session_token_enc || null
  };

  if (Object.prototype.hasOwnProperty.call(payload || {}, 'apiKey')) {
    const apiKey = safeText(payload.apiKey, 3000);
    if (apiKey && !apiKey.includes('*')) next.apiKeyEnc = encryptSecretValue(apiKey);
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'accessKey')) {
    const accessKey = safeText(payload.accessKey, 3000);
    if (accessKey && !accessKey.includes('*')) next.accessKeyEnc = encryptSecretValue(accessKey);
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'secretKey')) {
    const secretKey = safeText(payload.secretKey, 3000);
    if (secretKey && !secretKey.includes('*')) next.secretKeyEnc = encryptSecretValue(secretKey);
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'sessionToken')) {
    const sessionToken = safeText(payload.sessionToken, 4000);
    if (sessionToken && !sessionToken.includes('*')) next.sessionTokenEnc = encryptSecretValue(sessionToken);
  }

  await pool.query(
    `INSERT INTO ai_provider_configs (
      provider_key, display_name, is_active, is_fallback, region, model_name, endpoint_url,
      api_key_enc, access_key_enc, secret_key_enc, session_token_enc, api_version, deployment_name,
      headers_json, request_template, max_tokens, temperature, timeout_ms,
      retry_count, maintenance_mode, updated_by, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,CURRENT_TIMESTAMP
    )
    ON CONFLICT (provider_key)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      is_active = EXCLUDED.is_active,
      is_fallback = EXCLUDED.is_fallback,
      region = EXCLUDED.region,
      model_name = EXCLUDED.model_name,
      endpoint_url = EXCLUDED.endpoint_url,
      api_key_enc = COALESCE(EXCLUDED.api_key_enc, ai_provider_configs.api_key_enc),
      access_key_enc = COALESCE(EXCLUDED.access_key_enc, ai_provider_configs.access_key_enc),
      secret_key_enc = COALESCE(EXCLUDED.secret_key_enc, ai_provider_configs.secret_key_enc),
      session_token_enc = COALESCE(EXCLUDED.session_token_enc, ai_provider_configs.session_token_enc),
      api_version = EXCLUDED.api_version,
      deployment_name = EXCLUDED.deployment_name,
      headers_json = EXCLUDED.headers_json,
      request_template = EXCLUDED.request_template,
      max_tokens = EXCLUDED.max_tokens,
      temperature = EXCLUDED.temperature,
      timeout_ms = EXCLUDED.timeout_ms,
      retry_count = EXCLUDED.retry_count,
      maintenance_mode = EXCLUDED.maintenance_mode,
      updated_by = EXCLUDED.updated_by,
      updated_at = CURRENT_TIMESTAMP`,
    [
      providerKey,
      next.displayName,
      next.isActive,
      next.isFallback,
      next.region,
      next.modelName,
      next.endpointUrl,
      next.apiKeyEnc,
      next.accessKeyEnc,
      next.secretKeyEnc,
      next.sessionTokenEnc,
      next.apiVersion,
      next.deploymentName,
      JSON.stringify(next.headersJson || {}),
      next.requestTemplate,
      next.maxTokens,
      Number.isFinite(next.temperature) ? next.temperature : 0.3,
      next.timeoutMs,
      next.retryCount,
      next.maintenanceMode,
      actorUserId || null
    ]
  );

  if (next.isActive) await activateProvider(providerKey, actorUserId);
  return listProviderConfigsForAdmin();
}

async function getToolConfig(toolKey) {
  await ensureAiGatewaySchema();
  const { rows } = await pool.query(`SELECT * FROM ai_tool_configs WHERE tool_key = $1 LIMIT 1`, [toolKey]);
  return rows[0] || null;
}

async function upsertToolConfig(toolKey, payload, actorUserId) {
  await ensureAiGatewaySchema();
  const prev = await getToolConfig(toolKey);

  const next = {
    enabled: payload?.enabled == null ? prev?.enabled ?? true : toBool(payload.enabled, true),
    premiumOnly: payload?.premiumOnly == null ? prev?.premium_only ?? false : toBool(payload.premiumOnly, false),
    dailyLimit: toInt(payload?.dailyLimit, prev?.daily_limit ?? 20, 1, 100000),
    monthlyLimit: toInt(payload?.monthlyLimit, prev?.monthly_limit ?? 300, 1, 1000000),
    tokenQuota: toInt(payload?.tokenQuota, prev?.token_quota ?? 10000, 100, 5000000),
    maxTokens: toInt(payload?.maxTokens, prev?.max_tokens ?? 900, 100, 64000),
    temperature: Number(payload?.temperature == null ? prev?.temperature ?? 0.3 : payload.temperature),
    timeoutMs: toInt(payload?.timeoutMs, prev?.timeout_ms ?? 15000, 1000, 120000),
    retryCount: toInt(payload?.retryCount, prev?.retry_count ?? 1, 0, 6),
    cacheTtlSec: toInt(payload?.cacheTtlSec, prev?.cache_ttl_sec ?? 1800, 0, 172800),
    maintenanceMode: payload?.maintenanceMode == null ? prev?.maintenance_mode ?? false : toBool(payload.maintenanceMode, false),
    allowStream: payload?.allowStream == null ? prev?.allow_stream ?? true : toBool(payload.allowStream, true),
    providerOverride: safeText(payload?.providerOverride == null ? prev?.provider_override || '' : payload.providerOverride, 80) || null,
    fallbackProviderOverride: safeText(payload?.fallbackProviderOverride == null ? prev?.fallback_provider_override || '' : payload.fallbackProviderOverride, 80) || null,
    modelOverride: safeText(payload?.modelOverride == null ? prev?.model_override || '' : payload.modelOverride, 240) || null,
    endpointOverride: safeText(payload?.endpointOverride == null ? prev?.endpoint_override || '' : payload.endpointOverride, 1200) || null,
    fallbackModelOverride: safeText(payload?.fallbackModelOverride == null ? prev?.fallback_model_override || '' : payload.fallbackModelOverride, 240) || null,
    dedupeWindowMs: toInt(payload?.dedupeWindowMs, prev?.dedupe_window_ms ?? 8000, 0, 120000),
    freeDailyLimit: toInt(payload?.freeDailyLimit, prev?.free_daily_limit ?? 5, 0, 100000),
    freeMonthlyLimit: toInt(payload?.freeMonthlyLimit, prev?.free_monthly_limit ?? 120, 0, 1000000)
  };

  await pool.query(
    `INSERT INTO ai_tool_configs (
      tool_key, enabled, premium_only, daily_limit, monthly_limit, token_quota,
      max_tokens, temperature, timeout_ms, retry_count, cache_ttl_sec,
      maintenance_mode, allow_stream, provider_override, fallback_provider_override,
      model_override, endpoint_override, fallback_model_override, dedupe_window_ms,
      free_daily_limit, free_monthly_limit, updated_by, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,CURRENT_TIMESTAMP
    )
    ON CONFLICT (tool_key)
    DO UPDATE SET
      enabled = EXCLUDED.enabled,
      premium_only = EXCLUDED.premium_only,
      daily_limit = EXCLUDED.daily_limit,
      monthly_limit = EXCLUDED.monthly_limit,
      token_quota = EXCLUDED.token_quota,
      max_tokens = EXCLUDED.max_tokens,
      temperature = EXCLUDED.temperature,
      timeout_ms = EXCLUDED.timeout_ms,
      retry_count = EXCLUDED.retry_count,
      cache_ttl_sec = EXCLUDED.cache_ttl_sec,
      maintenance_mode = EXCLUDED.maintenance_mode,
      allow_stream = EXCLUDED.allow_stream,
      provider_override = EXCLUDED.provider_override,
      fallback_provider_override = EXCLUDED.fallback_provider_override,
      model_override = EXCLUDED.model_override,
      endpoint_override = EXCLUDED.endpoint_override,
      fallback_model_override = EXCLUDED.fallback_model_override,
      dedupe_window_ms = EXCLUDED.dedupe_window_ms,
      free_daily_limit = EXCLUDED.free_daily_limit,
      free_monthly_limit = EXCLUDED.free_monthly_limit,
      updated_by = EXCLUDED.updated_by,
      updated_at = CURRENT_TIMESTAMP`,
    [
      toolKey,
      next.enabled,
      next.premiumOnly,
      next.dailyLimit,
      next.monthlyLimit,
      next.tokenQuota,
      next.maxTokens,
      Number.isFinite(next.temperature) ? next.temperature : 0.3,
      next.timeoutMs,
      next.retryCount,
      next.cacheTtlSec,
      next.maintenanceMode,
      next.allowStream,
      next.providerOverride,
      next.fallbackProviderOverride,
      next.modelOverride,
      next.endpointOverride,
      next.fallbackModelOverride,
      next.dedupeWindowMs,
      next.freeDailyLimit,
      next.freeMonthlyLimit,
      actorUserId || null
    ]
  );

  return getToolConfig(toolKey);
}

async function listToolConfigs() {
  await ensureAiGatewaySchema();
  const { rows } = await pool.query(`SELECT * FROM ai_tool_configs ORDER BY tool_key ASC`);
  return rows;
}

async function getActivePromptTemplate(toolKey) {
  await ensureAiGatewaySchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_prompt_templates
     WHERE tool_key = $1 AND is_active = TRUE
     ORDER BY template_version DESC
     LIMIT 1`,
    [toolKey]
  );
  return rows[0] || null;
}

async function upsertPromptTemplate(toolKey, payload, actorUserId) {
  await ensureAiGatewaySchema();
  const current = await getActivePromptTemplate(toolKey);
  const nextVersion = (current?.template_version || 0) + 1;

  await pool.query(
    `UPDATE ai_prompt_templates
     SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE tool_key = $1`,
    [toolKey]
  );

  await pool.query(
    `INSERT INTO ai_prompt_templates (
      tool_key, template_version, system_prompt, user_prompt, output_schema,
      is_active, updated_by, updated_at
    ) VALUES ($1,$2,$3,$4,$5::jsonb,TRUE,$6,CURRENT_TIMESTAMP)`,
    [
      toolKey,
      nextVersion,
      safeText(payload?.systemPrompt || current?.system_prompt || `You are College OS ${toolKey} assistant.`, 24000),
      String(payload?.userPrompt || current?.user_prompt || 'Input:\n{inputJson}').slice(0, 30000),
      JSON.stringify(payload?.outputSchema || current?.output_schema || {}),
      actorUserId || null
    ]
  );

  return getActivePromptTemplate(toolKey);
}

async function readCache(cacheKey) {
  await ensureAiGatewaySchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_response_cache
     WHERE cache_key = $1 AND expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    [cacheKey]
  );
  const row = rows[0] || null;
  if (!row) return null;

  await pool.query(
    `UPDATE ai_response_cache
     SET hit_count = hit_count + 1
     WHERE cache_key = $1`,
    [cacheKey]
  );

  return row;
}

async function writeCache({ cacheKey, toolKey, providerKey, responsePayload, ttlSec }) {
  await ensureAiGatewaySchema();
  await pool.query(
    `INSERT INTO ai_response_cache (
      cache_key, tool_key, provider_key, response_payload, expires_at, hit_count, created_at
    ) VALUES (
      $1,$2,$3,$4::jsonb,CURRENT_TIMESTAMP + ($5::text || ' seconds')::interval,0,CURRENT_TIMESTAMP
    )
    ON CONFLICT (cache_key)
    DO UPDATE SET
      response_payload = EXCLUDED.response_payload,
      expires_at = EXCLUDED.expires_at,
      provider_key = EXCLUDED.provider_key`,
    [cacheKey, toolKey, providerKey, JSON.stringify(responsePayload), toInt(ttlSec, 1800, 0, 172800)]
  );
}

async function incrementUserUsage({ userId, toolKey, tokens }) {
  await ensureAiGatewaySchema();
  const dayBucket = nowIsoDay();
  const monthBucket = nowIsoMonth();
  const t = toInt(tokens, 0, 0, 10000000);

  await pool.query(
    `INSERT INTO ai_user_usage (
      user_id, tool_key, day_bucket, month_bucket, daily_count, monthly_count,
      daily_tokens, monthly_tokens, updated_at
    ) VALUES ($1,$2,$3,$4,1,1,$5,$5,CURRENT_TIMESTAMP)
    ON CONFLICT (user_id, tool_key)
    DO UPDATE SET
      day_bucket = CASE WHEN ai_user_usage.day_bucket = EXCLUDED.day_bucket THEN ai_user_usage.day_bucket ELSE EXCLUDED.day_bucket END,
      month_bucket = CASE WHEN ai_user_usage.month_bucket = EXCLUDED.month_bucket THEN ai_user_usage.month_bucket ELSE EXCLUDED.month_bucket END,
      daily_count = CASE WHEN ai_user_usage.day_bucket = EXCLUDED.day_bucket THEN ai_user_usage.daily_count + 1 ELSE 1 END,
      monthly_count = CASE WHEN ai_user_usage.month_bucket = EXCLUDED.month_bucket THEN ai_user_usage.monthly_count + 1 ELSE 1 END,
      daily_tokens = CASE WHEN ai_user_usage.day_bucket = EXCLUDED.day_bucket THEN ai_user_usage.daily_tokens + EXCLUDED.daily_tokens ELSE EXCLUDED.daily_tokens END,
      monthly_tokens = CASE WHEN ai_user_usage.month_bucket = EXCLUDED.month_bucket THEN ai_user_usage.monthly_tokens + EXCLUDED.monthly_tokens ELSE EXCLUDED.monthly_tokens END,
      updated_at = CURRENT_TIMESTAMP`,
    [userId, toolKey, dayBucket, monthBucket, t]
  );
}

async function getUserUsage(userId, toolKey) {
  await ensureAiGatewaySchema();
  const { rows } = await pool.query(
    `SELECT * FROM ai_user_usage WHERE user_id = $1 AND tool_key = $2 LIMIT 1`,
    [userId, toolKey]
  );
  return rows[0] || null;
}

async function logAiUsage({ userId, toolKey, providerKey, requestTokens, responseTokens, totalTokens, latencyMs, success, qualityScore }) {
  await ensureAiGatewaySchema();
  await pool.query(
    `INSERT INTO ai_usage_logs (
      user_id, tool_key, provider_key, request_tokens, response_tokens,
      total_tokens, latency_ms, success, quality_score
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      userId || null,
      toolKey,
      providerKey,
      toInt(requestTokens, 0, 0, 10000000),
      toInt(responseTokens, 0, 0, 10000000),
      toInt(totalTokens, 0, 0, 10000000),
      toInt(latencyMs, 0, 0, 1200000),
      Boolean(success),
      qualityScore == null ? null : Number(qualityScore)
    ]
  );
}

async function logRequest({ userId, toolKey, payload, providerUsed, success, latencyMs, tokens, errorCode, errorSummary, planTier }) {
  await ensureAiGatewaySchema();
  try {
    await pool.query(
      `INSERT INTO ai_request_logs (
        user_id, tool_key, request_payload, provider_used, azure_attempted,
        fallback_used, success, error_code, error_summary, response_ms,
        estimated_tokens, credits_charged, plan_tier
      ) VALUES ($1,$2,$3::jsonb,$4,FALSE,$5,$6,$7,$8,$9,$10,0,$11)`,
      [
        userId || null,
        toolKey,
        JSON.stringify(payload || {}),
        providerUsed || 'fallback',
        providerUsed !== 'aws_bedrock' && providerUsed !== 'openai' && providerUsed !== 'anthropic' && providerUsed !== 'azure_openai' && providerUsed !== 'custom_rest',
        Boolean(success),
        errorCode || null,
        safeText(errorSummary || '', 1200) || null,
        toInt(latencyMs, 0, 0, 3600000),
        toInt(tokens, 0, 0, 10000000),
        safeText(planTier || 'free', 40)
      ]
    );
  } catch (error) {
    logger.warn('AI request logging failed for ai_request_logs', {
      code: 'AI_REQUEST_LOG_FAILED',
      message: error.message
    });
  }
}

async function logFailover({ userId, toolKey, primaryProvider, fallbackProvider, errorCode, errorMessage }) {
  await ensureAiGatewaySchema();
  await pool.query(
    `INSERT INTO ai_failover_logs (
      user_id, tool_key, primary_provider, fallback_provider, error_code, error_message
    ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      userId || null,
      toolKey,
      safeText(primaryProvider, 80),
      safeText(fallbackProvider || '', 80) || null,
      safeText(errorCode || '', 120) || null,
      safeText(errorMessage || '', 2000) || null
    ]
  );
}

async function trackCost({ providerKey, toolKey, tokens, estimatedCostUsd }) {
  await ensureAiGatewaySchema();
  await pool.query(
    `INSERT INTO ai_cost_tracking (
      day_bucket, provider_key, tool_key, requests, tokens, cost_usd, updated_at
    ) VALUES (CURRENT_DATE,$1,$2,1,$3,$4,CURRENT_TIMESTAMP)
    ON CONFLICT (day_bucket, provider_key, tool_key)
    DO UPDATE SET
      requests = ai_cost_tracking.requests + 1,
      tokens = ai_cost_tracking.tokens + EXCLUDED.tokens,
      cost_usd = ai_cost_tracking.cost_usd + EXCLUDED.cost_usd,
      updated_at = CURRENT_TIMESTAMP`,
    [
      safeText(providerKey, 80),
      safeText(toolKey, 120),
      toInt(tokens, 0, 0, 100000000),
      Number.isFinite(estimatedCostUsd) ? estimatedCostUsd : 0
    ]
  );
}

module.exports = {
  cacheKeyFor,
  ensureAiGatewaySchema,
  listProviderConfigsForAdmin,
  getProviderConfig,
  getActiveProviderConfig,
  getFallbackProviders,
  activateProvider,
  upsertProviderConfig,
  getToolConfig,
  listToolConfigs,
  upsertToolConfig,
  getActivePromptTemplate,
  upsertPromptTemplate,
  readCache,
  writeCache,
  getUserUsage,
  incrementUserUsage,
  logAiUsage,
  logRequest,
  logFailover,
  trackCost
};
