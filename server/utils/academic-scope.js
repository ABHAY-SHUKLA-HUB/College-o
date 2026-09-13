const { pool } = require('../db/pool');

/**
 * Checks whether a student has completed their mandatory academic setup.
 * Server/database is the authoritative source of truth.
 */
async function isStudentAcademicProfileComplete(studentId) {
  if (!studentId) return false;
  try {
    const { rows } = await pool.query(
      `SELECT university_id, course_id, batch_id
       FROM student_academic_profiles
       WHERE student_id = $1
       LIMIT 1`,
      [studentId]
    );

    if (rows.length > 0) {
      const p = rows[0];
      return Boolean(p.university_id && p.course_id && p.batch_id);
    }

    return false;
  } catch (err) {
    console.error('[Academic Scope] Error checking profile completeness:', err);
    return false;
  }
}

/**
 * Authoritatively resolves full academic scope for a student.
 * Never trusts scope parameters supplied by the client frontend.
 */
async function resolveStudentAcademicScope(studentId) {
  if (!studentId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT sap.student_id, sap.university_id, sap.course_id, sap.batch_id,
              u.name AS university_name, u.code AS university_code, u.status AS university_status,
              c.name AS course_name, c.code AS course_code, c.status AS course_status,
              b.name AS batch_name, b.status AS batch_status,
              usr.is_suspended, usr.is_blocked, usr.role
       FROM student_academic_profiles sap
       JOIN users usr ON usr.id = sap.student_id
       JOIN universities u ON u.id = sap.university_id
       JOIN courses c ON c.id = sap.course_id
       JOIN batches b ON b.id = sap.batch_id
       WHERE sap.student_id = $1`,
      [studentId]
    );

    if (rows.length === 0) {
      return {
        studentId,
        profileComplete: false,
        universityId: null,
        courseId: null,
        batchId: null
      };
    }

    const r = rows[0];
    const profileComplete = Boolean(r.university_id && r.course_id && r.batch_id);

    return {
      studentId: r.student_id,
      role: r.role,
      isSuspended: Boolean(r.is_suspended),
      isBlocked: Boolean(r.is_blocked),
      profileComplete,
      universityId: r.university_id,
      universityName: r.university_name,
      universityCode: r.university_code,
      universityStatus: r.university_status,
      courseId: r.course_id,
      courseName: r.course_name,
      courseCode: r.course_code,
      courseStatus: r.course_status,
      batchId: r.batch_id,
      batchName: r.batch_name,
      batchStatus: r.batch_status
    };
  } catch (err) {
    console.error('[Academic Scope] Error resolving academic scope:', err);
    return null;
  }
}

/**
 * Builds parametrized SQL clauses for filtering student queries by academic scope.
 * 
 * Hierarchy:
 * - GLOBAL: visible to all students
 * - UNIVERSITY: visible to matching university_id
 * - COURSE: visible to matching university_id + course_id
 * - BATCH: visible to matching university_id + course_id + batch_id
 * 
 * @param {Object} studentScope - Resolved student academic scope object
 * @param {Object} options - { alias: string, startIndex: number, legacySupport: boolean }
 * @returns {Object} { sqlClause, params, nextIndex }
 */
function applyAcademicScopeToQuery(studentScope, options = {}) {
  const alias = options.alias ? `${options.alias}.` : '';
  const startIndex = typeof options.startIndex === 'number' ? options.startIndex : 1;
  const legacySupport = Boolean(options.legacySupport);

  if (!studentScope || !studentScope.profileComplete) {
    // Fail Closed: Return an impossible condition if profile is missing/incomplete
    return {
      sqlClause: `1 = 0`,
      params: [],
      nextIndex: startIndex
    };
  }

  const { universityId, courseId, batchId } = studentScope;
  const params = [universityId, courseId, batchId];

  const p1 = `$${startIndex}`;
  const p2 = `$${startIndex + 1}`;
  const p3 = `$${startIndex + 2}`;

  let sqlClause = `(
    ${alias}scope_type = 'GLOBAL'
    OR (${alias}scope_type = 'UNIVERSITY' AND ${alias}university_id = ${p1})
    OR (${alias}scope_type = 'COURSE' AND ${alias}university_id = ${p1} AND ${alias}course_id = ${p2})
    OR (${alias}scope_type = 'BATCH' AND ${alias}university_id = ${p1} AND ${alias}course_id = ${p2} AND ${alias}batch_id = ${p3})
  )`;

  if (legacySupport) {
    // If scope_type is NULL or unset on legacy content rows, fallback to checking matching explicit IDs or NULL fields
    sqlClause = `(
      ${sqlClause}
      OR (
        (${alias}scope_type IS NULL OR ${alias}scope_type = '')
        AND (${alias}university_id IS NULL OR ${alias}university_id = ${p1})
        AND (${alias}course_id IS NULL OR ${alias}course_id = ${p2})
        AND (${alias}batch_id IS NULL OR ${alias}batch_id = ${p3})
      )
    )`;
  }

  return {
    sqlClause,
    params,
    nextIndex: startIndex + 3
  };
}

/**
 * Checks single resource object against student academic scope.
 * 
 * @param {Object} studentScope - Resolved student scope
 * @param {Object} resource - Content item containing scope_type, university_id, course_id, batch_id
 * @returns {Boolean} true if accessible, false if denied
 */
function canStudentAccessResource(studentScope, resource) {
  if (!studentScope || !studentScope.profileComplete) return false;
  if (!resource) return false;

  const scopeType = String(resource.scope_type || 'GLOBAL').toUpperCase();

  if (scopeType === 'GLOBAL') {
    return true;
  }

  if (scopeType === 'UNIVERSITY') {
    return Number(resource.university_id) === Number(studentScope.universityId);
  }

  if (scopeType === 'COURSE') {
    return Number(resource.university_id) === Number(studentScope.universityId) &&
           Number(resource.course_id) === Number(studentScope.courseId);
  }

  if (scopeType === 'BATCH') {
    return Number(resource.university_id) === Number(studentScope.universityId) &&
           Number(resource.course_id) === Number(studentScope.courseId) &&
           Number(resource.batch_id) === Number(studentScope.batchId);
  }

  // Fallback for legacy unscoped rows
  const matchUni = !resource.university_id || Number(resource.university_id) === Number(studentScope.universityId);
  const matchCourse = !resource.course_id || Number(resource.course_id) === Number(studentScope.courseId);
  const matchBatch = !resource.batch_id || Number(resource.batch_id) === Number(studentScope.batchId);

  return matchUni && matchCourse && matchBatch;
}

module.exports = {
  isStudentAcademicProfileComplete,
  resolveStudentAcademicScope,
  applyAcademicScopeToQuery,
  canStudentAccessResource
};
