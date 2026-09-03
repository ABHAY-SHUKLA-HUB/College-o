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

function getConnectionHost(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isSupabaseHost(rawUrl) {
  const host = getConnectionHost(rawUrl);
  return host.includes('supabase.co') || host.includes('pooler.supabase.com');
}

function isNeonHost(rawUrl) {
  return getConnectionHost(rawUrl).includes('neon.tech');
}

function shouldRejectUnauthorized() {
  const explicit = String(process.env.PG_SSL_REJECT_UNAUTHORIZED || process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase();
  if (explicit === 'false' || explicit === '0' || explicit === 'off') return false;
  if (explicit === 'true' || explicit === '1' || explicit === 'on') return true;
  return isProduction;
}

function getDatabaseCa() {
  const raw = String(process.env.SUPABASE_DB_SSL_CA || process.env.PG_SSL_CA || '')
    .replace(/\\n/g, '\n')
    .trim();

  if (!raw || raw.includes('-----BEGIN CERTIFICATE-----')) return raw;

  const base64Body = raw.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Body)) return raw;

  return `-----BEGIN CERTIFICATE-----\n${base64Body.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
}

function validateDatabaseCa(ca) {
  if (!ca) return;
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('SUPABASE_DB_SSL_CA (or PG_SSL_CA) must contain a valid PEM certificate.');
  }
  const body = ca
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '');
  if (body.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) {
    throw new Error('SUPABASE_DB_SSL_CA (or PG_SSL_CA) must contain a valid PEM certificate.');
  }
}

function getSelectedConnection() {
  const candidates = [
    ['SUPABASE_POOLER_URL', process.env.SUPABASE_POOLER_URL],
    ['SUPABASE_DATABASE_URL', process.env.SUPABASE_DATABASE_URL],
    ['CURRENT_DATABASE_URL', process.env.CURRENT_DATABASE_URL],
    ['DATABASE_URL', process.env.DATABASE_URL]
  ];
  return candidates.find(([, value]) => String(value || '').trim()) || ['', ''];
}

function resolveSslConfig() {
  const explicit = String(process.env.PG_SSL || process.env.DB_SSL || '').trim().toLowerCase();
  const disabled = ['false', '0', 'off', 'disable'].includes(explicit);
  const enabled = ['true', '1', 'on', 'require', 'prefer', 'verify-ca', 'verify-full'].includes(explicit);

  if (disabled && !isProduction) return false;
  if (!isProduction && !enabled && !getDatabaseCa()) return false;

  const ssl = { rejectUnauthorized: true };
  const ca = getDatabaseCa();
  validateDatabaseCa(ca);
  if (ca) ssl.ca = ca;
  return ssl;
}

function normalizeConnectionString(rawConnectionString) {
  const value = String(rawConnectionString || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    const sslMode = String(parsed.searchParams.get('sslmode') || '').toLowerCase();
    const supabaseHost = isSupabaseHost(value);
    const neonHost = isNeonHost(value);

    if (!parsed.searchParams.has('application_name')) {
      parsed.searchParams.set('application_name', 'college-os-backend');
    }

    // Keep TLS policy in the explicit Pool `ssl` option. URL sslmode values
    // are removed to prevent pg-connection-string from overriding it.
    parsed.searchParams.delete('sslmode');
    parsed.searchParams.delete('channel_binding');
    if (!supabaseHost && neonHost && sslMode === 'require') {
      parsed.searchParams.set('uselibpqcompat', 'true');
    }

    return parsed.toString();
  } catch {
    return value;
  }
}

const [connectionSource, rawConnectionString] = getSelectedConnection();
const connectionString = normalizeConnectionString(rawConnectionString);
if (!connectionString) {
  throw new Error('DATABASE_URL (or SUPABASE_DATABASE_URL / SUPABASE_POOLER_URL) is required. Configure a real PostgreSQL connection string in .env.');
}

const rawParsedConnection = (() => {
  try { return new URL(rawConnectionString); } catch { return null; }
})();
if (isProduction && isSupabaseHost(rawConnectionString) && !getDatabaseCa()) {
  throw new Error('SUPABASE_DB_SSL_CA (or PG_SSL_CA) is required for strict Supabase PostgreSQL TLS verification.');
}
validateDatabaseCa(getDatabaseCa());
console.info('[DB] connection source:', connectionSource || 'none');
console.info('[DB] URL sslmode:', String(rawParsedConnection?.searchParams.get('sslmode') || 'none').toLowerCase());
console.info('[DB] custom Supabase CA configured:', Boolean(getDatabaseCa()));
console.info('[DB] TLS verification:', resolveSslConfig()?.rejectUnauthorized === true ? 'enabled' : 'disabled');
console.info('[DB] TLS configuration:', {
  sslmode: String(rawParsedConnection?.searchParams.get('sslmode') || 'not-set').toLowerCase(),
  uselibpqcompat: String(rawParsedConnection?.searchParams.get('uselibpqcompat') || 'not-set').toLowerCase(),
  pgSsl: String(process.env.PG_SSL || process.env.DB_SSL || 'not-set').toLowerCase(),
  caConfigured: Boolean(getDatabaseCa()),
  rejectUnauthorized: resolveSslConfig()?.rejectUnauthorized ?? false
});

const pool = new Pool({
  connectionString,
  ssl: resolveSslConfig(),
  max: Number(process.env.PG_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
  query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || (isProduction ? 15000 : 0)) || undefined,
  keepAlive: true,
  keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_INITIAL_DELAY_MS || 10000),
  allowExitOnIdle: false,
  maxUses: Number(process.env.PG_MAX_USES || 500)
});

module.exports = { pool };
