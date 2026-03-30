function isEmail(value) {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 6 || value.length > 128) return false;
  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasDigit = /\d/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);
  return hasUpper && hasLower && hasDigit && hasSpecial;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = { isEmail, isStrongPassword, normalizeEmail, toNumber };
