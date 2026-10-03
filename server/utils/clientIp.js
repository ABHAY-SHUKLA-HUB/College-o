/**
 * server/utils/clientIp.js
 * Robust client IP resolution across edge proxies (Cloudflare, Vercel, Render)
 */

function getClientIp(req) {
  if (!req) return '127.0.0.1';

  // 1. Cloudflare Turnstile / CDN connecting IP (most reliable when routed through Cloudflare)
  const cfIp = req.headers?.['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string' && cfIp.trim()) {
    return cfIp.trim();
  }

  // 2. Vercel Real IP / True-Client-IP / X-Real-IP
  const trueClientIp = req.headers?.['true-client-ip'] || req.headers?.['x-real-ip'] || req.headers?.['x-vercel-ip'];
  if (trueClientIp && typeof trueClientIp === 'string' && trueClientIp.trim()) {
    return trueClientIp.trim();
  }

  // 3. X-Forwarded-For: The left-most entry is the original client IP
  const xff = req.headers?.['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[0];
    }
  }

  // 4. Express resolved req.ip
  if (req.ip && typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim();
  }

  // 5. Socket remote address
  const remote = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (remote && typeof remote === 'string') {
    return remote.replace(/^::ffff:/, '').trim();
  }

  return '127.0.0.1';
}

module.exports = {
  getClientIp
};
