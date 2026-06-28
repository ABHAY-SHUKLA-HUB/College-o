const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
let academicsSchemaReady = false;

router.use(async (_req, _res, next) => {
  try {
    await ensureAcademicsSchema();
    next();
  } catch (error) {
    next(error);
  }
});

function setPublicCacheHeaders(res, maxAgeSeconds = 300) {
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${Math.max(maxAgeSeconds * 3, 60)}`);
  res.setHeader('Vary', 'Origin');
}

async function ensureAcademicsSchema() {
  if (academicsSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_colleges (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      code VARCHAR(60),
      name VARCHAR(180) NOT NULL,
      label VARCHAR(220),
      description TEXT,
      display_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_courses (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      college_id INTEGER REFERENCES academic_colleges(id) ON DELETE SET NULL,
      code VARCHAR(60),
      name VARCHAR(180) NOT NULL,
      label VARCHAR(220),
      description TEXT,
      display_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS academic_years (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      year_value INTEGER NOT NULL UNIQUE,
      label VARCHAR(80),
      description TEXT,
      display_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS learning_goals JSONB,
      ADD COLUMN IF NOT EXISTS onboarding_payload JSONB,
      ADD COLUMN IF NOT EXISTS onboarding_step VARCHAR(40) DEFAULT 'academic_profile',
      ADD COLUMN IF NOT EXISTS batch_year INTEGER,
      ADD COLUMN IF NOT EXISTS course_name VARCHAR(120),
      ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES academic_colleges(id),
      ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academic_courses(id),
      ADD COLUMN IF NOT EXISTS year_id INTEGER REFERENCES academic_years(id),
      ADD COLUMN IF NOT EXISTS academic_scope JSONB DEFAULT '{}'::jsonb
  `);

  await pool.query(`
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES academic_colleges(id),
      ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academic_courses(id),
      ADD COLUMN IF NOT EXISTS year_id INTEGER REFERENCES academic_years(id)
  `);

  await pool.query(`
    ALTER TABLE previous_papers
      ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES academic_colleges(id),
      ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academic_courses(id),
      ADD COLUMN IF NOT EXISTS year_id INTEGER REFERENCES academic_years(id)
  `);

  await pool.query(`
    ALTER TABLE materials
      ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES academic_colleges(id),
      ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academic_courses(id),
      ADD COLUMN IF NOT EXISTS year_id INTEGER REFERENCES academic_years(id)
  `);

  await pool.query(`
    ALTER TABLE quizzes
      ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES academic_colleges(id),
      ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academic_courses(id),
      ADD COLUMN IF NOT EXISTS year_id INTEGER REFERENCES academic_years(id)
  `);

  await pool.query(`
    ALTER TABLE mock_tests
      ADD COLUMN IF NOT EXISTS college_id INTEGER REFERENCES academic_colleges(id),
      ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES academic_courses(id),
      ADD COLUMN IF NOT EXISTS year_id INTEGER REFERENCES academic_years(id)
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

router.get('/colleges', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, label, description, display_order
       FROM academic_colleges
       WHERE is_active = TRUE
       ORDER BY display_order ASC, name ASC`
    );
    setPublicCacheHeaders(res, 600);
    res.json({ colleges: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch colleges' });
  }
});

router.get('/courses', async (req, res) => {
  try {
    const collegeId = Number(req.query.collegeId);
    const params = [];
    const where = [];

    if (collegeId) {
      params.push(collegeId);
      where.push(`college_id = $${params.length}`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, college_id, code, name, label, description, display_order
       FROM academic_courses
       ${whereSql}
       WHERE is_active = TRUE
       ORDER BY display_order ASC, name ASC`,
      params
    );
    setPublicCacheHeaders(res, 600);
    res.json({ courses: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.get('/years', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, year_value, label, description, display_order
       FROM academic_years
       WHERE is_active = TRUE
       ORDER BY display_order ASC, year_value ASC`
    );
    setPublicCacheHeaders(res, 600);
    res.json({ years: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch years' });
  }
});

router.get('/admin/colleges', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, label, description, display_order, is_active
       FROM academic_colleges
       ORDER BY display_order ASC, name ASC`
    );
    res.json({ colleges: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch colleges' });
  }
});

router.post('/admin/colleges', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO academic_colleges (code, name, label, description, display_order, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, code, name, label, description, display_order, is_active`,
      [
        String(req.body.code || '').trim() || null,
        String(req.body.name || '').trim(),
        req.body.label || null,
        req.body.description || null,
        Number(req.body.displayOrder || 0),
        typeof req.body.isActive === 'undefined' ? true : Boolean(req.body.isActive),
        req.session.userId
      ]
    );
    res.status(201).json({ college: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create college' });
  }
});

router.put('/admin/colleges/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE academic_colleges
       SET code = COALESCE($1, code), name = COALESCE($2, name), label = COALESCE($3, label), description = COALESCE($4, description), display_order = COALESCE($5, display_order), is_active = COALESCE($6, is_active), updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, code, name, label, description, display_order, is_active`,
      [
        req.body.code ? String(req.body.code).trim() || null : null,
        req.body.name ? String(req.body.name).trim() : null,
        req.body.label || null,
        req.body.description || null,
        req.body.displayOrder ? Number(req.body.displayOrder) : null,
        typeof req.body.isActive === 'undefined' ? null : Boolean(req.body.isActive),
        id
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'College not found' });
    res.json({ college: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update college' });
  }
});

router.get('/admin/courses', requireAdmin, async (req, res) => {
  try {
    const collegeId = Number(req.query.collegeId);
    const params = [];
    const where = [];
    if (collegeId) {
      params.push(collegeId);
      where.push(`college_id = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT id, college_id, code, name, label, description, display_order, is_active
       FROM academic_courses
       ${whereSql}
       ORDER BY display_order ASC, name ASC`,
      params
    );
    res.json({ courses: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.post('/admin/courses', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO academic_courses (college_id, code, name, label, description, display_order, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, college_id, code, name, label, description, display_order, is_active`,
      [
        req.body.collegeId ? Number(req.body.collegeId) : null,
        String(req.body.code || '').trim() || null,
        String(req.body.name || '').trim(),
        req.body.label || null,
        req.body.description || null,
        Number(req.body.displayOrder || 0),
        typeof req.body.isActive === 'undefined' ? true : Boolean(req.body.isActive),
        req.session.userId
      ]
    );
    res.status(201).json({ course: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.put('/admin/courses/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE academic_courses
       SET college_id = COALESCE($1, college_id), code = COALESCE($2, code), name = COALESCE($3, name), label = COALESCE($4, label), description = COALESCE($5, description), display_order = COALESCE($6, display_order), is_active = COALESCE($7, is_active), updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING id, college_id, code, name, label, description, display_order, is_active`,
      [
        req.body.collegeId ? Number(req.body.collegeId) : null,
        req.body.code ? String(req.body.code).trim() || null : null,
        req.body.name ? String(req.body.name).trim() : null,
        req.body.label || null,
        req.body.description || null,
        req.body.displayOrder ? Number(req.body.displayOrder) : null,
        typeof req.body.isActive === 'undefined' ? null : Boolean(req.body.isActive),
        id
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Course not found' });
    res.json({ course: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update course' });
  }
});

router.get('/admin/years', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, year_value, label, description, display_order, is_active
       FROM academic_years
       ORDER BY display_order ASC, year_value ASC`
    );
    res.json({ years: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch years' });
  }
});

router.post('/admin/years', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO academic_years (year_value, label, description, display_order, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, year_value, label, description, display_order, is_active`,
      [Number(req.body.yearValue), req.body.label || null, req.body.description || null, Number(req.body.displayOrder || 0), typeof req.body.isActive === 'undefined' ? true : Boolean(req.body.isActive), req.session.userId]
    );
    res.status(201).json({ year: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create year' });
  }
});

router.put('/admin/years/:id', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `UPDATE academic_years
       SET year_value = COALESCE($1, year_value), label = COALESCE($2, label), description = COALESCE($3, description), display_order = COALESCE($4, display_order), is_active = COALESCE($5, is_active), updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, year_value, label, description, display_order, is_active`,
      [req.body.yearValue ? Number(req.body.yearValue) : null, req.body.label || null, req.body.description || null, req.body.displayOrder ? Number(req.body.displayOrder) : null, typeof req.body.isActive === 'undefined' ? null : Boolean(req.body.isActive), id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Year not found' });
    res.json({ year: rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update year' });
  }
});

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
    setPublicCacheHeaders(res, 600);
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
    setPublicCacheHeaders(res, 300);
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
    setPublicCacheHeaders(res, 600);
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

    setPublicCacheHeaders(res, 300);
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
      batchYear,
      courseName,
      collegeId,
      courseId,
      yearId,
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
        batch_year, course_name, college_id, course_id, year_id,
        target_exam, weak_subjects, career_interest, preferred_study_mode,
        learning_goals, onboarding_payload, onboarding_completed, onboarding_step, academic_scope, current_streak
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, TRUE, 'complete', $16::jsonb, 0)
      ON CONFLICT (user_id) DO UPDATE SET
        category_id = $2,
        branch_id = $3,
        semester_id = $4,
        batch_year = $5,
        course_name = $6,
        college_id = $7,
        course_id = $8,
        year_id = $9,
        target_exam = $10,
        weak_subjects = $11,
        career_interest = $12,
        preferred_study_mode = $13,
        learning_goals = $14,
        onboarding_payload = $15,
        onboarding_completed = TRUE,
        onboarding_step = 'complete',
        academic_scope = jsonb_build_object('categoryId', $2, 'branchId', $3, 'semesterId', $4, 'batchYear', $5, 'courseName', $6, 'collegeId', $7, 'courseId', $8, 'yearId', $9),
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, user_id, category_id, branch_id, semester_id, batch_year, course_name, college_id, course_id, year_id, onboarding_completed, onboarding_step`,
      [
        userId,
        categoryId,
        branchId,
        semesterId,
        Number(batchYear) || null,
        courseName || null,
        collegeId ? Number(collegeId) : null,
        courseId ? Number(courseId) : null,
        yearId ? Number(yearId) : null,
        targetExam || null,
        JSON.stringify(weakSubjects || []),
        careerInterest || null,
        preferredStudyMode || null,
        JSON.stringify(Array.isArray(learningGoals) ? learningGoals : []),
        onboardingPayload && typeof onboardingPayload === 'object' ? JSON.stringify(onboardingPayload) : JSON.stringify({}),
        JSON.stringify({ categoryId, branchId, semesterId, batchYear: Number(batchYear) || null, courseName: courseName || null, collegeId: collegeId ? Number(collegeId) : null, courseId: courseId ? Number(courseId) : null, yearId: yearId ? Number(yearId) : null })
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
        up.college_id, up.course_id, up.year_id, up.batch_year,
        up.target_exam, up.weak_subjects, up.career_interest, up.preferred_study_mode,
        up.learning_goals, up.onboarding_payload,
        up.onboarding_completed,
        ac.name as category_name, ac.label as category_label,
        ab.code as branch_code, ab.name as branch_name, ab.label as branch_label,
        asr.semester_number, asr.year_number, asr.label as semester_label,
        col.name as college_name, col.label as college_label,
        cou.name as course_name, cou.label as course_label,
        yr.label as year_label
       FROM user_profiles up
       LEFT JOIN academic_categories ac ON ac.id = up.category_id
       LEFT JOIN academic_branches ab ON ab.id = up.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = up.semester_id
       LEFT JOIN academic_colleges col ON col.id = up.college_id
       LEFT JOIN academic_courses cou ON cou.id = up.course_id
       LEFT JOIN academic_years yr ON yr.id = up.year_id
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
        collegeId: profile.college_id,
        courseId: profile.course_id,
        yearId: profile.year_id,
        batchYear: profile.batch_year,
        courseName: profile.course_name,
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
        onboardingStep: profile.onboarding_step || 'academic_profile',
        academicScope: profile.academic_scope || {},
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
        },
        college: {
          id: profile.college_id,
          name: profile.college_name,
          label: profile.college_label
        },
        course: {
          id: profile.course_id,
          name: profile.course_name,
          label: profile.course_label
        },
        year: {
          id: profile.year_id,
          yearValue: profile.batch_year,
          label: profile.year_label
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
      categoryId,
      branchId,
      semesterId,
      batchYear,
      courseName,
      targetExam,
      weakSubjects,
      learningGoals,
      careerInterest,
      preferredStudyMode,
      onboardingStep,
      academicScope,
      onboardingCompleted,
      collegeId,
      courseId,
      yearId
    } = req.body;

    const currentProfile = await pool.query(
      `SELECT category_id, onboarding_step FROM user_profiles WHERE user_id = $1`,
      [userId]
    );

    if (currentProfile.rowCount === 0) {
      return res.status(404).json({ error: 'Academic profile not found' });
    }

    const currentCategoryId = currentProfile.rows[0].category_id;
    const resolvedCategoryId = categoryId || currentCategoryId;

    // If branch is being changed, validate it belongs to the category
    if (branchId) {
      const branchCheck = await pool.query(
        `SELECT id FROM academic_branches
         WHERE id = $1 AND category_id = $2`,
        [branchId, resolvedCategoryId]
      );

      if (branchCheck.rowCount === 0) {
        return res.status(400).json({ error: 'Invalid branch for this category' });
      }
    }

    const nextOnboardingCompleted = Boolean(onboardingCompleted) || String(onboardingStep || '').toLowerCase() === 'complete';

    const updateResult = await pool.query(
      `UPDATE user_profiles SET
        category_id = COALESCE($2, category_id),
        branch_id = COALESCE($3, branch_id),
        semester_id = COALESCE($4, semester_id),
        batch_year = COALESCE($5, batch_year),
        course_name = COALESCE($6, course_name),
        target_exam = COALESCE($7, target_exam),
        weak_subjects = COALESCE($8, weak_subjects),
        career_interest = COALESCE($9, career_interest),
        preferred_study_mode = COALESCE($10, preferred_study_mode),
        learning_goals = COALESCE($11, learning_goals),
        onboarding_step = COALESCE($12, onboarding_step),
        academic_scope = COALESCE($13::jsonb, academic_scope),
        onboarding_completed = COALESCE($14, onboarding_completed),
        college_id = COALESCE($15, college_id),
        course_id = COALESCE($16, course_id),
        year_id = COALESCE($17, year_id),
        updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1
       RETURNING id, user_id, category_id, branch_id, semester_id, batch_year, course_name, onboarding_step, onboarding_completed`,
      [
        userId,
        categoryId || null,
        branchId || null,
        semesterId || null,
        batchYear || null,
        courseName || null,
        targetExam || null,
        weakSubjects ? JSON.stringify(weakSubjects) : null,
        careerInterest || null,
        preferredStudyMode || null,
        Array.isArray(learningGoals) ? JSON.stringify(learningGoals) : null,
        onboardingStep || currentProfile.rows[0].onboarding_step || null,
        academicScope ? JSON.stringify(academicScope) : null,
        nextOnboardingCompleted ? true : null,
        collegeId ? Number(collegeId) : null,
        courseId ? Number(courseId) : null,
        yearId ? Number(yearId) : null
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
