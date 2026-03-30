require('dotenv').config();
const { pool } = require('../server/db/pool');

async function main() {
  const { rows } = await pool.query(`
    SELECT
      to_regclass('public.support_requests') AS support_requests,
      to_regclass('public.support_answers') AS support_answers,
      to_regclass('public.support_moderation_queue') AS support_moderation_queue,
      to_regclass('public.support_reward_events') AS support_reward_events,
      to_regclass('public.support_helper_controls') AS support_helper_controls,
      to_regclass('public.support_admin_actions') AS support_admin_actions
  `);
  console.log(JSON.stringify(rows[0]));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
