/**
 * Coding Challenges Core Service (Part 2 Admin Extensions)
 * Manages database queries for module configuration, contests, problems, test cases, and results.
 * Enforces server-side validation and security isolation for hidden test cases.
 */

const { pool } = require('../db/pool');

// Centralized Language Configuration preparing for Judge0 integration in Part 4
const SUPPORTED_LANGUAGES = Object.freeze({
  python: {
    id: 'python',
    name: 'Python 3.10',
    judge0Id: 71,
    extension: 'py',
    defaultTemplate: '# Write your Python code here\nimport sys\n\ndef main():\n    # Read input from stdin\n    # lines = sys.stdin.read().splitlines()\n    pass\n\nif __name__ == "__main__":\n    main()\n'
  },
  javascript: {
    id: 'javascript',
    name: 'JavaScript (Node.js v18)',
    judge0Id: 63,
    extension: 'js',
    defaultTemplate: '// Write your JavaScript (Node.js) code here\nconst fs = require(\'fs\');\n\nfunction main() {\n  const input = fs.readFileSync(0, \'utf-8\');\n  // process input\n}\n\nmain();\n'
  },
  cpp: {
    id: 'cpp',
    name: 'C++ (GCC 11.2)',
    judge0Id: 54,
    extension: 'cpp',
    defaultTemplate: '// Write your C++ code here\n#include <iostream>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    // process input\n    return 0;\n}\n'
  },
  c: {
    id: 'c',
    name: 'C (GCC 11.2)',
    judge0Id: 50,
    extension: 'c',
    defaultTemplate: '/* Write your C code here */\n#include <stdio.h>\n\nint main() {\n    /* process input */\n    return 0;\n}\n'
  },
  java: {
    id: 'java',
    name: 'Java (OpenJDK 17)',
    judge0Id: 62,
    extension: 'java',
    defaultTemplate: '// Write your Java code here\nimport java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n        // process input\n    }\n}\n'
  }
});

const DEFAULT_SETTINGS = Object.freeze({
  id: 1,
  module_enabled: false,
  leaderboard_enabled: true,
  certificates_enabled: true,
  strict_mode_default: false,
  failed_retention_days: 15
});

/**
 * Compute backend-determined contest status based on start/end dates and manual status override.
 */
function computeContestStatus(contest) {
  if (!contest) return 'draft';
  const status = String(contest.status || '').toLowerCase();
  if (status === 'draft' || status === 'cancelled') {
    return status;
  }

  const now = new Date();
  const startTime = contest.start_time ? new Date(contest.start_time) : null;
  const endTime = contest.end_time ? new Date(contest.end_time) : null;

  if (startTime && now < startTime) {
    return 'scheduled';
  }
  if (startTime && endTime && now >= startTime && now <= endTime) {
    return 'live';
  }
  if (endTime && now > endTime) {
    return 'completed';
  }
  return status || 'scheduled';
}

/**
 * Get active coding module settings with fail-closed default.
 */
async function getCodingModuleSettings() {
  try {
    const { rows } = await pool.query(
      'SELECT id, module_enabled, leaderboard_enabled, certificates_enabled, strict_mode_default, created_at, updated_at, updated_by FROM coding_module_settings WHERE id = 1 LIMIT 1'
    );
    if (!rows.length) return { ...DEFAULT_SETTINGS };
    return {
      id: 1,
      module_enabled: Boolean(rows[0].module_enabled),
      leaderboard_enabled: Boolean(rows[0].leaderboard_enabled),
      certificates_enabled: Boolean(rows[0].certificates_enabled),
      strict_mode_default: Boolean(rows[0].strict_mode_default),
      failed_retention_days: 15,
      created_at: rows[0].created_at,
      updated_at: rows[0].updated_at,
      updated_by: rows[0].updated_by
    };
  } catch (error) {
    console.warn('[Coding Service] Error fetching module settings (failing closed):', error.message || error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Update coding module settings (Admin action).
 */
async function updateCodingModuleSettings({ module_enabled, leaderboard_enabled, certificates_enabled, strict_mode_default }, userId) {
  const current = await getCodingModuleSettings();

  const nextModuleEnabled = typeof module_enabled === 'boolean' ? module_enabled : current.module_enabled;
  const nextLeaderboardEnabled = typeof leaderboard_enabled === 'boolean' ? leaderboard_enabled : current.leaderboard_enabled;
  const nextCertificatesEnabled = typeof certificates_enabled === 'boolean' ? certificates_enabled : current.certificates_enabled;
  const nextStrictModeDefault = typeof strict_mode_default === 'boolean' ? strict_mode_default : current.strict_mode_default;

  const { rows } = await pool.query(
    `INSERT INTO coding_module_settings (id, module_enabled, leaderboard_enabled, certificates_enabled, strict_mode_default, updated_by, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
     ON CONFLICT (id)
     DO UPDATE SET
       module_enabled = EXCLUDED.module_enabled,
       leaderboard_enabled = EXCLUDED.leaderboard_enabled,
       certificates_enabled = EXCLUDED.certificates_enabled,
       strict_mode_default = EXCLUDED.strict_mode_default,
       updated_by = EXCLUDED.updated_by,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id, module_enabled, leaderboard_enabled, certificates_enabled, strict_mode_default, updated_at, updated_by`,
    [nextModuleEnabled, nextLeaderboardEnabled, nextCertificatesEnabled, nextStrictModeDefault, userId || null]
  );

  return { ...rows[0], failed_retention_days: 15 };
}

/**
 * Get Admin Overview Statistics.
 */
async function getContestStats() {
  const contestsResult = await pool.query(
    'SELECT id, status, start_time, end_time FROM coding_contests'
  );
  const contests = contestsResult.rows;

  let total = contests.length;
  let draft = 0;
  let scheduled = 0;
  let live = 0;
  let completed = 0;
  let cancelled = 0;

  contests.forEach((c) => {
    const computed = computeContestStatus(c);
    if (computed === 'draft') draft++;
    else if (computed === 'scheduled') scheduled++;
    else if (computed === 'live') live++;
    else if (computed === 'completed') completed++;
    else if (computed === 'cancelled') cancelled++;
  });

  const participantsResult = await pool.query('SELECT COUNT(DISTINCT student_id)::integer as count FROM coding_participants');
  const submissionsResult = await pool.query('SELECT COUNT(*)::integer as count FROM coding_submissions');
  const recentActivityResult = await pool.query(
    `SELECT s.id, s.submitted_at, s.status, s.language, c.title as contest_title, u.email as student_email
     FROM coding_submissions s
     JOIN coding_contests c ON c.id = s.contest_id
     JOIN users u ON u.id = s.student_id
     ORDER BY s.submitted_at DESC LIMIT 5`
  );

  return {
    total_contests: total,
    draft_contests: draft,
    scheduled_contests: scheduled,
    live_contests: live,
    completed_contests: completed,
    cancelled_contests: cancelled,
    total_participants: participantsResult.rows[0]?.count || 0,
    total_submissions: submissionsResult.rows[0]?.count || 0,
    recent_activity: recentActivityResult.rows
  };
}

/**
 * Get student-facing contest list.
 */
async function getStudentContests() {
  const { rows } = await pool.query(
    `SELECT id, title, description, instructions, status, start_time, end_time, duration_minutes, registration_required, leaderboard_visible, strict_mode_enabled, certificate_enabled, allowed_languages, created_at
     FROM coding_contests
     WHERE status IN ('scheduled', 'live', 'completed')
     ORDER BY start_time DESC`
  );
  return rows.map((c) => ({
    ...c,
    computed_status: computeContestStatus(c)
  }));
}

/**
 * Get admin contest list (including drafts and stats).
 */
async function getAdminContests() {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.description, c.instructions, c.status, c.start_time, c.end_time, c.duration_minutes,
            c.registration_required, c.leaderboard_visible, c.strict_mode_enabled, c.certificate_enabled,
            c.allowed_languages, c.created_by, c.created_at, c.updated_at,
            (SELECT COUNT(*)::integer FROM coding_problems p WHERE p.contest_id = c.id) as problems_count,
            (SELECT COUNT(*)::integer FROM coding_participants pt WHERE pt.contest_id = c.id) as participants_count,
            (SELECT COUNT(*)::integer FROM coding_submissions sub WHERE sub.contest_id = c.id) as submissions_count
     FROM coding_contests c
     ORDER BY c.created_at DESC`
  );
  return rows.map((c) => ({
    ...c,
    computed_status: computeContestStatus(c)
  }));
}

/**
 * Get contest by ID with detail and problem list.
 */
async function getContestById(contestId) {
  const { rows } = await pool.query(
    `SELECT c.*,
            (SELECT COUNT(*)::integer FROM coding_problems p WHERE p.contest_id = c.id) as problems_count,
            (SELECT COUNT(*)::integer FROM coding_participants pt WHERE pt.contest_id = c.id) as participants_count
     FROM coding_contests c
     WHERE c.id = $1 LIMIT 1`,
    [contestId]
  );
  if (!rows.length) return null;
  const contest = rows[0];
  return {
    ...contest,
    computed_status: computeContestStatus(contest)
  };
}

/**
 * Create a new contest.
 */
async function createContest(contestData, adminId) {
  const {
    title,
    description,
    instructions,
    status = 'draft',
    start_time,
    end_time,
    duration_minutes = 60,
    registration_required = false,
    leaderboard_visible = true,
    strict_mode_enabled = false,
    certificate_enabled = false,
    allowed_languages = ['python', 'javascript', 'cpp', 'c', 'java']
  } = contestData;

  if (!title || !String(title).trim()) {
    throw new Error('Contest title is required');
  }

  if (start_time && end_time) {
    const start = new Date(start_time);
    const end = new Date(end_time);
    if (end <= start) {
      throw new Error('End time must be after start time');
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO coding_contests
       (title, description, instructions, status, start_time, end_time, duration_minutes,
        registration_required, leaderboard_visible, strict_mode_enabled, certificate_enabled,
        allowed_languages, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      String(title).trim(),
      description || '',
      instructions || '',
      status,
      start_time || null,
      end_time || null,
      Number(duration_minutes) || 60,
      Boolean(registration_required),
      Boolean(leaderboard_visible),
      Boolean(strict_mode_enabled),
      Boolean(certificate_enabled),
      JSON.stringify(Array.isArray(allowed_languages) ? allowed_languages : ['python', 'javascript', 'cpp', 'c', 'java']),
      adminId || null
    ]
  );

  return {
    ...rows[0],
    computed_status: computeContestStatus(rows[0])
  };
}

/**
 * Update an existing contest.
 */
async function updateContest(contestId, contestData, adminId) {
  const current = await getContestById(contestId);
  if (!current) throw new Error('Contest not found');

  const {
    title = current.title,
    description = current.description,
    instructions = current.instructions,
    status = current.status,
    start_time = current.start_time,
    end_time = current.end_time,
    duration_minutes = current.duration_minutes,
    registration_required = current.registration_required,
    leaderboard_visible = current.leaderboard_visible,
    strict_mode_enabled = current.strict_mode_enabled,
    certificate_enabled = current.certificate_enabled,
    allowed_languages = current.allowed_languages
  } = contestData;

  if (start_time && end_time) {
    const start = new Date(start_time);
    const end = new Date(end_time);
    if (end <= start) {
      throw new Error('End time must be after start time');
    }
  }

  const { rows } = await pool.query(
    `UPDATE coding_contests
     SET title = $1,
         description = $2,
         instructions = $3,
         status = $4,
         start_time = $5,
         end_time = $6,
         duration_minutes = $7,
         registration_required = $8,
         leaderboard_visible = $9,
         strict_mode_enabled = $10,
         certificate_enabled = $11,
         allowed_languages = $12::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $13
     RETURNING *`,
    [
      String(title).trim(),
      description || '',
      instructions || '',
      status,
      start_time || null,
      end_time || null,
      Number(duration_minutes) || 60,
      Boolean(registration_required),
      Boolean(leaderboard_visible),
      Boolean(strict_mode_enabled),
      Boolean(certificate_enabled),
      JSON.stringify(Array.isArray(allowed_languages) ? allowed_languages : ['python', 'javascript', 'cpp', 'c', 'java']),
      contestId
    ]
  );

  return {
    ...rows[0],
    computed_status: computeContestStatus(rows[0])
  };
}

/**
 * Duplicate a contest with all its problems, public examples, and test cases.
 */
async function duplicateContest(contestId, adminId) {
  const original = await getContestById(contestId);
  if (!original) throw new Error('Contest not found');

  const duplicated = await createContest(
    {
      title: `${original.title} (Copy)`,
      description: original.description,
      instructions: original.instructions,
      status: 'draft',
      start_time: null,
      end_time: null,
      duration_minutes: original.duration_minutes,
      registration_required: original.registration_required,
      leaderboard_visible: original.leaderboard_visible,
      strict_mode_enabled: original.strict_mode_enabled,
      certificate_enabled: original.certificate_enabled,
      allowed_languages: original.allowed_languages
    },
    adminId
  );

  // Duplicate problems
  const problems = await getContestProblems(contestId);
  for (const prob of problems) {
    const newProb = await createProblem({
      contest_id: duplicated.id,
      title: prob.title,
      slug: `${prob.slug}-copy-${Date.now().toString(36)}`,
      statement: prob.statement,
      input_format: prob.input_format,
      output_format: prob.output_format,
      constraints: prob.constraints,
      difficulty: prob.difficulty,
      max_score: prob.max_score,
      order_index: prob.order_index,
      starter_code: prob.starter_code
    });

    // Duplicate examples
    const examplesResult = await pool.query('SELECT * FROM coding_problem_examples WHERE problem_id = $1', [prob.id]);
    for (const ex of examplesResult.rows) {
      await pool.query(
        `INSERT INTO coding_problem_examples (problem_id, sample_input, sample_output, explanation, order_index)
         VALUES ($1, $2, $3, $4, $5)`,
        [newProb.id, ex.sample_input, ex.sample_output, ex.explanation, ex.order_index]
      );
    }

    // Duplicate test cases (including hidden)
    const testCasesResult = await pool.query('SELECT * FROM coding_test_cases WHERE problem_id = $1', [prob.id]);
    for (const tc of testCasesResult.rows) {
      await pool.query(
        `INSERT INTO coding_test_cases (problem_id, input_data, expected_output, is_hidden, weight)
         VALUES ($1, $2, $3, $4, $5)`,
        [newProb.id, tc.input_data, tc.expected_output, tc.is_hidden, tc.weight]
      );
    }
  }

  return duplicated;
}

/**
 * Delete a draft contest safely.
 */
async function deleteContest(contestId) {
  const contest = await getContestById(contestId);
  if (!contest) throw new Error('Contest not found');

  if (contest.status !== 'draft') {
    throw new Error('Only draft contests can be permanently deleted. Cancel or complete live/scheduled contests instead.');
  }

  await pool.query('DELETE FROM coding_contests WHERE id = $1', [contestId]);
  return { ok: true, deletedId: contestId };
}

/**
 * Update contest status (Publish, Cancel, Reopen).
 */
async function updateContestStatus(contestId, newStatus, adminId) {
  const allowed = ['draft', 'scheduled', 'live', 'completed', 'cancelled'];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid contest status: ${newStatus}`);
  }

  const { rows } = await pool.query(
    `UPDATE coding_contests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
    [newStatus, contestId]
  );
  if (!rows.length) throw new Error('Contest not found');
  return {
    ...rows[0],
    computed_status: computeContestStatus(rows[0])
  };
}

/**
 * Get problems for a contest.
 */
async function getContestProblems(contestId) {
  const { rows } = await pool.query(
    `SELECT p.*,
            (SELECT COUNT(*)::integer FROM coding_problem_examples e WHERE e.problem_id = p.id) as examples_count,
            (SELECT COUNT(*)::integer FROM coding_test_cases tc WHERE tc.problem_id = p.id) as test_cases_count,
            (SELECT COUNT(*)::integer FROM coding_test_cases tc WHERE tc.problem_id = p.id AND tc.is_hidden = true) as hidden_test_cases_count
     FROM coding_problems p
     WHERE p.contest_id = $1
     ORDER BY p.order_index ASC, p.created_at ASC`,
    [contestId]
  );
  return rows;
}

/**
 * Create a problem.
 */
async function createProblem(problemData) {
  const contest_id = problemData.contest_id;
  const title = problemData.title;
  const slug = problemData.slug;
  const statement = problemData.statement || problemData.problem_statement;
  const input_format = problemData.input_format || '';
  const output_format = problemData.output_format || '';
  const constraints = problemData.constraints || '';
  const difficulty = problemData.difficulty || 'Easy';
  const max_score = problemData.max_score || problemData.score || 100;
  const order_index = problemData.order_index || 0;
  const starter_code = problemData.starter_code || problemData.starter_code_templates || {};

  if (!contest_id) throw new Error('contest_id is required');
  if (!title || !String(title).trim()) throw new Error('Problem title is required');
  if (!statement || !String(statement).trim()) throw new Error('Problem statement is required');

  const generatedSlug = String(slug || title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `problem-${Date.now()}`;

  const normalizedDifficulty = String(difficulty).charAt(0).toUpperCase() + String(difficulty).slice(1).toLowerCase();

  const { rows } = await pool.query(
    `INSERT INTO coding_problems
       (contest_id, title, slug, statement, input_format, output_format, constraints, difficulty, max_score, order_index, starter_code, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING *`,
    [
      contest_id,
      String(title).trim(),
      generatedSlug,
      String(statement).trim(),
      input_format || '',
      output_format || '',
      constraints || '',
      ['Easy', 'Medium', 'Hard'].includes(normalizedDifficulty) ? normalizedDifficulty : 'Easy',
      Number(max_score) || 100,
      Number(order_index) || 0,
      JSON.stringify(starter_code || {})
    ]
  );

  return rows[0];
}

/**
 * Update a problem.
 */
async function updateProblem(problemId, problemData) {
  const { rows: existing } = await pool.query('SELECT * FROM coding_problems WHERE id = $1 LIMIT 1', [problemId]);
  if (!existing.length) throw new Error('Problem not found');
  const current = existing[0];

  const title = problemData.title !== undefined ? problemData.title : current.title;
  const slug = problemData.slug !== undefined ? problemData.slug : current.slug;
  const statement = problemData.statement || problemData.problem_statement || current.statement;
  const input_format = problemData.input_format !== undefined ? problemData.input_format : current.input_format;
  const output_format = problemData.output_format !== undefined ? problemData.output_format : current.output_format;
  const constraints = problemData.constraints !== undefined ? problemData.constraints : current.constraints;
  const difficulty = problemData.difficulty !== undefined ? problemData.difficulty : current.difficulty;
  const max_score = problemData.max_score || problemData.score || current.max_score;
  const order_index = problemData.order_index !== undefined ? problemData.order_index : current.order_index;
  const starter_code = problemData.starter_code || problemData.starter_code_templates || current.starter_code;

  const { rows } = await pool.query(
    `UPDATE coding_problems
     SET title = $1,
         slug = $2,
         statement = $3,
         input_format = $4,
         output_format = $5,
         constraints = $6,
         difficulty = $7,
         max_score = $8,
         order_index = $9,
         starter_code = $10::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $11
     RETURNING *`,
    [
      String(title).trim(),
      String(slug).trim(),
      String(statement).trim(),
      input_format || '',
      output_format || '',
      constraints || '',
      ['Easy', 'Medium', 'Hard'].includes(difficulty) ? difficulty : 'Easy',
      Number(max_score) || 100,
      Number(order_index) || 0,
      JSON.stringify(starter_code || {}),
      problemId
    ]
  );

  return rows[0];
}

/**
 * Delete a problem.
 */
async function deleteProblem(problemId) {
  await pool.query('DELETE FROM coding_problems WHERE id = $1', [problemId]);
  return { ok: true, deletedId: problemId };
}

/**
 * Reorder problems in a contest.
 */
async function reorderProblems(contestId, problemOrders) {
  if (!Array.isArray(problemOrders)) return { ok: false };
  for (const item of problemOrders) {
    if (item.id && typeof item.order_index === 'number') {
      await pool.query('UPDATE coding_problems SET order_index = $1 WHERE id = $2 AND contest_id = $3', [
        item.order_index,
        item.id,
        contestId
      ]);
    }
  }
  return { ok: true };
}

/**
 * Get test cases for a problem (ADMIN ONLY - includes hidden test cases).
 */
async function getProblemTestCases(problemId) {
  const { rows } = await pool.query(
    `SELECT id, problem_id, input_data, expected_output, is_hidden, weight, created_at
     FROM coding_test_cases
     WHERE problem_id = $1
     ORDER BY is_hidden ASC, created_at ASC`,
    [problemId]
  );
  return rows;
}

/**
 * Create a single test case.
 */
async function createTestCase(testCaseData) {
  const { problem_id, input_data, expected_output, is_hidden = true, weight = 10 } = testCaseData;
  if (!problem_id) throw new Error('problem_id is required');

  const { rows } = await pool.query(
    `INSERT INTO coding_test_cases (problem_id, input_data, expected_output, is_hidden, weight)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [problem_id, String(input_data || ''), String(expected_output || ''), Boolean(is_hidden), Number(weight) || 10]
  );
  return rows[0];
}

/**
 * Update a single test case.
 */
async function updateTestCase(testCaseId, testCaseData) {
  const { input_data, expected_output, is_hidden, weight } = testCaseData;

  const { rows } = await pool.query(
    `UPDATE coding_test_cases
     SET input_data = COALESCE($1, input_data),
         expected_output = COALESCE($2, expected_output),
         is_hidden = COALESCE($3, is_hidden),
         weight = COALESCE($4, weight)
     WHERE id = $5
     RETURNING *`,
    [
      typeof input_data === 'string' ? input_data : null,
      typeof expected_output === 'string' ? expected_output : null,
      typeof is_hidden === 'boolean' ? is_hidden : null,
      typeof weight === 'number' ? weight : null,
      testCaseId
    ]
  );
  if (!rows.length) throw new Error('Test case not found');
  return rows[0];
}

/**
 * Delete a test case.
 */
async function deleteTestCase(testCaseId) {
  await pool.query('DELETE FROM coding_test_cases WHERE id = $1', [testCaseId]);
  return { ok: true, deletedId: testCaseId };
}

/**
 * Bulk import test cases for a problem.
 */
async function bulkImportTestCases(problemId, rawInput) {
  let testCasesArray = [];
  if (Array.isArray(rawInput)) {
    testCasesArray = rawInput;
  } else if (rawInput && typeof rawInput === 'object') {
    testCasesArray = rawInput.test_cases || rawInput.testCases || rawInput.test_cases_array || [];
  } else if (typeof rawInput === 'string') {
    try {
      const parsed = JSON.parse(rawInput);
      testCasesArray = Array.isArray(parsed) ? parsed : (parsed?.test_cases || parsed?.testCases || []);
    } catch (_e) {
      testCasesArray = [];
    }
  }

  if (!Array.isArray(testCasesArray) || !testCasesArray.length) {
    throw new Error('Test cases array is required for bulk import');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = [];
    for (const tc of testCasesArray) {
      const { rows } = await client.query(
        `INSERT INTO coding_test_cases (problem_id, input_data, expected_output, is_hidden, weight)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [problemId, String(tc.input_data || ''), String(tc.expected_output || ''), tc.is_hidden !== false, Number(tc.weight) || 10]
      );
      inserted.push(rows[0]);
    }
    await client.query('COMMIT');
    return { ok: true, count: inserted.length, testCases: inserted };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get Contest Results Overview for Admin.
 */
async function getContestResults(contestId) {
  const contest = await getContestById(contestId);
  if (!contest) throw new Error('Contest not found');

  const participantsResult = await pool.query(
    `SELECT pt.id, pt.student_id, pt.joined_at, pt.status,
            u.email, u.full_name,
            COALESCE(lb.total_score, 0) as total_score,
            COALESCE(lb.problems_solved, 0) as problems_solved,
            COALESCE(lb.penalty_time, 0) as penalty_time,
            COALESCE(lb.rank, 0) as rank,
            (SELECT COUNT(*)::integer FROM coding_integrity_events ie WHERE ie.contest_id = $1 AND ie.student_id = pt.student_id) as integrity_events_count,
            (SELECT status FROM coding_certificates cert WHERE cert.contest_id = $1 AND cert.student_id = pt.student_id LIMIT 1) as certificate_status
     FROM coding_participants pt
     JOIN users u ON u.id = pt.student_id
     LEFT JOIN coding_leaderboard lb ON lb.contest_id = pt.contest_id AND lb.student_id = pt.student_id
     WHERE pt.contest_id = $1
     ORDER BY lb.rank ASC NULLS LAST, lb.total_score DESC`,
    [contestId]
  );

  const submissionsResult = await pool.query(
    `SELECT sub.id, sub.problem_id, sub.student_id, sub.language, sub.status, sub.score, sub.execution_time, sub.submitted_at,
            p.title as problem_title, u.email as student_email
     FROM coding_submissions sub
     JOIN coding_problems p ON p.id = sub.problem_id
     JOIN users u ON u.id = sub.student_id
     WHERE sub.contest_id = $1
     ORDER BY sub.submitted_at DESC LIMIT 50`,
    [contestId]
  );

  return {
    contest,
    participants: participantsResult.rows,
    recent_submissions: submissionsResult.rows
  };
}

/**
 * Clean string output normalization.
 */
function normalizeOutput(str) {
  if (typeof str !== 'string') return String(str || '').trim();
  return str
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Helper: Code execution output simulation.
 */
function simulateCodeOutput(code, input) {
  const lines = String(code || '').split('\n');
  const printLines = [];
  for (const line of lines) {
    const matchPy = line.match(/print\s*\(\s*["'](.*?)["']\s*\)/);
    if (matchPy) printLines.push(matchPy[1]);
    const matchCpp = line.match(/cout\s*<<\s*["'](.*?)["']\s*;/);
    if (matchCpp) printLines.push(matchCpp[1]);
    const matchJava = line.match(/System\.out\.println\s*\(\s*["'](.*?)["']\s*\)/);
    if (matchJava) printLines.push(matchJava[1]);
  }
  if (printLines.length > 0) return printLines.join('\n');
  return String(input || '').trim();
}

/**
 * Execute single test input evaluation boundary.
 */
function evaluateCodeExecution(language, sourceCode, inputData) {
  const startTime = Date.now();
  let userOutput = '';
  let error = null;

  try {
    const lang = String(language || '').toLowerCase();
    if (lang === 'javascript' || lang === 'node') {
      const logs = [];
      const customConsole = {
        log: (...args) => logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
        error: (...args) => logs.push(args.map((a) => String(a)).join(' ')),
        warn: () => {}
      };
      const fsMock = {
        readFileSync: () => inputData || ''
      };
      const requireMock = (mod) => (mod === 'fs' ? fsMock : {});
      const fn = new Function('console', 'fs', 'require', 'input', `
        try {
          ${sourceCode}
        } catch(e) {
          console.log('Runtime Error:', e.message);
        }
      `);
      fn(customConsole, fsMock, requireMock, inputData);
      userOutput = logs.join('\n');
    } else {
      userOutput = simulateCodeOutput(sourceCode, inputData);
    }
  } catch (err) {
    error = err.message || 'Execution error';
  }

  const executionTime = Math.max(1, Date.now() - startTime);
  return {
    output: normalizeOutput(userOutput),
    executionTime,
    error
  };
}

/**
 * Get student contest detail with problems (shielded if scheduled).
 */
async function getStudentContestById(contestId, studentId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.description, c.instructions, c.status, c.start_time, c.end_time,
            c.duration_minutes, c.registration_required, c.leaderboard_visible, c.strict_mode_enabled,
            c.certificate_enabled, c.allowed_languages, c.created_at,
            (SELECT COUNT(*)::integer FROM coding_problems p WHERE p.contest_id = c.id) as problems_count
     FROM coding_contests c
     WHERE c.id = $1 AND c.status IN ('scheduled', 'live', 'completed')
     LIMIT 1`,
    [contestId]
  );
  if (!rows.length) return null;

  const contest = rows[0];
  const computedStatus = computeContestStatus(contest);

  let isRegistered = false;
  if (studentId) {
    const regResult = await pool.query(
      `SELECT status FROM coding_participants WHERE contest_id = $1 AND student_id = $2 LIMIT 1`,
      [contestId, studentId]
    );
    isRegistered = regResult.rows.length > 0;
  }

  let problems = [];
  if (computedStatus === 'live' || computedStatus === 'completed') {
    const probResult = await pool.query(
      `SELECT p.id, p.contest_id, p.title, p.slug, p.difficulty, p.max_score, p.order_index,
              (SELECT status FROM coding_submissions sub WHERE sub.problem_id = p.id AND sub.student_id = $2 ORDER BY sub.score DESC, sub.submitted_at DESC LIMIT 1) as my_status,
              (SELECT max(score) FROM coding_submissions sub WHERE sub.problem_id = p.id AND sub.student_id = $2) as my_best_score
       FROM coding_problems p
       WHERE p.contest_id = $1
       ORDER BY p.order_index ASC, p.created_at ASC`,
      [contestId, studentId || null]
    );
    problems = probResult.rows.map((p) => ({
      ...p,
      solved: String(p.my_status || '').toLowerCase() === 'accepted'
    }));
  }

  return {
    ...contest,
    computed_status: computedStatus,
    is_registered: isRegistered,
    problems
  };
}

/**
 * Register a student for a contest.
 */
async function registerStudentForContest(contestId, studentId) {
  const contest = await getContestById(contestId);
  if (!contest || ['draft', 'cancelled'].includes(contest.status)) {
    throw new Error('Contest is not available for registration');
  }

  const { rows } = await pool.query(
    `INSERT INTO coding_participants (contest_id, student_id, joined_at, status)
     VALUES ($1, $2, CURRENT_TIMESTAMP, 'registered')
     ON CONFLICT (contest_id, student_id)
     DO UPDATE SET status = 'registered'
     RETURNING *`,
    [contestId, studentId]
  );
  return rows[0];
}

/**
 * Get student problem detail (strictly shielding hidden test cases).
 */
async function getStudentProblemById(problemId, studentId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.contest_id, p.title, p.slug, p.statement, p.input_format, p.output_format,
            p.constraints, p.difficulty, p.max_score, p.order_index, p.starter_code,
            c.title as contest_title, c.status as contest_status, c.start_time, c.end_time,
            c.duration_minutes, c.allowed_languages, c.strict_mode_enabled, c.leaderboard_visible
     FROM coding_problems p
     JOIN coding_contests c ON c.id = p.contest_id
     WHERE p.id = $1 AND c.status IN ('scheduled', 'live', 'completed')
     LIMIT 1`,
    [problemId]
  );
  if (!rows.length) return null;

  const problem = rows[0];
  const computedStatus = computeContestStatus({
    status: problem.contest_status,
    start_time: problem.start_time,
    end_time: problem.end_time
  });

  if (computedStatus === 'scheduled') {
    throw new Error('Contest has not started yet. Problem details are sealed.');
  }

  const examplesResult = await pool.query(
    `SELECT id, sample_input, sample_output, explanation, order_index
     FROM coding_problem_examples
     WHERE problem_id = $1
     ORDER BY order_index ASC`,
    [problemId]
  );

  let mySubmissions = [];
  if (studentId) {
    const subResult = await pool.query(
      `SELECT id, language, status, score, execution_time, submitted_at, source_code
       FROM coding_submissions
       WHERE problem_id = $1 AND student_id = $2
       ORDER BY submitted_at DESC LIMIT 10`,
      [problemId, studentId]
    );
    mySubmissions = subResult.rows;
  }

  return {
    id: problem.id,
    contest_id: problem.contest_id,
    contest_title: problem.contest_title,
    title: problem.title,
    slug: problem.slug,
    statement: problem.statement,
    input_format: problem.input_format,
    output_format: problem.output_format,
    constraints: problem.constraints,
    difficulty: problem.difficulty,
    max_score: problem.max_score,
    order_index: problem.order_index,
    starter_code: problem.starter_code || {},
    allowed_languages: problem.allowed_languages || ['python', 'javascript', 'cpp', 'c', 'java'],
    strict_mode_enabled: Boolean(problem.strict_mode_enabled),
    leaderboard_visible: Boolean(problem.leaderboard_visible),
    examples: examplesResult.rows,
    my_submissions: mySubmissions
  };
}

const { executeCodeWithJudge0 } = require('./judge0Service');
const { getStudentIntegritySummary } = require('./integrityAssessmentService');
const { runSafeDataRetentionCleanup } = require('./codingRetentionService');
const { calculateSimilarity } = require('./codeSimilarityService');

/**
 * Get Contest Results Overview for Admin (Including Integrity Proctoring Summary).
 */
async function getContestResults(contestId) {
  const contest = await getContestById(contestId);
  if (!contest) throw new Error('Contest not found');

  const participantsResult = await pool.query(
    `SELECT pt.id, pt.student_id, pt.joined_at, pt.status,
            u.email, u.full_name,
            COALESCE(lb.total_score, 0) as total_score,
            COALESCE(lb.problems_solved, 0) as problems_solved,
            COALESCE(lb.penalty_time, 0) as penalty_time,
            COALESCE(lb.rank, 0) as rank,
            (SELECT COUNT(*)::integer FROM coding_integrity_events ie WHERE ie.contest_id = $1 AND ie.student_id = pt.student_id) as integrity_events_count,
            (SELECT status FROM coding_certificates cert WHERE cert.contest_id = $1 AND cert.student_id = pt.student_id LIMIT 1) as certificate_status
     FROM coding_participants pt
     JOIN users u ON u.id = pt.student_id
     LEFT JOIN coding_leaderboard lb ON lb.contest_id = pt.contest_id AND lb.student_id = pt.student_id
     WHERE pt.contest_id = $1
     ORDER BY lb.rank ASC NULLS LAST, lb.total_score DESC`,
    [contestId]
  );

  // Attach multi-signal integrity report to each participant
  const enrichedParticipants = [];
  for (const pt of participantsResult.rows) {
    const integritySummary = await getStudentIntegritySummary(contestId, pt.student_id).catch(() => ({
      paste_count: 0,
      tab_switch_count: 0,
      max_similarity: 0,
      assessment: { rating: 'Low', risk_score: 0, flags: [] }
    }));

    enrichedParticipants.push({
      ...pt,
      paste_count: integritySummary.paste_count,
      tab_switch_count: integritySummary.tab_switch_count,
      max_similarity: integritySummary.max_similarity,
      integrity_rating: integritySummary.assessment.rating,
      integrity_risk_score: integritySummary.assessment.risk_score,
      integrity_flags: integritySummary.assessment.flags
    });
  }

  const submissionsResult = await pool.query(
    `SELECT sub.id, sub.problem_id, sub.student_id, sub.language, sub.status, sub.score, sub.execution_time, sub.submitted_at,
            p.title as problem_title, u.email as student_email
     FROM coding_submissions sub
     JOIN coding_problems p ON p.id = sub.problem_id
     JOIN users u ON u.id = sub.student_id
     WHERE sub.contest_id = $1
     ORDER BY sub.submitted_at DESC LIMIT 50`,
    [contestId]
  );

  return {
    contest,
    participants: enrichedParticipants,
    recent_submissions: submissionsResult.rows
  };
}

/**
 * Disqualify a student participant manually (Admin action with audit trail).
 */
async function disqualifyParticipant(contestId, studentId, adminId, reason) {
  if (!contestId || !studentId) throw new Error('contest_id and student_id are required');
  const justification = String(reason || 'Integrity violation disqualification').trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update participant status to disqualified
    await client.query(
      `UPDATE coding_participants SET status = 'disqualified' WHERE contest_id = $1 AND student_id = $2`,
      [contestId, studentId]
    );

    // 2. Log audit trail event
    await client.query(
      `INSERT INTO coding_integrity_events (contest_id, student_id, event_type, metadata, created_at)
       VALUES ($1, $2, 'disqualified', $3::jsonb, CURRENT_TIMESTAMP)`,
      [contestId, studentId, JSON.stringify({ admin_id: adminId || null, reason: justification, timestamp: new Date() })]
    );

    // 3. Revoke any issued certificate
    await client.query(
      `UPDATE coding_certificates SET status = 'revoked' WHERE contest_id = $1 AND student_id = $2`,
      [contestId, studentId]
    );

    // 4. Remove from active contest leaderboard
    await client.query(
      `DELETE FROM coding_leaderboard WHERE contest_id = $1 AND student_id = $2`,
      [contestId, studentId]
    );

    await client.query('COMMIT');

    // 5. Recalculate leaderboard for remaining students
    await calculateContestLeaderboard(contestId).catch(() => null);

    return { ok: true, student_id: studentId, contest_id: contestId, status: 'disqualified', reason: justification };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Temporary Run Code Execution via Judge0 / Sandboxed Engine.
 */
async function runStudentCode(problemId, { language, code, customInput }) {
  const problem = await getStudentProblemById(problemId, null);
  if (!problem) throw new Error('Problem not found');

  const sourceCode = String(code || '');
  if (!sourceCode.trim()) throw new Error('Source code cannot be empty');

  if (customInput !== undefined && customInput !== null) {
    const res = await executeCodeWithJudge0({ language, sourceCode, inputData: String(customInput) });
    return {
      is_custom_input: true,
      custom_input: customInput,
      output: res.stdout,
      error: res.stderr,
      execution_time: res.execution_time,
      status: res.status
    };
  }

  const results = [];
  for (let idx = 0; idx < problem.examples.length; idx++) {
    const ex = problem.examples[idx];
    const res = await executeCodeWithJudge0({
      language,
      sourceCode,
      inputData: ex.sample_input,
      expectedOutput: ex.sample_output
    });

    const passed = res.status === 'accepted';
    results.push({
      example_index: idx + 1,
      sample_input: ex.sample_input,
      expected_output: ex.sample_output,
      actual_output: res.stdout,
      passed,
      execution_time: res.execution_time,
      error: res.stderr
    });
  }

  return {
    is_custom_input: false,
    results,
    total_examples: results.length,
    passed_examples: results.filter((r) => r.passed).length
  };
}

/**
 * Submit Solution with server-bound student identity & Judge0 evaluation.
 */
async function submitStudentSolution(problemId, { language, code }, studentId) {
  if (!studentId) throw new Error('Unauthorized student session');

  const { rows: probRows } = await pool.query(
    `SELECT p.*, c.status as contest_status, c.start_time, c.end_time, c.allowed_languages
     FROM coding_problems p
     JOIN coding_contests c ON c.id = p.contest_id
     WHERE p.id = $1 LIMIT 1`,
    [problemId]
  );
  if (!probRows.length) throw new Error('Problem not found');

  const problem = probRows[0];
  const contestId = problem.contest_id;

  const computedStatus = computeContestStatus({
    status: problem.contest_status,
    start_time: problem.start_time,
    end_time: problem.end_time
  });

  if (!['live', 'completed'].includes(computedStatus)) {
    throw new Error('Contest is not active for submissions');
  }

  const allowedLangs = Array.isArray(problem.allowed_languages) ? problem.allowed_languages : ['python', 'javascript', 'cpp', 'c', 'java'];
  if (!allowedLangs.includes(language)) {
    throw new Error(`Language '${language}' is not permitted for this contest`);
  }

  const sourceCode = String(code || '');
  if (!sourceCode.trim()) throw new Error('Source code cannot be empty');

  // Verify student is not disqualified
  const { rows: ptCheck } = await pool.query(
    `SELECT status FROM coding_participants WHERE contest_id = $1 AND student_id = $2 LIMIT 1`,
    [contestId, studentId]
  );
  if (ptCheck.length && ptCheck[0].status === 'disqualified') {
    throw new Error('Participant is disqualified from this contest');
  }

  await registerStudentForContest(contestId, studentId).catch(() => null);

  const { rows: testCases } = await pool.query(
    `SELECT id, input_data, expected_output, is_hidden, weight FROM coding_test_cases WHERE problem_id = $1 ORDER BY is_hidden ASC`,
    [problemId]
  );

  let evalCases = testCases;
  if (!evalCases.length) {
    const { rows: examples } = await pool.query(
      `SELECT id, sample_input as input_data, sample_output as expected_output, false as is_hidden, 10 as weight FROM coding_problem_examples WHERE problem_id = $1`,
      [problemId]
    );
    evalCases = examples;
  }

  let passedCount = 0;
  let totalCount = evalCases.length;
  let maxScore = problem.max_score || 100;
  let totalTime = 0;
  let hasRuntimeError = false;

  if (totalCount === 0) {
    passedCount = 1;
    totalCount = 1;
  } else {
    for (const tc of evalCases) {
      const res = await executeCodeWithJudge0({
        language,
        sourceCode,
        inputData: tc.input_data,
        expectedOutput: tc.expected_output
      });

      totalTime += res.execution_time;
      if (res.status === 'runtime_error' || res.status === 'compilation_error') {
        hasRuntimeError = true;
      }
      if (res.status === 'accepted') {
        passedCount++;
      }
    }
  }

  let finalStatus = 'accepted';
  let earnedScore = 0;

  if (passedCount === totalCount) {
    finalStatus = 'accepted';
    earnedScore = maxScore;
  } else if (hasRuntimeError) {
    finalStatus = 'runtime_error';
    earnedScore = Math.floor((passedCount / Math.max(1, totalCount)) * maxScore);
  } else {
    finalStatus = 'wrong_answer';
    earnedScore = Math.floor((passedCount / Math.max(1, totalCount)) * maxScore);
  }

  const avgExecutionTime = totalCount > 0 ? Number((totalTime / totalCount).toFixed(2)) : 10;

  // Insert submission row
  const { rows: subRows } = await pool.query(
    `INSERT INTO coding_submissions
       (contest_id, problem_id, student_id, language, source_code, status, score, execution_time, submitted_at, is_best_submission)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, false)
     RETURNING id, contest_id, problem_id, student_id, language, status, score, execution_time, submitted_at`,
    [contestId, problemId, studentId, language, sourceCode, finalStatus, earnedScore, avgExecutionTime]
  );

  // Update is_best_submission flag for student on this problem
  await pool.query(
    `UPDATE coding_submissions SET is_best_submission = false WHERE problem_id = $1 AND student_id = $2`,
    [problemId, studentId]
  );
  await pool.query(
    `UPDATE coding_submissions SET is_best_submission = true
     WHERE id = (
       SELECT id FROM coding_submissions
       WHERE problem_id = $1 AND student_id = $2
       ORDER BY score DESC, submitted_at DESC LIMIT 1
     )`,
    [problemId, studentId]
  );

  // Re-calculate contest leaderboard
  await calculateContestLeaderboard(contestId).catch((err) => console.warn('[Coding Leaderboard Update Error]:', err.message));

  return {
    submission_id: subRows[0].id,
    status: finalStatus,
    score: earnedScore,
    max_score: maxScore,
    total_cases: totalCount,
    passed_cases: passedCount,
    execution_time: avgExecutionTime,
    submitted_at: subRows[0].submitted_at
  };
}


/**
 * Calculate & fetch Contest Leaderboard with visibility checks and privacy formatting.
 */
async function calculateContestLeaderboard(contestId, studentId) {
  const globalSettings = await getCodingModuleSettings();
  const contest = await getContestById(contestId);

  if (!contest) throw new Error('Contest not found');

  if (!globalSettings.leaderboard_enabled || !contest.leaderboard_visible) {
    return {
      hidden: true,
      message: 'Leaderboard is currently hidden by administrator or contest settings'
    };
  }

  const { rows: aggRows } = await pool.query(
    `SELECT pt.student_id,
            COALESCE(u.full_name, u.email, 'Student #' || pt.student_id) as display_name,
            u.email,
            SUM(best.max_prob_score)::integer as total_score,
            COUNT(CASE WHEN best.has_accepted THEN 1 END)::integer as problems_solved,
            COALESCE(SUM(best.penalty_mins), 0)::integer as penalty_time
     FROM coding_participants pt
     JOIN users u ON u.id = pt.student_id
     JOIN (
       SELECT contest_id, problem_id, student_id,
              MAX(score) as max_prob_score,
              BOOL_OR(status = 'accepted') as has_accepted,
              EXTRACT(EPOCH FROM (MIN(submitted_at) - (SELECT start_time FROM coding_contests WHERE id = contest_id))) / 60 as penalty_mins
       FROM coding_submissions
       WHERE contest_id = $1
       GROUP BY contest_id, problem_id, student_id
     ) best ON best.student_id = pt.student_id AND best.contest_id = pt.contest_id
     WHERE pt.contest_id = $1 AND (pt.status IS NULL OR pt.status != 'disqualified')
     GROUP BY pt.student_id, u.full_name, u.email
     ORDER BY total_score DESC, problems_solved DESC, penalty_time ASC`,
    [contestId]
  );


  const leaderboardEntries = [];
  for (let idx = 0; idx < aggRows.length; idx++) {
    const entry = aggRows[idx];
    const rank = idx + 1;
    const penalty = Math.max(0, Math.round(Number(entry.penalty_time) || 0));

    await pool.query(
      `INSERT INTO coding_leaderboard (contest_id, student_id, total_score, problems_solved, penalty_time, rank, last_score_update)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (contest_id, student_id)
       DO UPDATE SET
         total_score = EXCLUDED.total_score,
         problems_solved = EXCLUDED.problems_solved,
         penalty_time = EXCLUDED.penalty_time,
         rank = EXCLUDED.rank,
         last_score_update = CURRENT_TIMESTAMP`,
      [contestId, entry.student_id, entry.total_score, entry.problems_solved, penalty, rank]
    );

    const formattedName = entry.display_name.includes('@') ? entry.display_name.split('@')[0] : entry.display_name;

    leaderboardEntries.push({
      rank,
      student_id: entry.student_id,
      display_name: formattedName,
      total_score: entry.total_score,
      problems_solved: entry.problems_solved,
      penalty_time: penalty
    });
  }

  return {
    hidden: false,
    contest_id: contestId,
    contest_title: contest.title,
    leaderboard: leaderboardEntries
  };
}

/**
 * Calculate & fetch Season / Overall Leaderboard based on completed contests.
 * Idempotent points calculation (1st = 100, 2nd = 75, 3rd = 60, 4th-10th = 40, participation = 10).
 */
async function getSeasonLeaderboard() {
  const globalSettings = await getCodingModuleSettings();
  if (!globalSettings.leaderboard_enabled) {
    return {
      hidden: true,
      message: 'Overall Season Leaderboard is currently disabled by administrator'
    };
  }

  const { rows: contests } = await pool.query(
    `SELECT id, title FROM coding_contests WHERE status IN ('live', 'completed') AND leaderboard_visible = true`
  );

  const studentPointsMap = new Map();

  for (const c of contests) {
    const { rows: entries } = await pool.query(
      `SELECT student_id, total_score, problems_solved, rank
       FROM coding_leaderboard
       WHERE contest_id = $1
       ORDER BY rank ASC`,
      [c.id]
    );

    entries.forEach((e) => {
      let pts = 10;
      if (e.rank === 1) pts = 100;
      else if (e.rank === 2) pts = 75;
      else if (e.rank === 3) pts = 60;
      else if (e.rank >= 4 && e.rank <= 10) pts = 40;

      const current = studentPointsMap.get(e.student_id) || {
        student_id: e.student_id,
        season_points: 0,
        contests_count: 0,
        total_solved: 0
      };

      current.season_points += pts;
      current.contests_count += 1;
      current.total_solved += e.problems_solved || 0;

      studentPointsMap.set(e.student_id, current);
    });
  }

  const seasonList = Array.from(studentPointsMap.values());
  seasonList.sort((a, b) => b.season_points - a.season_points || b.total_solved - a.total_solved);

  const resultList = [];
  for (let idx = 0; idx < seasonList.length; idx++) {
    const item = seasonList[idx];
    const { rows: uRows } = await pool.query(`SELECT full_name, email FROM users WHERE id = $1 LIMIT 1`, [item.student_id]);
    const u = uRows[0] || {};
    const rawName = u.full_name || u.email || `Student #${item.student_id}`;
    const name = rawName.includes('@') ? rawName.split('@')[0] : rawName;

    resultList.push({
      rank: idx + 1,
      student_id: item.student_id,
      display_name: name,
      season_points: item.season_points,
      contests_count: item.contests_count,
      total_solved: item.total_solved
    });
  }

  return {
    hidden: false,
    leaderboard: resultList
  };
}

/**
 * Get student's personal submission history (strictly scoped to authenticated student).
 */
async function getStudentSubmissions(studentId) {
  if (!studentId) return [];

  const { rows } = await pool.query(
    `SELECT sub.id, sub.contest_id, sub.problem_id, sub.language, sub.status, sub.score, sub.execution_time, sub.submitted_at,
            p.title as problem_title, p.max_score, c.title as contest_title
     FROM coding_submissions sub
     JOIN coding_problems p ON p.id = sub.problem_id
     JOIN coding_contests c ON c.id = sub.contest_id
     WHERE sub.student_id = $1
     ORDER BY sub.submitted_at DESC`,
    [studentId]
  );
  return rows;
}

/**
 * Record integrity / anti-cheat monitoring event.
 */
async function recordIntegrityEvent({ contestId, problemId, studentId, eventType, eventData }) {
  if (!contestId || !studentId || !eventType) return { ok: false };

  const { rows } = await pool.query(
    `INSERT INTO coding_integrity_events (contest_id, student_id, event_type, metadata, created_at)
     VALUES ($1, $2, $3, $4::jsonb, CURRENT_TIMESTAMP)
     RETURNING id, contest_id, student_id, event_type, created_at`,
    [contestId, studentId, eventType, JSON.stringify(eventData || {})]
  );
  return { ok: true, event: rows[0] };
}

module.exports = {
  SUPPORTED_LANGUAGES,
  getCodingModuleSettings,
  updateCodingModuleSettings,
  getContestStats,
  getStudentContests,
  getAdminContests,
  getContestById,
  createContest,
  updateContest,
  duplicateContest,
  deleteContest,
  updateContestStatus,
  getContestProblems,
  createProblem,
  updateProblem,
  deleteProblem,
  reorderProblems,
  getProblemTestCases,
  createTestCase,
  updateTestCase,
  deleteTestCase,
  bulkImportTestCases,
  getContestResults,
  getStudentContestById,
  registerStudentForContest,
  getStudentProblemById,
  runStudentCode,
  submitStudentSolution,
  calculateContestLeaderboard,
  getSeasonLeaderboard,
  getStudentSubmissions,
  recordIntegrityEvent,
  disqualifyParticipant,
  executeCodeWithJudge0,
  getStudentIntegritySummary,
  runSafeDataRetentionCleanup
};


