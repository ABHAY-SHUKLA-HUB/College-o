const { pool } = require('./pool');
const { query } = require('./query');
const { ensurePerformanceIndexes } = require('../utils/bootstrap');
const { ensureUniversityCatalogSchema } = require('../utils/universities');
const { ensureSupportSchema } = require('../utils/supportSchema');

let bootstrapPromise = null;

async function ensureBootstrapImports() {
  const modules = [
    () => require('../routes/auth').ensureAuthSchema?.(),
    () => require('../routes/profile').ensureProfileColumns?.(),
    () => require('../routes/dashboard').readStudentExperienceConfig?.(),
    () => require('../routes/mockTests').ensureMockTestSchema?.(),
    () => require('../routes/subscriptions').ensureMembershipConfigSchema?.(),
    () => require('../routes/forum').ensureForumSchema?.(),
    () => require('../routes/feedback').ensureFeedbackSchema?.(),
    () => require('../routes/academics').ensureAcademicsSchema?.(),
    () => require('../routes/admin').ensureCertificateSchema?.(),
    () => require('../routes/admin-control').ensureAdminControlSchema?.(),
    () => ensureUniversityCatalogSchema(pool),
    () => ensureSupportSchema(),
    () => ensurePerformanceIndexes()
  ];

  for (const run of modules) {
    try {
      await run();
    } catch (error) {
      console.warn('[Bootstrap] Skipped init step:', error.message);
    }
  }
}

async function ensureDatabaseBootstrap() {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    await pool.query('SELECT 1');
    await ensureBootstrapImports();
  })();
  return bootstrapPromise;
}

module.exports = { ensureDatabaseBootstrap };