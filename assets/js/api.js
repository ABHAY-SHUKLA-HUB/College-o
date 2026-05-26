const CSRF_COOKIE_NAME = '_csrf';
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_TRANSITION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_TRANSITION_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/login/email-otp',
  '/api/auth/signup',
  '/api/auth/logout',
  '/api/auth/logout-all',
  '/api/auth/verification/verify'
]);

const DEFAULT_API_URL = 'https://college-o.onrender.com';
let csrfTokenCache = null;
let csrfRefreshPromise = null;
let telemetryDisabled = false;
const requestCache = new Map();
const rateLimitCache = new Map();
const warmupOnceCache = new Set();
const REQUEST_CACHE_TTL_MS = 3000;
const SESSION_CACHE_PREFIX = 'collegeos_api_cache_v2:';
const SESSION_CACHE_TTL_MS = 15000;
const SESSION_CACHEABLE_PATHS = [
  /^\/api\/auth\/config$/,
  /^\/api\/auth\/me$/,
  /^\/api\/auth\/captcha\/challenge$/,
  /^\/api\/academics\/categories$/,
  /^\/api\/academics\/branches$/,
  /^\/api\/academics\/semesters$/,
  /^\/api\/academics\/onboarding\/config$/,
  /^\/api\/dashboard\/stats$/,
  /^\/api\/dashboard\/personalized$/,
  /^\/api\/dashboard\/experience-config$/,
  /^\/api\/notifications\/unread-count$/,
  /^\/api\/academics\/profile$/,
  /^\/api\/profile\/me$/,
  /^\/api\/subscriptions\/me$/,
  /^\/api\/contributions\/config$/,
  /^\/api\/live-sessions\/upcoming$/,
  /^\/api\/roadmaps\/me$/,
  /^\/api\/quizzes\/attempts\/me$/,
  /^\/api\/mock-tests\/dashboard$/,
  /^\/api\/career\/roadmaps$/,
  /^\/api\/career\/ai-tools$/,
  /^\/api\/campus-feed\/me\/summary$/,
  /^\/api\/campus-feed\/posts\/trending$/,
  /^\/api\/campus-feed\/posts\/mine$/,
  /^\/api\/campus-feed\/collections$/,
  /^\/api\/forum\/threads\/trending$/,
  /^\/api\/notifications\/mine$/,
  /^\/api\/notes\/mine$/,
  /^\/api\/settings\/icons$/,
  /^\/api\/settings\/sessions$/
];

const requestInterceptors = [];
const responseInterceptors = [];

const rawFetch = window.fetch.bind(window);

function normalizeUrl(value, fallback = DEFAULT_API_URL) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    return new URL(raw, window.location.href).toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

function formatErrorMessage(error, fallback = 'Something went wrong.') {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }
    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }

  const text = String(error || '').trim();
  return text || fallback;
}

const apiUrl = normalizeUrl(
  window.API_URL || window.VITE_API_URL || window.CollegeOSApiConfig?.apiUrl,
  DEFAULT_API_URL
);
const apiOrigin = new URL(apiUrl).origin;

window.API_URL = apiUrl;
window.VITE_API_URL = window.VITE_API_URL || apiUrl;
window.CollegeOSApiConfig = {
  ...(window.CollegeOSApiConfig || {}),
  apiUrl,
  apiOrigin,
  socketUrl: window.CollegeOSApiConfig?.socketUrl || apiUrl
};

function resolveApiUrl(path) {
  if (typeof path !== 'string') return path;
  if (path.startsWith('/api/')) {
    return new URL(path, apiUrl).toString();
  }
  return path;
}

function isFormDataBody(body) {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

function methodOf(options = {}) {
  return (options.method || 'GET').toUpperCase();
}

function methodOfFetchInput(input, init) {
  const initMethod = init?.method;
  if (initMethod) {
    return String(initMethod).toUpperCase();
  }

  if (typeof Request !== 'undefined' && input instanceof Request && input.method) {
    return String(input.method).toUpperCase();
  }

  return 'GET';
}

function shouldAttachCsrf(method) {
  return CSRF_PROTECTED_METHODS.has(method);
}

function normalizePathname(path) {
  if (typeof path === 'string') {
    if (path.startsWith('/')) {
      return path.split('?')[0];
    }
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        return new URL(path).pathname;
      } catch {
        return '';
      }
    }
    return '';
  }

  if (typeof URL !== 'undefined' && path instanceof URL) {
    return path.pathname;
  }

  if (typeof Request !== 'undefined' && path instanceof Request) {
    try {
      return new URL(path.url).pathname;
    } catch {
      return '';
    }
  }

  return '';
}

function normalizeRequestKey(path) {
  if (typeof path === 'string') return path;
  if (typeof URL !== 'undefined' && path instanceof URL) return path.toString();
  if (typeof Request !== 'undefined' && path instanceof Request) return path.url;
  return String(path || '');
}

function getPathnameForCache(path) {
  const pathname = normalizePathname(path);
  if (pathname) return pathname;

  const raw = normalizeRequestKey(path);
  if (!raw) return '';

  try {
    return new URL(raw, window.location.href).pathname;
  } catch {
    return '';
  }
}

function isSessionCacheableRequest(path, method) {
  if (method !== 'GET') return false;
  const pathname = getPathnameForCache(path);
  if (!pathname) return false;
  return SESSION_CACHEABLE_PATHS.some((pattern) => pattern.test(pathname));
}

function sessionCacheKey(path) {
  return `${SESSION_CACHE_PREFIX}${normalizeRequestKey(path)}`;
}

function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readSessionCache(key) {
  const storage = getSessionStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.expiresAt || Number(parsed.expiresAt) <= Date.now()) {
      storage.removeItem(key);
      return null;
    }

    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

function writeSessionCache(key, payload, ttlMs = SESSION_CACHE_TTL_MS) {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    const serialized = JSON.stringify({
      payload,
      expiresAt: Date.now() + ttlMs
    });

    if (serialized.length > 200000) return;
    storage.setItem(key, serialized);
  } catch {
    // Ignore storage quota and serialization failures.
  }
}

function clearSessionCache() {
  const storage = getSessionStorage();
  if (!storage) return;

  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(SESSION_CACHE_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Ignore cache clear failures.
  }
}

function isAuthTransitionRequest(path, method) {
  if (!AUTH_TRANSITION_METHODS.has(method)) {
    return false;
  }
  const pathname = normalizePathname(path);
  return AUTH_TRANSITION_PATHS.has(pathname);
}

function isLearnerTelemetryPath(path) {
  return normalizePathname(path) === '/api/intelligence/events';
}

function isApiRequestUrl(path) {
  if (typeof path === 'string') {
    if (path.startsWith('/api/')) return true;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        const url = new URL(path);
        return url.origin === apiOrigin && url.pathname.startsWith('/api/');
      } catch {
        return false;
      }
    }
  }

  if (typeof URL !== 'undefined' && path instanceof URL) {
    return path.origin === apiOrigin && path.pathname.startsWith('/api/');
  }

  if (typeof Request !== 'undefined' && path instanceof Request) {
    return path.url.startsWith(apiOrigin + '/api/');
  }

  return false;
}

function getCookie(name) {
  if (typeof document === 'undefined' || !document.cookie) return null;

  const encodedName = encodeURIComponent(name) + '=';
  const pairs = document.cookie.split(';');
  for (const pairRaw of pairs) {
    const pair = pairRaw.trim();
    if (pair.startsWith(encodedName)) {
      return decodeURIComponent(pair.slice(encodedName.length));
    }
  }
  return null;
}

function getCsrfTokenFromCookie() {
  return getCookie(CSRF_COOKIE_NAME);
}

async function refreshCsrfToken() {
  if (csrfRefreshPromise) {
    return csrfRefreshPromise;
  }

  csrfRefreshPromise = (async () => {
    try {
      // Any authenticated GET endpoint will trigger csrfInit and refresh cookie token.
      await rawFetch(resolveApiUrl('/api/auth/me'), {
        method: 'GET',
        credentials: 'include',
        headers: {
          Accept: 'application/json'
        }
      });
    } catch {
      // Ignore network/auth errors here; cookie read below will decide availability.
    }

    const token = getCsrfTokenFromCookie();
    csrfTokenCache = token || null;
    return csrfTokenCache;
  })();

  try {
    return await csrfRefreshPromise;
  } finally {
    csrfRefreshPromise = null;
  }
}

async function ensureCsrfToken(forceRefresh = false) {
  const cookieToken = getCsrfTokenFromCookie();

  if (!forceRefresh && cookieToken) {
    csrfTokenCache = cookieToken;
    return csrfTokenCache;
  }

  // If cookie is missing, do not trust stale in-memory token from a prior auth session.
  if (!cookieToken) {
    csrfTokenCache = null;
  }

  return refreshCsrfToken();
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    const text = await response.text();
    return text || null;
  } catch {
    return null;
  }
}

function normalizeHeaders(inputHeaders) {
  if (inputHeaders instanceof Headers) {
    return Object.fromEntries(inputHeaders.entries());
  }
  return { ...(inputHeaders || {}) };
}

function hasHeader(headers, name) {
  const target = String(name).toLowerCase();
  return Object.keys(headers || {}).some((key) => String(key).toLowerCase() === target);
}

function isCsrfErrorResponse(response, payload) {
  if (response.status !== 403 || !payload || typeof payload !== 'object') {
    return false;
  }
  return typeof payload.code === 'string' && payload.code.startsWith('CSRF_');
}

function getRetryAfterSeconds(response, payload) {
  const bodyRetryAfter = Number(payload?.retryAfter || 0);
  if (Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0) return bodyRetryAfter;

  const headerRetryAfter = Number(response.headers.get('retry-after') || 0);
  if (Number.isFinite(headerRetryAfter) && headerRetryAfter > 0) return headerRetryAfter;

  return null;
}

function getRateLimitCacheKey(path, method) {
  return `${method}:${normalizeRequestKey(path)}`;
}

function runRequestInterceptors(ctx) {
  let current = ctx;
  for (const interceptor of requestInterceptors) {
    try {
      const next = interceptor(current);
      if (next) current = next;
    } catch {
      // Interceptors are best-effort and must not break requests.
    }
  }
  return current;
}

function runResponseInterceptors(ctx) {
  let current = ctx;
  for (const interceptor of responseInterceptors) {
    try {
      const next = interceptor(current);
      if (next) current = next;
    } catch {
      // Interceptors are best-effort and must not break responses.
    }
  }
  return current;
}

async function request(path, options = {}) {
  const method = methodOf(options);
  const isAuthTransition = isAuthTransitionRequest(path, method);
  const cacheKey = method === 'GET' ? normalizeRequestKey(path) : '';
  const rateLimitKey = getRateLimitCacheKey(path, method);
  const shouldSessionCache = isSessionCacheableRequest(path, method);
  const sessionKey = shouldSessionCache ? sessionCacheKey(path) : '';

  const blockedRateLimit = rateLimitCache.get(rateLimitKey);
  if (blockedRateLimit && blockedRateLimit.blockedUntil > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((blockedRateLimit.blockedUntil - Date.now()) / 1000));
    const error = new Error(blockedRateLimit.message || `Too many requests. Please wait ${retryAfter} seconds.`);
    error.status = 429;
    error.code = 'RATE_LIMITED';
    error.retryAfter = retryAfter;
    error.payload = {
      ok: false,
      code: 'RATE_LIMITED',
      message: error.message,
      retryAfter
    };
    throw error;
  }

  if (isAuthTransition) {
    // Prevent reuse of old token across login/logout/signup boundaries.
    csrfTokenCache = null;
    requestCache.clear();
    clearSessionCache();
  }

  if (cacheKey) {
    const cached = requestCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (cached.promise) return cached.promise;
      return cached.payload;
    }
    if (cached) requestCache.delete(cacheKey);
  }

  if (sessionKey) {
    const sessionCached = readSessionCache(sessionKey);
    if (sessionCached !== null && sessionCached !== undefined) {
      requestCache.set(cacheKey, {
        payload: sessionCached,
        expiresAt: Date.now() + REQUEST_CACHE_TTL_MS
      });
      return sessionCached;
    }
  }

  const headers = normalizeHeaders(options.headers);

  const requestOptions = {
    ...options,
    method,
    credentials: options.credentials || 'include',
    headers
  };

  if (!isFormDataBody(requestOptions.body) && !hasHeader(requestOptions.headers, 'Content-Type')) {
    requestOptions.headers['Content-Type'] = 'application/json';
  }

  if (!hasHeader(requestOptions.headers, 'Accept')) {
    requestOptions.headers.Accept = 'application/json';
  }

  if (shouldAttachCsrf(method)) {
    const token = await ensureCsrfToken(false);
    if (token) {
      requestOptions.headers[CSRF_HEADER_NAME] = token;
    }
  }

  const interceptedRequest = runRequestInterceptors({ path, options: requestOptions });
  const fetchPromise = (async () => {
    const response = await rawFetch(resolveApiUrl(interceptedRequest.path), interceptedRequest.options);
    let payload = await parseResponsePayload(response);

    if (shouldAttachCsrf(method) && isCsrfErrorResponse(response, payload)) {
      const refreshedToken = await ensureCsrfToken(true);
      if (refreshedToken) {
        const retryOptions = {
          ...interceptedRequest.options,
          headers: {
            ...normalizeHeaders(interceptedRequest.options.headers),
            [CSRF_HEADER_NAME]: refreshedToken
          }
        };

        const retryResponse = await rawFetch(resolveApiUrl(interceptedRequest.path), retryOptions);
        const retryPayload = await parseResponsePayload(retryResponse);
        const interceptedRetryResponse = runResponseInterceptors({
          response: retryResponse,
          payload: retryPayload,
          path: interceptedRequest.path,
          options: retryOptions
        });

        if (!interceptedRetryResponse.response.ok) {
          const message = interceptedRetryResponse.payload?.error || `Request failed (${interceptedRetryResponse.response.status})`;
          const error = new Error(message);
          error.status = interceptedRetryResponse.response.status;
          error.code = interceptedRetryResponse.payload?.code;
          error.payload = interceptedRetryResponse.payload;
            if (interceptedRetryResponse.response.status === 429) {
            error.retryAfter = getRetryAfterSeconds(interceptedRetryResponse.response, interceptedRetryResponse.payload);
            if (error.retryAfter) {
              rateLimitCache.set(rateLimitKey, {
                blockedUntil: Date.now() + (error.retryAfter * 1000),
                message
              });
            }
            }
          throw error;
        }

        return interceptedRetryResponse.payload;
      }
    }

    const interceptedResponse = runResponseInterceptors({
      response,
      payload,
      path: interceptedRequest.path,
      options: interceptedRequest.options
    });

    payload = interceptedResponse.payload;

    const isTelemetryRequest = isLearnerTelemetryPath(interceptedRequest.path);

    if (isAuthTransition && interceptedResponse.response.ok) {
      await ensureCsrfToken(true);
    }

    if (!interceptedResponse.response.ok) {
      if (interceptedResponse.response.status === 401 || interceptedResponse.response.status === 403) {
        csrfTokenCache = null;

        // Avoid noisy telemetry failures when auth/CSRF state is unavailable.
        if (isTelemetryRequest) {
          telemetryDisabled = true;
          return {
            ok: false,
            skipped: true,
            reason: 'telemetry_unavailable'
          };
        }
      }
      const message = payload?.error || `Request failed (${interceptedResponse.response.status})`;
      const error = new Error(message);
      error.status = interceptedResponse.response.status;
      error.code = payload?.code;
      error.payload = payload;
      if (interceptedResponse.response.status === 429) {
        error.retryAfter = getRetryAfterSeconds(interceptedResponse.response, payload);
        if (error.retryAfter) {
          rateLimitCache.set(rateLimitKey, {
            blockedUntil: Date.now() + (error.retryAfter * 1000),
            message
          });
        }
      }

      if (isApiRequestUrl(path) && !isTelemetryRequest) {
        // Lightweight debug trail for failed API requests.
        const status = interceptedResponse.response.status;
        const code = error.code ? ` ${error.code}` : '';
        console.warn(`API request failed: ${method} ${path} -> ${status}${code} - ${error.message}`);
      }

      throw error;
    }

    if (method !== 'GET') {
      requestCache.clear();
      clearSessionCache();
    }

    return payload;
  })();

  if (cacheKey) {
    requestCache.set(cacheKey, {
      promise: fetchPromise,
      expiresAt: Date.now() + REQUEST_CACHE_TTL_MS
    });
  }

  try {
    const payload = await fetchPromise;
    if (cacheKey) {
      requestCache.set(cacheKey, {
        payload,
        expiresAt: Date.now() + REQUEST_CACHE_TTL_MS
      });
      if (sessionKey) {
        writeSessionCache(sessionKey, payload);
      }
    }
    return payload;
  } catch (error) {
    if (cacheKey) requestCache.delete(cacheKey);
    if (error?.status !== 429) {
      rateLimitCache.delete(rateLimitKey);
    }
    throw error;
  }
}

async function warmupRequests(paths = []) {
  const list = Array.isArray(paths) ? paths : [paths];
  const uniquePaths = [...new Set(list.filter(Boolean).map((entry) => {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof entry.path === 'string') return entry.path;
    return '';
  }).filter(Boolean))];

  return Promise.allSettled(
    uniquePaths.map((entry) => request(entry, { method: 'GET' }))
  );
}

async function warmupRequestsOnce(cacheKey, paths = []) {
  const key = String(cacheKey || '').trim();
  if (!key) return warmupRequests(paths);
  if (warmupOnceCache.has(key)) return [];

  try {
    const storage = getSessionStorage();
    if (storage && storage.getItem(`collegeos_warmup_once:${key}`) === '1') {
      warmupOnceCache.add(key);
      return [];
    }
  } catch {
    // Ignore storage access failures.
  }

  warmupOnceCache.add(key);
  try {
    const result = await warmupRequests(paths);
    try {
      const storage = getSessionStorage();
      storage?.setItem(`collegeos_warmup_once:${key}`, '1');
    } catch {
      // Ignore storage write failures.
    }
    return result;
  } catch (error) {
    warmupOnceCache.delete(key);
    throw error;
  }
}

// Backward-compatible helper used by existing API methods.
async function apiFetch(path, options = {}) {
  return request(path, options);
}

window.CollegeOSApiClient = {
  request,
  ensureCsrfToken,
  getCsrfToken: () => csrfTokenCache || getCsrfTokenFromCookie() || null,
  getApiBaseUrl: () => apiUrl,
  getSocketBaseUrl: () => window.CollegeOSApiConfig?.socketUrl || apiUrl,
  formatErrorMessage,
  warmupRequests,
  warmupRequestsOnce,
  clearSessionCache,
  setCsrfToken: (token) => {
    csrfTokenCache = token || null;
  },
  addRequestInterceptor: (fn) => {
    if (typeof fn === 'function') requestInterceptors.push(fn);
  },
  addResponseInterceptor: (fn) => {
    if (typeof fn === 'function') responseInterceptors.push(fn);
  }
};

// Global compatibility layer: direct fetch('/api/...') calls still get CSRF header.
window.fetch = async function wrappedFetch(input, init = undefined) {
  if (!isApiRequestUrl(input)) {
    return rawFetch(input, init);
  }

  const method = methodOfFetchInput(input, init);

  const incomingHeaders = normalizeHeaders(
    init?.headers || ((typeof Request !== 'undefined' && input instanceof Request) ? input.headers : undefined)
  );
  const headers = {
    ...incomingHeaders
  };

  if (shouldAttachCsrf(method)) {
    const token = await ensureCsrfToken(false);
    if (token && !hasHeader(headers, CSRF_HEADER_NAME)) {
      headers[CSRF_HEADER_NAME] = token;
    }
  }

  const resolvedInput = typeof input === 'string'
    ? input
    : (typeof URL !== 'undefined' && input instanceof URL)
      ? input.toString()
      : input.url || input;

  return rawFetch(resolveApiUrl(resolvedInput), {
    ...(init || {}),
    method,
    credentials: 'include',
    headers
  });
};

async function safeTrackEvent(eventType, eventPayload = {}, source = 'web') {
  if (telemetryDisabled) return;
  if (!eventType || typeof eventType !== 'string') return;

  // Skip telemetry if user context is unavailable (public pages or auth race).
  if (!window.collegeOsCurrentUser) {
    telemetryDisabled = true;
    return;
  }

  // Avoid sending telemetry POSTs until CSRF token is available.
  const csrfToken = getCsrfTokenFromCookie() || csrfTokenCache;
  if (!csrfToken) {
    telemetryDisabled = true;
    return;
  }

  try {
    await apiFetch('/api/intelligence/events', {
      method: 'POST',
      body: JSON.stringify({ eventType, source, eventPayload })
    });
  } catch {
    // Keep user flow uninterrupted when telemetry fails.
  }
}

window.CollegeOSApi = {
  warmupRequests,
  clearSessionCache,
  getAuthConfig: () => apiFetch('/api/auth/config'),
  getCaptchaChallenge: (options = {}) => {
    const requestOptions = { ...options };
    let path = '/api/auth/captcha/challenge';

    if (requestOptions.forceRefresh) {
      const separator = path.includes('?') ? '&' : '?';
      path = `${path}${separator}_=${Date.now()}`;
      delete requestOptions.forceRefresh;
    }

    return apiFetch(path, requestOptions);
  },
  getMe: () => apiFetch('/api/auth/me'),
  login: (data) => apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  loginWithEmailOtp: (data) => apiFetch('/api/auth/login/email-otp', { method: 'POST', body: JSON.stringify(data) }),
  signup: (data) => apiFetch('/api/auth/signup', { method: 'POST', body: JSON.stringify(data) }),
  requestVerificationCode: (data) => apiFetch('/api/auth/verification/request', { method: 'POST', body: JSON.stringify(data) }),
  verifyCode: (data) => apiFetch('/api/auth/verification/verify', { method: 'POST', body: JSON.stringify(data) }),
  forgotPassword: (data) => apiFetch('/api/auth/password/forgot', { method: 'POST', body: JSON.stringify(data) }),
  resetPassword: (data) => apiFetch('/api/auth/password/reset', { method: 'POST', body: JSON.stringify(data) }),
  logoutAllAuthDevices: () => apiFetch('/api/auth/logout-all', { method: 'POST' }),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
  getColleges: () => apiFetch('/api/meta/colleges'),
  getUniversities: (q = '', limit = 30) => apiFetch(`/api/meta/universities?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`),
  getDashboardStats: () => apiFetch('/api/dashboard/stats'),
  getPersonalizedDashboard: () => apiFetch('/api/dashboard/personalized'),
  getStudentExperienceConfig: () => apiFetch('/api/dashboard/experience-config'),
  liveHubStartSession: (payload) => apiFetch('/api/dashboard/live-hub/start', { method: 'POST', body: JSON.stringify(payload) }),
  liveHubEndSession: (payload) => apiFetch('/api/dashboard/live-hub/end', { method: 'POST', body: JSON.stringify(payload) }),
  liveHubAgoraToken: (payload) => apiFetch('/api/dashboard/live-hub/agora-token', { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionsUpcoming: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.scope) qs.set('scope', params.scope);
    if (params.includeEnded !== undefined) qs.set('includeEnded', params.includeEnded ? 'true' : 'false');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/live-sessions/upcoming${suffix}`);
  },
  liveSessionGet: (sessionId) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}`),
  liveSessionCreate: (payload) => apiFetch('/api/live-sessions/create', { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionValidateHostCode: (sessionId, payload) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/validate-host-code`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionUnlockHost: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/unlock-host`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionStart: (sessionId, payload) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/start`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionJoin: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/join`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionLeave: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/leave`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionEnd: (sessionId, payload) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionReschedule: (sessionId, payload) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/reschedule`, { method: 'PATCH', body: JSON.stringify(payload) }),
  liveSessionCancel: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/cancel`, { method: 'DELETE', body: JSON.stringify(payload) }),
  liveSessionPresence: (sessionId) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/presence`),
  liveSessionPresenceUpdate: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/presence`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionActivity: (sessionId, params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/activity${suffix}`);
  },
  liveSessionPostActivity: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/activity`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionChatMessages: (sessionId, params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/chat${suffix}`);
  },
  liveSessionPostChatMessage: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/chat`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionPostReaction: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/reactions`, { method: 'POST', body: JSON.stringify(payload) }),
  liveSessionJoinToken: (sessionId, payload = {}) => apiFetch(`/api/live-sessions/${encodeURIComponent(sessionId)}/join-token`, { method: 'POST', body: JSON.stringify(payload) }),
  adminLiveSessionsSync: (payload) => apiFetch('/api/live-sessions/admin/sync', { method: 'POST', body: JSON.stringify(payload) }),
  getLiveSessionRealtimeStreamUrl: () => '/api/live-sessions/stream',
  getAiBrain: (horizonDays = 7) => apiFetch(`/api/intelligence/brain?horizonDays=${encodeURIComponent(horizonDays)}`),
  getNextAction: () => apiFetch('/api/intelligence/next-action'),
  getAdaptiveStudyPlan: (horizonDays = 7) => apiFetch(`/api/intelligence/study-plan?horizonDays=${encodeURIComponent(horizonDays)}`),
  getAdvancedAnalytics: () => apiFetch('/api/intelligence/analytics'),
  trackLearnerEvent: async (data = {}) => {
    await safeTrackEvent(data.eventType, data.eventPayload || {}, data.source || 'web');
    return { ok: true };
  },
  adminIntelligenceOverview: () => apiFetch('/api/admin/intelligence/overview'),
  adminIntelligenceSegments: () => apiFetch('/api/admin/intelligence/segments'),
  adminGenerateAutomatedResources: (data = {}) => apiFetch('/api/admin/intelligence/resource-automation/generate', { method: 'POST', body: JSON.stringify(data) }),
  adminAiOpsGlobalSettings: () => apiFetch('/api/admin/ai-ops/settings/global'),
  adminAiOpsUpdateGlobalSettings: (payload) => apiFetch('/api/admin/ai-ops/settings/global', { method: 'PUT', body: JSON.stringify(payload) }),
  adminAiOpsTestConnection: (payload = null) => apiFetch('/api/admin/ai-ops/settings/test-connection', { method: 'POST', body: JSON.stringify(payload || {}) }),
  adminAiOpsFeatures: () => apiFetch('/api/admin/ai-ops/features'),
  adminAiOpsFeature: (toolKey) => apiFetch(`/api/admin/ai-ops/features/${encodeURIComponent(toolKey)}`),
  adminAiOpsUpdateFeature: (toolKey, payload) => apiFetch(`/api/admin/ai-ops/features/${encodeURIComponent(toolKey)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminAiOpsPrompt: (toolKey) => apiFetch(`/api/admin/ai-ops/prompts/${encodeURIComponent(toolKey)}`),
  adminAiOpsUpdatePrompt: (toolKey, payload) => apiFetch(`/api/admin/ai-ops/prompts/${encodeURIComponent(toolKey)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminAiOpsRestorePromptVersion: (toolKey, versionId) => apiFetch(`/api/admin/ai-ops/prompts/${encodeURIComponent(toolKey)}/restore/${encodeURIComponent(versionId)}`, { method: 'POST' }),
  adminAiOpsSimulate: (payload) => apiFetch('/api/admin/ai-ops/simulate', { method: 'POST', body: JSON.stringify(payload) }),
  adminAiOpsAnalyticsOverview: (days = 30) => apiFetch(`/api/admin/ai-ops/analytics/overview?days=${encodeURIComponent(days)}`),
  adminAiOpsRequestLogs: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.toolKey) qs.set('toolKey', params.toolKey);
    if (params.provider) qs.set('provider', params.provider);
    if (params.failedOnly) qs.set('failedOnly', 'true');
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/ai-ops/logs/requests${suffix}`);
  },
  adminAiOpsAuditLogs: (limit = 120) => apiFetch(`/api/admin/ai-ops/logs/audit?limit=${encodeURIComponent(limit)}`),
  adminAiOpsUserCredits: (userId) => apiFetch(`/api/admin/ai-ops/credits/users/${encodeURIComponent(userId)}`),
  adminAiOpsResetUserCredits: (userId, payload) => apiFetch(`/api/admin/ai-ops/credits/users/${encodeURIComponent(userId)}/reset`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  adminAiOpsBonusUserCredits: (userId, payload) => apiFetch(`/api/admin/ai-ops/credits/users/${encodeURIComponent(userId)}/bonus`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  adminAiOpsUpdateUserOverride: (userId, payload) => apiFetch(`/api/admin/ai-ops/credits/users/${encodeURIComponent(userId)}/override`, { method: 'PUT', body: JSON.stringify(payload || {}) }),
  adminAiOpsBlockUser: (userId, payload) => apiFetch(`/api/admin/ai-ops/credits/users/${encodeURIComponent(userId)}/block`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  adminAiOpsPlanEntitlements: () => apiFetch('/api/admin/ai-ops/plans/entitlements'),
  adminAiOpsUpdatePlanEntitlements: (planCode, entitlements, campaignLabel = '') => apiFetch(`/api/admin/ai-ops/plans/entitlements/${encodeURIComponent(planCode)}`, {
    method: 'PUT',
    body: JSON.stringify({ entitlements, campaignLabel })
  }),
  getProfile: () => apiFetch('/api/profile/me'),
  updateProfile: (data) => apiFetch('/api/profile/me', { method: 'PUT', body: JSON.stringify(data) }),
  changePassword: (data) => apiFetch('/api/profile/me/password', { method: 'PUT', body: JSON.stringify(data) }),
  getLeaderboard: (options = {}) => {
    const scope = options.scope || 'india';
    const timeframe = options.timeframe || 'all';
    const search = options.search || '';
    const qs = new URLSearchParams({ scope, timeframe });
    if (search) qs.set('search', search);
    return apiFetch(`/api/leaderboard?${qs.toString()}`);
  },
  getRoadmap: () => apiFetch('/api/roadmaps/me'),
  createRoadmap: async (data) => {
    const payload = await apiFetch('/api/roadmaps/me', { method: 'POST', body: JSON.stringify(data) });
    safeTrackEvent('roadmap_created', { roadmapId: payload?.roadmap?.id || null });
    return payload;
  },
  updateRoadmap: async (id, data) => {
    const payload = await apiFetch(`/api/roadmaps/me/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    safeTrackEvent('roadmap_updated', { roadmapId: id, progress: data?.progress || null });
    return payload;
  },
  getCareerRoadmaps: () => apiFetch('/api/career/roadmaps'),
  getCareerRoadmap: (id) => apiFetch(`/api/career/roadmaps/${id}`),
  getAiToolsCatalog: () => apiFetch('/api/career/ai-tools'),
  getAiToolRuntime: () => apiFetch('/api/career/ai-tools/runtime'),
  generateAiToolOutput: (toolKey, inputs = {}) => apiFetch('/api/career/ai-tools/generate', {
    method: 'POST',
    body: JSON.stringify({ toolKey, inputs })
  }),
  aiStudioChat: (prompt) => apiFetch('/api/career/ai-tools/studio/chat', {
    method: 'POST',
    body: JSON.stringify({ prompt })
  }),
  aiStudioQuizFromNotes: (notes, extra = {}) => apiFetch('/api/career/ai-tools/studio/quiz-from-notes', {
    method: 'POST',
    body: JSON.stringify({ notes, ...extra })
  }),
  aiStudioSessionSummary: (transcript, extra = {}) => apiFetch('/api/career/ai-tools/studio/session-summary', {
    method: 'POST',
    body: JSON.stringify({ transcript, ...extra })
  }),
  aiStudioAttendanceInsights: (payload = {}) => apiFetch('/api/career/ai-tools/studio/attendance-insights', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  aiStudioPerformancePrediction: (payload = {}) => apiFetch('/api/career/ai-tools/studio/performance-prediction', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  aiStudioRecommendations: (payload = {}) => apiFetch('/api/career/ai-tools/studio/recommendations', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  getNotes: (search = '') => apiFetch(`/api/notes${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getMyNotes: () => apiFetch('/api/notes/mine'),
  getNote: (id) => apiFetch(`/api/notes/${id}`),
  createNote: async (data) => {
    const payload = await apiFetch('/api/notes', { method: 'POST', body: JSON.stringify(data) });
    safeTrackEvent('note_created', { noteId: payload?.note?.id || null, subject: data?.subject || null });
    return payload;
  },
  updateNote: (id, data) => apiFetch(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteNote: (id) => apiFetch(`/api/notes/${id}`, { method: 'DELETE' }),
  getCertificates: () => apiFetch('/api/certificates/mine'),
  createCertificate: (data) => apiFetch('/api/certificates', { method: 'POST', body: JSON.stringify(data) }),
  getReferrals: () => apiFetch('/api/referrals/mine'),
  applyReferral: (code) => apiFetch('/api/referrals/apply', { method: 'POST', body: JSON.stringify({ code }) }),
  getReferralDashboard: () => apiFetch('/api/referrals/mine'),
  getSettingsIcons: () => apiFetch('/api/settings/icons'),
  updateSettingsIcons: (data) => apiFetch('/api/settings/icons', { method: 'PUT', body: JSON.stringify(data) }),
  getActiveSessions: () => apiFetch('/api/settings/sessions'),
  logoutAllDevices: () => apiFetch('/api/settings/sessions/logout-all', { method: 'POST' }),
  getNotifications: () => apiFetch('/api/notifications/mine'),
  getUnreadNotificationCount: () => apiFetch('/api/notifications/unread-count'),
  markNotificationRead: (id) => apiFetch(`/api/notifications/mine/${id}/read`, { method: 'PUT' }),
  markAllNotificationsRead: () => apiFetch('/api/notifications/mine/read-all', { method: 'PUT' }),
  deleteNotification: (id) => apiFetch(`/api/notifications/mine/${id}`, { method: 'DELETE' }),
  getThreads: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.filter) qs.set('filter', params.filter);
    if (params.category) qs.set('category', params.category);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/forum/threads${suffix}`);
  },
  getTrendingThreads: () => apiFetch('/api/forum/threads/trending'),
  getThreadDetail: (id) => apiFetch(`/api/forum/threads/${id}`),
  incrementThreadViews: (id) => apiFetch(`/api/forum/threads/${id}/view`, { method: 'POST' }),
  createThread: (data) => apiFetch('/api/forum/threads', { method: 'POST', body: JSON.stringify(data) }),
  createReply: (threadId, data) => apiFetch(`/api/forum/threads/${threadId}/replies`, { method: 'POST', body: JSON.stringify(data) }),
  upvoteReply: (replyId) => apiFetch(`/api/forum/replies/${replyId}/upvote`, { method: 'POST' }),
  markBestAnswer: (threadId, replyId) => apiFetch(`/api/forum/threads/${threadId}/best-answer/${replyId}`, { method: 'POST' }),
  getCampusFeedSummary: () => apiFetch('/api/campus-feed/me/summary'),
  getCampusFeedPosts: (tab = 'latest', limit = 25) => apiFetch(`/api/campus-feed/posts?tab=${encodeURIComponent(tab)}&limit=${encodeURIComponent(limit)}`),
  getCampusTrending: (limit = 8) => apiFetch(`/api/campus-feed/posts/trending?limit=${encodeURIComponent(limit)}`),
  getCampusMySubmissions: () => apiFetch('/api/campus-feed/posts/mine'),
  getCampusPostComments: (postId) => apiFetch(`/api/campus-feed/posts/${postId}/comments`),
  getCampusCreatorProfile: (userId) => apiFetch(`/api/campus-feed/creator/${userId}`),
  getCampusShareLink: (postId) => apiFetch(`/api/campus-feed/posts/${postId}/share-link`),
  submitCampusViewSignal: (postId, data) => apiFetch(`/api/campus-feed/posts/${postId}/signal`, {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  reportCampusPost: (postId, reason, details = '') => apiFetch(`/api/campus-feed/posts/${postId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, details })
  }),
  voteCampusPoll: (postId, selectedIndex) => apiFetch(`/api/campus-feed/posts/${postId}/poll-vote`, {
    method: 'POST',
    body: JSON.stringify({ selectedIndex })
  }),
  getCampusCollections: () => apiFetch('/api/campus-feed/collections'),
  createCampusCollection: (name) => apiFetch('/api/campus-feed/collections', {
    method: 'POST',
    body: JSON.stringify({ name })
  }),
  getCampusCollectionPosts: (collectionId) => apiFetch(`/api/campus-feed/collections/${collectionId}/posts`),
  addCampusCollectionPost: (collectionId, postId) => apiFetch(`/api/campus-feed/collections/${collectionId}/posts/${postId}`, {
    method: 'POST'
  }),
  removeCampusCollectionPost: (collectionId, postId) => apiFetch(`/api/campus-feed/collections/${collectionId}/posts/${postId}`, {
    method: 'DELETE'
  }),
  getCampusRealtimeStreamUrl: () => '/api/campus-feed/stream',
  getNotificationRealtimeStreamUrl: () => '/api/notifications/stream',
  createCampusPost: async (formData) => {
    const payload = await apiFetch('/api/campus-feed/posts', {
      method: 'POST',
      body: formData
    });
    safeTrackEvent('campus_post_submitted', {
      postType: formData.get('postType') || null,
      category: formData.get('category') || null
    });
    return payload;
  },
  engageCampusPost: (postId, type) => apiFetch(`/api/campus-feed/posts/${postId}/engagement`, {
    method: 'POST',
    body: JSON.stringify({ type })
  }),
  commentCampusPost: (postId, body) => apiFetch(`/api/campus-feed/posts/${postId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body })
  }),
  adminCampusFeedModeration: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.search) qs.set('search', params.search);
    if (params.collegeId) qs.set('collegeId', String(params.collegeId));
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/campus-feed/moderation${suffix}`);
  },
  adminCampusModeratePost: (postId, action, reason = '') => apiFetch(`/api/admin/campus-feed/posts/${postId}/moderate`, {
    method: 'POST',
    body: JSON.stringify({ action, reason })
  }),
  adminCampusFeaturePost: (postId, isFeatured = true) => apiFetch(`/api/admin/campus-feed/posts/${postId}/feature`, {
    method: 'POST',
    body: JSON.stringify({ isFeatured })
  }),
  adminCampusUpdatePost: (postId, data) => apiFetch(`/api/admin/campus-feed/posts/${postId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  adminCampusMarkOfficial: (postId, isOfficial = true, isImportant = false) => apiFetch(`/api/admin/campus-feed/posts/${postId}/mark-official`, {
    method: 'POST',
    body: JSON.stringify({ isOfficial, isImportant })
  }),
  adminCampusCreateOfficialPost: async (formData) => {
    return apiFetch('/api/admin/campus-feed/official-posts', {
      method: 'POST',
      body: formData
    });
  },
  adminCampusReports: (status = 'pending', limit = 120) => apiFetch(`/api/admin/campus-feed/reports?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`),
  adminCampusResolveReport: (reportId, action = 'resolved', postAction = 'none', pointsDelta = 0) => apiFetch(`/api/admin/campus-feed/reports/${reportId}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ action, postAction, pointsDelta })
  }),
  adminCampusAssignCreatorRole: (userId, role) => apiFetch(`/api/admin/campus-feed/creators/${userId}/role`, {
    method: 'POST',
    body: JSON.stringify({ role })
  }),
  adminCampusUpdateCreatorTrust: (userId, trustLevel = '', campusRole = '') => apiFetch(`/api/admin/campus-feed/creators/${userId}/trust`, {
    method: 'POST',
    body: JSON.stringify({ trustLevel, campusRole })
  }),
  adminCampusSetCreatorSuspension: (userId, suspend, reason = '', until = '') => apiFetch(`/api/admin/campus-feed/creators/${userId}/suspension`, {
    method: 'POST',
    body: JSON.stringify({ suspend, reason, until })
  }),
  adminCampusAdjustCreatorPoints: (userId, amount, actionType = 'add', reason = '') => apiFetch(`/api/admin/campus-feed/creators/${userId}/points`, {
    method: 'POST',
    body: JSON.stringify({ amount, actionType, reason })
  }),
  adminCampusAnalytics: () => apiFetch('/api/admin/campus-feed/analytics'),
  getQuizzes: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.branchId) qs.set('branchId', params.branchId);
    if (params.semesterId) qs.set('semesterId', params.semesterId);
    if (params.subject) qs.set('subject', params.subject);
    const q = qs.toString();
    return apiFetch('/api/quizzes' + (q ? '?' + q : ''));
  },
  getMyQuizAttempts: () => apiFetch('/api/quizzes/attempts/me'),
  saveQuizAttempt: async (quizId, data) => {
    const payload = await apiFetch(`/api/quizzes/${quizId}/attempts`, { method: 'POST', body: JSON.stringify(data) });
    safeTrackEvent('quiz_attempt_submitted', {
      quizId,
      scorePercent: data?.scorePercent,
      xpEarned: data?.xpEarned
    });
    return payload;
  },
  getMockTests: () => apiFetch('/api/mock-tests'),
  getMockTestsDashboard: () => apiFetch('/api/mock-tests/dashboard'),
  getMockTestsLeaderboard: () => apiFetch('/api/mock-tests/leaderboard'),
  startMockTest: async (mockTestId) => {
    const payload = await apiFetch(`/api/mock-tests/${mockTestId}/start`);
    safeTrackEvent('mock_test_started', { mockTestId });
    return payload;
  },
  submitMockTest: async (mockTestId, payload) => {
    const response = await apiFetch(`/api/mock-tests/${mockTestId}/submit`, { method: 'POST', body: JSON.stringify(payload) });
    safeTrackEvent('mock_test_submitted', {
      mockTestId,
      timeSpentSeconds: payload?.timeSpentSeconds,
      responseCount: Array.isArray(payload?.responses) ? payload.responses.length : null
    });
    return response;
  },
  getMockTestResult: (attemptId) => apiFetch(`/api/mock-tests/results/${attemptId}`),
  getSubscription: () => apiFetch('/api/subscriptions/me'),
  getMembershipCenterConfig: () => apiFetch('/api/subscriptions/me').then((r) => ({ config: r.membershipConfig || null, subscription: r })),
  getSubscriptionPayments: () => apiFetch('/api/subscriptions/payments'),
  submitPaymentRequest: async (formData) => {
    return apiFetch('/api/subscriptions/payment-request', {
      method: 'POST',
      body: formData
    });
  },
  submitFeedback: (data) => apiFetch('/api/feedback', { method: 'POST', body: JSON.stringify(data) }),
  getMyFeedback: () => apiFetch('/api/feedback/mine'),
  getMyFeedbackByFilter: (filter = 'all') => apiFetch(`/api/feedback/mine?filter=${encodeURIComponent(filter)}`),
  getFeedbackStats: () => apiFetch('/api/feedback/stats'),
  updateFeedback: (id, data) => apiFetch(`/api/feedback/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFeedback: (id) => apiFetch(`/api/feedback/${id}`, { method: 'DELETE' }),
  uploadFeedbackScreenshot: async (file) => {
    const formData = new FormData();
    formData.append('screenshot', file);
    return apiFetch('/api/feedback/upload-screenshot', {
      method: 'POST',
      body: formData
    });
  },
  adminLogin: async (data) => {
    try {
      const payload = await apiFetch('/api/admin/login', { method: 'POST', body: JSON.stringify(data) });
      if (payload?.user?.role && payload.user.role !== 'admin' && payload.user.role !== 'super_admin') {
        throw new Error('Admin access required');
      }
      return payload;
    } catch (error) {
      const isStaleCsrfGuard = error?.status === 401
        && String(error?.code || '').toUpperCase() === 'UNAUTHORIZED'
        && /authentication required/i.test(String(error?.message || ''));

      if (!isStaleCsrfGuard) {
        throw error;
      }

      const fallbackPayload = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
      if (fallbackPayload?.user?.role !== 'admin' && fallbackPayload?.user?.role !== 'super_admin') {
        throw new Error('Admin access required');
      }
      return fallbackPayload;
    }
  },
  adminDashboard: () => apiFetch('/api/admin/dashboard'),
  adminStudents: (college = '') => apiFetch(`/api/admin/students${college ? `?college=${encodeURIComponent(college)}` : ''}`),
  adminCreateUser: (data) => apiFetch('/api/admin/users/admin', { method: 'POST', body: JSON.stringify(data) }),
  adminTrends: () => apiFetch('/api/admin/trends'),
  adminFeedback: () => apiFetch('/api/admin/feedback'),
  adminReplyFeedback: (id, reply) => apiFetch(`/api/admin/feedback/${id}/reply`, { method: 'PUT', body: JSON.stringify({ reply }) }),
  adminMembershipPayments: (status = 'all') => apiFetch(`/api/admin/membership-payments?status=${encodeURIComponent(status)}`),
  adminUpdateMembershipPayment: (id, status, reason = '') => apiFetch(`/api/admin/membership-payments/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status, reason })
  }),
  adminSearchStudents: (q = '') => apiFetch(`/api/admin/students/search${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  adminGetCertificates: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.type) qs.set('type', params.type);
    if (params.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/certificates${suffix}`);
  },
  adminGetCertificate: (id) => apiFetch(`/api/admin/certificates/${id}`),
  adminCreateCertificate: (data) => apiFetch('/api/admin/certificates', { method: 'POST', body: JSON.stringify(data) }),
  adminUpdateCertificate: (id, data) => apiFetch(`/api/admin/certificates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminDeleteCertificate: (id) => apiFetch(`/api/admin/certificates/${id}`, { method: 'DELETE' }),
  adminIssueCertificate: (id) => apiFetch(`/api/admin/certificates/${id}/issue`, { method: 'POST' }),
  adminReissueCertificate: (id) => apiFetch(`/api/admin/certificates/${id}/reissue`, { method: 'POST' }),
  adminVerifyCertificate: (id) => apiFetch(`/api/admin/certificates/${id}/verify`, { method: 'POST' }),
  adminRevokeCertificate: (id) => apiFetch(`/api/admin/certificates/${id}/revoke`, { method: 'POST' }),
  adminBulkCertificates: (action, ids) => apiFetch('/api/admin/certificates/bulk', { method: 'POST', body: JSON.stringify({ action, ids }) }),

  // Academic Profile & Onboarding APIs
  getAcademicCategories: () => apiFetch('/api/academics/categories'),
  getAcademicBranches: (categoryId) => apiFetch(`/api/academics/branches?categoryId=${categoryId}`),
  getAcademicSemesters: () => apiFetch('/api/academics/semesters'),
  getAcademicSubjects: (branchId, semesterId) => {
    let url = `/api/academics/subjects?branchId=${branchId}`;
    if (semesterId) url += `&semesterId=${semesterId}`;
    return apiFetch(url);
  },
  getStudentAcademicProfile: () => apiFetch('/api/academics/profile'),
  getOnboardingConfig: () => apiFetch('/api/academics/onboarding/config'),
  completeAcademicOnboarding: (data) => apiFetch('/api/academics/onboarding/complete', { method: 'POST', body: JSON.stringify(data) }),
  updateAcademicProfile: (data) => apiFetch('/api/academics/profile', { method: 'PUT', body: JSON.stringify(data) }),

  // Admin Academic Content Management APIs
  getAcademicContentOverview: () => apiFetch('/api/admin/academics/content-overview'),
  adminCreateAcademicNote: (data) => apiFetch('/api/admin/academics/notes', { method: 'POST', body: JSON.stringify(data) }),
  adminGetAcademicNotes: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.categoryId) qs.set('categoryId', params.categoryId);
    if (params.branchId) qs.set('branchId', params.branchId);
    if (params.semesterId) qs.set('semesterId', params.semesterId);
    if (params.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/academics/notes${suffix}`);
  },
  adminUpdateAcademicNote: (id, data) => apiFetch(`/api/admin/academics/notes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminDeleteAcademicNote: (id) => apiFetch(`/api/admin/academics/notes/${id}`, { method: 'DELETE' }),
  adminCreateAcademicQuiz: (data) => apiFetch('/api/admin/academics/quizzes', { method: 'POST', body: JSON.stringify(data) }),
  adminGetAcademicQuizzes: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.categoryId) qs.set('categoryId', params.categoryId);
    if (params.branchId) qs.set('branchId', params.branchId);
    if (params.semesterId) qs.set('semesterId', params.semesterId);
    if (params.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/academics/quizzes${suffix}`);
  },
  adminDeleteAcademicQuiz: (id) => apiFetch(`/api/admin/academics/quizzes/${id}`, { method: 'DELETE' }),
  adminGetAcademicsDashboard: () => apiFetch('/api/admin/academics/dashboard'),

  // Student Academic Contribution Hub APIs
  getContributionConfig: () => apiFetch('/api/contributions/config'),
  getContributionOptions: () => apiFetch('/api/contributions/options'),
  getMyAcademicContributions: (status = '') => apiFetch(`/api/contributions/mine${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getAcademicContributionDashboard: () => apiFetch('/api/contributions/dashboard'),
  getAcademicContributionLibrary: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.branchId) qs.set('branchId', String(params.branchId));
    if (params.semesterId) qs.set('semesterId', String(params.semesterId));
    if (params.subject) qs.set('subject', params.subject);
    if (params.resourceType) qs.set('resourceType', params.resourceType);
    if (params.examType) qs.set('examType', params.examType);
    if (params.search) qs.set('search', params.search);
    if (params.sortBy) qs.set('sortBy', params.sortBy);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/contributions/library${suffix}`);
  },
  getAcademicContributionResourceDetail: (id) => apiFetch(`/api/contributions/resource/${id}`),
  registerContributionDownload: (id) => apiFetch(`/api/contributions/${id}/download`, { method: 'POST' }),
  resubmitAcademicContribution: async (id, formData) => {
    return apiFetch(`/api/contributions/${id}/resubmit`, {
      method: 'POST',
      body: formData
    });
  },
  submitContributionFeedback: (id, payload) => apiFetch(`/api/contributions/${id}/feedback`, { method: 'POST', body: JSON.stringify(payload) }),
  getContributionCollections: () => apiFetch('/api/contributions/collections'),
  createContributionCollection: (payload) => apiFetch('/api/contributions/collections', { method: 'POST', body: JSON.stringify(payload) }),
  getContributionCollectionItems: (id) => apiFetch(`/api/contributions/collections/${id}/items`),
  addContributionToCollection: (id, payload) => apiFetch(`/api/contributions/collections/${id}/items`, { method: 'POST', body: JSON.stringify(payload) }),
  removeContributionFromCollection: (id, resourceId) => apiFetch(`/api/contributions/collections/${id}/items/${resourceId}`, { method: 'DELETE' }),
  getContributionLeaderboard: (range = 'monthly') => apiFetch(`/api/contributions/leaderboard?range=${encodeURIComponent(range)}`),
  getContributionContributorProfile: (userId) => apiFetch(`/api/contributions/contributor/${userId}/profile`),
  getContributionSeasonMode: (windowDays = 30) => apiFetch(`/api/contributions/season-mode?windowDays=${encodeURIComponent(windowDays)}`),
  getContributionUploadGuidance: () => apiFetch('/api/contributions/guidance'),
  getContributionSearchSuggestions: (q) => apiFetch(`/api/contributions/search/suggestions?q=${encodeURIComponent(q || '')}`),
  getContributionInstantSearch: (q) => apiFetch(`/api/contributions/search/instant?q=${encodeURIComponent(q || '')}`),
  getContributionPreviewConfig: (id) => apiFetch(`/api/contributions/${id}/preview`),
  pushContributionPreviewEvents: (id, events) => apiFetch(`/api/contributions/${id}/preview/events`, { method: 'POST', body: JSON.stringify({ events }) }),
  getContributionPreviewInsights: (id) => apiFetch(`/api/contributions/${id}/preview/insights`),
  getContributionCommunity: (id) => apiFetch(`/api/contributions/${id}/community`),
  postContributionCommunity: (id, payload) => apiFetch(`/api/contributions/${id}/community`, { method: 'POST', body: JSON.stringify(payload) }),
  upvoteContributionCommunityComment: (commentId) => apiFetch(`/api/contributions/community/${commentId}/upvote`, { method: 'POST' }),
  resolveContributionCommunityComment: (commentId) => apiFetch(`/api/contributions/community/${commentId}/resolve`, { method: 'POST' }),
  getContributionAiInsights: (id) => apiFetch(`/api/contributions/${id}/ai-insights`),
  getContributionGrowthStatus: () => apiFetch('/api/contributions/growth/status'),
  getContributionDownloadIntelligence: (windowDays = 30) => apiFetch(`/api/contributions/analytics/download-intelligence?windowDays=${encodeURIComponent(windowDays)}`),
  submitAcademicContribution: async (formData) => {
    return apiFetch('/api/contributions/submit', {
      method: 'POST',
      body: formData
    });
  },

  // Admin moderation for student contributions
  adminGetContributionConfig: () => apiFetch('/api/admin/contributions/config'),
  adminUpdateContributionConfig: (config) => apiFetch('/api/admin/contributions/config', { method: 'PUT', body: JSON.stringify({ config }) }),
  adminGetContributionModerationQueue: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.resourceType) qs.set('resourceType', params.resourceType);
    if (params.college) qs.set('college', params.college);
    if (params.branchId) qs.set('branchId', String(params.branchId));
    if (params.issue) qs.set('issue', params.issue);
    if (params.queueType) qs.set('queueType', params.queueType);
    if (params.search) qs.set('search', params.search);
    if (params.onlyFeatured) qs.set('onlyFeatured', 'true');
    if (params.onlyHidden) qs.set('onlyHidden', 'true');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/contributions/moderation${suffix}`);
  },
  adminBulkModerateContributions: (payload) => apiFetch('/api/admin/contributions/moderation/bulk-action', { method: 'POST', body: JSON.stringify(payload) }),
  adminGetContributionModerationDetail: (id) => apiFetch(`/api/admin/contributions/moderation/${id}`),
  adminRollbackContributionModeration: (id) => apiFetch(`/api/admin/contributions/moderation/${id}/rollback`, { method: 'POST' }),
  adminUpdateContributionMetadata: (id, payload) => apiFetch(`/api/admin/contributions/${id}/metadata`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminModerateContribution: (id, payload) => apiFetch(`/api/admin/contributions/${id}/moderate`, { method: 'POST', body: JSON.stringify(payload) }),
  adminContributionContributors: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/contributions/contributors${suffix}`);
  },
  adminControlContributionContributor: (userId, payload) => apiFetch(`/api/admin/contributions/contributors/${userId}/control`, { method: 'POST', body: JSON.stringify(payload) }),
  adminBulkContributionContributorControl: (payload) => apiFetch('/api/admin/contributions/contributors/bulk-control', { method: 'POST', body: JSON.stringify(payload) }),
  adminAdjustContributionPoints: (userId, payload) => apiFetch(`/api/admin/contributions/contributors/${userId}/points-adjust`, { method: 'POST', body: JSON.stringify(payload) }),
  adminContributionContributorPerformance: () => apiFetch('/api/admin/contributions/contributors/performance'),
  adminContributionArchiveIntelligence: () => apiFetch('/api/admin/contributions/archive/intelligence'),
  adminContributionMergeDuplicates: (payload) => apiFetch('/api/admin/contributions/archive/merge-duplicates', { method: 'POST', body: JSON.stringify(payload) }),
  adminContributionHighlightBestVersion: (id) => apiFetch('/api/admin/contributions/archive/highlight-best-version', { method: 'POST', body: JSON.stringify({ id }) }),
  adminContributionRewardSuggestion: (id) => apiFetch(`/api/admin/contributions/rewards/suggest/${id}`),
  adminContributionAnalyticsOverview: () => apiFetch('/api/admin/contributions/analytics/overview'),
  adminContributionAnalyticsAdvanced: () => apiFetch('/api/admin/contributions/analytics/advanced'),
  adminContributionAuditLogs: (limit = 120) => apiFetch(`/api/admin/contributions/audit/logs?limit=${encodeURIComponent(limit)}`),

  // Unified Admin Control System APIs
  adminControlPermissions: () => apiFetch('/api/admin/control/me/permissions'),
  adminControlStudents: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.membership) qs.set('membership', params.membership);
    if (params.status) qs.set('status', params.status);
    if (params.branchId) qs.set('branchId', params.branchId);
    if (params.includeDeleted) qs.set('includeDeleted', 'true');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/control/students${suffix}`);
  },
  adminControlStudentDetail: (id) => apiFetch(`/api/admin/control/students/${id}`),
  adminControlUpdateStudent: (id, data) => apiFetch(`/api/admin/control/students/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlResetStudentPassword: (id, newPassword) => apiFetch(`/api/admin/control/students/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ newPassword }) }),
  adminControlStudentStatus: (id, status) => apiFetch(`/api/admin/control/students/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  adminControlStudentMembership: (id, data) => apiFetch(`/api/admin/control/students/${id}/membership`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlDeleteStudent: (id) => apiFetch(`/api/admin/control/students/${id}`, { method: 'DELETE' }),
  adminControlRestoreStudent: (id) => apiFetch(`/api/admin/control/students/${id}/restore`, { method: 'POST' }),
  adminControlBulkStudents: (payload) => apiFetch('/api/admin/control/students/bulk-action', { method: 'POST', body: JSON.stringify(payload) }),
  adminControlBulkPaymentsStatus: (payload) => apiFetch('/api/admin/control/payments/bulk-status', { method: 'POST', body: JSON.stringify(payload) }),
  adminControlDeactivateExpired: () => apiFetch('/api/admin/control/payments/deactivate-expired', { method: 'POST' }),
  adminControlRevenueSummary: () => apiFetch('/api/admin/control/payments/revenue-summary'),
  adminControlContentOverview: () => apiFetch('/api/admin/control/content/overview'),
  adminControlBranches: () => apiFetch('/api/admin/control/branches'),
  adminControlUniversities: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.includeDisabled) qs.set('includeDisabled', 'true');
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/control/universities${suffix}`);
  },
  adminControlCreateUniversity: (data) => apiFetch('/api/admin/control/universities', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateUniversity: (id, data) => apiFetch(`/api/admin/control/universities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlDeleteUniversity: (id) => apiFetch(`/api/admin/control/universities/${id}`, { method: 'DELETE' }),
  adminControlReorderUniversities: (orderedIds) => apiFetch('/api/admin/control/universities/reorder', { method: 'POST', body: JSON.stringify({ orderedIds }) }),
  adminControlAcademicCategories: () => apiFetch('/api/admin/control/academic/categories'),
  adminControlCreateAcademicCategory: (data) => apiFetch('/api/admin/control/academic/categories', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateAcademicCategory: (id, data) => apiFetch(`/api/admin/control/academic/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlAcademicSemesters: () => apiFetch('/api/admin/control/academic/semesters'),
  adminControlCreateAcademicSemester: (data) => apiFetch('/api/admin/control/academic/semesters', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateAcademicSemester: (id, data) => apiFetch(`/api/admin/control/academic/semesters/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlCreateBranch: (data) => apiFetch('/api/admin/control/branches', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateBranch: (id, data) => apiFetch(`/api/admin/control/branches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlDeleteBranch: (id) => apiFetch(`/api/admin/control/branches/${id}`, { method: 'DELETE' }),
  adminControlAssignBranchContent: (data) => apiFetch('/api/admin/control/branches/assign', { method: 'POST', body: JSON.stringify(data) }),
  adminControlOnboardingConfig: () => apiFetch('/api/admin/control/onboarding/config'),
  adminControlUpdateOnboardingConfig: (data) => apiFetch('/api/admin/control/onboarding/config', { method: 'PUT', body: JSON.stringify(data) }),
  adminControlOnboardingOptions: (group = '') => apiFetch(`/api/admin/control/onboarding/options${group ? `?group=${encodeURIComponent(group)}` : ''}`),
  adminControlCreateOnboardingOption: (data) => apiFetch('/api/admin/control/onboarding/options', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateOnboardingOption: (id, data) => apiFetch(`/api/admin/control/onboarding/options/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlDisableOnboardingOption: (id) => apiFetch(`/api/admin/control/onboarding/options/${id}`, { method: 'DELETE' }),
  adminControlRecommendationRules: () => apiFetch('/api/admin/control/recommendation-rules'),
  adminControlCreateRecommendationRule: (data) => apiFetch('/api/admin/control/recommendation-rules', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateRecommendationRule: (id, data) => apiFetch(`/api/admin/control/recommendation-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlDeleteRecommendationRule: (id) => apiFetch(`/api/admin/control/recommendation-rules/${id}`, { method: 'DELETE' }),
  adminControlBulkContentAction: (type, payload) => apiFetch(`/api/admin/control/content/${type}/bulk`, { method: 'POST', body: JSON.stringify(payload) }),
  adminControlResetQuizResults: (id) => apiFetch(`/api/admin/control/quizzes/${id}/reset-results`, { method: 'POST' }),
  adminControlMockTests: (query = '') => apiFetch(`/api/admin/control/mock-tests${query || ''}`),
  adminControlCreateMockTest: (data) => apiFetch('/api/admin/control/mock-tests', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateMockTest: (id, data) => apiFetch(`/api/admin/control/mock-tests/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlDeleteMockTest: (id) => apiFetch(`/api/admin/control/mock-tests/${id}`, { method: 'DELETE' }),
  adminControlRestoreMockTest: (id) => apiFetch(`/api/admin/control/mock-tests/${id}/restore`, { method: 'POST' }),
  adminControlMockTestQuestions: (mockTestId) => apiFetch(`/api/admin/control/mock-tests/${mockTestId}/questions`),
  adminControlCreateMockTestQuestion: (mockTestId, data) => apiFetch(`/api/admin/control/mock-tests/${mockTestId}/questions/manual`, { method: 'POST', body: JSON.stringify(data) }),
  adminControlBulkUploadMockTestQuestions: (mockTestId, rows) => apiFetch(`/api/admin/control/mock-tests/${mockTestId}/questions/bulk`, { method: 'POST', body: JSON.stringify({ rows }) }),
  adminControlDeleteMockTestQuestion: (mockTestId, questionId) => apiFetch(`/api/admin/control/mock-tests/${mockTestId}/questions/${questionId}`, { method: 'DELETE' }),
  adminControlMockTestAnalytics: () => apiFetch('/api/admin/control/mock-tests/analytics/overview'),
  adminControlRoadmaps: () => apiFetch('/api/admin/control/roadmaps'),
  adminControlCreateRoadmap: (data) => apiFetch('/api/admin/control/roadmaps', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateRoadmap: (id, data) => apiFetch(`/api/admin/control/roadmaps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlRoadmapMilestones: (id, milestones) => apiFetch(`/api/admin/control/roadmaps/${id}/milestones`, { method: 'POST', body: JSON.stringify({ milestones }) }),
  adminControlPublishRoadmap: (id) => apiFetch(`/api/admin/control/roadmaps/${id}/publish`, { method: 'POST' }),
  adminControlHideRoadmap: (id) => apiFetch(`/api/admin/control/roadmaps/${id}/hide`, { method: 'POST' }),
  adminControlBulkCertificates: (payload) => apiFetch('/api/admin/control/certificates/bulk-assign', { method: 'POST', body: JSON.stringify(payload) }),
  adminControlRevokeCertificate: (id) => apiFetch(`/api/admin/control/certificates/${id}/revoke`, { method: 'POST' }),
  adminControlVerifyCertificate: (code) => apiFetch(`/api/admin/control/certificates/verify/${encodeURIComponent(code)}`),
  adminControlSendNotifications: (payload) => apiFetch('/api/admin/control/notifications/send', { method: 'POST', body: JSON.stringify(payload) }),
  adminControlAnnouncements: () => apiFetch('/api/admin/control/announcements'),
  adminControlCreateAnnouncement: (data) => apiFetch('/api/admin/control/announcements', { method: 'POST', body: JSON.stringify(data) }),
  adminControlUpdateAnnouncement: (id, data) => apiFetch(`/api/admin/control/announcements/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminControlDeleteAnnouncement: (id) => apiFetch(`/api/admin/control/announcements/${id}`, { method: 'DELETE' }),
  adminControlForumPosts: () => apiFetch('/api/admin/control/forum/posts'),
  adminControlHideForumPost: (id, hidden = true) => apiFetch(`/api/admin/control/forum/posts/${id}/hide`, { method: 'POST', body: JSON.stringify({ hidden }) }),
  adminControlDeleteForumPost: (id) => apiFetch(`/api/admin/control/forum/posts/${id}`, { method: 'DELETE' }),
  adminControlFeedback: (status = '') => apiFetch(`/api/admin/control/feedback${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  adminControlResolveFeedback: (id) => apiFetch(`/api/admin/control/feedback/${id}/resolve`, { method: 'POST' }),
  adminControlReplyFeedback: (id, reply) => apiFetch(`/api/admin/control/feedback/${id}/reply`, { method: 'POST', body: JSON.stringify({ reply }) }),
  adminControlReferrals: () => apiFetch('/api/admin/control/referrals/history'),
  adminControlTopReferrers: () => apiFetch('/api/admin/control/referrals/top'),
  adminControlAssignReferralReward: (id, rewardPoints, note = '') => apiFetch(`/api/admin/control/referrals/${id}/reward`, { method: 'POST', body: JSON.stringify({ rewardPoints, note }) }),
  adminControlBlockReferral: (id) => apiFetch(`/api/admin/control/referrals/${id}/block`, { method: 'POST' }),
  adminGetCareerRoadmaps: () => apiFetch('/api/career/admin/roadmaps'),
  adminGetCareerRoadmap: (id) => apiFetch(`/api/career/admin/roadmaps/${id}`),
  adminCreateCareerRoadmap: (data) => apiFetch('/api/career/admin/roadmaps', { method: 'POST', body: JSON.stringify(data) }),
  adminUpdateCareerRoadmap: (id, data) => apiFetch(`/api/career/admin/roadmaps/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminDeleteCareerRoadmap: (id) => apiFetch(`/api/career/admin/roadmaps/${id}`, { method: 'DELETE' }),
  adminGetAiTools: () => apiFetch('/api/career/admin/ai-tools'),
  adminCreateAiTool: (data) => apiFetch('/api/career/admin/ai-tools', { method: 'POST', body: JSON.stringify(data) }),
  adminUpdateAiTool: (id, data) => apiFetch(`/api/career/admin/ai-tools/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  adminDeleteAiTool: (id) => apiFetch(`/api/career/admin/ai-tools/${id}`, { method: 'DELETE' }),
  adminControlAnalytics: () => apiFetch('/api/admin/control/analytics/overview'),
  adminControlRoles: () => apiFetch('/api/admin/control/roles'),
  adminControlAssignRole: (adminId, adminRole) => apiFetch(`/api/admin/control/roles/${adminId}`, { method: 'PUT', body: JSON.stringify({ adminRole }) }),
  adminControlSetRolePermissions: (role, permissions) => apiFetch(`/api/admin/control/roles/permissions/${encodeURIComponent(role)}`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
  adminControlSettings: () => apiFetch('/api/admin/control/settings'),
  adminControlUpdateSettings: (payload) => apiFetch('/api/admin/control/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  adminControlExperienceConfig: () => apiFetch('/api/admin/control/experience-config'),
  adminControlUpdateExperienceConfig: (payload) => apiFetch('/api/admin/control/experience-config', { method: 'PUT', body: JSON.stringify(payload) }),
  adminControlMembershipConfig: () => apiFetch('/api/admin/control/membership-config'),
  adminControlUpdateMembershipConfig: (payload) => apiFetch('/api/admin/control/membership-config', { method: 'PUT', body: JSON.stringify(payload) }),
  adminSupportGovernanceConfig: () => apiFetch('/api/admin/support-governance/feature-config'),
  adminSupportGovernanceUpdateConfig: (payload) => apiFetch('/api/admin/support-governance/feature-config', { method: 'PUT', body: JSON.stringify(payload) }),
  adminSupportGovernanceDashboard: () => apiFetch('/api/admin/support-governance/dashboard'),
  adminSupportGovernanceThreads: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.flaggedOnly) qs.set('flaggedOnly', 'true');
    if (params.urgentOnly) qs.set('urgentOnly', 'true');
    if (params.branchId) qs.set('branchId', String(params.branchId));
    if (params.semesterId) qs.set('semesterId', String(params.semesterId));
    if (params.search) qs.set('search', params.search);
    if (params.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/api/admin/support-governance/threads${suffix}`);
  },
  adminSupportThreadAction: (requestId, payload) => apiFetch(`/api/admin/support-governance/threads/${requestId}/action`, { method: 'POST', body: JSON.stringify(payload) }),
  adminSupportAnswerAction: (answerId, payload) => apiFetch(`/api/admin/support-governance/answers/${answerId}/action`, { method: 'POST', body: JSON.stringify(payload) }),
  adminSupportRewardAdjust: (payload) => apiFetch('/api/admin/support-governance/rewards/adjust', { method: 'POST', body: JSON.stringify(payload) }),
  adminSupportRewardHistory: (helperUserId = 0, limit = 80) => apiFetch(`/api/admin/support-governance/rewards/history?helperUserId=${encodeURIComponent(helperUserId)}&limit=${encodeURIComponent(limit)}`),
  adminSupportHelperTrust: (helperUserId, payload) => apiFetch(`/api/admin/support-governance/helpers/${helperUserId}/trust`, { method: 'POST', body: JSON.stringify(payload) }),
  adminSupportHelperHistory: (helperUserId) => apiFetch(`/api/admin/support-governance/helpers/${helperUserId}/history`),
  adminSupportIsolationAnomalies: () => apiFetch('/api/admin/support-governance/isolation/anomalies'),
  adminSupportSafetyRisk: () => apiFetch('/api/admin/support-governance/safety/link-risk'),
  adminSupportAnalyticsOverview: () => apiFetch('/api/admin/support-governance/analytics/overview'),
  adminSupportGovernanceAudit: (limit = 120) => apiFetch(`/api/admin/support-governance/activity/audit?limit=${encodeURIComponent(limit)}`),
  submitSupportTicket: (data) => apiFetch('/api/company/tickets', { method: 'POST', body: JSON.stringify(data) }),
  adminControlAuditLogs: (limit = 50) => apiFetch(`/api/admin/control/audit-logs?limit=${encodeURIComponent(limit)}`)
};
