(function () {
  let currentPage = 1;
  let currentFilters = { status: '', urgency: '', sort_by: '' };

  function escapeHtml(text) {
    const value = String(text || '');
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return value.replace(/[&<>"']/g, (m) => map[m]);
  }

  function goToCreateRequest() {
    window.location.href = 'create-support-request.html';
  }

  function goToDashboard() {
    window.location.href = '/support-dashboard';
  }

  function goToRequest(id) {
    window.location.href = `support-request-detail.html?id=${id}`;
  }

  async function loadRequests() {
    try {
      let url = `/api/support/requests?page=${currentPage}&limit=10`;

      if (currentFilters.status) url += `&status=${currentFilters.status}`;
      if (currentFilters.urgency) url += `&urgency=${currentFilters.urgency}`;
      if (currentFilters.sort_by) url += `&sort_by=${currentFilters.sort_by}`;

      const response = await fetch(url, { credentials: 'include' });

      if (!response.ok) {
        if (response.status === 403) {
          const payload = await response.json().catch(() => ({}));
          const message = String(payload.error || 'Access denied').trim();
          if (/profile incomplete/i.test(message) || /academic profile/i.test(message)) {
            alert('Please complete your academic profile first');
            window.location.href = 'settings.html';
            return;
          }
          const container = document.getElementById('requests-container');
          if (container) {
            container.innerHTML = `
              <div class="empty-state">
                <div class="empty-icon"><i class="fas fa-lock"></i></div>
                <h3 class="empty-title">Support Access Restricted</h3>
                <p class="empty-desc">${escapeHtml(message)}</p>
              </div>
            `;
          }
          return;
        }
        throw new Error('Failed to load requests');
      }

      const data = await response.json();
      renderRequests(data.requests);
      renderPagination(data.pagination);
      updateStats();
    } catch (error) {
      console.error('Error loading requests:', error);
    }
  }

  function renderRequests(requests) {
    const container = document.getElementById('requests-container');
    if (!container) return;

    if (!requests || requests.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon"><i class="fas fa-lightbulb"></i></div>
          <h3 class="empty-title">No requests found</h3>
          <p class="empty-desc">Be the first to ask for help or check back later</p>
          <a class="btn-primary" href="create-support-request.html">
            <i class="fas fa-plus"></i> Create First Request
          </a>
        </div>
      `;
      return;
    }

    container.innerHTML = requests
      .map(
        (req) => `
      <div class="request-item ${req.urgency_level === 'urgent' ? 'urgent' : ''} ${req.status === 'solved' ? 'solved' : ''}" data-request-id="${Number(req.id)}" role="button" tabindex="0">
        <div class="request-header">
          <h3 class="request-title">${escapeHtml(req.title)}</h3>
          <div class="request-badges">
            <span class="badge badge-${escapeHtml(req.urgency_level)}">${escapeHtml(String(req.urgency_level || '').toUpperCase())}</span>
            <span class="badge badge-${escapeHtml(req.status)}">${escapeHtml(String(req.status || '').toUpperCase())}</span>
          </div>
        </div>
        <p class="request-desc">${escapeHtml(String(req.description || '').substring(0, 150))}...</p>
        <div class="request-meta">
          <div class="meta-item">
            <i class="fas fa-user"></i>
            <span>${escapeHtml(req.full_name)}</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-comments"></i>
            <span>${Number(req.answer_count || 0)} answers</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-check"></i>
            <span>${Number(req.accepted_count || 0)} solved</span>
          </div>
          <div class="meta-item">
            <i class="fas fa-calendar"></i>
            <span>${new Date(req.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    `
      )
      .join('');
  }

  function renderPagination(pagination) {
    const container = document.getElementById('pagination');
    if (!container) return;

    if (!pagination || pagination.pages <= 1) {
      container.innerHTML = '';
      return;
    }

    const pages = [];
    for (let i = 1; i <= pagination.pages; i += 1) {
      pages.push(`<button class="page-btn ${i === currentPage ? 'active' : ''}" type="button" data-page="${i}">${i}</button>`);
    }
    container.innerHTML = pages.join('');
  }

  async function updateStats() {
    try {
      const response = await fetch('/api/support/requests?limit=1000', { credentials: 'include' });
      if (!response.ok) {
        if (response.status === 403) return;
        throw new Error('Failed to load support stats');
      }
      const data = await response.json();
      const requests = Array.isArray(data.requests) ? data.requests : [];

      const open = requests.filter((r) => r.status === 'open').length;
      const solved = requests.filter((r) => r.status === 'solved').length;
      const urgent = requests.filter((r) => r.urgency_level === 'urgent').length;

      const openNode = document.getElementById('open-count');
      const solvedNode = document.getElementById('solved-count');
      const urgentNode = document.getElementById('urgent-count');
      if (openNode) openNode.textContent = String(open);
      if (solvedNode) solvedNode.textContent = String(solved);
      if (urgentNode) urgentNode.textContent = String(urgent);
    } catch (err) {
      console.error('Error updating stats:', err);
    }
  }

  function applyFilters() {
    const statusFilter = document.getElementById('status-filter');
    const urgencyFilter = document.getElementById('urgency-filter');
    const sortFilter = document.getElementById('sort-filter');

    currentFilters.status = statusFilter ? statusFilter.value : '';
    currentFilters.urgency = urgencyFilter ? urgencyFilter.value : '';
    currentFilters.sort_by = sortFilter ? sortFilter.value : '';
    currentPage = 1;
    loadRequests();
  }

  function filterStatus(status) {
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) statusFilter.value = status;
    applyFilters();
  }

  function filterUrgency(urgency) {
    const urgencyFilter = document.getElementById('urgency-filter');
    if (urgencyFilter) urgencyFilter.value = urgency;
    applyFilters();
  }

  function handleSearch() {
    const input = document.getElementById('search-box');
    const query = input ? input.value.trim() : '';
    if (query.length < 2) {
      applyFilters();
      return;
    }

    currentPage = 1;
    fetch(`/api/support/search?query=${encodeURIComponent(query)}&page=1&limit=10`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => renderRequests(data.results))
      .catch((e) => console.error('Search failed:', e));
  }

  function bindEvents() {
    const askHelpBtn = document.getElementById('askHelpBtn');
    const mySupportDashboardBtn = document.getElementById('mySupportDashboardBtn');
    const browseOpenBtn = document.getElementById('browseOpenBtn');
    const browseSolvedBtn = document.getElementById('browseSolvedBtn');
    const browseUrgentBtn = document.getElementById('browseUrgentBtn');
    const searchBox = document.getElementById('search-box');
    const statusFilter = document.getElementById('status-filter');
    const urgencyFilter = document.getElementById('urgency-filter');
    const sortFilter = document.getElementById('sort-filter');
    const pagination = document.getElementById('pagination');
    const requestsContainer = document.getElementById('requests-container');

    askHelpBtn?.addEventListener('click', goToCreateRequest);
    mySupportDashboardBtn?.addEventListener('click', goToDashboard);
    browseOpenBtn?.addEventListener('click', () => filterStatus('open'));
    browseSolvedBtn?.addEventListener('click', () => filterStatus('solved'));
    browseUrgentBtn?.addEventListener('click', () => filterUrgency('urgent'));

    searchBox?.addEventListener('input', handleSearch);
    statusFilter?.addEventListener('change', applyFilters);
    urgencyFilter?.addEventListener('change', applyFilters);
    sortFilter?.addEventListener('change', applyFilters);

    pagination?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-page]');
      if (!btn) return;
      currentPage = Number(btn.dataset.page || 1);
      loadRequests();
    });

    requestsContainer?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-request-id]');
      if (!row) return;
      goToRequest(Number(row.dataset.requestId));
    });

    requestsContainer?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const row = event.target.closest('[data-request-id]');
      if (!row) return;
      event.preventDefault();
      goToRequest(Number(row.dataset.requestId));
    });
  }

  window.addEventListener('load', function () {
    bindEvents();
    loadRequests();
  });
})();
