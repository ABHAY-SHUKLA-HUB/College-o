document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const loadedScripts = new Map();

  function loadScriptOnce(src) {
    if (loadedScripts.has(src)) return loadedScripts.get(src);

    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve(existing);
          return;
        }
        existing.addEventListener('load', () => resolve(existing), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve(script);
      };
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });

    loadedScripts.set(src, promise);
    return promise;
  }

  async function ensureQrLibrary() {
    if (window.QRCode && typeof window.QRCode.toDataURL === 'function') return true;
    await loadScriptOnce('assets/vendor/qrcode/qrcode-generator.js');
    await loadScriptOnce('assets/js/qrcode-shim.js');
    return Boolean(window.QRCode && typeof window.QRCode.toDataURL === 'function');
  }

  async function ensureJsPdfLibrary() {
    if (window.jspdf?.jsPDF) return window.jspdf.jsPDF;
    await loadScriptOnce('assets/vendor/jspdf/jspdf.umd.min.js');
    return window.jspdf?.jsPDF || null;
  }

  const byId = (id) => document.getElementById(id);
  const fmtDateInput = (value) => {
    if (!value) return '';
    return new Date(value).toISOString().slice(0, 10);
  };

  const statusText = byId('portalStatusText');
  const historyBody = byId('historyTableBody');
  const statusFilters = byId('statusFilters');
  const typeFilter = byId('typeFilter');
  const historySearch = byId('historySearch');
  const issueMode = byId('issueMode');
  const selectAllRows = byId('selectAllRows');

  const state = {
    certificates: [],
    selectedCertId: null,
    selectedStudentIds: new Set(),
    selectedRows: new Set(),
    activeStatus: 'all',
    activeType: '',
    searchText: '',
    studentSearchResults: []
  };

  function setStatus(text, isError = false) {
    if (!statusText) return;
    statusText.textContent = text;
    statusText.style.color = isError ? '#b33636' : '#3d556e';
  }

  function generateRefId() {
    return `CERT-${Date.now().toString().slice(-8)}`;
  }

  function statusClass(status) {
    const map = {
      Draft: '#44607c',
      Issued: '#0f6d62',
      Verified: '#2a7d22',
      Revoked: '#952f2f'
    };
    return map[status] || '#44607c';
  }

  function readForm() {
    const mode = issueMode.value;
    const selectedStudentIds = [...state.selectedStudentIds];
    if (mode !== 'all' && selectedStudentIds.length === 0) {
      throw new Error('Failed to assign certificate: choose at least one student.');
    }

    return {
      certificateType: byId('certificateType').value.trim(),
      achievementName: byId('achievementName').value.trim(),
      scoreRank: byId('scoreRank').value.trim(),
      issueDate: byId('issueDate').value,
      certificateId: byId('certificateRefId').value.trim() || generateRefId(),
      organizationName: byId('organizationName').value.trim(),
      signatoryName: byId('signatoryName').value.trim(),
      description: byId('description').value.trim(),
      templateName: byId('templateName').value,
      selectedStudentIds,
      issueMode: mode
    };
  }

  function selectedStudentLabel() {
    if (issueMode.value === 'all') return 'All Eligible Students';
    const rows = state.studentSearchResults.filter((s) => state.selectedStudentIds.has(Number(s.id)));
    if (rows.length === 0) return `${state.selectedStudentIds.size} selected student(s)`;
    if (rows.length === 1) return rows[0].full_name;
    return `${rows[0].full_name} +${rows.length - 1} more`;
  }

  function verifyUrl(certId) {
    const apiBase = window.CollegeOSApiClient?.getApiBaseUrl?.()
      || window.API_URL
      || window.VITE_API_URL
      || 'https://college-o.onrender.com';
    return `${String(apiBase).replace(/\/$/, '')}/api/certificates/verify/${encodeURIComponent(certId || '')}`;
  }
  function formatError(error, fallback = 'Unable to complete certificate action.') {
    return window.CollegeOSApiClient?.formatErrorMessage?.(error, fallback)
      || error?.message
      || JSON.stringify(error)
      || fallback;
  }

  async function refreshPreview() {
    const certId = byId('certificateRefId').value.trim() || generateRefId();
    byId('certificateRefId').value = certId;

    byId('previewOrg').textContent = byId('organizationName').value.trim() || 'College OS Academy';
    byId('previewTitle').textContent = `${byId('certificateType').value.trim() || 'Certificate'} Certificate`;
    byId('previewStudentName').textContent = selectedStudentLabel();
    byId('previewAchievement').textContent = byId('achievementName').value.trim() || 'Achievement / Course';
    byId('previewType').textContent = byId('certificateType').value.trim() || 'Course Completion';
    byId('previewScore').textContent = byId('scoreRank').value.trim() || 'N/A';
    byId('previewDate').textContent = byId('issueDate').value || '-';
    byId('previewId').textContent = certId;
    byId('previewSignatory').textContent = byId('signatoryName').value.trim() || 'Academic Director';
    byId('verificationIdField').value = certId;

    if (window.QRCode) {
      try {
        const qrData = await QRCode.toDataURL(verifyUrl(certId), { width: 100, margin: 1 });
        byId('previewQr').src = qrData;
      } catch {
        byId('previewQr').removeAttribute('src');
      }
    } else {
      try {
        await ensureQrLibrary();
        const qrData = await QRCode.toDataURL(verifyUrl(certId), { width: 100, margin: 1 });
        byId('previewQr').src = qrData;
      } catch {
        byId('previewQr').removeAttribute('src');
      }
    }

    drawCanvas();
  }

  function drawCanvas() {
    const canvas = byId('certificateCanvas');
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#fffdf0');
    gradient.addColorStop(1, '#eef8ff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const template = byId('templateName').value;
    const borderColor = template === 'Premium' ? '#9a6b0f' : template === 'Modern' ? '#0f6d62' : template === 'College Branded' ? '#13447a' : '#1b6e4d';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 11;
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);

    const title = `${byId('certificateType').value.trim() || 'Certificate'} Certificate`;
    const org = byId('organizationName').value.trim() || 'College OS Academy';
    const student = selectedStudentLabel();

    ctx.fillStyle = '#10395f';
    ctx.font = 'bold 42px Georgia';
    ctx.fillText(org, 360, 98);
    ctx.font = 'bold 58px Georgia';
    ctx.fillText(title, 240, 176);

    ctx.fillStyle = '#35516e';
    ctx.font = '26px Arial';
    ctx.fillText('This certificate is awarded to', 420, 250);
    ctx.fillStyle = '#946000';
    ctx.font = 'bold 56px Georgia';
    ctx.fillText(student, 205, 328);

    ctx.fillStyle = '#16395f';
    ctx.font = '29px Arial';
    ctx.fillText(`Achievement: ${byId('achievementName').value.trim() || '-'}`, 190, 408);
    ctx.font = '23px Arial';
    ctx.fillText(`Issue Date: ${byId('issueDate').value || '-'}`, 190, 454);
    ctx.fillText(`Certificate ID: ${byId('certificateRefId').value || '-'}`, 190, 490);
    ctx.fillText(`Signatory: ${byId('signatoryName').value.trim() || 'Academic Director'}`, 190, 528);

    const qrImg = byId('previewQr');
    if (qrImg && qrImg.src) {
      const qrDraw = new Image();
      qrDraw.onload = () => {
        ctx.drawImage(qrDraw, 940, 330, 150, 150);
      };
      qrDraw.src = qrImg.src;
    }
  }

  function toPdf() {
    ensureJsPdfLibrary().then((jsPDF) => {
      if (!jsPDF) {
        setStatus('Failed to export PDF: library unavailable.', true);
        return;
      }
      const canvas = byId('certificateCanvas');
      const img = canvas.toDataURL('image/png');
      const doc = new jsPDF('landscape', 'pt', 'a4');
      doc.addImage(img, 'PNG', 20, 20, 802, 530);
      doc.save(`${byId('certificateRefId').value || 'certificate'}.pdf`);
    }).catch(() => {
      setStatus('Failed to export PDF: library unavailable.', true);
    });
  }

  function toImage() {
    const canvas = byId('certificateCanvas');
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${byId('certificateRefId').value || 'certificate'}.png`;
    a.click();
  }

  function renderSelectedStudents() {
    const mount = byId('selectedStudents');
    const rows = state.studentSearchResults.filter((s) => state.selectedStudentIds.has(Number(s.id)));
    mount.innerHTML = rows
      .map((student) => `<span class="tag">${student.full_name}<button type="button" data-rm="${student.id}"><i class="fa-solid fa-xmark"></i></button></span>`)
      .join('');

    mount.querySelectorAll('[data-rm]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedStudentIds.delete(Number(btn.dataset.rm));
        renderSelectedStudents();
        refreshPreview();
      });
    });
  }

  function renderStudentResults() {
    const mount = byId('studentResults');
    if (issueMode.value === 'all') {
      mount.innerHTML = '<div class="student-item">All eligible students will receive this certificate in bulk mode.</div>';
      byId('selectedStudents').innerHTML = '';
      return;
    }

    mount.innerHTML = state.studentSearchResults
      .map((student) => {
        const checked = state.selectedStudentIds.has(Number(student.id)) ? 'checked' : '';
        return `<label class="student-item"><div><strong>${student.full_name}</strong><div style="font-size:0.76rem;color:#65758a;">${student.email} | ID ${student.id}</div></div><input type="checkbox" data-student="${student.id}" ${checked} /></label>`;
      })
      .join('');

    mount.querySelectorAll('[data-student]').forEach((box) => {
      box.addEventListener('change', () => {
        const id = Number(box.dataset.student);
        if (box.checked) state.selectedStudentIds.add(id);
        else state.selectedStudentIds.delete(id);
        renderSelectedStudents();
        refreshPreview();
      });
    });

    renderSelectedStudents();
  }

  async function loadStudents(query = '') {
    try {
      const payload = await window.CollegeOSApi.adminSearchStudents(query);
      state.studentSearchResults = payload.students || [];
      renderStudentResults();
    } catch (error) {
      setStatus(error.message || 'Failed to load students.', true);
    }
  }

  function updateStats() {
    const groups = { all: 0, Draft: 0, Issued: 0, Verified: 0, Revoked: 0 };
    state.certificates.forEach((c) => {
      groups.all += 1;
      groups[c.status] = (groups[c.status] || 0) + 1;
    });
    byId('statAll').textContent = String(groups.all);
    byId('statDraft').textContent = String(groups.Draft || 0);
    byId('statIssued').textContent = String(groups.Issued || 0);
    byId('statVerified').textContent = String(groups.Verified || 0);
    byId('statRevoked').textContent = String(groups.Revoked || 0);
  }

  function populateTypeFilter() {
    const types = [...new Set(state.certificates.map((c) => c.certificate_type).filter(Boolean))].sort();
    typeFilter.innerHTML = '<option value="">By Certificate Type</option>' + types.map((type) => `<option value="${type}">${type}</option>`).join('');
    if (state.activeType) typeFilter.value = state.activeType;
  }

  function rowActions(cert) {
    return `
      <div class="row-actions">
        <button class="btn tiny secondary" data-act="edit" data-id="${cert.id}">Edit</button>
        <button class="btn tiny secondary" data-act="issue" data-id="${cert.id}">Issue</button>
        <button class="btn tiny warn" data-act="reissue" data-id="${cert.id}">Reissue</button>
        <button class="btn tiny secondary" data-act="download" data-id="${cert.id}">Download</button>
        <button class="btn tiny danger" data-act="delete" data-id="${cert.id}">Delete</button>
      </div>
    `;
  }

  function renderHistory() {
    if (!state.certificates.length) {
      historyBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:1.2rem;">No certificates found.</td></tr>';
      return;
    }

    historyBody.innerHTML = state.certificates
      .map((cert) => `
        <tr>
          <td><input type="checkbox" data-row-id="${cert.id}" ${state.selectedRows.has(Number(cert.id)) ? 'checked' : ''} /></td>
          <td>${cert.student_names || '-'}</td>
          <td>${cert.certificate_type || '-'}</td>
          <td>${cert.certificate_id || '-'}</td>
          <td>${fmtDateInput(cert.issue_date) || '-'}</td>
          <td><span class="status-pill" style="background:${statusClass(cert.status)}20;color:${statusClass(cert.status)};">${cert.status || 'Draft'}</span></td>
          <td>${rowActions(cert)}</td>
        </tr>
      `)
      .join('');

    historyBody.querySelectorAll('[data-row-id]').forEach((box) => {
      box.addEventListener('change', () => {
        const id = Number(box.dataset.rowId);
        if (box.checked) state.selectedRows.add(id);
        else state.selectedRows.delete(id);
      });
    });

    historyBody.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        const action = btn.dataset.act;
        try {
          if (action === 'edit') {
            await loadIntoForm(id);
            return;
          }
          if (action === 'issue') {
            await window.CollegeOSApi.adminIssueCertificate(id);
            setStatus('Certificate issued successfully');
          } else if (action === 'reissue') {
            await window.CollegeOSApi.adminReissueCertificate(id);
            setStatus('Certificate issued successfully');
          } else if (action === 'delete') {
            await window.CollegeOSApi.adminDeleteCertificate(id);
            setStatus('Certificate deleted successfully');
          } else if (action === 'download') {
            await loadIntoForm(id);
            toPdf();
            setStatus('Certificate downloaded successfully');
          }
          await loadHistory();
        } catch (error) {
          setStatus(error.message || 'Action failed.', true);
        }
      });
    });
  }

  async function loadHistory() {
    try {
      const payload = await window.CollegeOSApi.adminGetCertificates({
        status: state.activeStatus,
        type: state.activeType,
        search: state.searchText
      });
      state.certificates = payload.certificates || [];
      updateStats();
      populateTypeFilter();
      renderHistory();
      if (state.selectedCertId) {
        const selected = state.certificates.find((c) => Number(c.id) === Number(state.selectedCertId));
        if (selected) byId('verificationStatusPill').textContent = selected.status || 'Draft';
      }
    } catch (error) {
      historyBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1.2rem; color:#b33636;">${error.message}</td></tr>`;
    }
  }

  async function loadIntoForm(id) {
    const payload = await window.CollegeOSApi.adminGetCertificate(id);
    const cert = payload.certificate;
    state.selectedCertId = Number(id);

    byId('editingCertificateId').value = String(id);
    byId('certificateType').value = cert.certificate_type || '';
    byId('achievementName').value = cert.achievement_name || '';
    byId('scoreRank').value = cert.score_rank || '';
    byId('issueDate').value = fmtDateInput(cert.issue_date);
    byId('certificateRefId').value = cert.certificate_id || generateRefId();
    byId('organizationName').value = cert.organization_name || 'College OS Academy';
    byId('signatoryName').value = cert.signatory_name || 'Academic Director';
    byId('description').value = cert.description || '';
    byId('templateName').value = cert.template_name || 'Classic';
    byId('verificationStatusPill').textContent = cert.status || 'Draft';
    byId('verificationIdField').value = cert.certificate_id || '';

    const assigned = Array.isArray(cert.assigned_student_ids) ? cert.assigned_student_ids.map((x) => Number(x)) : [];
    state.selectedStudentIds = new Set(assigned);
    issueMode.value = cert.is_bulk ? 'all' : 'selected';

    byId('templateCards').querySelectorAll('[data-template]').forEach((item) => {
      item.classList.toggle('active', item.dataset.template === byId('templateName').value);
    });

    renderStudentResults();
    await refreshPreview();
    setStatus('Certificate loaded for editing.');
  }

  async function createOrSave(action) {
    try {
      const data = readForm();
      if (!data.certificateType || !data.achievementName || !data.issueDate) {
        throw new Error('Please complete required fields before proceeding.');
      }

      data.action = action;
      data.status = action === 'issue' ? 'Issued' : 'Draft';

      const editingId = byId('editingCertificateId').value.trim();
      if (editingId && action !== 'generate') {
        await window.CollegeOSApi.adminUpdateCertificate(Number(editingId), data);
        setStatus('Certificate updated successfully');
      } else {
        await window.CollegeOSApi.adminCreateCertificate(data);
        if (action === 'issue') setStatus('Certificate issued successfully');
        else if (action === 'generate') setStatus('Certificate generated successfully');
        else setStatus('Certificate draft saved successfully');
      }

      await loadHistory();
    } catch (error) {
      setStatus(error.message || 'Failed to assign certificate.', true);
    }
  }

  async function verifySelected() {
    if (!state.selectedCertId) {
      setStatus('Select a certificate from history to verify.', true);
      return;
    }
    try {
      await window.CollegeOSApi.adminVerifyCertificate(state.selectedCertId);
      byId('verificationStatusPill').textContent = 'Verified';
      setStatus('Certificate verified successfully');
      await loadHistory();
    } catch (error) {
      setStatus(error.message || 'Verification failed.', true);
    }
  }

  async function revokeSelected() {
    if (!state.selectedCertId) {
      setStatus('Select a certificate from history to revoke.', true);
      return;
    }
    try {
      await window.CollegeOSApi.adminRevokeCertificate(state.selectedCertId);
      byId('verificationStatusPill').textContent = 'Revoked';
      setStatus('Certificate revoked successfully');
      await loadHistory();
    } catch (error) {
      setStatus(error.message || 'Revoke failed.', true);
    }
  }

  async function runBulk(action) {
    const ids = [...state.selectedRows];
    if (!ids.length) {
      setStatus('Select one or more certificate rows for bulk action.', true);
      return;
    }
    try {
      const payload = await window.CollegeOSApi.adminBulkCertificates(action, ids);
      if (action === 'download') {
        setStatus(`Bulk download ready for ${payload.certificates?.length || 0} certificates.`);
      } else {
        setStatus(`Bulk ${action} completed successfully.`);
      }
      await loadHistory();
    } catch (error) {
      setStatus(error.message || `Bulk ${action} failed.`, true);
    }
  }

  async function guardAdmin() {
    try {
      const me = await window.CollegeOSApi.getMe();
      if (!me?.user || me.user.role !== 'admin') {
        window.location.href = 'admin-login.html';
        return false;
      }
      return true;
    } catch {
      window.location.href = 'admin-login.html';
      return false;
    }
  }

  function bindTemplateCards() {
    byId('templateCards').querySelectorAll('[data-template]').forEach((card) => {
      card.addEventListener('click', () => {
        byId('templateName').value = card.dataset.template;
        byId('templateCards').querySelectorAll('[data-template]').forEach((x) => x.classList.remove('active'));
        card.classList.add('active');
        refreshPreview();
      });
    });
  }

  function bindInputs() {
    ['certificateType', 'achievementName', 'scoreRank', 'issueDate', 'certificateRefId', 'organizationName', 'signatoryName'].forEach((id) => {
      byId(id).addEventListener('input', refreshPreview);
    });
    byId('description').addEventListener('input', () => {
      setStatus('Draft changes updated locally.');
    });

    issueMode.addEventListener('change', () => {
      if (issueMode.value === 'all') {
        state.selectedStudentIds.clear();
      }
      renderStudentResults();
      refreshPreview();
    });

    let studentSearchTimer = null;
    byId('studentSearchInput').addEventListener('input', (event) => {
      clearTimeout(studentSearchTimer);
      studentSearchTimer = setTimeout(() => {
        loadStudents(event.target.value.trim());
      }, 260);
    });

    let historyTimer = null;
    historySearch.addEventListener('input', (event) => {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(() => {
        state.searchText = event.target.value.trim();
        loadHistory();
      }, 280);
    });

    statusFilters.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeStatus = btn.dataset.status;
        statusFilters.querySelectorAll('[data-status]').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        loadHistory();
      });
    });

    typeFilter.addEventListener('change', () => {
      state.activeType = typeFilter.value;
      loadHistory();
    });

    selectAllRows.addEventListener('change', () => {
      if (selectAllRows.checked) {
        state.selectedRows = new Set(state.certificates.map((c) => Number(c.id)));
      } else {
        state.selectedRows.clear();
      }
      renderHistory();
    });

    byId('refreshHistoryBtn').addEventListener('click', loadHistory);

    byId('previewBtn').addEventListener('click', async () => {
      await refreshPreview();
      setStatus('Live preview updated successfully.');
    });
    byId('generateBtn').addEventListener('click', () => createOrSave('generate'));
    byId('saveDraftBtn').addEventListener('click', () => createOrSave('draft'));
    byId('updateCertBtn').addEventListener('click', () => createOrSave('update'));
    byId('issueCertBtn').addEventListener('click', () => createOrSave('issue'));

    byId('downloadPdfBtn').addEventListener('click', () => {
      toPdf();
      setStatus('Certificate PDF downloaded successfully.');
    });
    byId('downloadImageBtn').addEventListener('click', () => {
      toImage();
      setStatus('Certificate image downloaded successfully.');
    });

    const copyLink = async () => {
      const certId = byId('certificateRefId').value.trim();
      if (!certId) {
        setStatus('Generate a certificate ID before copying link.', true);
        return;
      }
      try {
        await navigator.clipboard.writeText(verifyUrl(certId));
        setStatus('Verification link copied successfully.');
      } catch {
        setStatus('Failed to copy verification link.', true);
      }
    };
    byId('copyVerificationBtn').addEventListener('click', copyLink);
    byId('copyVerifyLinkBtn').addEventListener('click', copyLink);

    byId('verifyCertBtn').addEventListener('click', verifySelected);
    byId('revokeCertBtn').addEventListener('click', revokeSelected);

    byId('bulkIssueBtn').addEventListener('click', () => runBulk('issue'));
    byId('bulkDownloadBtn').addEventListener('click', () => runBulk('download'));
    byId('bulkVerifyBtn').addEventListener('click', () => runBulk('verify'));
    byId('bulkRevokeBtn').addEventListener('click', () => runBulk('revoke'));
  }

  async function init() {
    if (!(await guardAdmin())) return;

    byId('issueDate').value = new Date().toISOString().slice(0, 10);
    byId('certificateRefId').value = generateRefId();

    bindTemplateCards();
    bindInputs();

    await loadStudents('');
    await refreshPreview();
    await loadHistory();
  }

  init();
});
