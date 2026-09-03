-- College OS Content Quality & Verification Architecture
-- Implements startup-grade content experience with source abstraction

-- ============================================
-- 1. CONTENT QUALITY & VERIFICATION SCHEMA
-- ============================================

-- Tracks content verification status (replaces source exposure)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS verification_date TIMESTAMP;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 50;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS usefulness_votes INTEGER DEFAULT 0;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT FALSE;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS verification_badge VARCHAR(40); -- verified | recommended | high-quality | exam-focused

ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS verification_date TIMESTAMP;
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 50;
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS usefulness_votes INTEGER DEFAULT 0;
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT FALSE;
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS verification_badge VARCHAR(40);
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS exam_focused BOOLEAN DEFAULT FALSE;

ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS verification_date TIMESTAMP;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 50;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS usefulness_votes INTEGER DEFAULT 0;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT FALSE;
ALTER TABLE materials ADD COLUMN IF NOT EXISTS verification_badge VARCHAR(40);

-- Admin-uploaded content gets verified automatically
CREATE OR REPLACE TRIGGER auto_verify_admin_content_notes
BEFORE INSERT ON notes
FOR EACH ROW
BEGIN
  IF NEW.source_type = 'admin_upload' THEN
    NEW.is_verified = TRUE;
    NEW.verification_date = CURRENT_TIMESTAMP;
    NEW.quality_score = 85; -- High baseline for official content
    NEW.verification_badge = 'verified';
  END IF;
END;

-- ============================================
-- 2. CONTENT PRIORITY RANKING SYSTEM
-- ============================================

CREATE TABLE IF NOT EXISTS content_ranking_config (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  rank_for_source VARCHAR(40), -- 'student' | 'admin' | null (applies to all)
  content_type VARCHAR(40), -- 'notes' | 'papers' | 'materials'
  priority_order INTEGER,
  rank_attributes JSONB NOT NULL DEFAULT '{
    "is_verified": 50,
    "is_recommended": 40,
    "quality_score": 30,
    "usefulness_votes": 20,
    "recent_boost": 10
  }'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pre-populate ranking rules (quality-based, not source-based)
INSERT INTO content_ranking_config
  (rank_for_source, content_type, priority_order, rank_attributes)
VALUES
  (NULL, 'notes', 1, '{
    "is_verified": 50,
    "is_recommended": 40,
    "quality_score": 30,
    "usefulness_votes": 20,
    "downloads_in_month": 15
  }'::jsonb),
  (NULL, 'papers', 1, '{
    "is_verified": 50,
    "exam_focused": 40,
    "quality_score": 30,
    "usefulness_votes": 20,
    "year": 10
  }'::jsonb),
  (NULL, 'materials', 1, '{
    "is_verified": 50,
    "is_recommended": 40,
    "quality_score": 30,
    "usefulness_votes": 25
  }'::jsonb)
ON CONFLICT DO NOTHING;


-- ============================================
-- 3. REMOVE SOURCE_TYPE FROM STUDENT VIEWS
-- ============================================

-- Replace old unified views with source-abstracted versions
DROP VIEW IF EXISTS unified_student_notes;
CREATE OR REPLACE VIEW unified_student_notes AS
SELECT 
  n.id,
  n.subject,
  n.chapter,
  n.content,
  n.difficulty,
  n.format_type,
  n.pdf_url,
  n.is_premium,
  n.created_at,
  n.is_verified,
  n.quality_score,
  n.usefulness_votes,
  n.is_recommended,
  n.verification_badge,
  n.branch_id,
  n.semester_id,
  n.subject_id,
  n.category_id,
  CASE 
    WHEN n.is_recommended THEN 'Recommended Resource'
    WHEN n.is_verified THEN 'Verified Resource'
    WHEN n.quality_score >= 75 THEN 'High Quality'
    ELSE 'Quality Resource'
  END as content_label,
  COALESCE((n.download_count::NUMERIC / NULLIF((NOW() - n.created_at), INTERVAL '0 days'))::NUMERIC, 0) as engagement_score
FROM notes n
WHERE n.status = 'published' 
  AND n.approval_status IN ('published', 'approved')
  AND n.source_type IN ('admin_upload', 'student_contribution')
ORDER BY 
  n.is_verified DESC,
  n.is_recommended DESC,
  n.quality_score DESC,
  n.usefulness_votes DESC,
  n.created_at DESC;

DROP VIEW IF EXISTS unified_student_papers;
CREATE OR REPLACE VIEW unified_student_papers AS
SELECT 
  pp.id,
  pp.subject,
  pp.exam_name,
  pp.year,
  pp.paper_url,
  pp.summary_note_url,
  pp.created_at,
  pp.is_verified,
  pp.quality_score,
  pp.usefulness_votes,
  pp.is_recommended,
  pp.exam_focused,
  pp.verification_badge,
  pp.college_name,
  CASE 
    WHEN pp.is_recommended THEN 'Recommended Paper'
    WHEN pp.exam_focused THEN 'Exam Focused'
    WHEN pp.is_verified THEN 'Verified Resource'
    WHEN pp.quality_score >= 75 THEN 'High Quality'
    ELSE 'Quality Resource'
  END as content_label
FROM previous_papers pp
WHERE pp.approval_status IN ('published', 'approved')
  AND pp.source_type IN ('admin_upload', 'student_contribution')
ORDER BY 
  pp.exam_focused DESC,
  pp.is_verified DESC,
  pp.is_recommended DESC,
  pp.quality_score DESC,
  pp.usefulness_votes DESC,
  pp.year DESC;

-- ============================================
-- 4. ADMIN CONTRIBUTION STRUCTURE
-- ============================================

-- Admin can see full source and contributor details
DROP VIEW IF EXISTS admin_student_contributions_view;
CREATE OR REPLACE VIEW admin_student_contributions_view AS
SELECT 
  'notes' as content_type,
  n.id,
  n.subject,
  n.chapter as title,
  n.source_type,
  n.approval_status,
  CASE 
    WHEN n.approval_status = 'pending' THEN 'Pending'
    WHEN n.approval_status = 'approved' THEN 'Approved'
    WHEN n.approval_status = 'rejected' THEN 'Rejected'
    WHEN n.moderation_notes LIKE '%correction%' THEN 'Needs Correction'
    ELSE 'Review'
  END as contribution_status,
  CASE 
    WHEN n.quality_score < 40 THEN 'Risk'
    WHEN n.quality_score < 60 THEN 'Review'
    WHEN n.quality_score < 80 THEN 'Good'
    ELSE 'Excellent'
  END as quality_level,
  n.created_at as submitted_at,
  u.full_name as contributor_name,
  u.email as contributor_email,
  u.id as contributor_id,
  u.contribution_points,
  u.contributor_level
FROM notes n
LEFT JOIN users u ON u.id = n.created_by
WHERE n.source_type = 'student_contribution'

UNION ALL

SELECT 
  'papers' as content_type,
  pp.id,
  pp.subject,
  pp.exam_name || ' ' || pp.year,
  pp.source_type,
  pp.approval_status,
  CASE 
    WHEN pp.approval_status = 'pending' THEN 'Pending'
    WHEN pp.approval_status = 'approved' THEN 'Approved'
    WHEN pp.approval_status = 'rejected' THEN 'Rejected'
    WHEN pp.moderation_notes LIKE '%correction%' THEN 'Needs Correction'
    ELSE 'Review'
  END as contribution_status,
  CASE 
    WHEN pp.quality_score < 40 THEN 'Risk'
    WHEN pp.quality_score < 60 THEN 'Review'
    WHEN pp.quality_score < 80 THEN 'Good'
    ELSE 'Excellent'
  END as quality_level,
  pp.created_at,
  u.full_name,
  u.email,
  u.id,
  u.contribution_points,
  u.contributor_level
FROM previous_papers pp
LEFT JOIN users u ON u.id = pp.contributor_id
WHERE pp.source_type = 'student_contribution';


-- ============================================
-- 5. AUTO-ASSIGN VERIFICATION BADGES
-- ============================================

-- Function to compute verification badge (ALWAYS done by quality, NEVER by source)
CREATE OR REPLACE FUNCTION update_verification_badge_notes()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_verified AND NEW.is_recommended THEN
    NEW.verification_badge := 'recommended';
  ELSIF NEW.is_verified THEN
    NEW.verification_badge := 'verified';
  ELSIF NEW.quality_score >= 80 THEN
    NEW.verification_badge := 'high-quality';
  ELSIF NEW.usefulness_votes >= 10 THEN
    NEW.verification_badge := 'helpful';
  ELSE
    NEW.verification_badge := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notes_update_badge ON notes;
CREATE TRIGGER notes_update_badge BEFORE UPDATE ON notes FOR EACH ROW
EXECUTE FUNCTION update_verification_badge_notes();

-- Similar for papers
CREATE OR REPLACE FUNCTION update_verification_badge_papers()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.exam_focused AND NEW.is_verified THEN
    NEW.verification_badge := 'exam-focused';
  ELSIF NEW.is_verified AND NEW.is_recommended THEN
    NEW.verification_badge := 'recommended';
  ELSIF NEW.is_verified THEN
    NEW.verification_badge := 'verified';
  ELSIF NEW.quality_score >= 80 THEN
    NEW.verification_badge := 'high-quality';
  ELSE
    NEW.verification_badge := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS papers_update_badge ON previous_papers;
CREATE TRIGGER papers_update_badge BEFORE UPDATE ON previous_papers FOR EACH ROW
EXECUTE FUNCTION update_verification_badge_papers();


-- ============================================
-- 6. CONTRIBUTION STATUS STRUCTURE
-- ============================================

-- Update student contribution records to have clear status
UPDATE notes
SET approval_status = 'approved', is_verified = TRUE, quality_score = GREATEST(80, quality_score)
WHERE source_type = 'student_contribution' AND approval_status IN ('published', 'approved')
AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days';

-- Recent submissions stay pending if not manually reviewed
UPDATE notes
SET approval_status = 'pending'
WHERE source_type = 'student_contribution' AND approval_status IS NULL;

-- Set contribution status labels based on moderation_notes
UPDATE notes
SET contributor_notes = 'Please add more detailed explanation'
WHERE source_type = 'student_contribution' AND approval_status = 'rejected' AND contributor_notes IS NULL;
