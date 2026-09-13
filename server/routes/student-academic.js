const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

function setPrivateCacheHeaders(res, maxAgeSeconds = 0) {
  if (maxAgeSeconds > 0) {
    res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}`);
  } else {
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  }
}

// 1. Get active selectable universities
router.get('/academic-options/universities', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, state, city, campus
       FROM universities
       WHERE (status = 'ACTIVE' OR status IS NULL)
         AND (is_enabled = TRUE OR is_enabled IS NULL)
       ORDER BY priority_rank ASC, display_order ASC, name ASC`
    );
    res.json({ universities: rows });
  } catch (err) {
    console.error('[Student Academic Options] Error fetching universities:', err);
    res.status(500).json({ error: 'Failed to fetch universities' });
  }
});

// 2. Get active courses scoped by University ID
router.get('/academic-options/courses', async (req, res) => {
  try {
    const universityId = parseInt(req.query.universityId, 10);
    if (!universityId || isNaN(universityId)) {
      return res.status(400).json({ error: 'Valid universityId parameter is required' });
    }

    // Verify university is active
    const uniCheck = await pool.query(
      `SELECT id FROM universities WHERE id = $1 AND (status = 'ACTIVE' OR status IS NULL)`,
      [universityId]
    );
    if (uniCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Selected university is not available or inactive' });
    }

    const { rows } = await pool.query(
      `SELECT id, university_id, code, name, department, degree_type, duration_years
       FROM courses
       WHERE university_id = $1 AND status = 'ACTIVE'
       ORDER BY display_order ASC, name ASC`,
      [universityId]
    );
    res.json({ universityId, courses: rows });
  } catch (err) {
    console.error('[Student Academic Options] Error fetching courses:', err);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// 3. Get active batches scoped by University ID & Course ID
router.get('/academic-options/batches', async (req, res) => {
  try {
    const universityId = parseInt(req.query.universityId, 10);
    const courseId = parseInt(req.query.courseId, 10);

    if (!universityId || isNaN(universityId) || !courseId || isNaN(courseId)) {
      return res.status(400).json({ error: 'Valid universityId and courseId parameters are required' });
    }

    // Validate course belongs to university
    const courseCheck = await pool.query(
      `SELECT id FROM courses WHERE id = $1 AND university_id = $2 AND status = 'ACTIVE'`,
      [courseId, universityId]
    );
    if (courseCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected course does not belong to the specified university' });
    }

    const { rows } = await pool.query(
      `SELECT id, university_id, course_id, name, start_year, end_year
       FROM batches
       WHERE university_id = $1 AND course_id = $2 AND status = 'ACTIVE'
       ORDER BY start_year DESC, display_order ASC, name ASC`,
      [universityId, courseId]
    );
    res.json({ universityId, courseId, batches: rows });
  } catch (err) {
    console.error('[Student Academic Options] Error fetching batches:', err);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// 4. Get Student Academic Profile completion status & details
router.get('/academic-profile/status', requireAuth, async (req, res) => {
  try {
    const studentId = req.session.userId;
    setPrivateCacheHeaders(res, 0);

    const { rows } = await pool.query(
      `SELECT sap.id, sap.university_id, sap.course_id, sap.batch_id, sap.profile_completed_at,
              u.name AS university_name, u.code AS university_code,
              c.name AS course_name, c.code AS course_code, c.degree_type,
              b.name AS batch_name, b.start_year, b.end_year
       FROM student_academic_profiles sap
       JOIN universities u ON u.id = sap.university_id
       JOIN courses c ON c.id = sap.course_id
       JOIN batches b ON b.id = sap.batch_id
       WHERE sap.student_id = $1`,
      [studentId]
    );

    if (rows.length === 0) {
      return res.json({
        isComplete: false,
        profile: null
      });
    }

    const p = rows[0];
    res.json({
      isComplete: true,
      profile: {
        id: p.id,
        universityId: p.university_id,
        universityName: p.university_name,
        universityCode: p.university_code,
        courseId: p.course_id,
        courseName: p.course_name,
        courseCode: p.course_code,
        degreeType: p.degree_type,
        batchId: p.batch_id,
        batchName: p.batch_name,
        startYear: p.start_year,
        endYear: p.end_year,
        completedAt: p.profile_completed_at
      }
    });
  } catch (err) {
    console.error('[Student Academic Profile] Error checking status:', err);
    res.status(500).json({ error: 'Failed to retrieve profile status' });
  }
});

// 5. Submit & complete Student Academic Profile setup
router.post('/academic-profile', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const studentId = req.session.userId;
    if (!studentId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Ensure user account is active / not suspended
    const userRes = await client.query(`SELECT id, role, is_suspended FROM users WHERE id = $1`, [studentId]);
    if (userRes.rows.length === 0 || userRes.rows[0].is_suspended) {
      return res.status(403).json({ error: 'Account is suspended or invalid' });
    }

    // Extract permitted body parameters ONLY (prevent mass assignment of roles, permissions, status)
    const universityId = parseInt(req.body.universityId, 10);
    const courseId = parseInt(req.body.courseId, 10);
    const batchId = parseInt(req.body.batchId, 10);

    if (!universityId || isNaN(universityId) || !courseId || isNaN(courseId) || !batchId || isNaN(batchId)) {
      return res.status(400).json({ error: 'All fields (universityId, courseId, batchId) are required' });
    }

    // 1. Validate University is ACTIVE
    const uniCheck = await client.query(
      `SELECT id, name FROM universities WHERE id = $1 AND (status = 'ACTIVE' OR status IS NULL)`,
      [universityId]
    );
    if (uniCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected university is invalid or inactive' });
    }
    const universityName = uniCheck.rows[0].name;

    // 2. Validate Course belongs to University and is ACTIVE
    const courseCheck = await client.query(
      `SELECT id, name FROM courses WHERE id = $1 AND university_id = $2 AND status = 'ACTIVE'`,
      [courseId, universityId]
    );
    if (courseCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected course does not belong to the specified university or is inactive' });
    }
    const courseName = courseCheck.rows[0].name;

    // 3. Validate Batch belongs to Course & University and is ACTIVE
    const batchCheck = await client.query(
      `SELECT id, name FROM batches WHERE id = $1 AND course_id = $2 AND university_id = $3 AND status = 'ACTIVE'`,
      [batchId, courseId, universityId]
    );
    if (batchCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected batch does not match the chosen course/university' });
    }
    const batchName = batchCheck.rows[0].name;

    // Atomic DB Transaction to save profile and complete onboarding
    await client.query('BEGIN');

    // Upsert into student_academic_profiles
    const profResult = await client.query(
      `INSERT INTO student_academic_profiles (student_id, university_id, course_id, batch_id, profile_completed_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (student_id) DO UPDATE SET
         university_id = EXCLUDED.university_id,
         course_id = EXCLUDED.course_id,
         batch_id = EXCLUDED.batch_id,
         profile_completed_at = NOW(),
         updated_at = NOW()
       RETURNING id, profile_completed_at`,
      [studentId, universityId, courseId, batchId]
    );

    // Sync user_profiles table for global system compatibility
    // Note: user_profiles.college_id and user_profiles.course_id have FKs to legacy academic_colleges/academic_courses.
    const collegeFkCheck = await client.query(`SELECT id FROM academic_colleges WHERE id = $1`, [universityId]);
    const safeCollegeId = collegeFkCheck.rows.length > 0 ? universityId : null;

    const courseFkCheck = await client.query(`SELECT id FROM academic_courses WHERE id = $1`, [courseId]);
    const safeCourseId = courseFkCheck.rows.length > 0 ? courseId : null;

    await client.query(
      `INSERT INTO user_profiles (user_id, college_id, course_id, onboarding_completed, onboarding_step, course_name)
       VALUES ($1, $2, $3, true, 'complete', $4)
       ON CONFLICT (user_id) DO UPDATE SET
         college_id = COALESCE(EXCLUDED.college_id, user_profiles.college_id),
         course_id = COALESCE(EXCLUDED.course_id, user_profiles.course_id),
         onboarding_completed = true,
         onboarding_step = 'complete',
         course_name = EXCLUDED.course_name,
         updated_at = NOW()`,
      [studentId, safeCollegeId, safeCourseId, courseName]
    );

    await client.query('COMMIT');

    // Record audit log event asynchronously after commit
    pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'ACADEMIC_PROFILE_COMPLETED', 'student_academic_profile', $2, $3)`,
      [studentId, profResult.rows[0].id, JSON.stringify({ universityId, courseId, batchId, universityName, courseName, batchName })]
    ).catch(() => {});

    res.json({
      success: true,
      message: 'Academic profile setup completed successfully',
      redirectUrl: '/dashboard',
      profile: {
        universityId,
        universityName,
        courseId,
        courseName,
        batchId,
        batchName,
        completedAt: profResult.rows[0].profile_completed_at
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Student Academic Profile] Error completing profile:', err);
    res.status(500).json({ error: 'Failed to save academic profile. Please try again.' });
  } finally {
    client.release();
  }
});

// ============================================
// STUDENT STUDY MATERIALS LIBRARY ENDPOINTS
// ============================================

// 6. Get Categories for Materials Library
router.get('/library/materials/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, description FROM academic_categories ORDER BY display_order ASC, name ASC`
    );
    res.json({ categories: rows });
  } catch (err) {
    console.error('[Student Materials] Categories fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch material categories' });
  }
});

// 7. Get Semesters for Materials Library
router.get('/library/materials/semesters', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, label, number FROM academic_semesters ORDER BY number ASC`
    );
    res.json({ semesters: rows });
  } catch (err) {
    console.error('[Student Materials] Semesters fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch material semesters' });
  }
});

// 8. Get Branches for Materials Library
router.get('/library/materials/branches', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, code FROM academic_branches ORDER BY display_order ASC, name ASC`
    );
    res.json({ branches: rows });
  } catch (err) {
    console.error('[Student Materials] Branches fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch material branches' });
  }
});

// 9. Fetch Published Materials for Students
router.get('/library/materials', async (req, res) => {
  try {
    const { type, categoryId, branchId, semesterId, search } = req.query;
    const params = [];
    const clauses = ["m.deleted_at IS NULL", "COALESCE(m.status, 'published') = 'published'"];

    if (type && type !== 'all') {
      params.push(String(type).trim().toLowerCase());
      clauses.push(`(LOWER(COALESCE(m.material_type, m.category)) = $${params.length})`);
    }

    if (categoryId) {
      params.push(Number(categoryId));
      clauses.push(`m.category_id = $${params.length}`);
    }

    if (branchId) {
      params.push(Number(branchId));
      clauses.push(`(m.branch_id = $${params.length} OR m.is_common = TRUE)`);
    }

    if (semesterId) {
      params.push(Number(semesterId));
      clauses.push(`(m.semester_id = $${params.length} OR m.semester_id IS NULL)`);
    }

    if (search) {
      params.push(`%${String(search).trim().toLowerCase()}%`);
      clauses.push(`(LOWER(m.title) LIKE $${params.length} OR LOWER(COALESCE(m.subject, '')) LIKE $${params.length} OR LOWER(COALESCE(m.description, '')) LIKE $${params.length})`);
    }

    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
        m.id,
        m.title,
        COALESCE(m.material_type, 'book') AS material_type,
        m.category,
        m.subject,
        m.description,
        m.file_url,
        m.access_type,
        (m.access_type = 'premium') AS is_premium,
        m.is_common,
        m.created_at,
        ac.name AS category_name,
        ab.name AS branch_name,
        asem.label AS semester_label
       FROM materials m
       LEFT JOIN academic_categories ac ON ac.id = m.category_id
       LEFT JOIN academic_branches ab ON ab.id = m.branch_id
       LEFT JOIN academic_semesters asem ON asem.id = m.semester_id
       ${whereClause}
       ORDER BY m.created_at DESC
       LIMIT 100`,
      params
    );

    res.json({ materials: rows, count: rows.length });
  } catch (err) {
    console.error('[Student Materials] Library query error:', err);
    res.status(500).json({ error: 'Failed to fetch student materials library' });
  }
});

module.exports = router;
