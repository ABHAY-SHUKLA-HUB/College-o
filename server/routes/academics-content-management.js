/**
 * academics-content-management.js
 * 
 * Backend API routes for separating admin-uploaded content from student contributions
 * Enables clear admin workflows for:
 * - Managing official notes/papers/materials
 * - Moderating student contributions
 * - Keeping student library unified while maintaining internal separation
 */

const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ============================================
// OFFICIAL CONTENT MANAGEMENT (Admin Uploads)
// ============================================

/**
 * GET /api/admin/academics/official/notes
 * Retrieve admin-uploaded notes (separated from student contributions)
 */
router.get('/admin/academics/official/notes', requireAdmin, async (req, res) => {
  try {
    const { categoryId, branchId, semesterId, status } = req.query;
    const params = [];
    const clauses = ['n.source_type = $1'];
    params.push('admin_upload');

    if (categoryId) {
      params.push(Number(categoryId));
      clauses.push(`n.category_id = $${params.length}`);
    }

    if (branchId) {
      params.push(Number(branchId));
      clauses.push(`n.branch_id = $${params.length}`);
    }

    if (semesterId) {
      params.push(Number(semesterId));
      clauses.push(`n.semester_id = $${params.length}`);
    }

    params.push(status || 'published');
    clauses.push(`n.status = $${params.length}`);

    const where = `WHERE ${clauses.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
        n.id, n.subject, n.chapter, n.difficulty, n.format_type, n.access_type, n.status,
        n.is_common, n.created_at, n.pdf_url, n.college_name, n.source_type,
        ac.name as category_name, ab.name as branch_name, asr.label as semester_label,
        u.full_name as created_by_name
       FROM notes n
       LEFT JOIN academic_categories ac ON ac.id = n.category_id
       LEFT JOIN academic_branches ab ON ab.id = n.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = n.semester_id
       LEFT JOIN users u ON u.id = n.created_by
       ${where}
       ORDER BY n.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      official_notes: result.rows,
      count: result.rows.length,
      source_type: 'admin_upload'
    });
  } catch (error) {
    console.error('Error fetching official notes:', error);
    res.status(500).json({ error: 'Failed to fetch official notes' });
  }
});

/**
 * GET /api/admin/academics/official/papers
 * Retrieve admin-uploaded previous year papers
 */
router.get('/admin/academics/official/papers', requireAdmin, async (req, res) => {
  try {
    const { subject, examName, year, status } = req.query;
    const params = [];
    const clauses = ['pp.deleted_at IS NULL'];

    if (subject) {
      params.push(subject);
      clauses.push(`LOWER(pp.subject) = LOWER($${params.length})`);
    }

    if (examName) {
      params.push(examName);
      clauses.push(`LOWER(pp.exam_name) = LOWER($${params.length})`);
    }

    if (year) {
      params.push(Number(year));
      clauses.push(`pp.year = $${params.length}`);
    }

    if (status) {
      params.push(String(status));
      clauses.push(`pp.status = $${params.length}`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
        pp.id, pp.subject, pp.exam_name, pp.year, pp.paper_url, pp.college_name,
        'admin_upload'::text AS source_type,
        pp.status AS approval_status,
        pp.created_at,
        u.full_name as uploaded_by_name
       FROM previous_papers pp
       LEFT JOIN users u ON u.id = pp.uploaded_by
       ${where}
       ORDER BY pp.year DESC, pp.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      official_papers: result.rows,
      count: result.rows.length,
      source_type: 'admin_upload'
    });
  } catch (error) {
    console.error('Error fetching official papers:', error);
    res.status(500).json({ error: 'Failed to fetch official papers' });
  }
});

/**
 * GET /api/admin/academics/official/materials
 * Retrieve admin-uploaded materials
 */
router.get('/admin/academics/official/materials', requireAdmin, async (req, res) => {
  try {
    const { category, subject, status } = req.query;
    const params = [];
    const clauses = ['m.deleted_at IS NULL'];

    if (category) {
      params.push(category);
      clauses.push(`LOWER(m.category) = LOWER($${params.length})`);
    }

    if (subject) {
      params.push(subject);
      clauses.push(`LOWER(m.subject) = LOWER($${params.length})`);
    }

    if (status) {
      params.push(String(status));
      clauses.push(`m.status = $${params.length}`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
        m.id, m.title, m.category, m.subject, m.description, m.file_url,
        'admin_upload'::text AS source_type,
        m.status AS approval_status,
        NULL::numeric AS quality_score,
        m.created_at,
        u.full_name as uploaded_by_name
       FROM materials m
       LEFT JOIN users u ON u.id = m.uploaded_by
       ${where}
       ORDER BY m.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      official_materials: result.rows,
      count: result.rows.length,
      source_type: 'admin_upload'
    });
  } catch (error) {
    console.error('Error fetching official materials:', error);
    res.status(500).json({ error: 'Failed to fetch official materials' });
  }
});

// ============================================
// STUDENT CONTRIBUTIONS MODERATION
// ============================================

/**
 * GET /api/admin/academics/student-contributions/notes
 * Retrieve student-submitted notes for moderation
 */
router.get('/admin/academics/student-contributions/notes', requireAdmin, async (req, res) => {
  try {
    const { status, branchId, subjectId } = req.query;
    const params = [];
    const clauses = ['n.source_type = $1'];
    params.push('student_contribution');

    if (status) {
      params.push(status);
      clauses.push(`n.approval_status = $${params.length}`);
    } else {
      // Default to non-published (pending/rejected) for moderation view
      params.push('published');
      clauses.push(`n.approval_status != $${params.length}`);
    }

    if (branchId) {
      params.push(Number(branchId));
      clauses.push(`n.branch_id = $${params.length}`);
    }

    if (subjectId) {
      params.push(Number(subjectId));
      clauses.push(`n.subject_id = $${params.length}`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
        n.id, n.subject, n.chapter, n.difficulty, n.format_type, n.content,
        n.approval_status, n.contributor_notes, n.created_at, n.pdf_url,
        n.branch_id, n.semester_id, n.subject_id,
        ab.name as branch_name, asr.label as semester_label,
        u.full_name as contributor_name, u.email, u.id as contributor_id
       FROM notes n
       LEFT JOIN academic_branches ab ON ab.id = n.branch_id
       LEFT JOIN academic_semesters asr ON asr.id = n.semester_id
       LEFT JOIN users u ON u.id = n.created_by
       ${where}
       ORDER BY 
         CASE WHEN n.approval_status = 'pending' THEN 1 ELSE 2 END,
         n.created_at ASC
       LIMIT 200`,
      params
    );

    res.json({
      student_contribution_notes: result.rows,
      count: result.rows.length,
      source_type: 'student_contribution'
    });
  } catch (error) {
    console.error('Error fetching student contribution notes:', error);
    res.status(500).json({ error: 'Failed to fetch student contribution notes' });
  }
});

/**
 * GET /api/admin/academics/student-contributions/papers
 * Retrieve student-submitted papers for moderation
 */
router.get('/admin/academics/student-contributions/papers', requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    const clauses = ['pp.source_type = $1'];
    params.push('student_contribution');

    if (status) {
      params.push(status);
      clauses.push(`pp.approval_status = $${params.length}`);
    } else {
      params.push('published');
      clauses.push(`pp.approval_status != $${params.length}`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
        pp.id, pp.subject, pp.exam_name, pp.year, pp.paper_url, pp.created_at,
        pp.approval_status, pp.moderation_notes,
        u.full_name as contributor_name, u.email, u.id as contributor_id
       FROM previous_papers pp
       LEFT JOIN users u ON u.id = pp.contributor_id
       ${where}
       ORDER BY pp.created_at ASC
       LIMIT 200`,
      params
    );

    res.json({
      student_contribution_papers: result.rows,
      count: result.rows.length,
      source_type: 'student_contribution'
    });
  } catch (error) {
    console.error('Error fetching student contribution papers:', error);
    res.status(500).json({ error: 'Failed to fetch student contribution papers' });
  }
});

/**
 * PUT /api/admin/academics/student-contributions/:type/:id/approve
 * Approve a student contribution (notes, papers, materials)
 */
router.put('/admin/academics/student-contributions/:type/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { notes } = req.body;

    const validTypes = ['notes', 'papers', 'materials'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    const tableMap = {
      notes: 'notes',
      papers: 'previous_papers',
      materials: 'materials'
    };

    const table = tableMap[type];
    
    const result = await pool.query(
      `UPDATE ${table}
       SET approval_status = 'approved', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND source_type = 'student_contribution'
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found' });
    }

    res.json({
      message: `${type} contribution approved`,
      item: result.rows[0]
    });
  } catch (error) {
    console.error(`Error approving ${type}:`, error);
    res.status(500).json({ error: `Failed to approve ${type}` });
  }
});

/**
 * PUT /api/admin/academics/student-contributions/:type/:id/reject
 * Reject a student contribution
 */
router.put('/admin/academics/student-contributions/:type/:id/reject', requireAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;

    const validTypes = ['notes', 'papers', 'materials'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    const tableMap = {
      notes: 'notes',
      papers: 'previous_papers',
      materials: 'materials'
    };

    const table = tableMap[type];
    
    const result = await pool.query(
      `UPDATE ${table}
       SET approval_status = 'rejected', moderation_notes = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND source_type = 'student_contribution'
       RETURNING *`,
      [id, reason || null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contribution not found' });
    }

    res.json({
      message: `${type} contribution rejected`,
      item: result.rows[0]
    });
  } catch (error) {
    console.error(`Error rejecting ${type}:`, error);
    res.status(500).json({ error: `Failed to reject ${type}` });
  }
});

// ============================================
// CONTENT ANALYTICS (BY SOURCE)
// ============================================

/**
 * GET /api/admin/academics/analytics/by-source
 * Get analytics comparing official vs student-contributed content
 */
router.get('/admin/academics/analytics/by-source', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        'admin_upload' as source_type,
        'Official' as source_label,
        COUNT(CASE WHEN source_type = 'admin_upload' THEN 1 END) as total_count,
        COUNT(CASE WHEN source_type = 'admin_upload' AND approval_status = 'published' THEN 1 END) as published_count,
        COUNT(CASE WHEN source_type = 'admin_upload' AND source_type = 'notes' THEN 1 END) as notes_count,
        COUNT(CASE WHEN source_type = 'admin_upload' AND source_type = 'papers' THEN 1 END) as papers_count
      FROM (
        SELECT source_type, approval_status FROM notes WHERE source_type = 'admin_upload'
        UNION ALL
        SELECT source_type, approval_status FROM previous_papers WHERE source_type = 'admin_upload'
        UNION ALL
        SELECT source_type, approval_status FROM materials WHERE source_type = 'admin_upload'
      ) combined

      UNION ALL

      SELECT
        'student_contribution' as source_type,
        'Student Contributions' as source_label,
        COUNT(CASE WHEN source_type = 'student_contribution' THEN 1 END) as total_count,
        COUNT(CASE WHEN source_type = 'student_contribution' AND approval_status IN ('approved', 'published') THEN 1 END) as published_count,
        COUNT(CASE WHEN source_type = 'student_contribution' AND source_type = 'notes' THEN 1 END) as notes_count,
        COUNT(CASE WHEN source_type = 'student_contribution' AND source_type = 'papers' THEN 1 END) as papers_count
      FROM (
        SELECT source_type, approval_status FROM notes WHERE source_type = 'student_contribution'
        UNION ALL
        SELECT source_type, approval_status FROM previous_papers WHERE source_type = 'student_contribution'
        UNION ALL
        SELECT source_type, approval_status FROM materials WHERE source_type = 'student_contribution'
      ) combined
    `);

    res.json({
      analytics_by_source: result.rows
    });
  } catch (error) {
    console.error('Error fetching source analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
