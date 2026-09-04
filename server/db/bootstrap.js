const { pool } = require('./pool');
const { query } = require('./query');
const { ensurePerformanceIndexes } = require('../utils/bootstrap');
const { ensureUniversityCatalogSchema } = require('../utils/universities');
const { ensureSupportSchema } = require('../utils/supportSchema');
const fs = require('fs');
const path = require('path');

let bootstrapPromise = null;

async function ensureCoreSchema() {
  const schemaPath = path.join(__dirname, '..', '..', 'database-schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schemaSql);
}

async function ensureAcademicSchema() {
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

async function ensureBootstrapImports() {
  const modules = [
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
    { critical: true, run: () => ensurePerformanceIndexes() }
  ];

  for (const module of modules) {
    try {
      await module.run();
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
      const contentSourceSql = fs.readFileSync(contentSourcePath, 'utf8');
      await pool.query(contentSourceSql);
    }
    const storageMigration = fs.readFileSync(
      path.join(__dirname, 'migrations', '002-supabase-storage.sql'),
      'utf8'
    );
    await pool.query(storageMigration);
  })();
  return bootstrapPromise;
}

module.exports = { ensureDatabaseBootstrap };