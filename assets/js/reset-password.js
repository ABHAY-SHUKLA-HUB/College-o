(function () {
  function el(id) { return document.getElementById(id); }
  const stateValidating = el('state-validating');
  const stateForm = el('state-form');
  const stateInvalid = el('state-invalid');
  const stateSuccess = el('state-success');
  const form = el('resetForm');
  const newPassword = el('newPassword');
  const confirmPassword = el('confirmPassword');
  const formMessage = el('formMessage');
  const strengthFill = el('strengthFill');
  const reqLength = el('req-length');
  const reqUpper = el('req-upper');
  const reqLower = el('req-lower');
  const reqDigit = el('req-digit');
  const reqSpecial = el('req-special');
  const toggleNew = el('toggleNew');
  const cancelBtn = el('cancelBtn');

  let token = null;

  function show(state) {
    stateValidating.classList.add('hidden');
    stateForm.classList.add('hidden');
    stateInvalid.classList.add('hidden');
    stateSuccess.classList.add('hidden');

    if (state === 'validating') stateValidating.classList.remove('hidden');
    if (state === 'form') stateForm.classList.remove('hidden');
    if (state === 'invalid') stateInvalid.classList.remove('hidden');
    if (state === 'success') stateSuccess.classList.remove('hidden');
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

  function updateRequirements(pw) {
    const checks = {
      length: pw.length >= 6,
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      digit: /\d/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw)
    };

    reqLength.classList.toggle('ok', checks.length);
    reqUpper.classList.toggle('ok', checks.upper);
    reqLower.classList.toggle('ok', checks.lower);
    reqDigit.classList.toggle('ok', checks.digit);
    reqSpecial.classList.toggle('ok', checks.special);

    const score = Object.values(checks).filter(Boolean).length;
    const pct = Math.min(100, Math.round((score / 5) * 100));
    strengthFill.style.width = pct + '%';
  }

  function readTokenFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return String(params.get('token') || '').trim();
    } catch (e) { return null; }
  }

  async function validateToken(tk) {
    show('validating');
    try {
      const resp = await fetch('/api/auth/password/reset/validate?token=' + encodeURIComponent(tk), { method: 'GET' });
      if (!resp.ok) throw resp;
      const data = await resp.json();
      if (data && data.valid) {
        show('form');
        return true;
      }
      show('invalid');
      return false;
    } catch (err) {
      show('invalid');
      return false;
    }
  }

  async function submitForm(e) {
    e.preventDefault();
    formMessage.textContent = '';
    const a = newPassword.value || '';
    const b = confirmPassword.value || '';
    if (a !== b) {
      formMessage.textContent = 'Passwords do not match.';
      return;
    }
    if (!isStrongPassword(a)) {
      formMessage.textContent = 'Password does not meet security requirements.';
      return;
    }

    try {
      const resp = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token, newPassword: a, confirmPassword: b })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        formMessage.textContent = data && (data.error || data.message) ? (data.error || data.message) : 'Failed to reset password.';
        return;
      }

      show('success');
      // Remove token from URL without reload
      try { history.replaceState({}, '', '/login'); } catch (e) {}
      setTimeout(() => { window.location.href = '/login'; }, 4000);
    } catch (err) {
      formMessage.textContent = 'Network error. Please try again.';
    }
  }

  newPassword.addEventListener('input', (e) => {
    updateRequirements(e.target.value || '');
  });

  toggleNew.addEventListener('click', () => {
    if (newPassword.type === 'password') {
      newPassword.type = 'text';
      toggleNew.textContent = 'Hide';
    } else {
      newPassword.type = 'password';
      toggleNew.textContent = 'Show';
    }
  });

  cancelBtn.addEventListener('click', () => { window.location.href = '/login'; });

  form.addEventListener('submit', submitForm);

  // Init
  (async function init() {
    token = readTokenFromUrl();
    if (!token || token.length < 32) {
      show('invalid');
      return;
    }
    await validateToken(token);
  })();
})();
