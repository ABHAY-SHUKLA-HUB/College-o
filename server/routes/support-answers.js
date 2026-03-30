const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { ProductionValidator } = require('../utils/productionValidation');
const logger = require('../services/logger');
const { ensureSupportSchema } = require('../utils/supportSchema');
const {
  guardSupportFeature,
  getSupportGovernanceConfig,
  isUserSupportSuspended
} = require('../utils/supportGovernance');

const router = express.Router();

router.use(async (_req, _res, next) => {
  try {
    await ensureSupportSchema();
    next();
  } catch (error) {
    next(error);
  }
});

router.use(requireAuth, guardSupportFeature);

async function getUserAcademicContext(userId) {
  const { rows } = await pool.query(
    `SELECT up.category_id, up.branch_id, up.semester_id
     FROM user_profiles up
     WHERE up.user_id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function checkAcademicIsolation(userId, categoryId, branchId, semesterId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM user_profiles
     WHERE user_id = $1 AND category_id = $2 AND branch_id = $3 AND semester_id = $4
     LIMIT 1`,
    [userId, categoryId, branchId, semesterId]
  );
  return rows.length > 0;
}

function sanitizeMeetLink(rawLink) {
  const link = String(rawLink || '').trim();
  if (!link) return null;
  try {
    const parsed = new URL(link);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    if (host !== 'meet.google.com' && host !== 'g.co') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getHelperLevel(totalPoints, acceptedAnswers, helpfulAnswers) {
  if (totalPoints >= 350 && acceptedAnswers >= 20 && helpfulAnswers >= 30) return 'Verified Support Contributor';
  if (totalPoints >= 180 && acceptedAnswers >= 10) return 'Top Academic Helper';
  if (totalPoints >= 60 && acceptedAnswers >= 3) return 'Trusted Helper';
  return 'New Helper';
}

async function syncHelperReputation(helperId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total_answers,
       SUM(CASE WHEN is_accepted THEN 1 ELSE 0 END)::int AS accepted_answers,
       SUM(helpful_count)::int AS helpful_votes
     FROM support_answers
     WHERE answerer_id = $1 AND is_removed = FALSE`,
    [helperId]
  );

  const totalAnswers = Number(rows[0]?.total_answers || 0);
  const acceptedAnswers = Number(rows[0]?.accepted_answers || 0);
  const helpfulVotes = Number(rows[0]?.helpful_votes || 0);

  const { rows: currentRows } = await pool.query(
    'SELECT total_points_earned FROM helper_reputation WHERE helper_id = $1 LIMIT 1',
    [helperId]
  );
  const totalPoints = Number(currentRows[0]?.total_points_earned || 0);
  const level = getHelperLevel(totalPoints, acceptedAnswers, helpfulVotes);

  await pool.query(
    `INSERT INTO helper_reputation (
       helper_id, total_answers, accepted_answers, helpful_answers, reputation_level, last_answer_at
     ) VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (helper_id)
     DO UPDATE SET
       total_answers = EXCLUDED.total_answers,
       accepted_answers = EXCLUDED.accepted_answers,
       helpful_answers = EXCLUDED.helpful_answers,
       reputation_level = EXCLUDED.reputation_level,
       last_answer_at = NOW(),
       updated_at = NOW()`,
    [helperId, totalAnswers, acceptedAnswers, helpfulVotes, level]
  );

  await pool.query('UPDATE users SET is_helper = TRUE, helper_level = $1 WHERE id = $2', [level, helperId]);
  await pool.query('UPDATE user_profiles SET is_helper = TRUE, helper_badge = $1 WHERE user_id = $2', [level, helperId]);
}

router.post('/answer/:requestId', async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    const cfg = req.supportGovernance || (await getSupportGovernanceConfig());
    if (!cfg.allowAnswerCreation) {
      return res.status(403).json({ error: 'Answering is temporarily disabled.' });
    }

    if (await isUserSupportSuspended(userId)) {
      return res.status(403).json({ error: 'Support participation is suspended for this account.' });
    }

    const context = await getUserAcademicContext(userId);
    if (!context || !context.category_id || !context.branch_id || !context.semester_id) {
      return res.status(403).json({ error: 'User profile incomplete' });
    }

    const { content, explanation_detail, attachment_urls, image_urls, meet_link } = req.body || {};

    const validator = new ProductionValidator();
    validator.validateString('content', content, { required: true, minLength: 10, maxLength: 5000 });
    const validationErrors = validator.getErrors();
    if (validationErrors) return res.status(400).json({ errors: validationErrors });

    const normalizedMeetLink = sanitizeMeetLink(meet_link);
    if (meet_link && (!cfg.allowMeetLinks || !normalizedMeetLink)) {
      return res.status(400).json({ error: 'Meet links are disabled or invalid.' });
    }

    const safeAttachmentUrls = cfg.allowAttachments && Array.isArray(attachment_urls)
      ? attachment_urls.filter((item) => typeof item === 'string' && item.startsWith('/uploads/support/')).slice(0, 4)
      : [];
    const safeImageUrls = cfg.allowAttachments && Array.isArray(image_urls)
      ? image_urls.filter((item) => typeof item === 'string' && item.startsWith('/uploads/support/')).slice(0, 4)
      : [];

    const requestId = Number(req.params.requestId || 0);
    const { rows: requestRows } = await pool.query(
      `SELECT id, user_id, category_id, branch_id, semester_id, is_locked, is_removed, is_hidden
       FROM support_requests
       WHERE id = $1
       LIMIT 1`,
      [requestId]
    );

    if (!requestRows.length) return res.status(404).json({ error: 'Request not found' });
    const request = requestRows[0];

    if (request.is_removed || request.is_hidden) {
      return res.status(404).json({ error: 'Request not available' });
    }
    if (request.is_locked) {
      return res.status(403).json({ error: 'Thread is locked by admin.' });
    }

    const inScope = await checkAcademicIsolation(userId, request.category_id, request.branch_id, request.semester_id);
    if (!inScope) return res.status(403).json({ error: 'Access denied: academic group isolation' });

    const { rows: recentRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM support_answers
       WHERE answerer_id = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
      [userId]
    );
    if (Number(recentRows[0]?.count || 0) >= 3) {
      return res.status(429).json({ error: 'Please wait before posting another answer.' });
    }

    const normalizedContent = String(content).trim();
    const { rows } = await pool.query(
      `INSERT INTO support_answers (
         answer_uuid,
         request_id,
         answerer_id,
         category_id,
         branch_id,
         semester_id,
         content,
         explanation_detail,
         attachment_urls,
         image_urls,
         meet_link
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)
       RETURNING id, answer_uuid, created_at`,
      [
        uuidv4(),
        requestId,
        userId,
        request.category_id,
        request.branch_id,
        request.semester_id,
        normalizedContent,
        explanation_detail ? String(explanation_detail).trim() : null,
        JSON.stringify(safeAttachmentUrls),
        JSON.stringify(safeImageUrls),
        normalizedMeetLink
      ]
    );

    await pool.query(
      `UPDATE support_requests
       SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    const basePoints = normalizedContent.length >= 150 ? 2 : 1;
    await pool.query(
      `INSERT INTO helper_reputation (helper_id, total_points_earned, total_answers, last_answer_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (helper_id)
       DO UPDATE SET
         total_points_earned = helper_reputation.total_points_earned + $2,
         total_answers = helper_reputation.total_answers + 1,
         last_answer_at = NOW(),
         updated_at = NOW()`,
      [userId, basePoints]
    );

    await pool.query(
      `UPDATE user_profiles
       SET support_points_earned = COALESCE(support_points_earned, 0) + $1
       WHERE user_id = $2`,
      [basePoints, userId]
    );

    await pool.query(
      `INSERT INTO support_reward_events (helper_user_id, actor_user_id, points_delta, reason, event_type, request_id, answer_id)
       VALUES ($1, $2, $3, $4, 'system_auto', $5, $6)`,
      [userId, userId, basePoints, 'Base points for answer contribution', requestId, rows[0].id]
    );

    await pool.query(
      `INSERT INTO notifications (user_id, message, kind)
       VALUES ($1, $2, 'support_answer')`,
      [request.user_id, 'Someone answered your support request!']
    );

    await syncHelperReputation(userId);

    return res.status(201).json({ success: true, answer: rows[0], points_awarded: basePoints });
  } catch (error) {
    logger.error('Failed to post support answer', { error: error.message });
    return res.status(500).json({ error: 'Failed to post answer' });
  }
});

router.put('/answer/:answerId/accept', async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    const cfg = req.supportGovernance || (await getSupportGovernanceConfig());
    if (!cfg.allowSolvedFlow) {
      return res.status(403).json({ error: 'Solved flow is temporarily disabled.' });
    }

    const answerId = Number(req.params.answerId || 0);
    const { rows: answerRows } = await pool.query(
      `SELECT sa.id, sa.request_id, sa.answerer_id,
              sr.user_id AS request_creator,
              sr.category_id, sr.branch_id, sr.semester_id,
              sr.is_locked, sr.is_removed
       FROM support_answers sa
       INNER JOIN support_requests sr ON sr.id = sa.request_id
       WHERE sa.id = $1
       LIMIT 1`,
      [answerId]
    );
    if (!answerRows.length) return res.status(404).json({ error: 'Answer not found' });

    const answer = answerRows[0];
    if (answer.is_removed) return res.status(404).json({ error: 'Request not available' });
    if (answer.is_locked) return res.status(403).json({ error: 'Thread is locked by admin.' });

    const inScope = await checkAcademicIsolation(userId, answer.category_id, answer.branch_id, answer.semester_id);
    if (!inScope) return res.status(403).json({ error: 'Access denied: academic group isolation' });

    if (answer.request_creator !== userId) {
      return res.status(403).json({ error: 'Only request creator can accept answers' });
    }
    if (answer.answerer_id === userId) {
      return res.status(400).json({ error: 'You cannot accept your own answer' });
    }

    await pool.query('UPDATE support_answers SET is_accepted = FALSE, accepted_at = NULL WHERE request_id = $1', [answer.request_id]);

    await pool.query(
      `UPDATE support_answers
       SET is_accepted = TRUE, accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [answerId]
    );

    await pool.query(
      `UPDATE support_requests
       SET accepted_answer_id = $1, status = 'solved', solved_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [answerId, answer.request_id]
    );

    const acceptedReward = 12;
    if (cfg.allowStudentRewarding) {
      await pool.query(
        `INSERT INTO helper_reputation (helper_id, total_points_earned, accepted_answers, last_answer_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (helper_id)
         DO UPDATE SET
           total_points_earned = helper_reputation.total_points_earned + $2,
           accepted_answers = helper_reputation.accepted_answers + 1,
           last_answer_at = NOW(),
           updated_at = NOW()`,
        [answer.answerer_id, acceptedReward]
      );

      await pool.query(
        `UPDATE user_profiles
         SET support_points_earned = COALESCE(support_points_earned, 0) + $1
         WHERE user_id = $2`,
        [acceptedReward, answer.answerer_id]
      );

      await pool.query(
        `INSERT INTO support_reward_events (helper_user_id, actor_user_id, points_delta, reason, event_type, request_id, answer_id)
         VALUES ($1, $2, $3, $4, 'accepted_answer', $5, $6)`,
        [answer.answerer_id, userId, acceptedReward, 'Accepted answer reward', answer.request_id, answerId]
      );
    }

    await pool.query(
      `INSERT INTO notifications (user_id, message, kind)
       VALUES ($1, $2, 'answer_accepted')`,
      [answer.answerer_id, 'Your answer was accepted and rewarded.']
    );

    await syncHelperReputation(answer.answerer_id);

    return res.json({ success: true, message: 'Answer accepted', points_awarded: cfg.allowStudentRewarding ? acceptedReward : 0 });
  } catch (error) {
    logger.error('Failed to accept support answer', { error: error.message });
    return res.status(500).json({ error: 'Failed to accept answer' });
  }
});

router.post('/answer/:answerId/vote', async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    const voteType = String(req.body?.vote_type || '').trim();
    if (!['helpful', 'unhelpful'].includes(voteType)) {
      return res.status(400).json({ error: 'Invalid vote type' });
    }

    const answerId = Number(req.params.answerId || 0);
    const { rows: answerRows } = await pool.query(
      `SELECT id, answerer_id, category_id, branch_id, semester_id, is_removed, is_hidden
       FROM support_answers
       WHERE id = $1
       LIMIT 1`,
      [answerId]
    );
    if (!answerRows.length) return res.status(404).json({ error: 'Answer not found' });

    const answer = answerRows[0];
    if (answer.is_removed || answer.is_hidden) return res.status(404).json({ error: 'Answer not available' });

    const inScope = await checkAcademicIsolation(userId, answer.category_id, answer.branch_id, answer.semester_id);
    if (!inScope) return res.status(403).json({ error: 'Access denied: academic group isolation' });
    if (answer.answerer_id === userId) return res.status(400).json({ error: 'You cannot vote your own answer' });

    const { rows: existingRows } = await pool.query(
      `SELECT id, vote_type FROM support_answer_votes WHERE answer_id = $1 AND voter_id = $2 LIMIT 1`,
      [answerId, userId]
    );

    let deltaHelpful = 0;
    let deltaUnhelpful = 0;
    let pointsDelta = 0;

    if (existingRows.length) {
      const existing = existingRows[0];
      if (existing.vote_type === voteType) {
        await pool.query('DELETE FROM support_answer_votes WHERE id = $1', [existing.id]);
        if (voteType === 'helpful') {
          deltaHelpful = -1;
          pointsDelta = -1;
        } else {
          deltaUnhelpful = -1;
        }
      } else {
        await pool.query('UPDATE support_answer_votes SET vote_type = $1 WHERE id = $2', [voteType, existing.id]);
        if (existing.vote_type === 'helpful') {
          deltaHelpful -= 1;
          pointsDelta -= 1;
        } else {
          deltaUnhelpful -= 1;
        }
        if (voteType === 'helpful') {
          deltaHelpful += 1;
          pointsDelta += 1;
        } else {
          deltaUnhelpful += 1;
        }
      }
    } else {
      await pool.query(
        'INSERT INTO support_answer_votes (answer_id, voter_id, vote_type) VALUES ($1, $2, $3)',
        [answerId, userId, voteType]
      );
      if (voteType === 'helpful') {
        deltaHelpful += 1;
        pointsDelta += 1;
      } else {
        deltaUnhelpful += 1;
      }
    }

    await pool.query(
      `UPDATE support_answers
       SET helpful_count = GREATEST(helpful_count + $1, 0),
           unhelpful_count = GREATEST(unhelpful_count + $2, 0),
           updated_at = NOW()
       WHERE id = $3`,
      [deltaHelpful, deltaUnhelpful, answerId]
    );

    if (pointsDelta !== 0) {
      await pool.query(
        `UPDATE helper_reputation
         SET total_points_earned = GREATEST(total_points_earned + $1, 0), updated_at = NOW()
         WHERE helper_id = $2`,
        [pointsDelta, answer.answerer_id]
      );
      await pool.query(
        `UPDATE user_profiles
         SET support_points_earned = GREATEST(COALESCE(support_points_earned, 0) + $1, 0)
         WHERE user_id = $2`,
        [pointsDelta, answer.answerer_id]
      );
      await pool.query(
        `INSERT INTO support_reward_events (helper_user_id, actor_user_id, points_delta, reason, event_type, answer_id)
         VALUES ($1, $2, $3, $4, 'helpful_vote', $5)`,
        [answer.answerer_id, userId, pointsDelta, 'Helpful vote adjustment', answerId]
      );
    }

    await syncHelperReputation(answer.answerer_id);
    return res.json({ success: true, message: 'Vote updated' });
  } catch (error) {
    logger.error('Failed to vote on support answer', { error: error.message });
    return res.status(500).json({ error: 'Failed to vote' });
  }
});

router.get('/helper/:userId/stats', async (req, res) => {
  try {
    const helperUserId = Number(req.params.userId || 0);
    const { rows } = await pool.query(
      `SELECT helper_id, total_answers, accepted_answers, helpful_answers, total_points_earned,
              reputation_level, verified_helper, verification_badge
       FROM helper_reputation
       WHERE helper_id = $1
       LIMIT 1`,
      [helperUserId]
    );

    if (!rows.length) {
      return res.json({
        helper_id: helperUserId,
        total_answers: 0,
        accepted_answers: 0,
        helpful_answers: 0,
        total_points_earned: 0,
        reputation_level: 'New Helper',
        verified_helper: false
      });
    }

    return res.json({ success: true, stats: rows[0] });
  } catch (error) {
    logger.error('Failed to fetch helper stats', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/leaderboard/top-helpers', async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    const context = await getUserAcademicContext(userId);
    if (!context || !context.category_id || !context.branch_id || !context.semester_id) {
      return res.status(403).json({ error: 'User profile incomplete' });
    }

    const { rows } = await pool.query(
      `SELECT
         hr.helper_id,
         u.full_name,
         u.email,
         hr.total_answers,
         hr.accepted_answers,
         hr.helpful_answers,
         hr.total_points_earned,
         hr.reputation_level,
         hr.verified_helper,
         hr.verification_badge
       FROM helper_reputation hr
       INNER JOIN users u ON u.id = hr.helper_id
       INNER JOIN user_profiles up ON up.user_id = u.id
       WHERE up.category_id = $1 AND up.branch_id = $2 AND up.semester_id = $3
         AND u.support_suspended = FALSE
       ORDER BY hr.total_points_earned DESC, hr.accepted_answers DESC, hr.helpful_answers DESC
       LIMIT 20`,
      [context.category_id, context.branch_id, context.semester_id]
    );

    return res.json({ success: true, helpers: rows });
  } catch (error) {
    logger.error('Failed to fetch support leaderboard', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

router.get('/my-dashboard', async (req, res) => {
  try {
    const userId = Number(req.session.userId || 0);
    const context = await getUserAcademicContext(userId);
    if (!context || !context.category_id || !context.branch_id || !context.semester_id) {
      return res.status(403).json({ error: 'User profile incomplete' });
    }

    const { rows: myRequests } = await pool.query(
      `SELECT
         id,
         title,
         status,
         created_at,
         (SELECT COUNT(*)::int FROM support_answers WHERE request_id = support_requests.id AND is_removed = FALSE AND is_hidden = FALSE) AS answer_count,
         (SELECT COUNT(*)::int FROM support_answers WHERE request_id = support_requests.id AND is_accepted = TRUE AND is_removed = FALSE) AS solved
       FROM support_requests
       WHERE user_id = $1 AND category_id = $2 AND branch_id = $3 AND semester_id = $4
         AND is_removed = FALSE
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId, context.category_id, context.branch_id, context.semester_id]
    );

    const { rows: myAnswers } = await pool.query(
      `SELECT
         sa.id,
         sa.request_id,
         sr.title,
         sa.is_accepted,
         sa.helpful_count,
         sa.created_at
       FROM support_answers sa
       INNER JOIN support_requests sr ON sr.id = sa.request_id
       WHERE sa.answerer_id = $1
         AND sa.category_id = $2
         AND sa.branch_id = $3
         AND sa.semester_id = $4
         AND sa.is_removed = FALSE
       ORDER BY sa.created_at DESC
       LIMIT 10`,
      [userId, context.category_id, context.branch_id, context.semester_id]
    );

    const { rows: helperRows } = await pool.query(
      `SELECT total_points_earned, accepted_answers, total_answers, reputation_level
       FROM helper_reputation
       WHERE helper_id = $1
       LIMIT 1`,
      [userId]
    );

    return res.json({
      success: true,
      my_requests: myRequests,
      my_answers: myAnswers,
      helper_stats: helperRows[0] || {
        total_points_earned: 0,
        accepted_answers: 0,
        total_answers: 0,
        reputation_level: 'New Helper'
      }
    });
  } catch (error) {
    logger.error('Failed to load support dashboard', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

module.exports = router;
