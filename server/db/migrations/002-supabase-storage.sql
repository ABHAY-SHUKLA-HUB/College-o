-- Canonical metadata registry for files stored in Supabase Storage.
-- Objects remain private or public according to the feature and stored visibility.
CREATE TABLE IF NOT EXISTS uploaded_files (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_type VARCHAR(40) NOT NULL DEFAULT 'user',
  entity_type VARCHAR(60),
  entity_id INTEGER,
  bucket VARCHAR(120) NOT NULL,
  storage_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  file_extension VARCHAR(20),
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  visibility VARCHAR(20) NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'private')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uploaded_files_bucket_path_idx
  ON uploaded_files (bucket, storage_path)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS uploaded_files_user_idx
  ON uploaded_files (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS uploaded_files_entity_idx
  ON uploaded_files (entity_type, entity_id)
  WHERE deleted_at IS NULL;
