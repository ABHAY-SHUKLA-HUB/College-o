async function apiRequest(path, options = {}) {
  if (window.CollegeOSApiClient?.request) {
    return window.CollegeOSApiClient.request(path, options);
  }

  const response = await fetch(path, { credentials: 'include', ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

async function loadDailyChallenge() {
  const node = document.getElementById('dailyChallengeCard');
  if (!node || !window.CollegeOSApi) return;
  try {
    const data = await apiRequest('/api/content/daily-challenges/today');
    if (!data.challenge) {
      node.innerHTML = '<p>No challenge published for today.</p>';
      return;
    }
    node.innerHTML = `<h3>${data.challenge.title}</h3><p>${data.challenge.description}</p><p>XP Reward: ${data.challenge.xp_reward}</p>`;
  } catch (error) {
    node.innerHTML = `<p>${error.message}</p>`;
  }
}

async function loadPaperColleges() {
  const select = document.getElementById('papersCollegeFilter');
  if (!select || !window.CollegeOSApi) return;
  try {
    const me = await window.CollegeOSApi.getMe();
    const homeCollege = me.user?.college_name;
    const { colleges } = await window.CollegeOSApi.getColleges();
    select.innerHTML = `<option value="">${homeCollege ? `My College (${homeCollege})` : 'My College'}</option>` + colleges.map((c) => `<option value="${c.name}">${c.name}</option>`).join('');
  } catch {
    // Keep default fallback.
  }
}

function renderPapersFeed(papers) {
  const feed = document.getElementById('papersFeed');
  if (!feed) return;

  if (!papers.length) {
    feed.innerHTML = '<div class="empty-state">No papers found for selected filters.</div>';
    return;
  }

  feed.innerHTML = papers
    .map((p) => {
      const openAction = p.paper_url ? `<a class="btn secondary" href="${p.paper_url}" target="_blank" rel="noopener">Open Paper PDF</a>` : '<span class="pill">No file link yet</span>';
      return `
        <article class="resource-card">
          <h3>${p.exam_name}</h3>
          <div class="resource-meta">
            <span class="pill">${p.subject}</span>
            <span class="pill">Year ${p.year}</span>
            <span class="pill">${p.college_name || 'All Colleges'}</span>
          </div>
          <div class="actions">
            ${openAction}
            <a class="btn secondary" href="${p.summary_note_url || 'notes-library.html'}">Summary Notes</a>
            <button class="btn primary" type="button">Revision Checklist</button>
          </div>
        </article>
      `;
    })
    .join('');
}

async function loadPapers() {
  const feed = document.getElementById('papersFeed');
  const status = document.getElementById('papersStatus');
  if (!feed) return;

  const college = document.getElementById('papersCollegeFilter')?.value || '';
  const search = (document.getElementById('paperSearch')?.value || '').toLowerCase();

  try {
    const data = await apiRequest(`/api/content/previous-papers${college ? `?college=${encodeURIComponent(college)}` : ''}`);
    if (!data || typeof data !== 'object') {
      throw new Error('Failed to load papers');
    }

    if (data.code === 'UPGRADE_REQUIRED') {
      feed.innerHTML = '<div class="empty-state"><h3>Premium Required</h3><p>Previous year papers are locked for Free plan.</p><a class="btn warn" href="pricing.html">Upgrade to Premium (Rs.49/month)</a></div>';
      if (status) status.textContent = data.error;
      return;
    }

    const rows = (data.papers || []).filter((p) => {
      const text = `${p.exam_name} ${p.subject}`.toLowerCase();
      return !search || text.includes(search);
    });

    renderPapersFeed(rows);
    if (status) status.textContent = `Loaded ${rows.length} papers`;
  } catch (error) {
    if (error?.code === 'UPGRADE_REQUIRED') {
      feed.innerHTML = '<div class="empty-state"><h3>Premium Required</h3><p>Previous year papers are locked for Free plan.</p><a class="btn warn" href="pricing.html">Upgrade to Premium (Rs.49/month)</a></div>';
      if (status) status.textContent = error.message;
      return;
    }
    feed.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

async function loadBadges() {
  const grid = document.getElementById('badgesGrid');
  if (!grid) return;
  try {
    const data = await apiRequest('/api/content/badges');
    grid.innerHTML = data.badges.map((b) => `<article class="card"><h3>${b.name}</h3><p>${b.description}</p></article>`).join('');
  } catch (error) {
    grid.innerHTML = `<p>${error.message}</p>`;
  }
}

function bindSupportForm() {
  const form = document.getElementById('supportForm');
  if (!form || !window.CollegeOSApi) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const issueType = document.getElementById('supportIssue').value;
    const priority = document.getElementById('supportPriority').value;
    const description = document.getElementById('supportDescription').value.trim();
    const feedback = document.getElementById('supportFeedback');

    try {
      const payload = await apiRequest('/api/content/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueType, priority, description })
      });
      feedback.textContent = `Ticket #${payload.ticket.id} submitted successfully.`;
      form.reset();
    } catch (error) {
      feedback.textContent = error.message;
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadPaperColleges();
  await loadPapers();

  document.getElementById('refreshPapersBtn')?.addEventListener('click', loadPapers);
  document.getElementById('paperSearch')?.addEventListener('input', loadPapers);
  document.getElementById('papersCollegeFilter')?.addEventListener('change', loadPapers);

  loadDailyChallenge();
  loadBadges();
  bindSupportForm();
});
