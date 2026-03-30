-- College OS Academic Content Architecture Migration
-- Adds branch/course-based content segregation

-- ============================================
-- 1. ACADEMIC CLASSIFICATION TABLES
-- ============================================

-- Academic Categories (Engineering, Commerce)
CREATE TABLE IF NOT EXISTS academic_categories (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name VARCHAR(100) NOT NULL UNIQUE,
  label VARCHAR(50),
  description TEXT,
  display_order INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Academic Branches/Courses (CS, IT, Mechanical, B.Com, BBA, etc.)
CREATE TABLE IF NOT EXISTS academic_branches (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  category_id INTEGER NOT NULL REFERENCES academic_categories(id),
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  label VARCHAR(50),
  description TEXT,
  display_order INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (category_id, code)
);

-- Academic Semesters/Years
CREATE TABLE IF NOT EXISTS academic_semesters (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  semester_number INTEGER NOT NULL,
  year_number INTEGER,
  label VARCHAR(50) NOT NULL,
  description TEXT,
  display_order INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (semester_number)
);

-- Academic Subjects
CREATE TABLE IF NOT EXISTS academic_subjects (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  branch_id INTEGER NOT NULL REFERENCES academic_branches(id),
  semester_id INTEGER REFERENCES academic_semesters(id),
  name VARCHAR(150) NOT NULL,
  code VARCHAR(50),
  description TEXT,
  credits INTEGER,
  display_order INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. EXTEND USER_PROFILES WITH ACADEMIC FIELDS
-- ============================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS career_interest VARCHAR(200);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS weak_subjects JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_study_mode VARCHAR(50);

-- ============================================
-- 3. EXTEND CONTENT TABLES WITH ACADEMIC TAGGING
-- ============================================

-- Notes
ALTER TABLE notes ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES academic_subjects(id);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS academic_subject VARCHAR(120);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT FALSE;

-- Quizzes
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES academic_subjects(id);
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free';
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT FALSE;

-- Mock Tests
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free';
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
ALTER TABLE mock_tests ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT FALSE;

-- Previous Papers
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES academic_subjects(id);
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free';
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT FALSE;

-- Roadmaps
ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS title VARCHAR(200);
ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE roadmaps ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';

-- Certificates
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS is_branch_specific BOOLEAN DEFAULT FALSE;

-- Notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_branch_specific BOOLEAN DEFAULT FALSE;

-- Materials
ALTER TABLE materials ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES academic_branches(id);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS semester_id INTEGER REFERENCES academic_semesters(id);
ALTER TABLE materials ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free';
ALTER TABLE materials ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_common BOOLEAN DEFAULT FALSE;

-- ============================================
-- 4. ANALYTICS TABLE FOR BRANCH-WISE DATA
-- ============================================

CREATE TABLE IF NOT EXISTS academic_analytics (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  category_id INTEGER REFERENCES academic_categories(id),
  branch_id INTEGER REFERENCES academic_branches(id),
  metric_type VARCHAR(50) NOT NULL,
  metric_value INTEGER DEFAULT 0,
  recorded_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 5. SEED ACADEMIC DATA
-- ============================================

-- Insert Academic Categories
INSERT INTO academic_categories (name, label, description, display_order)
VALUES
  ('Engineering', 'Branch', 'Engineering discipline', 1),
  ('Commerce', 'Course', 'Commerce discipline', 2)
ON CONFLICT (name) DO NOTHING;

-- Insert Academic Branches for Engineering
INSERT INTO academic_branches (category_id, code, name, label, description, display_order)
SELECT ac.id, 'CS', 'Computer Science', 'CS', 'Computer Science & Engineering', 1
FROM academic_categories ac WHERE ac.name = 'Engineering'
UNION ALL
SELECT ac.id, 'IT', 'Information Technology', 'IT', 'Information Technology', 2
FROM academic_categories ac WHERE ac.name = 'Engineering'
UNION ALL
SELECT ac.id, 'ME', 'Mechanical Engineering', 'ME', 'Mechanical Engineering', 3
FROM academic_categories ac WHERE ac.name = 'Engineering'
UNION ALL
SELECT ac.id, 'CE', 'Civil Engineering', 'CE', 'Civil Engineering', 4
FROM academic_categories ac WHERE ac.name = 'Engineering'
UNION ALL
SELECT ac.id, 'EE', 'Electrical Engineering', 'EE', 'Electrical Engineering', 5
FROM academic_categories ac WHERE ac.name = 'Engineering'
UNION ALL
SELECT ac.id, 'EC', 'Electronics Engineering', 'EC', 'Electronics & Communication', 6
FROM academic_categories ac WHERE ac.name = 'Engineering'
ON CONFLICT (category_id, code) DO NOTHING;

-- Insert Academic Branches for Commerce
INSERT INTO academic_branches (category_id, code, name, label, description, display_order)
SELECT ac.id, 'BCOM', 'B.Com', 'B.Com', 'Bachelor of Commerce', 1
FROM academic_categories ac WHERE ac.name = 'Commerce'
UNION ALL
SELECT ac.id, 'BBA', 'BBA', 'BBA', 'Bachelor of Business Administration', 2
FROM academic_categories ac WHERE ac.name = 'Commerce'
UNION ALL
SELECT ac.id, 'ECON', 'Economics', 'ECON', 'B.A. Economics', 3
FROM academic_categories ac WHERE ac.name = 'Commerce'
UNION ALL
SELECT ac.id, 'ACC', 'Accounts', 'ACC', 'B.Com Accounts', 4
FROM academic_categories ac WHERE ac.name = 'Commerce'
ON CONFLICT (category_id, code) DO NOTHING;

-- Insert Academic Semesters
INSERT INTO academic_semesters (semester_number, year_number, label, description, display_order)
VALUES
  (1, 1, 'Semester 1', 'First Semester - Year 1', 1),
  (2, 1, 'Semester 2', 'Second Semester - Year 1', 2),
  (3, 2, 'Semester 3', 'Third Semester - Year 2', 3),
  (4, 2, 'Semester 4', 'Fourth Semester - Year 2', 4),
  (5, 3, 'Semester 5', 'Fifth Semester - Year 3', 5),
  (6, 3, 'Semester 6', 'Sixth Semester - Year 3', 6),
  (7, 4, 'Semester 7', 'Seventh Semester - Year 4', 7),
  (8, 4, 'Semester 8', 'Eighth Semester - Year 4', 8)
ON CONFLICT (semester_number) DO NOTHING;

-- ============================================
-- 6. CREATE INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_notes_branch_semester ON notes(branch_id, semester_id);
CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_branch_semester ON quizzes(branch_id, semester_id);
CREATE INDEX IF NOT EXISTS idx_quizzes_category ON quizzes(category_id);
CREATE INDEX IF NOT EXISTS idx_mock_tests_branch ON mock_tests(branch_id);
CREATE INDEX IF NOT EXISTS idx_papers_branch_semester ON previous_papers(branch_id, semester_id);
CREATE INDEX IF NOT EXISTS idx_user_profile_branch ON user_profiles(branch_id);
CREATE INDEX IF NOT EXISTS idx_academic_subjects_branch ON academic_subjects(branch_id);

-- ============================================
-- 7. 24/7 STUDENT SUPPORT SYSTEM TABLES
-- ============================================

-- Main support requests table with strict academic isolation
CREATE TABLE IF NOT EXISTS support_requests (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  request_uuid UUID UNIQUE NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES academic_categories(id),
  branch_id INTEGER NOT NULL REFERENCES academic_branches(id),
  semester_id INTEGER NOT NULL REFERENCES academic_semesters(id),
  university_id INTEGER,
  college_name VARCHAR(180),
  
  -- Request content
  title VARCHAR(250) NOT NULL,
  description TEXT NOT NULL,
  request_category VARCHAR(80) NOT NULL,
  subject VARCHAR(150),
  urgency_level VARCHAR(20) DEFAULT 'medium',
  
  -- Status tracking
  status VARCHAR(30) DEFAULT 'open',
  solved_at TIMESTAMP,
  marked_helpful_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  
  -- Accepted answer tracking
  accepted_answer_id INTEGER,
  
  -- File/media attachments
  attachment_urls JSONB DEFAULT '[]'::jsonb,
  image_urls JSONB DEFAULT '[]'::jsonb,
  meet_link VARCHAR(300),
  
  -- Quality metrics
  quality_score INTEGER DEFAULT 100,
  is_flagged BOOLEAN DEFAULT FALSE,
  abuse_reason VARCHAR(200),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Support answers/replies with strict isolation enforcement
CREATE TABLE IF NOT EXISTS support_answers (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  answer_uuid UUID UNIQUE NOT NULL,
  request_id INTEGER NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  answerer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Copy academic fields for fast filtering (isolation check)
  category_id INTEGER NOT NULL REFERENCES academic_categories(id),
  branch_id INTEGER NOT NULL REFERENCES academic_branches(id),
  semester_id INTEGER NOT NULL REFERENCES academic_semesters(id),
  
  -- Answer content
  content TEXT NOT NULL,
  explanation_detail TEXT,
  
  -- Quality/engagement
  helpful_count INTEGER DEFAULT 0,
  unhelpful_count INTEGER DEFAULT 0,
  is_accepted BOOLEAN DEFAULT FALSE,
  accepted_at TIMESTAMP,
  
  -- File/media for answers
  attachment_urls JSONB DEFAULT '[]'::jsonb,
  image_urls JSONB DEFAULT '[]'::jsonb,
  meet_link VARCHAR(300),
  
  -- Quality metrics
  quality_score INTEGER DEFAULT 100,
  is_flagged BOOLEAN DEFAULT FALSE,
  abuse_reason VARCHAR(200),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Helper reputation and statistics
CREATE TABLE IF NOT EXISTS helper_reputation (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  helper_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  
  -- Statistics
  total_answers INTEGER DEFAULT 0,
  accepted_answers INTEGER DEFAULT 0,
  helpful_answers INTEGER DEFAULT 0,
  total_points_earned INTEGER DEFAULT 0,
  
  -- Reputation levels/badges
  reputation_level VARCHAR(50) DEFAULT 'New Helper',
  total_helping_hours NUMERIC(10,2) DEFAULT 0,
  
  -- Abuse/quality tracking
  spam_reports INTEGER DEFAULT 0,
  report_ratio NUMERIC(5,2) DEFAULT 0,
  
  -- Last activity
  last_answer_at TIMESTAMP,
  
  -- Qualification tracking
  verified_helper BOOLEAN DEFAULT FALSE,
  verification_badge VARCHAR(50),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tag system for categorization
CREATE TABLE IF NOT EXISTS support_request_tags (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  request_id INTEGER NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
  tag VARCHAR(80) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quality and spam detection metrics
CREATE TABLE IF NOT EXISTS support_quality_metrics (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric_type VARCHAR(50) NOT NULL,
  metric_value INTEGER DEFAULT 0,
  metric_reason VARCHAR(150),
  
  recorded_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Helpful vote tracking (one vote per user per answer)
CREATE TABLE IF NOT EXISTS support_answer_votes (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  answer_id INTEGER NOT NULL REFERENCES support_answers(id) ON DELETE CASCADE,
  voter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote_type VARCHAR(20) NOT NULL,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (answer_id, voter_id)
);

-- Admin moderation queue
CREATE TABLE IF NOT EXISTS support_moderation_queue (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  request_id INTEGER REFERENCES support_requests(id) ON DELETE CASCADE,
  answer_id INTEGER REFERENCES support_answers(id) ON DELETE CASCADE,
  
  report_type VARCHAR(50) NOT NULL,
  reported_by INTEGER REFERENCES users(id),
  report_reason TEXT,
  
  status VARCHAR(30) DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  review_action VARCHAR(50),
  review_notes TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 8. ISOLATION ENFORCEMENT - INDEXES & CONSTRAINTS
-- ============================================

-- Strict isolation indexes (college, branch, semester)
CREATE INDEX IF NOT EXISTS idx_support_requests_isolation 
ON support_requests(category_id, branch_id, semester_id);

CREATE INDEX IF NOT EXISTS idx_support_requests_user 
ON support_requests(user_id, category_id, branch_id, semester_id);

CREATE INDEX IF NOT EXISTS idx_support_requests_status 
ON support_requests(status, category_id, branch_id, semester_id);

CREATE INDEX IF NOT EXISTS idx_support_answers_isolation 
ON support_answers(request_id, category_id, branch_id, semester_id);

CREATE INDEX IF NOT EXISTS idx_support_answers_answerer 
ON support_answers(answerer_id, category_id, branch_id, semester_id);

CREATE INDEX IF NOT EXISTS idx_support_answer_votes 
ON support_answer_votes(answer_id, voter_id);

CREATE INDEX IF NOT EXISTS idx_helper_reputation 
ON helper_reputation(helper_id, total_points_earned);

CREATE INDEX IF NOT EXISTS idx_support_request_tags 
ON support_request_tags(tag, request_id);

CREATE INDEX IF NOT EXISTS idx_support_quality_metrics 
ON support_quality_metrics(user_id, metric_type);

-- ============================================
-- 9. EXTEND USER_PROFILES WITH SUPPORT FIELDS
-- ============================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS support_points_earned INTEGER DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_helper BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS helper_badge VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_helper BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS helper_level VARCHAR(50) DEFAULT 'none';
