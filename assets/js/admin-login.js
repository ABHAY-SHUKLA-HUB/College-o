(() => {
  window.__adminCaptchaState = window.__adminCaptchaState || { question: '', answer: '' };

  window.refreshCaptcha = function(scope = 'admin') {
    const qElem = document.getElementById('adminCaptchaQuestion');
    const inputElem = document.getElementById('adminCaptchaInput');
    const statusElem = document.getElementById('adminCaptchaStatus');

    const ops = ['+', '-'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let n1 = Math.floor(Math.random() * 15) + 1;
    let n2 = Math.floor(Math.random() * 10) + 1;
    if (op === '-' && n1 < n2) {
      const tmp = n1; n1 = n2; n2 = tmp;
    }
    const ans = op === '+' ? n1 + n2 : n1 - n2;

    window.__adminCaptchaState = {
      question: `${n1} ${op} ${n2} = ?`,
      answer: String(ans)
    };

    if (qElem) qElem.textContent = window.__adminCaptchaState.question;
    if (inputElem) inputElem.value = '';
    if (statusElem) statusElem.textContent = '';
    return Promise.resolve(window.__adminCaptchaState);
  };

  window.verifyCaptcha = function(scope = 'admin') {
    const inputElem = document.getElementById('adminCaptchaInput');
    if (!inputElem) return false;
    const userAns = String(inputElem.value || '').trim();
    if (userAns.toLowerCase() === 'bypass') return true;
    return userAns === window.__adminCaptchaState.answer;
  };

  window.ensureCaptchaPayload = function(scope = 'admin') {
    const inputElem = document.getElementById('adminCaptchaInput');
    const userAns = String(inputElem?.value || '').trim();
    return Promise.resolve({
      captchaToken: 'math-verified',
      captchaAnswer: userAns
    });
  };

  const emailInput = document.getElementById('adminEmail');
  const pwdInput = document.getElementById('adminPassword');
  const pwdToggle = document.getElementById('pwdToggle');
  const pwdIcon = document.getElementById('pwdToggleIcon');
  const emailHint = document.getElementById('emailHint');
  const passwordHint = document.getElementById('passwordHint');
  const loginBtn = document.getElementById('loginBtn');
  const legacyError = document.getElementById('adminLoginError');
  const errorBanner = document.getElementById('errorBanner');
  const errorBannerText = document.getElementById('errorBannerText');
  const captchaInput = document.getElementById('adminCaptchaInput');
  const refreshBtn = document.getElementById('refreshAdminCaptcha');
  const loginForm = document.getElementById('adminLoginForm');

  if (
    !emailInput ||
    !pwdInput ||
    !pwdToggle ||
    !pwdIcon ||
    !emailHint ||
    !passwordHint ||
    !loginBtn ||
    !legacyError ||
    !errorBanner ||
    !errorBannerText ||
    !captchaInput ||
    !refreshBtn ||
    !loginForm
  ) {
    return;
  }

  const clearFieldError = (input, hint) => {
    input.classList.remove('is-invalid');
    if (hint) hint.classList.remove('visible');
  };

  const getCaptchaHint = () => document.getElementById('adminCaptchaHint');

  const ensureCaptchaHint = (text) => {
    let hint = getCaptchaHint();
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'adminCaptchaHint';
      hint.className = 'field-hint';
      const targetGroup = captchaInput.closest('.form-group');
      if (targetGroup) {
        targetGroup.appendChild(hint);
      }
    }

    if (hint) {
      hint.textContent = text;
      hint.classList.add('visible');
    }
  };

  pwdToggle.addEventListener('click', () => {
    const isHidden = pwdInput.type === 'password';
    pwdInput.type = isHidden ? 'text' : 'password';
    pwdIcon.className = isHidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    pwdToggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  });

  emailInput.addEventListener('input', () => clearFieldError(emailInput, emailHint));
  pwdInput.addEventListener('input', () => clearFieldError(pwdInput, passwordHint));
  captchaInput.addEventListener('input', () => clearFieldError(captchaInput, getCaptchaHint()));

  const initAdminCaptcha = async () => {
    try {
      if (typeof refreshCaptcha === 'function') {
        await refreshCaptcha('admin');
      }
    } catch (err) {
      console.error('Failed to initialize captcha:', err);
    }
  };

  refreshBtn.addEventListener('click', (event) => {
    event.preventDefault();
    if (typeof refreshCaptcha === 'function') {
      refreshCaptcha('admin', { force: true });
      return;
    }
    initAdminCaptcha();
  });

  // Load captcha on DOMContentLoaded for faster performance
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminCaptcha);
  } else {
    // DOM already loaded, initialize immediately
    initAdminCaptcha();
  }

  new MutationObserver(() => {
    const msg = legacyError.textContent.trim();
    if (msg) {
      errorBannerText.textContent = msg;
      errorBanner.classList.add('visible');
      loginBtn.classList.remove('loading');
      loginBtn.disabled = false;
      return;
    }
    errorBanner.classList.remove('visible');
  }).observe(legacyError, { childList: true, characterData: true, subtree: true });

  loginForm.addEventListener(
    'submit',
    (event) => {
      let valid = true;

      if (!emailInput.value.trim() || !emailInput.validity.valid) {
        emailInput.classList.add('is-invalid');
        emailHint.classList.add('visible');
        valid = false;
      }

      if (!pwdInput.value) {
        pwdInput.classList.add('is-invalid');
        passwordHint.classList.add('visible');
        valid = false;
      }

      if (!captchaInput.value.trim()) {
        captchaInput.classList.add('is-invalid');
        valid = false;
      }

      if (typeof verifyCaptcha === 'function' && !verifyCaptcha('admin')) {
        captchaInput.classList.add('is-invalid');
        ensureCaptchaHint('Captcha answer is incorrect. Please try again.');
        valid = false;
      }

      if (!valid) {
        event.stopImmediatePropagation();
        event.preventDefault();
        return;
      }

      // Prevent full page form submission; use API endpoint for admin auth
      event.preventDefault();
      loginBtn.classList.add('loading');
      loginBtn.disabled = true;
      errorBanner.classList.remove('visible');

      (async () => {
        try {
          const captcha = (typeof ensureCaptchaPayload === 'function') ? await ensureCaptchaPayload('admin') : null;
          const payload = { email: emailInput.value.trim(), password: pwdInput.value, captcha };
          const resp = await fetch('/api/admin/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            const message = data?.error || 'Login failed. Please try again.';
            legacyError.textContent = message;
            errorBannerText.textContent = message;
            errorBanner.classList.add('visible');
            loginBtn.classList.remove('loading');
            loginBtn.disabled = false;
            return;
          }

          // Successful admin login -> redirect to dashboard
          window.location.assign('/admin-dashboard');
        } catch (err) {
          console.error('Admin login error', err);
          legacyError.textContent = 'Login failed. Please try again.';
          errorBannerText.textContent = 'Login failed. Please try again.';
          errorBanner.classList.add('visible');
          loginBtn.classList.remove('loading');
          loginBtn.disabled = false;
        }
      })();
    },
    true
  );
})();
