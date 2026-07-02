const { Pool } = require('pg');

const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const usePgMem = ['1', 'true', 'on', 'yes'].includes(String(process.env.USE_PGMEM || '').trim().toLowerCase());

if (usePgMem) {
  throw new Error('USE_PGMEM=true is not supported. This backend is PostgreSQL-only. Set USE_PGMEM=false.');
}

function normalizeSslMode(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return String(parsed.searchParams.get('sslmode') || '').toLowerCase();
  } catch {
    return '';
  }
}

function shouldRejectUnauthorized() {
  const explicit = String(process.env.PG_SSL_REJECT_UNAUTHORIZED || process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase();
  if (explicit === 'false' || explicit === '0' || explicit === 'off') return false;
  if (explicit === 'true' || explicit === '1' || explicit === 'on') return true;
  return isProduction;
}

function resolveSslConfig(connectionString) {
  const sslMode = normalizeSslMode(connectionString);
  const explicit = String(process.env.PG_SSL || process.env.DB_SSL || '').toLowerCase();

  if (explicit === 'false' || explicit === '0' || explicit === 'off') return false;
  if (explicit === 'true' || explicit === '1' || explicit === 'on') {
    return { rejectUnauthorized: shouldRejectUnauthorized() };
  }

  if (sslMode === 'disable' || sslMode === 'allow') {
    return false;
  }

  if (sslMode === 'require' || sslMode === 'prefer' || sslMode === 'verify-ca' || sslMode === 'verify-full') {
    return { rejectUnauthorized: shouldRejectUnauthorized() };
  }

  return false;
}

function normalizeConnectionString(rawConnectionString) {
  const value = String(rawConnectionString || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    const sslMode = String(parsed.searchParams.get('sslmode') || '').toLowerCase();

    if (sslMode === 'prefer' || sslMode === 'require' || sslMode === 'verify-ca') {
      parsed.searchParams.set('uselibpqcompat', 'true');
      parsed.searchParams.set('sslmode', 'require');
      return parsed.toString();
    }

    return parsed.toString();
  } catch {
    return value;
  }
}

const connectionString = normalizeConnectionString(process.env.DATABASE_URL || '');
if (!connectionString) {
  throw new Error('DATABASE_URL is required. Configure a real PostgreSQL connection string in .env.');
}

const pool = new Pool({
  connectionString,
  ssl: resolveSslConfig(connectionString),
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
  query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || (isProduction ? 15000 : 0)) || undefined
});

module.exports = { pool };
