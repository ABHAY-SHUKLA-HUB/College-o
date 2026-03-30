require('dotenv').config();
const { pool } = require('../server/db/pool');

async function main() {
  const { rows } = await pool.query(`
    SELECT
      pid,
      usename,
      application_name,
      state,
      wait_event_type,
      wait_event,
      NOW() - query_start AS running_for,
      LEFT(query, 220) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
    ORDER BY query_start ASC
    LIMIT 50
  `);

  for (const row of rows) {
    console.log(JSON.stringify(row));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
