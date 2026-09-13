const { pool } = require('./pool');
const { query } = require('./query');
const { ensurePerformanceIndexes } = require('../utils/bootstrap');
const { ensureUniversityCatalogSchema } = require('../utils/universities');
const { ensureSupportSchema } = require('../utils/supportSchema');
const fs = require('fs');
const path = require('path');

let bootstrapPromise = null;

async function ensureCoreSchema() {
  try {
    const check = await pool.query("SELECT to_regclass('public.users') as tbl");
    if (check.rows[0] && check.rows[0].tbl) {
      return;
    }
  } catch (_err) {}
  const schemaPath = path.join(__dirname, '..', '..', 'database-schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
}

async function ensureAcademicSchema() {
  try {
    const check = await pool.query("SELECT to_regclass('public.colleges') as tbl");
    if (check.rows[0] && check.rows[0].tbl) {
      return;
    }
  } catch (_err) {}
  const migrationPath = path.join(__dirname, '..', '..', 'ACADEMIC_MIGRATION.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  await pool.query(migrationSql);
}

async function pingDatabaseWithRetry(attempts = 3, delayMs = 250) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw lastError;
}

async function ensureUserSessionsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid varchar NOT NULL PRIMARY KEY,
      sess json NOT NULL,
      expire timestamp(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire);
  `);
}

const { ensureRbacSchema } = require('../utils/rbacSchema');

async function ensureBootstrapImports() {
  const modules = [
    { critical: true, run: () => ensureUserSessionsSchema() },
    { critical: true, run: () => require('../routes/auth').ensureAuthSchema?.() },
    { critical: true, run: () => require('../routes/profile').ensureProfileColumns?.() },
    { critical: true, run: () => require('../routes/dashboard').readStudentExperienceConfig?.() },
    { critical: true, run: () => require('../routes/mockTests').ensureMockTestSchema?.() },
    { critical: true, run: () => require('../routes/subscriptions').ensureMembershipConfigSchema?.() },
    { critical: false, run: () => require('../routes/forum').ensureForumSchema?.() },
    { critical: false, run: () => require('../routes/feedback').ensureFeedbackSchema?.() },
    { critical: true, run: () => require('../routes/academics').ensureAcademicsSchema?.() },
    { critical: true, run: () => require('../routes/admin').ensureCertificateSchema?.() },
    { critical: true, run: () => require('../routes/admin-control').ensureAdminControlSchema?.() },
    { critical: true, run: () => ensureUniversityCatalogSchema(pool) },
    { critical: false, run: () => ensureSupportSchema() },
    { critical: true, run: () => require('./part9-schema').ensurePart9Schema() },
    { critical: true, run: () => ensureRbacSchema() },
    { critical: true, run: () => ensurePerformanceIndexes() }
  ];

  for (const module of modules) {
    const mStart = Date.now();
    try {
      await module.run();
      const mTime = Date.now() - mStart;
      if (mTime > 100) {
        console.log(`[Bootstrap module] completed in ${mTime}ms`);
      }
    } catch (error) {
      if (module.critical) {
        throw new Error(`Critical database bootstrap failed: ${error.message}`);
      }
      console.warn('[Bootstrap] Optional init step skipped:', error.message);
    }
  }
}

async function ensureDatabaseBootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    await pingDatabaseWithRetry();
    try {
      await ensureCoreSchema();
    } catch (error) {
      throw new Error(`Critical database core schema initialization failed: ${error.message}`);
    }
    try {
      await ensureAcademicSchema();
    } catch (error) {
      throw new Error(`Critical academic schema initialization failed: ${error.message}`);
    }
    await ensureBootstrapImports();
    const contentSourcePath = path.join(__dirname, '..', '..', 'CONTENT_SOURCE_ARCHITECTURE.sql');
    if (fs.existsSync(contentSourcePath)) {
      try {
        const checkContent = await pool.query("SELECT to_regclass('public.academic_content') as tbl");
        if (!checkContent.rows[0]?.tbl) {
          const contentSourceSql = fs.readFileSync(contentSourcePath, 'utf8');
          await pool.query(contentSourceSql);
        }
      } catch (_err) {}
    }
    try {
      const checkStorage = await pool.query("SELECT to_regclass('public.file_storage_objects') as tbl");
      if (!checkStorage.rows[0]?.tbl) {
        const storageMigration = fs.readFileSync(
          path.join(__dirname, 'migrations', '002-supabase-storage.sql'),
          'utf8'
        );
        await pool.query(storageMigration);
      }
    } catch (_err) {}
  })();
  return bootstrapPromise;
}

module.exports = { ensureDatabaseBootstrap };