/**
 * Multi-Signal AI & Integrity Suspicion Evaluator
 * Combines paste events, tab switch frequency, typing anomalies, and code similarity scores into an objective suspicion assessment.
 * Transparent risk levels: Low, Medium, High Review Priority. Never claims "100% AI generated".
 */

const { pool } = require('../db/pool');

/**
 * Compute multi-signal integrity rating for a student in a contest.
 */
function evaluateIntegrityRisk({ pasteCount = 0, tabSwitchCount = 0, maxSimilarity = 0, bulkInsertCount = 0 }) {
  let riskScore = 0;
  const flags = [];

  if (pasteCount > 0) {
    riskScore += pasteCount * 15;
    flags.push(`${pasteCount} paste attempt(s) into editor`);
  }

  if (bulkInsertCount > 0) {
    riskScore += bulkInsertCount * 25;
    flags.push(`${bulkInsertCount} large bulk insertion event(s)`);
  }

  if (tabSwitchCount > 0) {
    riskScore += tabSwitchCount * 10;
    flags.push(`${tabSwitchCount} tab switch / focus loss event(s)`);
  }

  if (maxSimilarity >= 80) {
    riskScore += 50;
    flags.push(`High code similarity match (${maxSimilarity}%)`);
  } else if (maxSimilarity >= 60) {
    riskScore += 25;
    flags.push(`Moderate code similarity match (${maxSimilarity}%)`);
  }

  let rating = 'Low';
  if (riskScore >= 45 || maxSimilarity >= 80 || pasteCount >= 3) {
    rating = 'High Review Priority';
  } else if (riskScore >= 20 || maxSimilarity >= 60 || pasteCount >= 1 || tabSwitchCount >= 3) {
    rating = 'Medium';
  }

  return {
    rating,
    risk_score: Math.min(100, riskScore),
    flags
  };
}

/**
 * Get student's detailed integrity event timeline and summary.
 */
async function getStudentIntegritySummary(contestId, studentId) {
  const { rows: events } = await pool.query(
    `SELECT id, event_type, metadata, created_at
     FROM coding_integrity_events
     WHERE contest_id = $1 AND student_id = $2
     ORDER BY created_at ASC`,
    [contestId, studentId]
  );

  let pasteCount = 0;
  let tabSwitchCount = 0;
  let bulkInsertCount = 0;

  events.forEach((e) => {
    const type = String(e.event_type || '').toLowerCase();
    if (type === 'paste_attempt') pasteCount++;
    if (type === 'tab_switch' || type === 'focus_loss') tabSwitchCount++;
    if (type === 'bulk_insert' || (e.metadata && e.metadata.length > 100)) bulkInsertCount++;
  });

  const { rows: simRows } = await pool.query(
    `SELECT MAX(similarity_score) as max_sim
     FROM coding_similarity_results
     WHERE contest_id = $1 AND (student_a = $2 OR student_b = $2)`,
    [contestId, studentId]
  );
  const maxSimilarity = Number(simRows[0]?.max_sim || 0);

  const riskAssessment = evaluateIntegrityRisk({ pasteCount, tabSwitchCount, maxSimilarity, bulkInsertCount });

  return {
    contest_id: contestId,
    student_id: studentId,
    paste_count: pasteCount,
    tab_switch_count: tabSwitchCount,
    bulk_insert_count: bulkInsertCount,
    max_similarity: maxSimilarity,
    assessment: riskAssessment,
    events
  };
}

/**
 * Get contest-wide integrity proctoring overview for Admin results screen.
 */
async function getContestIntegrityOverview(contestId) {
  const { rows: participants } = await pool.query(
    `SELECT pt.student_id, pt.status as participant_status, pt.joined_at,
            u.full_name, u.email
     FROM coding_participants pt
     JOIN users u ON u.id = pt.student_id
     WHERE pt.contest_id = $1`,
    [contestId]
  );

  const overviewList = [];
  for (const pt of participants) {
    const summary = await getStudentIntegritySummary(contestId, pt.student_id);
    overviewList.push({
      student_id: pt.student_id,
      full_name: pt.full_name,
      email: pt.email,
      participant_status: pt.participant_status,
      paste_count: summary.paste_count,
      tab_switch_count: summary.tab_switch_count,
      max_similarity: summary.max_similarity,
      rating: summary.assessment.rating,
      risk_score: summary.assessment.risk_score,
      flags: summary.assessment.flags
    });
  }

  return overviewList;
}

module.exports = {
  evaluateIntegrityRisk,
  getStudentIntegritySummary,
  getContestIntegrityOverview
};
