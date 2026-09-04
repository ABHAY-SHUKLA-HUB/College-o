-- College OS Content Source Architecture Refactoring
-- Separates admin-uploaded content from student-contributed content
-- While maintaining unified student library experience

-- ============================================
-- 1. ADD SOURCE_TYPE TO CONTENT TABLES
-- ============================================

ALTER TABLE notes ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) DEFAULT 'admin_upload';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) DEFAULT 'published';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS contributor_notes TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS semester_id INTEGER;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS subject_id INTEGER;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS category_id INTEGER;

-- Create index for efficient filtering by source
CREATE INDEX IF NOT EXISTS notes_source_type_idx ON notes(source_type, status);
CREATE INDEX IF NOT EXISTS notes_source_approval_idx ON notes(source_type, approval_status);

-- Previous Papers: Track source
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) DEFAULT 'admin_upload';
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) DEFAULT 'published';
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS contributor_id INTEGER REFERENCES users(id);
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS moderation_notes TEXT;

CREATE INDEX IF NOT EXISTS previous_papers_source_type_idx ON previous_papers(source_type, created_at DESC);
CREATE INDEX IF NOT EXISTS previous_papers_source_approval_idx ON previous_papers(source_type, approval_status);

-- Materials: Track source
ALTER TABLE materials ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) DEFAULT 'admin_upload';
ALTER TABLE materials ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) DEFAULT 'published';
ALTER TABLE materials ADD COLUMN IF NOT EXISTS contributor_id INTEGER REFERENCES users(id);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS materials_source_type_idx ON materials(source_type);
CREATE INDEX IF NOT EXISTS materials_source_approval_idx ON materials(source_type, approval_status);


-- ============================================
-- 2. ENHANCE ACADEMIC CONTRIBUTIONS VIEW
-- ============================================

-- Ensure academic_contributions has source tracking (for audit)
ALTER TABLE academic_contributions ADD COLUMN IF NOT EXISTS merged_to_note_id INTEGER REFERENCES notes(id);
ALTER TABLE academic_contributions ADD COLUMN IF NOT EXISTS merged_to_paper_id INTEGER REFERENCES previous_papers(id);
ALTER TABLE academic_contributions ADD COLUMN IF NOT EXISTS merged_to_material_id INTEGER REFERENCES materials(id);


-- ============================================
-- 3. CONTENT VISIBILITY/QUALITY TRACKING
-- ============================================

-- Track quality and visibility for student library merging
CREATE TABLE IF NOT EXISTS content_source_config (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_type VARCHAR(40) NOT NULL,
  content_type VARCHAR(40),
  is_mergeable_in_student_view BOOLEAN DEFAULT TRUE,
  requires_approval_for_visibility BOOLEAN DEFAULT FALSE,
  default_visibility VARCHAR(40) DEFAULT 'published',
  quality_threshold_percent INTEGER DEFAULT 0,
  featured_boost_multiplier NUMERIC(3,2) DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS content_source_config_type_idx
ON content_source_config (content_type, source_type);

-- Pre-populate source configs
INSERT INTO content_source_config 
  (source_type, content_type, is_mergeable_in_student_view, requires_approval_for_visibility, default_visibility)
VALUES 
  ('admin_upload', 'notes', TRUE, FALSE, 'published'),
  ('student_contribution', 'notes', TRUE, TRUE, 'pending'),
  ('admin_upload', 'papers', TRUE, FALSE, 'published'),
  ('student_contribution', 'papers', TRUE, TRUE, 'pending'),
  ('admin_upload', 'materials', TRUE, FALSE, 'published'),
  ('student_contribution', 'materials', TRUE, TRUE, 'pending')
ON CONFLICT (content_type, source_type) DO NOTHING;


-- ============================================
-- 4. STUDENT LIBRARY UNIFIED VIEW
-- ============================================

-- Create a unified view for student-facing content
-- This combines approved content from both sources
-- Students do NOT see the source distinction unless explicitly useful

CREATE OR REPLACE VIEW unified_student_notes AS
SELECT 
  n.id,
  n.subject,
  n.chapter,
  n.content,
  n.difficulty,
  n.format_type,
  n.source_type,
  n.approval_status,
  CASE 
    WHEN n.source_type = 'admin_upload' THEN 'Official Resource'
    WHEN n.source_type = 'student_contribution' THEN 'Community Resource'
    ELSE 'Resource'
  END as resource_badge,
  n.is_premium,
  n.created_at,
  n.created_by,
  u.full_name as creator_name,
  n.college_name,
  n.branch_id,
  n.semester_id,
  n.subject_id,
  n.category_id
FROM notes n
LEFT JOIN users u ON u.id = n.created_by
WHERE n.status = 'published' 
  AND n.approval_status IN ('published', 'approved')
  AND n.source_type IN ('admin_upload', 'student_contribution')
ORDER BY 
  CASE WHEN n.source_type = 'admin_upload' THEN 1 ELSE 2 END,
  n.created_at DESC;


CREATE OR REPLACE VIEW unified_student_papers AS
SELECT 
  pp.id,
  pp.subject,
  pp.exam_name,
  pp.year,
  pp.paper_url,
  pp.source_type,
  pp.approval_status,
  CASE 
    WHEN pp.source_type = 'admin_upload' THEN 'Official Resource'
    WHEN pp.source_type = 'student_contribution' THEN 'Community Resource'
    ELSE 'Resource'
  END as resource_badge,
  pp.created_at,
  COALESCE(pp.uploaded_by, pp.contributor_id) as uploader_id,
  u.full_name as uploader_name,
  pp.college_name
FROM previous_papers pp
LEFT JOIN users u ON u.id = COALESCE(pp.uploaded_by, pp.contributor_id)
WHERE pp.approval_status IN ('published', 'approved')
  AND pp.source_type IN ('admin_upload', 'student_contribution')
ORDER BY 
  CASE WHEN pp.source_type = 'admin_upload' THEN 1 ELSE 2 END,
  pp.created_at DESC;


-- ============================================
-- 5. UPDATE EXISTING ROWS (MIGRATION)
-- ============================================

-- Mark any content created by admins as admin_upload
UPDATE notes 
SET source_type = 'admin_upload', approval_status = 'published'
WHERE source_type = 'admin_upload' AND created_by IS NOT NULL;

UPDATE previous_papers 
SET source_type = 'admin_upload', approval_status = 'published'
WHERE source_type = 'admin_upload' AND uploaded_by IS NOT NULL;

UPDATE materials 
SET source_type = 'admin_upload', approval_status = 'published'
WHERE source_type = 'admin_upload' AND uploaded_by IS NOT NULL;
