/**
 * Coding Challenges Module Database Migration Runner
 * Safely initializes the coding challenge tables and RLS policies on startup.
 * Uses a single client connection with transaction management to respect pool size.
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

let migrationExecuted = false;

function cleanSql(sql) {
  // Strip single-line comments (-- ...) and multi-line comments (/* ... */)
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

async function initializeCodingChallengesSchema() {
  if (migrationExecuted) return { ok: true, skipped: true };

  const migrationPath = path.join(__dirname, '../../CODING_CHALLENGES_MIGRATION.sql');
  if (!fs.existsSync(migrationPath)) {
    console.warn('[Coding Migration] SQL migration file not found at:', migrationPath);
    return { ok: false, error: 'Migration file missing' };
  }

  const rawSQL = fs.readFileSync(migrationPath, 'utf8');
  const cleanedSQL = cleanSql(rawSQL);

  const client = await pool.connect();
  try {
    // Check if tables already exist
    const { rows } = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'coding_module_settings'"
    );

    if (rows.length > 0) {
      migrationExecuted = true;
      return { ok: true, skipped: true };
    }

    await client.query('BEGIN');

    // Split cleaned SQL into statements
    const statements = cleanedSQL
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (stmtErr) {
        if (
          !stmtErr.message.includes('already exists') &&
          !stmtErr.message.includes('already have a same-named object') &&
          !stmtErr.message.includes('duplicate key')
        ) {
          console.warn('[Coding Migration] Statement warning:', stmtErr.message);
        }
      }
    }

    await client.query('COMMIT');
    migrationExecuted = true;
    console.info('✅ [Coding Migration] Coding challenges schema initialized successfully');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => null);
    console.error('❌ [Coding Migration] Failed to initialize coding challenges schema:', error.message || error);
    return { ok: false, error: error.message };
  } finally {
    client.release();
  }
}

module.exports = { initializeCodingChallengesSchema };
