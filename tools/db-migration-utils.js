const { spawnSync } = require('child_process');

function getEnvUrl(name) {
  return String(process.env[name] || '').trim();
}

function getMigrationUrls() {
  return {
    currentDatabaseUrl: getEnvUrl('CURRENT_DATABASE_URL') || getEnvUrl('DATABASE_URL'),
    supabaseDatabaseUrl: getEnvUrl('SUPABASE_DATABASE_URL'),
    supabasePoolerUrl: getEnvUrl('SUPABASE_POOLER_URL')
  };
}

function assertUrl(name, value) {
  if (!value) {
    throw new Error(`${name} is required. Set it in the environment before running this command.`);
  }
}

function ensureRequiredUrls() {
  const urls = getMigrationUrls();
  assertUrl('CURRENT_DATABASE_URL or DATABASE_URL', urls.currentDatabaseUrl);
  assertUrl('SUPABASE_DATABASE_URL', urls.supabaseDatabaseUrl);
  return urls;
}

function escapeForPowerShellSingleQuotes(value) {
  return String(value).replace(/'/g, "''");
}

function runTool(toolName, args, env = {}) {
  const result = spawnSync(toolName, args, {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      ...env
    }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${toolName} exited with code ${result.status}`);
  }
}

function buildPgArgs(command, connectionUrl, extraArgs = []) {
  return [command, '--dbname', connectionUrl, ...extraArgs];
}

module.exports = {
  getMigrationUrls,
  ensureRequiredUrls,
  escapeForPowerShellSingleQuotes,
  runTool,
  buildPgArgs
};