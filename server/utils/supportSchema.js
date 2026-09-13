const { pool } = require('../db/pool');

let supportSchemaReady = false;

async function ensureSupportSchema() {
  if (supportSchemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key VARCHAR(120) PRIMARY KEY,
      value_json JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_requests (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      request_uuid UUID NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES academic_categories(id),
      branch_id INTEGER NOT NULL REFERENCES academic_branches(id),
      semester_id INTEGER NOT NULL REFERENCES academic_semesters(id),
      university_id INTEGER,
      college_name VARCHAR(180),
      title VARCHAR(250) NOT NULL,
      description TEXT NOT NULL,
      request_category VARCHAR(80) NOT NULL,
      subject VARCHAR(150),
      urgency_level VARCHAR(20) DEFAULT 'medium',
      status VARCHAR(30) DEFAULT 'open',
      solved_at TIMESTAMP,
      marked_helpful_count INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      accepted_answer_id INTEGER,
      attachment_urls JSONB DEFAULT '[]'::jsonb,
      image_urls JSONB DEFAULT '[]'::jsonb,
      meet_link VARCHAR(300),
      quality_score INTEGER DEFAULT 100,
      is_flagged BOOLEAN DEFAULT FALSE,
      abuse_reason VARCHAR(200),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_answers (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      answer_uuid UUID NOT NULL UNIQUE,
      request_id INTEGER NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
      answerer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES academic_categories(id),
      branch_id INTEGER NOT NULL REFERENCES academic_branches(id),
      semester_id INTEGER NOT NULL REFERENCES academic_semesters(id),
      content TEXT NOT NULL,
      explanation_detail TEXT,
      helpful_count INTEGER DEFAULT 0,
      unhelpful_count INTEGER DEFAULT 0,
      is_accepted BOOLEAN DEFAULT FALSE,
      accepted_at TIMESTAMP,
      attachment_urls JSONB DEFAULT '[]'::jsonb,
      image_urls JSONB DEFAULT '[]'::jsonb,
      meet_link VARCHAR(300),
      quality_score INTEGER DEFAULT 100,
      is_flagged BOOLEAN DEFAULT FALSE,
      abuse_reason VARCHAR(200),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS helper_reputation (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      helper_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      total_answers INTEGER DEFAULT 0,
      accepted_answers INTEGER DEFAULT 0,
      helpful_answers INTEGER DEFAULT 0,
      total_points_earned INTEGER DEFAULT 0,
      reputation_level VARCHAR(50) DEFAULT 'New Helper',
      total_helping_hours NUMERIC(10,2) DEFAULT 0,
      spam_reports INTEGER DEFAULT 0,
      report_ratio NUMERIC(5,2) DEFAULT 0,
      last_answer_at TIMESTAMP,
      verified_helper BOOLEAN DEFAULT FALSE,
      verification_badge VARCHAR(50),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_request_tags (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      request_id INTEGER NOT NULL REFERENCES support_requests(id) ON DELETE CASCADE,
      tag VARCHAR(80) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_quality_metrics (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      metric_type VARCHAR(50) NOT NULL,
      metric_value INTEGER DEFAULT 0,
      metric_reason VARCHAR(150),
      recorded_date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_answer_votes (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      answer_id INTEGER NOT NULL REFERENCES support_answers(id) ON DELETE CASCADE,
      voter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vote_type VARCHAR(20) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (answer_id, voter_id)
    )
  `);

  await pool.query(`
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
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_reward_events (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      helper_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      points_delta INTEGER NOT NULL,
      reason VARCHAR(220) NOT NULL,
      event_type VARCHAR(50) NOT NULL DEFAULT 'system',
      request_id INTEGER REFERENCES support_requests(id) ON DELETE SET NULL,
      answer_id INTEGER REFERENCES support_answers(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_helper_controls (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      helper_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      trust_level VARCHAR(40) DEFAULT 'new_helper',
      trust_badge VARCHAR(80),
      is_verified_contributor BOOLEAN DEFAULT FALSE,
      is_suspended BOOLEAN DEFAULT FALSE,
      suspended_until TIMESTAMP,
      suspension_reason TEXT,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_admin_actions (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action_type VARCHAR(60) NOT NULL,
      target_type VARCHAR(30) NOT NULL,
      target_id INTEGER,
      notes TEXT,
      payload JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO platform_settings (key, value_json)
    VALUES (
      'support_feature_governance',
      '{
        "enabled": true,
        "moduleVisible": true,
        "allowRequestCreation": true,
        "allowAnswerCreation": true,
        "allowMeetLinks": true,
        "allowAttachments": true,
        "allowStudentRewarding": true,
        "allowSolvedFlow": true
      }'::jsonb
    )
    ON CONFLICT (key) DO NOTHING
  `);

  await pool.query(`
    ALTER TABLE user_profiles
      ADD COLUMN IF NOT EXISTS support_points_earned INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_helper BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS helper_badge VARCHAR(80)
  `);

  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_helper BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS helper_level VARCHAR(50) DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS support_suspended BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS support_suspended_until TIMESTAMP,
      ADD COLUMN IF NOT EXISTS support_suspend_reason TEXT
  `);

  await pool.query(`
    ALTER TABLE support_requests
      ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS hidden_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_removed BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS removed_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS locked_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS featured_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_priority BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS priority_reason VARCHAR(200),
      ADD COLUMN IF NOT EXISTS flagged_link_risk BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS flagged_attachment_risk BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS governance_notes TEXT
  `);

  await pool.query(`
    ALTER TABLE support_answers
      ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS hidden_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_removed BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS removed_by INTEGER REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS governance_notes TEXT
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_requests_isolation
    ON support_requests(category_id, branch_id, semester_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_requests_status
    ON support_requests(status, category_id, branch_id, semester_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_requests_visibility
    ON support_requests(is_removed, is_hidden, is_locked, is_priority, is_featured)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_answers_isolation
    ON support_answers(request_id, category_id, branch_id, semester_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_answers_answerer
    ON support_answers(answerer_id, category_id, branch_id, semester_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_answers_visibility
    ON support_answers(is_removed, is_hidden, is_flagged, request_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_moderation_queue_status
    ON support_moderation_queue(status, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_reward_events_helper
    ON support_reward_events(helper_user_id, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      ticket_number VARCHAR(50) UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES academic_categories(id),
      category VARCHAR(80) DEFAULT 'General',
      subject VARCHAR(250),
      description TEXT,
      status VARCHAR(30) DEFAULT 'OPEN',
      priority VARCHAR(20) DEFAULT 'NORMAL',
      assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolved_at TIMESTAMP,
      closed_at TIMESTAMP,
      resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      resolution_summary TEXT,
      entity_type VARCHAR(50),
      entity_id INTEGER,
      last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE support_tickets
      ADD COLUMN IF NOT EXISTS ticket_number VARCHAR(50),
      ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES academic_categories(id),
      ADD COLUMN IF NOT EXISTS category VARCHAR(80) DEFAULT 'General',
      ADD COLUMN IF NOT EXISTS subject VARCHAR(250),
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'OPEN',
      ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'NORMAL',
      ADD COLUMN IF NOT EXISTS assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS resolution_summary TEXT,
      ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS entity_id INTEGER,
      ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

    ALTER TABLE support_tickets ALTER COLUMN issue_type DROP NOT NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      sender_type VARCHAR(20) NOT NULL,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      visibility VARCHAR(20) DEFAULT 'PUBLIC',
      attachment_urls JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_internal_notes (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50) DEFAULT 'SYSTEM',
      kind VARCHAR(50),
      title VARCHAR(200),
      message TEXT NOT NULL,
      entity_type VARCHAR(50),
      entity_id INTEGER,
      is_read BOOLEAN DEFAULT FALSE,
      read_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE notifications
      ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'SYSTEM',
      ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS entity_id INTEGER,
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status, last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned ON support_tickets (assigned_admin_id, status);
    CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages (ticket_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, is_read, created_at DESC);
  `);

  supportSchemaReady = true;
}

module.exports = { ensureSupportSchema };
