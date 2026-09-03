require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

async function run() {
  const schemaPath = path.join(__dirname, '..', '..', 'database-schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('Database schema initialized successfully.');

  // Run academic migration
  const academicMigrationPath = path.join(__dirname, '..', '..', 'ACADEMIC_MIGRATION.sql');
  if (fs.existsSync(academicMigrationPath)) {
    const academicSql = fs.readFileSync(academicMigrationPath, 'utf8');
    await pool.query(academicSql);
    console.log('Academic content architecture initialized successfully.');
  }

  // Run content source architecture migration
  const contentSourcePath = path.join(__dirname, '..', '..', 'CONTENT_SOURCE_ARCHITECTURE.sql');
  if (fs.existsSync(contentSourcePath)) {
    const contentSourceSql = fs.readFileSync(contentSourcePath, 'utf8');
    await pool.query(contentSourceSql);
    console.log('Content source architecture initialized successfully.');
  }

  // Run content quality abstraction migration
  const contentQualityPath = path.join(__dirname, '..', '..', 'CONTENT_QUALITY_ABSTRACTION.sql');
  if (fs.existsSync(contentQualityPath)) {
    const contentQualitySql = fs.readFileSync(contentQualityPath, 'utf8');
    await pool.query(contentQualitySql);
    console.log('Content quality abstraction initialized successfully.');
  }

  const storageMigrationPath = path.join(__dirname, 'migrations', '002-supabase-storage.sql');
  if (fs.existsSync(storageMigrationPath)) {
    const storageSql = fs.readFileSync(storageMigrationPath, 'utf8');
    await pool.query(storageSql);
    console.log('Supabase Storage metadata schema initialized successfully.');
  }

  await pool.end();
}

run().catch(async (err) => {
  console.error('DB init failed:', err.message);
  await pool.end();
  process.exit(1);
});
