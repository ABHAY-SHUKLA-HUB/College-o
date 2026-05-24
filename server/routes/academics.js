const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
let academicsSchemaReady = false;

async function ensureAcademicsSchema() {
  if (academicsSchemaReady) return;

  await pool.query(`
    ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS learning_goals JSONB,
      ADD COLUMN IF NOT EXISTS onboarding_payload JSONB
  `);

  await pool.query(`
    ALTER TABLE academic_categories
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE academic_branches
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE academic_semesters
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_step_config (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      step_key VARCHAR(80) UNIQUE NOT NULL,
      title VARCHAR(180) NOT NULL,
      subtitle TEXT,
      is_enabled BOOLEAN DEFAULT TRUE,
      is_required BOOLEAN DEFAULT TRUE,
      position_order INTEGER DEFAULT 0,
      question_type VARCHAR(40) DEFAULT 'single_select',
      options_json JSONB DEFAULT '[]'::jsonb,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS onboarding_option_catalog (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      option_group VARCHAR(80) NOT NULL,
      option_value VARCHAR(160) NOT NULL,
      option_label VARCHAR(200) NOT NULL,
      description TEXT,
      is_enabled BOOLEAN DEFAULT TRUE,
      is_default BOOLEAN DEFAULT FALSE,
      position_order INTEGER DEFAULT 0,
      category_id INTEGER REFERENCES academic_categories(id),
      branch_id INTEGER REFERENCES academic_branches(id),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(option_group, option_value)
    )
  `);

  academicsSchemaReady = true;
}

// ============================================
// ACADEMIC ONBOARDING ENDPOINTS
// ============================================

/**
 * GET /academics/categories
 * Get all academic categories (Engineering, Commerce)
 */
router.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, label, description, display_order
       FROM academic_categories
       WHERE is_active = TRUE
       ORDER BY display_order ASC`
    );
    res.json({ categories: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /academics/branches?categoryId=1
 * Get branches for a specific category
 */
router.get('/branches', async (req, res) => {
  try {
    const categoryId = Number(req.query.categoryId);
    if (!categoryId) {
      return res.status(400).json({ error: 'categoryId required' });
    }

    const { rows } = await pool.query(
      `SELECT id, code, name, label, description, display_order
       FROM academic_branches
       WHERE category_id = $1 AND is_active = TRUE
       ORDER BY display_order ASC`,
      [categoryId]
    );
    res.json({ branches: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

/**
 * GET /academics/semesters
 * Get all available semesters/years
 */
router.get('/semesters', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, semester_number, year_number, label, description, display_order
       FROM academic_semesters
       WHERE is_active = TRUE
       ORDER BY display_order ASC`
    );
    res.json({ semesters: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch semesters' });
  }
});

/**
 * GET /academics/subjects?branchId=1&semesterId=3
 * Get subjects for a branch and semester
 */
router.get('/subjects', async (req, res) => {
  try {
    const branchId = Number(req.query.branchId);
    const semesterId = req.query.semesterId ? Number(req.query.semesterId) : null;

    if (!branchId) {
      return res.status(400).json({ error: 'branchId required' });
    }

    let query = `
      SELECT id, name, code, description, credits, display_order
      FROM academic_subjects
      WHERE branch_id = $1
    `;
    const params = [branchId];

    if (semesterId) {
      query += ` AND semester_id = $2`;
      params.push(semesterId);
    }

    query += ` ORDER BY display_order ASC`;

    const { rows } = await pool.query(query, params);
    res.json({ subjects: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

router.get('/onboarding/config', async (_req, res) => {
  try {
    const [stepsResult, optionsResult] = await Promise.all([
      pool.query(
        `SELECT step_key, title, subtitle, is_enabled, is_required, position_order, question_type, COALESCE(options_json, '[]'::jsonb) AS options_json
         FROM onboarding_step_config
         WHERE is_enabled = TRUE
         ORDER BY position_order ASC`
      ),
      pool.query(
        `SELECT option_group, option_value, option_label, description, position_order, category_id, branch_id
         FROM onboarding_option_catalog
         WHERE is_enabled = TRUE
         ORDER BY option_group ASC, position_order ASC, option_label ASC`
      )
    ]);

    const grouped = optionsResult.rows.reduce((acc, row) => {
      acc[row.option_group] = acc[row.option_group] || [];
      acc[row.option_group].push(row);
      return acc;
    }, {});

    res.json({
      steps: stepsResult.rows,
      options: grouped
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch onboarding config' });
  }
});

/**
 * POST /academics/onboarding/complete
 * Complete student academic onboarding
 * Body: { categoryId, branchId, semesterId, targetExam?, weakSubjects?, careerInterest?, preferredStudyMode? }
 */
router.post('/onboarding/complete', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      categoryId,
      branchId,
      semesterId,
      targetExam,
      weakSubjects,
      learningGoals,
      careerInterest,
      preferredStudyMode,
      onboardingPayload
    } = req.body;

    if (!categoryId || !branchId || !semesterId) {
      return res.status(400).json({
        error: 'categoryId, branchId, and semesterId are required'
      });
    }

    // Validate that branch belongs to category
    const branchCheck = await pool.query(
      `SELECT id FROM academic_branches
       WHERE id = $1 AND category_id = $2`,
      [branchId, categoryId]
    );

    if (branchCheck.rowCount === 0) {
      return res.status(400).json({ error: 'Invalid branch for this category' });
    }

    // Create or update user profile with academic info
    const profileResult = await pool.query(
      `INSERT INTO user_profiles (
        user_id, category_id, branch_id, semester_id,
        target_exam, weak_subjects, career_interest, preferred_study_mode,
        learning_goals, onboarding_payload, onboarding_completed, current_streak
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, 0)
      ON CONFLICT (user_id) DO UPDATE SET
        category_id = $2,
        branch_id = $3,
        semester_id = $4,
        target_exam = $5,
        weak_subjects = $6,
        career_interest = $7,
        preferred_study_mode = $8,
        learning_goals = $9,
        onboarding_payload = $10,
        onboarding_completed = TRUE,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, user_id, category_id, branch_id, semester_id, onboarding_completed`,
      [
        userId,
        categoryId,
        branchId,
        semesterId,
        targetExam || null,
        JSON.stringify(weakSubjects || []),
        careerInterest || null,
        preferredStudyMode || null,
        JSON.stringify(Array.isArray(learningGoals) ? learningGoals : []),
        onboardingPayload && typeof onboardingPayload === 'object' ? JSON.stringify(onboardingPayload) : JSON.stringify({})
      ]
    );

    // Fetch branch and category info for response
    const branchInfo = await pool.query(
      `SELECT ab.name as branch_name, ab.label as branch_label, ac.name as category_name, ac.label as category_label
       FROM academic_branches ab
       JOIN academic_categories ac ON ac.id = ab.category_id
       WHERE ab.id = $1`,
      [branchId]
    );

    const semesterInfo = await pool.query(
      `SELECT label, description FROM academic_semesters WHERE id = $1`,
      [semesterId]
    );

    res.status(200).json({
      message: 'Academic onboarding completed successfully',
      profile: {
        ...profileResult.rows[0],
        ...branchInfo.rows[0],
        semesterLabel: semesterInfo.rows[0]?.label
      }
    });
  } catch (error) {
    console.error('Onboarding error:', error);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

/**
 * GET /academics/profile
 * Get current student's academic profile
 */
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    const profileResult = await pool.query(
      `SELECT 
        up.id, up.user_id, up.category_id, up.branch_id, up.semester_id,
        up.target_exam, up.weak_subjects, up.career_interest, up.preferred_study_mode,
        up.learning_goals, up.onboarding_payload,
        up.onboarding_completed,
        ac.name as category_name, ac.label as category_label,
        ab.code as branch_code, ab.name as branch_name, ab.label as branch_label,
        asr.semester_number, asr.year_number, asr.label as semester_label
       FROM user_profiles up
       LEFT JOIN academic_categories ac ON ac.id = up.category_id
       LEFT JOIN academic_branches ab ON ab.id = up.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = up.semester_id
       WHERE up.user_id = $1`,
      [userId]
    );

    if (profileResult.rowCount === 0) {
      return res.json({
        profile: null,
        onboarding_completed: false
      });
    }

    const profile = profileResult.rows[0];
    res.json({
      profile: {
        id: profile.id,
        userId: profile.user_id,
        categoryId: profile.category_id,
        branchId: profile.branch_id,
        semesterId: profile.semester_id,
        targetExam: profile.target_exam,
          weakSubjects: (() => {
            try {
              return profile.weak_subjects && typeof profile.weak_subjects === 'string' ? JSON.parse(profile.weak_subjects) : (Array.isArray(profile.weak_subjects) ? profile.weak_subjects : []);
            } catch (e) {
              return [];
            }
          })(),
        careerInterest: profile.career_interest,
        preferredStudyMode: profile.preferred_study_mode,
        learningGoals: Array.isArray(profile.learning_goals) ? profile.learning_goals : [],
        onboardingPayload: profile.onboarding_payload || {},
        category: {
          name: profile.category_name,
          label: profile.category_label
        },
        branch: {
          code: profile.branch_code,
          name: profile.branch_name,
          label: profile.branch_label
        },
        semester: {
          semesterNumber: profile.semester_number,
          yearNumber: profile.year_number,
          label: profile.semester_label
        }
      },
      onboarding_completed: profile.onboarding_completed
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch academic profile' });
  }
});

/**
 * PUT /academics/profile
 * Update student's academic profile
 */
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      branchId,
      semesterId,
      targetExam,
      weakSubjects,
      learningGoals,
      careerInterest,
      preferredStudyMode
    } = req.body;

    // Get current category to maintain it
    const currentProfile = await pool.query(
      `SELECT category_id FROM user_profiles WHERE user_id = $1`,
      [userId]
    );

    if (currentProfile.rowCount === 0) {
      return res.status(404).json({ error: 'Academic profile not found' });
    }

    const categoryId = currentProfile.rows[0].category_id;

    // If branch is being changed, validate it belongs to the category
    if (branchId) {
      const branchCheck = await pool.query(
        `SELECT id FROM academic_branches
         WHERE id = $1 AND category_id = $2`,
        [branchId, categoryId]
      );

      if (branchCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Invalid branch for this category' });
      }
    }

    const updateResult = await pool.query(
      `UPDATE user_profiles SET
        branch_id = COALESCE($2, branch_id),
        semester_id = COALESCE($3, semester_id),
        target_exam = COALESCE($4, target_exam),
        weak_subjects = COALESCE($5, weak_subjects),
        career_interest = COALESCE($6, career_interest),
        preferred_study_mode = COALESCE($7, preferred_study_mode),
        learning_goals = COALESCE($8, learning_goals),
        updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING id, user_id, category_id, branch_id, semester_id`,
      [
        userId,
        branchId || null,
        semesterId || null,
        targetExam || null,
        weakSubjects ? JSON.stringify(weakSubjects) : null,
        careerInterest || null,
        preferredStudyMode || null,
        Array.isArray(learningGoals) ? JSON.stringify(learningGoals) : null
      ]
    );

    res.json({
      message: 'Academic profile updated successfully',
      profile: updateResult.rows[0]
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update academic profile' });
  }
});

module.exports = router;
module.exports.ensureAcademicsSchema = ensureAcademicsSchema;
