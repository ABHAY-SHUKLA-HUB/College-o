function safeText(value, max = 6000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sanitizeInputObject(input) {
  const source = input && typeof input === 'object' ? input : {};
  const sanitized = {};
  for (const [key, value] of Object.entries(source)) {
    const cleanKey = safeText(key, 60);
    if (!cleanKey) continue;
    const text = safeText(value, 8000)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '');
    sanitized[cleanKey] = text;
  }
  return sanitized;
}

function moderatePrompt(inputObject) {
  const joined = Object.values(inputObject || {}).join(' ').toLowerCase();
  const bannedPatterns = [
    /\bcredit\s*card\b/,
    /\bssn\b/,
    /\bpassword\b/,
    /\bhack\b.*\baccount\b/,
    /\bmalware\b/
  ];
  const blocked = bannedPatterns.some((pattern) => pattern.test(joined));
  return {
    blocked,
    reason: blocked ? 'Request blocked by safety moderation.' : ''
  };
}

module.exports = {
  safeText,
  sanitizeInputObject,
  moderatePrompt
};
