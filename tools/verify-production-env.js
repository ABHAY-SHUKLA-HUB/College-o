require('dotenv').config();

const required = [
  'SESSION_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_STORAGE_BUCKET',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'TURNSTILE_ALLOWED_HOSTNAMES'
];

const missing = required.filter((name) => !String(process.env[name] || '').trim());
const databaseUrl = String(
  process.env.CURRENT_DATABASE_URL
  || process.env.DATABASE_URL
  || process.env.SUPABASE_POOLER_URL
  || process.env.SUPABASE_DATABASE_URL
  || ''
).trim();
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const selectedDatabaseUrl = String(
  process.env.SUPABASE_POOLER_URL
  || process.env.SUPABASE_DATABASE_URL
  || process.env.CURRENT_DATABASE_URL
  || process.env.DATABASE_URL
  || ''
).trim();
const hostnames = String(process.env.TURNSTILE_ALLOWED_HOSTNAMES || '')
  .split(',')
  .map((hostname) => hostname.trim().toLowerCase())
  .filter(Boolean);
const expectedHostnames = ['collegeo.in', 'www.collegeo.in', 'college-o.vercel.app'];
const missingHostnames = expectedHostnames.filter((hostname) => !hostnames.includes(hostname));

if (!isProduction) {
  console.log('Production env check skipped: NODE_ENV is not production.');
  process.exit(0);
}

if (missing.length || missingHostnames.length) {
  if (!databaseUrl) console.error('Missing production database variable: DATABASE_URL, CURRENT_DATABASE_URL, SUPABASE_POOLER_URL, or SUPABASE_DATABASE_URL');
  if (missing.length) console.error(`Missing production variables: ${missing.join(', ')}`);
  if (missingHostnames.length) console.error(`Missing Turnstile hostnames: ${missingHostnames.join(', ')}`);
  process.exit(1);
}

if (!/^https:\/\//i.test(String(process.env.SUPABASE_URL || '').trim())) {
  console.error('SUPABASE_URL must be an HTTPS Supabase project URL.');
  process.exit(1);
}

let selectedDatabaseHost = '';
try {
  selectedDatabaseHost = new URL(selectedDatabaseUrl).hostname;
} catch {
  selectedDatabaseHost = '';
}
if (/supabase\.(co|com)$/i.test(selectedDatabaseHost) || /pooler\.supabase\.com$/i.test(selectedDatabaseHost)) {
  const ca = String(process.env.SUPABASE_DB_SSL_CA || process.env.PG_SSL_CA || '').trim();
  if (!ca) {
    console.error('SUPABASE_DB_SSL_CA (or PG_SSL_CA) is required for strict Supabase PostgreSQL TLS verification.');
    process.exit(1);
  }
}

if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  console.error('The production database variable must be a PostgreSQL connection URL.');
  process.exit(1);
}

console.log('Production environment variables are present; secret values were not printed.');