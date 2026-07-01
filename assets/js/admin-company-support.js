/* ============================================================
   admin-company-support.js
   Powers the Company & Support panel (panel-company) inside
   admin-control.html.  Handles:
     • About Us editor
     • Contact Us editor
     • Help Center FAQ/category editor
     • Support Ticket management + reply
   ============================================================ */

(function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────
  async function apiFetch(path, opts) {
    if (window.CollegeOSApiClient?.request) {
      return window.CollegeOSApiClient.request(path, opts || {});
    }

    const res = await fetch(path, { credentials: 'include', ...(opts || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  }

  function setStatus(id, msg, isError) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#dc2626' : '#16a34a';
    if (msg) setTimeout(() => { el.textContent = ''; }, 4000);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ── Sub-tab switcher ──────────────────────────────────────
  function initSubTabs() {
    const buttons = document.querySelectorAll('[data-company-tab]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.companyTab;
        document.querySelectorAll('.company-tab-panel').forEach((p) => {
          p.style.display = p.id === target ? '' : 'none';
        });
        buttons.forEach((b) => {
          b.className = b === btn ? 'btn primary' : 'btn secondary';
        });
        if (target === 'tab-tickets') loadAdminTickets();
        if (target === 'tab-help') loadHelpEditorCats();
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // ABOUT US EDITOR
  // ══════════════════════════════════════════════════════════
  let _aboutConfig = null;

  async function loadAboutEditor() {
    try {
      const { config } = await apiFetch('/api/company/about-config');
      _aboutConfig = config;
      fillAboutForm(config);
    } catch {}
  }

  function fillAboutForm(c) {
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    set('aboutTagline', c.hero?.tagline || '');
    set('aboutHeadline', c.hero?.headline || '');
    set('aboutHeroDesc', c.hero?.description || '');
    set('aboutMissionTitle', c.mission?.title || '');
    set('aboutMissionIcon', c.mission?.icon || '');
    set('aboutMissionDesc', c.mission?.description || '');
    set('aboutVisionTitle', c.vision?.title || '');
    set('aboutVisionIcon', c.vision?.icon || '');
    set('aboutVisionDesc', c.vision?.description || '');
    set('aboutStoryTitle', c.story?.title || '');
    set('aboutStoryParagraphs', (c.story?.paragraphs || []).join('\n'));
  }

  function buildAboutPayload() {
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const base = _aboutConfig || {};
    return {
      ...base,
      hero: {
        ...(base.hero || {}),
        tagline: val('aboutTagline'),
        headline: val('aboutHeadline'),
        description: val('aboutHeroDesc'),
        ctaLabel: base.hero?.ctaLabel || 'Get Started Free',
        ctaHref: base.hero?.ctaHref || 'login.html?mode=signup',
        highlightStats: base.hero?.highlightStats || []
      },
      mission: {
        ...(base.mission || {}),
        title: val('aboutMissionTitle'),
        icon: val('aboutMissionIcon') || 'fa-rocket',
        description: val('aboutMissionDesc'),
        visible: true
      },
      vision: {
        ...(base.vision || {}),
        title: val('aboutVisionTitle'),
        icon: val('aboutVisionIcon') || 'fa-eye',
        description: val('aboutVisionDesc'),
        visible: true
      },
      story: {
        ...(base.story || {}),
        title: val('aboutStoryTitle'),
        paragraphs: val('aboutStoryParagraphs').split('\n').map((l) => l.trim()).filter(Boolean),
        visible: true
      }
    };
  }

  function initAboutEditor() {
    loadAboutEditor();
    document.getElementById('saveAboutBtn')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/company/admin/about-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: buildAboutPayload() })
        });
        setStatus('aboutSaveStatus', '✓ Saved successfully');
      } catch (err) {
        setStatus('aboutSaveStatus', err.message, true);
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  // CONTACT US EDITOR
  // ══════════════════════════════════════════════════════════
  let _contactConfig = null;

  async function loadContactEditor() {
    try {
      const { config } = await apiFetch('/api/company/contact-config');
      _contactConfig = config;
      fillContactForm(config);
    } catch {}
  }

  function fillContactForm(c) {
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    set('contactHeroTitleEdit', c.hero?.title || '');
    set('contactHeroDescEdit', c.hero?.description || '');
    set('contactHoursEdit', (c.hours?.lines || []).join('\n'));
    set('contactSlaEdit', c.hours?.sla || '');
    const email = (c.channels || []).find((ch) => ch.label === 'Email Support');
    const wa = (c.channels || []).find((ch) => ch.label === 'WhatsApp');
    set('contactEmailEdit', email?.value || '');
    set('contactWhatsappEdit', wa?.value || '');
    set('contactCategoriesEdit', (c.form?.categories || []).join(', '));
  }

  function buildContactPayload() {
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const base = _contactConfig || {};
    const emailVal = val('contactEmailEdit');
    const waVal = val('contactWhatsappEdit');
    const waClean = waVal.replace(/\D/g, '');

    const channels = [
      { icon: 'fa-envelope', label: 'Email Support', value: emailVal, href: `mailto:${emailVal}`, description: 'Best for billing, account, or detailed queries. We reply within 24 hours.' },
      { icon: 'fa-brands fa-whatsapp', label: 'WhatsApp', value: waVal, href: `https://wa.me/${waClean}`, description: 'Quick questions and real-time help. Available 9 AM – 9 PM IST.' },
      { icon: 'fa-phone', label: 'Phone', value: waVal, href: `tel:${waClean}`, description: 'Call us during business hours for urgent issues.' }
    ];

    const categories = val('contactCategoriesEdit').split(',').map((s) => s.trim()).filter(Boolean);

    return {
      ...base,
      hero: { title: val('contactHeroTitleEdit'), description: val('contactHeroDescEdit') },
      channels,
      hours: {
        ...(base.hours || {}),
        lines: val('contactHoursEdit').split('\n').map((l) => l.trim()).filter(Boolean),
        sla: val('contactSlaEdit'),
        visible: true
      },
      form: {
        ...(base.form || {}),
        categories: categories.length ? categories : base.form?.categories || [],
        visible: true
      },
      social: base.social || {}
    };
  }

  function initContactEditor() {
    loadContactEditor();
    document.getElementById('saveContactBtn')?.addEventListener('click', async () => {
      try {
        await apiFetch('/api/company/admin/contact-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: buildContactPayload() })
        });
        setStatus('contactSaveStatus', '✓ Saved successfully');
      } catch (err) {
        setStatus('contactSaveStatus', err.message, true);
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  // HELP CENTER EDITOR
  // ══════════════════════════════════════════════════════════
  let _helpConfig = null;
  let _activeCatIdx = null;

  async function loadHelpEditorCats() {
    const catBtns = document.getElementById('helpCatButtons');
    if (!catBtns) return;
    try {
      const { config } = await apiFetch('/api/company/help-config');
      _helpConfig = config;
      catBtns.innerHTML = (config.categories || []).map((cat, idx) => `
        <button class="btn secondary" data-cat-idx="${idx}">${esc(cat.title)}</button>
      `).join('');
      catBtns.querySelectorAll('[data-cat-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          catBtns.querySelectorAll('[data-cat-idx]').forEach((b) => b.className = 'btn secondary');
          btn.className = 'btn primary';
          _activeCatIdx = parseInt(btn.dataset.catIdx);
          renderHelpArticleEditor(_activeCatIdx);
        });
      });
    } catch {}
  }

  function renderHelpArticleEditor(idx) {
    const editor = document.getElementById('helpArticleEditor');
    const titleEl = document.getElementById('helpEditorCatTitle');
    const listEl = document.getElementById('helpArticlesList');
    if (!editor || !_helpConfig) return;

    const cat = _helpConfig.categories[idx];
    if (!cat) return;

    editor.style.display = '';
    if (titleEl) titleEl.textContent = `Editing: ${cat.title}`;

    renderArticleList(cat.articles || [], idx);
  }

  function renderArticleList(articles, catIdx) {
    const listEl = document.getElementById('helpArticlesList');
    if (!listEl) return;
    listEl.innerHTML = articles.map((art, i) => `
      <div class="card" style="padding:14px;margin-bottom:10px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div style="flex:1;">
            <div style="font-weight:700;margin-bottom:6px;">${esc(art.title)}</div>
            <div style="font-size:0.88rem;color:var(--text-muted,#64748b);">${esc(art.body)}</div>
          </div>
          <button class="btn warn" style="font-size:0.8rem;padding:6px 10px;" data-delete-art="${i}">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('') || '<p class="muted">No articles yet. Add one below.</p>';

    listEl.querySelectorAll('[data-delete-art]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.deleteArt);
        _helpConfig.categories[catIdx].articles.splice(i, 1);
        renderArticleList(_helpConfig.categories[catIdx].articles, catIdx);
      });
    });
  }

  function initHelpEditor() {
    document.getElementById('addArticleBtn')?.addEventListener('click', () => {
      if (_activeCatIdx === null || !_helpConfig) return;
      const title = document.getElementById('newArticleTitle')?.value.trim();
      const body = document.getElementById('newArticleBody')?.value.trim();
      if (!title || !body) { alert('Please fill in both title and body.'); return; }
      _helpConfig.categories[_activeCatIdx].articles.push({ title, body });
      renderArticleList(_helpConfig.categories[_activeCatIdx].articles, _activeCatIdx);
      document.getElementById('newArticleTitle').value = '';
      document.getElementById('newArticleBody').value = '';
    });

    document.getElementById('saveHelpBtn')?.addEventListener('click', async () => {
      if (!_helpConfig) return;
      try {
        await apiFetch('/api/company/admin/help-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: _helpConfig })
        });
        setStatus('helpSaveStatus', '✓ Saved successfully');
      } catch (err) {
        setStatus('helpSaveStatus', err.message, true);
      }
    });
  }

  // ══════════════════════════════════════════════════════════
  // SUPPORT TICKETS
  // ══════════════════════════════════════════════════════════
  let _activeTicketId = null;

  async function loadAdminTickets() {
    const tbody = document.getElementById('adminTicketsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">Loading...</td></tr>';

    const search = document.getElementById('ticketSearchInput')?.value.trim() || '';
    const status = document.getElementById('ticketStatusFilter')?.value || 'all';
    const priority = document.getElementById('ticketPriorityFilter')?.value || 'all';

    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status !== 'all') params.set('status', status);
      if (priority !== 'all') params.set('priority', priority);

      const { tickets, total } = await apiFetch(`/api/company/admin/tickets?${params}`);

      if (!tickets.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="co-admin-table-empty">No tickets found.</td></tr>';
        return;
      }

      tbody.innerHTML = tickets.map((t) => `
        <tr>
          <td>#${esc(t.id)}</td>
          <td>
            <div style="font-weight:600;">${esc(t.student_name)}</div>
            <div style="font-size:0.8rem;color:var(--text-muted,#64748b);">${esc(t.student_email)}</div>
          </td>
          <td>${esc(t.subject)}</td>
          <td>${esc(t.category)}</td>
          <td><span style="font-weight:600;color:${priorityColor(t.priority)}">${esc(capitalize(t.priority))}</span></td>
          <td>${statusBadge(t.status)}</td>
          <td style="font-size:0.82rem;">${fmtDate(t.created_at)}</td>
          <td><button class="btn secondary" style="font-size:0.8rem;padding:5px 10px;" data-open-ticket="${esc(t.id)}">View / Reply</button></td>
        </tr>
      `).join('');

      tbody.querySelectorAll('[data-open-ticket]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = parseInt(btn.dataset.openTicket);
          const ticket = tickets.find((x) => x.id === id);
          if (ticket) openTicketDetail(ticket);
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="8" class="co-admin-table-empty">${esc(err.message)}</td></tr>`;
    }
  }

  function openTicketDetail(t) {
    const modal = document.getElementById('ticketDetailModal');
    const body = document.getElementById('ticketDetailBody');
    const titleEl = document.getElementById('ticketDetailTitle');
    const statusSel = document.getElementById('ticketDetailStatus');
    const replyTA = document.getElementById('ticketDetailReply');
    if (!modal) return;

    _activeTicketId = t.id;

    if (titleEl) titleEl.textContent = `Ticket #${t.id} — ${t.subject}`;
    if (statusSel) statusSel.value = t.status;
    if (replyTA) replyTA.value = t.admin_reply || '';

    if (body) {
      body.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:0.9rem;">
          <div><strong>Student:</strong> ${esc(t.student_name)} &lt;${esc(t.student_email)}&gt;</div>
          <div><strong>Category:</strong> ${esc(t.category)}</div>
          <div><strong>Priority:</strong> <span style="color:${priorityColor(t.priority)};font-weight:700;">${esc(capitalize(t.priority))}</span></div>
          <div><strong>Submitted:</strong> ${fmtDate(t.created_at)}</div>
        </div>
        <div style="background:var(--surface-1,#f8fafc);border-radius:10px;padding:14px;font-size:0.9rem;line-height:1.7;margin-bottom:12px;">
          <strong>Message:</strong><br/>${esc(t.message)}
        </div>
        ${t.admin_reply ? `
          <div style="background:#f0fdf4;border-left:3px solid #16a34a;border-radius:0 10px 10px 0;padding:12px 16px;font-size:0.88rem;margin-bottom:12px;">
            <strong style="color:#16a34a;">Previous Reply (${fmtDate(t.replied_at)}):</strong><br/>${esc(t.admin_reply)}
          </div>
        ` : ''}
      `;
    }

    modal.style.display = '';
    modal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function initTicketManagement() {
    document.getElementById('loadTicketsBtn')?.addEventListener('click', loadAdminTickets);
    document.getElementById('ticketSearchInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadAdminTickets(); });

    document.getElementById('closeTicketDetailBtn')?.addEventListener('click', () => {
      const modal = document.getElementById('ticketDetailModal');
      if (modal) modal.style.display = 'none';
      _activeTicketId = null;
    });

    document.getElementById('submitTicketUpdateBtn')?.addEventListener('click', async () => {
      if (!_activeTicketId) return;
      const status = document.getElementById('ticketDetailStatus')?.value;
      const admin_reply = document.getElementById('ticketDetailReply')?.value.trim();
      const statusEl = document.getElementById('ticketUpdateStatus');

      try {
        await apiFetch(`/api/company/admin/tickets/${_activeTicketId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, admin_reply: admin_reply || undefined })
        });
        setStatus('ticketUpdateStatus', '✓ Updated successfully');
        loadAdminTickets();
        setTimeout(() => {
          const modal = document.getElementById('ticketDetailModal');
          if (modal) modal.style.display = 'none';
        }, 1500);
      } catch (err) {
        setStatus('ticketUpdateStatus', err.message, true);
      }
    });
  }

  function statusBadge(status) {
    const colors = {
      open: '#1d4ed8:bg:#dbeafe',
      in_progress: '#854d0e:bg:#fef9c3',
      resolved: '#166534:bg:#dcfce7',
      closed: '#475569:bg:#f1f5f9'
    };
    const [color, _, bg] = (colors[status] || '').split(':bg:');
    const label = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' }[status] || status;
    return `<span style="background:${bg || '#f1f5f9'};color:${color || '#475569'};padding:3px 10px;border-radius:100px;font-size:0.75rem;font-weight:700;">${esc(label)}</span>`;
  }

  function priorityColor(p) {
    return { high: '#dc2626', medium: '#d97706', low: '#16a34a' }[p] || '#475569';
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // ══════════════════════════════════════════════════════════
  // INIT — only runs when admin-control panel is present
  // ══════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('panel-company')) return;

    initSubTabs();
    initAboutEditor();
    initContactEditor();
    initHelpEditor();
    initTicketManagement();
  });
})();
