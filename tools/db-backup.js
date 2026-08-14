require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { ensureRequiredUrls, runTool, buildPgArgs } = require('./db-migration-utils');

function createBackupName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `college-os-backup-${timestamp}.dump`;
}

function main() {
  const { currentDatabaseUrl } = ensureRequiredUrls();
  const outputDir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, createBackupName());

  runTool('pg_dump', buildPgArgs('pg_dump', currentDatabaseUrl, [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--verbose',
    '--file', outputFile
  ]));

  console.log(`Backup written to ${outputFile}`);
}

main();