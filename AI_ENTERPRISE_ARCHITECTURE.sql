-- Enterprise AI architecture bootstrap for College OS
-- Safe to run multiple times (idempotent DDL)

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
  max_tokens INTEGER NOT NULL DEFAULT 900,
  temperature NUMERIC(5,2) NOT NULL DEFAULT 0.30,
  timeout_ms INTEGER NOT NULL DEFAULT 15000,
  retry_count INTEGER NOT NULL DEFAULT 1,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  extra_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id)
);

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
  free_daily_limit INTEGER NOT NULL DEFAULT 5,
  free_monthly_limit INTEGER NOT NULL DEFAULT 120,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id)
);

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
);

CREATE TABLE IF NOT EXISTS ai_response_cache (
  cache_key VARCHAR(160) PRIMARY KEY,
  tool_key VARCHAR(120) NOT NULL,
  provider_key VARCHAR(80) NOT NULL,
  response_payload JSONB NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
);

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
);

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
);

CREATE TABLE IF NOT EXISTS ai_failover_logs (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tool_key VARCHAR(120) NOT NULL,
  primary_provider VARCHAR(80) NOT NULL,
  fallback_provider VARCHAR(80),
  error_code VARCHAR(120),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created ON ai_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires ON ai_response_cache(expires_at);
