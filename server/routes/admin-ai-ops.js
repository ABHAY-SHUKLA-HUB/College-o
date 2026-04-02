const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { presets } = require('../middleware/rateLimiter');
const {
  TOOL_KEYS,
  ensureAiOpsSchema,
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
  listAiRequestLogs,
  listAiAuditLogs,
  getAiAnalytics,
  simulatePromptAndOutput
} = require('../services/aiOpsService');

const router = express.Router();

router.use(requireAdmin);
router.use(presets.loose);

router.use(async (_req, _res, next) => {
  try {
    await ensureAiOpsSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.get('/settings/global', async (_req, res) => {
  const settings = await getGlobalSettingsForAdmin();
  res.json({ settings });
});

router.put('/settings/global', async (req, res) => {
  const settings = await updateGlobalSettings(req.body || {}, req.session.userId);
  res.json({ settings });
});

router.post('/settings/test-connection', async (req, res) => {
  const payload = await testAzureConnection(req.body || null);
  if (!payload.ok) {
    return res.status(200).json(payload);
  }
  return res.status(200).json(payload);
});

router.get('/features', async (_req, res) => {
  const features = await listFeatureSettings();
  res.json({ features });
});

router.get('/features/:toolKey', async (req, res) => {
  const toolKey = String(req.params.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) return res.status(404).json({ error: 'Unknown feature tool key.' });
  const feature = await getFeatureSetting(toolKey);
  return res.json({ feature });
});

router.put('/features/:toolKey', async (req, res) => {
  const toolKey = String(req.params.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) return res.status(404).json({ error: 'Unknown feature tool key.' });
  const feature = await updateFeatureSetting(toolKey, req.body || {}, req.session.userId);
  return res.json({ feature });
});

router.get('/prompts/:toolKey', async (req, res) => {
  const toolKey = String(req.params.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) return res.status(404).json({ error: 'Unknown feature tool key.' });
  const prompt = await getPrompt(toolKey);
  const versions = await listPromptVersions(toolKey, 20);
  return res.json({ prompt, versions });
});

router.put('/prompts/:toolKey', async (req, res) => {
  const toolKey = String(req.params.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) return res.status(404).json({ error: 'Unknown feature tool key.' });
  const prompt = await updatePrompt(toolKey, req.body || {}, req.session.userId);
  const versions = await listPromptVersions(toolKey, 20);
  return res.json({ prompt, versions });
});

router.post('/prompts/:toolKey/restore/:versionId', async (req, res) => {
  const toolKey = String(req.params.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) return res.status(404).json({ error: 'Unknown feature tool key.' });
  const prompt = await restorePromptVersion(toolKey, req.params.versionId, req.session.userId);
  const versions = await listPromptVersions(toolKey, 20);
  return res.json({ prompt, versions });
});

router.post('/simulate', async (req, res) => {
  const toolKey = String(req.body?.toolKey || '').trim();
  if (!TOOL_KEYS.includes(toolKey)) return res.status(400).json({ error: 'toolKey is invalid.' });

  const simulation = await simulatePromptAndOutput({
    toolKey,
    inputs: req.body?.inputs && typeof req.body.inputs === 'object' ? req.body.inputs : {},
    profile: req.body?.profile && typeof req.body.profile === 'object' ? req.body.profile : {},
    membership: req.body?.membership && typeof req.body.membership === 'object' ? req.body.membership : { premiumActive: true, isAdmin: true },
    userMeta: req.body?.userMeta && typeof req.body.userMeta === 'object' ? req.body.userMeta : { full_name: 'Admin Preview' }
  });

  return res.json(simulation);
});

router.get('/analytics/overview', async (req, res) => {
  const days = Number(req.query.days || 30);
  const analytics = await getAiAnalytics(days);
  return res.json(analytics);
});

router.get('/logs/requests', async (req, res) => {
  const logs = await listAiRequestLogs({
    toolKey: req.query.toolKey,
    provider: req.query.provider,
    failedOnly: String(req.query.failedOnly || '').toLowerCase() === 'true',
    limit: req.query.limit
  });
  return res.json({ logs });
});

router.get('/logs/audit', async (req, res) => {
  const logs = await listAiAuditLogs(req.query.limit);
  return res.json({ logs });
});

router.get('/credits/users/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid userId.' });
  const wallet = await getWalletSummary(userId);
  return res.json({ wallet });
});

router.post('/credits/users/:userId/reset', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid userId.' });
  const wallet = await resetUserCredits(userId, req.body || {}, req.session.userId);
  return res.json({ wallet });
});

router.post('/credits/users/:userId/bonus', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid userId.' });
  const wallet = await applyUserCreditBonus(userId, req.body || {}, req.session.userId);
  return res.json({ wallet });
});

router.put('/credits/users/:userId/override', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid userId.' });
  const wallet = await updateUserUsageOverride(userId, req.body || {}, req.session.userId);
  return res.json({ wallet });
});

router.post('/credits/users/:userId/block', async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) return res.status(400).json({ error: 'Invalid userId.' });
  const wallet = await setAbuseBlocked(userId, req.body || {}, req.session.userId);
  return res.json({ wallet });
});

router.get('/plans/entitlements', async (_req, res) => {
  const entitlements = await getPlanEntitlements();
  return res.json({ entitlements });
});

router.put('/plans/entitlements/:planCode', async (req, res) => {
  const planCode = String(req.params.planCode || '').trim() || 'free';
  const entitlements = await updatePlanEntitlements(
    planCode,
    Array.isArray(req.body?.entitlements) ? req.body.entitlements : [],
    req.session.userId,
    {
      source: 'admin_api',
      campaignLabel: req.body?.campaignLabel || null
    }
  );
  return res.json({ entitlements });
});

module.exports = router;
