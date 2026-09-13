const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');
const { createUploadMiddleware, saveUploadedFile } = require('../services/uploadService');
const { logSecurityEvent } = require('../middleware/auditLog');
const { publishContentChanged } = require('../services/realtimeBus');
const { ensureMembershipSchema } = require('../services/entitlementResolver');

const router = express.Router();

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

const academicUpload = createUploadMiddleware({
  maxFileSize: 25 * 1024 * 1024, // 25 MB max PDF/Document file size
  allowedMimeTypes: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg',
    'image/webp'
  ],
  allowedExtensions: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.webp'],
  invalidTypeMessage: 'Only PDF, Word, PowerPoint, or Image documents are allowed'
});

const handleAcademicFileUpload = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    return academicUpload.single('file')(req, res, next);
  }
  return next();
};

function toInt(val, fallback = null) {
  const parsed = parseInt(val, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// ============================================================
// 1. ADMIN NOTES LIBRARY MANAGEMENT
// ============================================================

// GET /api/admin/control/academics/notes - Paginated & filtered list of notes
router.get('/academics/notes', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
    const offset = (page - 1) * limit;

    const statusFilter = String(req.query.status || '').trim().toLowerCase();
    const categoryId = toInt(req.query.categoryId);
    const branchId = toInt(req.query.branchId);
    const semesterId = toInt(req.query.semesterId);
    const subjectId = toInt(req.query.subjectId);
    const search = String(req.query.search || '').trim();

    let whereConditions = ['n.deleted_at IS NULL'];
    let queryParams = [];
    let paramIdx = 1;

    if (statusFilter && statusFilter !== 'all') {
      whereConditions.push(`n.status = $${paramIdx++}`);
      queryParams.push(statusFilter);
    }

    if (categoryId) {
      whereConditions.push(`n.category_id = $${paramIdx++}`);
      queryParams.push(categoryId);
    }

    if (branchId) {
      whereConditions.push(`n.branch_id = $${paramIdx++}`);
      queryParams.push(branchId);
    }

    if (semesterId) {
      whereConditions.push(`n.semester_id = $${paramIdx++}`);
      queryParams.push(semesterId);
    }

    if (subjectId) {
      whereConditions.push(`n.subject_id = $${paramIdx++}`);
      queryParams.push(subjectId);
    }

    if (search) {
      whereConditions.push(`(
        n.subject ILIKE $${paramIdx} 
        OR n.chapter ILIKE $${paramIdx} 
        OR n.content ILIKE $${paramIdx}
      )`);
      queryParams.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM notes n ${whereClause}`, queryParams);
    const total = countRes.rows[0]?.total || 0;

    const query = `
      SELECT 
        n.id,
        n.subject,
        n.chapter,
        n.content,
        n.difficulty,
        n.format_type,
        n.access_type,
        n.status,
        n.is_common,
        n.pdf_url,
        n.category_id,
        n.branch_id,
        n.semester_id,
        n.subject_id,
        n.source_type,
        n.created_at,
        ac.name AS category_name,
        ab.name AS branch_name,
        asr.label AS semester_label,
        asub.name AS subject_name,
        u.full_name AS created_by_name
      FROM notes n
      LEFT JOIN academic_categories ac ON ac.id = n.category_id
      LEFT JOIN academic_branches ab ON ab.id = n.branch_id
      LEFT JOIN academic_semesters asr ON asr.id = n.semester_id
      LEFT JOIN academic_subjects asub ON asub.id = n.subject_id
      LEFT JOIN users u ON u.id = n.created_by
      ${whereClause}
      ORDER BY n.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    queryParams.push(limit, offset);
    const { rows } = await pool.query(query, queryParams);

    res.json({
      success: true,
      notes: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch academic notes', details: err.message });
  }
});

// POST /api/admin/control/academics/notes - Create academic note with optional file
router.post('/academics/notes', requireAdmin, handleAcademicFileUpload, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const subject = String(req.body.subject || '').trim();
    const chapter = String(req.body.chapter || '').trim();
    const content = String(req.body.content || '').trim();
    const categoryId = toInt(req.body.categoryId);
    const branchId = toInt(req.body.branchId);
    const semesterId = toInt(req.body.semesterId);
    const subjectId = toInt(req.body.subjectId);
    const formatType = String(req.body.formatType || 'pdf').trim();
    const difficulty = String(req.body.difficulty || 'medium').trim();
    const accessType = String(req.body.accessType || 'free').toLowerCase();
    const status = String(req.body.status || 'published').toLowerCase();
    const isCommon = Boolean(req.body.isCommon);

    if (!subject || !chapter) {
      return res.status(400).json({ error: 'Subject and Chapter are required' });
    }

    let pdfUrl = String(req.body.pdfUrl || req.body.pdf_url || req.body.file_url || '').trim() || null;
    if (req.file) {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'academic-content/notes',
        prefix: 'note-file',
        userId: req.session.userId,
        uploadedBy: req.session.userId,
        entityType: 'note_file'
      });
      pdfUrl = stored.url;
    }

    const { rows } = await pool.query(
      `INSERT INTO notes (
        subject, chapter, content, format_type, difficulty,
        category_id, branch_id, semester_id, subject_id,
        access_type, status, is_common, pdf_url, created_by,
        source_type, approval_status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'admin_upload', 'published', CURRENT_TIMESTAMP)
      RETURNING id, subject, chapter, status, access_type, pdf_url, created_at`,
      [
        subject, chapter, content || 'Chapter study notes and reference material.',
        formatType, difficulty, categoryId, branchId, semesterId, subjectId,
        accessType, status, isCommon, pdfUrl, req.session.userId
      ]
    );

    const createdNote = rows[0];
    await writeAuditLog(req, 'academic_notes.create', 'notes', createdNote.id, { subject, chapter, status, accessType });
    publishContentChanged('notes', 'created', createdNote.id, { noteId: createdNote.id, status });

    res.status(201).json({ success: true, message: 'Note created successfully', note: createdNote });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create academic note', details: err.message });
  }
});

// PUT /api/admin/control/academics/notes/:id - Update academic note metadata & file
router.put('/academics/notes/:id', requireAdmin, handleAcademicFileUpload, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const noteId = toInt(req.params.id);
    if (!noteId) return res.status(400).json({ error: 'Invalid note ID' });

    const existingRes = await pool.query("SELECT * FROM notes WHERE id = $1 AND deleted_at IS NULL", [noteId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    const existing = existingRes.rows[0];

    let pdfUrl = existing.pdf_url;
    if (req.file) {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'academic-content/notes',
        prefix: 'note-file-replace',
        userId: req.session.userId,
        uploadedBy: req.session.userId,
        entityType: 'note_file'
      });
      pdfUrl = stored.url;
    } else if (req.body.pdfUrl !== undefined) {
      pdfUrl = String(req.body.pdfUrl || '').trim() || null;
    }

    const subject = req.body.subject !== undefined ? String(req.body.subject).trim() : existing.subject;
    const chapter = req.body.chapter !== undefined ? String(req.body.chapter).trim() : existing.chapter;
    const content = req.body.content !== undefined ? String(req.body.content).trim() : existing.content;
    const categoryId = req.body.categoryId !== undefined ? toInt(req.body.categoryId) : existing.category_id;
    const branchId = req.body.branchId !== undefined ? toInt(req.body.branchId) : existing.branch_id;
    const semesterId = req.body.semesterId !== undefined ? toInt(req.body.semesterId) : existing.semester_id;
    const subjectId = req.body.subjectId !== undefined ? toInt(req.body.subjectId) : existing.subject_id;
    const formatType = req.body.formatType !== undefined ? String(req.body.formatType).trim() : existing.format_type;
    const difficulty = req.body.difficulty !== undefined ? String(req.body.difficulty).trim() : existing.difficulty;
    const accessType = req.body.accessType !== undefined ? String(req.body.accessType).toLowerCase() : existing.access_type;
    const status = req.body.status !== undefined ? String(req.body.status).toLowerCase() : existing.status;
    const isCommon = req.body.isCommon !== undefined ? Boolean(req.body.isCommon) : existing.is_common;

    const { rows } = await pool.query(
      `UPDATE notes SET
        subject = $1,
        chapter = $2,
        content = $3,
        category_id = $4,
        branch_id = $5,
        semester_id = $6,
        subject_id = $7,
        format_type = $8,
        difficulty = $9,
        access_type = $10,
        status = $11,
        is_common = $12,
        pdf_url = $13
       WHERE id = $14
       RETURNING id, subject, chapter, status, access_type, pdf_url, created_at`,
      [subject, chapter, content, categoryId, branchId, semesterId, subjectId, formatType, difficulty, accessType, status, isCommon, pdfUrl, noteId]
    );

    const updatedNote = rows[0];
    await writeAuditLog(req, 'academic_notes.update', 'notes', noteId, { subject, chapter, status, accessType });
    publishContentChanged('notes', 'updated', noteId, { noteId, status });

    res.json({ success: true, message: 'Note updated successfully', note: updatedNote });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update academic note', details: err.message });
  }
});

// DELETE /api/admin/control/academics/notes/:id - Soft delete academic note
router.delete('/academics/notes/:id', requireAdmin, async (req, res) => {
  try {
    const noteId = toInt(req.params.id);
    if (!noteId) return res.status(400).json({ error: 'Invalid note ID' });

    const result = await pool.query(
      "UPDATE notes SET deleted_at = CURRENT_TIMESTAMP, status = 'archived' WHERE id = $1 AND deleted_at IS NULL RETURNING id",
      [noteId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await writeAuditLog(req, 'academic_notes.delete', 'notes', noteId);
    publishContentChanged('notes', 'deleted', noteId, { noteId });

    res.json({ success: true, message: 'Note archived/deleted successfully', id: noteId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete academic note', details: err.message });
  }
});

// PATCH /api/admin/control/academics/notes/:id/status - Change note status
router.patch('/academics/notes/:id/status', requireAdmin, async (req, res) => {
  try {
    const noteId = toInt(req.params.id);
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!noteId || !['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid note ID or status' });
    }

    const { rows } = await pool.query(
      `UPDATE notes SET status = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, subject, chapter, status, access_type, pdf_url`,
      [status, noteId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const updatedNote = rows[0];
    await writeAuditLog(req, 'academic_notes.status_update', 'notes', noteId, { status });
    publishContentChanged('notes', 'status_changed', noteId, { noteId, status });

    res.json({ success: true, message: `Note status updated to ${status}`, note: updatedNote });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update note status', details: err.message });
  }
});


// ============================================================
// 2. ADMIN STUDY MATERIALS MANAGEMENT
// ============================================================

// GET /api/admin/control/academics/materials - Paginated & filtered list of study materials
router.get('/academics/materials', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
    const offset = (page - 1) * limit;

    const statusFilter = String(req.query.status || '').trim().toLowerCase();
    const categoryId = toInt(req.query.categoryId);
    const branchId = toInt(req.query.branchId);
    const semesterId = toInt(req.query.semesterId);
    const subjectId = toInt(req.query.subjectId);
    const search = String(req.query.search || '').trim();

    let whereConditions = ['m.deleted_at IS NULL'];
    let queryParams = [];
    let paramIdx = 1;

    if (statusFilter && statusFilter !== 'all') {
      whereConditions.push(`m.status = $${paramIdx++}`);
      queryParams.push(statusFilter);
    }

    if (categoryId) {
      whereConditions.push(`m.category_id = $${paramIdx++}`);
      queryParams.push(categoryId);
    }

    if (branchId) {
      whereConditions.push(`m.branch_id = $${paramIdx++}`);
      queryParams.push(branchId);
    }

    if (semesterId) {
      whereConditions.push(`m.semester_id = $${paramIdx++}`);
      queryParams.push(semesterId);
    }

    if (subjectId) {
      whereConditions.push(`m.subject_id = $${paramIdx++}`);
      queryParams.push(subjectId);
    }

    if (search) {
      whereConditions.push(`(
        m.title ILIKE $${paramIdx} 
        OR m.subject ILIKE $${paramIdx} 
        OR m.description ILIKE $${paramIdx}
      )`);
      queryParams.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM materials m ${whereClause}`, queryParams);
    const total = countRes.rows[0]?.total || 0;

    const query = `
      SELECT 
        m.id,
        m.title,
        m.category,
        m.subject,
        m.description,
        m.file_url,
        m.access_type,
        m.status,
        m.is_common,
        m.category_id,
        m.branch_id,
        m.semester_id,
        m.subject_id,
        m.created_at,
        ac.name AS category_name,
        ab.name AS branch_name,
        asr.label AS semester_label,
        asub.name AS subject_name,
        u.full_name AS uploaded_by_name
      FROM materials m
      LEFT JOIN academic_categories ac ON ac.id = m.category_id
      LEFT JOIN academic_branches ab ON ab.id = m.branch_id
      LEFT JOIN academic_semesters asr ON asr.id = m.semester_id
      LEFT JOIN academic_subjects asub ON asub.id = m.subject_id
      LEFT JOIN users u ON u.id = m.uploaded_by
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    queryParams.push(limit, offset);
    const { rows } = await pool.query(query, queryParams);

    res.json({
      success: true,
      materials: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch study materials', details: err.message });
  }
});

// POST /api/admin/control/academics/materials - Create study material
router.post('/academics/materials', requireAdmin, handleAcademicFileUpload, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const title = String(req.body.title || '').trim();
    const subject = String(req.body.subject || '').trim();
    const category = String(req.body.category || 'General').trim();
    const description = String(req.body.description || '').trim();
    const categoryId = toInt(req.body.categoryId || req.body.category_id);
    const branchId = toInt(req.body.branchId || req.body.branch_id);
    const semesterId = toInt(req.body.semesterId || req.body.semester_id);
    const subjectId = toInt(req.body.subjectId || req.body.subject_id);
    const accessType = String(req.body.accessType || req.body.access_type || 'free').toLowerCase();
    const status = String(req.body.status || 'published').toLowerCase();
    const isCommon = Boolean(req.body.isCommon || req.body.is_common);

    if (!title || !subject) {
      return res.status(400).json({ error: 'Title and Subject are required' });
    }

    let fileUrl = String(req.body.fileUrl || req.body.file_url || '').trim() || null;
    if (req.file) {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'academic-content/materials',
        prefix: 'material-file',
        userId: req.session.userId,
        uploadedBy: req.session.userId,
        entityType: 'material_file'
      });
      fileUrl = stored.url;
    }

    const { rows } = await pool.query(
      `INSERT INTO materials (
        title, category, subject, description, file_url,
        category_id, branch_id, semester_id, subject_id,
        access_type, status, is_common, uploaded_by,
        source_type, approval_status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'admin_upload', 'published', CURRENT_TIMESTAMP)
      RETURNING id, title, subject, status, access_type, file_url, created_at`,
      [
        title, category, subject, description, fileUrl,
        categoryId, branchId, semesterId, subjectId,
        accessType, status, isCommon, req.session.userId
      ]
    );

    const createdMaterial = rows[0];
    await writeAuditLog(req, 'academic_materials.create', 'materials', createdMaterial.id, { title, subject, status, accessType });
    publishContentChanged('materials', 'created', createdMaterial.id, { materialId: createdMaterial.id, status });

    res.status(201).json({ success: true, message: 'Study material created successfully', material: createdMaterial });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create study material', details: err.message });
  }
});

// PUT /api/admin/control/academics/materials/:id - Update study material metadata & file
router.put('/academics/materials/:id', requireAdmin, handleAcademicFileUpload, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const materialId = toInt(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Invalid material ID' });

    const existingRes = await pool.query("SELECT * FROM materials WHERE id = $1 AND deleted_at IS NULL", [materialId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Material not found' });
    }
    const existing = existingRes.rows[0];

    let fileUrl = existing.file_url;
    if (req.file) {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'academic-content/materials',
        prefix: 'material-file-replace',
        userId: req.session.userId,
        uploadedBy: req.session.userId,
        entityType: 'material_file'
      });
      fileUrl = stored.url;
    } else if (req.body.fileUrl !== undefined) {
      fileUrl = String(req.body.fileUrl || '').trim() || null;
    }

    const title = req.body.title !== undefined ? String(req.body.title).trim() : existing.title;
    const category = req.body.category !== undefined ? String(req.body.category).trim() : existing.category;
    const subject = req.body.subject !== undefined ? String(req.body.subject).trim() : existing.subject;
    const description = req.body.description !== undefined ? String(req.body.description).trim() : existing.description;
    const categoryId = req.body.categoryId !== undefined ? toInt(req.body.categoryId) : existing.category_id;
    const branchId = req.body.branchId !== undefined ? toInt(req.body.branchId) : existing.branch_id;
    const semesterId = req.body.semesterId !== undefined ? toInt(req.body.semesterId) : existing.semester_id;
    const subjectId = req.body.subjectId !== undefined ? toInt(req.body.subjectId) : existing.subject_id;
    const accessType = req.body.accessType !== undefined ? String(req.body.accessType).toLowerCase() : existing.access_type;
    const status = req.body.status !== undefined ? String(req.body.status).toLowerCase() : existing.status;
    const isCommon = req.body.isCommon !== undefined ? Boolean(req.body.isCommon) : existing.is_common;

    const { rows } = await pool.query(
      `UPDATE materials SET
        title = $1,
        category = $2,
        subject = $3,
        description = $4,
        category_id = $5,
        branch_id = $6,
        semester_id = $7,
        subject_id = $8,
        access_type = $9,
        status = $10,
        is_common = $11,
        file_url = $12
       WHERE id = $13
       RETURNING id, title, subject, status, access_type, file_url, created_at`,
      [title, category, subject, description, categoryId, branchId, semesterId, subjectId, accessType, status, isCommon, fileUrl, materialId]
    );

    const updatedMaterial = rows[0];
    await writeAuditLog(req, 'academic_materials.update', 'materials', materialId, { title, subject, status, accessType });
    publishContentChanged('materials', 'updated', materialId, { materialId, status });

    res.json({ success: true, message: 'Study material updated successfully', material: updatedMaterial });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update study material', details: err.message });
  }
});

// DELETE /api/admin/control/academics/materials/:id - Soft delete study material
router.delete('/academics/materials/:id', requireAdmin, async (req, res) => {
  try {
    const materialId = toInt(req.params.id);
    if (!materialId) return res.status(400).json({ error: 'Invalid material ID' });

    const result = await pool.query(
      "UPDATE materials SET deleted_at = CURRENT_TIMESTAMP, status = 'archived' WHERE id = $1 AND deleted_at IS NULL RETURNING id",
      [materialId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Material not found' });
    }

    await writeAuditLog(req, 'academic_materials.delete', 'materials', materialId);
    publishContentChanged('materials', 'deleted', materialId, { materialId });

    res.json({ success: true, message: 'Study material archived/deleted successfully', id: materialId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete study material', details: err.message });
  }
});

// PATCH /api/admin/control/academics/materials/:id/status - Change material status
router.patch('/academics/materials/:id/status', requireAdmin, async (req, res) => {
  try {
    const materialId = toInt(req.params.id);
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!materialId || !['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid material ID or status' });
    }

    const { rows } = await pool.query(
      `UPDATE materials SET status = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, title, subject, status, access_type, file_url`,
      [status, materialId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Material not found' });
    }

    const updatedMaterial = rows[0];
    await writeAuditLog(req, 'academic_materials.status_update', 'materials', materialId, { status });
    publishContentChanged('materials', 'status_changed', materialId, { materialId, status });

    res.json({ success: true, message: `Material status updated to ${status}`, material: updatedMaterial });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update material status', details: err.message });
  }
});


// ============================================================
// 3. ADMIN PREVIOUS PAPERS MANAGEMENT
// ============================================================

// GET /api/admin/control/academics/previous-papers - Paginated & filtered list of previous papers
router.get('/academics/previous-papers', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const page = Math.max(1, toInt(req.query.page, 1));
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
    const offset = (page - 1) * limit;

    const statusFilter = String(req.query.status || '').trim().toLowerCase();
    const year = toInt(req.query.year);
    const categoryId = toInt(req.query.categoryId);
    const branchId = toInt(req.query.branchId);
    const semesterId = toInt(req.query.semesterId);
    const subjectId = toInt(req.query.subjectId);
    const search = String(req.query.search || '').trim();

    let whereConditions = ['pp.deleted_at IS NULL'];
    let queryParams = [];
    let paramIdx = 1;

    if (statusFilter && statusFilter !== 'all') {
      whereConditions.push(`pp.status = $${paramIdx++}`);
      queryParams.push(statusFilter);
    }

    if (year) {
      whereConditions.push(`pp.year = $${paramIdx++}`);
      queryParams.push(year);
    }

    if (categoryId) {
      whereConditions.push(`pp.category_id = $${paramIdx++}`);
      queryParams.push(categoryId);
    }

    if (branchId) {
      whereConditions.push(`pp.branch_id = $${paramIdx++}`);
      queryParams.push(branchId);
    }

    if (semesterId) {
      whereConditions.push(`pp.semester_id = $${paramIdx++}`);
      queryParams.push(semesterId);
    }

    if (subjectId) {
      whereConditions.push(`pp.subject_id = $${paramIdx++}`);
      queryParams.push(subjectId);
    }

    if (search) {
      whereConditions.push(`(
        pp.subject ILIKE $${paramIdx} 
        OR pp.exam_name ILIKE $${paramIdx}
      )`);
      queryParams.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM previous_papers pp ${whereClause}`, queryParams);
    const total = countRes.rows[0]?.total || 0;

    const query = `
      SELECT 
        pp.id,
        pp.subject,
        pp.exam_name,
        pp.year,
        pp.paper_url,
        pp.summary_note_url,
        pp.access_type,
        pp.status,
        pp.is_common,
        pp.category_id,
        pp.branch_id,
        pp.semester_id,
        pp.subject_id,
        pp.created_at,
        ac.name AS category_name,
        ab.name AS branch_name,
        asr.label AS semester_label,
        asub.name AS subject_name,
        u.full_name AS uploaded_by_name
      FROM previous_papers pp
      LEFT JOIN academic_categories ac ON ac.id = pp.category_id
      LEFT JOIN academic_branches ab ON ab.id = pp.branch_id
      LEFT JOIN academic_semesters asr ON asr.id = pp.semester_id
      LEFT JOIN academic_subjects asub ON asub.id = pp.subject_id
      LEFT JOIN users u ON u.id = pp.uploaded_by
      ${whereClause}
      ORDER BY pp.year DESC, pp.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    queryParams.push(limit, offset);
    const { rows } = await pool.query(query, queryParams);

    res.json({
      success: true,
      papers: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch previous papers', details: err.message });
  }
});

// POST /api/admin/control/academics/previous-papers - Create previous paper
router.post('/academics/previous-papers', requireAdmin, handleAcademicFileUpload, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const subject = String(req.body.subject || '').trim();
    const examName = String(req.body.examName || req.body.exam_name || 'Final Semester Exam').trim();
    const year = toInt(req.body.year, new Date().getFullYear());
    const categoryId = toInt(req.body.categoryId || req.body.category_id);
    const branchId = toInt(req.body.branchId || req.body.branch_id);
    const semesterId = toInt(req.body.semesterId || req.body.semester_id);
    const subjectId = toInt(req.body.subjectId || req.body.subject_id);
    const accessType = String(req.body.accessType || req.body.access_type || 'free').toLowerCase();
    const status = String(req.body.status || 'published').toLowerCase();
    const isCommon = Boolean(req.body.isCommon || req.body.is_common);

    if (!subject || !examName) {
      return res.status(400).json({ error: 'Subject and Exam Name are required' });
    }

    let paperUrl = String(req.body.paperUrl || req.body.paper_url || req.body.file_url || '').trim() || null;
    if (req.file) {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'academic-content/papers',
        prefix: 'paper-file',
        userId: req.session.userId,
        uploadedBy: req.session.userId,
        entityType: 'paper_file'
      });
      paperUrl = stored.url;
    }

    const { rows } = await pool.query(
      `INSERT INTO previous_papers (
        subject, exam_name, year, paper_url,
        category_id, branch_id, semester_id, subject_id,
        access_type, status, is_common, uploaded_by,
        source_type, approval_status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'admin_upload', 'published', CURRENT_TIMESTAMP)
      RETURNING id, subject, exam_name, year, status, access_type, paper_url, created_at`,
      [
        subject, examName, year, paperUrl,
        categoryId, branchId, semesterId, subjectId,
        accessType, status, isCommon, req.session.userId
      ]
    );

    const createdPaper = rows[0];
    await writeAuditLog(req, 'academic_papers.create', 'previous_papers', createdPaper.id, { subject, examName, year, status, accessType });
    publishContentChanged('previous_papers', 'created', createdPaper.id, { paperId: createdPaper.id, status });

    res.status(201).json({ success: true, message: 'Previous paper created successfully', paper: createdPaper });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create previous paper', details: err.message });
  }
});

// PUT /api/admin/control/academics/previous-papers/:id - Update previous paper metadata & file
router.put('/academics/previous-papers/:id', requireAdmin, handleAcademicFileUpload, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const paperId = toInt(req.params.id);
    if (!paperId) return res.status(400).json({ error: 'Invalid paper ID' });

    const existingRes = await pool.query("SELECT * FROM previous_papers WHERE id = $1 AND deleted_at IS NULL", [paperId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Previous paper not found' });
    }
    const existing = existingRes.rows[0];

    let paperUrl = existing.paper_url;
    if (req.file) {
      const stored = await saveUploadedFile({
        file: req.file,
        folder: 'academic-content/papers',
        prefix: 'paper-file-replace',
        userId: req.session.userId,
        uploadedBy: req.session.userId,
        entityType: 'paper_file'
      });
      paperUrl = stored.url;
    } else if (req.body.paperUrl !== undefined) {
      paperUrl = String(req.body.paperUrl || '').trim() || null;
    }

    const subject = req.body.subject !== undefined ? String(req.body.subject).trim() : existing.subject;
    const examName = req.body.examName !== undefined ? String(req.body.examName).trim() : existing.exam_name;
    const year = req.body.year !== undefined ? toInt(req.body.year, existing.year) : existing.year;
    const categoryId = req.body.categoryId !== undefined ? toInt(req.body.categoryId) : existing.category_id;
    const branchId = req.body.branchId !== undefined ? toInt(req.body.branchId) : existing.branch_id;
    const semesterId = req.body.semesterId !== undefined ? toInt(req.body.semesterId) : existing.semester_id;
    const subjectId = req.body.subjectId !== undefined ? toInt(req.body.subjectId) : existing.subject_id;
    const accessType = req.body.accessType !== undefined ? String(req.body.accessType).toLowerCase() : existing.access_type;
    const status = req.body.status !== undefined ? String(req.body.status).toLowerCase() : existing.status;
    const isCommon = req.body.isCommon !== undefined ? Boolean(req.body.isCommon) : existing.is_common;

    const { rows } = await pool.query(
      `UPDATE previous_papers SET
        subject = $1,
        exam_name = $2,
        year = $3,
        category_id = $4,
        branch_id = $5,
        semester_id = $6,
        subject_id = $7,
        access_type = $8,
        status = $9,
        is_common = $10,
        paper_url = $11
       WHERE id = $12
       RETURNING id, subject, exam_name, year, status, access_type, paper_url, created_at`,
      [subject, examName, year, categoryId, branchId, semesterId, subjectId, accessType, status, isCommon, paperUrl, paperId]
    );

    const updatedPaper = rows[0];
    await writeAuditLog(req, 'academic_papers.update', 'previous_papers', paperId, { subject, examName, status, accessType });
    publishContentChanged('previous_papers', 'updated', paperId, { paperId, status });

    res.json({ success: true, message: 'Previous paper updated successfully', paper: updatedPaper });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update previous paper', details: err.message });
  }
});

// DELETE /api/admin/control/academics/previous-papers/:id - Soft delete previous paper
router.delete('/academics/previous-papers/:id', requireAdmin, async (req, res) => {
  try {
    const paperId = toInt(req.params.id);
    if (!paperId) return res.status(400).json({ error: 'Invalid paper ID' });

    const result = await pool.query(
      "UPDATE previous_papers SET deleted_at = CURRENT_TIMESTAMP, status = 'archived' WHERE id = $1 AND deleted_at IS NULL RETURNING id",
      [paperId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Previous paper not found' });
    }

    await writeAuditLog(req, 'academic_papers.delete', 'previous_papers', paperId);
    publishContentChanged('previous_papers', 'deleted', paperId, { paperId });

    res.json({ success: true, message: 'Previous paper archived/deleted successfully', id: paperId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete previous paper', details: err.message });
  }
});

// PATCH /api/admin/control/academics/previous-papers/:id/status - Change previous paper status
router.patch('/academics/previous-papers/:id/status', requireAdmin, async (req, res) => {
  try {
    const paperId = toInt(req.params.id);
    const status = String(req.body.status || '').trim().toLowerCase();
    if (!paperId || !['draft', 'published', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Invalid paper ID or status' });
    }

    const { rows } = await pool.query(
      `UPDATE previous_papers SET status = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, subject, exam_name, status, access_type, paper_url`,
      [status, paperId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Paper not found' });
    }

    const updatedPaper = rows[0];
    await writeAuditLog(req, 'academic_papers.status_update', 'previous_papers', paperId, { status });
    publishContentChanged('previous_papers', 'status_changed', paperId, { paperId, status });

    res.json({ success: true, message: `Paper status updated to ${status}`, paper: updatedPaper });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update paper status', details: err.message });
  }
});


// ============================================================
// 4. BULK CONTENT INGESTION ENGINE
// ============================================================

// POST /api/admin/control/academics/bulk-upload - Bulk ingest notes, materials, or papers
router.post('/academics/bulk-upload', requireAdmin, async (req, res) => {
  try {
    await ensureMembershipSchema();
    const contentType = String(req.body.contentType || req.body.target_type || 'notes').toLowerCase();
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!items.length) {
      return res.status(400).json({ error: 'No items provided in items array' });
    }

    let successCount = 0;
    let failureCount = 0;
    const errors = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        if (contentType === 'notes') {
          const subject = String(item.subject || '').trim();
          const chapter = String(item.chapter || item.title || '').trim();
          if (!subject || !chapter) {
            throw new Error('Row missing required subject or chapter');
          }
          await pool.query(
            `INSERT INTO notes (
              subject, chapter, content, difficulty, format_type,
              category_id, branch_id, semester_id, subject_id,
              access_type, status, is_common, pdf_url, created_by,
              source_type, approval_status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'admin_upload', 'published', CURRENT_TIMESTAMP)`,
            [
              subject,
              chapter,
              item.content || 'Bulk imported chapter study note.',
              item.difficulty || 'medium',
              item.formatType || item.format_type || 'pdf',
              toInt(item.categoryId || item.category_id),
              toInt(item.branchId || item.branch_id),
              toInt(item.semesterId || item.semester_id),
              toInt(item.subjectId || item.subject_id),
              String(item.accessType || item.access_type || 'free').toLowerCase(),
              String(item.status || 'published').toLowerCase(),
              Boolean(item.isCommon || item.is_common),
              item.pdfUrl || item.pdf_url || item.file_url || null,
              req.session.userId
            ]
          );
        } else if (contentType === 'materials') {
          const title = String(item.title || '').trim();
          const subject = String(item.subject || '').trim();
          if (!title || !subject) {
            throw new Error('Row missing required title or subject');
          }
          await pool.query(
            `INSERT INTO materials (
              title, category, subject, description, file_url,
              category_id, branch_id, semester_id, subject_id,
              access_type, status, is_common, uploaded_by,
              source_type, approval_status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'admin_upload', 'published', CURRENT_TIMESTAMP)`,
            [
              title,
              item.category || 'General',
              subject,
              item.description || '',
              item.fileUrl || null,
              toInt(item.categoryId),
              toInt(item.branchId),
              toInt(item.semesterId),
              toInt(item.subjectId),
              String(item.accessType || 'free').toLowerCase(),
              String(item.status || 'published').toLowerCase(),
              Boolean(item.isCommon),
              req.session.userId
            ]
          );
        } else if (contentType === 'papers') {
          const subject = String(item.subject || '').trim();
          const examName = String(item.examName || 'Final Semester Exam').trim();
          if (!subject) {
            throw new Error('Row missing required subject');
          }
          await pool.query(
            `INSERT INTO previous_papers (
              subject, exam_name, year, paper_url,
              category_id, branch_id, semester_id, subject_id,
              access_type, status, is_common, uploaded_by,
              source_type, approval_status, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'admin_upload', 'published', CURRENT_TIMESTAMP)`,
            [
              subject,
              examName,
              toInt(item.year, new Date().getFullYear()),
              item.paperUrl || null,
              toInt(item.categoryId),
              toInt(item.branchId),
              toInt(item.semesterId),
              toInt(item.subjectId),
              String(item.accessType || 'free').toLowerCase(),
              String(item.status || 'published').toLowerCase(),
              Boolean(item.isCommon),
              req.session.userId
            ]
          );
        }
        successCount++;
      } catch (itemErr) {
        failureCount++;
        errors.push({ index: i, item, error: itemErr.message });
      }
    }

    await writeAuditLog(req, 'academic_content.bulk_upload', 'academic_content', null, { contentType, successCount, failureCount });

    res.json({
      success: true,
      contentType,
      processedCount: items.length,
      processed_count: items.length,
      successCount,
      success_count: successCount,
      failureCount,
      failure_count: failureCount,
      errors
    });
  } catch (err) {
    res.status(500).json({ error: 'Bulk content ingestion failed', details: err.message });
  }
});

module.exports = router;
