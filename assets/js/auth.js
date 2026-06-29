function byId(id) {
  return document.getElementById(id);
}

// Global OTP request state to prevent duplicate requests and spamming
window.__collegeOsOtpGlobals = window.__collegeOsOtpGlobals || { inFlight: false, cooldownUntil: 0 };

const PASSWORD_POLICY_MESSAGE = 'Password must be at least 6 characters and include uppercase, lowercase, number, and special character.';

function isStrongSignupPassword(value) {
  const password = String(value || '');
  if (password.length < 6) return false;
  return /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function normalizeAuthErrorMessage(message, fallback = 'Something went wrong. Please try again.') {
  const text = String(message || '').trim();
  if (/at least\s+(8|10)\s+characters/i.test(text)
    && /uppercase/i.test(text)
    && /lowercase/i.test(text)
    && /number/i.test(text)
    && /special character/i.test(text)) {
    return PASSWORD_POLICY_MESSAGE;
  }
  return text || fallback;
}

function setLoading(button, loadingText, isLoading) {
  if (!button) return;
  if (!button.dataset.originalText) button.dataset.originalText = button.innerHTML;
  button.disabled = isLoading;
  button.innerHTML = isLoading ? `<i class="fa-solid fa-spinner fa-spin"></i> ${loadingText}` : button.dataset.originalText;
}

function setText(id, text) {
  const node = byId(id);
  if (node) node.textContent = text || '';
}

function setAuthMessages(scope, error = '', success = '') {
  setText(`${scope}Error`, error);
  setText(`${scope}Success`, success);
}

function persistSignupAuthState(user) {
  if (!user || typeof user !== 'object') return;
  window.collegeOsCurrentUser = user;

  try {
    const serialized = JSON.stringify(user);
    window.sessionStorage?.setItem('collegeOsCurrentUser', serialized);
    window.localStorage?.setItem('collegeOsCurrentUser', serialized);
  } catch {
    // Best-effort only; the session cookie is the source of truth.
  }
}

const DASHBOARD_BOOTSTRAP_PATHS = [
  '/api/dashboard/personalized',
  '/api/dashboard/stats',
  '/api/dashboard/experience-config',
  '/api/profile/me',
  '/api/academics/profile',
  '/api/notifications/unread-count',
  '/api/subscriptions/me',
  '/api/contributions/config'
];

const authBootstrapState = {
  experiencePromise: null,
  academicPromise: null,
  universityQuery: '',
  universityQueryPromise: null
};

async function warmDashboardBootstrap() {
  if (!window.CollegeOSApi?.warmupRequests) return;
  const warmupOnce = window.CollegeOSApi.warmupRequestsOnce;
  const warmupMany = window.CollegeOSApi.warmupRequests;
  if (typeof warmupOnce === 'function') {
    await warmupOnce('warmup:auth-dashboard-bootstrap', DASHBOARD_BOOTSTRAP_PATHS);
    return;
  }
  if (typeof warmupMany === 'function') {
    await warmupMany(DASHBOARD_BOOTSTRAP_PATHS);
  }
}

function getFieldHost(input) {
  return input?.closest('.field') || null;
}

function getInlineErrorNode(input) {
  const host = getFieldHost(input);
  if (!host) return null;
  let node = host.querySelector('.field-inline-error');
  if (!node) {
    node = document.createElement('p');
    node.className = 'field-inline-error';
    host.appendChild(node);
  }
  return node;
}

function setFieldState(input, { valid = true, message = '' } = {}) {
  const host = getFieldHost(input);
  const errorNode = getInlineErrorNode(input);
  if (!input || !host || !errorNode) return;

  host.classList.toggle('field-invalid', !valid);
  host.classList.toggle('field-valid', valid && Boolean(input.value?.trim()));
  input.setAttribute('aria-invalid', valid ? 'false' : 'true');
  errorNode.textContent = valid ? '' : message;
}

function clearFieldState(input) {
  const host = getFieldHost(input);
  const errorNode = getInlineErrorNode(input);
  if (!input || !host || !errorNode) return;
  host.classList.remove('field-invalid', 'field-valid');
  input.setAttribute('aria-invalid', 'false');
  errorNode.textContent = '';
}

function bindInlineValidation() {
  const validators = [
    {
      id: 'loginEmail',
      validate: (value) => {
        const email = String(value || '').trim();
        if (!email) return { valid: false, message: 'Email is required.' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { valid: false, message: 'Enter a valid email address.' };
        return { valid: true };
      }
    },
    {
      id: 'loginPassword',
      validate: (value) => {
        const password = String(value || '');
        if (!password) return { valid: false, message: 'Password is required.' };
        if (password.length < 6) return { valid: false, message: 'Password must be at least 6 characters.' };
        return { valid: true };
      }
    },
    {
      id: 'signupName',
      validate: (value) => (String(value || '').trim().length >= 2
        ? { valid: true }
        : { valid: false, message: 'Enter your full name.' })
    },
    {
      id: 'signupEmail',
      validate: (value) => {
        const email = String(value || '').trim();
        if (!email) return { valid: false, message: 'Email is required.' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { valid: false, message: 'Enter a valid email address.' };
        return { valid: true };
      }
    },
    {
      id: 'signupMobile',
      validate: (value) => {
        const raw = String(value || '').trim();
        if (!isFieldVisible('mobile')) return { valid: true };
        if (!raw) return { valid: false, message: 'Mobile number is required.' };
        if (!/^\d{10}$/.test(raw)) return { valid: false, message: 'Use a valid 10-digit mobile number.' };
        return { valid: true };
      }
    },
    {
      id: 'signupPassword',
      validate: (value) => {
        const password = String(value || '');
        if (!password) return { valid: false, message: 'Password is required.' };
        if (!isStrongSignupPassword(password)) return { valid: false, message: PASSWORD_POLICY_MESSAGE };
        return { valid: true };
      }
    },
    {
      id: 'signupConfirmPassword',
      validate: (value) => {
        const confirm = String(value || '');
        const password = String(byId('signupPassword')?.value || '');
        if (!confirm) return { valid: false, message: 'Confirm your password.' };
        if (password !== confirm) return { valid: false, message: 'Passwords do not match.' };
        return { valid: true };
      }
    }
  ];

  validators.forEach(({ id, validate }) => {
    const input = byId(id);
    if (!input) return;

    const runValidation = () => {
      const result = validate(input.value);
      setFieldState(input, result);
      return result.valid;
    };

    input.addEventListener('blur', runValidation);
    input.addEventListener('input', () => {
      if (getFieldHost(input)?.classList.contains('field-invalid')) {
        runValidation();
        return;
      }
      clearFieldState(input);
    });
  });
}

function switchAuthView(tabName) {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authTab === tabName);
  });
  document.querySelectorAll('[data-auth-view]').forEach((view) => {
    view.classList.toggle('hidden', view.dataset.authView !== tabName);
  });
  updateAuthTabIndicator();
  setAuthMessages('login');
  setAuthMessages('signup');
}

function updateAuthTabIndicator() {
  const tabsHost = document.querySelector('.auth-tabs');
  const indicator = tabsHost?.querySelector('.auth-tab-indicator');
  const activeTab = tabsHost?.querySelector('[data-auth-tab].active');

  if (!tabsHost || !indicator || !activeTab) return;

  if (window.matchMedia('(max-width: 760px)').matches) {
    indicator.style.opacity = '0';
    return;
  }

  indicator.style.width = `${activeTab.offsetWidth}px`;
  indicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
  indicator.style.opacity = '1';
}

function initAuthEntranceMotion() {
  const shell = document.querySelector('.auth-shell');
  if (!shell) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    shell.classList.add('auth-animate-in');
    return;
  }

  window.requestAnimationFrame(() => {
    shell.classList.add('auth-animate-in');
  });
}

function bindAdminShortcut() {
  if (window.__collegeOsAdminShortcutBound) return;
  window.__collegeOsAdminShortcutBound = true;
  window.addEventListener('keydown', (event) => {
    try {
      const isCtrl = Boolean(event.ctrlKey || event.metaKey);
      const isShift = Boolean(event.shiftKey);
      const isA = event.code === 'KeyA' || String(event.key || '').toLowerCase() === 'a';
      if (!isCtrl || !isShift || !isA) return;
      event.preventDefault();
      const target = `${window.location.origin}/admin-login.html`;
      try { window.location.assign(target); } catch { window.location.href = target; }
    } catch (e) {
      // ignore
    }
  }, { passive: false });
}

function createMathCaptcha(targetPrefix) {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const question = `${a} + ${b} = ?`;
  const answer = String(a + b);
  const questionNode = byId(`${targetPrefix}CaptchaQuestion`);
  const inputNode = byId(`${targetPrefix}CaptchaInput`);
  if (questionNode) questionNode.textContent = question;
  if (inputNode) inputNode.value = '';
  return { question, answer };
}


const captchaState = {
  login: { answer: '', serverChallenge: null, lastFetched: 0, challengePromise: null, requestId: 0, ready: false, retryAttempted: false, retryCount: 0, loadFailed: false },
  signup: { answer: '', serverChallenge: null, lastFetched: 0, challengePromise: null, requestId: 0, ready: false, retryAttempted: false, retryCount: 0, loadFailed: false },
  admin: { answer: '', serverChallenge: null, lastFetched: 0, challengePromise: null, requestId: 0, ready: false, retryAttempted: false, retryCount: 0, loadFailed: false }
};

const CAPTCHA_REQUEST_TIMEOUT_MS = 4000;
const CAPTCHA_RETRY_DELAY_MS = 300;
const CAPTCHA_MAX_AUTO_RETRIES = 2;

const CAPTCHA_STORAGE_KEY = 'collegeOsCaptchaState';

function hasCaptchaUi(scope) {
  return Boolean(byId(`${scope}CaptchaQuestion`) || byId(`${scope}CaptchaInput`));
}

function readPersistedCaptcha(scope) {
  if (typeof sessionStorage === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(CAPTCHA_STORAGE_KEY);
    if (!raw) return null;

    const stored = JSON.parse(raw);
    const challenge = stored?.[scope];
    if (!challenge || typeof challenge !== 'object') return null;
    if (!challenge.expiresAt || Number(challenge.expiresAt) <= Date.now()) return null;

    return challenge;
  } catch {
    return null;
  }
}

function persistCaptcha(scope, challenge) {
  if (typeof sessionStorage === 'undefined' || !challenge || typeof challenge !== 'object') return;

  try {
    const raw = sessionStorage.getItem(CAPTCHA_STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    stored[scope] = challenge;
    sessionStorage.setItem(CAPTCHA_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Ignore storage failures and fall back to in-memory state.
  }
}

function resolveCaptchaContent(challenge) {
  if (!challenge || typeof challenge !== 'object') return null;

  const text = String(
    challenge.question ||
    challenge.challenge ||
    challenge.challengeText ||
    challenge.prompt ||
    challenge.captchaText ||
    ''
  ).trim();

  if (challenge.svg && String(challenge.svg).trim()) {
    return { type: 'svg', value: String(challenge.svg) };
  }

  if (challenge.image && String(challenge.image).trim()) {
    return { type: 'image', value: String(challenge.image) };
  }

  if (challenge.imageUrl && String(challenge.imageUrl).trim()) {
    return { type: 'image', value: String(challenge.imageUrl) };
  }

  if (challenge.dataUrl && String(challenge.dataUrl).trim()) {
    return { type: 'image', value: String(challenge.dataUrl) };
  }

  if (text) {
    return { type: 'text', value: text };
  }

  return null;
}

function renderCaptchaContent(scope, challenge) {
  const contentNode = byId(`${scope}CaptchaChallenge`);
  const questionNode = byId(`${scope}CaptchaQuestion`);
  const resolved = resolveCaptchaContent(challenge);

  if (questionNode) {
    if (challenge && resolved) {
      const label = resolved.type === 'text' ? resolved.value : 'Captcha challenge';
      questionNode.textContent = label;
    } else {
      questionNode.textContent = 'Captcha unavailable. Click refresh.';
    }
  }

  if (!contentNode) return resolved;

  contentNode.innerHTML = '';

  if (!resolved) {
    contentNode.textContent = '';
    return null;
  }

  if (resolved.type === 'svg') {
    contentNode.innerHTML = resolved.value;
    return resolved;
  }

  if (resolved.type === 'image') {
    const img = document.createElement('img');
    img.alt = 'CAPTCHA challenge';
    img.src = resolved.value;
    img.loading = 'eager';
    contentNode.appendChild(img);
    return resolved;
  }

  contentNode.textContent = resolved.value;
  return resolved;
}

function getCaptchaElements(scope) {
  const box = byId(`${scope}CaptchaBox`);
  const question = byId(`${scope}CaptchaQuestion`);
  const input = byId(`${scope}CaptchaInput`);
  const refreshButton = byId(`refresh${scope.charAt(0).toUpperCase()}${scope.slice(1)}Captcha`);
  const status = byId(`${scope}CaptchaStatus`);
  const submitButton = scope === 'login'
    ? byId('loginSubmitBtn')
    : scope === 'signup'
      ? byId('signupSubmitBtn')
      : byId('adminLoginForm')?.querySelector('button[type="submit"]');

  return { box, question, input, refreshButton, status, submitButton };
}

function setCaptchaUiState(scope, { loading = false, message = '', error = false } = {}) {
  const { box, input, refreshButton, status, submitButton } = getCaptchaElements(scope);
  if (box) box.classList.toggle('is-loading', loading);
  if (box) box.setAttribute('aria-busy', loading ? 'true' : 'false');
  if (status) status.textContent = message && (loading || error) ? message : '';
  if (input) input.disabled = loading || !captchaState[scope].ready;
  if (refreshButton) refreshButton.disabled = false;
  if (submitButton) submitButton.disabled = loading || !captchaState[scope].ready;
}

function setCaptchaReady(scope, ready, message = '', challenge = null) {
  const content = challenge || captchaState[scope].serverChallenge;
  const hasContent = Boolean(resolveCaptchaContent(content));
  captchaState[scope].ready = Boolean(ready && hasContent);
  if (!captchaState[scope].ready) {
    captchaState[scope].answer = '';
    captchaState[scope].serverChallenge = challenge || null;
  }
  if (captchaState[scope].ready) {
    captchaState[scope].retryCount = 0;
    captchaState[scope].retryAttempted = false;
  }
  renderCaptchaContent(scope, content);
  setCaptchaUiState(scope, {
    loading: false,
    message: captchaState[scope].ready
      ? (message || 'Captcha ready.')
      : (message || 'Captcha could not load. Refresh captcha.'),
    error: !captchaState[scope].ready
  });
}

function isChallengeFresh(challenge, graceMs = 5000) {
  if (!challenge) return false;
  const expiresAt = Number(challenge.expiresAt || 0);
  return Boolean(expiresAt && expiresAt > Date.now() + graceMs);
}

async function refreshCaptcha(scope, { force = false } = {}) {
  if (!hasCaptchaUi(scope)) return null;

  if (captchaState[scope].loadFailed && !force) {
    setCaptchaReady(scope, false, 'Captcha failed to load. Click Refresh to try again.', null);
    return null;
  }

  const now = Date.now();
  const currentChallenge = captchaState[scope].serverChallenge;
  const existingPromise = captchaState[scope].challengePromise;

  if (existingPromise && !force) {
    return existingPromise;
  }

  if (!force && currentChallenge) {
    if (isChallengeFresh(currentChallenge, 15000)) {
      setCaptchaReady(scope, true, 'Captcha ready.', currentChallenge);
      return currentChallenge;
    }
  }

  if (!force) {
    const persistedChallenge = readPersistedCaptcha(scope);
    if (persistedChallenge) {
      captchaState[scope].serverChallenge = persistedChallenge;
      captchaState[scope].lastFetched = Number(persistedChallenge.fetchedAt || now);
      if (Number.isInteger(Number(persistedChallenge.a)) && Number.isInteger(Number(persistedChallenge.b))) {
        captchaState[scope].answer = String(Number(persistedChallenge.a) + Number(persistedChallenge.b));
      }
      setCaptchaReady(scope, true, 'Captcha ready.', persistedChallenge);
      return persistedChallenge;
    }
  }

  if (currentChallenge && !force) {
    // Use cached challenge
    setCaptchaReady(scope, true, 'Captcha ready.', currentChallenge);
    return currentChallenge;
  }

  const requestId = (captchaState[scope].requestId || 0) + 1;
  captchaState[scope].requestId = requestId;
  setCaptchaReady(scope, false, force ? 'Refreshing captcha...' : 'Preparing captcha...');

  const fetchPromise = (async () => {
    try {
      if (window.CollegeOSApi?.getCaptchaChallenge) {
        const apiCall = window.CollegeOSApi.getCaptchaChallenge(force ? { forceRefresh: true } : {});
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('CAPTCHA_TIMEOUT')), CAPTCHA_REQUEST_TIMEOUT_MS));
        let payload;
        try {
          const result = await Promise.race([apiCall, timeoutPromise]);
          payload = result;
        } catch (err) {
          if (!force && captchaState[scope].retryCount < CAPTCHA_MAX_AUTO_RETRIES) {
            captchaState[scope].retryCount += 1;
            setCaptchaReady(scope, false, 'Captcha is taking longer than expected. Retrying...', null);
            await new Promise((resolve) => setTimeout(resolve, CAPTCHA_RETRY_DELAY_MS));
            return refreshCaptcha(scope, { force: true });
          }

          captchaState[scope].serverChallenge = null;
          captchaState[scope].loadFailed = true;
          if (captchaState[scope].requestId === requestId) {
            setCaptchaReady(scope, false, 'Captcha failed to load. Click Refresh Captcha to try again.', null);
          }
          return captchaState[scope].serverChallenge;
        }

        const challenge = payload?.captcha || payload || null;
        if (captchaState[scope].requestId !== requestId) return captchaState[scope].serverChallenge;

        captchaState[scope].serverChallenge = challenge;
        captchaState[scope].lastFetched = Date.now();
        if (challenge) {
          persistCaptcha(scope, { ...challenge, fetchedAt: captchaState[scope].lastFetched });
        }
        if (Number.isInteger(Number(challenge?.a)) && Number.isInteger(Number(challenge?.b))) {
          captchaState[scope].answer = String(Number(challenge.a) + Number(challenge.b));
        }

        const resolvedContent = resolveCaptchaContent(challenge);
        if (!resolvedContent) {
          captchaState[scope].loadFailed = true;
          setCaptchaReady(scope, false, 'Captcha failed to load. Click Refresh Captcha to try again.', challenge);
          return null;
        }

        captchaState[scope].loadFailed = false;
        captchaState[scope].retryCount = 0;
        captchaState[scope].retryAttempted = false;
        setCaptchaReady(scope, true, 'Captcha ready.', challenge);
      }
    } catch (e) {
      if (!force && captchaState[scope].retryCount < CAPTCHA_MAX_AUTO_RETRIES) {
        captchaState[scope].retryCount += 1;
        setCaptchaReady(scope, false, 'Captcha is taking longer than expected. Retrying...', null);
        await new Promise((resolve) => setTimeout(resolve, CAPTCHA_RETRY_DELAY_MS));
        return refreshCaptcha(scope, { force: true });
      }

      captchaState[scope].serverChallenge = null;
      captchaState[scope].loadFailed = true;
      if (captchaState[scope].requestId === requestId) {
        setCaptchaReady(scope, false, 'Captcha failed to load. Click Refresh Captcha to try again.', null);
      }
    } finally {
      if (captchaState[scope].requestId === requestId) {
        captchaState[scope].challengePromise = null;
      }
    }
    return captchaState[scope].serverChallenge;
  })();

  captchaState[scope].challengePromise = fetchPromise;
  return fetchPromise;
}

function verifyCaptcha(scope) {
  const input = String(byId(`${scope}CaptchaInput`)?.value || '').trim();
  return input && input === captchaState[scope].answer;
}

function getCaptchaPayload(scope) {
  const input = String(byId(`${scope}CaptchaInput`)?.value || '').trim();
  const challenge = captchaState[scope]?.serverChallenge;
  if (!challenge) return null;
  return {
    ...challenge,
    answer: Number(input)
  };
}

async function ensureCaptchaPayload(scope) {
  let payload = getCaptchaPayload(scope);
  if (payload) return payload;
  if (captchaState[scope].loadFailed) {
    throw new Error('Captcha failed to load. Click Refresh Captcha to try again.');
  }
  try {
    await refreshCaptcha(scope);
  } catch (err) {
    // Propagate so caller can show a friendly message and avoid submitting without a server challenge
    throw new Error('Captcha service is unavailable. Please refresh the captcha and try again.');
  }
  payload = getCaptchaPayload(scope);
  if (!payload) {
    throw new Error('Captcha could not load. Refresh Captcha.');
  }
  return payload;
}

async function waitForSessionReady(timeoutMs = 5000, intervalMs = 300) {
  if (!window.CollegeOSApi) return null;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const payload = await window.CollegeOSApi.getMe();
      if (payload && payload.user) return payload.user;
    } catch (e) {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

function evaluatePasswordStrength(password) {
  let score = 0;
  const tips = [];

  if (password.length >= 6) score += 1; else tips.push('Use at least 6 characters');
  if (/[0-9]/.test(password)) score += 1; else tips.push('Add numbers');
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1; else tips.push('Mix uppercase and lowercase');
  if (/[^A-Za-z0-9]/.test(password)) score += 1; else tips.push('Add symbols');

  if (password.length >= 12) score += 1;

  let level = 'Weak';
  let color = '#ef4444';
  let width = 30;

  if (score >= 3) {
    level = 'Medium';
    color = '#f59e0b';
    width = 65;
  }
  if (score >= 4) {
    level = 'Strong';
    color = '#10b981';
    width = 100;
  }

  return { level, color, width, tips };
}

function bindPasswordStrength() {
  const passwordInput = byId('signupPassword');
  const strengthFill = byId('strengthFill');
  const strengthText = byId('strengthText');
  if (!passwordInput || !strengthFill || !strengthText) return;

  passwordInput.addEventListener('input', () => {
    const result = evaluatePasswordStrength(passwordInput.value || '');
    strengthFill.style.width = `${result.width}%`;
    strengthFill.style.background = result.color;
    const tipText = result.tips.length ? ` | ${result.tips.slice(0, 2).join(', ')}` : '';
    strengthText.textContent = `Password strength: ${result.level}${tipText}`;
  });
}

function bindPasswordToggles() {
  const loginToggle = byId('toggleLoginPassword');
  const signupToggle = byId('toggleSignupPassword');

  if (loginToggle) {
    loginToggle.addEventListener('click', () => {
      const input = byId('loginPassword');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      loginToggle.textContent = input.type === 'password' ? 'Show' : 'Hide';
    });
  }

  if (signupToggle) {
    signupToggle.addEventListener('click', () => {
      const input = byId('signupPassword');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      signupToggle.textContent = input.type === 'password' ? 'Show' : 'Hide';
    });
  }
}

const academicState = {
  categories: [],
  branchesByCategory: {},
  semesters: []
};

const universityState = {
  options: [],
  activeIndex: -1,
  debounceTimer: null,
  lastQuery: ''
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function closeUniversityResults() {
  const list = byId('signupUniversityResults');
  const input = byId('signupUniversitySearch');
  if (list) list.classList.add('hidden');
  if (input) input.setAttribute('aria-expanded', 'false');
  universityState.activeIndex = -1;
}

function setUniversityInvalidState(isInvalid) {
  const field = byId('signupUniversityField');
  if (field) field.classList.toggle('invalid', Boolean(isInvalid));
}

function setUniversitySelection(payload) {
  const input = byId('signupUniversitySearch');
  const idNode = byId('signupUniversityId');
  const nameNode = byId('signupUniversityName');
  const customNode = byId('signupCustomUniversity');
  const noteNode = byId('signupUniversityNote');

  if (input) input.value = payload?.name || '';
  if (idNode) idNode.value = payload?.id ? String(payload.id) : '';
  if (nameNode) nameNode.value = payload?.name || '';
  if (customNode) customNode.value = payload?.isCustom ? payload.name : '';
  if (noteNode) {
    noteNode.textContent = payload?.isCustom
      ? 'Custom university will be submitted for admin review.'
      : 'University selected successfully.';
  }
  setUniversityInvalidState(false);
}

function renderUniversityResults(queryText = '') {
  const list = byId('signupUniversityResults');
  const input = byId('signupUniversitySearch');
  const addBtn = byId('signupUniversityAddBtn');
  const emptyNote = byId('signupUniversityEmpty');
  if (!list || !input) return;

  const query = String(queryText || '').trim();
  const re = query ? new RegExp(`(${escapeRegExp(query)})`, 'ig') : null;
  const highlight = (text) => {
    const safe = escapeHtml(text);
    if (!re) return safe;
    return safe.replace(re, '<span class="university-highlight">$1</span>');
  };

  const hasRows = universityState.options.length > 0;
  list.innerHTML = hasRows
    ? universityState.options.map((uni, index) => `
      <li>
        <button type="button" class="university-item" data-uni-index="${index}" role="option" aria-selected="false">
          <span class="university-name">${highlight(uni.name)}</span>
          <span class="university-meta">${uni.is_featured ? 'Featured' : 'University'}${uni.city ? ` • ${escapeHtml(uni.city)}` : ''}</span>
        </button>
      </li>
    `).join('')
    : '<li><div class="university-item" style="cursor:default;"><span class="university-name">No university found</span><span class="university-meta">Use add option below</span></div></li>';

  list.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');
  universityState.activeIndex = hasRows ? 0 : -1;

  if (addBtn) addBtn.classList.toggle('hidden', !query);
  if (emptyNote) emptyNote.classList.toggle('hidden', hasRows || !query);

  list.querySelectorAll('[data-uni-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.uniIndex || -1);
      const selected = universityState.options[index];
      if (!selected) return;
      setUniversitySelection({ id: selected.id, name: selected.name, isCustom: false });
      closeUniversityResults();
    });
  });

  list.querySelectorAll('[data-uni-index]').forEach((node, idx) => {
    node.classList.toggle('active', idx === universityState.activeIndex);
    node.setAttribute('aria-selected', idx === universityState.activeIndex ? 'true' : 'false');
  });
}

async function fetchUniversities(queryText = '') {
  if (!window.CollegeOSApi?.getUniversities) return;
  const normalizedQuery = String(queryText || '').trim();
  if (authBootstrapState.universityQueryPromise && authBootstrapState.universityQuery === normalizedQuery) {
    return authBootstrapState.universityQueryPromise;
  }

  authBootstrapState.universityQuery = normalizedQuery;
  authBootstrapState.universityQueryPromise = (async () => {
    const payload = await window.CollegeOSApi.getUniversities(normalizedQuery, 40);
    universityState.options = Array.isArray(payload?.universities) ? payload.universities : [];
    renderUniversityResults(normalizedQuery);
    return payload;
  })();

  try {
    return await authBootstrapState.universityQueryPromise;
  } finally {
    authBootstrapState.universityQueryPromise = null;
  }
}

function bindUniversitySelector() {
  const input = byId('signupUniversitySearch');
  const list = byId('signupUniversityResults');
  const addBtn = byId('signupUniversityAddBtn');
  if (!input || !list) return;

  const openResults = async () => {
    try {
      await fetchUniversities(input.value.trim());
    } catch {
      // Keep UI stable; outside click or ESC can still close results.
    }
  };

  input.addEventListener('focus', async () => { await openResults(); });
  input.addEventListener('click', async () => { await openResults(); });

  input.addEventListener('input', () => {
    const idNode = byId('signupUniversityId');
    const nameNode = byId('signupUniversityName');
    const customNode = byId('signupCustomUniversity');
    if (idNode) idNode.value = '';
    if (nameNode) nameNode.value = '';
    if (customNode) customNode.value = '';
    setUniversityInvalidState(false);

    if (universityState.debounceTimer) clearTimeout(universityState.debounceTimer);
    universityState.debounceTimer = window.setTimeout(() => {
      fetchUniversities(input.value.trim()).catch(() => {
        const noteNode = byId('signupUniversityNote');
        if (noteNode) noteNode.textContent = 'Could not load universities right now. You can still add your university manually.';
      });
    }, 160);
  });

  input.addEventListener('keydown', (event) => {
    const rows = Array.from(list.querySelectorAll('[data-uni-index]'));
    if (!rows.length && event.key !== 'Enter') return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      universityState.activeIndex = Math.min(universityState.activeIndex + 1, rows.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      universityState.activeIndex = Math.max(universityState.activeIndex - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (rows[universityState.activeIndex]) {
        rows[universityState.activeIndex].click();
        return;
      }
      if (addBtn && !addBtn.classList.contains('hidden')) {
        addBtn.click();
      }
      return;
    } else if (event.key === 'Escape') {
      closeUniversityResults();
      return;
    }

    rows.forEach((node, idx) => {
      node.classList.toggle('active', idx === universityState.activeIndex);
      node.setAttribute('aria-selected', idx === universityState.activeIndex ? 'true' : 'false');
    });
  });

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const customValue = String(input.value || '').trim();
      if (!customValue) return;
      setUniversitySelection({ id: null, name: customValue, isCustom: true });
      closeUniversityResults();
    });
  }

  document.addEventListener('click', (event) => {
    const host = byId('signupUniversityField');
    if (!host?.contains(event.target)) {
      closeUniversityResults();
    }
  });
}

const onboardingConfigState = {
  wizard: { enabled: true, version: 1 },
  steps: [],
  options: {
    career_interest: [],
    learning_goal: [],
    study_mode: []
  }
};

const authExperienceState = {
  modules: {
    leftPanel: true,
    loginForm: true,
    signupForm: true,
    supportModal: true,
    otpLogin: true,
    legalFooter: true
  },
  branding: {
    kicker: 'College OS Student Access',
    headline: 'The student operating system for focused outcomes and faster wins.',
    description: 'Sign in to continue with AI-guided study flows, verified access controls, and momentum tracking designed for serious learners.',
    features: [
      'Secure sign-in with session protection',
      'Branch-aware learning paths',
      'Progress and mock analytics',
      'Certificates and achievement tracking'
    ],
    trustPoints: [
      'Trusted by colleges and independent learners',
      'OTP-ready account verification',
      'Privacy-first data handling'
    ],
    stats: {
      value: '10k+',
      label: 'active learners'
    }
  },
  text: {
    brandName: 'College OS',
    brandSubtext: 'Student Workspace',
    loginTitle: 'Welcome back, build momentum',
    loginDescription: 'Enter your secure workspace to continue your streak, plans, and career-focused study flow.',
    signupTitle: 'Create your account',
    signupDescription: 'Set up your profile in a few steps to unlock a branch-aware dashboard.',
    supportLinkLabel: 'Need help? Contact support',
    footerConsentText: 'By continuing, you agree to Terms & Conditions and Privacy Policy.'
  },
  signup: {
    fieldVisibility: {
      mobile: true,
      category: true,
      branch: true,
      university: true,
      semester: true,
      targetCareerInterest: true
    }
  },
  oauth: {
    googleClientId: ''
  },
  support: {
    email: 'support@collegeos.in',
    whatsapp: '+919000000000',
    helpText: 'Share your issue and our team will help you quickly.'
  },
  legal: {
    termsTitle: 'Terms and Conditions',
    termsText: 'By creating an account, you agree to use College OS responsibly, provide accurate profile information, and follow platform policies for fair usage.',
    privacyTitle: 'Privacy Policy',
    privacyText: 'College OS uses your academic and usage data to personalize recommendations and improve learning outcomes. Your data is handled securely and is never sold to third parties.',
    updatedAt: 'March 2026'
  }
};

const signupStepState = {
  current: 1,
  total: 2
};

function configureSignupFlowLayout() {
  document.querySelectorAll('[data-signup-step="2"], [data-signup-step="3"]').forEach((section) => section.classList.add('hidden'));
  document.querySelectorAll('[data-step-chip="2"], [data-step-chip="3"]').forEach((chip) => chip.classList.add('hidden'));
  const step4Chip = document.querySelector('[data-step-chip="4"]');
  if (step4Chip) step4Chip.textContent = '2. Security';
  const step1Chip = document.querySelector('[data-step-chip="1"]');
  if (step1Chip) step1Chip.textContent = '1. Basic';
  const securitySection = document.querySelector('[data-signup-step="4"]');
  if (securitySection) securitySection.classList.remove('hidden');
}

function fallbackAcademicData() {
  return {
    categories: [
      { id: 1, name: 'Engineering', label: 'Engineering' },
      { id: 2, name: 'Commerce', label: 'Commerce' }
    ],
    branchesByCategory: {
      1: [
        { id: 101, name: 'Computer Science' },
        { id: 102, name: 'Information Technology' },
        { id: 103, name: 'Mechanical Engineering' },
        { id: 104, name: 'Civil Engineering' },
        { id: 105, name: 'Electrical Engineering' },
        { id: 106, name: 'Electronics Engineering' }
      ],
      2: [
        { id: 201, name: 'B.Com' },
        { id: 202, name: 'BBA' },
        { id: 203, name: 'Economics' },
        { id: 204, name: 'Accounts' }
      ]
    },
    semesters: [
      { id: 1, label: 'Semester 1' },
      { id: 2, label: 'Semester 2' },
      { id: 3, label: 'Semester 3' },
      { id: 4, label: 'Semester 4' },
      { id: 5, label: 'Semester 5' },
      { id: 6, label: 'Semester 6' },
      { id: 7, label: 'Semester 7' },
      { id: 8, label: 'Semester 8' }
    ]
  };
}

async function loadAcademicOptions() {
  if (authBootstrapState.academicPromise) return authBootstrapState.academicPromise;
  authBootstrapState.academicPromise = (async () => {
  const categorySelects = [byId('signupCategory'), byId('onboardCategory')].filter(Boolean);
  const branchSelects = [byId('signupBranch'), byId('onboardBranch')].filter(Boolean);
  const semesterSelects = [byId('signupSemester'), byId('onboardSemester')].filter(Boolean);

  try {
    const [categoriesPayload, semestersPayload] = await Promise.all([
      window.CollegeOSApi.getAcademicCategories(),
      window.CollegeOSApi.getAcademicSemesters()
    ]);

    academicState.categories = categoriesPayload?.categories || [];
    academicState.semesters = semestersPayload?.semesters || [];

    await Promise.all(
      academicState.categories.map(async (category) => {
        const branchPayload = await window.CollegeOSApi.getAcademicBranches(category.id);
        academicState.branchesByCategory[category.id] = branchPayload?.branches || [];
      })
    );
  } catch {
    const fallback = fallbackAcademicData();
    academicState.categories = fallback.categories;
    academicState.branchesByCategory = fallback.branchesByCategory;
    academicState.semesters = fallback.semesters;
  }

  const categoryOptions = ['<option value="">Select category</option>'].concat(
    academicState.categories.map((cat) => `<option value="${cat.id}">${cat.label || cat.name}</option>`)
  );

  categorySelects.forEach((select) => {
    select.innerHTML = categoryOptions.join('');
  });

  const semesterOptions = ['<option value="">Select semester</option>'].concat(
    academicState.semesters.map((sem) => `<option value="${sem.id}">${sem.label || `Semester ${sem.semester_number || sem.id}`}</option>`)
  );

  semesterSelects.forEach((select) => {
    select.innerHTML = semesterOptions.join('');
  });

  branchSelects.forEach((select) => {
    select.innerHTML = '<option value="">Select branch/course</option>';
  });
  })();

  try {
    return await authBootstrapState.academicPromise;
  } finally {
    authBootstrapState.academicPromise = null;
  }
}

function updateBranchSelect(categoryId, branchSelectId) {
  const branchSelect = byId(branchSelectId);
  if (!branchSelect) return;

  const branches = academicState.branchesByCategory[Number(categoryId)] || [];
  const options = ['<option value="">Select branch/course</option>'].concat(
    branches.map((branch) => `<option value="${branch.id}">${branch.label || branch.name}</option>`)
  );
  branchSelect.innerHTML = options.join('');
}

function bindCategoryBranchCascades() {
  const signupCategory = byId('signupCategory');
  const onboardCategory = byId('onboardCategory');

  if (signupCategory) {
    signupCategory.addEventListener('change', () => {
      updateBranchSelect(signupCategory.value, 'signupBranch');
    });
  }

  if (onboardCategory) {
    onboardCategory.addEventListener('change', () => {
      updateBranchSelect(onboardCategory.value, 'onboardBranch');
    });
  }
}

const otpState = {
  timer: null,
  remaining: 0,
  email: ''
};

function startOtpResendTimer(seconds, timerNodeId, buttonNodeId) {
  if (otpState.timer) {
    clearInterval(otpState.timer);
    otpState.timer = null;
  }

  otpState.remaining = seconds;
  const timerNode = byId(timerNodeId);
  const resendBtn = byId(buttonNodeId);
  if (resendBtn) resendBtn.disabled = true;

  const paint = () => {
    const mm = String(Math.floor(otpState.remaining / 60)).padStart(2, '0');
    const ss = String(otpState.remaining % 60).padStart(2, '0');
    if (timerNode) timerNode.textContent = `Resend available in ${mm}:${ss}`;
  };

  paint();
  otpState.timer = window.setInterval(() => {
    otpState.remaining -= 1;
    if (otpState.remaining <= 0) {
      clearInterval(otpState.timer);
      otpState.timer = null;
      if (timerNode) timerNode.textContent = 'You can resend OTP now';
      if (resendBtn) resendBtn.disabled = false;
      return;
    }
    paint();
  }, 1000);
}

function bindTabs() {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled) return;
      switchAuthView(button.dataset.authTab);
    });
  });

  updateAuthTabIndicator();
}

function bindLoginMethodToggle() {
  const emailBtn = document.querySelector('.login-method-btn[data-method="email"]');
  const otpBtn = document.querySelector('.login-method-btn[data-method="otp"]');
  const emailForm = document.getElementById('loginForm');
  const otpBox = document.getElementById('otpLoginSection');

  if (!emailBtn || !otpBtn || !emailForm || !otpBox) return;

  const setMethod = (method) => {
    const otpAllowed = authExperienceState.modules?.otpLogin !== false;
    const useOtp = method === 'otp' && otpAllowed;

    emailBtn.classList.toggle('active', !useOtp);
    otpBtn.classList.toggle('active', useOtp);
    emailForm.classList.toggle('hidden', useOtp);
    otpBox.classList.toggle('hidden', !useOtp);
    otpBtn.disabled = !otpAllowed;
    otpBtn.setAttribute('aria-disabled', String(!otpAllowed));
    setAuthMessages('login');
  };

  emailBtn.addEventListener('click', () => {
    setMethod('email');
  });

  otpBtn.addEventListener('click', () => {
    setMethod('otp');
  });

  window.__collegeOsSetLoginMethod = setMethod;
  setMethod('email');
}

function isFieldVisible(fieldKey) {
  return authExperienceState.signup?.fieldVisibility?.[fieldKey] !== false;
}

function setFieldVisibility(fieldKey, visible) {
  document.querySelectorAll(`[data-signup-field="${fieldKey}"]`).forEach((node) => {
    node.classList.toggle('hidden', !visible);
    node.querySelectorAll('input, select, textarea').forEach((input) => {
      if (!visible) {
        input.disabled = true;
        input.dataset.wasRequired = input.required ? '1' : '0';
        input.required = false;
      } else {
        input.disabled = false;
        if (input.dataset.wasRequired === '1') input.required = true;
      }
    });
  });
}

function renderBrandFeatures(items) {
  const host = byId('authFeatureList');
  if (!host) return;
  const rows = Array.isArray(items) ? items.filter(Boolean).slice(0, 3) : [];
  host.innerHTML = rows.map((item) => `<li><i class="fa-solid fa-check"></i><span>${escapeHtml(item)}</span></li>`).join('');
}

function renderTrustPoints(items) {
  const host = byId('authTrustList');
  if (!host) return;
  const rows = Array.isArray(items) ? items.filter(Boolean).slice(0, 3) : [];
  host.innerHTML = rows.map((item) => `<div class="trust-point"><i class="fa-solid fa-circle-check"></i><span>${escapeHtml(item)}</span></div>`).join('');
}

function applyAuthExperienceConfig() {
  const modules = authExperienceState.modules || {};
  const branding = authExperienceState.branding || {};
  const text = authExperienceState.text || {};
  const support = authExperienceState.support || {};
  const legal = authExperienceState.legal || {};

  const loginEnabled = true;
  const signupEnabled = modules.signupForm !== false;
  const otpEnabled = modules.otpLogin !== false;

  byId('authLeftPanel')?.classList.toggle('hidden', modules.leftPanel === false);
  byId('authRightPanel')?.classList.remove('hidden');

  const loginView = document.querySelector('[data-auth-view="login"]');
  const signupView = document.querySelector('[data-auth-view="signup"]');
  if (loginView) loginView.classList.remove('hidden');
  if (signupView) signupView.classList.toggle('hidden', !signupEnabled);

  document.querySelectorAll('[data-auth-tab="login"]').forEach((button) => {
    button.disabled = false;
    button.setAttribute('aria-disabled', 'false');
  });
  document.querySelectorAll('[data-auth-tab="signup"]').forEach((button) => {
    button.disabled = !signupEnabled;
    button.setAttribute('aria-disabled', String(!signupEnabled));
  });

  const supportLink = byId('supportLinkBtn');
  if (supportLink) {
    supportLink.classList.toggle('hidden', modules.supportModal === false);
    supportLink.textContent = text.supportLinkLabel || 'Need help? Contact support';
  }

  const otpMethodBtn = document.querySelector('.login-method-btn[data-method="otp"]');
  if (otpMethodBtn) {
    otpMethodBtn.classList.toggle('hidden', !otpEnabled);
    otpMethodBtn.disabled = !otpEnabled;
  }

  const legalRows = [byId('authConsentText'), byId('authConsentTextSignup')].filter(Boolean);
  legalRows.forEach((node) => {
    node.classList.toggle('hidden', modules.legalFooter === false);
  });
  setText('authConsentLabel', text.footerConsentText || 'By continuing, you agree to');
  setText('authConsentLabelSignup', text.footerConsentText || 'By continuing, you agree to');

  setText('authBrandKicker', branding.kicker || 'College OS Student Access');
  setText('authBrandHeadline', branding.headline || 'The student operating system for focused outcomes and faster wins.');
  setText('authBrandDescription', branding.description || 'Sign in to continue with AI-guided study flows, verified access controls, and momentum tracking designed for serious learners.');
  setText('authLogoName', text.brandName || 'College OS');
  setText('authLogoSubtext', text.brandSubtext || 'Student Workspace');
  renderBrandFeatures(branding.features || []);
  renderTrustPoints(branding.trustPoints || []);

  setText('authStatValue', branding.stats?.value || '10k+');
  setText('authStatLabel', branding.stats?.label || 'active learners');
  setText('loginTitle', text.loginTitle || 'Welcome back, build momentum');
  setText('loginDescription', text.loginDescription || 'Enter your secure workspace to continue your streak, plans, and career-focused study flow.');
  setText('signupTitle', text.signupTitle || 'Create your account');
  setText('signupDescription', text.signupDescription || 'Set up your profile in a few steps to unlock a branch-aware dashboard.');

  setText('supportHelpText', support.helpText || 'Share your issue and our team will help you quickly.');
  setText('supportEmailChip', `Email: ${support.email || 'support@collegeos.in'}`);
  setText('supportWhatsappChip', `WhatsApp: ${support.whatsapp || '+919000000000'}`);
  setText('legalTermsTitle', legal.termsTitle || 'Terms and Conditions');
  setText('legalTermsText', legal.termsText || 'By creating an account, you agree to use College OS responsibly, provide accurate profile information, and follow platform policies for fair usage.');
  setText('legalPrivacyTitle', legal.privacyTitle || 'Privacy Policy');
  setText('legalPrivacyText', legal.privacyText || 'College OS uses your academic and usage data to personalize recommendations and improve learning outcomes. Your data is handled securely and is never sold to third parties.');
  setText('legalUpdatedAt', `Updated: ${legal.updatedAt || 'March 2026'}`);

  const supportWhatsappChip = byId('supportWhatsappChip');
  if (supportWhatsappChip) {
    const hasWhatsapp = Boolean(String(support.whatsapp || '').trim());
    supportWhatsappChip.classList.toggle('hidden', !hasWhatsapp);
  }

  setFieldVisibility('mobile', isFieldVisible('mobile'));
  setFieldVisibility('category', isFieldVisible('category'));
  setFieldVisibility('branch', isFieldVisible('branch'));
  setFieldVisibility('university', isFieldVisible('university'));
  setFieldVisibility('semester', isFieldVisible('semester'));
  setFieldVisibility('targetCareerInterest', isFieldVisible('targetCareerInterest'));

  void renderGoogleAuthButtons();

  if (signupEnabled) {
    const activeTab = document.querySelector('[data-auth-tab].active')?.dataset.authTab || 'login';
    switchAuthView(activeTab === 'signup' ? 'signup' : 'login');
  } else {
    switchAuthView('login');
  }

  bindLoginMethodToggle();
}

function getGoogleClientId() {
  return String(authExperienceState.oauth?.googleClientId || '').trim();
}

function isGoogleOAuthEnabled() {
  if (typeof authExperienceState.oauth?.googleEnabled === 'boolean') {
    return authExperienceState.oauth.googleEnabled;
  }
  return Boolean(
    String(authExperienceState.oauth?.googleClientId || '').trim()
    && (window.CollegeOSApiConfig?.apiUrl || window.location.origin)
  );
}

function getActiveAuthMessagesTarget() {
  return document.querySelector('[data-auth-view]:not(.hidden)')?.dataset.authView === 'signup' ? 'signup' : 'login';
}

function renderGoogleAuthButtons() {
  const clientId = getGoogleClientId();
  const googleEnabled = isGoogleOAuthEnabled();
  const slots = document.querySelectorAll('[data-google-auth-slot]');

  slots.forEach((slot) => {
    slot.replaceChildren();
    slot.classList.remove('hidden');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'google-auth-button';
    button.setAttribute('aria-label', 'Continue with Google');
    button.innerHTML = `
      <span class="google-auth-icon" aria-hidden="true"><i class="fa-brands fa-google"></i></span>
      <span class="google-auth-label">Continue with Google</span>
      <span class="google-auth-spinner" aria-hidden="true"><i class="fa-solid fa-spinner fa-spin"></i></span>
    `;

    // If clientId not configured, show disabled button with clear message
    if (!googleEnabled || !clientId) {
      button.disabled = true;
      button.title = 'Google login is not configured for this environment.';
      button.querySelector('.google-auth-label').textContent = 'Continue with Google (not configured)';
      const note = document.createElement('p');
      note.className = 'provider-note';
      note.textContent = 'Google login not configured. Contact administrator to enable Google sign-in.';
      slot.appendChild(button);
      slot.appendChild(note);
      return;
    }

    // Build redirect URL - use backend base when available
    const backendBase = (window.CollegeOSApiConfig && window.CollegeOSApiConfig.apiUrl) ? window.CollegeOSApiConfig.apiUrl : '';
    const redirectUrl = (() => {
      try {
        if (backendBase) return new URL('/api/auth/google', backendBase).toString();
      } catch {
        return '/api/auth/google';
      }
      return '/api/auth/google';
    })();

    button.addEventListener('click', () => {
      const messageTarget = getActiveAuthMessagesTarget();
      setAuthMessages(messageTarget, '', 'Redirecting to Google...');
      setLoading(button, 'Redirecting to Google', true);
      window.setTimeout(() => {
        try { window.location.assign(redirectUrl); } catch (e) { window.location.href = redirectUrl; }
      }, 120);
    });

    slot.appendChild(button);
  });
}

async function loadAuthExperienceConfig() {
  if (!window.CollegeOSApi?.getAuthConfig) return;
  if (authBootstrapState.experiencePromise) return authBootstrapState.experiencePromise;
  authBootstrapState.experiencePromise = (async () => {
  try {
    const payload = await window.CollegeOSApi.getAuthConfig();
    const incoming = payload?.config || {};
    authExperienceState.modules = { ...authExperienceState.modules, ...(incoming.modules || {}) };
    authExperienceState.branding = { ...authExperienceState.branding, ...(incoming.branding || {}) };
    authExperienceState.text = { ...authExperienceState.text, ...(incoming.text || {}) };
    authExperienceState.oauth = { ...authExperienceState.oauth, ...(incoming.oauth || {}) };
    authExperienceState.signup = {
      ...authExperienceState.signup,
      ...(incoming.signup || {}),
      fieldVisibility: {
        ...authExperienceState.signup.fieldVisibility,
        ...(incoming.signup?.fieldVisibility || {})
      }
    };
    authExperienceState.support = { ...authExperienceState.support, ...(incoming.support || {}) };
    authExperienceState.legal = { ...authExperienceState.legal, ...(incoming.legal || {}) };
  } catch (_error) {
    // Keep local defaults when config is not reachable.
  }

  applyAuthExperienceConfig();
  })();

  try {
    return await authBootstrapState.experiencePromise;
  } finally {
    authBootstrapState.experiencePromise = null;
  }
}

function validateSignupStep(step) {
  const fullName = byId('signupName')?.value.trim() || '';
  const email = byId('signupEmail')?.value.trim() || '';
  const mobile = byId('signupMobile')?.value.trim() || '';

  if (step === 1) {
    if (!fullName || !email) {
      setAuthMessages('signup', 'Please complete full name and email.');
      return false;
    }
    if (isFieldVisible('mobile') && !/^\d{10}$/.test(mobile)) {
      setAuthMessages('signup', 'Enter a valid 10-digit mobile number.');
      return false;
    }
  }

  if (step === 2) {
    const password = String(byId('signupPassword')?.value || '');
    const confirm = String(byId('signupConfirmPassword')?.value || '');
    if (!password) {
      setAuthMessages('signup', 'Password is required.');
      return false;
    }
    if (!isStrongSignupPassword(password)) {
      setFieldState(byId('signupPassword'), { valid: false, message: PASSWORD_POLICY_MESSAGE });
      setAuthMessages('signup', PASSWORD_POLICY_MESSAGE);
      return false;
    }
    if (password !== confirm) {
      setAuthMessages('signup', 'Password and confirm password do not match.');
      return false;
    }
  }

  setAuthMessages('signup');
  return true;
}

function updateSignupStepUI() {
  configureSignupFlowLayout();
  document.querySelectorAll('[data-signup-step]').forEach((section) => {
    const stepNumber = Number(section.dataset.signupStep || 1);
    let shouldBeHidden = false;
    if (stepNumber === 2 || stepNumber === 3) {
      shouldBeHidden = true;
    } else if (stepNumber === 4) {
      shouldBeHidden = signupStepState.current !== 2;
    } else {
      shouldBeHidden = signupStepState.current !== 1;
    }

    section.classList.toggle('hidden', shouldBeHidden);

    // Prevent browser validation on hidden fields by disabling them
    section.querySelectorAll('input, select, textarea').forEach((input) => {
      if (!input) return;
      if (shouldBeHidden) {
        // store original required state so we can restore it
        if (typeof input.dataset.wasRequired === 'undefined') input.dataset.wasRequired = input.required ? '1' : '0';
        input.required = false;
        input.disabled = true;
      } else {
        input.disabled = false;
        if (input.dataset.wasRequired === '1') input.required = true;
      }
    });
  });
  document.querySelectorAll('[data-step-chip]').forEach((chip) => {
    const chipStep = Number(chip.dataset.stepChip || 1);
    chip.classList.toggle('active', (chipStep === 1 && signupStepState.current === 1) || (chipStep === 4 && signupStepState.current === 2));
  });

  const prevBtn = byId('signupPrevStepBtn');
  const nextBtn = byId('signupNextStepBtn');
  const submitBtn = byId('signupSubmitBtn');

  if (prevBtn) prevBtn.style.visibility = signupStepState.current === 1 ? 'hidden' : 'visible';
  if (nextBtn) nextBtn.classList.toggle('hidden', signupStepState.current >= signupStepState.total);
  if (submitBtn) submitBtn.classList.toggle('hidden', signupStepState.current < signupStepState.total);
}

function bindSignupSteps() {
  const prevBtn = byId('signupPrevStepBtn');
  const nextBtn = byId('signupNextStepBtn');

  updateSignupStepUI();

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      setAuthMessages('signup');
      signupStepState.current = Math.max(1, signupStepState.current - 1);
      updateSignupStepUI();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!validateSignupStep(signupStepState.current)) return;
      signupStepState.current = Math.min(signupStepState.total, signupStepState.current + 1);
      updateSignupStepUI();
    });
  }
}

function bindSupportModal() {
  const openBtn = byId('supportLinkBtn');
  const closeBtn = byId('supportModalCloseBtn');
  const modal = byId('supportModal');
  const supportForm = byId('supportIssueForm');
  const submitBtn = byId('supportIssueSubmitBtn');
  const statusNode = byId('supportIssueStatus');

  if (!modal) return;

  const closeModal = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  };

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (authExperienceState.modules.supportModal === false) return;
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      if (statusNode) statusNode.textContent = '';
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  if (supportForm) {
    supportForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (statusNode) statusNode.textContent = '';

      const subject = String(byId('supportIssueSubject')?.value || '').trim();
      const category = String(byId('supportIssueCategory')?.value || 'General Query').trim();
      const message = String(byId('supportIssueMessage')?.value || '').trim();
      if (!subject || !message) {
        if (statusNode) statusNode.textContent = 'Please fill subject and message.';
        return;
      }

      setLoading(submitBtn, 'Submitting', true);
      try {
        await window.CollegeOSApi.submitSupportTicket({ subject, category, message, priority: 'medium' });
        if (statusNode) statusNode.textContent = 'Issue submitted successfully. Support will contact you soon.';
        supportForm.reset();
      } catch (_error) {
        const email = authExperienceState.support.email || 'support@collegeos.in';
        const whatsapp = authExperienceState.support.whatsapp || '';
        const fallback = `Could not submit directly. Email ${email}${whatsapp ? ` or WhatsApp ${whatsapp}` : ''}.`;
        if (statusNode) statusNode.textContent = fallback;
      } finally {
        setLoading(submitBtn, 'Submit issue', false);
      }
    });
  }
}

function bindLegalModal() {
  const modal = byId('legalModal');
  const closeBtn = byId('legalModalCloseBtn');
  if (!modal) return;

  const showTab = (tab) => {
    document.querySelectorAll('[data-legal-tab]').forEach((node) => {
      node.classList.toggle('active', node.dataset.legalTab === tab);
    });
    document.querySelectorAll('[data-legal-content]').forEach((node) => {
      node.classList.toggle('hidden', node.dataset.legalContent !== tab);
    });
  };

  const openModal = (tab = 'terms') => {
    showTab(tab);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  };

  const closeModal = () => {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  };

  document.querySelectorAll('[data-legal-open]').forEach((button) => {
    button.addEventListener('click', () => {
      openModal(button.dataset.legalOpen || 'terms');
    });
  });

  document.querySelectorAll('[data-legal-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      showTab(button.dataset.legalTab || 'terms');
    });
  });

  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });
}

function bindForgotPassword() {
  const forgotBtn = byId('forgotPasswordBtn');
  if (!forgotBtn) return;

  forgotBtn.addEventListener('click', async () => {
    const email = String(byId('loginEmail')?.value || '').trim().toLowerCase();
    if (!email) {
      setAuthMessages('login', 'Enter your email first, then click Forgot Password.');
      return;
    }

    // Quick client-side validation to avoid unnecessary server calls
    if (!verifyCaptcha('login')) {
      setAuthMessages('login', captchaState.login.ready ? 'Captcha answer is incorrect. Please try again.' : 'Captcha could not load. Refresh captcha.');
      return;
    }

    try {
      const captcha = await ensureCaptchaPayload('login');
      await window.CollegeOSApi.forgotPassword({
        email,
        captcha
      });
      setAuthMessages('login', '', 'If the account exists, a reset link has been sent to your email.');
    } catch (error) {
      setAuthMessages('login', error.message || 'Unable to process reset request');
    }
  });
}

const signupVerificationState = {
  method: 'email',
  requested: false,
  verified: false,
  verificationToken: '',
  pendingData: null,
  timer: null,
  remaining: 0,
  requestInProgress: false,
  verifyInProgress: false,
  modalOpen: false,
  allowClose: false
};

function setSignupOtpStatus(error = '', success = '') {
  setText('signupOtpError', error);
  setText('signupOtpSuccess', success);
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  });
}

function canCloseSignupOtpModal() {
  return signupVerificationState.allowClose && !signupVerificationState.verifyInProgress;
}

function openSignupOtpModal({ focusInput = true } = {}) {
  const modal = byId('signupOtpModal');
  const otpInput = byId('signupOtpInput');
  const closeBtn = byId('signupOtpCloseBtn');
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  signupVerificationState.modalOpen = true;
  document.body.style.overflow = 'hidden';

  if (closeBtn) {
    closeBtn.classList.toggle('hidden', !signupVerificationState.allowClose);
    closeBtn.disabled = !canCloseSignupOtpModal();
  }

  if (focusInput && otpInput) {
    window.setTimeout(() => otpInput.focus(), 60);
  }
}

function closeSignupOtpModal() {
  if (!canCloseSignupOtpModal()) return;
  const modal = byId('signupOtpModal');
  if (!modal) return;

  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  signupVerificationState.modalOpen = false;
  document.body.style.overflow = '';

  setAuthMessages('signup', '', 'Verification pending. Reopen OTP verification to complete signup.');
}

function resetSignupVerification() {
  signupVerificationState.requested = false;
  signupVerificationState.verified = false;
  signupVerificationState.verificationToken = '';
  signupVerificationState.pendingData = null;
  signupVerificationState.remaining = 0;
  signupVerificationState.requestInProgress = false;
  signupVerificationState.verifyInProgress = false;
  signupVerificationState.modalOpen = false;
  if (signupVerificationState.timer) {
    clearInterval(signupVerificationState.timer);
    signupVerificationState.timer = null;
  }
  const timerNode = byId('signupOtpResendTimer');
  if (timerNode) timerNode.textContent = 'Resend in 00:30';
  const resendBtn = byId('signupOtpResendBtn');
  if (resendBtn) resendBtn.disabled = false;
  const modal = byId('signupOtpModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
  document.body.style.overflow = '';
  setSignupOtpStatus('', '');
  const otpInput = byId('signupOtpInput');
  if (otpInput) otpInput.value = '';
}

function startVerificationResendTimer(seconds) {
  const timerNode = byId('signupOtpResendTimer');
  const resendBtn = byId('signupOtpResendBtn');
  signupVerificationState.remaining = seconds;

  if (signupVerificationState.timer) {
    clearInterval(signupVerificationState.timer);
    signupVerificationState.timer = null;
  }

  if (resendBtn) resendBtn.disabled = true;

  const paint = () => {
    const mm = String(Math.floor(signupVerificationState.remaining / 60)).padStart(2, '0');
    const ss = String(signupVerificationState.remaining % 60).padStart(2, '0');
    if (timerNode) timerNode.textContent = `Resend in ${mm}:${ss}`;
  };

  paint();
  signupVerificationState.timer = window.setInterval(() => {
    signupVerificationState.remaining -= 1;
    if (signupVerificationState.remaining <= 0) {
      clearInterval(signupVerificationState.timer);
      signupVerificationState.timer = null;
      if (timerNode) timerNode.textContent = 'You can resend now';
      if (resendBtn) resendBtn.disabled = false;
      return;
    }
    paint();
  }, 1000);
}

async function requestSignupVerificationCode({ isResend = false } = {}) {
  const data = signupVerificationState.pendingData;
  if (!data || signupVerificationState.requestInProgress) return false;

  // Global in-flight lock and cooldown
  window.__collegeOsOtpGlobals = window.__collegeOsOtpGlobals || { inFlight: false, cooldownUntil: 0 };
  if (window.__collegeOsOtpGlobals.inFlight) {
    setSignupOtpStatus('Request already in progress. Please wait.', '');
    return false;
  }
  if (window.__collegeOsOtpGlobals.cooldownUntil && Date.now() < window.__collegeOsOtpGlobals.cooldownUntil) {
    const wait = Math.ceil((window.__collegeOsOtpGlobals.cooldownUntil - Date.now()) / 1000);
    setSignupOtpStatus(`Please wait ${wait} seconds before requesting another OTP.`, '');
    return false;
  }
  window.__collegeOsOtpGlobals.inFlight = true;

  const triggerBtn = isResend ? byId('signupOtpResendBtn') : byId('signupSubmitBtn');
  signupVerificationState.requestInProgress = true;
  setLoading(triggerBtn, isResend ? 'Resending OTP' : 'Sending OTP', true);
  setSignupOtpStatus('', '');

  try {
    const captcha = await ensureCaptchaPayload('signup');
    const target = data.email;
    const payload = await withTimeout(window.CollegeOSApi.requestVerificationCode({
      channel: 'email',
      target,
      purpose: 'signup',
      captcha
    }), 20_000, 'Sending OTP is taking longer than expected. Please try again.');
    signupVerificationState.method = 'email';
    signupVerificationState.requested = true;
    setSignupOtpStatus('', payload.message || 'OTP sent successfully.');
    startVerificationResendTimer(Number(payload.resendAfterSeconds || 30));
    return true;
  } catch (error) {
    let message = normalizeAuthErrorMessage(error.message, 'Failed to send verification code.');
    if (/taking longer than expected/i.test(message)) {
      message = 'Sending OTP is taking longer than expected. Please try again.';
    }
    if (error?.status === 429) {
      const retry = Number(error?.retryAfter || 0) || 30;
      message = `Too many requests. Please wait ${retry} seconds before retrying.`;
      // Start resend countdown so user sees when they can retry
      try { startVerificationResendTimer(retry); } catch (e) { /* ignore */ }
    }
    setSignupOtpStatus(message, '');
    setAuthMessages('signup', message);
    const resendBtn = byId('signupOtpResendBtn');
    if (resendBtn) resendBtn.disabled = false;
    return false;
  } finally {
    signupVerificationState.requestInProgress = false;
    setLoading(triggerBtn, isResend ? 'Resend OTP' : 'Create Account', false);
    // release in-flight lock after short delay so UI cannot spam
    window.setTimeout(() => {
      if (!window.__collegeOsOtpGlobals) return;
      // if server suggested a cooldown via retryAfter, keep until then
      const retry = Number((signupVerificationState.lastRetryAfterSeconds || 0));
      if (retry && retry > 0) {
        window.__collegeOsOtpGlobals.cooldownUntil = Date.now() + (retry * 1000);
      }
      window.__collegeOsOtpGlobals.inFlight = false;
    }, 600);
  }
}

async function completePostLoginFlow(preferredCategoryId = null, preferredBranchId = null, preferredSemesterId = null) {
  try {
    const profilePayload = await window.CollegeOSApi.getStudentAcademicProfile();
    const profile = profilePayload?.profile;
    const onboardingCompleted = Boolean(profilePayload?.onboarding_completed);

    if (!onboardingCompleted) {
      openOnboardingModal({
        categoryId: preferredCategoryId || profile?.categoryId || null,
        branchId: preferredBranchId || profile?.branchId || null,
        semesterId: preferredSemesterId || profile?.semesterId || null,
        onboardingStep: profile?.onboardingStep || 1
      });
      return;
    }
  } catch {
    openOnboardingModal({
      categoryId: preferredCategoryId || null,
      branchId: preferredBranchId || null,
      semesterId: preferredSemesterId || null,
      onboardingStep: 1
    });
    return;
  }

  window.location.href = '/dashboard';
}

function bindEmailLogin() {
  const form = byId('loginForm');
  const submitBtn = byId('loginSubmitBtn');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setAuthMessages('login');

    if (!verifyCaptcha('login')) {
      setAuthMessages('login', captchaState.login.ready ? 'Captcha answer is incorrect. Please try again.' : 'Captcha could not load. Refresh captcha.');
      return;
    }

    const email = byId('loginEmail').value.trim();
    const password = byId('loginPassword').value;
    const rememberMe = Boolean(byId('rememberMe')?.checked);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldState(byId('loginEmail'), { valid: false, message: 'Enter a valid email address.' });
      setAuthMessages('login', 'Please fix the highlighted fields.');
      return;
    }

    if (!password || password.length < 6) {
      setFieldState(byId('loginPassword'), { valid: false, message: 'Password must be at least 6 characters.' });
      setAuthMessages('login', 'Please fix the highlighted fields.');
      return;
    }

    setLoading(submitBtn, 'Signing In', true);

    try {
      if (!window.CollegeOSApi) {
        throw new Error('Authentication service is unavailable right now.');
      }

      const captcha = await ensureCaptchaPayload('login');
      await window.CollegeOSApi.login({ email, password, rememberMe, captcha });

      // Wait for session cookie to be available and /api/auth/me to return the user
      const sessionUser = await waitForSessionReady(6000);
      if (!sessionUser) {
        setAuthMessages('login', '', 'Login successful. Finalizing session...');
        // Try one more time before proceeding
        await new Promise((r) => setTimeout(r, 400));
      }

      localStorage.setItem('collegeOsRememberEmail', rememberMe ? email : '');
      setAuthMessages('login', '', 'Login successful. Preparing your dashboard...');
      await completePostLoginFlow();
    } catch (error) {
      const message = error?.message || 'Login failed';
      if (/captcha/i.test(message)) {
        setAuthMessages('login', 'Captcha could not load. Refresh captcha.');
      } else if (/too many failed attempts/i.test(message)) {
        const otpInput = byId('mobileNumber');
        if (otpInput) otpInput.value = email;
        if (typeof window.__collegeOsSetLoginMethod === 'function') {
          window.__collegeOsSetLoginMethod('otp');
        }
        setAuthMessages('login', 'Password login is temporarily locked. Use OTP Login to continue, or wait 15 minutes and try again.');
      } else {
        setAuthMessages('login', message);
      }
      if (/captcha/i.test(message) || error?.status === 429) {
        try { await refreshCaptcha('login', { force: true }); } catch { /* ignore */ }
      }
    } finally {
      setLoading(submitBtn, 'Sign In', false);
    }
  });
}

function bindMobileOtp() {
  const requestForm = byId('mobileOtpRequestForm');
  const verifyForm = byId('mobileOtpVerifyForm');
  const mobileInput = byId('mobileNumber');
  const sendBtn = byId('sendOtpBtn');
  const verifyBtn = byId('verifyOtpBtn');
  const resendBtn = byId('resendOtpBtn');
  if (!requestForm || !verifyForm) return;
  if (requestForm.dataset.collegeosBound === '1') return;
  requestForm.dataset.collegeosBound = '1';

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setAuthMessages('login');

    if (!verifyCaptcha('login')) {
      setAuthMessages('login', captchaState.login.ready ? 'Captcha answer is incorrect. Please try again.' : 'Captcha could not load. Refresh captcha.');
      return;
    }

    const email = String(mobileInput.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
      setAuthMessages('login', 'Enter a valid Gmail ID (example: yourname@gmail.com).');
      return;
    }


    // Global in-flight lock and cooldown
    if (window.__collegeOsOtpGlobals?.inFlight) {
      setAuthMessages('login', 'Request already in progress. Please wait.');
      return;
    }
    if (window.__collegeOsOtpGlobals?.cooldownUntil && Date.now() < window.__collegeOsOtpGlobals.cooldownUntil) {
      const wait = Math.ceil((window.__collegeOsOtpGlobals.cooldownUntil - Date.now()) / 1000);
      setAuthMessages('login', `Please wait ${wait} seconds before requesting another OTP.`);
      return;
    }
    window.__collegeOsOtpGlobals = window.__collegeOsOtpGlobals || {};
    window.__collegeOsOtpGlobals.inFlight = true;

    setLoading(sendBtn, 'Sending OTP', true);
    try {
      if (!window.CollegeOSApi) {
        throw new Error('Email OTP is temporarily unavailable. Please use password login.');
      }

      const captcha = await ensureCaptchaPayload('login');

      const payload = await window.CollegeOSApi.requestVerificationCode({ 
        channel: 'email', 
        target: email, 
        purpose: 'login',
        captcha
      });
      otpState.email = email;
      verifyForm.classList.remove('hidden');
      setAuthMessages('login', '', payload?.message || 'OTP sent successfully.');
      startOtpResendTimer(30, 'otpResendTimer', 'resendOtpBtn');
    } catch (error) {
      const msg = error?.message || 'Failed to send OTP';
      if (/captcha/i.test(msg)) {
        setAuthMessages('login', 'Captcha could not load. Refresh captcha.');
      } else if (error?.status === 429) {
        const retry = Number(error?.retryAfter || 0) || 30;
        setAuthMessages('login', `Too many requests. Please wait ${retry} seconds before retrying.`);
        try { startOtpResendTimer(retry, 'otpResendTimer', 'resendOtpBtn'); } catch (e) { /* ignore */ }
      } else {
        setAuthMessages('login', msg);
      }
      if (/captcha/i.test(msg)) {
        try { await refreshCaptcha('login', { force: true }); } catch { /* ignore */ }
      }
    } finally {
      setLoading(sendBtn, 'Send OTP', false);
      // release in-flight lock after small delay to avoid immediate duplicate calls
      window.setTimeout(() => {
        if (window.__collegeOsOtpGlobals) window.__collegeOsOtpGlobals.inFlight = false;
      }, 600);
    }
  });

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setAuthMessages('login');

    const email = String(mobileInput.value || '').trim().toLowerCase();
    const otp = String(byId('mobileOtp')?.value || '').trim();

    if (!/^[^\s@]+@gmail\.com$/i.test(email) || !/^\d{6}$/.test(otp)) {
      setAuthMessages('login', 'Enter valid Gmail ID and 6-digit OTP.');
      return;
    }

    setLoading(verifyBtn, 'Verifying OTP', true);
    try {
      const captcha = await ensureCaptchaPayload('login');
      await window.CollegeOSApi.loginWithEmailOtp({ email, code: otp, captcha });
      // Wait for session to be established server-side
      await waitForSessionReady(6000);
      setAuthMessages('login', '', 'OTP verified. Welcome back.');
      await completePostLoginFlow();
    } catch (error) {
      const msg = error?.message || 'OTP verification failed';
      if (/captcha/i.test(msg)) {
        setAuthMessages('login', 'Captcha could not load. Refresh captcha.');
      } else {
        setAuthMessages('login', msg);
      }
      if (/captcha/i.test(msg) || error?.status === 429) {
        try { await refreshCaptcha('login', { force: true }); } catch { /* ignore */ }
      }
    } finally {
      setLoading(verifyBtn, 'Verify OTP and Login', false);
    }
  });

  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (!otpState.email || otpState.remaining > 0) return;
      if (window.__collegeOsOtpGlobals?.inFlight) return;
      if (window.__collegeOsOtpGlobals?.cooldownUntil && Date.now() < window.__collegeOsOtpGlobals.cooldownUntil) return;
      setLoading(resendBtn, 'Resending', true);
      try {
        const captcha = await ensureCaptchaPayload('login');
        const payload = await window.CollegeOSApi.requestVerificationCode({ 
          channel: 'email', 
          target: otpState.email, 
          purpose: 'login',
          captcha
        });
        setAuthMessages('login', '', payload?.message || 'OTP resent successfully.');
        startOtpResendTimer(30, 'otpResendTimer', 'resendOtpBtn');
      } catch (error) {
        const msg = error?.message || 'Unable to resend OTP';
        if (/captcha/i.test(msg)) {
          setAuthMessages('login', 'Captcha could not load. Refresh captcha.');
        } else {
          setAuthMessages('login', msg);
        }
        if (/captcha/i.test(msg) || error?.status === 429) {
          try { await refreshCaptcha('login', { force: true }); } catch { /* ignore */ }
        }
      } finally {
        setLoading(resendBtn, 'Resend OTP', false);
      }
    });
  }
}

async function registerAccount(signupData) {
  const payload = await window.CollegeOSApi.signup({
    fullName: signupData.fullName,
    email: signupData.email,
    mobile: signupData.mobile,
    password: signupData.password,
    verificationMethod: signupVerificationState.method,
    verificationToken: signupVerificationState.verificationToken,
    captcha: await ensureCaptchaPayload('signup')
  });

  return payload;
}

function bindSignupVerificationUi() {
  const modal = byId('signupOtpModal');
  const resendBtn = byId('signupOtpResendBtn');
  const verifyBtn = byId('signupOtpVerifyBtn');
  const closeBtn = byId('signupOtpCloseBtn');

  if (!modal) return;
  if (modal.dataset.collegeosBound === '1') return;
  modal.dataset.collegeosBound = '1';

  // Use live lookup inside handler to avoid closed-over undefined variable
  const signupOtpInputEl = byId('signupOtpInput');
  if (signupOtpInputEl) {
    signupOtpInputEl.addEventListener('input', () => {
      const el = byId('signupOtpInput');
      if (!el) return;
      el.value = String(el.value || '').replace(/\D/g, '').slice(0, 6);
      if (byId('signupOtpError')?.textContent) {
        setSignupOtpStatus('', byId('signupOtpSuccess')?.textContent || '');
      }
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (signupVerificationState.remaining > 0 || signupVerificationState.requestInProgress) return;
      await requestSignupVerificationCode({ isResend: true });
    });
  }

  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      const data = signupVerificationState.pendingData;
      if (!data || signupVerificationState.verifyInProgress) return;
      if (!signupVerificationState.requested) {
        setSignupOtpStatus('Request OTP first before verification.', '');
        return;
      }

      const code = String(byId('signupOtpInput')?.value || '').trim();
      if (!/^\d{6}$/.test(code)) {
        setSignupOtpStatus('OTP must be 6 digits.', '');
        const el = byId('signupOtpInput'); if (el) el.focus();
        return;
      }

      signupVerificationState.verifyInProgress = true;
      setLoading(verifyBtn, 'Verifying OTP', true);
      if (resendBtn) resendBtn.disabled = true;
      if (closeBtn) closeBtn.disabled = true;
      setSignupOtpStatus('', 'Verifying code...');

      try {
        const verificationPayload = await window.CollegeOSApi.verifyCode({
          channel: 'email',
          target: data.email,
          purpose: 'signup',
          code
        });

        signupVerificationState.verificationToken = verificationPayload?.verificationToken || '';
        signupVerificationState.verified = true;
        console.log('[auth] OTP verified');
        setSignupOtpStatus('', 'Verification successful. Completing signup...');

        const signupResult = await registerAccount(data);
        const success = Boolean(signupResult?.success);
        const responseUser = signupResult?.user || null;
        const redirectTarget = String(signupResult?.redirectUrl || '/dashboard').trim() || '/dashboard';
        console.log('[auth:signup] verify response', {
          success,
          hasUser: Boolean(responseUser),
          role: signupResult?.role || responseUser?.role || 'student',
          redirectUrl: redirectTarget
        });

        persistSignupAuthState(responseUser);

        const fallbackTimer = window.setTimeout(() => {
          console.log('[auth:signup] redirect fallback fired');
          try {
            window.location.assign(redirectTarget);
          } catch {
            window.location.href = redirectTarget;
          }
        }, 1500);

        let sessionUser = null;
        try {
          sessionUser = await waitForSessionReady(1500);
        } catch {
          sessionUser = null;
        }

        if (sessionUser) {
          persistSignupAuthState(sessionUser);
        }

        console.log('[auth] Session created', {
          hasSessionUser: Boolean(sessionUser),
          userId: (sessionUser || responseUser)?.id || null
        });

        setAuthMessages('signup', '', 'Account created successfully. Redirecting to your dashboard...');

        const timer = signupVerificationState.timer;
        if (timer) {
          clearInterval(timer);
          signupVerificationState.timer = null;
        }

        if (modal) {
          modal.classList.add('hidden');
          modal.setAttribute('aria-hidden', 'true');
        }
        signupVerificationState.modalOpen = false;
        document.body.style.overflow = '';

        window.clearTimeout(fallbackTimer);
        console.log('[auth] Redirecting to dashboard');
        try {
          window.location.assign(redirectTarget || '/dashboard');
        } catch {
          try {
            window.location.href = redirectTarget || '/dashboard';
          } catch {
            window.location.href = '/dashboard';
          }
        }
      } catch (error) {
        console.error('[auth:signup] post-otp handoff failed', {
          message: error?.message,
          code: error?.code,
          status: error?.status
        });
        setSignupOtpStatus(normalizeAuthErrorMessage(error.message, 'Verification failed. Please try again.'), '');
      } finally {
        signupVerificationState.verifyInProgress = false;
        setLoading(verifyBtn, 'Verify and Complete Signup', false);
        if (resendBtn && signupVerificationState.remaining <= 0) resendBtn.disabled = false;
        if (closeBtn) closeBtn.disabled = !canCloseSignupOtpModal();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeSignupOtpModal();
    });
  }

  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal && canCloseSignupOtpModal()) {
        closeSignupOtpModal();
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !signupVerificationState.modalOpen) return;
    if (canCloseSignupOtpModal()) {
      closeSignupOtpModal();
    }
  });
}

function bindSignup() {
  const form = byId('signupForm');
  if (!form) return;
  if (form.dataset.collegeosBound === '1') return;
  form.dataset.collegeosBound = '1';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setAuthMessages('signup');

    if (signupStepState.current < signupStepState.total) {
      if (!validateSignupStep(signupStepState.current)) return;
      signupStepState.current = Math.min(signupStepState.total, signupStepState.current + 1);
      updateSignupStepUI();
      return;
    }

    if (!verifyCaptcha('signup')) {
      setAuthMessages('signup', captchaState.signup.ready ? 'Captcha answer is incorrect. Please try again.' : 'Captcha could not load. Refresh captcha.');
      return;
    }

    const fullName = byId('signupName').value.trim();
    const email = byId('signupEmail').value.trim().toLowerCase();
    const mobile = byId('signupMobile').value.trim();
    const password = byId('signupPassword').value;
    const confirmPassword = byId('signupConfirmPassword').value;
    const acceptedTerms = Boolean(byId('signupTerms')?.checked);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldState(byId('signupEmail'), { valid: false, message: 'Enter a valid email address.' });
      setAuthMessages('signup', 'Please fix the highlighted fields.');
      return;
    }

    if (!fullName || !email || (isFieldVisible('mobile') && !mobile)) {
      setAuthMessages('signup', 'Please complete your basic details.');
      return;
    }

    if (password !== confirmPassword) {
      setAuthMessages('signup', 'Password and confirm password do not match.');
      return;
    }

    if (!acceptedTerms) {
      setAuthMessages('signup', 'Please accept terms and privacy policy to continue.');
      return;
    }

    if (!isStrongSignupPassword(password)) {
      setFieldState(byId('signupPassword'), { valid: false, message: PASSWORD_POLICY_MESSAGE });
      setAuthMessages('signup', PASSWORD_POLICY_MESSAGE);
      return;
    }

    signupVerificationState.pendingData = {
      fullName,
      email,
      mobile,
      password

    };

    signupVerificationState.method = 'email';

    const sent = await requestSignupVerificationCode({ isResend: false });
    if (!sent) return;

    setSignupOtpStatus('', 'OTP sent successfully. Enter it below to continue.');
    const otpInputEl = byId('signupOtpInput');
    if (otpInputEl) otpInputEl.value = '';
    openSignupOtpModal({ focusInput: true });
    setAuthMessages('signup', '', 'Verification required. Complete OTP in the popup to finish signup.');
  });
}

const onboardingState = {
  visible: false,
  step: 1,
  selectedInterest: '',
  selectedGoals: [],
  prefill: {}
};

function renderOnboardingOptions() {
  const interestGrid = byId('interestGrid');
  const goalsGrid = byId('goalGrid');
  const studyMode = byId('onboardStudyMode');

  const interests = onboardingConfigState.options.career_interest.length
    ? onboardingConfigState.options.career_interest
    : [
      { option_value: 'Software Development', option_label: 'Software Development' },
      { option_value: 'Data Science', option_label: 'Data Science' },
      { option_value: 'AI and ML', option_label: 'AI and ML' },
      { option_value: 'Cloud Computing', option_label: 'Cloud Computing' },
      { option_value: 'Business Analytics', option_label: 'Business Analytics' },
      { option_value: 'Finance', option_label: 'Finance' }
    ];

  const goals = onboardingConfigState.options.learning_goal.length
    ? onboardingConfigState.options.learning_goal
    : [
      { option_value: 'Improve core subjects', option_label: 'Improve core subjects' },
      { option_value: 'Prepare for placements', option_label: 'Prepare for placements' },
      { option_value: 'Build project portfolio', option_label: 'Build project portfolio' },
      { option_value: 'Prepare for certifications', option_label: 'Prepare for certifications' },
      { option_value: 'Improve mock test scores', option_label: 'Improve mock test scores' }
    ];

  const studyModes = onboardingConfigState.options.study_mode.length
    ? onboardingConfigState.options.study_mode
    : [
      { option_value: 'Self paced', option_label: 'Self paced' },
      { option_value: 'Guided', option_label: 'Guided' },
      { option_value: 'Intensive', option_label: 'Intensive' },
      { option_value: 'Weekend focused', option_label: 'Weekend focused' }
    ];

  if (interestGrid) {
    interestGrid.innerHTML = interests
      .map((item) => `<button type="button" class="interest-card" data-interest="${item.option_value}">${item.option_label}</button>`)
      .join('');
  }

  if (goalsGrid) {
    goalsGrid.innerHTML = goals
      .map((item) => `<button type="button" class="interest-card goal-card" data-goal="${item.option_value}">${item.option_label}</button>`)
      .join('');
  }

  if (studyMode) {
    studyMode.innerHTML = studyModes
      .map((item) => `<option value="${item.option_value}">${item.option_label}</option>`)
      .join('');
  }
}

async function loadOnboardingConfig() {
  try {
    const payload = await window.CollegeOSApi.getOnboardingConfig();
    onboardingConfigState.steps = Array.isArray(payload?.steps) ? payload.steps : [];
    onboardingConfigState.options = {
      career_interest: Array.isArray(payload?.options?.career_interest) ? payload.options.career_interest : [],
      learning_goal: Array.isArray(payload?.options?.learning_goal) ? payload.options.learning_goal : [],
      study_mode: Array.isArray(payload?.options?.study_mode) ? payload.options.study_mode : []
    };
  } catch (_error) {
    onboardingConfigState.steps = [];
  }

  renderOnboardingOptions();
}

function updateOnboardingStepUi() {
  const step1 = byId('onboardingStep1');
  const step2 = byId('onboardingStep2');
  const step3 = byId('onboardingStep3');
  const step4 = byId('onboardingStep4');

  [1, 2, 3, 4].forEach((i) => {
    byId(`stepChip${i}`)?.classList.toggle('active', i === onboardingState.step);
  });

  if (step1) step1.classList.toggle('hidden', onboardingState.step !== 1);
  if (step2) step2.classList.toggle('hidden', onboardingState.step !== 2);
  if (step3) step3.classList.toggle('hidden', onboardingState.step !== 3);
  if (step4) step4.classList.toggle('hidden', onboardingState.step !== 4);

  const nextBtn = byId('onboardNextBtn');
  if (nextBtn) nextBtn.textContent = onboardingState.step === 4 ? 'Finish and Enter Dashboard' : 'Next';
}

function openOnboardingModal(prefill = {}) {
  const modal = byId('onboardingModal');
  if (!modal) {
    window.location.href = '/dashboard';
    return;
  }

  onboardingState.visible = true;
  onboardingState.step = Math.max(1, Number(prefill.onboardingStep || 1));
  onboardingState.prefill = prefill;
  onboardingState.selectedInterest = '';
  onboardingState.selectedGoals = [];

  if (prefill.categoryId && byId('onboardCategory')) {
    byId('onboardCategory').value = String(prefill.categoryId);
    updateBranchSelect(prefill.categoryId, 'onboardBranch');
  }

  if (prefill.branchId && byId('onboardBranch')) {
    byId('onboardBranch').value = String(prefill.branchId);
  }

  if (prefill.semesterId && byId('onboardSemester')) {
    byId('onboardSemester').value = String(prefill.semesterId);
  }

  if (prefill.onboardingStep) {
    onboardingState.step = Math.max(1, Number(prefill.onboardingStep || 1));
  }

  document.querySelectorAll('.interest-card').forEach((card) => card.classList.remove('active'));

  updateOnboardingStepUi();
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeOnboardingModal() {
  const modal = byId('onboardingModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  onboardingState.visible = false;
}

async function submitOnboarding() {
  const categoryId = Number(byId('onboardCategory')?.value || 0);
  const branchId = Number(byId('onboardBranch')?.value || 0);
  const semesterId = Number(byId('onboardSemester')?.value || 0) || Number(academicState.semesters[0]?.id || 1);
  const targetExam = String(byId('onboardTargetExam')?.value || '').trim();
  const preferredStudyMode = String(byId('onboardStudyMode')?.value || 'Self paced');

  if (!categoryId || !branchId || !semesterId) {
    setText('onboardingError', 'Please confirm category, branch/course, and semester.');
    return;
  }

  if (!onboardingState.selectedInterest) {
    setText('onboardingError', 'Please choose at least one career interest.');
    return;
  }

  if (!onboardingState.selectedGoals.length) {
    setText('onboardingError', 'Please choose at least one learning goal.');
    return;
  }

  const nextBtn = byId('onboardNextBtn');
  setLoading(nextBtn, 'Finalizing', true);
  setText('onboardingError', '');

  try {
    await window.CollegeOSApi.completeAcademicOnboarding({
      categoryId,
      branchId,
      semesterId,
      targetExam: targetExam || null,
      weakSubjects: [],
      careerInterest: onboardingState.selectedInterest,
      preferredStudyMode,
      batchYear: null,
      courseName: null,
      learningGoals: onboardingState.selectedGoals,
      onboardingPayload: {
        wizardVersion: onboardingConfigState.wizard.version || 1,
        selectedInterest: onboardingState.selectedInterest,
        selectedGoals: onboardingState.selectedGoals,
        preferredStudyMode,
        targetExam: targetExam || null
      }
    });

    setText('onboardingSuccess', 'Onboarding complete. Redirecting to your dashboard...');
    await warmDashboardBootstrap();
    window.setTimeout(() => {
      closeOnboardingModal();
      window.location.href = '/dashboard';
    }, 250);
  } catch (error) {
    setText('onboardingError', error.message || 'Failed to complete onboarding.');
  } finally {
    setLoading(nextBtn, 'Finish and Enter Dashboard', false);
  }
}

function bindOnboarding() {
  const backBtn = byId('onboardBackBtn');
  const nextBtn = byId('onboardNextBtn');
  const onboardCategory = byId('onboardCategory');

  document.addEventListener('click', (event) => {
    const interestCard = event.target.closest('.interest-card[data-interest]');
    if (interestCard) {
      document.querySelectorAll('.interest-card[data-interest]').forEach((node) => node.classList.remove('active'));
      interestCard.classList.add('active');
      onboardingState.selectedInterest = interestCard.dataset.interest || '';
      return;
    }

    const goalCard = event.target.closest('.goal-card[data-goal]');
    if (goalCard) {
      const goal = goalCard.dataset.goal || '';
      goalCard.classList.toggle('active');
      if (goalCard.classList.contains('active')) {
        if (!onboardingState.selectedGoals.includes(goal)) onboardingState.selectedGoals.push(goal);
      } else {
        onboardingState.selectedGoals = onboardingState.selectedGoals.filter((item) => item !== goal);
      }
    }
  });

  if (onboardCategory) {
    onboardCategory.addEventListener('change', () => {
      updateBranchSelect(onboardCategory.value, 'onboardBranch');
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (onboardingState.step > 1) {
        onboardingState.step -= 1;
        updateOnboardingStepUi();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
      setText('onboardingError', '');
      setText('onboardingSuccess', '');

      if (onboardingState.step === 1) {
        const categoryId = Number(byId('onboardCategory')?.value || 0);
        const branchId = Number(byId('onboardBranch')?.value || 0);
        if (!categoryId || !branchId) {
          setText('onboardingError', 'Please confirm category and branch/course.');
          return;
        }
        try {
          await window.CollegeOSApi.updateAcademicProfile({
            categoryId,
            branchId,
            semesterId: Number(byId('onboardSemester')?.value || 0) || null,
            onboardingStep: 'career_interest'
          });
        } catch {
          // Keep going so users are not blocked by a profile save issue.
        }
        onboardingState.step = 2;
        updateOnboardingStepUi();
        return;
      }

      if (onboardingState.step === 2) {
        if (!onboardingState.selectedInterest) {
          try {
            await window.CollegeOSApi.updateAcademicProfile({
              categoryId,
              branchId,
              semesterId: Number(byId('onboardSemester')?.value || 0) || null,
              onboardingStep: 'career_interest'
            });
          } catch {
            // Keep going if step persistence fails.
          }
          setText('onboardingError', 'Choose one career interest to continue.');
          return;
        }
        try {
          await window.CollegeOSApi.updateAcademicProfile({
            careerInterest: onboardingState.selectedInterest,
            onboardingStep: 'learning_goals'
          });
        } catch {
          // continue
          try {
            await window.CollegeOSApi.updateAcademicProfile({
              careerInterest: onboardingState.selectedInterest,
              onboardingStep: 'learning_goals'
            });
          } catch {
            // Keep going if step persistence fails.
          }
        }
        onboardingState.step = 3;
        updateOnboardingStepUi();
        return;
      }

      if (onboardingState.step === 3) {
        if (!onboardingState.selectedGoals.length) {
          setText('onboardingError', 'Select at least one learning goal to continue.');
          return;
          try {
            await window.CollegeOSApi.updateAcademicProfile({
              learningGoals: onboardingState.selectedGoals,
              preferredStudyMode: String(byId('onboardStudyMode')?.value || 'Self paced'),
              onboardingStep: 'dashboard_setup'
            });
          } catch {
            // Keep going if step persistence fails.
          }
        }
        try {
          await window.CollegeOSApi.updateAcademicProfile({
            learningGoals: onboardingState.selectedGoals,
            preferredStudyMode: String(byId('onboardStudyMode')?.value || 'Self paced'),
            onboardingStep: 'dashboard_setup'
          });
        } catch {
          // continue
        }
        onboardingState.step = 4;
        updateOnboardingStepUi();
        return;
      }

      await submitOnboarding();
    });
  }
}

function hydrateRememberedFields() {
  const remembered = localStorage.getItem('collegeOsRememberEmail') || '';
  if (remembered) {
    const emailInput = byId('loginEmail');
    const remember = byId('rememberMe');
    if (emailInput) emailInput.value = remembered;
    if (remember) remember.checked = true;
  }
}

function hydrateAuthErrorFromQuery() {
  if (typeof window === 'undefined' || !window.location) return;

  const params = new URLSearchParams(window.location.search);
  const authError = params.get('auth_error');
  if (!authError) return;

  const fallbackMessages = {
    google_unavailable: 'Google login is not configured for this environment.',
    google_session_error: 'Could not prepare Google login. Please try again.',
    google_state_invalid: 'Your Google login session expired. Please try again.',
    google_denied: 'Google sign-in was cancelled or denied.',
    google_auth_failed: 'Google sign-in failed. Please try again.'
  };

  const message = params.get('auth_error_message') || fallbackMessages[authError] || 'Google sign-in failed. Please try again.';
  setAuthMessages('login', message);
  if (window.history?.replaceState) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const pathname = String(window.location.pathname || '').toLowerCase();
  const isAdminPath = pathname.startsWith('/admin') || pathname.includes('admin-login.html');

  // Always load config but skip full student auth initialization on admin pages
  void loadAuthExperienceConfig();
  if (isAdminPath) {
    // Minimal admin-only initialization: prepare captcha utilities and admin shortcut.
    bindAdminShortcut();
    // Prepare admin captcha widget but do not initialize student auth UI
    setCaptchaReady('admin', false, 'Preparing secure CAPTCHA...', null);
    void refreshCaptcha('admin');
    return;
  }
  initAuthEntranceMotion();
  window.addEventListener('resize', () => {
    window.requestAnimationFrame(updateAuthTabIndicator);
  });
  bindAdminShortcut();
  bindTabs();
  bindInlineValidation();
  bindForgotPassword();
  bindSignupSteps();
  bindSupportModal();
  bindLegalModal();
  bindPasswordStrength();
  bindPasswordToggles();
  bindUniversitySelector();
  bindEmailLogin();
  bindMobileOtp();
  bindSignup();
  bindSignupVerificationUi();
  bindOnboarding();
  hydrateAuthErrorFromQuery();

  // Start CAPTCHA generation immediately so the login form does not wait on slower bootstrap work.
  setCaptchaReady('login', false, 'Preparing captcha...', null);
  setCaptchaReady('signup', false, 'Preparing captcha...', null);
  void refreshCaptcha('login');
  void refreshCaptcha('signup');
  if (window.CollegeOSApi?.startHealthPing) {
    window.CollegeOSApi.startHealthPing({ intervalMs: 10 * 60 * 1000, immediate: true });
  }

  byId('refreshLoginCaptcha')?.addEventListener('click', () => refreshCaptcha('login', { force: true }));
  byId('refreshSignupCaptcha')?.addEventListener('click', () => refreshCaptcha('signup', { force: true }));

  void loadAcademicOptions();
  void loadOnboardingConfig();
  bindCategoryBranchCascades();
  hydrateRememberedFields();
});

// Fallback: ensure Google button exists even if earlier rendering failed.
function ensureGoogleAuthButtonFallback() {
  try {
    const slots = document.querySelectorAll('[data-google-auth-slot]');
    if (!slots || slots.length === 0) return;
    slots.forEach((slot) => {
      if (slot.querySelector('.google-auth-button')) return; // already present
      slot.classList.remove('hidden');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'googleLoginBtn';
      btn.className = 'google-auth-button';
      btn.innerHTML = `<span class="google-auth-icon" aria-hidden="true"><i class="fa-brands fa-google"></i></span><span class="google-auth-label">Continue with Google</span>`;
      const clientId = getGoogleClientId();
      if (!clientId) {
        btn.disabled = true;
        btn.title = 'Google login is not configured for this environment.';
        const note = document.createElement('p');
        note.className = 'provider-note';
        note.textContent = 'Google login not configured. Contact administrator to enable Google sign-in.';
        slot.appendChild(btn);
        slot.appendChild(note);
        return;
      }
      const backendBase = (window.CollegeOSApiConfig && window.CollegeOSApiConfig.apiUrl) ? window.CollegeOSApiConfig.apiUrl : '';
      const redirectUrl = (() => {
        try { if (backendBase) return new URL('/api/auth/google', backendBase).toString(); } catch { return '/api/auth/google'; }
        return '/api/auth/google';
      })();
      btn.addEventListener('click', () => { try { window.location.assign(redirectUrl); } catch { window.location.href = redirectUrl; } });
      slot.appendChild(btn);
    });
  } catch (e) {
    // non-fatal
    console.warn('ensureGoogleAuthButtonFallback failed', e && e.message);
  }
}

// Run fallback a short time after DOM ready to cover race conditions.
window.setTimeout(() => ensureGoogleAuthButtonFallback(), 300);
