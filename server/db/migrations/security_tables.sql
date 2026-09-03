-- Security audit logging table
CREATE TABLE IF NOT EXISTS security_audit_log (
  id BIGSERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  user_id INTEGER,
  ip_address VARCHAR(45),
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_event ON security_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_log(created_at);

-- Rate limiting buckets
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key VARCHAR(255) PRIMARY KEY,
  count INTEGER DEFAULT 0,
  reset_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_buckets(reset_at);

-- Add columns to users table for brute force protection
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;

-- Session revocation tokens (for logout enforcement)
CREATE TABLE IF NOT EXISTS session_revocation (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_revocation_user ON session_revocation(user_id);
CREATE INDEX IF NOT EXISTS idx_session_revocation_time ON session_revocation(revoked_at);

-- Content access log (for suspicious activity detection)
CREATE TABLE IF NOT EXISTS content_access_log (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  content_type VARCHAR(50),
  content_id INTEGER,
  academic_category_id INTEGER,
  academic_branch_id INTEGER,
  academic_semester_id INTEGER,
  allowed BOOLEAN,
  reason VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_access_user ON content_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_content_access_time ON content_access_log(accessed_at);
CREATE INDEX IF NOT EXISTS idx_content_access_allowed ON content_access_log(allowed);
