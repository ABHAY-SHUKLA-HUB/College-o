(function () {
  function escapeHtml(text) {
    const value = String(text || '');
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return value.replace(/[&<>"']/g, (m) => map[m]);
  }

  async function loadDashboard() {
    try {
      const response = await fetch('/api/support/my-dashboard', { credentials: 'include' });

      if (!response.ok) {
        if (response.status === 403) {
          alert('Please complete your academic profile first');
          window.location.href = 'academic-onboarding.html';
        }
        throw new Error('Failed to load dashboard');
      }

      const data = await response.json();
      renderDashboard(data);
    } catch (error) {
      console.error('Error:', error);
    }
  }

  function renderDashboard(data) {
    renderHelperBadge(data.helper_stats || {});
    renderStats(data.helper_stats || {}, data.my_requests || [], data.my_answers || []);
    renderMyRequests(data.my_requests || []);
    renderMyAnswers(data.my_answers || []);
  }

  function renderHelperBadge(stats) {
    const container = document.getElementById('helper-badge');
    if (!container) return;

    const level = stats.reputation_level || 'New Helper';
    const points = Number(stats.total_points_earned || 0);

    let description = '';
    if (level === 'New Helper') description = 'Start helping others and earn points';
    else if (level === 'Trusted Helper') description = "You're gaining trust in your community";
    else if (level === 'Top Academic Helper') description = "You're one of the top helpers!";
    else if (level === 'Verified Support Contributor') description = 'Expert level contributor';

    container.innerHTML = `
      <div class="helper-badge">
        <i class="fas fa-star"></i>
        <div class="badge-level">${escapeHtml(level)}</div>
        <div class="badge-description">${escapeHtml(description)}</div>
        <div style="margin-top: 10px; font-size: 1.2em; font-weight: 700;">${points} Points</div>
      </div>
    `;
  }

  function renderStats(stats, myRequests, myAnswers) {
    const container = document.getElementById('stats-grid');
    if (!container) return;

    const solvedRequests = myRequests.filter((r) => Number(r.solved || 0) > 0).length;

    container.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-question-circle"></i></div>
        <div class="stat-label">Questions Asked</div>
        <div class="stat-value">${myRequests.length}</div>
        <div class="stat-description">${solvedRequests} solved</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-lightbulb"></i></div>
        <div class="stat-label">Answers Given</div>
        <div class="stat-value">${myAnswers.length}</div>
        <div class="stat-description">${Number(stats.accepted_answers || 0)} accepted</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-star"></i></div>
        <div class="stat-label">Support Points</div>
        <div class="stat-value">${Number(stats.total_points_earned || 0)}</div>
        <div class="stat-description">Earned by helping peers</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon"><i class="fas fa-trophy"></i></div>
        <div class="stat-label">Helper Level</div>
        <div class="stat-value">${String(Number(stats.total_answers || 0)).padStart(2, '0')}</div>
        <div class="stat-description">${escapeHtml(stats.reputation_level || 'New Helper')}</div>
      </div>
    `;
  }

  function renderMyRequests(requests) {
    const container = document.getElementById('my-requests');
    if (!container) return;

    if (!requests.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><i class="fas fa-inbox"></i></div>
          <h3 class="empty-title">No requests yet</h3>
          <p class="empty-desc">Ask your first question to get help from peers</p>
          <a class="btn-primary" href="create-support-request.html"><i class="fas fa-plus"></i> Ask for Help</a>
        </div>
      `;
      return;
    }

    container.innerHTML = `<div class="activity-list">${requests
      .map(
        (req) => `
      <a class="activity-item" href="support-request-detail.html?id=${Number(req.id)}">
        <div class="activity-title">${escapeHtml(req.title)}</div>
        <div class="activity-meta">
          Asked ${new Date(req.created_at).toLocaleDateString()} • Status: ${escapeHtml(String(req.status || '').toUpperCase())}
        </div>
        <div class="activity-stat">
          <i class="fas fa-comments"></i> ${Number(req.answer_count || 0)} answers •
          <i class="fas fa-check"></i> ${Number(req.solved || 0)} solved
        </div>
      </a>
    `
      )
      .join('')}</div>`;
  }

  function renderMyAnswers(answers) {
    const container = document.getElementById('my-answers');
    if (!container) return;

    if (!answers.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><i class="fas fa-hand-holding-heart"></i></div>
          <h3 class="empty-title">You haven't answered yet</h3>
          <p class="empty-desc">Help other students and earn points</p>
          <a class="btn-primary" href="support-hub.html"><i class="fas fa-search"></i> Browse Questions</a>
        </div>
      `;
      return;
    }

    container.innerHTML = `<div class="activity-list">${answers
      .map(
        (ans) => `
      <a class="activity-item" href="support-request-detail.html?id=${Number(ans.request_id)}">
        <div class="activity-title">${escapeHtml(ans.title)}</div>
        <div class="activity-meta">
          Answered ${new Date(ans.created_at).toLocaleDateString()}
          ${ans.is_accepted ? '<span style="color: #51cf66; font-weight: 700;"> ✓ Accepted</span>' : ''}
        </div>
        <div class="activity-stat"><i class="fas fa-thumbs-up"></i> ${Number(ans.helpful_count || 0)} found helpful</div>
      </a>
    `
      )
      .join('')}</div>`;
  }

  window.addEventListener('load', function () {
    loadDashboard();
  });
})();
