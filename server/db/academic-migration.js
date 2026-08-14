/**
 * Academic Structure Database Migration
 * This function ensures all required academic structure tables exist
 * and are properly configured for student onboarding and content filtering
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('../db/pool');

let migrationExecuted = false;

/**
 * Initialize academic structure schema
 * Reads and executes the comprehensive migration SQL file
 */
async function initializeAcademicStructure() {
  if (migrationExecuted) return;

  try {
    // Quick check if academic structure is already bootstrapped
    const existing = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'academic_categories'").catch(() => ({ rowCount: 0 }));
    if (existing.rowCount > 0) {
      migrationExecuted = true;
      return { ok: true, skipped: true };
    }

    const migrationCandidates = [
      path.join(__dirname, '../../ACADEMIC_MIGRATION.sql'),
      path.join(__dirname, '../../ACADEMIC_STRUCTURE_MIGRATION.sql')
    ];

    const migrationPath = migrationCandidates.find((candidatePath) => fs.existsSync(candidatePath));

    if (!migrationPath) {
      throw new Error(`Academic structure migration file not found. Looked for: ${migrationCandidates.join(', ')}`);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    try {
      await pool.query(migrationSQL);
    } catch (err) {
      // Fallback statement by statement if single batch fails
      const statements = migrationSQL
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      for (const statement of statements) {
        try {
          await pool.query(statement);
        } catch (error) {
          if (!error.message.includes('already exists') && 
              !error.message.includes('already have a same-named object') &&
              !error.message.includes('duplicate key')) {
            console.error('Migration error:', error.message);
          }
        }
      }
    }

    migrationExecuted = true;
    return { ok: true, migrationPath };
  } catch (error) {
    console.error('❌ Failed to initialize academic structure schema:', error);
    throw error;
  }
}

module.exports = { initializeAcademicStructure };
