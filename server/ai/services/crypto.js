const crypto = require('crypto');

const SECRET_PREFIX = 'enc:v1:';

function getEncryptionSecret() {
  const secret = String(process.env.AI_SETTINGS_ENCRYPTION_KEY || process.env.SESSION_SECRET || '').trim();
  if (!secret) return '';
  if (secret === 'unsafe-dev-secret' || secret === 'replace-with-strong-secret') return '';
  return secret;
}

function getEncryptionKey() {
  const secret = getEncryptionSecret();
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function encryptSecretValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const key = getEncryptionKey();
  if (!key) return text;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${SECRET_PREFIX}${iv.toString('base64')}.${encrypted.toString('base64')}.${tag.toString('base64')}`;
}

function decryptSecretValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!text.startsWith(SECRET_PREFIX)) return text;

  const key = getEncryptionKey();
  if (!key) return '';

  const [ivB64, encryptedB64, tagB64] = text.slice(SECRET_PREFIX.length).split('.');
  if (!ivB64 || !encryptedB64 || !tagB64) return '';

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedB64, 'base64')),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (_error) {
    return '';
  }
}

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

module.exports = {
  encryptSecretValue,
  decryptSecretValue,
  maskSecret
};
