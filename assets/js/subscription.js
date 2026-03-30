document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const byId = (id) => document.getElementById(id);

  const upgradeBtn = byId('upgradePremiumBtn');
  const upgradeInlineBtn = byId('upgradePremiumInlineBtn');
  const status = byId('subscriptionStatus');
  const currentPlan = byId('currentPlan');
  const currentMembershipStatus = byId('currentMembershipStatus');
  const membershipStatusBadge = byId('membershipStatusBadge');
  const startDateNode = byId('membershipStartDate');
  const expiryDateNode = byId('membershipExpiryDate');
  const countdown = byId('membershipCountdown');
  const premiumLockMessage = byId('premiumLockMessage');
  const renewPremiumBtn = byId('renewPremiumBtn');
  const jumpToPaymentBtn = byId('jumpToPaymentBtn');
  const paymentCard = byId('paymentSubmissionCard');
  const paymentForm = byId('paymentSubmissionForm');
  const cancelFormBtn = byId('cancelPaymentFormBtn');
  const paymentSubmitStatus = byId('paymentSubmitStatus');
  const paymentHistoryBody = byId('paymentHistoryBody');
  const tracker = byId('paymentStatusTracker');
  const trackerHint = byId('trackerHint');
  const copyUpiBtn = byId('copyUpiBtn');
  const copyUpiBtnSecondary = byId('copyUpiBtnSecondary');
  const openUpiBtn = byId('openUpiBtn');
  const upiCopyStatus = byId('upiCopyStatus');
  const upiQrImage = byId('upiQrImage');

  let runtimeUpiId = 'shuklaabhayas0-1@okicici';
  let runtimeUpiUri = '';

  const formatDate = (value) => {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString('en-IN');
  };

  const toTitleCase = (value) => {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '-';
  };

  function renderList(hostId, rows, icon = 'fa-circle-check') {
    const host = byId(hostId);
    if (!host) return;
    host.innerHTML = (rows || [])
      .map((row) => `<li><i class="fa-solid ${icon}"></i><span>${row}</span></li>`)
      .join('');
  }

  function renderHero(config) {
    byId('membershipHeroTitle').textContent = config.hero?.title || 'Membership Center';
    byId('membershipHeroSubtitle').textContent = config.hero?.subtitle || 'Upgrade for full platform access.';
    const benefits = byId('membershipHeroBenefits');
    if (benefits) {
      const rows = Array.isArray(config.hero?.highlights) ? config.hero.highlights : [];
      benefits.innerHTML = rows.map((item) => `<span><i class="fa-solid fa-sparkles"></i>${item}</span>`).join('');
    }
  }

  function renderPlans(config) {
    const free = config.plans?.free || {};
    const premium = config.plans?.premium || {};

    byId('planFreeName').textContent = free.name || 'Free Plan';
    byId('planFreeDescription').textContent = free.description || 'Start learning with core resources.';
    byId('planFreePrice').textContent = Number(free.priceInr || 0).toLocaleString('en-IN');
    byId('planFreeBilling').textContent = ` / ${free.billingLabel || 'forever'}`;
    byId('planPremiumName').textContent = premium.name || 'Premium Plan';
    byId('planPremiumDescription').textContent = premium.description || 'Full platform access for serious learners.';
    byId('planPremiumPrice').textContent = Number(premium.priceInr || 49).toLocaleString('en-IN');
    byId('planPremiumBilling').textContent = ` / ${premium.billingLabel || 'month'}`;

    byId('heroPremiumPrice').innerHTML = `Rs.${Number(premium.priceInr || 49).toLocaleString('en-IN')} <span>/ ${premium.billingLabel || 'month'}</span>`;
    byId('heroPremiumDescription').textContent = premium.description || 'Premium unlocks full platform access.';

    renderList('planFreeFeatures', Array.isArray(free.features) ? free.features : [], 'fa-check');
    renderList('planPremiumFeatures', Array.isArray(premium.features) ? premium.features : [], 'fa-circle-check');
  }

  function renderComparison(config) {
    const body = byId('planComparisonBody');
    if (!body) return;
    const featureAccess = config.featureAccess || {};
    const rows = [
      ['Notes Access', featureAccess.notesAccess?.free || 'Limited', featureAccess.notesAccess?.premium || 'Unlimited'],
      ['Mock Tests', featureAccess.mockTests?.free || '2 attempts', featureAccess.mockTests?.premium || 'Unlimited'],
      ['AI Tools', featureAccess.aiTools?.free ? 'Enabled' : 'Disabled', featureAccess.aiTools?.premium ? 'Enabled' : 'Disabled'],
      ['Certificates', featureAccess.certificates?.free ? 'Enabled' : 'Disabled', featureAccess.certificates?.premium ? 'Enabled' : 'Disabled'],
      ['Roadmap Depth', featureAccess.roadmapDepth?.free || 'Basic', featureAccess.roadmapDepth?.premium || 'Advanced'],
      ['Downloads', featureAccess.downloads?.free ? 'Enabled' : 'Disabled', featureAccess.downloads?.premium ? 'Enabled' : 'Disabled']
    ];
    body.innerHTML = rows.map((row) => `<tr><td>${row[0]}</td><td>${row[1]}</td><td>${row[2]}</td></tr>`).join('');
  }

  function setTrackerState(statusValue) {
    if (!tracker) return;
    const steps = tracker.querySelectorAll('.tracker-step');
    steps.forEach((step) => step.classList.remove('active', 'done', 'danger'));

    const map = {
      free: ['submitted'],
      pending_approval: ['submitted', 'review'],
      rejected: ['submitted'],
      active: ['submitted', 'review', 'approved', 'active'],
      expired: ['submitted', 'review', 'approved']
    };
    const activeSteps = map[statusValue] || ['submitted'];
    steps.forEach((step) => {
      if (activeSteps.includes(step.dataset.step)) step.classList.add('done');
    });

    const current =
      statusValue === 'pending_approval' ? 'review' :
      statusValue === 'active' ? 'active' :
      statusValue === 'expired' ? 'approved' :
      statusValue === 'rejected' ? 'submitted' :
      'submitted';

    const currentNode = tracker.querySelector(`[data-step="${current}"]`);
    if (currentNode) currentNode.classList.add('active');
    if (statusValue === 'rejected' && currentNode) currentNode.classList.add('danger');

    if (trackerHint) {
      if (statusValue === 'pending_approval') trackerHint.textContent = 'Payment submitted and currently under admin review.';
      else if (statusValue === 'active') trackerHint.textContent = 'Approved and activated. Premium access is now live.';
      else if (statusValue === 'rejected') trackerHint.textContent = 'Rejected. Submit a valid transaction with proof to continue.';
      else if (statusValue === 'expired') trackerHint.textContent = 'Expired. Renew premium to reactivate access.';
      else trackerHint.textContent = 'Submit payment proof to begin verification.';
    }
  }

  function renderHistory(rows) {
    if (!paymentHistoryBody) return;
    if (!rows?.length) {
      paymentHistoryBody.innerHTML = '<tr><td colspan="5" class="muted">No payments submitted yet.</td></tr>';
      return;
    }

    paymentHistoryBody.innerHTML = rows
      .map((row) => {
        const tone = row.status === 'approved' ? 'ok' : row.status === 'rejected' ? 'warn' : 'info';
        return `<tr>
          <td>${formatDate(row.payment_date || row.submitted_at)}</td>
          <td>${row.transaction_id || '-'}</td>
          <td>Rs.${Number(row.amount_inr || 0).toLocaleString('en-IN')}</td>
          <td><span class="co-admin-status ${tone}">${toTitleCase(row.status)}</span></td>
          <td>${formatDate(row.expiry_date)}</td>
        </tr>`;
      })
      .join('');
  }

  function setStatusBadge(text) {
    if (!membershipStatusBadge) return;
    membershipStatusBadge.textContent = text;
    membershipStatusBadge.className = 'membership-status-badge';
    const normalized = String(text || '').toLowerCase();
    if (normalized.includes('active')) membershipStatusBadge.classList.add('active');
    else if (normalized.includes('pending')) membershipStatusBadge.classList.add('pending');
    else if (normalized.includes('rejected')) membershipStatusBadge.classList.add('rejected');
    else if (normalized.includes('expired')) membershipStatusBadge.classList.add('expired');
    else membershipStatusBadge.classList.add('free');
  }

  function renderPaymentSettings(config, amount, durationDays) {
    const payment = config.payment || {};
    runtimeUpiId = payment.upiId || runtimeUpiId;
    byId('upiIdText').textContent = runtimeUpiId;

    const instructionRows = Array.isArray(payment.instructions) ? payment.instructions : [];
    const instructionsHost = byId('paymentInstructionsList');
    if (instructionsHost) {
      instructionsHost.innerHTML = instructionRows.map((item, index) => `<li><span>${index + 1}</span><div>${item}</div></li>`).join('');
    }

    runtimeUpiUri = `upi://pay?pa=${encodeURIComponent(runtimeUpiId)}&pn=${encodeURIComponent('College OS Premium')}&am=${Number(amount || 49)}&cu=INR&tn=${encodeURIComponent(`College OS Premium Membership ${Number(durationDays || 30)} days`)}`;

    if (payment.qrCodeImageUrl) {
      upiQrImage.src = payment.qrCodeImageUrl;
      return;
    }

    if (window.QRCode) {
      QRCode.toDataURL(runtimeUpiUri, { width: 420, margin: 1 })
        .then((url) => {
          upiQrImage.src = url;
        })
        .catch(() => {
          upiQrImage.alt = 'Unable to load QR code';
        });
    }
  }

  async function copyUpi() {
    try {
      await navigator.clipboard.writeText(runtimeUpiId);
      if (upiCopyStatus) upiCopyStatus.textContent = 'UPI ID copied. Use it in any UPI app.';
    } catch {
      if (upiCopyStatus) upiCopyStatus.textContent = 'Could not copy automatically. Please copy manually.';
    }
  }

  async function hydrateStatus() {
    if (!status) return;
    try {
      const data = await window.CollegeOSApi.getSubscription();
      const config = data.membershipConfig || {};
      const plan = data.plan === 'premium' ? (config.plans?.premium?.name || 'Premium') : (config.plans?.free?.name || 'Free');
      const membershipStatus = data.statusLabel || 'Free';

      renderHero(config);
      renderPlans(config);
      renderComparison(config);
      renderPaymentSettings(config, data.amountInr, data.billingDurationDays);

      status.textContent = `Current Plan: ${plan} | Status: ${membershipStatus}`;
      if (currentPlan) currentPlan.textContent = plan;
      if (currentMembershipStatus) currentMembershipStatus.textContent = membershipStatus;
      setStatusBadge(membershipStatus);
      if (startDateNode) startDateNode.textContent = formatDate(data.startDate);
      if (expiryDateNode) expiryDateNode.textContent = formatDate(data.expiryDate);

      if (countdown) {
        if (data.plan === 'premium' && data.status === 'active') {
          countdown.textContent = `Valid until ${formatDate(data.expiryDate)} | ${Number(data.remainingDays || 0)} day(s) remaining.`;
        } else if (data.status === 'pending_approval') {
          countdown.textContent = 'Payment submitted successfully. Waiting for admin verification.';
        } else if (data.status === 'expired') {
          countdown.textContent = 'Your premium membership has expired. Renew to continue full access.';
        } else if (data.status === 'rejected') {
          countdown.textContent = 'Last payment request was rejected. Submit valid proof to continue.';
        } else {
          countdown.textContent = `Free plan: ${Number(data.freeMockAttemptsRemaining || 0)} / ${Number(data.freeMockAttemptLimit || 2)} mock attempts remaining.`;
        }
      }

      if (premiumLockMessage) {
        if (data.status === 'active') {
          premiumLockMessage.textContent = config.payment?.supportText || 'Premium is active. Enjoy unlimited access across premium modules.';
        } else if (data.status === 'expired') {
          premiumLockMessage.textContent = 'Your premium membership has expired. Renew to continue full access.';
        } else {
          premiumLockMessage.textContent = 'Premium features unlock after admin approval.';
        }
      }

      setTrackerState(data.status);

      if (upgradeBtn) {
        if (data.plan === 'premium' && data.status === 'active') {
          upgradeBtn.innerHTML = '<i class="fa-solid fa-badge-check"></i> Premium Active';
          upgradeBtn.disabled = false;
        } else if (data.status === 'pending_approval') {
          upgradeBtn.innerHTML = '<i class="fa-solid fa-clock"></i> Pending Approval';
          upgradeBtn.disabled = true;
        } else {
          const premiumAmount = Number(data.amountInr || 49).toLocaleString('en-IN');
          upgradeBtn.innerHTML = data.status === 'expired'
            ? `<i class="fa-solid fa-rotate"></i> Renew Premium - Rs.${premiumAmount}`
            : `<i class="fa-solid fa-crown"></i> Upgrade to Premium - Rs.${premiumAmount}`;
          upgradeBtn.disabled = false;
        }
      }

      renderHistory(data.paymentHistory || []);
    } catch {
      status.textContent = 'Login to manage subscription';
    }
  }

  function openPaymentForm() {
    if (paymentCard) paymentCard.style.display = '';
    paymentCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  upgradeBtn?.addEventListener('click', openPaymentForm);
  upgradeInlineBtn?.addEventListener('click', openPaymentForm);
  renewPremiumBtn?.addEventListener('click', openPaymentForm);

  jumpToPaymentBtn?.addEventListener('click', () => {
    byId('paymentZone')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  cancelFormBtn?.addEventListener('click', () => {
    if (paymentCard) paymentCard.style.display = 'none';
  });

  paymentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!paymentSubmitStatus) return;

    try {
      paymentSubmitStatus.textContent = 'Submitting payment proof...';
      const formData = new FormData(paymentForm);
      const payload = await window.CollegeOSApi.submitPaymentRequest(formData);
      paymentSubmitStatus.textContent = payload.message || 'Payment submitted successfully. Waiting for admin verification.';
      paymentForm.reset();
      const payMethod = byId('payMethod');
      if (payMethod) payMethod.value = 'UPI';
      if (paymentCard) paymentCard.style.display = 'none';
      await hydrateStatus();
    } catch (error) {
      paymentSubmitStatus.textContent = error.message;
    }
  });

  (async () => {
    try {
      const me = await window.CollegeOSApi.getMe();
      const user = me?.user || {};
      const fullName = byId('payFullName');
      const email = byId('payEmail');
      const date = byId('payDate');
      if (fullName && user.full_name) fullName.value = user.full_name;
      if (email && user.email) email.value = user.email;
      if (date) date.value = new Date().toISOString().slice(0, 10);
    } catch {
      // Keep form editable when prefill fails.
    }
  })();

  copyUpiBtn?.addEventListener('click', copyUpi);
  copyUpiBtnSecondary?.addEventListener('click', copyUpi);
  openUpiBtn?.addEventListener('click', () => {
    if (!runtimeUpiUri) return;
    window.location.href = runtimeUpiUri;
  });

  hydrateStatus();
});
