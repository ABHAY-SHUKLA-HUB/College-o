/**
 * COLLEGE OS — COMMUNITY CONTENT SANITIZER UTILITY
 * Prevents stored XSS, strips malicious HTML/scripts, and sanitizes external URLs.
 */

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function sanitizeUrl(urlStr) {
  if (!urlStr) return '';
  const trimmed = String(urlStr).trim();
  if (!trimmed) return '';

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('data:text/html') ||
    lower.startsWith('data:text/javascript')
  ) {
    return '';
  }

  if (trimmed.startsWith('/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return escapeHtml(trimmed);
  }

  return escapeHtml(`https://${trimmed}`);
}

function sanitizeText(input, maxLength = 5000) {
  if (!input) return '';
  let cleaned = String(input).trim();
  
  // Remove script tags and embedded html tags
  cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  cleaned = cleaned.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  cleaned = cleaned.replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '');
  cleaned = cleaned.replace(/on\w+\s*=\s*"[^"]*"/gi, '');
  cleaned = cleaned.replace(/on\w+\s*=\s*'[^']*'/gi, '');
  cleaned = cleaned.replace(/on\w+\s*=\s*([^\s>]+)/gi, '');

  if (maxLength > 0 && cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }

  return escapeHtml(cleaned);
}

module.exports = {
  escapeHtml,
  sanitizeUrl,
  sanitizeText
};
