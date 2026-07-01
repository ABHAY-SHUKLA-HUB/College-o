const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function normalizeToken(value) {
  return String(value || '').trim();
}

function extractTurnstileToken(body = {}) {
  const directToken = normalizeToken(body.turnstileToken || body.captchaToken);
  if (directToken) return directToken;

  const legacyCaptcha = body.captcha;
  if (typeof legacyCaptcha === 'string') {
    return normalizeToken(legacyCaptcha);
  }

  if (legacyCaptcha && typeof legacyCaptcha === 'object') {
    return normalizeToken(
      legacyCaptcha.turnstileToken
      || legacyCaptcha.captchaToken
      || legacyCaptcha.token
      || legacyCaptcha.response
    );
  }

  return '';
}

function isDevBypassAllowed() {
  return String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
}

function getTurnstileFriendlyMessage(errorCodes = []) {
  const codes = new Set((Array.isArray(errorCodes) ? errorCodes : [errorCodes])
    .map((code) => String(code || '').trim().toLowerCase())
    .filter(Boolean));

  if (codes.has('timeout-or-duplicate')) {
    return 'Security check expired. Please verify again.';
  }

  if (codes.has('missing-input-response') || codes.has('invalid-input-response')) {
    return 'Security verification failed. Please try again.';
  }

  if (codes.has('bad-request')) {
    return 'Security verification failed. Please try again.';
  }

  return 'Security verification failed. Please try again.';
}

async function verifyTurnstileToken(token, ip) {
  const normalizedToken = normalizeToken(token);
  const secretKey = normalizeToken(process.env.TURNSTILE_SECRET_KEY);
  const enabled = String(process.env.TURNSTILE_ENABLED || 'true').toLowerCase() !== 'false';
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (!normalizedToken) {
    if (!isProduction && (!enabled || !secretKey)) {
      console.warn('[turnstile] dev bypass enabled - missing token accepted');
      return { ok: true, bypassed: true, message: 'Bypassed in development.' };
    }

    return {
      ok: false,
      code: 'TURNSTILE_MISSING_TOKEN',
      message: 'Security verification failed. Please try again.'
    };
  }

  if (!enabled || !secretKey) {
    if (!isProduction) {
      console.warn('[turnstile] dev bypass enabled - configuration missing', {
        enabled,
        hasSecret: Boolean(secretKey)
      });
      return { ok: true, bypassed: true, message: 'Bypassed in development.' };
    }

    console.warn('[turnstile] verification blocked - configuration missing', {
      enabled,
      hasSecret: Boolean(secretKey)
    });
    return {
      ok: false,
      code: 'TURNSTILE_CONFIG_MISSING',
      message: 'Security verification failed. Please try again.'
    };
  }

  try {
    const requestBody = new URLSearchParams();
    requestBody.set('secret', secretKey);
    requestBody.set('response', normalizedToken);
    if (ip) requestBody.set('remoteip', String(ip));

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: requestBody.toString()
    });

    const payload = await response.json().catch(() => ({}));
    const errorCodes = Array.isArray(payload?.['error-codes']) ? payload['error-codes'] : [];

    if (!response.ok || payload?.success !== true) {
      const message = getTurnstileFriendlyMessage(errorCodes);
      return {
        ok: false,
        code: String(errorCodes[0] || 'TURNSTILE_FAILED').toUpperCase(),
        message,
        errorCodes
      };
    }

    return {
      ok: true,
      bypassed: false,
      hostname: payload.hostname || '',
      challengeTs: payload['challenge_ts'] || '',
      action: payload.action || '',
      cdata: payload.cdata || ''
    };
  } catch (error) {
    console.warn('[turnstile] verification failed', {
      message: error?.message || String(error || 'unknown_error')
    });
    return {
      ok: false,
      code: 'TURNSTILE_UNAVAILABLE',
      message: 'Security verification failed. Please try again.'
    };
  }
}

module.exports = {
  extractTurnstileToken,
  getTurnstileFriendlyMessage,
  verifyTurnstileToken
};