-- College OS canonical Supabase PostgreSQL setup runner.
-- Execute from the repository root with psql so the included files are applied
-- in dependency order. This file contains no credentials.
\set ON_ERROR_STOP on
\ir ../database-schema.sql
\ir ../ACADEMIC_MIGRATION.sql
\ir ../AI_ENTERPRISE_ARCHITECTURE.sql
\ir ../CONTENT_SOURCE_ARCHITECTURE.sql
\ir ../CONTENT_QUALITY_ABSTRACTION.sql
\ir ../server/db/migrations/001-core.sql
\ir ../server/db/migrations/security_tables.sql
\ir ../server/db/migrations/002-supabase-storage.sql
