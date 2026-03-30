document.addEventListener('DOMContentLoaded', () => {
  if (!window.CollegeOSApi) return;

  const byId = (id) => document.getElementById(id);

  function htmlEscape(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function riskClass(risk) {
    const level = String(risk || 'medium').toLowerCase();
    if (level === 'high') return 'risk-high';
    if (level === 'low') return 'risk-low';
    return 'risk-medium';
  }

  function setStatus(id, text, isError = false) {
    const node = byId(id);
    if (!node) return;
    node.textContent = text;
    node.style.color = isError ? '#b43a3a' : '#5a6f84';
  }

  function roleOptions(selected) {
    const roles = [
      { value: 'regular_student', label: 'Regular Student' },
      { value: 'campus_reporter', label: 'Campus Reporter' },
      { value: 'verified_contributor', label: 'Verified Contributor' }
    ];
    return roles.map((role) => `<option value="${role.value}"${role.value === selected ? ' selected' : ''}>${role.label}</option>`).join('');
  }

  function trustOptions(selected) {
    const trustLevels = ['new', 'trusted', 'verified'];
    return trustLevels.map((level) => `<option value="${level}"${level === selected ? ' selected' : ''}>${level}</option>`).join('');
  }

  function renderColleges(colleges) {
    const filter = byId('moderationCollegeFilter');
    const official = byId('officialCollegeId');
    if (!filter || !official) return;

    const options = ['<option value="">All Colleges</option>']
      .concat((colleges || []).map((college) => `<option value="${college.id}">${htmlEscape(college.name)}</option>`))
      .join('');
    filter.innerHTML = options;

    const officialOptions = ['<option value="">Select college</option>']
      .concat((colleges || []).map((college) => `<option value="${college.id}">${htmlEscape(college.name)}</option>`))
      .join('');
    official.innerHTML = officialOptions;
  }

  function renderAnalytics(payload) {
    const overview = payload?.overview || {};
    byId('metricPending').textContent = Number(overview.pending_posts || 0);
    byId('metricApproved').textContent = Number(overview.approved_posts || 0);
    byId('metricFlagged').textContent = Number(overview.rejected_posts || 0);
    byId('metricPoints').textContent = Number(overview.points_distributed || 0);

    const topPosts = byId('analyticsTopPosts');
    const topCreators = byId('analyticsTopCreators');
    const suspicious = byId('analyticsSuspicious');

    topPosts.innerHTML = (payload?.topPosts || []).map((post) => `<li>${htmlEscape(post.title)} - ${htmlEscape(post.college_name)} (Q ${Number(post.quality_score || 0).toFixed(1)})</li>`).join('') || '<li>No data</li>';
    topCreators.innerHTML = (payload?.topCreators || []).map((creator) => `<li>${htmlEscape(creator.full_name)} - ${htmlEscape(creator.college_name)} (${creator.total_points} pts)</li>`).join('') || '<li>No data</li>';
    suspicious.innerHTML = (payload?.suspiciousSignals || []).map((signal) => `<li>${htmlEscape(signal.event_type)} (${signal.total})</li>`).join('') || '<li>No suspicious activity</li>';
  }

  async function applyCardAction(card, action, button) {
    const postId = Number(card?.dataset.postId);
    const authorId = Number(card?.dataset.authorId);
    if (!Number.isInteger(postId)) return;

    if (action === 'approve') {
      await window.CollegeOSApi.adminCampusModeratePost(postId, 'approve', '');
    } else if (action === 'reject') {
      const reason = window.prompt('Reason for rejection (shown to creator):', '') || '';
      await window.CollegeOSApi.adminCampusModeratePost(postId, 'reject', reason);
    } else if (action === 'feature') {
      const shouldFeature = button.textContent.trim().toLowerCase() !== 'unfeature';
      await window.CollegeOSApi.adminCampusFeaturePost(postId, shouldFeature);
    } else if (action === 'role') {
      const role = card.querySelector(`[data-role-select="${authorId}"]`)?.value;
      await window.CollegeOSApi.adminCampusAssignCreatorRole(authorId, role);
    } else if (action === 'trust') {
      const trustLevel = card.querySelector(`[data-trust-select="${authorId}"]`)?.value;
      const role = card.querySelector(`[data-role-select="${authorId}"]`)?.value;
      await window.CollegeOSApi.adminCampusUpdateCreatorTrust(authorId, trustLevel, role);
    } else if (action === 'suspend') {
      const suspend = button.dataset.state !== 'suspended';
      const reason = suspend ? (window.prompt('Suspension reason:', '') || '') : '';
      const hours = suspend ? Number(window.prompt('Suspend for hours (optional):', '48') || 0) : 0;
      const until = suspend && hours > 0 ? new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString() : '';
      await window.CollegeOSApi.adminCampusSetCreatorSuspension(authorId, suspend, reason, until);
    } else if (action === 'points') {
      const actionTypeInput = String(window.prompt('Action type (add/remove/bonus/fraud_correction):', 'add') || '').trim().toLowerCase();
      const allowed = new Set(['add', 'remove', 'bonus', 'fraud_correction']);
      if (!allowed.has(actionTypeInput)) return;
      const amount = Number(window.prompt('Amount (positive integer):', '5') || 0);
      if (!Number.isInteger(amount) || amount <= 0) return;
      const reason = window.prompt('Reason for points adjustment:', 'Manual moderation adjustment') || '';
      await window.CollegeOSApi.adminCampusAdjustCreatorPoints(authorId, amount, actionTypeInput, reason);
    } else if (action === 'edit') {
      const title = window.prompt('Edit title:', card.dataset.title || '');
      const description = window.prompt('Edit description:', card.dataset.description || '');
      const adminNotes = window.prompt('Admin review notes:', card.dataset.adminNotes || '');
      if (!title || !description) return;
      await window.CollegeOSApi.adminCampusUpdatePost(postId, { title, description, adminNotes });
    } else if (action === 'official') {
      const important = window.confirm('Mark as important/urgent too?');
      await window.CollegeOSApi.adminCampusMarkOfficial(postId, true, important);
    }
  }

  function renderQueue(posts) {
    const mount = byId('moderationQueueList');
    if (!mount) return;

    if (!posts.length) {
      mount.innerHTML = '<div class="empty-state">No posts in this moderation filter.</div>';
      return;
    }

    mount.innerHTML = posts.map((post) => `
      <article class="queue-item" data-post-id="${post.id}" data-author-id="${post.author_id}" data-title="${htmlEscape(post.title)}" data-description="${htmlEscape(post.description)}" data-admin-notes="${htmlEscape(post.admin_notes || '')}">
        <div style="display:flex; justify-content:space-between; gap:.7rem; align-items:flex-start;">
          <div>
            <strong>${htmlEscape(post.title)}</strong>
            <div class="queue-meta">
              <span class="chip">${htmlEscape(post.college_name)}</span>
              <span class="chip">${htmlEscape(post.author_name)} (${htmlEscape(post.trust_level)})</span>
              <span class="chip">Role: ${htmlEscape(String(post.campus_role || 'regular_student').replace(/_/g, ' '))}</span>
              <span class="chip ${riskClass(post.moderation_risk)}">Risk: ${htmlEscape(post.moderation_risk)}</span>
              <span class="chip">Reports: ${Number(post.pending_reports || 0)}</span>
              <span class="chip">Flags: ${Number(post.security_flags || 0)}</span>
              <span class="chip">${htmlEscape(post.post_type)} / ${htmlEscape(post.category)}</span>
              <span class="chip">${new Date(post.created_at).toLocaleString('en-IN')}</span>
              <span class="chip">Suspended: ${post.posting_suspended ? 'Yes' : 'No'}</span>
            </div>
          </div>
          <span class="chip">${htmlEscape(post.moderation_status)}</span>
        </div>
        <p style="margin:.5rem 0 0; color:#40586f;">${htmlEscape(post.description)}</p>
        ${post.moderation_reason ? `<p style="margin:.35rem 0 0; color:#8a5c00; font-size:.84rem;"><strong>Moderation note:</strong> ${htmlEscape(post.moderation_reason)}</p>` : ''}
        ${post.admin_notes ? `<p style="margin:.2rem 0 0; color:#435f7b; font-size:.84rem;"><strong>Admin notes:</strong> ${htmlEscape(post.admin_notes)}</p>` : ''}
        ${post.media_url ? `<a class="btn secondary sm" style="margin-top:.45rem;" href="${htmlEscape(post.media_url)}" target="_blank" rel="noreferrer">Open Media</a>` : ''}
        <div class="queue-actions">
          <button class="btn primary sm" data-action="approve">Approve</button>
          <button class="btn warn sm" data-action="reject">Reject</button>
          <button class="btn secondary sm" data-action="edit">Edit</button>
          <button class="btn secondary sm" data-action="official">Mark Official</button>
          <button class="btn secondary sm" data-action="feature">${post.is_featured ? 'Unfeature' : 'Feature'}</button>
          <select data-role-select="${post.author_id}" style="border:1px solid #d1deeb; border-radius:8px; padding:.25rem .45rem;">${roleOptions(post.campus_role)}</select>
          <select data-trust-select="${post.author_id}" style="border:1px solid #d1deeb; border-radius:8px; padding:.25rem .45rem;">${trustOptions(post.trust_level)}</select>
          <button class="btn secondary sm" data-action="role">Set Role</button>
          <button class="btn secondary sm" data-action="trust">Set Trust</button>
          <button class="btn warn sm" data-action="suspend" data-state="${post.posting_suspended ? 'suspended' : 'active'}">${post.posting_suspended ? 'Restore Posting' : 'Suspend Posting'}</button>
          <button class="btn secondary sm" data-action="points">Adjust Points</button>
        </div>
      </article>
    `).join('');

    mount.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('[data-post-id]');
        const action = button.dataset.action;
        if (!card || !action) return;
        try {
          await applyCardAction(card, action, button);
          await Promise.all([loadModerationQueue(), loadReports(), loadAnalytics()]);
        } catch (error) {
          setStatus('moderationStatusText', error.message || 'Moderation action failed', true);
        }
      });
    });
  }

  function renderReports(reports) {
    const mount = byId('reportQueueList');
    if (!mount) return;

    if (!reports.length) {
      mount.innerHTML = '<div class="empty-state">No reports in this status filter.</div>';
      return;
    }

    mount.innerHTML = reports.map((report) => `
      <article class="report-card" data-report-id="${report.id}">
        <div style="display:flex; justify-content:space-between; gap:.5rem; align-items:flex-start;">
          <strong>${htmlEscape(report.post_title || 'Post')}</strong>
          <span class="chip">${htmlEscape(report.status)}</span>
        </div>
        <div class="queue-meta" style="margin-top:.3rem;">
          <span class="chip">${htmlEscape(report.college_name || '-')}</span>
          <span class="chip">Reason: ${htmlEscape(report.reason)}</span>
          <span class="chip">Reporter: ${htmlEscape(report.reporter_name)}</span>
          <span class="chip">${new Date(report.created_at).toLocaleString('en-IN')}</span>
        </div>
        ${report.details ? `<p style="margin:.4rem 0 0;">${htmlEscape(report.details)}</p>` : ''}
        <div class="queue-actions">
          <select data-post-action style="border:1px solid #d1deeb; border-radius:8px; padding:.25rem .45rem;">
            <option value="none">No Post Action</option>
            <option value="reject">Reject Post</option>
            <option value="approve">Approve Post</option>
            <option value="remove">Remove From Highlights</option>
          </select>
          <input data-points-delta type="number" step="1" value="0" style="width:110px; border:1px solid #d1deeb; border-radius:8px; padding:.25rem .45rem;" placeholder="Points" />
          <button class="btn primary sm" data-report-action="resolved">Resolve</button>
          <button class="btn secondary sm" data-report-action="dismissed">Dismiss</button>
        </div>
      </article>
    `).join('');

    mount.querySelectorAll('[data-report-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const card = button.closest('[data-report-id]');
        const reportId = Number(card?.dataset.reportId);
        const action = button.dataset.reportAction;
        if (!Number.isInteger(reportId) || !action) return;

        try {
          const postAction = card.querySelector('[data-post-action]')?.value || 'none';
          const pointsDelta = Number(card.querySelector('[data-points-delta]')?.value || 0);
          await window.CollegeOSApi.adminCampusResolveReport(reportId, action, postAction, pointsDelta);
          await Promise.all([loadReports(), loadModerationQueue(), loadAnalytics()]);
        } catch (error) {
          setStatus('moderationStatusText', error.message || 'Failed to resolve report', true);
        }
      });
    });
  }

  async function loadModerationQueue() {
    const status = byId('moderationStatusFilter').value;
    const collegeId = byId('moderationCollegeFilter').value;
    const search = byId('moderationSearch').value.trim();

    setStatus('moderationStatusText', 'Loading moderation queue...');
    try {
      const payload = await window.CollegeOSApi.adminCampusFeedModeration({ status, collegeId, search, limit: 120 });
      renderColleges(payload?.colleges || []);
      renderQueue(payload?.posts || []);
      setStatus('moderationStatusText', `Loaded ${payload?.posts?.length || 0} posts.`);
    } catch (error) {
      setStatus('moderationStatusText', error.message || 'Failed to load moderation queue', true);
      byId('moderationQueueList').innerHTML = `<div class="empty-state">${htmlEscape(error.message || 'Unable to load posts')}</div>`;
      if ((error.message || '').toLowerCase().includes('admin')) {
        window.location.href = 'admin-login.html';
      }
    }
  }

  async function loadReports() {
    const status = byId('reportStatusFilter').value;
    try {
      const payload = await window.CollegeOSApi.adminCampusReports(status, 120);
      renderReports(payload?.reports || []);
    } catch (error) {
      byId('reportQueueList').innerHTML = `<div class="empty-state">${htmlEscape(error.message || 'Unable to load reports')}</div>`;
    }
  }

  async function loadAnalytics() {
    try {
      const payload = await window.CollegeOSApi.adminCampusAnalytics();
      renderAnalytics(payload);
    } catch (error) {
      byId('analyticsTopPosts').innerHTML = `<li>${htmlEscape(error.message || 'Unable to load analytics')}</li>`;
    }
  }

  function bindFilters() {
    byId('moderationRefreshBtn')?.addEventListener('click', () => Promise.all([loadModerationQueue(), loadAnalytics()]));
    byId('analyticsRefreshBtn')?.addEventListener('click', loadAnalytics);
    byId('moderationStatusFilter')?.addEventListener('change', loadModerationQueue);
    byId('moderationCollegeFilter')?.addEventListener('change', loadModerationQueue);
    byId('reportStatusFilter')?.addEventListener('change', loadReports);
    byId('refreshReportsBtn')?.addEventListener('click', loadReports);

    let timer = null;
    byId('moderationSearch')?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(loadModerationQueue, 250);
    });
  }

  function bindOfficialPostForm() {
    const form = byId('officialPostForm');
    if (!form) return;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusNode = byId('officialPostStatus');
      statusNode.style.color = '#5a6f84';
      statusNode.textContent = 'Publishing official post...';

      const formData = new FormData();
      formData.append('collegeId', byId('officialCollegeId').value);
      formData.append('postType', byId('officialPostType').value);
      formData.append('category', byId('officialCategory').value);
      formData.append('title', byId('officialTitle').value.trim());
      formData.append('description', byId('officialDescription').value.trim());
      formData.append('tags', byId('officialTags').value.trim());
      formData.append('eventStartsAt', byId('officialEventAt').value || '');
      formData.append('eventVenue', byId('officialEventVenue').value.trim());
      formData.append('pollEndsAt', byId('officialPollEndsAt').value || '');
      formData.append('pollOptions', byId('officialPollOptions').value.trim());
      formData.append('isUrgent', String(Boolean(byId('officialUrgent').checked)));
      const file = byId('officialMedia').files?.[0];
      if (file) formData.append('media', file);

      try {
        await window.CollegeOSApi.adminCampusCreateOfficialPost(formData);
        statusNode.style.color = '#1f7b47';
        statusNode.textContent = 'Official post published successfully.';
        form.reset();
        await Promise.all([loadModerationQueue(), loadAnalytics()]);
      } catch (error) {
        statusNode.style.color = '#b43a3a';
        statusNode.textContent = error.message || 'Failed to publish official post.';
      }
    });
  }

  bindFilters();
  bindOfficialPostForm();
  Promise.all([loadModerationQueue(), loadReports(), loadAnalytics()]);
});
