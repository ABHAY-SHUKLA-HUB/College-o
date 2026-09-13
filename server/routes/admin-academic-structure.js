const express = require('express');
const router = express.Router();
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { logSecurityEvent } = require('../middleware/auditLog');

async function writeAuditLog(req, action, entityType, entityId, details = {}) {
  try {
    await logSecurityEvent(String(action || 'ADMIN_ACTION').toUpperCase().replace(/\./g, '_'), {
      userId: req.session?.userId,
      ip: req.ip,
      entityType,
      entityId,
      ...details
    });
  } catch (err) {
    console.warn('[AuditLog] Failed to record action:', err.message);
  }
}

function toInt(val, fallback = null) {
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// ============================================================
// 1. ACADEMIC STRUCTURE OVERVIEW & CONFIG HEALTH
// ============================================================
router.get('/overview', requireAdmin, async (req, res) => {
  try {
    const [uniRes, courseRes, batchRes, assignedRes, missingRes, previewRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM universities WHERE status = 'ACTIVE' OR status IS NULL`),
      pool.query(`SELECT COUNT(*)::int AS count FROM courses WHERE status = 'ACTIVE'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM batches WHERE status = 'ACTIVE'`),
      pool.query(`SELECT COUNT(*)::int AS count FROM student_academic_profiles WHERE profile_completed_at IS NOT NULL`),
      pool.query(`
        SELECT COUNT(u.id)::int AS count
        FROM users u
        LEFT JOIN student_academic_profiles sap ON sap.student_id = u.id
        WHERE u.role = 'student' AND (sap.id IS NULL OR sap.profile_completed_at IS NULL)
      `),
      pool.query(`
        SELECT 
          u.id AS university_id, u.name AS university_name, u.code AS university_code, u.status AS university_status,
          c.id AS course_id, c.name AS course_name, c.code AS course_code, c.status AS course_status,
          b.id AS batch_id, b.name AS batch_name, b.status AS batch_status
        FROM universities u
        LEFT JOIN courses c ON c.university_id = u.id AND c.status = 'ACTIVE'
        LEFT JOIN batches b ON b.course_id = c.id AND b.status = 'ACTIVE'
        WHERE u.status = 'ACTIVE' OR u.status IS NULL
        ORDER BY u.priority_rank ASC, u.name ASC, c.display_order ASC, c.name ASC, b.start_year DESC
      `)
    ]);

    const activeUniversities = uniRes.rows[0]?.count || 0;
    const activeCourses = courseRes.rows[0]?.count || 0;
    const activeBatches = batchRes.rows[0]?.count || 0;
    const studentsAssigned = assignedRes.rows[0]?.count || 0;
    const studentsMissingProfile = missingRes.rows[0]?.count || 0;

    // Check Configuration Health Alerts
    const healthAlerts = [];

    if (activeUniversities === 0) {
      healthAlerts.push({
        severity: 'CRITICAL',
        message: 'No active universities configured. New students cannot complete academic setup!'
      });
    }

    // Check for Active Universities with 0 active courses
    const uniNoCourseRes = await pool.query(`
      SELECT u.id, u.name 
      FROM universities u
      LEFT JOIN courses c ON c.university_id = u.id AND c.status = 'ACTIVE'
      WHERE (u.status = 'ACTIVE' OR u.status IS NULL)
      GROUP BY u.id, u.name
      HAVING COUNT(c.id) = 0
    `);

    for (const u of uniNoCourseRes.rows) {
      healthAlerts.push({
        severity: 'WARNING',
        message: `University "${u.name}" has no active courses configured. Students selecting this university cannot finish setup.`
      });
    }

    // Check for Active Courses with 0 active batches
    const courseNoBatchRes = await pool.query(`
      SELECT c.id, c.name AS course_name, u.name AS university_name
      FROM courses c
      JOIN universities u ON u.id = c.university_id
      LEFT JOIN batches b ON b.course_id = c.id AND b.status = 'ACTIVE'
      WHERE c.status = 'ACTIVE' AND (u.status = 'ACTIVE' OR u.status IS NULL)
      GROUP BY c.id, c.name, u.name
      HAVING COUNT(b.id) = 0
    `);

    for (const c of courseNoBatchRes.rows) {
      healthAlerts.push({
        severity: 'WARNING',
        message: `Course "${c.course_name}" under ${c.university_name} has no active batches configured.`
      });
    }

    // Process preview tree
    const universityMap = new Map();
    for (const row of previewRes.rows) {
      if (!universityMap.has(row.university_id)) {
        universityMap.set(row.university_id, {
          id: row.university_id,
          name: row.university_name,
          code: row.university_code,
          courses: []
        });
      }
      const u = universityMap.get(row.university_id);
      if (row.course_id) {
        let course = u.courses.find(c => c.id === row.course_id);
        if (!course) {
          course = {
            id: row.course_id,
            name: row.course_name,
            code: row.course_code,
            batches: []
          };
          u.courses.push(course);
        }
        if (row.batch_id) {
          course.batches.push({
            id: row.batch_id,
            name: row.batch_name
          });
        }
      }
    }

    res.json({
      success: true,
      stats: {
        activeUniversities,
        activeCourses,
        activeBatches,
        studentsAssigned,
        studentsMissingProfile
      },
      healthAlerts,
      onboardingPreview: Array.from(universityMap.values())
    });
  } catch (err) {
    console.error('[Admin Academic Structure] Error fetching overview:', err);
    res.status(500).json({ error: 'Failed to fetch academic structure overview' });
  }
});

// ============================================================
// 2. UNIVERSITY MANAGEMENT (CRUD & STATUS)
// ============================================================
router.get('/universities', requireAdmin, async (req, res) => {
  try {
    const statusFilter = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim();

    let whereConditions = [];
    let params = [];
    let idx = 1;

    if (statusFilter && statusFilter !== 'ALL') {
      whereConditions.push(`(u.status = $${idx++})`);
      params.push(statusFilter);
    }

    if (search) {
      whereConditions.push(`(u.name ILIKE $${idx} OR u.code ILIKE $${idx} OR u.short_name ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        u.id, u.code, u.name, u.short_name, u.country_code, u.state, u.city, u.campus,
        u.is_featured, u.is_enabled, u.status, u.priority_rank, u.display_order, u.logo_url,
        u.created_at, u.updated_at,
        COUNT(DISTINCT c.id)::int AS courses_count,
        COUNT(DISTINCT sap.id)::int AS students_count
      FROM universities u
      LEFT JOIN courses c ON c.university_id = u.id
      LEFT JOIN student_academic_profiles sap ON sap.university_id = u.id
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.priority_rank ASC, u.display_order ASC, u.name ASC
    `;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, universities: rows });
  } catch (err) {
    console.error('[Admin Academic Structure] Error listing universities:', err);
    res.status(500).json({ error: 'Failed to fetch universities' });
  }
});

router.post('/universities', requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toUpperCase();
    const shortName = String(req.body.shortName || req.body.short_name || '').trim() || null;
    const state = String(req.body.state || '').trim() || null;
    const city = String(req.body.city || '').trim() || null;
    const campus = String(req.body.campus || '').trim() || null;
    const status = String(req.body.status || 'ACTIVE').trim().toUpperCase();
    const priorityRank = toInt(req.body.priorityRank || req.body.priority_rank, 99);
    const displayOrder = toInt(req.body.displayOrder || req.body.display_order, 0);
    const logoUrl = String(req.body.logoUrl || req.body.logo_url || '').trim() || null;
    const isFeatured = req.body.isFeatured !== undefined ? Boolean(req.body.isFeatured) : true;
    const isEnabled = req.body.isEnabled !== undefined ? Boolean(req.body.isEnabled) : true;

    if (!name || !code) {
      return res.status(400).json({ error: 'University Name and Stable Code are required' });
    }

    // Check code uniqueness
    const codeCheck = await pool.query(`SELECT id FROM universities WHERE code = $1`, [code]);
    if (codeCheck.rows.length > 0) {
      return res.status(400).json({ error: `University with code "${code}" already exists` });
    }

    const { rows } = await pool.query(
      `INSERT INTO universities (
        name, code, short_name, state, city, campus, status,
        priority_rank, display_order, logo_url, is_featured, is_enabled, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
      RETURNING *`,
      [name, code, shortName, state, city, campus, status, priorityRank, displayOrder, logoUrl, isFeatured, isEnabled, req.session.userId]
    );

    const university = rows[0];
    await writeAuditLog(req, 'UNIVERSITY_CREATED', 'universities', university.id, { name, code, status });

    res.status(201).json({ success: true, message: 'University created successfully', university });
  } catch (err) {
    console.error('[Admin Academic Structure] Error creating university:', err);
    res.status(500).json({ error: 'Failed to create university' });
  }
});

router.put('/universities/:id', requireAdmin, async (req, res) => {
  try {
    const universityId = toInt(req.params.id);
    if (!universityId) return res.status(400).json({ error: 'Invalid university ID' });

    const existingRes = await pool.query(`SELECT * FROM universities WHERE id = $1`, [universityId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'University not found' });
    }
    const existing = existingRes.rows[0];

    const name = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
    const code = req.body.code !== undefined ? String(req.body.code).trim().toUpperCase() : existing.code;
    const shortName = req.body.shortName !== undefined ? String(req.body.shortName).trim() || null : existing.short_name;
    const state = req.body.state !== undefined ? String(req.body.state).trim() || null : existing.state;
    const city = req.body.city !== undefined ? String(req.body.city).trim() || null : existing.city;
    const campus = req.body.campus !== undefined ? String(req.body.campus).trim() || null : existing.campus;
    const status = req.body.status !== undefined ? String(req.body.status).trim().toUpperCase() : existing.status;
    const priorityRank = req.body.priorityRank !== undefined ? toInt(req.body.priorityRank, existing.priority_rank) : existing.priority_rank;
    const displayOrder = req.body.displayOrder !== undefined ? toInt(req.body.displayOrder, existing.display_order) : existing.display_order;
    const logoUrl = req.body.logoUrl !== undefined ? String(req.body.logoUrl).trim() || null : existing.logo_url;
    const isFeatured = req.body.isFeatured !== undefined ? Boolean(req.body.isFeatured) : existing.is_featured;
    const isEnabled = req.body.isEnabled !== undefined ? Boolean(req.body.isEnabled) : existing.is_enabled;

    if (!name || !code) {
      return res.status(400).json({ error: 'University Name and Code are required' });
    }

    // Check code uniqueness if code changed
    if (code !== existing.code) {
      const codeCheck = await pool.query(`SELECT id FROM universities WHERE code = $1 AND id != $2`, [code, universityId]);
      if (codeCheck.rows.length > 0) {
        return res.status(400).json({ error: `University with code "${code}" already exists` });
      }
    }

    const { rows } = await pool.query(
      `UPDATE universities SET
        name = $1, code = $2, short_name = $3, state = $4, city = $5, campus = $6,
        status = $7, priority_rank = $8, display_order = $9, logo_url = $10,
        is_featured = $11, is_enabled = $12, updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [name, code, shortName, state, city, campus, status, priorityRank, displayOrder, logoUrl, isFeatured, isEnabled, universityId]
    );

    const university = rows[0];
    await writeAuditLog(req, 'UNIVERSITY_UPDATED', 'universities', universityId, { name, code, status });

    res.json({ success: true, message: 'University updated successfully', university });
  } catch (err) {
    console.error('[Admin Academic Structure] Error updating university:', err);
    res.status(500).json({ error: 'Failed to update university' });
  }
});

router.delete('/universities/:id', requireAdmin, async (req, res) => {
  try {
    const universityId = toInt(req.params.id);
    if (!universityId) return res.status(400).json({ error: 'Invalid university ID' });

    // Check if referenced by students or courses
    const [studCheck, courseCheck] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM student_academic_profiles WHERE university_id = $1`, [universityId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM courses WHERE university_id = $1`, [universityId])
    ]);

    const studentCount = studCheck.rows[0]?.count || 0;
    const courseCount = courseCheck.rows[0]?.count || 0;

    if (studentCount > 0 || courseCount > 0) {
      return res.status(400).json({
        error: `Cannot hard-delete university referenced by ${studentCount} student(s) and ${courseCount} course(s). Please change status to INACTIVE or ARCHIVED instead.`
      });
    }

    // Safe delete if unused
    await pool.query(`DELETE FROM universities WHERE id = $1`, [universityId]);
    await writeAuditLog(req, 'UNIVERSITY_DELETED', 'universities', universityId);

    res.json({ success: true, message: 'Unused university deleted successfully' });
  } catch (err) {
    console.error('[Admin Academic Structure] Error deleting university:', err);
    res.status(500).json({ error: 'Failed to delete university' });
  }
});

// ============================================================
// 3. COURSE MANAGEMENT (CRUD & STATUS)
// ============================================================
router.get('/courses', requireAdmin, async (req, res) => {
  try {
    const universityId = toInt(req.query.universityId);
    const statusFilter = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim();

    let whereConditions = [];
    let params = [];
    let idx = 1;

    if (universityId) {
      whereConditions.push(`c.university_id = $${idx++}`);
      params.push(universityId);
    }

    if (statusFilter && statusFilter !== 'ALL') {
      whereConditions.push(`c.status = $${idx++}`);
      params.push(statusFilter);
    }

    if (search) {
      whereConditions.push(`(c.name ILIKE $${idx} OR c.code ILIKE $${idx} OR u.name ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        c.id, c.university_id, u.name AS university_name, u.code AS university_code,
        c.code, c.name, c.degree_type, c.duration_years, c.status, c.display_order,
        c.created_at, c.updated_at,
        COUNT(DISTINCT b.id)::int AS batches_count,
        COUNT(DISTINCT sap.id)::int AS students_count
      FROM courses c
      JOIN universities u ON u.id = c.university_id
      LEFT JOIN batches b ON b.course_id = c.id
      LEFT JOIN student_academic_profiles sap ON sap.course_id = c.id
      ${whereClause}
      GROUP BY c.id, u.name, u.code
      ORDER BY u.name ASC, c.display_order ASC, c.name ASC
    `;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, courses: rows });
  } catch (err) {
    console.error('[Admin Academic Structure] Error listing courses:', err);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

router.post('/courses', requireAdmin, async (req, res) => {
  try {
    const universityId = toInt(req.body.universityId || req.body.university_id);
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toUpperCase();
    const degreeType = String(req.body.degreeType || req.body.degree_type || '').trim() || null;
    const durationYears = toInt(req.body.durationYears || req.body.duration_years, 4);
    const status = String(req.body.status || 'ACTIVE').trim().toUpperCase();
    const displayOrder = toInt(req.body.displayOrder || req.body.display_order, 0);

    if (!universityId || !name || !code) {
      return res.status(400).json({ error: 'University ID, Course Name, and Course Code are required' });
    }

    // Verify university exists
    const uniCheck = await pool.query(`SELECT id, name FROM universities WHERE id = $1`, [universityId]);
    if (uniCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Selected university does not exist' });
    }

    // Check code uniqueness under university
    const codeCheck = await pool.query(`SELECT id FROM courses WHERE university_id = $1 AND code = $2`, [universityId, code]);
    if (codeCheck.rows.length > 0) {
      return res.status(400).json({ error: `Course code "${code}" already exists under this university` });
    }

    const { rows } = await pool.query(
      `INSERT INTO courses (
        university_id, code, name, degree_type, duration_years, status, display_order, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *`,
      [universityId, code, name, degreeType, durationYears, status, displayOrder]
    );

    const course = rows[0];
    await writeAuditLog(req, 'COURSE_CREATED', 'courses', course.id, { universityId, name, code, status });

    res.status(201).json({ success: true, message: 'Course created successfully', course });
  } catch (err) {
    console.error('[Admin Academic Structure] Error creating course:', err);
    res.status(500).json({ error: 'Failed to create course' });
  }
});

router.put('/courses/:id', requireAdmin, async (req, res) => {
  try {
    const courseId = toInt(req.params.id);
    if (!courseId) return res.status(400).json({ error: 'Invalid course ID' });

    const existingRes = await pool.query(`SELECT * FROM courses WHERE id = $1`, [courseId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const existing = existingRes.rows[0];

    const universityId = req.body.universityId !== undefined ? toInt(req.body.universityId, existing.university_id) : existing.university_id;
    const name = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
    const code = req.body.code !== undefined ? String(req.body.code).trim().toUpperCase() : existing.code;
    const degreeType = req.body.degreeType !== undefined ? String(req.body.degreeType).trim() || null : existing.degree_type;
    const durationYears = req.body.durationYears !== undefined ? toInt(req.body.durationYears, existing.duration_years) : existing.duration_years;
    const status = req.body.status !== undefined ? String(req.body.status).trim().toUpperCase() : existing.status;
    const displayOrder = req.body.displayOrder !== undefined ? toInt(req.body.displayOrder, existing.display_order) : existing.display_order;

    if (!universityId || !name || !code) {
      return res.status(400).json({ error: 'University ID, Course Name, and Course Code are required' });
    }

    // Verify university exists
    const uniCheck = await pool.query(`SELECT id FROM universities WHERE id = $1`, [universityId]);
    if (uniCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Selected university does not exist' });
    }

    // Check code uniqueness under university if changed
    if (code !== existing.code || universityId !== existing.university_id) {
      const codeCheck = await pool.query(`SELECT id FROM courses WHERE university_id = $1 AND code = $2 AND id != $3`, [universityId, code, courseId]);
      if (codeCheck.rows.length > 0) {
        return res.status(400).json({ error: `Course code "${code}" already exists under the target university` });
      }
    }

    const { rows } = await pool.query(
      `UPDATE courses SET
        university_id = $1, code = $2, name = $3, degree_type = $4,
        duration_years = $5, status = $6, display_order = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [universityId, code, name, degreeType, durationYears, status, displayOrder, courseId]
    );

    const course = rows[0];
    await writeAuditLog(req, 'COURSE_UPDATED', 'courses', courseId, { universityId, name, code, status });

    res.json({ success: true, message: 'Course updated successfully', course });
  } catch (err) {
    console.error('[Admin Academic Structure] Error updating course:', err);
    res.status(500).json({ error: 'Failed to update course' });
  }
});

router.delete('/courses/:id', requireAdmin, async (req, res) => {
  try {
    const courseId = toInt(req.params.id);
    if (!courseId) return res.status(400).json({ error: 'Invalid course ID' });

    const [studCheck, batchCheck] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS count FROM student_academic_profiles WHERE course_id = $1`, [courseId]),
      pool.query(`SELECT COUNT(*)::int AS count FROM batches WHERE course_id = $1`, [courseId])
    ]);

    const studentCount = studCheck.rows[0]?.count || 0;
    const batchCount = batchCheck.rows[0]?.count || 0;

    if (studentCount > 0 || batchCount > 0) {
      return res.status(400).json({
        error: `Cannot hard-delete course referenced by ${studentCount} student(s) and ${batchCount} batch(es). Please change status to INACTIVE or ARCHIVED instead.`
      });
    }

    await pool.query(`DELETE FROM courses WHERE id = $1`, [courseId]);
    await writeAuditLog(req, 'COURSE_DELETED', 'courses', courseId);

    res.json({ success: true, message: 'Unused course deleted successfully' });
  } catch (err) {
    console.error('[Admin Academic Structure] Error deleting course:', err);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// ============================================================
// 4. BATCH MANAGEMENT (CRUD & DEPENDENT MAPPING)
// ============================================================
router.get('/batches', requireAdmin, async (req, res) => {
  try {
    const universityId = toInt(req.query.universityId);
    const courseId = toInt(req.query.courseId);
    const statusFilter = String(req.query.status || '').trim().toUpperCase();
    const search = String(req.query.search || '').trim();

    let whereConditions = [];
    let params = [];
    let idx = 1;

    if (universityId) {
      whereConditions.push(`b.university_id = $${idx++}`);
      params.push(universityId);
    }

    if (courseId) {
      whereConditions.push(`b.course_id = $${idx++}`);
      params.push(courseId);
    }

    if (statusFilter && statusFilter !== 'ALL') {
      whereConditions.push(`b.status = $${idx++}`);
      params.push(statusFilter);
    }

    if (search) {
      whereConditions.push(`(b.name ILIKE $${idx} OR c.name ILIKE $${idx} OR u.name ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `
      SELECT 
        b.id, b.university_id, u.name AS university_name, u.code AS university_code,
        b.course_id, c.name AS course_name, c.code AS course_code,
        b.name, b.start_year, b.end_year, b.status, b.display_order,
        b.created_at, b.updated_at,
        COUNT(DISTINCT sap.id)::int AS students_count
      FROM batches b
      JOIN universities u ON u.id = b.university_id
      JOIN courses c ON c.id = b.course_id
      LEFT JOIN student_academic_profiles sap ON sap.batch_id = b.id
      ${whereClause}
      GROUP BY b.id, u.name, u.code, c.name, c.code
      ORDER BY b.start_year DESC, b.display_order ASC, b.name ASC
    `;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, batches: rows });
  } catch (err) {
    console.error('[Admin Academic Structure] Error listing batches:', err);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

router.post('/batches', requireAdmin, async (req, res) => {
  try {
    const universityId = toInt(req.body.universityId || req.body.university_id);
    const courseId = toInt(req.body.courseId || req.body.course_id);
    const name = String(req.body.name || '').trim();
    const startYear = toInt(req.body.startYear || req.body.start_year, new Date().getFullYear());
    const endYear = toInt(req.body.endYear || req.body.end_year);
    const status = String(req.body.status || 'ACTIVE').trim().toUpperCase();
    const displayOrder = toInt(req.body.displayOrder || req.body.display_order, 0);

    if (!universityId || !courseId || !name) {
      return res.status(400).json({ error: 'University ID, Course ID, and Batch Name are required' });
    }

    // Validate course belongs to specified university
    const courseCheck = await pool.query(`SELECT id FROM courses WHERE id = $1 AND university_id = $2`, [courseId, universityId]);
    if (courseCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected course does not belong to the specified university' });
    }

    // Check batch name uniqueness under course
    const nameCheck = await pool.query(`SELECT id FROM batches WHERE course_id = $1 AND name = $2`, [courseId, name]);
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({ error: `Batch "${name}" already exists under this course` });
    }

    const { rows } = await pool.query(
      `INSERT INTO batches (
        university_id, course_id, name, start_year, end_year, status, display_order, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *`,
      [universityId, courseId, name, startYear, endYear || (startYear + 4), status, displayOrder]
    );

    const batch = rows[0];
    await writeAuditLog(req, 'BATCH_CREATED', 'batches', batch.id, { universityId, courseId, name, status });

    res.status(201).json({ success: true, message: 'Batch created successfully', batch });
  } catch (err) {
    console.error('[Admin Academic Structure] Error creating batch:', err);
    res.status(500).json({ error: 'Failed to create batch' });
  }
});

router.put('/batches/:id', requireAdmin, async (req, res) => {
  try {
    const batchId = toInt(req.params.id);
    if (!batchId) return res.status(400).json({ error: 'Invalid batch ID' });

    const existingRes = await pool.query(`SELECT * FROM batches WHERE id = $1`, [batchId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    const existing = existingRes.rows[0];

    const universityId = req.body.universityId !== undefined ? toInt(req.body.universityId, existing.university_id) : existing.university_id;
    const courseId = req.body.courseId !== undefined ? toInt(req.body.courseId, existing.course_id) : existing.course_id;
    const name = req.body.name !== undefined ? String(req.body.name).trim() : existing.name;
    const startYear = req.body.startYear !== undefined ? toInt(req.body.startYear, existing.start_year) : existing.start_year;
    const endYear = req.body.endYear !== undefined ? toInt(req.body.endYear, existing.end_year) : existing.end_year;
    const status = req.body.status !== undefined ? String(req.body.status).trim().toUpperCase() : existing.status;
    const displayOrder = req.body.displayOrder !== undefined ? toInt(req.body.displayOrder, existing.display_order) : existing.display_order;

    if (!universityId || !courseId || !name) {
      return res.status(400).json({ error: 'University ID, Course ID, and Batch Name are required' });
    }

    // Validate course belongs to specified university
    const courseCheck = await pool.query(`SELECT id FROM courses WHERE id = $1 AND university_id = $2`, [courseId, universityId]);
    if (courseCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected course does not belong to the specified university' });
    }

    // Check uniqueness if name or course changed
    if (name !== existing.name || courseId !== existing.course_id) {
      const nameCheck = await pool.query(`SELECT id FROM batches WHERE course_id = $1 AND name = $2 AND id != $3`, [courseId, name, batchId]);
      if (nameCheck.rows.length > 0) {
        return res.status(400).json({ error: `Batch "${name}" already exists under this course` });
      }
    }

    const { rows } = await pool.query(
      `UPDATE batches SET
        university_id = $1, course_id = $2, name = $3, start_year = $4,
        end_year = $5, status = $6, display_order = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [universityId, courseId, name, startYear, endYear, status, displayOrder, batchId]
    );

    const batch = rows[0];
    await writeAuditLog(req, 'BATCH_UPDATED', 'batches', batchId, { universityId, courseId, name, status });

    res.json({ success: true, message: 'Batch updated successfully', batch });
  } catch (err) {
    console.error('[Admin Academic Structure] Error updating batch:', err);
    res.status(500).json({ error: 'Failed to update batch' });
  }
});

router.delete('/batches/:id', requireAdmin, async (req, res) => {
  try {
    const batchId = toInt(req.params.id);
    if (!batchId) return res.status(400).json({ error: 'Invalid batch ID' });

    const studCheck = await pool.query(`SELECT COUNT(*)::int AS count FROM student_academic_profiles WHERE batch_id = $1`, [batchId]);
    const studentCount = studCheck.rows[0]?.count || 0;

    if (studentCount > 0) {
      return res.status(400).json({
        error: `Cannot hard-delete batch referenced by ${studentCount} student(s). Please change status to INACTIVE or ARCHIVED instead.`
      });
    }

    await pool.query(`DELETE FROM batches WHERE id = $1`, [batchId]);
    await writeAuditLog(req, 'BATCH_DELETED', 'batches', batchId);

    res.json({ success: true, message: 'Unused batch deleted successfully' });
  } catch (err) {
    console.error('[Admin Academic Structure] Error deleting batch:', err);
    res.status(500).json({ error: 'Failed to delete batch' });
  }
});

// ============================================================
// 5. STUDENT ACADEMIC ASSIGNMENTS & REASSIGNMENT
// ============================================================
router.get('/student-assignments', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
    const offset = (page - 1) * limit;

    const universityId = toInt(req.query.universityId);
    const courseId = toInt(req.query.courseId);
    const batchId = toInt(req.query.batchId);
    const profileStatus = String(req.query.profileStatus || '').trim().toLowerCase(); // 'complete', 'incomplete', 'all'
    const search = String(req.query.search || '').trim();

    let whereConditions = [`u.role = 'student'`];
    let params = [];
    let idx = 1;

    if (universityId) {
      whereConditions.push(`sap.university_id = $${idx++}`);
      params.push(universityId);
    }

    if (courseId) {
      whereConditions.push(`sap.course_id = $${idx++}`);
      params.push(courseId);
    }

    if (batchId) {
      whereConditions.push(`sap.batch_id = $${idx++}`);
      params.push(batchId);
    }

    if (profileStatus === 'complete') {
      whereConditions.push(`sap.profile_completed_at IS NOT NULL`);
    } else if (profileStatus === 'incomplete') {
      whereConditions.push(`(sap.id IS NULL OR sap.profile_completed_at IS NULL)`);
    }

    if (search) {
      whereConditions.push(`(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.id::text = $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const countRes = await pool.query(
      `SELECT COUNT(u.id)::int AS total
       FROM users u
       LEFT JOIN student_academic_profiles sap ON sap.student_id = u.id
       ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    const query = `
      SELECT 
        u.id AS student_id, u.full_name, u.email, u.role, u.is_suspended, u.created_at AS user_created_at,
        sap.id AS profile_id, sap.university_id, sap.course_id, sap.batch_id, sap.profile_completed_at, sap.updated_at AS profile_updated_at,
        uni.name AS university_name, uni.code AS university_code,
        crs.name AS course_name, crs.code AS course_code,
        bat.name AS batch_name, bat.start_year, bat.end_year
      FROM users u
      LEFT JOIN student_academic_profiles sap ON sap.student_id = u.id
      LEFT JOIN universities uni ON uni.id = sap.university_id
      LEFT JOIN courses crs ON crs.id = sap.course_id
      LEFT JOIN batches bat ON bat.id = sap.batch_id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    params.push(limit, offset);
    const { rows } = await pool.query(query, params);

    res.json({
      success: true,
      students: rows.map(r => ({
        studentId: r.student_id,
        fullName: r.full_name,
        email: r.email,
        isSuspended: r.is_suspended,
        userCreatedAt: r.user_created_at,
        isComplete: Boolean(r.profile_completed_at),
        profileCompletedAt: r.profile_completed_at,
        profileUpdatedAt: r.profile_updated_at,
        academicProfile: r.university_id ? {
          universityId: r.university_id,
          universityName: r.university_name,
          universityCode: r.university_code,
          courseId: r.course_id,
          courseName: r.course_name,
          courseCode: r.course_code,
          batchId: r.batch_id,
          batchName: r.batch_name,
          startYear: r.start_year,
          endYear: r.end_year
        } : null
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    console.error('[Admin Academic Structure] Error listing student assignments:', err);
    res.status(500).json({ error: 'Failed to fetch student academic assignments' });
  }
});

router.post('/reassign-student', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const studentId = toInt(req.body.studentId || req.body.student_id);
    const universityId = toInt(req.body.universityId || req.body.university_id);
    const courseId = toInt(req.body.courseId || req.body.course_id);
    const batchId = toInt(req.body.batchId || req.body.batch_id);
    const reason = String(req.body.reason || 'Admin manual correction').trim();

    if (!studentId || !universityId || !courseId || !batchId) {
      return res.status(400).json({ error: 'studentId, universityId, courseId, and batchId are required' });
    }

    // 1. Validate student user exists and is a student
    const userRes = await client.query(`SELECT id, full_name, email, role FROM users WHERE id = $1`, [studentId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Student user not found' });
    }
    const studentUser = userRes.rows[0];

    // 2. Validate University exists & ACTIVE
    const uniCheck = await client.query(`SELECT id, name FROM universities WHERE id = $1 AND (status = 'ACTIVE' OR status IS NULL)`, [universityId]);
    if (uniCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected university is invalid or inactive' });
    }
    const universityName = uniCheck.rows[0].name;

    // 3. Validate Course belongs to University & ACTIVE
    const courseCheck = await client.query(`SELECT id, name FROM courses WHERE id = $1 AND university_id = $2 AND status = 'ACTIVE'`, [courseId, universityId]);
    if (courseCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected course does not belong to the specified university or is inactive' });
    }
    const courseName = courseCheck.rows[0].name;

    // 4. Validate Batch belongs to Course & University & ACTIVE
    const batchCheck = await client.query(`SELECT id, name FROM batches WHERE id = $1 AND course_id = $2 AND university_id = $3 AND status = 'ACTIVE'`, [batchId, courseId, universityId]);
    if (batchCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Selected batch does not match the chosen course/university' });
    }
    const batchName = batchCheck.rows[0].name;

    // Fetch existing profile for audit comparison
    const existingProfRes = await client.query(
      `SELECT sap.*, u.name AS university_name, c.name AS course_name, b.name AS batch_name
       FROM student_academic_profiles sap
       LEFT JOIN universities u ON u.id = sap.university_id
       LEFT JOIN courses c ON c.id = sap.course_id
       LEFT JOIN batches b ON b.id = sap.batch_id
       WHERE sap.student_id = $1`,
      [studentId]
    );
    const oldProfile = existingProfRes.rows[0] ? {
      universityId: existingProfRes.rows[0].university_id,
      universityName: existingProfRes.rows[0].university_name,
      courseId: existingProfRes.rows[0].course_id,
      courseName: existingProfRes.rows[0].course_name,
      batchId: existingProfRes.rows[0].batch_id,
      batchName: existingProfRes.rows[0].batch_name
    } : null;

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

    // Sync user_profiles safely against legacy FKs
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

    const newProfile = {
      universityId,
      universityName,
      courseId,
      courseName,
      batchId,
      batchName,
      completedAt: profResult.rows[0].profile_completed_at
    };

    await writeAuditLog(req, 'STUDENT_ACADEMIC_PROFILE_UPDATED', 'student_academic_profile', studentId, {
      adminId: req.session.userId,
      studentId,
      studentName: studentUser.full_name,
      studentEmail: studentUser.email,
      oldProfile,
      newProfile,
      reason
    });

    res.json({
      success: true,
      message: `Academic profile for ${studentUser.full_name} updated successfully`,
      studentId,
      oldProfile,
      newProfile
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Admin Academic Structure] Error reassigning student academic profile:', err);
    res.status(500).json({ error: 'Failed to reassign student academic profile' });
  } finally {
    client.release();
  }
});

module.exports = router;
