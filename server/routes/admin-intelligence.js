const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { buildAdminIntelligenceOverview } = require('../services/intelligence-brain');

const router = express.Router();

router.get('/overview', requireAdmin, async (_req, res) => {
  const payload = await buildAdminIntelligenceOverview();
  res.json(payload);
});

router.get('/segments', requireAdmin, async (_req, res) => {
  const payload = await buildAdminIntelligenceOverview();

  const users = payload.users || {};
  const premiumUsers = Number(users.premium_users || 0);
  const totalStudents = Number(users.total_students || 0);
  const premiumShare = totalStudents > 0 ? Math.round((premiumUsers / totalStudents) * 100) : 0;

  res.json({
    generatedAt: payload.generatedAt,
    segments: [
      {
        key: 'at_risk_learners',
        title: 'At-risk Learners',
        size: Number(payload.retention?.at_risk || 0),
        playbook: 'Launch comeback missions + weak-topic rescue in 24h.'
      },
      {
        key: 'premium_high_intent',
        title: 'Premium High-Intent',
        size: premiumUsers,
        sharePercent: premiumShare,
        playbook: 'Promote advanced mock analytics and peer challenge loops.'
      },
      {
        key: 'new_users_30d',
        title: 'New Users (30d)',
        size: Number(users.new_users_30d || 0),
        playbook: 'Push guided next-action onboarding and trial activation.'
      }
    ]
  });
});

router.post('/resource-automation/generate', requireAdmin, async (req, res) => {
  const focusTopic = String(req.body.focusTopic || '').trim();
  const generatedAt = new Date().toISOString();

  const overview = await buildAdminIntelligenceOverview();
  const topWeak = overview.weakTopicHeatmap?.[0]?.topic || 'General Aptitude';
  const topic = focusTopic || topWeak;

  const resources = {
    generatedAt,
    topic,
    notePack: {
      title: `${topic} Rapid Revision Pack`,
      modules: [
        'Concept reset and misconception map',
        'Top 20 exam-grade practice prompts',
        'High-frequency pitfalls and fixes'
      ]
    },
    quizPack: {
      title: `${topic} Adaptive Quiz Pack`,
      levels: ['Warm-up', 'Targeted', 'Pressure Test'],
      questionMix: {
        easy: 30,
        medium: 45,
        hard: 25
      }
    },
    mockBlueprint: {
      title: `${topic} Weak-Area Recovery Mock`,
      durationMinutes: 35,
      objective: 'Improve weak-area score by at least 12% in 7 days'
    },
    publishPlan: [
      'Release pack to at-risk segment first',
      'Trigger Next Action update for impacted users',
      'Measure completion and score-lift after 72 hours'
    ]
  };

  res.status(201).json(resources);
});

module.exports = router;
