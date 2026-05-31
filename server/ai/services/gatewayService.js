const logger = require('../../services/logger');
const { generateToolOutput } = require('../../services/aiToolEngine');
const { runProvider } = require('../providers');
const { normalizeAiResult } = require('../formatters/responseFormatter');
const { sanitizeInputObject, moderatePrompt, safeText } = require('../validators/safety');
const {
  TOOL_KEYS
} = require('./constants');
const {
  cacheKeyFor,
  ensureAiGatewaySchema,
  getToolConfig,
  getActivePromptTemplate,
  getProviderConfig,
  getActiveProviderConfig,
  getFallbackProviders,
  readCache,
  writeCache,
  getUserUsage,
  incrementUserUsage,
  logAiUsage,
  logRequest,
  logFailover,
  trackCost
} = require('./configRepository');

const inFlightRequests = new Map();

function renderPrompt(template, context) {
  const map = {
    '{toolKey}': context.toolKey,
    '{userName}': safeText(context.userName || 'Student', 120),
    '{profileLabel}': safeText(context.profileLabel || 'General profile', 160),
    '{mode}': safeText(context.mode || 'Auto', 30),
    '{inputJson}': JSON.stringify(context.inputs || {}, null, 2)
  };

  return Object.entries(map).reduce((acc, [key, value]) => acc.split(key).join(value), template);
}

function estimateCostUsd(providerKey, tokens) {
  const t = Math.max(0, Number(tokens || 0));
  if (!t) return 0;
  if (providerKey === 'aws_bedrock') return t * 0.0000022;
  if (providerKey === 'openai') return t * 0.0000020;
  if (providerKey === 'anthropic') return t * 0.0000028;
  if (providerKey === 'azure_openai') return t * 0.0000021;
  return t * 0.0000015;
}

function buildStructuredSections(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    return [{ heading: 'AI Output', type: 'paragraphs', items: ['No content returned from provider.'] }];
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const bulletLines = lines.filter((line) => /^[-*\d.]/.test(line)).map((line) => line.replace(/^[-*\d.\s]+/, '').trim());
  if (bulletLines.length >= 3) {
    return [{ heading: 'Generated Output', type: 'bullets', items: bulletLines.slice(0, 30) }];
  }

  return [{
    heading: 'Generated Output',
    type: 'paragraphs',
    items: raw.split(/\n\n+/).map((chunk) => chunk.trim()).filter(Boolean).slice(0, 12)
  }];
}

async function validateToolAccess({ userId, toolKey, membership }) {
  if (!TOOL_KEYS.includes(toolKey)) {
    const err = new Error('Unsupported AI tool key.');
    err.code = 'TOOL_NOT_SUPPORTED';
    err.status = 400;
    throw err;
  }

  const cfg = await getToolConfig(toolKey);
  if (!cfg) {
    const err = new Error('AI tool config not found.');
    err.code = 'TOOL_CONFIG_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  if (!cfg.enabled) {
    const err = new Error('This AI tool is disabled by admin.');
    err.code = 'TOOL_DISABLED';
    err.status = 503;
    throw err;
  }

  if (cfg.maintenance_mode) {
    const err = new Error('This AI tool is under maintenance.');
    err.code = 'TOOL_MAINTENANCE';
    err.status = 503;
    throw err;
  }

  if (cfg.premium_only && !(membership?.premiumActive || membership?.isAdmin)) {
    const err = new Error('This AI tool is available on premium plan.');
    err.code = 'UPGRADE_REQUIRED';
    err.status = 403;
    throw err;
  }

  const usage = await getUserUsage(userId, toolKey);
  const today = new Date().toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7);

  const dailyCount = usage?.day_bucket && String(usage.day_bucket).slice(0, 10) === today ? Number(usage.daily_count || 0) : 0;
  const monthlyCount = usage?.month_bucket === month ? Number(usage.monthly_count || 0) : 0;

  const dailyLimit = membership?.premiumActive || membership?.isAdmin ? Number(cfg.daily_limit || 20) : Number(cfg.free_daily_limit || 5);
  const monthlyLimit = membership?.premiumActive || membership?.isAdmin ? Number(cfg.monthly_limit || 300) : Number(cfg.free_monthly_limit || 120);

  if (dailyCount >= dailyLimit) {
    const err = new Error('Daily AI usage limit reached for this tool.');
    err.code = 'DAILY_LIMIT_REACHED';
    err.status = 429;
    throw err;
  }

  if (monthlyCount >= monthlyLimit) {
    const err = new Error('Monthly AI usage limit reached for this tool.');
    err.code = 'MONTHLY_LIMIT_REACHED';
    err.status = 429;
    throw err;
  }

  return cfg;
}

async function runWithProviderChain({ provider, fallbacks, prompt, toolConfig, context }) {
  const retries = Math.max(0, Number(toolConfig.retry_count || provider.retry_count || 1));

  let lastError = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      const result = await runProvider(provider, {
        prompt,
        toolConfig,
        context
      });
      return { providerKey: provider.provider_key, result, fallbackUsed: false };
    } catch (error) {
      lastError = error;
    }
  }

  for (const fallback of fallbacks) {
    try {
      const fallbackProvider = {
        ...fallback,
        model_name: toolConfig.fallback_model_override || fallback.model_name,
        endpoint_url: fallback.endpoint_url
      };
      const result = await runProvider(fallbackProvider, {
        prompt,
        toolConfig: {
          ...toolConfig,
          max_tokens: toolConfig.max_tokens || fallbackProvider.max_tokens,
          temperature: toolConfig.temperature,
          timeout_ms: toolConfig.timeout_ms || fallbackProvider.timeout_ms,
          retry_count: toolConfig.retry_count || fallbackProvider.retry_count
        },
        context
      });
      return {
        providerKey: fallbackProvider.provider_key,
        result,
        fallbackUsed: true,
        primaryError: lastError
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('All providers failed.');
}

async function generateAiToolResponse({
  userId,
  toolKey,
  tool,
  inputs,
  profile,
  membership,
  roadmaps,
  sessionMemory,
  userMeta
}) {
  const started = Date.now();
  await ensureAiGatewaySchema();

  const sanitizedInputs = sanitizeInputObject(inputs);
  const moderation = moderatePrompt(sanitizedInputs);
  if (moderation.blocked) {
    return {
      ok: false,
      status: 400,
      error: moderation.reason,
      code: 'MODERATION_BLOCKED',
      details: []
    };
  }

  let toolConfig;
  try {
    toolConfig = await validateToolAccess({ userId, toolKey, membership });
  } catch (error) {
    return {
      ok: false,
      status: error.status || 400,
      error: error.message || 'Tool access failed.',
      code: error.code || 'TOOL_ACCESS_DENIED',
      details: []
    };
  }

  const activePrompt = await getActivePromptTemplate(toolKey);
  const activeProvider = await getActiveProviderConfig();
  const selectedProviderKey = toolConfig.provider_override || activeProvider?.provider_key || 'aws_bedrock';
  const baseFallbacks = await getFallbackProviders(selectedProviderKey);
  const fallbackPriority = [];
  if (toolConfig.fallback_provider_override && toolConfig.fallback_provider_override !== selectedProviderKey) {
    const preferredFallback = await getProviderConfig(toolConfig.fallback_provider_override);
    if (preferredFallback?.provider_key) fallbackPriority.push(preferredFallback);
  }
  const allFallbacks = fallbackPriority.concat(
    baseFallbacks.filter((item) => item.provider_key !== toolConfig.fallback_provider_override)
  );

  const cacheKey = cacheKeyFor(toolKey, sanitizedInputs, selectedProviderKey, activePrompt?.template_version || 1);
  const dedupeWindowMs = Math.max(0, Number(toolConfig.dedupe_window_ms || 0));
  if (dedupeWindowMs > 0 && inFlightRequests.has(cacheKey)) {
    const active = inFlightRequests.get(cacheKey);
    if (Date.now() - active.startedAt <= dedupeWindowMs) {
      return active.promise;
    }
    inFlightRequests.delete(cacheKey);
  }

  const runPromise = (async () => {
  const cached = await readCache(cacheKey);
  if (cached) {
    await logRequest({
      userId,
      toolKey,
      payload: sanitizedInputs,
      providerUsed: cached.provider_key,
      success: true,
      latencyMs: Date.now() - started,
      tokens: 0,
      errorCode: null,
      errorSummary: null,
      planTier: membership?.premiumActive || membership?.isAdmin ? 'premium' : 'free'
    });

    return {
      ok: true,
      status: 200,
      data: {
        ...cached.response_payload,
        aiMeta: {
          ...(cached.response_payload?.aiMeta || {}),
          cacheHit: true
        }
      }
    };
  }

  const fallbackEngineOutput = generateToolOutput({
    toolKey,
    inputs: sanitizedInputs,
    profile,
    membership,
    roadmaps,
    tool,
    sessionMemory
  });

  if (!fallbackEngineOutput.ok) {
    return fallbackEngineOutput;
  }

  const prompt = {
    systemPrompt: activePrompt?.system_prompt || `You are College OS assistant for ${toolKey}.`,
    userPrompt: renderPrompt(activePrompt?.user_prompt || 'Input:\n{inputJson}', {
      toolKey,
      userName: userMeta?.full_name || userMeta?.name || 'Student',
      profileLabel: [profile?.category_name, profile?.branch_name, profile?.semester_label].filter(Boolean).join(' | ') || 'General profile',
      mode: sanitizedInputs.mode || 'Auto',
      inputs: sanitizedInputs
    })
  };

  let providerExecution;
  try {
    const primary = (selectedProviderKey === activeProvider?.provider_key)
      ? activeProvider
      : await getProviderConfig(selectedProviderKey);

    const primaryProvider = primary && primary.provider_key
      ? {
          ...primary,
          model_name: toolConfig.model_override || primary.model_name,
          endpoint_url: toolConfig.endpoint_override || primary.endpoint_url
        }
      : { provider_key: 'aws_bedrock', model_name: process.env.AWS_BEDROCK_MODEL || 'anthropic.claude-3-haiku-20240307-v1:0', region: process.env.AWS_REGION || 'us-east-1' };

    providerExecution = await runWithProviderChain({
      provider: primaryProvider,
      fallbacks: allFallbacks,
      prompt,
      toolConfig,
      context: { toolKey, userId, profile, membership, inputs: sanitizedInputs }
    });
  } catch (error) {
    providerExecution = null;
    logger.warn('AI provider chain failed, serving deterministic fallback', {
      code: error.code || 'PROVIDER_CHAIN_FAILED',
      message: error.message,
      toolKey,
      userId
    });

    await logFailover({
      userId,
      toolKey,
      primaryProvider: selectedProviderKey,
      fallbackProvider: toolConfig.fallback_provider_override || null,
      errorCode: error.code || 'PROVIDER_CHAIN_FAILED',
      errorMessage: error.message
    });
  }

  let payload = null;
  let providerKey = selectedProviderKey;
  let fallbackUsed = false;
  let totalTokens = 0;

  if (providerExecution?.result?.text) {
    providerKey = providerExecution.providerKey;
    fallbackUsed = providerExecution.fallbackUsed;
    totalTokens = Number(providerExecution.result.tokens || 0);
    const enriched = {
      title: fallbackEngineOutput.data.result?.title || tool?.title || toolKey,
      badges: Array.isArray(fallbackEngineOutput.data.result?.badges) ? fallbackEngineOutput.data.result.badges : [],
      keyTakeaway: fallbackEngineOutput.data.result?.keyTakeaway || 'Generated via enterprise AI gateway.',
      sections: buildStructuredSections(providerExecution.result.text),
      followUps: Array.isArray(fallbackEngineOutput.data.result?.followUps) ? fallbackEngineOutput.data.result.followUps : [],
      warnings: Array.isArray(fallbackEngineOutput.data.result?.warnings) ? fallbackEngineOutput.data.result.warnings : []
    };

    payload = normalizeAiResult({
      toolKey,
      toolTitle: tool?.title || toolKey,
      result: enriched,
      providerKey,
      fallbackUsed,
      meta: fallbackEngineOutput.data.meta
    });
    payload.memory = fallbackEngineOutput.data.memory || {};
  } else {
    await logRequest({
      userId,
      toolKey,
      payload: sanitizedInputs,
      providerUsed: selectedProviderKey,
      success: false,
      latencyMs: Date.now() - started,
      tokens: 0,
      errorCode: 'PROVIDER_CHAIN_FAILED',
      errorSummary: 'All configured providers failed for this request.',
      planTier: membership?.premiumActive || membership?.isAdmin ? 'premium' : 'free'
    });

    return {
      ok: false,
      status: 503,
      code: 'PROVIDER_CHAIN_FAILED',
      error: 'AI provider is temporarily unavailable. Please retry shortly.',
      details: []
    };
  }

  const latencyMs = Date.now() - started;
  const estimatedCost = estimateCostUsd(providerKey, totalTokens);

  await incrementUserUsage({ userId, toolKey, tokens: totalTokens });
  await logAiUsage({
    userId,
    toolKey,
    providerKey,
    requestTokens: 0,
    responseTokens: totalTokens,
    totalTokens,
    latencyMs,
    success: true,
    qualityScore: payload?.result?.quality?.score || null
  });

  await logRequest({
    userId,
    toolKey,
    payload: sanitizedInputs,
    providerUsed: providerKey,
    success: true,
    latencyMs,
    tokens: totalTokens,
    errorCode: null,
    errorSummary: null,
    planTier: membership?.premiumActive || membership?.isAdmin ? 'premium' : 'free'
  });

  await trackCost({ providerKey, toolKey, tokens: totalTokens, estimatedCostUsd: estimatedCost });

  await writeCache({
    cacheKey,
    toolKey,
    providerKey,
    responsePayload: payload,
    ttlSec: Number(toolConfig.cache_ttl_sec || 1800)
  });

  return {
    ok: true,
    status: 200,
    data: {
      ...payload,
      aiMeta: {
        ...(payload.aiMeta || {}),
        provider: providerKey,
        fallbackActive: fallbackUsed,
        latencyMs,
        tokenUsage: totalTokens,
        estimatedCostUsd: Number(estimatedCost.toFixed(6)),
        cacheHit: false
      }
    }
  };
  })();

  if (dedupeWindowMs > 0) {
    inFlightRequests.set(cacheKey, { startedAt: Date.now(), promise: runPromise });
  }

  try {
    return await runPromise;
  } finally {
    if (dedupeWindowMs > 0) {
      const active = inFlightRequests.get(cacheKey);
      if (active?.promise === runPromise) {
        inFlightRequests.delete(cacheKey);
      }
    }
  }
}

module.exports = {
  generateAiToolResponse
};
