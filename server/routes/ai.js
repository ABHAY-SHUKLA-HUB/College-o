const express = require('express');
const { requireAuth, requireAdmin, resolveMembershipState } = require('../middleware/auth');
const { presets } = require('../middleware/rateLimiter');
const {
  TOOL_ROUTE_MAP,
  TOOL_KEYS
} = require('../ai/services/constants');
const {
  ensureAiGatewaySchema,
  listProviderConfigsForAdmin,
  upsertProviderConfig,
  activateProvider,
  listToolConfigs,
  upsertToolConfig,
  getActivePromptTemplate,
  upsertPromptTemplate
} = require('../ai/services/configRepository');
const { getAiGatewayAnalytics } = require('../ai/analytics/analyticsService');
const { generateAiToolResponse } = require('../ai/services/gatewayService');

const router = express.Router();

router.use(async (_req, _res, next) => {
  try {
    await ensureAiGatewaySchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.use(presets.default);

function resolveToolKey(routeKey) {
  return TOOL_ROUTE_MAP[String(routeKey || '').trim().toLowerCase()] || null;
}

router.get('/admin/provider-configs', requireAdmin, async (_req, res) => {
  const providers = await listProviderConfigsForAdmin();
  return res.json({ providers });
});

router.put('/admin/provider-configs/:providerKey', requireAdmin, async (req, res) => {
  const providerKey = String(req.params.providerKey || '').trim();
  const providers = await upsertProviderConfig({
    ...(req.body || {}),
    providerKey
  }, req.session.userId);
  return res.json({ providers });
});

router.post('/admin/provider-configs/:providerKey/activate', requireAdmin, async (req, res) => {
  const providerKey = String(req.params.providerKey || '').trim();
  const providers = await activateProvider(providerKey, req.session.userId);
  return res.json({ providers });
});

router.get('/admin/tool-configs', requireAdmin, async (_req, res) => {
  const toolConfigs = await listToolConfigs();
  return res.json({ toolConfigs });
});

router.put('/admin/tool-configs/:toolKey', requireAdmin, async (req, res) => {
  const toolKey = String(req.params.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) {
    return res.status(404).json({ error: 'Unknown tool key.' });
  }
  const toolConfig = await upsertToolConfig(toolKey, req.body || {}, req.session.userId);
  return res.json({ toolConfig });
});

router.get('/admin/prompts/:toolKey', requireAdmin, async (req, res) => {
  const toolKey = String(req.params.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) {
    return res.status(404).json({ error: 'Unknown tool key.' });
  }
  const prompt = await getActivePromptTemplate(toolKey);
  return res.json({ prompt });
});

router.put('/admin/prompts/:toolKey', requireAdmin, async (req, res) => {
  const toolKey = String(req.params.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) {
    return res.status(404).json({ error: 'Unknown tool key.' });
  }
  const prompt = await upsertPromptTemplate(toolKey, req.body || {}, req.session.userId);
  return res.json({ prompt });
});

router.get('/admin/analytics', requireAdmin, async (req, res) => {
  const days = Number(req.query.days || 30);
  const analytics = await getAiGatewayAnalytics(days);
  return res.json(analytics);
});

router.post('/:toolRoute', requireAuth, async (req, res) => {
  const toolKey = resolveToolKey(req.params.toolRoute);
  if (!toolKey) return res.status(404).json({ error: 'Unknown AI tool route.', code: 'TOOL_ROUTE_NOT_FOUND' });

  const membership = await resolveMembershipState(req.session.userId);
  const generated = await generateAiToolResponse({
    userId: req.session.userId,
    toolKey,
    tool: { title: toolKey },
    inputs: req.body?.inputs || req.body || {},
    profile: req.body?.profile || {},
    membership,
    roadmaps: Array.isArray(req.body?.roadmaps) ? req.body.roadmaps : [],
    sessionMemory: req.session.aiToolMemory || {},
    userMeta: {
      full_name: req.session.full_name || req.session.name || 'Student'
    }
  });

  if (!generated.ok) {
    return res.status(generated.status || 400).json({
      error: generated.error || 'Unable to process AI request.',
      code: generated.code || 'AI_GATEWAY_FAILED',
      details: generated.details || []
    });
  }

  req.session.aiToolMemory = generated.data.memory || req.session.aiToolMemory || {};
  return res.json(generated.data);
});

router.post('/:toolRoute/stream', requireAuth, async (req, res) => {
  const toolKey = resolveToolKey(req.params.toolRoute);
  if (!toolKey) return res.status(404).json({ error: 'Unknown AI tool route.', code: 'TOOL_ROUTE_NOT_FOUND' });

  const membership = await resolveMembershipState(req.session.userId);
  const generated = await generateAiToolResponse({
    userId: req.session.userId,
    toolKey,
    tool: { title: toolKey },
    inputs: req.body?.inputs || req.body || {},
    profile: req.body?.profile || {},
    membership,
    roadmaps: Array.isArray(req.body?.roadmaps) ? req.body.roadmaps : [],
    sessionMemory: req.session.aiToolMemory || {},
    userMeta: {
      full_name: req.session.full_name || req.session.name || 'Student'
    }
  });

  if (!generated.ok) {
    return res.status(generated.status || 400).json({ error: generated.error, code: generated.code || 'AI_GATEWAY_FAILED' });
  }

  req.session.aiToolMemory = generated.data.memory || req.session.aiToolMemory || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const chunks = [];
  const sections = generated.data?.result?.sections || [];
  for (const section of sections) {
    if (!Array.isArray(section.items)) continue;
    for (const item of section.items) {
      chunks.push(String(typeof item === 'string' ? item : JSON.stringify(item)));
    }
  }

  chunks.slice(0, 40).forEach((chunk) => {
    res.write(`event: chunk\\ndata: ${JSON.stringify({ chunk })}\\n\\n`);
  });

  res.write(`event: done\\ndata: ${JSON.stringify(generated.data)}\\n\\n`);
  return res.end();
});

module.exports = router;
