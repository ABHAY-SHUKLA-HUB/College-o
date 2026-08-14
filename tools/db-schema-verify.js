require('dotenv').config();

const { pool } = require('../server/db/pool');

async function main() {
  const [tables, columns, constraints, pks, fks, indexes, sequences, views, triggers, extensions] = await Promise.all([
    pool.query(`SELECT table_name, COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public' GROUP BY table_name ORDER BY table_name`),
    pool.query(`SELECT table_name, COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' GROUP BY table_name ORDER BY table_name`),
    pool.query(`SELECT constraint_type, COUNT(*)::int AS count FROM information_schema.table_constraints WHERE table_schema = 'public' GROUP BY constraint_type ORDER BY constraint_type`),
    pool.query(`SELECT table_name, COUNT(*)::int AS count FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'PRIMARY KEY' GROUP BY table_name ORDER BY table_name`),
    pool.query(`SELECT table_name, COUNT(*)::int AS count FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY' GROUP BY table_name ORDER BY table_name`),
    pool.query(`SELECT tablename AS table_name, COUNT(*)::int AS count FROM pg_indexes WHERE schemaname = 'public' GROUP BY tablename ORDER BY tablename`),
    pool.query(`SELECT sequence_name, sequence_schema FROM information_schema.sequences WHERE sequence_schema = 'public' ORDER BY sequence_name`),
    pool.query(`SELECT table_name, view_definition FROM information_schema.views WHERE table_schema = 'public' ORDER BY table_name`),
    pool.query(`SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE trigger_schema = 'public' ORDER BY trigger_name`),
    pool.query(`SELECT extname FROM pg_extension ORDER BY extname`)
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    publicTableCount: tables.rows.length,
    publicColumnCount: columns.rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
    constraintSummary: constraints.rows,
    tables: tables.rows,
    columns: columns.rows,
    primaryKeys: pks.rows,
    foreignKeys: fks.rows,
    indexes: indexes.rows,
    sequences: sequences.rows,
    views: views.rows,
    triggers: triggers.rows,
    extensions: extensions.rows.map((row) => row.extname)
  };

  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error.message);
  try {
    await pool.end();
  } catch {
    // ignore shutdown errors
  }
  process.exit(1);
});