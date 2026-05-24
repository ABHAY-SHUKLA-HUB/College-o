-- College OS schema (core + new additions)

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  college_name VARCHAR(180),
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  subject VARCHAR(120) NOT NULL,
  chapter VARCHAR(150),
  difficulty VARCHAR(20),
  question_count INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS quizzes_unique_subject_chapter
ON quizzes (subject, chapter);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id),
  score_percent NUMERIC(5,2),
  xp_earned INTEGER DEFAULT 0,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mock_tests (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title VARCHAR(180) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  total_marks INTEGER NOT NULL,
  scheduled_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS mock_tests_unique_title
ON mock_tests (title);

CREATE TABLE IF NOT EXISTS mock_test_attempts (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  mock_test_id INTEGER NOT NULL REFERENCES mock_tests(id),
  marks_obtained INTEGER,
  percentile NUMERIC(5,2),
  rank_india INTEGER,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Requested new tables
CREATE TABLE IF NOT EXISTS roadmaps (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  roadmap_data JSONB NOT NULL,
  progress NUMERIC(5,2) DEFAULT 0,
  goals JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  subject VARCHAR(120) NOT NULL,
  chapter VARCHAR(160) NOT NULL,
  content TEXT NOT NULL,
  user_notes TEXT,
  bookmarks JSONB,
  difficulty VARCHAR(20),
  format_type VARCHAR(30),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS certificates (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type VARCHAR(80) NOT NULL,
  issued_date DATE NOT NULL,
  certificate_url TEXT,
  verification_code VARCHAR(100) UNIQUE NOT NULL,
  blockchain_txn_hash VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_icons (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  preferences JSONB,
  icon_size VARCHAR(20) DEFAULT 'medium',
  icon_style VARCHAR(30) DEFAULT 'fontawesome',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(30) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'student';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(20) NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stream VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS year_of_study VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'pending';
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expiry TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile VARCHAR(24);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_mobile_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS university_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS university_name VARCHAR(220);
ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_university VARCHAR(220);

CREATE UNIQUE INDEX IF NOT EXISTS users_mobile_unique_idx
ON users (mobile)
WHERE mobile IS NOT NULL;

CREATE TABLE IF NOT EXISTS session (
  sid varchar NOT NULL COLLATE "default",
  sess json NOT NULL,
  expire timestamp(6) NOT NULL,
  CONSTRAINT session_pkey PRIMARY KEY (sid)
)
WITH (OIDS=FALSE);

CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

CREATE TABLE IF NOT EXISTS colleges (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name VARCHAR(180) NOT NULL UNIQUE,
  city VARCHAR(120),
  state VARCHAR(120)
);

CREATE TABLE IF NOT EXISTS universities (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name VARCHAR(220) NOT NULL UNIQUE,
  country_code VARCHAR(12) NOT NULL DEFAULT 'IN',
  state VARCHAR(120),
  city VARCHAR(120),
  campus VARCHAR(160),
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority_rank INTEGER NOT NULL DEFAULT 999,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS universities_priority_idx
ON universities (is_enabled, is_featured DESC, priority_rank ASC, name ASC);

CREATE TABLE IF NOT EXISTS user_profiles (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  current_streak INTEGER DEFAULT 0,
  target_exam VARCHAR(60),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS course_branch VARCHAR(120);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS semester VARCHAR(40);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS career_interest VARCHAR(200);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS weak_subjects JSONB;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_study_mode VARCHAR(50);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  referrer_user_id INTEGER NOT NULL REFERENCES users(id),
  referred_user_id INTEGER NOT NULL REFERENCES users(id),
  code_used VARCHAR(30) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'successful',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (referrer_user_id, referred_user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  kind VARCHAR(40) DEFAULT 'general',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS forum_threads (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(220) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS previous_papers (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  subject VARCHAR(120) NOT NULL,
  exam_name VARCHAR(120) NOT NULL,
  year INTEGER NOT NULL,
  paper_url TEXT,
  summary_note_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_challenges (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL,
  xp_reward INTEGER DEFAULT 0,
  active_date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS badges (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name VARCHAR(120) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  icon VARCHAR(80)
);

CREATE TABLE IF NOT EXISTS user_badges (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  badge_id INTEGER NOT NULL REFERENCES badges(id),
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  issue_type VARCHAR(60) NOT NULL,
  priority VARCHAR(20) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_name VARCHAR(40) NOT NULL,
  amount_inr NUMERIC(10,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  start_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_name VARCHAR(40) NOT NULL,
  amount_inr NUMERIC(10,2) NOT NULL,
  payment_id VARCHAR(80) UNIQUE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'initiated',
  gateway_payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upi_payment_requests (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  payment_ref VARCHAR(80) UNIQUE NOT NULL,
  plan_cycle VARCHAR(20) NOT NULL,
  amount_inr NUMERIC(10,2) NOT NULL,
  upi_id VARCHAR(120) NOT NULL,
  upi_uri TEXT NOT NULL,
  qr_image_url TEXT,
  transaction_id VARCHAR(120),
  status VARCHAR(30) NOT NULL DEFAULT 'initiated',
  gateway_payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS membership_payment_requests (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL,
  payment_method VARCHAR(60) NOT NULL,
  transaction_id VARCHAR(120) NOT NULL,
  screenshot_url TEXT,
  payment_date DATE NOT NULL,
  amount_inr NUMERIC(10,2) NOT NULL DEFAULT 49,
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at TIMESTAMP,
  expiry_date TIMESTAMP,
  approved_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS membership_payment_unique_txn
ON membership_payment_requests (transaction_id);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  message TEXT NOT NULL,
  screenshot_url TEXT,
  admin_reply TEXT,
  replied_by INTEGER REFERENCES users(id),
  replied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE notes ADD COLUMN IF NOT EXISTS college_name VARCHAR(180);
ALTER TABLE notes ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS college_name VARCHAR(180);
ALTER TABLE previous_papers ADD COLUMN IF NOT EXISTS uploaded_by INTEGER REFERENCES users(id);

CREATE UNIQUE INDEX IF NOT EXISTS daily_challenges_unique_date
ON daily_challenges (active_date);

INSERT INTO colleges (name, city, state)
VALUES
  ('IIT Delhi', 'New Delhi', 'Delhi'),
  ('IIT Bombay', 'Mumbai', 'Maharashtra'),
  ('SRCC', 'New Delhi', 'Delhi'),
  ('Christ University', 'Bengaluru', 'Karnataka'),
  ('VIT Vellore', 'Vellore', 'Tamil Nadu'),
  ('Delhi University', 'New Delhi', 'Delhi'),
  ('Chandigarh University Mohali', 'Mohali', 'Punjab'),
  ('Chandigarh University UP', 'Lucknow', 'Uttar Pradesh')
ON CONFLICT (name) DO NOTHING;

INSERT INTO quizzes (subject, chapter, difficulty, question_count)
VALUES
  ('Data Structures', 'Trees', 'medium', 20),
  ('Data Structures', 'Graphs', 'hard', 20),
  ('DBMS', 'Normalization', 'medium', 20),
  ('Financial Accounting', 'Journal Entries', 'easy', 20),
  ('Corporate Accounting', 'Final Accounts', 'medium', 20)
ON CONFLICT DO NOTHING;

-- Additional tables for admin management features
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL,
  subject VARCHAR(120) NOT NULL,
  description TEXT,
  file_url TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_quizzes (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title VARCHAR(200) NOT NULL,
  subject VARCHAR(120) NOT NULL,
  description TEXT,
  time_limit INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_quiz_questions (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  quiz_id INTEGER NOT NULL REFERENCES admin_quizzes(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_answer VARCHAR(1) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
  question_order INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_certificates (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title VARCHAR(200) NOT NULL,
  course VARCHAR(120) NOT NULL,
  student_email VARCHAR(180),
  issue_date DATE NOT NULL,
  description TEXT,
  issued_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS certificate_type VARCHAR(120);
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS achievement_name VARCHAR(200);
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS score_rank VARCHAR(80);
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS certificate_id VARCHAR(120);
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS organization_name VARCHAR(160);
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS signatory_name VARCHAR(160);
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS template_name VARCHAR(40) DEFAULT 'Classic';
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Draft';
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS assigned_student_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS issued_count INTEGER DEFAULT 0;
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS verification_id VARCHAR(120);
ALTER TABLE admin_certificates ADD COLUMN IF NOT EXISTS is_bulk BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS admin_certificate_issuances (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  admin_certificate_id INTEGER NOT NULL REFERENCES admin_certificates(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  certificate_id INTEGER REFERENCES certificates(id) ON DELETE SET NULL,
  verification_code VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'Issued',
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP,
  revoked_at TIMESTAMP,
  UNIQUE (admin_certificate_id, user_id)
);

CREATE TABLE IF NOT EXISTS live_sessions (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  session_id VARCHAR(120) NOT NULL UNIQUE,
  title VARCHAR(220) NOT NULL,
  description TEXT,
  mentor_id INTEGER REFERENCES users(id),
  mentor_email VARCHAR(180),
  mentor_name VARCHAR(180) NOT NULL,
  session_type VARCHAR(40) NOT NULL DEFAULT 'mentorship',
  provider VARCHAR(20) NOT NULL DEFAULT 'jitsi',
  room_name VARCHAR(180) NOT NULL,
  channel_name VARCHAR(180) NOT NULL,
  host_code_hash VARCHAR(255) NOT NULL,
  host_code_last4 VARCHAR(8),
  host_code_attempts INTEGER NOT NULL DEFAULT 0,
  host_code_locked_until TIMESTAMP,
  scheduled_start TIMESTAMP NOT NULL,
  scheduled_end TIMESTAMP NOT NULL,
  actual_start TIMESTAMP,
  actual_end TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  mentor_status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  created_by_admin INTEGER REFERENCES users(id),
  max_participants INTEGER NOT NULL DEFAULT 100,
  participant_count INTEGER NOT NULL DEFAULT 0,
  cancelled_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS live_sessions_session_id_idx
ON live_sessions (session_id);

CREATE INDEX IF NOT EXISTS live_sessions_schedule_idx
ON live_sessions (status, scheduled_start, scheduled_end);

CREATE INDEX IF NOT EXISTS live_sessions_mentor_email_idx
ON live_sessions (mentor_email, scheduled_start);

CREATE INDEX IF NOT EXISTS live_sessions_mentor_id_idx
ON live_sessions (mentor_id, scheduled_start);

CREATE TABLE IF NOT EXISTS live_session_participants (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  user_email VARCHAR(180),
  user_name VARCHAR(180),
  role VARCHAR(20) NOT NULL DEFAULT 'student',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP,
  connection_state VARCHAR(20) NOT NULL DEFAULT 'joined',
  meta JSONB,
  UNIQUE (live_session_id, user_id)
);

CREATE INDEX IF NOT EXISTS live_session_participants_session_idx
ON live_session_participants (live_session_id, left_at);

CREATE INDEX IF NOT EXISTS live_session_participants_user_idx
ON live_session_participants (user_id, joined_at);

CREATE TABLE IF NOT EXISTS live_session_logs (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  live_session_id INTEGER NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id),
  actor_role VARCHAR(30),
  action VARCHAR(50) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS live_session_logs_session_idx
ON live_session_logs (live_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS live_session_logs_action_idx
ON live_session_logs (action, created_at DESC);

-- Dashboard Configuration Tables (New)
-- Defines available dashboard sections and their default state
CREATE TABLE IF NOT EXISTS dashboard_sections (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  section_key VARCHAR(80) NOT NULL UNIQUE,
  section_name VARCHAR(150) NOT NULL,
  icon VARCHAR(120),
  description TEXT,
  is_enabled BOOLEAN DEFAULT TRUE,
  is_removable BOOLEAN DEFAULT TRUE,
  default_position INTEGER DEFAULT 0,
  category VARCHAR(50) DEFAULT 'main',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Controls visibility and ordering of sections per branch/membership
CREATE TABLE IF NOT EXISTS dashboard_section_visibility (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  section_id INTEGER NOT NULL REFERENCES dashboard_sections(id) ON DELETE CASCADE,
  branch_id VARCHAR(80),
  membership_tier VARCHAR(30),
  is_visible BOOLEAN DEFAULT TRUE,
  position_order INTEGER,
  title_override VARCHAR(150),
  description_override TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_section_visibility_unique_scope
ON dashboard_section_visibility (section_id, COALESCE(branch_id, ''), COALESCE(membership_tier, ''));

-- Admin-published announcements and banners
CREATE TABLE IF NOT EXISTS dashboard_announcements (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title VARCHAR(250) NOT NULL,
  message TEXT NOT NULL,
  banner_type VARCHAR(40) DEFAULT 'info',
  target_branches JSONB,
  target_tiers JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  position INTEGER DEFAULT 0,
  icon VARCHAR(120),
  action_url TEXT,
  action_label VARCHAR(100),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Hero section customization
CREATE TABLE IF NOT EXISTS dashboard_hero_config (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title VARCHAR(250) NOT NULL,
  subtitle VARCHAR(300),
  featured_message TEXT,
  featured_image_url TEXT,
  featured_roadmap_id INTEGER,
  cta_primary_label VARCHAR(100),
  cta_primary_url VARCHAR(300),
  cta_secondary_label VARCHAR(100),
  cta_secondary_url VARCHAR(300),
  background_gradient VARCHAR(300),
  is_active BOOLEAN DEFAULT TRUE,
  branch_id VARCHAR(80),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stats card customization
CREATE TABLE IF NOT EXISTS dashboard_stats_config (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  stat_key VARCHAR(80) NOT NULL,
  stat_label VARCHAR(150) NOT NULL,
  icon VARCHAR(120),
  gradient_color VARCHAR(300),
  is_enabled BOOLEAN DEFAULT TRUE,
  is_visible_free BOOLEAN DEFAULT TRUE,
  is_visible_premium BOOLEAN DEFAULT TRUE,
  position_order INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (stat_key)
);

-- Recommended content management
CREATE TABLE IF NOT EXISTS dashboard_recommendations (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  content_type VARCHAR(50) NOT NULL,
  content_id INTEGER,
  title VARCHAR(200),
  branch_id VARCHAR(80),
  membership_tier VARCHAR(30),
  is_featured BOOLEAN DEFAULT FALSE,
  position_order INTEGER,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Quick access card configuration
CREATE TABLE IF NOT EXISTS dashboard_quick_access (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  card_key VARCHAR(80) NOT NULL UNIQUE,
  card_label VARCHAR(100) NOT NULL,
  icon VARCHAR(120),
  description VARCHAR(300),
  url VARCHAR(300),
  is_enabled BOOLEAN DEFAULT TRUE,
  is_visible_free BOOLEAN DEFAULT TRUE,
  is_visible_premium BOOLEAN DEFAULT TRUE,
  position_order INTEGER DEFAULT 0,
  can_customize BOOLEAN DEFAULT TRUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI tools visibility and configuration
CREATE TABLE IF NOT EXISTS dashboard_ai_tools_config (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  tool_id INTEGER,
  is_shown_on_dashboard BOOLEAN DEFAULT TRUE,
  is_premium_only BOOLEAN DEFAULT FALSE,
  target_branches JSONB,
  position_order INTEGER,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_roadmaps (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  title VARCHAR(200) NOT NULL,
  track VARCHAR(80) NOT NULL,
  level VARCHAR(30),
  duration VARCHAR(60),
  description TEXT,
  steps JSONB NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO mock_tests (title, duration_minutes, total_marks)
VALUES
  ('GATE CSE Grand Test 1', 180, 200),
  ('GATE CSE Grand Test 2', 180, 200),
  ('B.Com Accounting Mock 1', 90, 100)
ON CONFLICT DO NOTHING;

INSERT INTO previous_papers (subject, exam_name, year, paper_url, summary_note_url)
VALUES
  ('Computer Science', 'GATE CSE', 2024, '#', 'notes-library.html'),
  ('Commerce', 'B.Com Taxation', 2023, '#', 'notes-library.html')
ON CONFLICT DO NOTHING;

INSERT INTO daily_challenges (title, description, xp_reward, active_date)
VALUES
  ('Daily Mixed Quiz', '5 MCQs + 1 formula flash challenge', 120, CURRENT_DATE)
ON CONFLICT DO NOTHING;

INSERT INTO badges (name, description, icon)
VALUES
  ('Streak Starter', 'Maintain a 7-day streak', 'fa-fire'),
  ('Mock Warrior', 'Attempt 10 mock tests', 'fa-flask'),
  ('Formula Ninja', 'Review 50 note sets', 'fa-square-root-variable')
ON CONFLICT (name) DO NOTHING;

-- Premium Mock Test Extensions
ALTER TABLE mock_tests
  ADD COLUMN IF NOT EXISTS category_key VARCHAR(40) DEFAULT 'grand',
  ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20) DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS total_questions INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS syllabus TEXT,
  ADD COLUMN IF NOT EXISTS instructions TEXT,
  ADD COLUMN IF NOT EXISTS attempt_limit_free INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS retake_allowed BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS explanations_visible BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS marks_per_question NUMERIC(6,2) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS negative_marking_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS negative_marks NUMERIC(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS section_config JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

ALTER TABLE mock_test_attempts
  ADD COLUMN IF NOT EXISTS total_questions INTEGER,
  ADD COLUMN IF NOT EXISTS correct_answers INTEGER,
  ADD COLUMN IF NOT EXISTS wrong_answers INTEGER,
  ADD COLUMN IF NOT EXISTS skipped_answers INTEGER,
  ADD COLUMN IF NOT EXISTS accuracy_percent NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS time_spent_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS total_possible_marks NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS answers_json JSONB,
  ADD COLUMN IF NOT EXISTS section_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS topic_breakdown JSONB;

CREATE TABLE IF NOT EXISTS mock_test_questions (
  id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  mock_test_id INTEGER NOT NULL REFERENCES mock_tests(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type VARCHAR(30) NOT NULL DEFAULT 'single_mcq',
  difficulty VARCHAR(20) DEFAULT 'medium',
  section_name VARCHAR(120),
  subject VARCHAR(120),
  topic VARCHAR(160),
  marks NUMERIC(6,2) DEFAULT 1,
  negative_marks NUMERIC(6,2) DEFAULT 0,
  explanation TEXT,
  options_json JSONB,
  correct_answer_json JSONB NOT NULL,
  order_no INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS mock_test_questions_test_idx ON mock_test_questions(mock_test_id, order_no);
CREATE INDEX IF NOT EXISTS mock_test_attempts_user_test_idx ON mock_test_attempts(user_id, mock_test_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_created ON quiz_attempts (user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_created_by_created_at ON notes (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certificates_user_created ON certificates (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roadmaps_user_updated ON roadmaps (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_membership_payments_status_submitted ON membership_payment_requests (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_academic_categories_active_order ON academic_categories (is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_academic_branches_category_active_order ON academic_branches (category_id, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_academic_semesters_active_order ON academic_semesters (is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_announcements_status_branch_created ON announcements (status, branch_id, created_at DESC);
