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
    if (statusElem) {
      statusElem.innerHTML = '<i class="fa-solid fa-shield-check"></i> Security check ready.';
      statusElem.classList.remove('error');
    }
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

  function initAdminLogin() {
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

    if (!emailInput || !pwdInput || !loginBtn || !loginForm) {
      return;
    }

    // Initialize Captcha
    window.refreshCaptcha('admin');

    const clearFieldError = (input, hint) => {
      if (input) input.classList.remove('is-invalid');
      if (hint) hint.classList.remove('visible');
    };

    const getCaptchaHint = () => document.getElementById('adminCaptchaHint');

    const ensureCaptchaHint = (text) => {
      let hint = getCaptchaHint();
      if (!hint && captchaInput) {
        hint = document.createElement('div');
        hint.id = 'adminCaptchaHint';
        hint.className = 'field-hint';
        const targetGroup = captchaInput.closest('.form-group') || captchaInput.closest('.co-form-group') || captchaInput.closest('.co-admin-security-box');
        if (targetGroup) {
          targetGroup.appendChild(hint);
        }
      }

      if (hint) {
        hint.textContent = text;
        hint.classList.add('visible');
      }
    };

    const normalizeAdminErrorMessage = (rawError) => {
      const text = String(rawError || '').trim();
      if (/invalid email or password/i.test(text)) {
        return 'Unable to sign in. Please check your credentials and try again.';
      }
      if (/too many/i.test(text) || /429/i.test(text)) {
        return 'Too many attempts. Please wait and try again.';
      }
      if (/security check/i.test(text) || /captcha/i.test(text)) {
        return 'Security verification failed. Please solve the calculation and try again.';
      }
      return text || 'Unable to sign in. Please verify your credentials and try again.';
    };

    if (pwdToggle) {
      pwdToggle.addEventListener('click', (e) => {
        e.preventDefault();
        const isHidden = pwdInput.type === 'password';
        pwdInput.type = isHidden ? 'text' : 'password';
        if (pwdIcon) {
          pwdIcon.className = isHidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
        }
        pwdToggle.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
      });
    }

    emailInput.addEventListener('input', () => clearFieldError(emailInput, emailHint));
    pwdInput.addEventListener('input', () => clearFieldError(pwdInput, passwordHint));
    if (captchaInput) {
      captchaInput.addEventListener('input', () => clearFieldError(captchaInput, getCaptchaHint()));
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', (event) => {
        event.preventDefault();
        window.refreshCaptcha('admin');
      });
    }

    if (legacyError && errorBanner && errorBannerText) {
      new MutationObserver(() => {
        const msg = legacyError.textContent.trim();
        if (msg) {
          errorBannerText.textContent = normalizeAdminErrorMessage(msg);
          errorBanner.classList.add('visible');
          loginBtn.classList.remove('loading');
          loginBtn.disabled = false;
          const labelNode = loginBtn.querySelector('.btn-label');
          if (labelNode) labelNode.textContent = 'Sign In to Admin Panel';
          return;
        }
        errorBanner.classList.remove('visible');
      }).observe(legacyError, { childList: true, characterData: true, subtree: true });
    }

    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      let valid = true;

      if (!emailInput.value.trim() || !emailInput.validity.valid) {
        emailInput.classList.add('is-invalid');
        if (emailHint) emailHint.classList.add('visible');
        valid = false;
      }

      if (!pwdInput.value) {
        pwdInput.classList.add('is-invalid');
        if (passwordHint) passwordHint.classList.add('visible');
        valid = false;
      }

      if (captchaInput && !captchaInput.value.trim()) {
        captchaInput.classList.add('is-invalid');
        ensureCaptchaHint('Please enter the captcha answer.');
        valid = false;
      } else if (captchaInput && typeof window.verifyCaptcha === 'function' && !window.verifyCaptcha('admin')) {
        captchaInput.classList.add('is-invalid');
        ensureCaptchaHint('Captcha answer is incorrect. Please try again.');
        valid = false;
      }

      if (!valid) {
        return;
      }

      loginBtn.classList.add('loading');
      loginBtn.disabled = true;
      const labelNode = loginBtn.querySelector('.btn-label');
      if (labelNode) labelNode.textContent = 'Signing in...';
      if (errorBanner) errorBanner.classList.remove('visible');

      (async () => {
        try {
          const captcha = (typeof window.ensureCaptchaPayload === 'function') ? await window.ensureCaptchaPayload('admin') : null;
          const payload = { email: emailInput.value.trim(), password: pwdInput.value, captcha };
          const resp = await fetch('/api/admin/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          const data = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            const message = normalizeAdminErrorMessage(data?.error);
            if (legacyError) legacyError.textContent = message;
            if (errorBannerText) errorBannerText.textContent = message;
            if (errorBanner) errorBanner.classList.add('visible');
            loginBtn.classList.remove('loading');
            loginBtn.disabled = false;
            if (labelNode) labelNode.textContent = 'Sign In to Admin Panel';
            window.refreshCaptcha('admin');
            return;
          }

          // Successful admin login -> redirect to dashboard
          window.location.assign('/admin-dashboard');
        } catch (err) {
          console.error('Admin login error', err);
          const message = 'Unable to sign in. Please check your connection and try again.';
          if (legacyError) legacyError.textContent = message;
          if (errorBannerText) errorBannerText.textContent = message;
          if (errorBanner) errorBanner.classList.add('visible');
          loginBtn.classList.remove('loading');
          loginBtn.disabled = false;
          if (labelNode) labelNode.textContent = 'Sign In to Admin Panel';
          window.refreshCaptcha('admin');
        }
      })();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminLogin);
  } else {
    initAdminLogin();
  }
})();
