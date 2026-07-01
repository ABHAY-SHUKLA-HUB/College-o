/* ============================================================
   company-support.js — Student-facing logic for:
     • about-us.html
     • contact-us.html
     • help-center.html
     • my-tickets.html
   ============================================================ */

(function () {
  'use strict';

  const page = window.location.pathname.split('/').pop() || '';

  // ── Shared helper ────────────────────────────────────────────
  async function apiFetch(path, opts = {}) {
    if (window.CollegeOSApiClient?.request) {
      return window.CollegeOSApiClient.request(path, opts);
    }

    const res = await fetch(path, { credentials: 'include', ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
    return data;
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ══════════════════════════════════════════════════════════════
  // ABOUT US
  // ══════════════════════════════════════════════════════════════
  function initAboutUs() {
    apiFetch('/api/company/about-config')
      .then(({ config }) => renderAboutUs(config))
      .catch(() => { /* defaults already in DOM */ });
  }

  function renderAboutUs(c) {
    // Hero
    const hero = c.hero || {};
    setText('aboutHeroTag', hero.tagline || '');
    setText('aboutHeroHeadline', hero.headline || 'About College OS');
    setText('aboutHeroDesc', hero.description || '');
    const cta = document.getElementById('aboutHeroCta');
    if (cta && hero.ctaLabel) {
      cta.textContent = hero.ctaLabel;
      if (hero.ctaHref) cta.href = hero.ctaHref;
    }

    const statsGrid = document.getElementById('aboutStatsGrid');
    if (statsGrid && Array.isArray(hero.highlightStats)) {
      statsGrid.innerHTML = hero.highlightStats.map((s) => `
        <div class="about-stat-tile">
          <div class="stat-val">${esc(s.value)}</div>
          <div class="stat-lbl">${esc(s.label)}</div>
        </div>
      `).join('');
    }

    // Mission
    const m = c.mission || {};
    if (m.visible === false) {
      hide('missionVisionSection');
    } else {
      setText('missionTitle', m.title || '');
      setText('missionDesc', m.description || '');
      setIcon('missionIcon', m.icon || 'fa-rocket');
    }

    // Vision
    const v = c.vision || {};
    setText('visionTitle', v.title || '');
    setText('visionDesc', v.description || '');
    setIcon('visionIcon', v.icon || 'fa-eye');

    // Values
    const vals = c.values || {};
    if (vals.visible === false) {
      hide('valuesSection');
    } else {
      setText('valuesTitle', vals.title || 'What We Stand For');
      const grid = document.getElementById('valuesGrid');
      if (grid && Array.isArray(vals.items)) {
        grid.innerHTML = vals.items.map((item) => `
          <div class="value-card">
            <div class="value-icon"><i class="fa-solid ${esc(item.icon || 'fa-star')}"></i></div>
            <div>
              <h4>${esc(item.title || '')}</h4>
              <p>${esc(item.description || '')}</p>
            </div>
          </div>
        `).join('');
      }
    }

    // Story
    const story = c.story || {};
    if (story.visible === false) {
      hide('storySection');
    } else {
      setText('storyTitle', story.title || '');
      const pWrap = document.getElementById('storyParagraphs');
      if (pWrap && Array.isArray(story.paragraphs)) {
        pWrap.innerHTML = story.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
      }
    }

    // CTA
    const ctaSec = c.cta || {};
    if (ctaSec.visible === false) {
      hide('aboutCtaSection');
    } else {
      setText('aboutCtaTitle', ctaSec.title || '');
      setText('aboutCtaDesc', ctaSec.description || '');
      setHref('aboutCtaPrimary', ctaSec.primaryHref || 'login.html?mode=signup', ctaSec.primaryLabel || 'Start Learning Free');
      setHref('aboutCtaSecondary', ctaSec.secondaryHref || 'home.html', ctaSec.secondaryLabel || 'Explore Features');
    }
  }

  // ══════════════════════════════════════════════════════════════
  // CONTACT US
  // ══════════════════════════════════════════════════════════════
  function initContactUs() {
    apiFetch('/api/company/contact-config')
      .then(({ config }) => renderContactUs(config))
      .catch(() => {});
    setupContactForm();
  }

  function renderContactUs(c) {
    // Hero
    const hero = c.hero || {};
    setText('contactHeroTitle', hero.title || 'Get in Touch');
    setText('contactHeroDesc', hero.description || '');

    // Channels
    const grid = document.getElementById('contactChannelsGrid');
    if (grid && Array.isArray(c.channels)) {
      grid.innerHTML = c.channels.map((ch) => `
        <a class="contact-channel-card" href="${esc(ch.href || '#')}" ${ch.href && ch.href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>
          <div class="channel-icon"><i class="${esc(ch.icon || 'fa-solid fa-envelope')}"></i></div>
          <div class="channel-label">${esc(ch.label || '')}</div>
          <div class="channel-value">${esc(ch.value || '')}</div>
          <div class="channel-desc">${esc(ch.description || '')}</div>
        </a>
      `).join('');
    }

    // Support Hours
    const hours = c.hours || {};
    if (hours.visible === false) {
      hide('contactHoursCard');
    } else {
      setText('contactHoursTitle', hours.title || 'Support Hours');
      const list = document.getElementById('contactHoursList');
      if (list && Array.isArray(hours.lines)) {
        list.innerHTML = hours.lines.map((l) => `<li>${esc(l)}</li>`).join('');
      }
      setText('contactSlaNvote', hours.sla || '');
    }

    // Social
    const social = c.social || {};
    if (social.visible === false) {
      hide('contactSocialCard');
    } else {
      setText('contactSocialTitle', social.title || 'Find Us Online');
      const linksWrap = document.getElementById('contactSocialLinks');
      if (linksWrap && Array.isArray(social.links)) {
        linksWrap.innerHTML = social.links.map((l) => `
          <a class="social-link-pill" href="${esc(l.href || '#')}" target="_blank" rel="noopener">
            <i class="${esc(l.icon || 'fa-solid fa-link')}"></i>
            <span>${esc(l.handle || l.label || '')}</span>
          </a>
        `).join('');
      }
    }

    // Form visible?
    const form = c.form || {};
    if (form.visible === false) {
      hide('contactFormSection');
    } else {
      setText('contactFormTitle', form.title || 'Send Us a Message');
      setText('contactFormDesc', form.description || '');
      const catSel = document.getElementById('contactCategory');
      if (catSel && Array.isArray(form.categories)) {
        catSel.innerHTML = form.categories.map((cat) => `<option>${esc(cat)}</option>`).join('');
      }
      window._contactFormSuccessMsg = form.successMessage || 'Message sent! We\'ll get back to you soon.';
    }

    // FAQ preview
    const faqPrev = c.faq_preview || {};
    if (faqPrev.visible === false) {
      hide('contactFaqCard');
    } else {
      const faqList = document.getElementById('contactFaqList');
      if (faqList && Array.isArray(faqPrev.items)) {
        faqList.innerHTML = faqPrev.items.map((item, idx) => `
          <div class="faq-preview-item" data-faq-idx="${idx}">
            <div class="faq-preview-q">
              <span>${esc(item.q || '')}</span>
              <i class="fa-solid fa-chevron-down faq-chevron"></i>
            </div>
            <div class="faq-preview-a">${esc(item.a || '')}</div>
          </div>
        `).join('');

        faqList.querySelectorAll('.faq-preview-q').forEach((el) => {
          el.addEventListener('click', () => {
            el.closest('.faq-preview-item').classList.toggle('open');
          });
        });
      }
    }
  }

  function setupContactForm() {
    const form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('contactSubmitBtn');
      const errEl = document.getElementById('contactFormError');
      const successEl = document.getElementById('contactFormSuccess');

      const subject = document.getElementById('contactSubject')?.value.trim();
      const message = document.getElementById('contactMessage')?.value.trim();
      const category = document.getElementById('contactCategory')?.value;
      const priority = document.getElementById('contactPriority')?.value;
      const name = document.getElementById('contactName')?.value.trim();
      const email = document.getElementById('contactEmail')?.value.trim();

      if (!subject || !message || !name || !email) {
        showEl(errEl, 'Please fill in all required fields.');
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending...';
      hideEl(errEl);

      try {
        await apiFetch('/api/company/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subject: `[${name}] ${subject}`, message: `From: ${name} <${email}>\n\n${message}`, category, priority })
        });

        form.reset();
        successEl.textContent = window._contactFormSuccessMsg || 'Message sent! We\'ll be in touch soon.';
        successEl.style.display = 'block';
        setTimeout(() => { successEl.style.display = 'none'; }, 6000);
      } catch (err) {
        showEl(errEl, err.message || 'Failed to submit. Please try again.');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Message';
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // HELP CENTER
  // ══════════════════════════════════════════════════════════════
  let _helpConfig = null;

  function initHelpCenter() {
    apiFetch('/api/company/help-config')
      .then(({ config }) => {
        _helpConfig = config;
        renderHelpCenter(config);
      })
      .catch(() => {});
  }

  function renderHelpCenter(c) {
    setText('hcHeroTitle', c.hero?.title || 'Help Center');
    setText('hcHeroDesc', c.hero?.description || '');

    const grid = document.getElementById('hcCategoriesGrid');
    if (grid && Array.isArray(c.categories)) {
      grid.innerHTML = c.categories.map((cat) => `
        <div class="hc-cat-card" data-cat-id="${esc(cat.id)}">
          <div class="hc-cat-icon" style="background:${opac(cat.color)};color:${esc(cat.color || '#0f7b6c')}">
            <i class="fa-solid ${esc(cat.icon || 'fa-circle-question')}"></i>
          </div>
          <h4>${esc(cat.title || '')}</h4>
          <div class="cat-count">${(cat.articles || []).length} article${(cat.articles || []).length === 1 ? '' : 's'}</div>
        </div>
      `).join('');

      grid.querySelectorAll('.hc-cat-card').forEach((card) => {
        card.addEventListener('click', () => {
          const id = card.dataset.catId;
          const cat = (c.categories || []).find((x) => x.id === id);
          if (cat) openCategory(cat);
        });
      });
    }

    // CTA
    const cta = c.contact_cta || {};
    if (cta.visible === false) {
      hide('hcCtaSection');
    } else {
      setText('hcCtaTitle', cta.title || 'Still need help?');
      setText('hcCtaDesc', cta.description || '');
      const link = document.getElementById('hcCtaLink');
      if (link) {
        if (cta.label) link.innerHTML = `<i class="fa-solid fa-headset"></i> ${esc(cta.label)}`;
        if (cta.href) link.href = cta.href;
      }
    }

    // Search
    const input = document.getElementById('hcSearch');
    if (input) {
      input.addEventListener('input', () => handleHcSearch(input.value, c));
    }

    // Back button
    const backBtn = document.getElementById('hcBackToCatsBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        hide('hcArticlesSection');
        show('hcCategoriesGrid');
        grid?.querySelectorAll('.hc-cat-card').forEach((c) => c.classList.remove('selected'));
      });
    }
  }

  function openCategory(cat) {
    const section = document.getElementById('hcArticlesSection');
    const title = document.getElementById('hcArticlesSectionTitle');
    const list = document.getElementById('hcArticlesList');
    const catGrid = document.getElementById('hcCategoriesGrid');
    if (!section || !list) return;

    title && (title.textContent = cat.title || '');
    list.innerHTML = (cat.articles || []).map((a, i) => `
      <div class="hc-accordion-item" data-art-idx="${i}">
        <div class="hc-accordion-q">
          <span>${esc(a.title || '')}</span>
          <i class="fa-solid fa-chevron-down hc-chevron"></i>
        </div>
        <div class="hc-accordion-a">${esc(a.body || '')}</div>
      </div>
    `).join('');

    list.querySelectorAll('.hc-accordion-q').forEach((el) => {
      el.addEventListener('click', () => {
        el.closest('.hc-accordion-item').classList.toggle('open');
      });
    });

    hide('hcCategoriesGrid');
    show('hcArticlesSection');
  }

  function handleHcSearch(q, c) {
    const searchEl = document.getElementById('hcSearchResults');
    const mainEl = document.getElementById('hcMainContent');
    const resultsList = document.getElementById('hcSearchResultsList');

    if (!q.trim()) {
      if (searchEl) searchEl.style.display = 'none';
      if (mainEl) mainEl.style.display = '';
      return;
    }

    if (mainEl) mainEl.style.display = 'none';
    if (searchEl) searchEl.style.display = '';

    const lq = q.toLowerCase();
    const matches = [];
    (c.categories || []).forEach((cat) => {
      (cat.articles || []).forEach((art) => {
        if ((art.title || '').toLowerCase().includes(lq) || (art.body || '').toLowerCase().includes(lq)) {
          matches.push({ cat: cat.title, ...art });
        }
      });
    });

    const titleEl = document.getElementById('hcSearchResultsTitle');
    if (titleEl) titleEl.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'} for "${q}"`;

    if (!resultsList) return;
    if (matches.length === 0) {
      resultsList.innerHTML = '<div class="search-no-results"><i class="fa-solid fa-magnifying-glass" style="opacity:0.3;font-size:2rem;display:block;margin:0 auto 12px;"></i>No articles found. Try different keywords or <a href="contact-us.html">contact us</a>.</div>';
    } else {
      resultsList.innerHTML = matches.map((m) => `
        <div class="search-result-item" data-title="${esc(m.title)}" data-cat="${esc(m.cat)}">
          <div class="sr-cat">${esc(m.cat)}</div>
          <div class="sr-title">${esc(m.title)}</div>
          <div class="sr-body">${esc(m.body || '')}</div>
        </div>
      `).join('');

      resultsList.querySelectorAll('.search-result-item').forEach((item) => {
        item.addEventListener('click', () => {
          const catTitle = item.dataset.cat;
          const artTitle = item.dataset.title;
          const cat = (c.categories || []).find((x) => x.title === catTitle);
          if (cat) {
            document.getElementById('hcSearch').value = '';
            if (searchEl) searchEl.style.display = 'none';
            if (mainEl) mainEl.style.display = '';
            openCategory(cat);
            setTimeout(() => {
              const found = [...document.querySelectorAll('.hc-accordion-q')].find((el) => el.querySelector('span')?.textContent === artTitle);
              if (found) {
                found.closest('.hc-accordion-item').classList.add('open');
                found.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 100);
          }
        });
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // MY TICKETS
  // ══════════════════════════════════════════════════════════════
  function initMyTickets() {
    loadMyTickets();
  }

  async function loadMyTickets() {
    const wrap = document.getElementById('ticketsList');
    if (!wrap) return;
    try {
      const { tickets } = await apiFetch('/api/company/tickets/mine');
      if (!tickets || tickets.length === 0) {
        wrap.innerHTML = `
          <div class="empty-tickets">
            <i class="fa-solid fa-ticket"></i>
            <p>You haven't submitted any support tickets yet.</p>
            <a class="btn primary" href="contact-us.html"><i class="fa-solid fa-plus"></i> Submit Your First Ticket</a>
          </div>
        `;
        return;
      }

      wrap.innerHTML = tickets.map((t) => {
        const statusBadge = `<span class="ticket-badge badge-${esc(t.status || 'open')}">${esc(statusLabel(t.status))}</span>`;
        const priorityBadge = `<span class="ticket-badge badge-${esc(t.priority || 'medium')}">${esc(capitalize(t.priority || 'medium'))} Priority</span>`;
        const replyHtml = t.admin_reply ? `
          <div class="ticket-reply">
            <div class="ticket-reply-label"><i class="fa-solid fa-headset"></i> Support Reply — ${fmtDate(t.replied_at)}</div>
            <div class="ticket-reply-text">${esc(t.admin_reply)}</div>
          </div>
        ` : '';

        const steps = ['open', 'in_progress', 'resolved', 'closed'];
        const currentStep = steps.indexOf(t.status);
        const trackHtml = `
          <div class="ticket-status-track">
            ${steps.map((s, i) => `<div class="track-step ${i < currentStep ? 'done' : ''} ${i === currentStep ? 'active' : ''}">${esc(statusLabel(s))}</div>`).join('')}
          </div>
        `;

        return `
          <div class="ticket-card">
            <div class="ticket-card-top">
              <div class="ticket-subject">${esc(t.subject || '')}</div>
              <div class="ticket-meta">${statusBadge} ${priorityBadge}</div>
            </div>
            <div class="ticket-meta" style="margin-bottom:8px;">
              <span class="ticket-date"><i class="fa-regular fa-clock"></i> Submitted ${fmtDate(t.created_at)}</span>
              <span class="ticket-date" style="margin-left:10px;"><i class="fa-solid fa-tag"></i> ${esc(t.category || '')}</span>
            </div>
            ${trackHtml}
            <div class="ticket-message" style="margin-top:10px;">${esc(t.message || '')}</div>
            ${replyHtml}
          </div>
        `;
      }).join('');
    } catch (err) {
      wrap.innerHTML = `<p class="muted">Failed to load tickets. <a href="contact-us.html">Submit a new ticket</a>.</p>`;
    }
  }

  function statusLabel(s) {
    const map = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
    return map[s] || s;
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // ══════════════════════════════════════════════════════════════
  // Utility helpers
  // ══════════════════════════════════════════════════════════════
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.textContent = val;
  }

  function setHref(id, href, label) {
    const el = document.getElementById(id);
    if (!el) return;
    if (href) el.href = href;
    if (label) el.textContent = label;
  }

  function setIcon(containerId, iconClass) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const existing = el.querySelector('i');
    if (existing) existing.className = `fa-solid ${iconClass}`;
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function show(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }

  function hideEl(el) {
    if (el) el.style.display = 'none';
  }

  function showEl(el, msg) {
    if (!el) return;
    el.style.display = '';
    if (msg !== undefined) el.textContent = msg;
  }

  function opac(color) {
    // Convert hex to very light bg
    if (!color || !color.startsWith('#')) return 'rgba(15,123,108,0.08)';
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},0.1)`;
  }

  // ══════════════════════════════════════════════════════════════
  // Route to correct initializer
  // ══════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    if (page === 'about-us.html') initAboutUs();
    else if (page === 'contact-us.html') initContactUs();
    else if (page === 'help-center.html') initHelpCenter();
    else if (page === 'my-tickets.html') initMyTickets();
  });
})();
