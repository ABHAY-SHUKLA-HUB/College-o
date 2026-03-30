const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  buildLearnerBrainPayload,
  recordLearnerEvent,
  recordAiUsage
} = require('../services/intelligence-brain');

const router = express.Router();

router.get('/brain', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const horizonDays = Math.max(3, Math.min(14, Number(req.query.horizonDays || 7)));

  const payload = await buildLearnerBrainPayload(userId, { horizonDays });
  res.json(payload);
});

router.get('/next-action', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const payload = await buildLearnerBrainPayload(userId, { horizonDays: 7 });
  res.json({
    generatedAt: payload.generatedAt,
    nextAction: payload.nextAction,
    personalization: payload.personalization,
    retention: payload.retention
  });
});

router.get('/study-plan', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const horizonDays = Math.max(3, Math.min(21, Number(req.query.horizonDays || 7)));
  const payload = await buildLearnerBrainPayload(userId, { horizonDays });
  res.json({
    generatedAt: payload.generatedAt,
    studyPlan: payload.studyPlan,
    analytics: payload.aiBrain.advancedAnalytics
  });
});

router.get('/analytics', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const payload = await buildLearnerBrainPayload(userId, { horizonDays: 7 });
  res.json({
    generatedAt: payload.generatedAt,
    analytics: payload.aiBrain.advancedAnalytics,
    weakAreas: payload.aiBrain.weakAreaDetection,
    gamification: payload.gamification,
    monetization: payload.monetization
  });
});

router.post('/events', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const eventType = String(req.body.eventType || '').trim();
  const source = String(req.body.source || 'web').trim() || 'web';
  const eventPayload = req.body.eventPayload && typeof req.body.eventPayload === 'object'
    ? req.body.eventPayload
    : {};

  if (!eventType) {
    return res.status(400).json({ error: 'eventType is required' });
  }

  await recordLearnerEvent(userId, eventType, source, eventPayload);

  if (eventType === 'ai_tool_used') {
    await recordAiUsage(userId, {
      toolKey: eventPayload.toolKey,
      intent: eventPayload.intent,
      tokensUsed: eventPayload.tokensUsed,
      durationMs: eventPayload.durationMs,
      success: eventPayload.success
    });
  }

  return res.status(201).json({ ok: true });
});

module.exports = router;
