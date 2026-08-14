# Supabase PostgreSQL Rollout

1. Set `SUPABASE_POOLER_URL` or `SUPABASE_DATABASE_URL` in the Render runtime environment.
2. Keep `DATABASE_URL` only as a fallback during migration validation.
3. Create a backup with `node tools/db-backup.js`.
4. Restore into Supabase with `node tools/db-restore.js <backup-file>`.
5. Run schema verification with `node tools/db-schema-verify.js`.
6. Run data verification with `node tools/db-data-verify.js`.
7. If rollback is required, restore the backup to the previous PostgreSQL provider with `node tools/db-rollback.js <backup-file>`.
8. Remove fallback URLs only after production verification completes successfully.