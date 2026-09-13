/**
 * server/db/part9-schema.js
 * Database schema initialization & repair for Part 9: Quizzes, Mock Tests, Roadmaps, Academic Structure
 */

const { pool } = require('./pool');

let part9SchemaEnsured = false;

async function ensurePart9Schema() {
  if (part9SchemaEnsured) return;

  // 1. Ensure Academic Structure Columns & Tables
  await pool.query(`
    ALTER TABLE academic_subjects
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
  `);

  // 2. Ensure Mock Tests Schema Enhancements
  await pool.query(`
    ALTER TABLE mock_tests
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS subject_id INTEGER,
      ADD COLUMN IF NOT EXISTS question_count INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS start_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS end_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS result_policy VARCHAR(30) DEFAULT 'IMMEDIATE',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS version_no INTEGER DEFAULT 1;

    ALTER TABLE mock_test_attempts
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'SUBMITTED',
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS question_snapshot JSONB,
      ADD COLUMN IF NOT EXISTS is_passed BOOLEAN DEFAULT FALSE;
  `);

  // 3. Ensure Quizzes & Quiz Questions Schema
  await pool.query(`
    ALTER TABLE quizzes
      ADD COLUMN IF NOT EXISTS title VARCHAR(255),
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS total_questions INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 15,
      ADD COLUMN IF NOT EXISTS passing_marks NUMERIC(6,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS attempt_limit INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS result_policy VARCHAR(30) DEFAULT 'IMMEDIATE',
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

    CREATE TABLE IF NOT EXISTS quiz_questions (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      question_text TEXT NOT NULL,
      question_type VARCHAR(30) NOT NULL DEFAULT 'single_mcq',
      difficulty VARCHAR(20) DEFAULT 'medium',
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

    ALTER TABLE quiz_attempts
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'SUBMITTED',
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS marks_obtained NUMERIC(8,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_possible_marks NUMERIC(8,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS answers_json JSONB,
      ADD COLUMN IF NOT EXISTS question_snapshot JSONB,
      ADD COLUMN IF NOT EXISTS is_passed BOOLEAN DEFAULT FALSE;
  `);

  // 4. Ensure Study Roadmaps & Steps Schema
  await pool.query(`
    ALTER TABLE roadmaps
      ADD COLUMN IF NOT EXISTS subject_id INTEGER REFERENCES academic_subjects(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS course_id INTEGER,
      ADD COLUMN IF NOT EXISTS access_type VARCHAR(30) DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMP;

    CREATE TABLE IF NOT EXISTS roadmap_steps (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      roadmap_id INTEGER NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      step_order INTEGER DEFAULT 0,
      resource_type VARCHAR(40) NOT NULL,
      resource_id INTEGER,
      resource_url TEXT,
      is_required BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS student_roadmap_progress (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      roadmap_id INTEGER NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
      step_id INTEGER NOT NULL REFERENCES roadmap_steps(id) ON DELETE CASCADE,
      status VARCHAR(30) DEFAULT 'completed',
      completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_student_roadmap_step UNIQUE(student_id, roadmap_id, step_id)
    );
  `);

  // 5. Create Performance Indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_mock_tests_status_published ON mock_tests(status, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_mock_test_attempts_user_status ON mock_test_attempts(user_id, mock_test_id, status);
    CREATE INDEX IF NOT EXISTS idx_quizzes_status_published ON quizzes(status, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_quiz_questions_quiz_idx ON quiz_questions(quiz_id, order_no);
    CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user_status ON quiz_attempts(user_id, quiz_id, status);
    CREATE INDEX IF NOT EXISTS idx_roadmaps_status ON roadmaps(status, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_roadmap_steps_roadmap ON roadmap_steps(roadmap_id, step_order);
    CREATE INDEX IF NOT EXISTS idx_student_roadmap_prog_user ON student_roadmap_progress(student_id, roadmap_id);
  `);

  part9SchemaEnsured = true;
}

module.exports = { ensurePart9Schema };
