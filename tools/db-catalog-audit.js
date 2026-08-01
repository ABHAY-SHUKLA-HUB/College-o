require('dotenv').config();

const { pool } = require('../server/db/pool');

async function run() {
  const [tables, views, sequences, triggers, indexes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM information_schema.views WHERE table_schema = 'public'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM information_schema.sequences WHERE sequence_schema = 'public'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM information_schema.triggers WHERE trigger_schema = 'public'`),
    pool.query(`SELECT COUNT(*)::int AS count FROM pg_indexes WHERE schemaname = 'public'`)
  ]);

  console.log(JSON.stringify({
    tables: tables.rows[0].count,
    views: views.rows[0].count,
    sequences: sequences.rows[0].count,
    triggers: triggers.rows[0].count,
    indexes: indexes.rows[0].count
  }, null, 2));

  await pool.end();
}

run().catch(async (error) => {
  console.error(error.message);
  try {
    await pool.end();
  } catch {
    // ignore shutdown errors
  }
  process.exit(1);
});