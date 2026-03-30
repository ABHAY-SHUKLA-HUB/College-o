/**
 * student-library-unified.js
 * 
 * Backend API routes for student-facing unified library
 * Merges admin-uploaded and student-contributed content into one experience
 * Students see one clean library without explicit source distinction
 */

const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

// Helper middleware to check student role or guest access
const allowStudentOrGuest = (req, res, next) => {
  if (req.session?.userId) {
    return next();
  }
  // Allow guest access (no session) to public resources
  next();
};

// ============================================
// UNIFIED NOTES LIBRARY
// ============================================

/**
 * GET /api/library/unified/notes
 * Unified notes library merging admin + student-contributed content
 * Prioritizes admin content, but shows both in unified view
 */
router.get('/library/unified/notes', allowStudentOrGuest, async (req, res) => {
  try {
    const { branch, semester, search, subject, difficulty } = req.query;
    const params = [];
    const clauses = [
      "(n.source_type = 'admin_upload' OR (n.source_type = 'student_contribution' AND n.approval_status IN ('approved', 'published')))"
    ];

    if (branch) {
      params.push(Number(branch));
      clauses.push(`n.branch_id = $${params.length}`);
    }

    if (semester) {
      params.push(Number(semester));
      clauses.push(`n.semester_id = $${params.length}`);
    }

    if (subject) {
      params.push(subject);
      clauses.push(`LOWER(n.subject) LIKE LOWER($${params.length})`);
    }

    if (difficulty) {
      params.push(difficulty);
      clauses.push(`n.difficulty = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(LOWER(n.subject) LIKE LOWER($${params.length}) OR LOWER(n.chapter) LIKE LOWER($${params.length}))`);
      // Reuse last param for second LIKE
      params.push(`%${search}%`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
        n.id,
        n.subject,
        n.chapter,
        n.content,
        n.difficulty,
        n.format_type,
        n.pdf_url,
        n.is_premium,
        n.created_at,
        CASE 
          WHEN n.source_type = 'admin_upload' THEN 'Official Resource'
          ELSE 'Community Resource'
        END as resource_type_label,
        n.source_type,
        n.branch_id,
        n.semester_id,
        n.subject_id,
        n.category_id,
        u.full_name as contributed_by
       FROM notes n
       LEFT JOIN users u ON u.id = n.created_by
       ${where}
       ORDER BY 
         CASE WHEN n.source_type = 'admin_upload' THEN 1 ELSE 2 END,
         n.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      unified_notes: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching unified notes library:', error);
    res.status(500).json({ error: 'Failed to fetch notes library' });
  }
});

/**
 * GET /api/library/unified/papers
 * Unified papers library merging admin + student-contributed papers
 */
router.get('/library/unified/papers', allowStudentOrGuest, async (req, res) => {
  try {
    const { exam, year, subject, search } = req.query;
    const params = [];
    const clauses = [
      "(pp.source_type = 'admin_upload' OR (pp.source_type = 'student_contribution' AND pp.approval_status IN ('approved', 'published')))"
    ];

    if (exam) {
      params.push(exam);
      clauses.push(`LOWER(pp.exam_name) LIKE LOWER($${params.length})`);
    }

    if (year) {
      params.push(Number(year));
      clauses.push(`pp.year = $${params.length}`);
    }

    if (subject) {
      params.push(subject);
      clauses.push(`LOWER(pp.subject) LIKE LOWER($${params.length})`);
    }

    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(LOWER(pp.exam_name) LIKE LOWER($${params.length}) OR LOWER(pp.subject) LIKE LOWER($${params.length}))`);
      params.push(`%${search}%`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;

    const result = await pool.query(
      `SELECT
        pp.id,
        pp.subject,
        pp.exam_name,
        pp.year,
        pp.paper_url,
        pp.summary_note_url,
        pp.created_at,
        CASE 
          WHEN pp.source_type = 'admin_upload' THEN 'Official Paper'
          ELSE 'Community Paper'
        END as resource_type_label,
        pp.source_type,
        pp.college_name,
        u.full_name as contributed_by
       FROM previous_papers pp
       LEFT JOIN users u ON u.id = COALESCE(pp.uploaded_by, pp.contributor_id)
       ${where}
       ORDER BY 
         CASE WHEN pp.source_type = 'admin_upload' THEN 1 ELSE 2 END,
         pp.year DESC,
         pp.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      unified_papers: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching unified papers library:', error);
    res.status(500).json({ error: 'Failed to fetch papers library' });
  }
});

/**
 * GET /api/library/unified/materials
 * Unified materials library merging admin + student-contributed materials
 */
router.get('/library/unified/materials', allowStudentOrGuest, async (req, res) => {
  try {
    const { category, subject, search } = req.query;
    const params = [];
    const clauses = [];

    if (category) {
      params.push(category);
      clauses.push(`LOWER(um.category) = LOWER($${params.length})`);
    }

    if (subject) {
      params.push(subject);
      clauses.push(`LOWER(um.subject) = LOWER($${params.length})`);
    }

    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(LOWER(um.title) LIKE LOWER($${params.length}) OR LOWER(COALESCE(um.description, '')) LIKE LOWER($${params.length}) OR LOWER(COALESCE(um.subject, '')) LIKE LOWER($${params.length}))`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const result = await pool.query(
      `WITH unified_materials AS (
         SELECT
           m.id,
           m.title,
           m.category,
           m.subject,
           m.description,
           m.file_url,
           NULL::numeric AS quality_score,
           m.created_at,
           'Official Material'::text AS resource_type_label,
           'admin_upload'::text AS source_type,
           u.full_name AS contributed_by
         FROM materials m
         LEFT JOIN users u ON u.id = m.uploaded_by
         WHERE m.deleted_at IS NULL
           AND COALESCE(m.status, 'published') = 'published'

         UNION ALL

         SELECT
           c.id,
           c.title,
           c.resource_type AS category,
           c.subject_name AS subject,
           c.description,
           c.file_url,
           c.quality_score,
           c.created_at,
           'Community Material'::text AS resource_type_label,
           'student_contribution'::text AS source_type,
           u.full_name AS contributed_by
         FROM academic_contributions c
         LEFT JOIN users u ON u.id = c.user_id
         WHERE c.status = 'approved'
           AND COALESCE(c.is_hidden, FALSE) = FALSE
           AND c.resource_type IN ('assignment', 'lab_file', 'other')
       )
       SELECT
         um.id,
         um.title,
         um.category,
         um.subject,
         um.description,
         um.file_url,
         um.quality_score,
         um.created_at,
         um.resource_type_label,
         um.source_type,
         um.contributed_by
       FROM unified_materials um
       ${where}
       ORDER BY 
         CASE WHEN um.source_type = 'admin_upload' THEN 1 ELSE 2 END,
         um.quality_score DESC NULLS LAST,
         um.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      unified_materials: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching unified materials library:', error);
    res.status(500).json({ error: 'Failed to fetch materials library' });
  }
});

// ============================================
// UNIFIED SEARCH ACROSS ALL CONTENT
// ============================================

/**
 * GET /api/library/unified/search
 * Global search across all content types
 */
router.get('/library/unified/search', allowStudentOrGuest, async (req, res) => {
  try {
    const { q, type, limit } = req.query;
    const searchTerm = String(q || '').trim();
    const contentType = String(type || '').toLowerCase();
    const resultLimit = Math.min(Number(limit) || 50, 100);

    if (!searchTerm || searchTerm.length < 2) {
      return res.json({
        results: [],
        message: 'Search term must be at least 2 characters'
      });
    }

    const searchPattern = `%${searchTerm}%`;
    let allResults = [];

    // Search notes
    if (!contentType || contentType === 'notes') {
      const notesResult = await pool.query(
        `SELECT 'note' as content_type, n.id, n.subject, n.chapter as title, n.difficulty,
                n.source_type, n.created_at, u.full_name
         FROM notes n
         LEFT JOIN users u ON u.id = n.created_by
         WHERE (n.source_type = 'admin_upload' OR (n.source_type = 'student_contribution' AND n.approval_status IN ('approved', 'published')))
         AND (LOWER(n.subject) LIKE LOWER($1) OR LOWER(n.chapter) LIKE LOWER($1))
         ORDER BY CASE WHEN n.source_type = 'admin_upload' THEN 1 ELSE 2 END,
                  n.created_at DESC
         LIMIT $2`,
        [searchPattern, resultLimit]
      );
      allResults = allResults.concat(notesResult.rows);
    }

    // Search papers
    if (!contentType || contentType === 'papers') {
      const papersResult = await pool.query(
        `SELECT 'paper' as content_type, pp.id, pp.exam_name as subject, pp.subject || ' - ' || pp.year as title, 
                pp.year as difficulty, pp.source_type, pp.created_at, u.full_name
         FROM previous_papers pp
         LEFT JOIN users u ON u.id = COALESCE(pp.uploaded_by, pp.contributor_id)
         WHERE (pp.source_type = 'admin_upload' OR (pp.source_type = 'student_contribution' AND pp.approval_status IN ('approved', 'published')))
         AND (LOWER(pp.exam_name) LIKE LOWER($1) OR LOWER(pp.subject) LIKE LOWER($1))
         ORDER BY CASE WHEN pp.source_type = 'admin_upload' THEN 1 ELSE 2 END,
                  pp.year DESC
         LIMIT $2`,
        [searchPattern, resultLimit]
      );
      allResults = allResults.concat(papersResult.rows);
    }

    // Search materials
    if (!contentType || contentType === 'materials') {
      const materialsResult = await pool.query(
        `SELECT 'material' as content_type, m.id, m.subject, m.title, m.quality_score as difficulty,
                m.source_type, m.created_at, u.full_name
         FROM materials m
         LEFT JOIN users u ON u.id = m.uploaded_by
         WHERE (m.source_type = 'admin_upload' OR (m.source_type = 'student_contribution' AND m.approval_status IN ('approved', 'published')))
         AND (LOWER(m.title) LIKE LOWER($1) OR LOWER(m.subject) LIKE LOWER($1))
         ORDER BY CASE WHEN m.source_type = 'admin_upload' THEN 1 ELSE 2 END,
                  m.created_at DESC
         LIMIT $2`,
        [searchPattern, resultLimit]
      );
      allResults = allResults.concat(materialsResult.rows);
    }

    // Sort results by source (admin first) and then by recency
    allResults.sort((a, b) => {
      if (a.source_type === 'admin_upload' && b.source_type !== 'admin_upload') return -1;
      if (b.source_type === 'admin_upload' && a.source_type !== 'admin_upload') return 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    res.json({
      results: allResults.slice(0, resultLimit),
      total: allResults.length,
      query: searchTerm
    });
  } catch (error) {
    console.error('Error searching unified library:', error);
    res.status(500).json({ error: 'Failed to search library' });
  }
});

// ============================================
// LIBRARY STATISTICS
// ============================================

/**
 * GET /api/library/unified/stats
 * Get unified library statistics (what students see)
 */
router.get('/library/unified/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(DISTINCT CASE WHEN content_type = 'notes' THEN id END) as total_notes,
        COUNT(DISTINCT CASE WHEN content_type = 'papers' THEN id END) as total_papers,
        COUNT(DISTINCT CASE WHEN content_type = 'materials' THEN id END) as total_materials,
        COUNT(DISTINCT uploader_id) as contributor_count
      FROM (
        SELECT 'notes' as content_type, n.id, n.created_by as uploader_id
        FROM notes n
        WHERE n.source_type = 'admin_upload' OR (n.source_type = 'student_contribution' AND n.approval_status IN ('approved', 'published'))
        
        UNION ALL
        
        SELECT 'papers' as content_type, pp.id, COALESCE(pp.uploaded_by, pp.contributor_id) as uploader_id
        FROM previous_papers pp
        WHERE pp.source_type = 'admin_upload' OR (pp.source_type = 'student_contribution' AND pp.approval_status IN ('approved', 'published'))
        
        UNION ALL
        
        SELECT 'materials' as content_type, m.id, m.uploaded_by as uploader_id
        FROM materials m
        WHERE m.source_type = 'admin_upload' OR (m.source_type = 'student_contribution' AND m.approval_status IN ('approved', 'published'))
      ) combined
    `);

    res.json({
      library_stats: result.rows[0] || {
        total_notes: 0,
        total_papers: 0,
        total_materials: 0,
        contributor_count: 0
      }
    });
  } catch (error) {
    console.error('Error fetching library stats:', error);
    res.status(500).json({ error: 'Failed to fetch library statistics' });
  }
});

module.exports = router;
