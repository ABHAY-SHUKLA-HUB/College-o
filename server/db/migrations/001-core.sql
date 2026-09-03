-- Core performance migration for startup/bootstrap paths.
-- Apply this during deployment, not from request handlers.

CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR(255) NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);

CREATE INDEX IF NOT EXISTS user_profiles_user_id_idx ON user_profiles (user_id);
CREATE INDEX IF NOT EXISTS quiz_attempts_user_id_attempted_at_idx ON quiz_attempts (user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS notes_created_by_created_at_idx ON notes (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS certificates_user_id_created_at_idx ON certificates (user_id, created_at DESC);
