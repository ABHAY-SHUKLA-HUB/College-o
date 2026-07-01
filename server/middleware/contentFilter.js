const { pool } = require('../db/pool');
const { logContentAccess } = require('./auditLog');

/**
 * Content access filtering middleware
 * Ensures students can only access content from their assigned academic profile
 * Prevents students from accessing content from other colleges/courses/branches/semesters
 */

async function getUserAcademicFilters(userId) {
  if (!userId) return null;

  try {
    const { rows } = await pool.query(
      `SELECT 
        sap.id,
        sap.category_id,
        sap.branch_id,
        sap.semester_id,
        sap.batch_year,
        cat.name as category_name,
        branch.name as branch_name,
        sem.label as semester_label
       FROM student_academic_profile sap
       LEFT JOIN academic_categories cat ON sap.category_id = cat.id
       LEFT JOIN academic_branches branch ON sap.branch_id = branch.id
       LEFT JOIN academic_semesters sem ON sap.semester_id = sem.id
       WHERE sap.user_id = $1
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  } catch (err) {
    console.warn('[ContentFilter] Error fetching academic profile:', err.message);
    return null;
  }
}

/**
 * Filter: Ensure note belongs to user's academic profile
 */
async function validateNoteAccess(userId, noteId, userRole = 'student') {
  // Admins can access any note
  if (['admin', 'super_admin'].includes(userRole)) {
    return { allowed: true };
  }

  // Students must have matching academic profile
  if (userRole === 'student') {
    const profile = await getUserAcademicFilters(userId);
    if (!profile) {
      logContentAccess(userId, '', 'note', noteId, null, null, null, false, 'No academic profile');
      return { allowed: false, reason: 'No academic profile' };
    }

    try {
      const { rows } = await pool.query(
        `SELECT id FROM notes
         WHERE id = $1
         AND (
           category_id = $2 OR category_id IS NULL
         )
         AND (
           branch_id = $3 OR branch_id IS NULL
         )
         AND (
           semester_id = $4 OR semester_id IS NULL
         )
         LIMIT 1`,
        [noteId, profile.category_id, profile.branch_id, profile.semester_id]
      );

      const allowed = rows.length > 0;
      if (!allowed) {
        logContentAccess(userId, '', 'note', noteId, profile.category_id, profile.branch_id, profile.semester_id, false, 'Academic profile mismatch');
      }
      return { allowed, reason: allowed ? 'OK' : 'Academic profile mismatch' };
    } catch (err) {
      console.warn('[ContentFilter] Error validating note access:', err.message);
      return { allowed: false, reason: 'Validation error' };
    }
  }

  return { allowed: false, reason: 'Invalid role' };
}

/**
 * Filter: Ensure quiz belongs to user's academic profile
 */
async function validateQuizAccess(userId, quizId, userRole = 'student') {
  // Admins can access any quiz
  if (['admin', 'super_admin'].includes(userRole)) {
    return { allowed: true };
  }

  // Students must have matching academic profile
  if (userRole === 'student') {
    const profile = await getUserAcademicFilters(userId);
    if (!profile) {
      return { allowed: false, reason: 'No academic profile' };
    }

    try {
      const { rows } = await pool.query(
        `SELECT id FROM quizzes
         WHERE id = $1
         AND (
           category_id = $2 OR category_id IS NULL
         )
         AND (
           branch_id = $3 OR branch_id IS NULL
         )
         AND (
           semester_id = $4 OR semester_id IS NULL
         )
         LIMIT 1`,
        [quizId, profile.category_id, profile.branch_id, profile.semester_id]
      );

      return { allowed: rows.length > 0, reason: rows.length > 0 ? 'OK' : 'Academic profile mismatch' };
    } catch (err) {
      console.warn('[ContentFilter] Error validating quiz access:', err.message);
      return { allowed: false, reason: 'Validation error' };
    }
  }

  return { allowed: false, reason: 'Invalid role' };
}

/**
 * Filter: Ensure mock test belongs to user's academic profile
 */
async function validateMockTestAccess(userId, mockTestId, userRole = 'student') {
  // Admins can access any mock test
  if (['admin', 'super_admin'].includes(userRole)) {
    return { allowed: true };
  }

  // Students must have matching academic profile
  if (userRole === 'student') {
    const profile = await getUserAcademicFilters(userId);
    if (!profile) {
      return { allowed: false, reason: 'No academic profile' };
    }

    try {
      const { rows } = await pool.query(
        `SELECT id FROM mock_tests
         WHERE id = $1
         AND (
           category_id = $2 OR category_id IS NULL
         )
         AND (
           branch_id = $3 OR branch_id IS NULL
         )
         AND (
           semester_id = $4 OR semester_id IS NULL
         )
         LIMIT 1`,
        [mockTestId, profile.category_id, profile.branch_id, profile.semester_id]
      );

      return { allowed: rows.length > 0, reason: rows.length > 0 ? 'OK' : 'Academic profile mismatch' };
    } catch (err) {
      console.warn('[ContentFilter] Error validating mock test access:', err.message);
      return { allowed: false, reason: 'Validation error' };
    }
  }

  return { allowed: false, reason: 'Invalid role' };
}

/**
 * Filter: Ensure roadmap belongs to user's academic profile
 */
async function validateRoadmapAccess(userId, roadmapId, userRole = 'student') {
  // Admins can access any roadmap
  if (['admin', 'super_admin'].includes(userRole)) {
    return { allowed: true };
  }

  // Students must have matching academic profile
  if (userRole === 'student') {
    const profile = await getUserAcademicFilters(userId);
    if (!profile) {
      return { allowed: false, reason: 'No academic profile' };
    }

    try {
      const { rows } = await pool.query(
        `SELECT id FROM career_roadmaps
         WHERE id = $1
         AND (
           category_id = $2 OR category_id IS NULL
         )
         AND (
           branch_id = $3 OR branch_id IS NULL
         )
         AND is_published = true
         LIMIT 1`,
        [roadmapId, profile.category_id, profile.branch_id]
      );

      return { allowed: rows.length > 0, reason: rows.length > 0 ? 'OK' : 'Academic profile mismatch' };
    } catch (err) {
      console.warn('[ContentFilter] Error validating roadmap access:', err.message);
      return { allowed: false, reason: 'Validation error' };
    }
  }

  return { allowed: false, reason: 'Invalid role' };
}

/**
 * Middleware: Create content filter for API responses
 * Filters list of content based on user's academic profile
 */
function filterContentByAcademicProfile(userRole) {
  return async (req, res, next) => {
    if (['admin', 'super_admin'].includes(userRole)) {
      // Admins see everything
      return next();
    }

    if (userRole === 'student' && req.userId) {
      const profile = await getUserAcademicFilters(req.userId);
      req.userAcademicProfile = profile;
    }

    next();
  };
}

module.exports = {
  getUserAcademicFilters,
  validateNoteAccess,
  validateQuizAccess,
  validateMockTestAccess,
  validateRoadmapAccess,
  filterContentByAcademicProfile
};
