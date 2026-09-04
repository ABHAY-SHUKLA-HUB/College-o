/**
 * Plagiarism & Source Code Similarity Analysis Engine
 * Uses Winnowing AST/Token n-gram algorithm to detect structural code similarity.
 * Thresholds: < 60% (Low), 60-80% (Medium Review), > 80% (High Review Priority).
 */

const { pool } = require('../db/pool');

/**
 * Tokenize source code by stripping comments, string literals, boilerplate, and normalizing identifiers.
 */
function tokenizeSourceCode(code) {
  if (!code || typeof code !== 'string') return [];

  // Remove single line & multi-line comments
  let cleaned = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
    .replace(/#.*/g, '');

  // Normalize string literals and numbers to generic tokens
  cleaned = cleaned
    .replace(/["'].*?["']/g, 'STR')
    .replace(/\b\d+\b/g, 'NUM');

  // Extract keywords and structural syntax tokens
  const tokens = cleaned
    .split(/[^a-zA-Z0-9_]+/)
    .filter((t) => t.length > 0)
    .map((t) => {
      const lower = t.toLowerCase();
      // Keep structural language keywords, replace arbitrary variable names with 'VAR'
      const keywords = new Set([
        'if', 'else', 'for', 'while', 'return', 'def', 'function', 'class', 'public',
        'static', 'void', 'int', 'float', 'char', 'const', 'let', 'var', 'import',
        'include', 'using', 'namespace', 'std', 'cout', 'cin', 'print', 'console', 'log'
      ]);
      return keywords.has(lower) ? lower : 'VAR';
    });

  return tokens;
}

/**
 * Generate k-gram hashes from tokens.
 */
function getKGrams(tokens, k = 5) {
  if (tokens.length < k) return [tokens.join('_')];
  const grams = [];
  for (let i = 0; i <= tokens.length - k; i++) {
    grams.push(tokens.slice(i, i + k).join('_'));
  }
  return grams;
}

/**
 * Calculate Jaccard similarity percentage between two code token sets.
 */
function calculateSimilarity(codeA, codeB) {
  const tokensA = tokenizeSourceCode(codeA);
  const tokensB = tokenizeSourceCode(codeB);

  if (tokensA.length < 5 || tokensB.length < 5) return { score: 0, matchedTokens: 0 };

  const gramsA = new Set(getKGrams(tokensA, 4));
  const gramsB = new Set(getKGrams(tokensB, 4));

  let intersection = 0;
  gramsA.forEach((gram) => {
    if (gramsB.has(gram)) intersection++;
  });

  const union = new Set([...gramsA, ...gramsB]).size;
  if (union === 0) return { score: 0, matchedTokens: 0 };

  const jaccardScore = (intersection / union) * 100;
  const score = Number(Math.min(100, Math.max(0, jaccardScore)).toFixed(2));

  return {
    score,
    matchedTokens: intersection
  };
}

/**
 * Perform automated similarity analysis on all submission pairs for a contest.
 */
async function analyzeContestSimilarity(contestId) {
  if (!contestId) throw new Error('contest_id is required');

  // Fetch all best/accepted submissions for this contest grouped by problem
  const { rows: submissions } = await pool.query(
    `SELECT sub.id, sub.problem_id, sub.student_id, sub.language, sub.source_code, sub.score, sub.submitted_at,
            u.full_name, u.email
     FROM coding_submissions sub
     JOIN users u ON u.id = sub.student_id
     WHERE sub.contest_id = $1 AND sub.status = 'accepted'
     ORDER BY sub.problem_id ASC, sub.submitted_at DESC`,
    [contestId]
  );

  if (submissions.length < 2) {
    return { ok: true, analyzedPairs: 0, flaggedCount: 0 };
  }

  // Group submissions by problem
  const problemMap = new Map();
  submissions.forEach((sub) => {
    const list = problemMap.get(sub.problem_id) || [];
    list.push(sub);
    problemMap.set(sub.problem_id, list);
  });

  let analyzedPairs = 0;
  let flaggedCount = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [problemId, subList] of problemMap.entries()) {
      // Compare each pair of distinct students for the same problem
      for (let i = 0; i < subList.length; i++) {
        for (let j = i + 1; j < subList.length; j++) {
          const subA = subList[i];
          const subB = subList[j];

          // Skip if same student
          if (subA.student_id === subB.student_id) continue;

          analyzedPairs++;
          const { score, matchedTokens } = calculateSimilarity(subA.source_code, subB.source_code);

          // Only store pairs with similarity >= 40%
          if (score >= 40) {
            flaggedCount++;
            await client.query(
              `INSERT INTO coding_similarity_results
                 (contest_id, problem_id, submission_a, submission_b, student_a, student_b, similarity_score, matched_tokens, analysis_version, status, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'v1-winnowing', 'flagged', CURRENT_TIMESTAMP)
               ON CONFLICT (contest_id, problem_id, submission_a, submission_b)
               DO UPDATE SET
                 similarity_score = EXCLUDED.similarity_score,
                 matched_tokens = EXCLUDED.matched_tokens,
                 created_at = CURRENT_TIMESTAMP`,
              [contestId, problemId, subA.id, subB.id, subA.student_id, subB.student_id, score, matchedTokens]
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    return { ok: true, analyzedPairs, flaggedCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fetch similarity analysis results for admin review.
 */
async function getContestSimilarityResults(contestId) {
  const { rows } = await pool.query(
    `SELECT sim.id, sim.contest_id, sim.problem_id, sim.submission_a, sim.submission_b,
            sim.student_a, sim.student_b, sim.similarity_score, sim.matched_tokens,
            sim.analysis_version, sim.status, sim.created_at,
            p.title as problem_title,
            u1.full_name as student_a_name, u1.email as student_a_email,
            u2.full_name as student_b_name, u2.email as student_b_email,
            subA.source_code as code_a, subA.language as language_a,
            subB.source_code as code_b, subB.language as language_b
     FROM coding_similarity_results sim
     JOIN coding_problems p ON p.id = sim.problem_id
     JOIN users u1 ON u1.id = sim.student_a
     JOIN users u2 ON u2.id = sim.student_b
     JOIN coding_submissions subA ON subA.id = sim.submission_a
     JOIN coding_submissions subB ON subB.id = sim.submission_b
     WHERE sim.contest_id = $1
     ORDER BY sim.similarity_score DESC`,
    [contestId]
  );

  return rows.map((r) => {
    let riskLevel = 'Low';
    if (r.similarity_score >= 80) riskLevel = 'High Review Priority';
    else if (r.similarity_score >= 60) riskLevel = 'Medium';

    return {
      ...r,
      risk_level: riskLevel
    };
  });
}

/**
 * Update review status of a similarity flag.
 */
async function updateSimilarityStatus(similarityId, status) {
  const allowed = ['flagged', 'reviewed', 'cleared'];
  if (!allowed.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const { rows } = await pool.query(
    `UPDATE coding_similarity_results SET status = $1 WHERE id = $2 RETURNING *`,
    [status, similarityId]
  );
  if (!rows.length) throw new Error('Similarity record not found');
  return rows[0];
}

module.exports = {
  tokenizeSourceCode,
  calculateSimilarity,
  analyzeContestSimilarity,
  getContestSimilarityResults,
  updateSimilarityStatus
};
