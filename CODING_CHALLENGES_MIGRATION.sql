-- =================================================================
-- COLLEGE OS: CODING CHALLENGES MODULE MIGRATION (PART 1 FOUNDATION)
-- Safe, Idempotent Database Schema & Row Level Security (RLS) Policies
-- =================================================================

-- Ensure required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. CODING MODULE SETTINGS (Global Feature Toggle)
CREATE TABLE IF NOT EXISTS coding_module_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  module_enabled BOOLEAN NOT NULL DEFAULT false,
  leaderboard_enabled BOOLEAN NOT NULL DEFAULT true,
  certificates_enabled BOOLEAN NOT NULL DEFAULT true,
  strict_mode_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- Insert default single global configuration row if missing (Disabled by default)
INSERT INTO coding_module_settings (id, module_enabled, leaderboard_enabled, certificates_enabled, strict_mode_default)
VALUES (1, false, true, true, false)
ON CONFLICT (id) DO NOTHING;

-- 2. CODING CONTESTS
CREATE TABLE IF NOT EXISTS coding_contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  instructions TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'live', 'completed', 'pending_review', 'finalized', 'cancelled')),
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER DEFAULT 60,
  registration_required BOOLEAN DEFAULT false,
  leaderboard_visible BOOLEAN DEFAULT true,
  strict_mode_enabled BOOLEAN DEFAULT false,
  certificate_enabled BOOLEAN DEFAULT false,
  allowed_languages JSONB DEFAULT '["python", "javascript", "cpp", "java"]'::jsonb,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. CODING PROBLEMS
CREATE TABLE IF NOT EXISTS coding_problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID REFERENCES coding_contests(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  statement TEXT NOT NULL,
  input_format TEXT,
  output_format TEXT,
  constraints TEXT,
  difficulty VARCHAR(20) NOT NULL DEFAULT 'Easy' CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  max_score INTEGER DEFAULT 100,
  order_index INTEGER DEFAULT 0,
  starter_code JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4. CODING PROBLEM EXAMPLES (Public Samples Only)
CREATE TABLE IF NOT EXISTS coding_problem_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID REFERENCES coding_problems(id) ON DELETE CASCADE,
  sample_input TEXT NOT NULL,
  sample_output TEXT NOT NULL,
  explanation TEXT,
  order_index INTEGER DEFAULT 0
);

-- 5. CODING TEST CASES (Includes Hidden Test Cases)
CREATE TABLE IF NOT EXISTS coding_test_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID REFERENCES coding_problems(id) ON DELETE CASCADE,
  input_data TEXT NOT NULL,
  expected_output TEXT NOT NULL,
  is_hidden BOOLEAN DEFAULT true,
  weight INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. CODING PARTICIPANTS
CREATE TABLE IF NOT EXISTS coding_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID REFERENCES coding_contests(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) DEFAULT 'registered',
  CONSTRAINT unique_contest_participant UNIQUE (contest_id, student_id)
);

-- 7. CODING SUBMISSIONS
CREATE TABLE IF NOT EXISTS coding_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID REFERENCES coding_contests(id) ON DELETE CASCADE,
  problem_id UUID REFERENCES coding_problems(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  language VARCHAR(50) NOT NULL,
  source_code TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'accepted', 'wrong_answer', 'time_limit_exceeded', 'memory_limit_exceeded', 'runtime_error', 'compilation_error', 'internal_error')),
  score INTEGER DEFAULT 0,
  execution_time DOUBLE PRECISION DEFAULT 0,
  memory_used INTEGER DEFAULT 0,
  submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  is_best_submission BOOLEAN DEFAULT false,
  judge_submission_id VARCHAR(255)
);

-- 8. CODING LEADERBOARD
CREATE TABLE IF NOT EXISTS coding_leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID REFERENCES coding_contests(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  total_score INTEGER DEFAULT 0,
  problems_solved INTEGER DEFAULT 0,
  penalty_time INTEGER DEFAULT 0,
  rank INTEGER DEFAULT 0,
  last_score_update TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_contest_leaderboard UNIQUE (contest_id, student_id)
);

-- 9. CODING INTEGRITY EVENTS (Proctoring & Anti-Cheat Events)
CREATE TABLE IF NOT EXISTS coding_integrity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID REFERENCES coding_contests(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 10. CODING CERTIFICATES
CREATE TABLE IF NOT EXISTS coding_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID REFERENCES coding_contests(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  rank INTEGER,
  certificate_number VARCHAR(100) UNIQUE NOT NULL,
  verification_token VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'pending_review', 'pending_approval', 'approved', 'revoked')),
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 11. CODING SIMILARITY RESULTS (Plagiarism Engine Analysis)
CREATE TABLE IF NOT EXISTS coding_similarity_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID REFERENCES coding_contests(id) ON DELETE CASCADE,
  problem_id UUID REFERENCES coding_problems(id) ON DELETE CASCADE,
  submission_a UUID REFERENCES coding_submissions(id) ON DELETE CASCADE,
  submission_b UUID REFERENCES coding_submissions(id) ON DELETE CASCADE,
  student_a INTEGER REFERENCES users(id) ON DELETE CASCADE,
  student_b INTEGER REFERENCES users(id) ON DELETE CASCADE,
  similarity_score NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  matched_tokens INTEGER DEFAULT 0,
  analysis_version VARCHAR(50) DEFAULT 'v1-winnowing',
  status VARCHAR(50) DEFAULT 'flagged' CHECK (status IN ('flagged', 'reviewed', 'cleared')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_similarity_pair UNIQUE (contest_id, problem_id, submission_a, submission_b)
);

-- 12. CODING CERTIFICATE TEMPLATES (Template Manager)
CREATE TABLE IF NOT EXISTS coding_certificate_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 13. CODING CERTIFICATE TEMPLATE VERSIONS (Template Versioning)
CREATE TABLE IF NOT EXISTS coding_certificate_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES coding_certificate_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_template_version UNIQUE (template_id, version_number)
);

-- ALTER TABLES FOR SCHEMA EXTENSIONS
ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS position_text VARCHAR(100);
ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES coding_certificate_templates(id) ON DELETE SET NULL;
ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS template_version_id UUID REFERENCES coding_certificate_template_versions(id) ON DELETE SET NULL;
ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS configuration_snapshot JSONB DEFAULT '{}'::jsonb;
ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE coding_certificates ADD COLUMN IF NOT EXISTS revoke_reason TEXT;

ALTER TABLE coding_contests ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE coding_contests ADD COLUMN IF NOT EXISTS finalized_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE coding_contests ADD COLUMN IF NOT EXISTS certificate_template_id UUID REFERENCES coding_certificate_templates(id) ON DELETE SET NULL;

-- =================================================================
-- INDEXES FOR PERFORMANCE & FAST LOOKUPS
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_coding_contests_status ON coding_contests(status);
CREATE INDEX IF NOT EXISTS idx_coding_problems_contest ON coding_problems(contest_id);
CREATE INDEX IF NOT EXISTS idx_coding_problems_slug ON coding_problems(slug);
CREATE INDEX IF NOT EXISTS idx_coding_examples_problem ON coding_problem_examples(problem_id);
CREATE INDEX IF NOT EXISTS idx_coding_test_cases_problem ON coding_test_cases(problem_id);
CREATE INDEX IF NOT EXISTS idx_coding_participants_contest ON coding_participants(contest_id);
CREATE INDEX IF NOT EXISTS idx_coding_participants_student ON coding_participants(student_id);
CREATE INDEX IF NOT EXISTS idx_coding_submissions_contest ON coding_submissions(contest_id);
CREATE INDEX IF NOT EXISTS idx_coding_similarity_contest ON coding_similarity_results(contest_id);
CREATE INDEX IF NOT EXISTS idx_coding_similarity_problem ON coding_similarity_results(problem_id);
CREATE INDEX IF NOT EXISTS idx_coding_cert_templates_status ON coding_certificate_templates(status);
CREATE INDEX IF NOT EXISTS idx_coding_cert_versions_template ON coding_certificate_template_versions(template_id);

CREATE INDEX IF NOT EXISTS idx_coding_submissions_problem ON coding_submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_coding_submissions_student ON coding_submissions(student_id);
CREATE INDEX IF NOT EXISTS idx_coding_leaderboard_contest ON coding_leaderboard(contest_id);
CREATE INDEX IF NOT EXISTS idx_coding_leaderboard_rank ON coding_leaderboard(contest_id, rank);
CREATE INDEX IF NOT EXISTS idx_coding_integrity_contest ON coding_integrity_events(contest_id);
CREATE INDEX IF NOT EXISTS idx_coding_certificates_student ON coding_certificates(student_id);
CREATE INDEX IF NOT EXISTS idx_coding_certificates_token ON coding_certificates(verification_token);

-- =================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =================================================================
ALTER TABLE coding_module_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_problem_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_leaderboard ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_integrity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_certificate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_certificate_template_versions ENABLE ROW LEVEL SECURITY;

-- 1. Settings: Everyone read; Service/Admin write
DROP POLICY IF EXISTS p_coding_settings_read ON coding_module_settings;
CREATE POLICY p_coding_settings_read ON coding_module_settings FOR SELECT USING (true);

-- 2. Contests: Student can read non-draft; Admin full access
DROP POLICY IF EXISTS p_coding_contests_select ON coding_contests;
CREATE POLICY p_coding_contests_select ON coding_contests FOR SELECT USING (
  status IN ('scheduled', 'live', 'completed', 'finalized')
  OR current_setting('request.jwt.claims', true)::jsonb->>'role' IN ('admin', 'super_admin')
);

-- 3. Problems: Student can read published contest problems; Admin full access
DROP POLICY IF EXISTS p_coding_problems_select ON coding_problems;
CREATE POLICY p_coding_problems_select ON coding_problems FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM coding_contests c
    WHERE c.id = coding_problems.contest_id
      AND c.status IN ('scheduled', 'live', 'completed', 'finalized')
  )
  OR current_setting('request.jwt.claims', true)::jsonb->>'role' IN ('admin', 'super_admin')
);

-- 4. Examples: Student read-only for sample inputs/outputs
DROP POLICY IF EXISTS p_coding_examples_select ON coding_problem_examples;
CREATE POLICY p_coding_examples_select ON coding_problem_examples FOR SELECT USING (true);

-- 5. Test Cases: CRITICAL - Hidden test cases NEVER accessible to students!
DROP POLICY IF EXISTS p_coding_test_cases_select ON coding_test_cases;
CREATE POLICY p_coding_test_cases_select ON coding_test_cases FOR SELECT USING (
  (is_hidden = false)
  OR current_setting('request.jwt.claims', true)::jsonb->>'role' IN ('admin', 'super_admin')
);

-- 6. Submissions: Student read/insert own; Admin full access
DROP POLICY IF EXISTS p_coding_submissions_select ON coding_submissions;
CREATE POLICY p_coding_submissions_select ON coding_submissions FOR SELECT USING (
  student_id::text = current_setting('request.jwt.claims', true)::jsonb->>'sub'
  OR current_setting('request.jwt.claims', true)::jsonb->>'role' IN ('admin', 'super_admin')
);

-- 7. Leaderboard: Everyone read; Service/Admin update
DROP POLICY IF EXISTS p_coding_leaderboard_select ON coding_leaderboard;
CREATE POLICY p_coding_leaderboard_select ON coding_leaderboard FOR SELECT USING (true);

-- 8. Certificates: Student read own approved; Admin full access
DROP POLICY IF EXISTS p_coding_certificates_select ON coding_certificates;
CREATE POLICY p_coding_certificates_select ON coding_certificates FOR SELECT USING (
  (student_id::text = current_setting('request.jwt.claims', true)::jsonb->>'sub' AND status = 'approved')
  OR current_setting('request.jwt.claims', true)::jsonb->>'role' IN ('admin', 'super_admin')
);

-- 9. Similarity Results: Admin full access ONLY; Students blocked
ALTER TABLE coding_similarity_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_coding_similarity_select ON coding_similarity_results;
CREATE POLICY p_coding_similarity_select ON coding_similarity_results FOR SELECT USING (
  current_setting('request.jwt.claims', true)::jsonb->>'role' IN ('admin', 'super_admin')
);

-- 10. Certificate Templates & Versions: Everyone can read active for verification/rendering; Admin write
DROP POLICY IF EXISTS p_coding_templates_select ON coding_certificate_templates;
CREATE POLICY p_coding_templates_select ON coding_certificate_templates FOR SELECT USING (true);

DROP POLICY IF EXISTS p_coding_versions_select ON coding_certificate_template_versions;
CREATE POLICY p_coding_versions_select ON coding_certificate_template_versions FOR SELECT USING (true);


