document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const byId = (id) => document.getElementById(id);
  const certGrid = byId('myCertificatesGrid');
  const recentGrid = byId('recentAchievementsGrid');
  const searchInput = byId('certSearchInput');
  const filterWrap = byId('certTypeFilters');
  const modal = byId('certificateModal');
  const closeModalBtn = byId('closeCertModalBtn');

  const preview = byId('certificatePreview');
  const qrVerification = byId('certQr');
  const qrInline = byId('certQrInline');
  const canvas = byId('certificateCanvas');
  const ctx = canvas?.getContext('2d');

  const verifyIdField = byId('verifyIdField');
  const verifyStatusBadge = byId('verifyStatusBadge');
  const actionStatus = byId('certActionStatus');

  const statTotal = byId('statTotalCertificates');
  const statCourses = byId('statCoursesCompleted');
  const statMocks = byId('statMockAwards');
  const statLearning = byId('statLearningAchievements');

  const state = {
    certificates: [],
    filtered: [],
    activeFilter: 'all',
    search: '',
    selected: null,
    studentName: 'Student Name'
  };

  function setStatus(text) {
    if (actionStatus) actionStatus.textContent = text;
  }

  function safeType(type) {
    return String(type || 'Achievement').trim();
  }

  function mapCategory(type) {
    const value = safeType(type).toLowerCase();
    if (value.includes('course')) return 'course';
    if (value.includes('subject')) return 'subject';
    if (value.includes('mock')) return 'mock';
    if (value.includes('streak')) return 'streak';
    return 'other';
  }

  function achievementIcon(type) {
    const value = safeType(type).toLowerCase();
    if (value.includes('course')) return 'fa-book-open-reader';
    if (value.includes('subject')) return 'fa-flask-vial';
    if (value.includes('mock')) return 'fa-trophy';
    if (value.includes('streak')) return 'fa-fire';
    return 'fa-star';
  }

  function verifyUrl(code) {
    const apiBase = window.CollegeOSApiClient?.getApiBaseUrl?.()
      || window.API_URL
      || window.VITE_API_URL
      || 'https://college-o.onrender.com';
    return `${String(apiBase).replace(/\/$/, '')}/api/certificates/verify/${encodeURIComponent(code)}`;
  }

  function formatError(error, fallback = 'Unable to complete certificate action.') {
    return window.CollegeOSApiClient?.formatErrorMessage?.(error, fallback)
      || error?.message
      || JSON.stringify(error)
      || fallback;
  }

  function formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-IN');
  }

  function updateStats(list) {
    const total = list.length;
    const courses = list.filter((x) => mapCategory(x.type) === 'course').length;
    const mocks = list.filter((x) => mapCategory(x.type) === 'mock').length;
    const learning = total - mocks;

    if (statTotal) statTotal.textContent = String(total);
    if (statCourses) statCourses.textContent = String(courses);
    if (statMocks) statMocks.textContent = String(mocks);
    if (statLearning) statLearning.textContent = String(Math.max(learning, 0));
  }

  function setPreviewCertificate(cert) {
    if (!cert || !preview) return;

    const certType = safeType(cert.type);
    const org = cert.organization || 'College OS Academy';
    const signatory = cert.signatory || 'Academic Director';
    const certTitle = cert.title || 'Certificate of Achievement';
    const achievement = cert.achievement || certType;
    const certId = cert.verification_code || cert.certificate_id || '-';

    preview.querySelector('[data-cert-org]').textContent = org;
    preview.querySelector('[data-cert-name]').textContent = cert.student_name || state.studentName;
    preview.querySelector('[data-cert-achievement]').textContent = achievement;
    preview.querySelector('[data-cert-type]').textContent = certType;
    preview.querySelector('[data-cert-score]').textContent = cert.score || 'Awarded';
    preview.querySelector('[data-cert-date]').textContent = formatDate(cert.issued_date);
    preview.querySelector('[data-cert-id]').textContent = certId;
    preview.querySelector('[data-cert-signatory]').textContent = signatory;
    preview.querySelector('[data-cert-signatory-line]').textContent = signatory;

    if (verifyIdField) verifyIdField.value = certId;

    const qrValue = verifyUrl(certId);
    if (window.QRCode) {
      QRCode.toDataURL(qrValue, { width: 110 }).then((url) => {
        if (qrVerification) qrVerification.src = url;
        if (qrInline) qrInline.src = url;
        drawCanvas({ certTitle, org, signatory, certId, certType, achievement, cert, qrUrl: url });
      });
    } else {
      drawCanvas({ certTitle, org, signatory, certId, certType, achievement, cert, qrUrl: '' });
    }
  }

  function drawCanvas(payload) {
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#fff7de');
    grad.addColorStop(1, '#eef8ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#1f7f55';
    ctx.lineWidth = 10;
    ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);

    ctx.fillStyle = '#0d3a2f';
    ctx.font = 'bold 42px Georgia';
    ctx.fillText(payload.org, 350, 90);
    ctx.font = 'bold 54px Georgia';
    ctx.fillText(payload.certTitle, 230, 155);

    ctx.font = '25px Arial';
    ctx.fillText('This is to certify that', 420, 220);
    ctx.fillStyle = '#8b6f00';
    ctx.font = 'bold 52px Arial';
    ctx.fillText(payload.cert.student_name || state.studentName, 250, 295);

    ctx.fillStyle = '#0d3a2f';
    ctx.font = '28px Arial';
    ctx.fillText(`Achievement: ${payload.achievement}`, 190, 360);
    ctx.font = '22px Arial';
    ctx.fillText(`Type: ${payload.certType}`, 190, 400);
    ctx.fillText(`Issue Date: ${formatDate(payload.cert.issued_date)}`, 190, 435);
    ctx.fillText(`Certificate ID: ${payload.certId}`, 190, 470);
    ctx.fillText(`Signed by: ${payload.signatory}`, 190, 510);

    ctx.save();
    ctx.translate(900, 470);
    ctx.rotate(-0.2);
    ctx.beginPath();
    ctx.arc(0, 0, 58, 0, Math.PI * 2);
    ctx.strokeStyle = '#b14b00';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = '#b14b00';
    ctx.fillText('OFFICIAL', -26, -5);
    ctx.fillText('SEAL', -15, 14);
    ctx.restore();

    if (payload.qrUrl) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 910, 340, 140, 140);
      img.src = payload.qrUrl;
    }
  }

  function renderRecent(list) {
    if (!recentGrid) return;
    const recent = list.slice(0, 4);
    if (!recent.length) {
      recentGrid.innerHTML = '<div class="empty-state-modern">No recent achievements yet.</div>';
      return;
    }

    recentGrid.innerHTML = recent
      .map((cert) => `
        <article class="recent-card">
          <strong><i class="fa-solid ${achievementIcon(cert.type)}"></i> ${safeType(cert.type)}</strong>
          <p class="muted" style="margin:0.4rem 0 0;">${formatDate(cert.issued_date)} | ${cert.verification_code}</p>
        </article>
      `)
      .join('');
  }

  function cardActions(cert) {
    return `
      <div class="cert-actions">
        <button class="btn primary" data-action="view" data-id="${cert.id}"><i class="fa-regular fa-eye"></i> View Certificate</button>
        <button class="btn secondary" data-action="pdf" data-id="${cert.id}"><i class="fa-solid fa-file-pdf"></i> Download PDF</button>
        <button class="btn secondary" data-action="img" data-id="${cert.id}"><i class="fa-solid fa-image"></i> Download Image</button>
        <button class="btn warn" data-action="linkedin" data-id="${cert.id}"><i class="fa-brands fa-linkedin"></i> Share LinkedIn</button>
        <button class="btn secondary" data-action="copy" data-id="${cert.id}"><i class="fa-regular fa-copy"></i> Copy Verification Link</button>
      </div>
    `;
  }

  function renderCertificates(list) {
    if (!certGrid) return;
    if (!list.length) {
      certGrid.innerHTML = '<div class="empty-state-modern">No certificates earned yet. Complete courses or achieve milestones to earn your first certificate.</div>';
      return;
    }

    certGrid.innerHTML = list
      .map((cert) => `
        <article class="cert-card">
          <div class="thumb">
            <strong><i class="fa-solid ${achievementIcon(cert.type)}"></i> ${safeType(cert.type)}</strong>
            <p class="muted" style="margin:0.4rem 0 0;">${cert.title || 'Certificate of Achievement'}</p>
            <p class="muted" style="margin:0.2rem 0 0;">Issued by ${cert.organization || 'College OS Academy'}</p>
          </div>

          <div>
            <h4 style="margin:0;">${cert.title || 'Certificate of Achievement'}</h4>
            <p class="muted" style="margin:0.2rem 0 0;">${safeType(cert.type)}</p>
          </div>

          <div class="cert-meta">
            <div class="box"><strong>Issue Date</strong><br>${formatDate(cert.issued_date)}</div>
            <div class="box"><strong>Issued By</strong><br>${cert.organization || 'College OS Academy'}</div>
            <div class="box"><strong>Certificate ID</strong><br>${cert.verification_code || '-'}</div>
            <div class="box"><strong>Status</strong><br>${cert.status || 'Valid'}</div>
          </div>

          ${cardActions(cert)}
        </article>
      `)
      .join('');

    certGrid.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const cert = state.certificates.find((x) => String(x.id) === String(button.dataset.id));
        if (!cert) return;

        const action = button.dataset.action;
        if (action === 'view') {
          state.selected = cert;
          setPreviewCertificate(cert);
          modal?.classList.add('open');
          return;
        }

        if (action === 'pdf') {
          await downloadPdf(cert);
          return;
        }

        if (action === 'img') {
          await downloadImage(cert);
          return;
        }

        if (action === 'linkedin') {
          shareLinkedIn(cert);
          return;
        }

        if (action === 'copy') {
          copyVerificationLink(cert);
        }
      });
    });
  }

  function applyFiltersAndSearch() {
    const q = state.search.trim().toLowerCase();
    state.filtered = state.certificates.filter((cert) => {
      const category = mapCategory(cert.type);
      const passesFilter = state.activeFilter === 'all' || state.activeFilter === category;
      const text = `${cert.title || ''} ${cert.verification_code || ''} ${cert.type || ''}`.toLowerCase();
      const passesSearch = !q || text.includes(q);
      return passesFilter && passesSearch;
    });

    updateStats(state.filtered);
    renderCertificates(state.filtered);
    renderRecent(state.filtered);
  }

  function bindToolbar() {
    searchInput?.addEventListener('input', (event) => {
      state.search = event.target.value || '';
      applyFiltersAndSearch();
    });

    filterWrap?.querySelectorAll('[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.activeFilter = chip.dataset.filter || 'all';
        filterWrap.querySelectorAll('[data-filter]').forEach((x) => x.classList.remove('active'));
        chip.classList.add('active');
        applyFiltersAndSearch();
      });
    });
  }

  async function copyVerificationLink(cert) {
    const code = cert?.verification_code || state.selected?.verification_code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(verifyUrl(code));
      setStatus('Verification link copied.');
    } catch {
      setStatus('Could not copy verification link.');
    }
  }

  function shareLinkedIn(cert) {
    const title = cert?.title || 'My Certificate';
    const text = encodeURIComponent(`Proud to share my achievement: ${title}`);
    window.open(`https://www.linkedin.com/feed/?shareActive=true&text=${text}`, '_blank');
    setStatus('LinkedIn share dialog opened.');
  }

  async function downloadPdf(cert) {
    state.selected = cert;
    setPreviewCertificate(cert);

    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      setStatus('PDF library not loaded.');
      return;
    }

    const doc = new jsPDF('landscape');
    doc.setFontSize(20);
    doc.text(cert.title || 'Certificate of Achievement', 14, 20);
    doc.setFontSize(13);
    doc.text(`Awarded to: ${cert.student_name || state.studentName}`, 14, 35);
    doc.text(`Type: ${safeType(cert.type)}`, 14, 45);
    doc.text(`Issue Date: ${formatDate(cert.issued_date)}`, 14, 55);
    doc.text(`Verification ID: ${cert.verification_code || '-'}`, 14, 65);
    doc.save(`certificate-${cert.id || 'download'}.pdf`);
    setStatus('Certificate PDF downloaded.');
  }

  async function downloadImage(cert) {
    state.selected = cert;
    setPreviewCertificate(cert);
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `certificate-${cert.id || 'image'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    setStatus('Certificate image downloaded.');
  }

  async function verifySelectedCertificate() {
    const code = (verifyIdField?.value || state.selected?.verification_code || '').trim();
    if (!code) {
      setStatus('No certificate selected for verification.');
      return;
    }
    try {
      const res = await fetch(verifyUrl(code), { credentials: 'include' });
      const payload = await res.json();
      const valid = Boolean(payload?.valid);
      if (verifyStatusBadge) verifyStatusBadge.textContent = valid ? 'Verified' : 'Invalid';
      setStatus(valid ? 'Certificate is valid and verified.' : 'Certificate verification failed.');
    } catch (error) {
      setStatus(formatError(error, 'Verification request failed.'));
    }
  }

  async function loadCertificates() {
    try {
      const me = await window.CollegeOSApi.getMe();
      state.studentName = me?.user?.full_name || state.studentName;
    } catch {
      // Keep fallback name.
    }

    try {
      const { certificates } = await window.CollegeOSApi.getCertificates();
      state.certificates = (certificates || []).map((c) => ({
        ...c,
        title: c.title || 'Certificate of Achievement',
        achievement: c.achievement || safeType(c.type),
        organization: c.organization || 'College OS Academy',
        signatory: c.signatory || 'Academic Director'
      }));

      applyFiltersAndSearch();

      if (state.certificates[0]) {
        state.selected = state.certificates[0];
        setPreviewCertificate(state.selected);
      } else if (verifyStatusBadge) {
        verifyStatusBadge.textContent = 'No Certificate';
      }
    } catch (error) {
      certGrid.innerHTML = `<div class="empty-state-modern">${formatError(error, 'Failed to load certificates.')}</div>`;
    }
  }

  byId('verifyCertBtn')?.addEventListener('click', verifySelectedCertificate);
  byId('copyVerifyLinkBtn')?.addEventListener('click', () => copyVerificationLink(state.selected));

  byId('downloadPdfBtn')?.addEventListener('click', () => {
    if (!state.selected) return;
    downloadPdf(state.selected);
  });
  byId('downloadImageBtn')?.addEventListener('click', () => {
    if (!state.selected) return;
    downloadImage(state.selected);
  });
  byId('shareLinkedInBtn')?.addEventListener('click', () => {
    if (!state.selected) return;
    shareLinkedIn(state.selected);
  });
  byId('copyLinkBtn')?.addEventListener('click', () => copyVerificationLink(state.selected));

  closeModalBtn?.addEventListener('click', () => modal?.classList.remove('open'));
  modal?.addEventListener('click', (event) => {
    if (event.target === modal) modal.classList.remove('open');
  });

  bindToolbar();
  loadCertificates();

  window.addEventListener('collegeos:realtime', (event) => {
    const type = event?.detail?.type;
    if (type !== 'certificate_updated' && type !== 'content_changed') return;
    loadCertificates();
  });
});
