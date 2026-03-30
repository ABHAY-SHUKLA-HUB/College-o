(function () {
  'use strict';

  const state = {
    threads: [],
    featureConfig: null
  };

  function esc(value) {
    const node = document.createElement('div');
    node.textContent = String(value == null ? '' : value);
    return node.innerHTML;
  }

  async function ensureAdmin() {
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

  function renderKpis(kpis = {}) {
    const mount = document.getElementById('govKpis');
    if (!mount) return;

    const cards = [
      ['Open', kpis.open_requests || 0],
      ['Solved', kpis.solved_requests || 0],
      ['Flagged', (kpis.flagged_requests || 0) + (kpis.quality_reports || 0)],
      ['Urgent', kpis.urgent_requests || 0],
      ['Pending Reports', kpis.total_pending_reports || 0],
      ['30d Net Points', kpis.net_points_delta || 0]
    ];

    mount.innerHTML = cards
      .map((entry) => `<div class="gov-kpi"><small>${esc(entry[0])}</small><strong>${esc(entry[1])}</strong></div>`)
      .join('');
  }

  function makeThreadActionButton(label, action, className = '') {
    return `<button class="${esc(className)}" data-thread-action="${esc(action)}">${esc(label)}</button>`;
  }

  function renderThreads() {
    const tbody = document.getElementById('threadRows');
    if (!tbody) return;

    if (!state.threads.length) {
      tbody.innerHTML = '<tr><td colspan="5">No threads matched the current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = state.threads
      .map((t) => {
        const attachmentCount = Array.isArray(t.attachment_urls) ? t.attachment_urls.length : 0;
        const imageCount = Array.isArray(t.image_urls) ? t.image_urls.length : 0;
        const helperNames = Array.isArray(t.helper_names) ? t.helper_names.filter(Boolean).join(', ') : '';

        const signals = [
          t.urgency_level && `<span class="gov-chip">${esc(t.urgency_level)}</span>`,
          t.status && `<span class="gov-chip">${esc(t.status)}</span>`,
          t.is_flagged && '<span class="gov-chip">flagged</span>',
          t.flagged_link_risk && '<span class="gov-chip">link risk</span>',
          t.flagged_attachment_risk && '<span class="gov-chip">attachment risk</span>',
          t.is_locked && '<span class="gov-chip">locked</span>',
          t.is_hidden && '<span class="gov-chip">hidden</span>',
          t.is_removed && '<span class="gov-chip">removed</span>',
          t.is_priority && '<span class="gov-chip">priority</span>',
          t.is_featured && '<span class="gov-chip">featured</span>'
        ]
          .filter(Boolean)
          .join('');

        return `
          <tr data-thread-id="${esc(t.id)}">
            <td>
              <strong>${esc(t.title)}</strong>
              <div>${esc((t.description || '').slice(0, 140))}</div>
              <div><span class="gov-chip">${esc(t.request_category || 'general')}</span><span class="gov-chip">${esc(t.subject || 'General')}</span></div>
            </td>
            <td>
              <div>College: ${esc(t.college_name || 'N/A')}</div>
              <div>Branch: ${esc(t.branch_id || '-')}</div>
              <div>Semester: ${esc(t.semester_id || '-')}</div>
            </td>
            <td>
              ${signals || '<span class="gov-chip">clean</span>'}
              <div>Answers: ${esc(t.answer_count || 0)} | Flagged answers: ${esc(t.flagged_answers || 0)}</div>
              <div>Meet: ${t.meet_link ? 'yes' : 'no'} | Files: ${attachmentCount} | Images: ${imageCount}</div>
            </td>
            <td>
              <div><strong>${esc(t.requester_name || 'Requester')}</strong></div>
              <div>${esc(t.requester_email || '')}</div>
              <div>Helpers: ${esc(helperNames || 'None')}</div>
            </td>
            <td>
              <div class="gov-actions">
                ${makeThreadActionButton('Hide', 'hide')}
                ${makeThreadActionButton('Unhide', 'unhide')}
                ${makeThreadActionButton('Remove', 'remove', 'danger')}
                ${makeThreadActionButton('Restore', 'restore')}
                ${makeThreadActionButton('Lock', 'lock_thread', 'warn')}
                ${makeThreadActionButton('Unlock', 'unlock_thread')}
                ${makeThreadActionButton('Priority', 'mark_priority', 'warn')}
                ${makeThreadActionButton('Feature', 'feature')}
                ${makeThreadActionButton('Reopen', 'reopen')}
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('[data-thread-action]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        const action = event.currentTarget.getAttribute('data-thread-action');
        const row = event.currentTarget.closest('tr');
        const requestId = Number(row?.getAttribute('data-thread-id') || 0);
        const notes = window.prompt(`Optional note for action: ${action}`, '') || '';
        const reason = ['mark_priority', 'mark_abuse', 'mark_spam'].includes(action)
          ? window.prompt('Reason for this governance action', '') || ''
          : '';
        if (!requestId || !action) return;
        try {
          await window.CollegeOSApi.adminSupportThreadAction(requestId, { action, notes, reason });
          await loadThreads();
          await loadDashboard();
          await loadAudit();
        } catch (error) {
          alert(error.message || 'Failed to perform thread action');
        }
      });
    });
  }

  async function loadDashboard() {
    const data = await window.CollegeOSApi.adminSupportGovernanceDashboard();
    renderKpis(data.kpis || {});
  }

  async function loadThreads() {
    const params = {
      status: document.getElementById('threadStatusFilter')?.value || '',
      search: document.getElementById('threadSearch')?.value || '',
      flaggedOnly: document.getElementById('flaggedOnly')?.checked || false,
      urgentOnly: document.getElementById('urgentOnly')?.checked || false,
      limit: 80
    };
    const data = await window.CollegeOSApi.adminSupportGovernanceThreads(params);
    state.threads = Array.isArray(data.threads) ? data.threads : [];
    renderThreads();
  }

  async function loadFeatureConfig() {
    const data = await window.CollegeOSApi.adminSupportGovernanceConfig();
    const cfg = data.config || {};
    state.featureConfig = cfg;

    document.getElementById('cfgEnabled').checked = !!cfg.enabled;
    document.getElementById('cfgVisible').checked = !!cfg.moduleVisible;
    document.getElementById('cfgRequest').checked = !!cfg.allowRequestCreation;
    document.getElementById('cfgAnswer').checked = !!cfg.allowAnswerCreation;
    document.getElementById('cfgMeet').checked = !!cfg.allowMeetLinks;
    document.getElementById('cfgAttach').checked = !!cfg.allowAttachments;
    document.getElementById('cfgReward').checked = !!cfg.allowStudentRewarding;
    document.getElementById('cfgSolved').checked = !!cfg.allowSolvedFlow;
  }

  async function loadRiskSignals() {
    const riskMount = document.getElementById('riskList');
    if (!riskMount) return;

    const [isolation, safety, analytics] = await Promise.all([
      window.CollegeOSApi.adminSupportIsolationAnomalies(),
      window.CollegeOSApi.adminSupportSafetyRisk(),
      window.CollegeOSApi.adminSupportAnalyticsOverview()
    ]);

    const anomalies = isolation.counts || {};
    const meetUsage = safety.meetUsage || {};
    const attachmentRisk = safety.attachmentRisk || {};
    const resolution = analytics.resolution || {};

    riskMount.innerHTML = `
      <div class="gov-list-item"><strong>Isolation anomalies</strong><div>Requests: ${esc(anomalies.requestAnomalies || 0)} | Answers: ${esc(anomalies.answerAnomalies || 0)}</div></div>
      <div class="gov-list-item"><strong>Meet link safety</strong><div>Total meet links: ${esc(meetUsage.total_meet_links || 0)} | Flagged: ${esc(meetUsage.flagged_meet_links || 0)}</div></div>
      <div class="gov-list-item"><strong>Attachment safety</strong><div>Requests with files: ${esc(attachmentRisk.requests_with_attachments || 0)} | Flagged: ${esc(attachmentRisk.flagged_attachment_requests || 0)}</div></div>
      <div class="gov-list-item"><strong>Resolution rate</strong><div>Total: ${esc(resolution.total_requests || 0)} | Solved: ${esc(resolution.solved_requests || 0)} | Rate: ${esc(resolution.resolution_rate || 0)}%</div></div>
      <div class="gov-list-item"><strong>Repeated meet links</strong><div>${esc((safety.repeatedMeetLinks || []).length)} suspicious repeated links detected</div></div>
    `;
  }

  async function loadAudit() {
    const mount = document.getElementById('auditList');
    if (!mount) return;

    const data = await window.CollegeOSApi.adminSupportGovernanceAudit(80);
    const audits = Array.isArray(data.audits) ? data.audits : [];

    mount.innerHTML = audits
      .map((a) => {
        const time = new Date(a.created_at).toLocaleString();
        return `<div class="gov-list-item"><strong>${esc(a.action_type)}</strong><div>${esc(a.actor_name || 'Admin')} • ${esc(a.target_type || '')} #${esc(a.target_id || '')}</div><div>${esc(time)}</div></div>`;
      })
      .join('');
  }

  function bindForms() {
    const featureForm = document.getElementById('featureConfigForm');
    featureForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        enabled: document.getElementById('cfgEnabled').checked,
        moduleVisible: document.getElementById('cfgVisible').checked,
        allowRequestCreation: document.getElementById('cfgRequest').checked,
        allowAnswerCreation: document.getElementById('cfgAnswer').checked,
        allowMeetLinks: document.getElementById('cfgMeet').checked,
        allowAttachments: document.getElementById('cfgAttach').checked,
        allowStudentRewarding: document.getElementById('cfgReward').checked,
        allowSolvedFlow: document.getElementById('cfgSolved').checked
      };
      try {
        await window.CollegeOSApi.adminSupportGovernanceUpdateConfig(payload);
        alert('Support feature controls saved');
      } catch (error) {
        alert(error.message || 'Failed to save controls');
      }
    });

    const rewardForm = document.getElementById('rewardForm');
    rewardForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = {
        helperUserId: Number(document.getElementById('rewardHelperId').value || 0),
        pointsDelta: Number(document.getElementById('rewardDelta').value || 0),
        eventType: document.getElementById('rewardEventType').value,
        reason: document.getElementById('rewardReason').value.trim()
      };
      try {
        await window.CollegeOSApi.adminSupportRewardAdjust(payload);
        alert('Reward adjustment applied');
        rewardForm.reset();
        await loadDashboard();
        await loadAudit();
      } catch (error) {
        alert(error.message || 'Failed to adjust rewards');
      }
    });

    const trustForm = document.getElementById('trustForm');
    trustForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const helperId = Number(document.getElementById('trustHelperId').value || 0);
      const payload = {
        trustLevel: document.getElementById('trustLevel').value,
        verifiedContributor: document.getElementById('trustVerified').checked,
        suspend: document.getElementById('trustSuspend').checked,
        suspendedUntil: document.getElementById('trustSuspendUntil').value || null,
        suspensionReason: document.getElementById('trustSuspendReason').value.trim()
      };
      if (!helperId) {
        alert('Helper user ID is required');
        return;
      }
      try {
        await window.CollegeOSApi.adminSupportHelperTrust(helperId, payload);
        alert('Helper trust control updated');
        await loadDashboard();
        await loadAudit();
      } catch (error) {
        alert(error.message || 'Failed to update helper trust controls');
      }
    });

    document.getElementById('threadFilterBtn')?.addEventListener('click', async () => {
      try {
        await loadThreads();
      } catch (error) {
        alert(error.message || 'Failed to load moderation queue');
      }
    });
  }

  async function bootstrap() {
    if (!(await ensureAdmin())) return;

    bindForms();

    try {
      await Promise.all([
        loadDashboard(),
        loadFeatureConfig(),
        loadThreads(),
        loadRiskSignals(),
        loadAudit()
      ]);
    } catch (error) {
      alert(error.message || 'Failed to load support governance dashboard');
    }
  }

  bootstrap();
})();
