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
    const migrationPath = path.join(__dirname, '../../ACADEMIC_STRUCTURE_MIGRATION.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.warn('⚠️  Academic structure migration file not found. Skipping migration.');
      return;
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split SQL by semicolons and filter empty statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (error) {
        // Ignore "already exists" errors and other non-critical issues
        if (!error.message.includes('already exists') && 
            !error.message.includes('already have a same-named object') &&
            !error.message.includes('duplicate key')) {
          console.error('Migration error:', error.message);
        }
      }
    }

    migrationExecuted = true;
    console.log('✅ Academic structure schema initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize academic structure schema:', error);
    throw error;
  }
}

module.exports = { initializeAcademicStructure };
