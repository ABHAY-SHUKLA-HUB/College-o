require('dotenv').config();

const fs = require('fs');
const { ensureRequiredUrls, runTool, buildPgArgs } = require('./db-migration-utils');

function main() {
  const { supabaseDatabaseUrl } = ensureRequiredUrls();
  const backupFile = String(process.argv[2] || '').trim();

  if (!backupFile) {
    throw new Error('Usage: node tools/db-restore.js <backup-file>');
  }

  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  runTool('pg_restore', buildPgArgs('pg_restore', supabaseDatabaseUrl, [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-acl',
    '--verbose',
    backupFile
  ]));

  console.log(`Restore completed from ${backupFile}`);
}

main();