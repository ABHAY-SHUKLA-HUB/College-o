require('dotenv').config();

const { pool } = require('../server/db/pool');

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function main() {
  const { rows: tables } = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const rows = [];

  for (const { table_name: tableName } of tables) {
    try {
      const { rows: result } = await pool.query(
        `SELECT COUNT(*)::bigint AS count FROM public.${quoteIdentifier(tableName)}`
      );
      rows.push({ table: tableName, count: result[0].count });
    } catch (error) {
      rows.push({ table: tableName, error: error.message });
    }
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    publicTableCount: tables.length,
    rows
  }, null, 2));
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