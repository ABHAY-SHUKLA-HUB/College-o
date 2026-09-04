/**
 * Student Coding Arena Controller (Part 3)
 * Manages dynamic multi-view SPA, dual-pane LeetCode interface, strict mode anti-cheat listeners, and API calls.
 */

(function () {
  'use strict';

  // Global State
  let state = {
    activeTab: 'contests', // 'contests', 'season-leaderboard', 'my-submissions'
    contestFilter: 'all', // 'all', 'live', 'scheduled', 'completed'
    contests: [],
    activeContest: null,
    activeProblem: null,
    activeLanguage: 'python',
    codeBuffer: {}, // problemId -> code
    customInput: '',
    strictModeActive: false,
    strictModeListenersAttached: false,
    currentContestIdForStrict: null,
    activeTimerInterval: null
  };

  // DOM Container Targets
  let elements = {};

  document.addEventListener('DOMContentLoaded', () => {
    initElements();
    initNavigationTabs();
    loadModuleSettingsAndInit();
  });

  function initElements() {
    elements.pageBody = document.querySelector('.page-body') || document.querySelector('#contentMount');
  }

  /**
   * Main Header Tabs
   */
  function initNavigationTabs() {
    const navPills = document.getElementById('studentCodingNavPills');
    if (!navPills) return;

    navPills.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-pill');
      if (!btn) return;
      const tab = btn.dataset.tab;
      if (tab) {
        detachStrictModeListeners();
        state.activeTab = tab;
        document.querySelectorAll('.nav-pill').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderActiveView();
      }
    });
  }

  /**
   * Language identifier formatter
   */
  function formatLanguageLabels(langs) {
    const map = {
      python: 'Python',
      javascript: 'JavaScript',
      js: 'JavaScript',
      cpp: 'C++',
      'c++': 'C++',
      c: 'C',
      java: 'Java'
    };
    if (!Array.isArray(langs) || !langs.length) return 'Python, JavaScript, C++, C, Java';
    return langs.map((l) => map[String(l).toLowerCase()] || String(l)).join(', ');
  }

  /**
   * Initialize module configuration status
   */
  async function loadModuleSettingsAndInit() {
    try {
      const res = await fetch('/api/coding-challenges/settings', { credentials: 'include' });
      const settings = await res.json();

      if (!settings.enabled) {
        renderModuleDisabledView();
        return;
      }

      renderActiveView();
    } catch (err) {
      console.error('[Student Coding] Error loading settings:', err);
      renderActiveView();
    }
  }

  function renderModuleDisabledView() {
    if (!elements.pageBody) return;
    elements.pageBody.innerHTML = `
      <div class="coding-card text-center" style="padding: 48px 24px; max-width: 600px; margin: 40px auto;">
        <i class="fa-solid fa-lock" style="font-size: 3rem; color: #ef4444; margin-bottom: 16px;"></i>
        <h2>Coding Challenges Disabled</h2>
        <p style="color: var(--text-muted, #64748b); max-width: 500px; margin: 8px auto 24px;">
          The Coding Challenges module is currently disabled by the campus administrator. Please check back later.
        </p>
        <a href="dashboard.html" class="btn btn-primary"><i class="fa-solid fa-arrow-left"></i> Return to Dashboard</a>
      </div>
    `;
  }

  /**
   * Route active view render
   */
  function renderActiveView() {
    detachStrictModeListeners();
    if (state.activeTab === 'contests') {
      renderContestsHubView();
    } else if (state.activeTab === 'season-leaderboard') {
      renderSeasonLeaderboardView();
    } else if (state.activeTab === 'my-certificates') {
      renderMyCertificatesView();
    } else if (state.activeTab === 'my-submissions') {
      renderMySubmissionsView();
    }
  }

  /**
   * Skeleton Card Placeholder Generator
   */
  function renderSkeletonCards() {
    return `
      <div class="contest-card skeleton-card">
        <div class="skeleton-line" style="width: 40%; height: 22px; margin-bottom: 16px; border-radius: 999px;"></div>
        <div class="skeleton-line" style="width: 70%; height: 26px; margin-bottom: 12px; border-radius: 8px;"></div>
        <div class="skeleton-line" style="width: 95%; height: 16px; margin-bottom: 8px; border-radius: 6px;"></div>
        <div class="skeleton-line" style="width: 80%; height: 16px; margin-bottom: 24px; border-radius: 6px;"></div>
        <div class="skeleton-line" style="width: 100%; height: 42px; margin-top: auto; border-radius: 10px;"></div>
      </div>
      <div class="contest-card skeleton-card">
        <div class="skeleton-line" style="width: 40%; height: 22px; margin-bottom: 16px; border-radius: 999px;"></div>
        <div class="skeleton-line" style="width: 75%; height: 26px; margin-bottom: 12px; border-radius: 8px;"></div>
        <div class="skeleton-line" style="width: 90%; height: 16px; margin-bottom: 8px; border-radius: 6px;"></div>
        <div class="skeleton-line" style="width: 85%; height: 16px; margin-bottom: 24px; border-radius: 6px;"></div>
        <div class="skeleton-line" style="width: 100%; height: 42px; margin-top: auto; border-radius: 10px;"></div>
      </div>
      <div class="contest-card skeleton-card">
        <div class="skeleton-line" style="width: 40%; height: 22px; margin-bottom: 16px; border-radius: 999px;"></div>
        <div class="skeleton-line" style="width: 65%; height: 26px; margin-bottom: 12px; border-radius: 8px;"></div>
        <div class="skeleton-line" style="width: 92%; height: 16px; margin-bottom: 8px; border-radius: 6px;"></div>
        <div class="skeleton-line" style="width: 78%; height: 16px; margin-bottom: 24px; border-radius: 6px;"></div>
        <div class="skeleton-line" style="width: 100%; height: 42px; margin-top: auto; border-radius: 10px;"></div>
      </div>
    `;
  }

  /**
   * ==========================================
   * 1. CONTESTS HUB VIEW
   * ==========================================
   */
  async function renderContestsHubView() {
    state.activeContest = null;
    state.activeProblem = null;

    if (!elements.pageBody) return;

    elements.pageBody.innerHTML = `
      <section class="coding-hero">
        <div class="coding-hero-badge">
          <i class="fa-solid fa-code"></i> WEEKLY CHALLENGES ARENA
        </div>
        <h1>Practice, Compete & Elevate Your Ranking</h1>
        <p>Participate in scheduled programming contests, solve algorithmic problems, earn verifiable certificates, and climb the campus overall leaderboard.</p>
      </section>

      <div class="coding-toolbar">
        <div class="filter-pills" id="contestFilterPills">
          <button class="filter-pill ${state.contestFilter === 'all' ? 'active' : ''}" data-filter="all">All Contests</button>
          <button class="filter-pill ${state.contestFilter === 'live' ? 'active' : ''}" data-filter="live"><i class="fa-solid fa-circle live-dot"></i> Live</button>
          <button class="filter-pill ${state.contestFilter === 'scheduled' ? 'active' : ''}" data-filter="scheduled">Upcoming</button>
          <button class="filter-pill ${state.contestFilter === 'completed' ? 'active' : ''}" data-filter="completed">Completed</button>
        </div>
      </div>

      <div id="contestsContainer" class="contests-grid">
        ${renderSkeletonCards()}
      </div>
    `;

    document.getElementById('contestFilterPills').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-pill');
      if (!btn) return;
      state.contestFilter = btn.dataset.filter;
      document.querySelectorAll('#contestFilterPills .filter-pill').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderContestCardsList();
    });

    try {
      const res = await fetch('/api/coding-challenges/contests', { credentials: 'include' });
      if (!res.ok) throw new Error('Network error');
      const data = await res.json();
      state.contests = data.contests || [];
      updateFilterPillCounts();
      renderContestCardsList();
    } catch (err) {
      console.error('Failed to fetch contests:', err);
      const container = document.getElementById('contestsContainer');
      if (container) {
        container.innerHTML = `
          <div class="coding-card text-center error-state-card" style="grid-column: 1 / -1; padding: 48px 24px;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; color: #ef4444; margin-bottom: 12px;"></i>
            <h3>Unable to load Coding Challenges</h3>
            <p style="color: var(--text-muted, #64748b); margin: 8px 0 20px;">Please check your connection and try again.</p>
            <button class="btn btn-primary" id="retryContestsBtn"><i class="fa-solid fa-rotate-right"></i> Retry</button>
          </div>
        `;
        document.getElementById('retryContestsBtn')?.addEventListener('click', renderContestsHubView);
      }
    }
  }

  function updateFilterPillCounts() {
    const pills = document.querySelectorAll('#contestFilterPills .filter-pill');
    if (!pills.length) return;

    const totalCount = state.contests.length;
    const liveCount = state.contests.filter((c) => c.computed_status === 'live').length;
    const upcomingCount = state.contests.filter((c) => c.computed_status === 'scheduled').length;
    const completedCount = state.contests.filter((c) => c.computed_status === 'completed' || c.computed_status === 'finalized').length;

    pills.forEach((pill) => {
      const filter = pill.dataset.filter;
      if (filter === 'all') pill.innerHTML = `All (${totalCount})`;
      else if (filter === 'live') pill.innerHTML = `<i class="fa-solid fa-circle live-dot"></i> Live (${liveCount})`;
      else if (filter === 'scheduled') pill.innerHTML = `Upcoming (${upcomingCount})`;
      else if (filter === 'completed') pill.innerHTML = `Completed (${completedCount})`;
    });
  }

  function renderContestCardsList() {
    const container = document.getElementById('contestsContainer');
    if (!container) return;

    let filtered = state.contests;
    if (state.contestFilter !== 'all') {
      if (state.contestFilter === 'completed') {
        filtered = state.contests.filter((c) => c.computed_status === 'completed' || c.computed_status === 'finalized');
      } else {
        filtered = state.contests.filter((c) => c.computed_status === state.contestFilter);
      }
    }

    // Deduplicate items by unique contest ID to prevent duplicate UI cards
    const seenContestIds = new Set();
    filtered = filtered.filter((c) => {
      if (!c || !c.id) return true;
      if (seenContestIds.has(c.id)) return false;
      seenContestIds.add(c.id);
      return true;
    });

    if (!filtered.length) {
      const emptyMessages = {
        live: {
          icon: 'fa-tower-broadcast',
          title: 'No Live Contests Right Now',
          desc: 'There are no active coding contests right now. Check Upcoming for the next challenge.'
        },
        scheduled: {
          icon: 'fa-calendar-xmark',
          title: 'No Upcoming Contests',
          desc: 'No coding challenge has been scheduled yet.'
        },
        completed: {
          icon: 'fa-box-archive',
          title: 'No Completed Contests',
          desc: 'Completed contests will appear here after they end.'
        },
        all: {
          icon: 'fa-folder-open',
          title: 'No Contests Available',
          desc: 'There are no coding challenges available at this time.'
        }
      };

      const msg = emptyMessages[state.contestFilter] || emptyMessages.all;

      container.innerHTML = `
        <div class="coding-card text-center arena-empty-card" style="padding: 48px 24px; grid-column: 1 / -1;">
          <div class="empty-icon-wrap"><i class="fa-solid ${msg.icon}"></i></div>
          <h3>${msg.title}</h3>
          <p>${msg.desc}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered
      .map((contest) => {
        const status = contest.computed_status || 'scheduled';
        const isLive = status === 'live';
        const isCompleted = status === 'completed' || status === 'finalized';

        let badgeClass = 'status-scheduled';
        let badgeLabel = '<i class="fa-regular fa-clock"></i> UPCOMING';

        if (isLive) {
          badgeClass = 'status-live';
          badgeLabel = '<i class="fa-solid fa-circle live-dot"></i> LIVE NOW';
        } else if (isCompleted) {
          badgeClass = 'status-completed';
          badgeLabel = '<i class="fa-solid fa-check"></i> COMPLETED';
        }

        const startDateStr = contest.start_time ? new Date(contest.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBA';
        const durationStr = contest.duration_minutes ? `${contest.duration_minutes} min` : '60 min';
        const langsFormatted = formatLanguageLabels(contest.allowed_languages);
        const problemsCount = contest.problems_count || contest.total_problems || (contest.problems ? contest.problems.length : null);

        const cardExtraClass = isLive ? 'live-card-priority' : '';

        return `
        <div class="contest-card ${cardExtraClass}">
          <div class="contest-card-header">
            <span class="contest-badge ${badgeClass}">${badgeLabel}</span>
            ${contest.strict_mode_enabled ? '<span class="strict-mode-badge" title="Strict Mode Active"><i class="fa-solid fa-shield-halved"></i> Strict Mode</span>' : ''}
          </div>
          <h3 class="contest-card-title" title="${escapeHtml(contest.title)}">${escapeHtml(contest.title)}</h3>
          <p class="contest-card-desc">${escapeHtml(contest.description || 'Weekly algorithmic programming contest.')}</p>
          
          <div class="contest-meta-list">
            <div class="meta-item"><i class="fa-regular fa-calendar-days"></i> <span><strong>Start:</strong> ${startDateStr}</span></div>
            <div class="meta-item"><i class="fa-regular fa-clock"></i> <span><strong>Duration:</strong> ${durationStr}</span></div>
            <div class="meta-item"><i class="fa-solid fa-code"></i> <span><strong>Languages:</strong> ${escapeHtml(langsFormatted)}</span></div>
            ${problemsCount ? `<div class="meta-item"><i class="fa-solid fa-list-check"></i> <span><strong>Problems:</strong> ${problemsCount}</span></div>` : ''}
          </div>

          <div class="contest-card-footer">
            <button class="btn btn-primary btn-block view-contest-btn" data-id="${contest.id}">
              ${
                isLive
                  ? '<i class="fa-solid fa-play"></i> Enter Arena'
                  : isCompleted
                  ? '<i class="fa-solid fa-trophy"></i> View Results'
                  : '<i class="fa-regular fa-calendar-check"></i> View Rules & Schedule'
              }
            </button>
          </div>
        </div>
      `;
      })
      .join('');

    container.querySelectorAll('.view-contest-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        loadAndRenderContestDetail(btn.dataset.id);
      });
    });
  }

  /**
   * ==========================================
   * 2. CONTEST DETAIL VIEW
   * ==========================================
   */
  async function loadAndRenderContestDetail(contestId) {
    if (!elements.pageBody) return;
    elements.pageBody.innerHTML = `
      <div class="coding-card text-center" style="padding: 48px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:12px;">Loading Contest Arena...</p></div>
    `;

    try {
      const res = await fetch(`/api/coding-challenges/contests/${contestId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Contest not available');
      const data = await res.json();
      state.activeContest = data.contest;
      renderContestDetailView();
    } catch (err) {
      console.error(err);
      elements.pageBody.innerHTML = `
        <div class="coding-card text-center" style="color: #ef4444; padding: 40px;">
          <h3>Failed to load contest</h3>
          <button class="btn btn-secondary back-to-contests-btn" style="margin-top:16px;"><i class="fa-solid fa-arrow-left"></i> Back to Contests</button>
        </div>
      `;
      elements.pageBody.querySelector('.back-to-contests-btn').addEventListener('click', renderContestsHubView);
    }
  }

  function renderContestDetailView() {
    const contest = state.activeContest;
    if (!contest || !elements.pageBody) return;

    const status = contest.computed_status || 'scheduled';
    const isLive = status === 'live';
    const isScheduled = status === 'scheduled';
    const isCompleted = status === 'completed';

    const startDateStr = contest.start_time ? new Date(contest.start_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBA';
    const endDateStr = contest.end_time ? new Date(contest.end_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBA';
    const langsStr = Array.isArray(contest.allowed_languages) ? contest.allowed_languages.join(', ') : 'python, javascript, cpp, java';

    elements.pageBody.innerHTML = `
      <div class="contest-detail-container">
        <button class="btn btn-link back-to-contests-btn" style="margin-bottom: 16px;"><i class="fa-solid fa-arrow-left"></i> Back to All Contests</button>

        <div class="coding-card contest-header-card">
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <span class="contest-badge ${isLive ? 'status-live' : isScheduled ? 'status-scheduled' : 'status-completed'}">
                ${isLive ? '● LIVE CONTEST' : isScheduled ? 'UPCOMING CONTEST' : 'COMPLETED CONTEST'}
              </span>
              <h1 style="margin: 8px 0 4px; font-size: 1.8rem;">${escapeHtml(contest.title)}</h1>
              <p style="color: var(--text-muted, #64748b); margin:0;">${escapeHtml(contest.description || '')}</p>
            </div>
            ${
              contest.registration_required && !contest.is_registered
                ? `<button class="btn btn-success btn-lg register-btn" data-id="${contest.id}"><i class="fa-solid fa-user-plus"></i> Register for Contest</button>`
                : contest.is_registered
                  ? `<span class="badge-registered"><i class="fa-solid fa-circle-check"></i> Registered Participant</span>`
                  : ''
            }
          </div>

          <div class="contest-info-bar">
            <div><i class="fa-regular fa-calendar-check"></i> <strong>Start:</strong> ${startDateStr}</div>
            <div><i class="fa-regular fa-calendar-xmark"></i> <strong>End:</strong> ${endDateStr}</div>
            <div><i class="fa-regular fa-hourglass-half"></i> <strong>Duration:</strong> ${contest.duration_minutes || 60} Mins</div>
            <div><i class="fa-solid fa-code"></i> <strong>Languages:</strong> ${escapeHtml(langsStr)}</div>
          </div>
        </div>

        ${
          contest.strict_mode_enabled
            ? `
          <div class="alert alert-warning-custom">
            <i class="fa-solid fa-shield-halved" style="font-size: 1.3rem;"></i>
            <div>
              <strong>Strict Mode Anti-Cheat Active:</strong>
              This contest enforces strict integrity monitoring. Code paste restrictions, right-click blocks, and tab-switch/focus events may be recorded.
            </div>
          </div>
        `
            : ''
        }

        ${
          isScheduled
            ? `
          <div class="coding-card text-center" style="padding: 40px; background: linear-gradient(135deg, #1e1b4b, #312e81); color: #fff;">
            <i class="fa-regular fa-clock" style="font-size: 3rem; margin-bottom: 16px; color: #818cf8;"></i>
            <h2>Contest Begins Soon</h2>
            <p style="color: rgba(255,255,255,0.8); max-width: 550px; margin: 8px auto 20px;">
              Problem statements and submission console will unlock automatically when the contest start time arrives at <strong>${startDateStr}</strong>.
            </p>
            <div id="contestCountdown" class="contest-countdown-timer">--:--:--</div>
          </div>
        `
            : ''
        }

        ${
          isLive || isCompleted
            ? `
          <div class="contest-tabs-bar">
            <button class="contest-tab-btn active" data-tab="problems"><i class="fa-solid fa-list-check"></i> Problem Set (${contest.problems ? contest.problems.length : 0})</button>
            <button class="contest-tab-btn" data-tab="leaderboard"><i class="fa-solid fa-trophy"></i> Contest Leaderboard</button>
          </div>

          <div id="contestTabContent">
            ${renderContestProblemsTabHTML(contest)}
          </div>
        `
            : ''
        }
      </div>
    `;

    // Attach listeners
    elements.pageBody.querySelector('.back-to-contests-btn').addEventListener('click', renderContestsHubView);

    const regBtn = elements.pageBody.querySelector('.register-btn');
    if (regBtn) {
      regBtn.addEventListener('click', async () => {
        try {
          await fetch(`/api/coding-challenges/contests/${contest.id}/register`, { method: 'POST', credentials: 'include' });
          loadAndRenderContestDetail(contest.id);
        } catch (err) {
          alert('Failed to register for contest');
        }
      });
    }

    if (isScheduled && contest.start_time) {
      startCountdownTimer(contest.start_time, 'contestCountdown');
    }

    const tabBtns = elements.pageBody.querySelectorAll('.contest-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        if (tab === 'problems') {
          document.getElementById('contestTabContent').innerHTML = renderContestProblemsTabHTML(contest);
          attachProblemSolveListeners();
        } else if (tab === 'leaderboard') {
          loadAndRenderContestLeaderboardTab(contest.id);
        }
      });
    });

    attachProblemSolveListeners();
  }

  function renderContestProblemsTabHTML(contest) {
    const problems = contest.problems || [];
    if (!problems.length) {
      return `
        <div class="coding-card text-center" style="padding: 40px; color: var(--text-muted, #64748b);">
          <i class="fa-solid fa-code" style="font-size:2rem; margin-bottom:10px;"></i>
          <p>No problems published for this contest yet.</p>
        </div>
      `;
    }

    return `
      <div class="problems-list-table-wrap">
        <table class="table custom-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>#</th>
              <th>Problem Title</th>
              <th>Difficulty</th>
              <th>Max Score</th>
              <th style="text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${problems
              .map((p, idx) => {
                const diffColor = p.difficulty === 'Easy' ? '#16a34a' : p.difficulty === 'Medium' ? '#d97706' : '#dc2626';
                const isSolved = p.solved;

                return `
                <tr>
                  <td>
                    ${isSolved ? '<span class="solved-icon" title="Solved"><i class="fa-solid fa-circle-check" style="color:#22c55e;"></i> Solved</span>' : '<span style="color:#94a3b8;"><i class="fa-regular fa-circle"></i> Todo</span>'}
                  </td>
                  <td><strong>P${idx + 1}</strong></td>
                  <td><a href="#" class="solve-prob-link" data-id="${p.id}"><strong>${escapeHtml(p.title)}</strong></a></td>
                  <td><span class="diff-badge" style="background: ${diffColor}18; color: ${diffColor};">${p.difficulty}</span></td>
                  <td><strong>${p.max_score} pts</strong></td>
                  <td style="text-align: right;">
                    <button class="btn btn-primary btn-sm solve-prob-btn" data-id="${p.id}">
                      ${isSolved ? '<i class="fa-solid fa-code"></i> Revise Code' : '<i class="fa-solid fa-laptop-code"></i> Solve Challenge'}
                    </button>
                  </td>
                </tr>
              `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function attachProblemSolveListeners() {
    const btns = elements.pageBody.querySelectorAll('.solve-prob-btn, .solve-prob-link');
    btns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        loadAndRenderProblemWorkspace(btn.dataset.id);
      });
    });
  }

  async function loadAndRenderContestLeaderboardTab(contestId) {
    const container = document.getElementById('contestTabContent');
    if (!container) return;

    container.innerHTML = `
      <div class="coding-card text-center" style="padding: 32px;"><i class="fa-solid fa-spinner fa-spin"></i> Fetching Contest Rankings...</div>
    `;

    try {
      const res = await fetch(`/api/coding-challenges/contests/${contestId}/leaderboard`, { credentials: 'include' });
      const data = await res.json();

      if (data.hidden) {
        container.innerHTML = `
          <div class="coding-card text-center" style="padding: 40px; color: var(--text-muted, #64748b);">
            <i class="fa-solid fa-eye-slash" style="font-size: 2.5rem; margin-bottom: 12px;"></i>
            <h3>Leaderboard Hidden</h3>
            <p>${escapeHtml(data.message || 'Leaderboard is currently disabled for this contest.')}</p>
          </div>
        `;
        return;
      }

      const rows = data.leaderboard || [];
      if (!rows.length) {
        container.innerHTML = `
          <div class="coding-card text-center" style="padding: 40px; color: var(--text-muted, #64748b);">
            <p>No submissions recorded yet for this contest leaderboard.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="leaderboard-table-wrap">
          <table class="table custom-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Student</th>
                <th>Score</th>
                <th>Problems Solved</th>
                <th>Penalty (Time)</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((row) => {
                  let rankBadge = `<strong>#${row.rank}</strong>`;
                  if (row.rank === 1) rankBadge = '🥇 <strong style="color:#d97706;">1st</strong>';
                  else if (row.rank === 2) rankBadge = '🥈 <strong style="color:#64748b;">2nd</strong>';
                  else if (row.rank === 3) rankBadge = '🥉 <strong style="color:#b45309;">3rd</strong>';

                  return `
                  <tr>
                    <td>${rankBadge}</td>
                    <td><strong>${escapeHtml(row.display_name)}</strong></td>
                    <td><strong style="color:#6366f1;">${row.total_score} pts</strong></td>
                    <td>${row.problems_solved}</td>
                    <td>${row.penalty_time} mins</td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div class="coding-card text-center" style="color:#ef4444;">Failed to load contest leaderboard</div>`;
    }
  }

  /**
   * ==========================================
   * 3. DUAL-PANE LEETCODE PROBLEM WORKSPACE
   * ==========================================
   */
  async function loadAndRenderProblemWorkspace(problemId) {
    if (!elements.pageBody) return;
    elements.pageBody.innerHTML = `
      <div class="coding-card text-center" style="padding: 48px;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top:12px;">Loading Problem Workspace...</p></div>
    `;

    try {
      const res = await fetch(`/api/coding-challenges/problems/${problemId}`, { credentials: 'include' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Problem details unavailable');
      }
      const data = await res.json();
      state.activeProblem = data.problem;

      // Select default starter code
      const prob = data.problem;
      const starterCode = prob.starter_code || {};
      state.activeLanguage = prob.allowed_languages && prob.allowed_languages.length ? prob.allowed_languages[0] : 'python';
      if (!state.codeBuffer[prob.id]) {
        state.codeBuffer[prob.id] = starterCode[state.activeLanguage] || getDefaultTemplateForLanguage(state.activeLanguage);
      }

      renderProblemWorkspaceView();
    } catch (err) {
      console.error(err);
      elements.pageBody.innerHTML = `
        <div class="coding-card text-center" style="color: #ef4444; padding: 40px;">
          <h3>${escapeHtml(err.message || 'Failed to load problem')}</h3>
          <button class="btn btn-secondary back-to-contest-detail-btn" style="margin-top:16px;"><i class="fa-solid fa-arrow-left"></i> Back to Contest</button>
        </div>
      `;
      const btn = elements.pageBody.querySelector('.back-to-contest-detail-btn');
      if (btn && state.activeContest) {
        btn.addEventListener('click', () => loadAndRenderContestDetail(state.activeContest.id));
      } else if (btn) {
        btn.addEventListener('click', renderContestsHubView);
      }
    }
  }

  function renderProblemWorkspaceView() {
    const prob = state.activeProblem;
    if (!prob || !elements.pageBody) return;

    const diffColor = prob.difficulty === 'Easy' ? '#16a34a' : prob.difficulty === 'Medium' ? '#d97706' : '#dc2626';

    elements.pageBody.innerHTML = `
      <div class="workspace-top-bar">
        <button class="btn btn-sm btn-secondary back-to-contest-btn"><i class="fa-solid fa-arrow-left"></i> ${escapeHtml(prob.contest_title || 'Contest')}</button>
        <div class="workspace-title">
          <span class="diff-badge" style="background: ${diffColor}22; color: ${diffColor};">${prob.difficulty}</span>
          <h2>${escapeHtml(prob.title)}</h2>
        </div>
        <div class="workspace-meta">
          <span><i class="fa-solid fa-award"></i> <strong>${prob.max_score} Score</strong></span>
          ${prob.strict_mode_enabled ? '<span class="strict-mode-pill"><i class="fa-solid fa-shield-halved"></i> Strict Mode</span>' : ''}
        </div>
      </div>

      <div class="workspace-split-container">
        <!-- LEFT PANE: STATEMENT & EXAMPLES -->
        <div class="workspace-left-pane">
          <div class="pane-tabs-header">
            <button class="pane-tab-btn active" data-pane-tab="statement"><i class="fa-solid fa-file-lines"></i> Description</button>
            <button class="pane-tab-btn" data-pane-tab="my-submissions"><i class="fa-solid fa-clock-rotate-left"></i> Submissions (${prob.my_submissions ? prob.my_submissions.length : 0})</button>
          </div>
          <div class="pane-content-body" id="leftPaneBody">
            ${renderProblemStatementHTML(prob)}
          </div>
        </div>

        <!-- RIGHT PANE: CODE EDITOR & RUNTIME CONSOLE -->
        <div class="workspace-right-pane">
          <div class="editor-header-bar">
            <select id="languageSelector" class="form-select select-language">
              ${(prob.allowed_languages || ['python', 'javascript', 'cpp', 'c', 'java'])
                .map((lang) => `<option value="${lang}" ${lang === state.activeLanguage ? 'selected' : ''}>${getLanguageLabel(lang)}</option>`)
                .join('')}
            </select>
            <button id="resetCodeBtn" class="btn btn-sm btn-outline-secondary" title="Reset starter template"><i class="fa-solid fa-rotate-left"></i> Reset</button>
          </div>

          <div class="editor-workspace-wrap">
            <textarea id="codeEditorArea" class="code-editor-textarea" spellcheck="false" placeholder="Write your code solution here...">${escapeHtml(state.codeBuffer[prob.id] || '')}</textarea>
          </div>

          <!-- BOTTOM CONSOLE / RESULTS PANEL -->
          <div class="console-drawer">
            <div class="console-tabs-bar">
              <button class="console-tab-btn active" data-console-tab="results">Testcase Output</button>
              <button class="console-tab-btn" data-console-tab="custom-input">Custom Input</button>
            </div>
            <div class="console-body" id="consoleBody">
              <div class="text-muted" style="font-size:13px; font-family:monospace;">Run your code against sample testcases or submit for full evaluation.</div>
            </div>
          </div>

          <div class="workspace-action-bar">
            <button id="runCodeBtn" class="btn btn-secondary btn-run"><i class="fa-solid fa-play"></i> Run Code</button>
            <button id="submitCodeBtn" class="btn btn-success btn-submit"><i class="fa-solid fa-paper-plane"></i> Submit Solution</button>
          </div>
        </div>
      </div>
    `;

    // Attach strict mode proctoring if enabled
    state.currentContestIdForStrict = prob.contest_id;
    if (prob.strict_mode_enabled) {
      attachStrictModeListeners(prob.contest_id, prob.id);
    } else {
      detachStrictModeListeners();
    }

    // Attach Editor event bindings
    const editor = document.getElementById('codeEditorArea');
    const langSelect = document.getElementById('languageSelector');

    editor.addEventListener('input', () => {
      state.codeBuffer[prob.id] = editor.value;
    });

    langSelect.addEventListener('change', (e) => {
      state.activeLanguage = e.target.value;
      const starter = (prob.starter_code && prob.starter_code[state.activeLanguage]) || getDefaultTemplateForLanguage(state.activeLanguage);
      state.codeBuffer[prob.id] = starter;
      editor.value = starter;
    });

    document.getElementById('resetCodeBtn').addEventListener('click', () => {
      if (confirm('Reset code to default template?')) {
        const starter = (prob.starter_code && prob.starter_code[state.activeLanguage]) || getDefaultTemplateForLanguage(state.activeLanguage);
        state.codeBuffer[prob.id] = starter;
        editor.value = starter;
      }
    });

    elements.pageBody.querySelector('.back-to-contest-btn').addEventListener('click', () => {
      detachStrictModeListeners();
      loadAndRenderContestDetail(prob.contest_id);
    });

    // Left pane tab switching
    const leftTabBtns = elements.pageBody.querySelectorAll('.workspace-left-pane .pane-tab-btn');
    leftTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        leftTabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.paneTab;
        const leftBody = document.getElementById('leftPaneBody');
        if (tab === 'statement') {
          leftBody.innerHTML = renderProblemStatementHTML(prob);
        } else if (tab === 'my-submissions') {
          leftBody.innerHTML = renderProblemSubmissionsHTML(prob.my_submissions || []);
        }
      });
    });

    // Bottom console tabs
    const consoleTabBtns = elements.pageBody.querySelectorAll('.console-tab-btn');
    consoleTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        consoleTabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.consoleTab;
        const body = document.getElementById('consoleBody');
        if (tab === 'custom-input') {
          body.innerHTML = `
            <textarea id="customInputArea" class="form-control" style="font-family:monospace; font-size:13px; height:70px;" placeholder="Enter custom input standard data...">${escapeHtml(state.customInput)}</textarea>
          `;
          document.getElementById('customInputArea').addEventListener('input', (e) => {
            state.customInput = e.target.value;
          });
        }
      });
    });

    // Action buttons
    document.getElementById('runCodeBtn').addEventListener('click', () => handleRunCode(prob.id));
    document.getElementById('submitCodeBtn').addEventListener('click', () => handleSubmitCode(prob.id));
  }

  function renderProblemStatementHTML(prob) {
    const examples = prob.examples || [];
    return `
      <div class="problem-statement-section">
        <div class="problem-desc-block">${escapeHtml(prob.statement).replace(/\n/g, '<br/>')}</div>

        ${
          prob.input_format
            ? `
          <div class="statement-subsection">
            <h4><i class="fa-solid fa-arrow-right-to-bracket"></i> Input Format</h4>
            <p>${escapeHtml(prob.input_format)}</p>
          </div>
        `
            : ''
        }

        ${
          prob.output_format
            ? `
          <div class="statement-subsection">
            <h4><i class="fa-solid fa-arrow-right-from-bracket"></i> Output Format</h4>
            <p>${escapeHtml(prob.output_format)}</p>
          </div>
        `
            : ''
        }

        ${
          prob.constraints
            ? `
          <div class="statement-subsection">
            <h4><i class="fa-solid fa-triangle-exclamation"></i> Constraints</h4>
            <pre class="constraints-box">${escapeHtml(prob.constraints)}</pre>
          </div>
        `
            : ''
        }

        <div class="statement-subsection">
          <h4><i class="fa-solid fa-vial"></i> Sample Examples</h4>
          ${
            examples.length
              ? examples
                  .map(
                    (ex, i) => `
                <div class="sample-example-card">
                  <div class="example-title">Example ${i + 1}</div>
                  <div class="example-box">
                    <div><strong>Input:</strong></div>
                    <pre>${escapeHtml(ex.sample_input)}</pre>
                    <div style="margin-top:6px;"><strong>Output:</strong></div>
                    <pre>${escapeHtml(ex.sample_output)}</pre>
                    ${ex.explanation ? `<div style="margin-top:6px; color:var(--text-muted);"><strong>Explanation:</strong> ${escapeHtml(ex.explanation)}</div>` : ''}
                  </div>
                </div>
              `
                  )
                  .join('')
              : '<p class="text-muted">No public sample examples provided.</p>'
          }
        </div>
      </div>
    `;
  }

  function renderProblemSubmissionsHTML(submissions) {
    if (!submissions.length) {
      return `<div class="text-center text-muted" style="padding:32px;">No past submissions recorded for this problem yet.</div>`;
    }

    return `
      <div class="table-responsive">
        <table class="table custom-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Language</th>
              <th>Score</th>
              <th>Runtime</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            ${submissions
              .map((s) => {
                const isAccepted = s.status === 'accepted';
                const statusLabel = isAccepted ? 'Accepted' : s.status === 'wrong_answer' ? 'Wrong Answer' : s.status;
                const statusColor = isAccepted ? '#16a34a' : '#dc2626';

                return `
                <tr>
                  <td><strong style="color:${statusColor};">${statusLabel}</strong></td>
                  <td>${escapeHtml(s.language)}</td>
                  <td><strong>${s.score} pts</strong></td>
                  <td>${s.execution_time || 10} ms</td>
                  <td>${new Date(s.submitted_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                </tr>
              `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /**
   * Run Code Handler
   */
  async function handleRunCode(problemId) {
    const runBtn = document.getElementById('runCodeBtn');
    const consoleBody = document.getElementById('consoleBody');
    const code = state.codeBuffer[problemId] || '';

    if (!code.trim()) {
      alert('Code cannot be empty');
      return;
    }

    runBtn.disabled = true;
    runBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Running...`;
    consoleBody.innerHTML = `<div class="text-muted" style="font-family:monospace;"><i class="fa-solid fa-spinner fa-spin"></i> Executing testcases...</div>`;

    try {
      const payload = {
        language: state.activeLanguage,
        code
      };
      if (state.customInput && state.customInput.trim()) {
        payload.customInput = state.customInput;
      }

      const res = await fetch(`/api/coding-challenges/problems/${problemId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Execution failed');

      const run = data.run;
      if (run.is_custom_input) {
        consoleBody.innerHTML = `
          <div style="font-family:monospace; font-size:13px;">
            <div style="color:#16a34a; margin-bottom:4px;"><strong>Custom Input Execution Succeeded</strong> (${run.execution_time} ms)</div>
            <div style="color:var(--text-muted); margin-bottom:2px;">Output:</div>
            <pre style="background:var(--surface-bg, #0f172a); color:#e2e8f0; padding:8px; border-radius:6px;">${escapeHtml(run.output || '(No Output)')}</pre>
          </div>
        `;
      } else {
        consoleBody.innerHTML = `
          <div style="font-family:monospace; font-size:13px;">
            <div style="margin-bottom:8px;">
              <strong>Results: ${run.passed_examples} / ${run.total_examples} Sample Test Cases Passed</strong>
            </div>
            ${(run.results || [])
              .map(
                (r, i) => `
              <div style="margin-bottom:8px; padding:8px; border-radius:6px; background: ${r.passed ? '#dcfce722' : '#fee2e222'}; border-left: 4px solid ${r.passed ? '#16a34a' : '#dc2626'};">
                <div style="font-weight:bold; color: ${r.passed ? '#16a34a' : '#dc2626'};">
                  Case ${i + 1}: ${r.passed ? 'PASSED ✓' : 'FAILED ✗'} (${r.execution_time} ms)
                </div>
                <div>Expected: <code style="color:#16a34a;">${escapeHtml(r.expected_output)}</code></div>
                <div>Actual: <code style="color:${r.passed ? '#16a34a' : '#dc2626'};">${escapeHtml(r.actual_output || '(Empty)')}</code></div>
              </div>
            `
              )
              .join('')}
          </div>
        `;
      }
    } catch (err) {
      consoleBody.innerHTML = `<div style="color:#dc2626; font-family:monospace;">Execution Error: ${escapeHtml(err.message)}</div>`;
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = `<i class="fa-solid fa-play"></i> Run Code`;
    }
  }

  /**
   * Submit Code Handler
   */
  async function handleSubmitCode(problemId) {
    const submitBtn = document.getElementById('submitCodeBtn');
    const consoleBody = document.getElementById('consoleBody');
    const code = state.codeBuffer[problemId] || '';

    if (!code.trim()) {
      alert('Code cannot be empty');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting...`;
    consoleBody.innerHTML = `<div class="text-muted" style="font-family:monospace;"><i class="fa-solid fa-spinner fa-spin"></i> Evaluating test suite...</div>`;

    try {
      const res = await fetch(`/api/coding-challenges/problems/${problemId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: state.activeLanguage, code }),
        credentials: 'include'
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Submission evaluation failed');

      const sub = data.submission;
      const isAccepted = sub.status === 'accepted';
      const statusColor = isAccepted ? '#16a34a' : '#dc2626';

      consoleBody.innerHTML = `
        <div style="font-family:monospace; font-size:13px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
            <span style="font-size:1.2rem; font-weight:bold; color:${statusColor};">${isAccepted ? 'ACCEPTED 🎉' : sub.status.toUpperCase()}</span>
            <span class="badge" style="background:${statusColor}22; color:${statusColor}; padding:4px 8px; border-radius:4px;">Score: ${sub.score} / ${sub.max_score} pts</span>
          </div>
          <div>Passed: <strong>${sub.passed_cases} / ${sub.total_cases} Test Cases</strong></div>
          <div>Avg Runtime: <strong>${sub.execution_time} ms</strong></div>
        </div>
      `;

      // Refresh problem detail in background to update solved badge
      if (isAccepted && state.activeProblem) {
        state.activeProblem.solved = true;
      }
    } catch (err) {
      consoleBody.innerHTML = `<div style="color:#dc2626; font-family:monospace;">Submission Error: ${escapeHtml(err.message)}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Submit Solution`;
    }
  }

  /**
   * ==========================================
   * 4. SEASON / OVERALL LEADERBOARD VIEW
   * ==========================================
   */
  async function renderSeasonLeaderboardView() {
    if (!elements.pageBody) return;
    elements.pageBody.innerHTML = `
      <div class="coding-hero" style="background: linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%);">
        <div class="coding-kicker"><i class="fa-solid fa-trophy"></i> Season Standings</div>
        <h1>Overall Coding Leaderboard</h1>
        <p>Aggregate ranking based on completed challenges. Earn points based on contest performance (1st = 100 pts, 2nd = 75 pts, 3rd = 60 pts, 4th-10th = 40 pts, participation = 10 pts).</p>
      </div>

      <div id="seasonLeaderboardContainer" class="coding-card">
        <div class="text-center" style="padding:32px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading Season Standings...</div>
      </div>
    `;

    try {
      const res = await fetch('/api/coding-challenges/leaderboard/overall', { credentials: 'include' });
      const data = await res.json();
      const container = document.getElementById('seasonLeaderboardContainer');

      if (data.hidden) {
        container.innerHTML = `
          <div class="text-center" style="padding:40px; color: var(--text-muted, #64748b);">
            <i class="fa-solid fa-eye-slash" style="font-size:2.5rem; margin-bottom:12px;"></i>
            <h3>Overall Leaderboard Disabled</h3>
            <p>The campus season leaderboard is currently disabled by administrator.</p>
          </div>
        `;
        return;
      }

      const rows = data.leaderboard || [];
      if (!rows.length) {
        container.innerHTML = `<div class="text-center text-muted" style="padding:40px;">No completed contests points recorded yet for this season.</div>`;
        return;
      }

      container.innerHTML = `
        <div class="table-responsive">
          <table class="table custom-table">
            <thead>
              <tr>
                <th>Season Rank</th>
                <th>Student</th>
                <th>Season Points</th>
                <th>Contests Solved</th>
                <th>Total Solved</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map((r) => {
                  let badge = `<strong>#${r.rank}</strong>`;
                  if (r.rank === 1) badge = '🥇 <strong style="color:#d97706;">1st Place</strong>';
                  else if (r.rank === 2) badge = '🥈 <strong style="color:#64748b;">2nd Place</strong>';
                  else if (r.rank === 3) badge = '🥉 <strong style="color:#b45309;">3rd Place</strong>';

                  return `
                  <tr>
                    <td>${badge}</td>
                    <td><strong>${escapeHtml(r.display_name)}</strong></td>
                    <td><strong style="color:#6366f1; font-size:1.05rem;">${r.season_points} pts</strong></td>
                    <td>${r.contests_count}</td>
                    <td>${r.total_solved} problems</td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      console.error(err);
      document.getElementById('seasonLeaderboardContainer').innerHTML = `<div class="text-center text-danger" style="padding:32px;">Failed to load overall leaderboard</div>`;
    }
  }

  /**
   * ==========================================
   * 5. MY SUBMISSIONS VIEW
   * ==========================================
   */
  async function renderMySubmissionsView() {
    if (!elements.pageBody) return;
    elements.pageBody.innerHTML = `
      <div class="coding-card">
        <h3><i class="fa-solid fa-clock-rotate-left"></i> My Submission History</h3>
        <p style="color:var(--text-muted); margin-bottom:20px;">Review your personal code submissions across all contests.</p>
        <div id="mySubmissionsContainer">
          <div class="text-center" style="padding:32px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading your submissions...</div>
        </div>
      </div>
    `;

    try {
      const res = await fetch('/api/coding-challenges/my-submissions', { credentials: 'include' });
      const data = await res.json();
      const container = document.getElementById('mySubmissionsContainer');

      const subs = data.submissions || [];
      if (!subs.length) {
        container.innerHTML = `<div class="text-center text-muted" style="padding:32px;">You have not made any contest submissions yet.</div>`;
        return;
      }

      container.innerHTML = `
        <div class="table-responsive">
          <table class="table custom-table">
            <thead>
              <tr>
                <th>Contest</th>
                <th>Problem</th>
                <th>Language</th>
                <th>Status</th>
                <th>Score</th>
                <th>Submitted Date</th>
              </tr>
            </thead>
            <tbody>
              ${subs
                .map((s) => {
                  const isAccepted = s.status === 'accepted';
                  const statusColor = isAccepted ? '#16a34a' : '#dc2626';

                  return `
                  <tr>
                    <td><strong>${escapeHtml(s.contest_title || '')}</strong></td>
                    <td>${escapeHtml(s.problem_title || '')}</td>
                    <td><code>${escapeHtml(s.language)}</code></td>
                    <td><strong style="color:${statusColor};">${isAccepted ? 'Accepted ✓' : s.status}</strong></td>
                    <td><strong>${s.score} / ${s.max_score} pts</strong></td>
                    <td>${new Date(s.submitted_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  </tr>
                `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      console.error(err);
      document.getElementById('mySubmissionsContainer').innerHTML = `<div class="text-center text-danger" style="padding:32px;">Failed to load submission history</div>`;
    }
  }

  /**
   * ==========================================
   * 5. MY CERTIFICATES VIEW
   * ==========================================
   */
  async function renderMyCertificatesView() {
    elements.pageBody.innerHTML = `
      <section class="coding-hero">
        <div class="coding-kicker"><i class="fa-solid fa-certificate"></i> My Earned Credentials</div>
        <h1>Verifiable Coding Merit Certificates</h1>
        <p>Official certificates issued for securing top positions in campus coding challenges. Credentials are cryptographically signed and public QR verifiable.</p>
      </section>

      <div id="myCertificatesContainer" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px;">
        <div class="coding-card text-center" style="padding:32px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading certificates...</div>
      </div>
    `;

    try {
      const res = await fetch('/api/coding-challenges/my-certificates', { credentials: 'include' });
      const data = await res.json();
      const certs = data.certificates || [];

      const container = document.getElementById('myCertificatesContainer');
      if (!container) return;

      if (certs.length === 0) {
        container.innerHTML = `
          <div class="coding-card text-center" style="padding: 40px; color: var(--text-muted, #64748b); grid-column: 1 / -1;">
            <i class="fa-solid fa-award" style="font-size: 3rem; margin-bottom: 12px; opacity:0.5;"></i>
            <h3>No Certificates Earned Yet</h3>
            <p style="margin-top:8px;">Participate in Weekly Coding Contests and finish in the Top 3 to earn official merit certificates!</p>
          </div>
        `;
        return;
      }

      container.innerHTML = certs
        .map((c) => {
          const isApproved = c.status === 'approved';
          const isRevoked = c.status === 'revoked';
          const badgeClass = isApproved ? 'status-live' : isRevoked ? 'status-completed' : 'status-scheduled';
          const badgeText = isApproved ? 'OFFICIAL / ISSUED' : isRevoked ? 'REVOKED' : 'PENDING ADMIN APPROVAL';

          return `
            <div class="coding-card" style="display:flex; flex-direction:column; justify-space-between; border-top: 4px solid ${c.rank === 1 ? '#D4AF37' : c.rank === 2 ? '#C0C0C0' : '#CD7F32'};">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                  <span class="contest-badge ${badgeClass}">${badgeText}</span>
                  <span style="font-size:12px; font-weight:700; color:#D4AF37;">${escapeHtml(c.position_text || '#' + c.rank + ' Position')}</span>
                </div>
                <h3 style="margin:0 0 8px; font-size:1.15rem;">${escapeHtml(c.contest_name || 'Coding Challenge')}</h3>
                <p style="font-size:12px; color:var(--text-muted, #64748b); margin:0 0 16px;">
                  Issued: ${c.issued_at ? new Date(c.issued_at).toLocaleDateString() : 'Pending Approval'}<br>
                  Certificate ID: <code>${escapeHtml(c.certificate_number || 'Pending')}</code>
                </p>
              </div>
              <div style="display:flex; gap:8px; margin-top:16px;">
                ${
                  isApproved
                    ? `<a href="/api/coding-challenges/my-certificates/${c.id}/pdf" target="_blank" class="btn btn-primary btn-sm" style="flex:1; text-align:center;">
                        <i class="fa-solid fa-download"></i> Download PDF
                       </a>`
                    : `<button disabled class="btn btn-secondary btn-sm" style="flex:1; opacity:0.6;">
                        <i class="fa-solid fa-clock"></i> Pending Approval
                       </button>`
                }
                <a href="/certificate/verify/${c.verification_token}" target="_blank" class="btn btn-secondary btn-sm">
                  <i class="fa-solid fa-qrcode"></i> Verify
                </a>
              </div>
            </div>
          `;
        })
        .join('');
    } catch (err) {
      console.error(err);
      document.getElementById('myCertificatesContainer').innerHTML = `
        <div class="coding-card text-center text-danger" style="padding:32px;">Failed to load certificates history</div>
      `;
    }
  }


  /**
   * ==========================================
   * 6. STRICT MODE ANTI-CHEAT MONITORING
   * ==========================================
   */
  function attachStrictModeListeners(contestId, problemId) {
    if (state.strictModeListenersAttached) return;

    state.strictModeActive = true;
    state.strictModeListenersAttached = true;

    const editor = document.getElementById('codeEditorArea');

    // 1. Intercept Paste attempt on editor
    if (editor) {
      editor._strictPasteHandler = function (e) {
        e.preventDefault();
        showToast('Strict Mode Active: Paste action into editor is restricted.', 'warning');
        logIntegrityEvent(contestId, problemId, 'paste_attempt', { length: e.clipboardData ? e.clipboardData.getData('text').length : 0 });
      };
      editor._strictContextMenuHandler = function (e) {
        e.preventDefault();
      };

      editor.addEventListener('paste', editor._strictPasteHandler);
      editor.addEventListener('contextmenu', editor._strictContextMenuHandler);
    }

    // 2. Tab switch / Visibility change listener
    window._strictVisibilityHandler = function () {
      if (document.hidden && state.strictModeActive) {
        logIntegrityEvent(contestId, problemId, 'tab_switch', { hidden: true });
      }
    };
    document.addEventListener('visibilitychange', window._strictVisibilityHandler);
  }

  function detachStrictModeListeners() {
    state.strictModeActive = false;
    if (state.activeTimerInterval) {
      clearInterval(state.activeTimerInterval);
      state.activeTimerInterval = null;
    }
    if (!state.strictModeListenersAttached) return;

    const editor = document.getElementById('codeEditorArea');
    if (editor && editor._strictPasteHandler) {
      editor.removeEventListener('paste', editor._strictPasteHandler);
      editor.removeEventListener('contextmenu', editor._strictContextMenuHandler);
    }

    if (window._strictVisibilityHandler) {
      document.removeEventListener('visibilitychange', window._strictVisibilityHandler);
    }

    state.strictModeListenersAttached = false;
  }

  async function logIntegrityEvent(contestId, problemId, eventType, metadata) {
    try {
      await fetch(`/api/coding-challenges/contests/${contestId}/integrity-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem_id: problemId,
          event_type: eventType,
          metadata
        }),
        credentials: 'include'
      });
    } catch (_err) {
      // best-effort proctoring log
    }
  }

  /**
   * Helpers
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getLanguageLabel(lang) {
    const map = {
      python: 'Python 3.10',
      javascript: 'JavaScript (Node v18)',
      cpp: 'C++ (GCC 11)',
      c: 'C (GCC 11)',
      java: 'Java (OpenJDK 17)'
    };
    return map[lang] || lang;
  }

  function getDefaultTemplateForLanguage(lang) {
    const templates = {
      python: '# Write your Python code here\nimport sys\n\ndef main():\n    lines = sys.stdin.read().splitlines()\n    # Write logic here\n\nif __name__ == "__main__":\n    main()\n',
      javascript: '// Write your Node.js JavaScript code here\nconst fs = require("fs");\n\nfunction main() {\n  const input = fs.readFileSync(0, "utf-8");\n  // Write logic here\n}\n\nmain();\n',
      cpp: '// Write your C++ code here\n#include <iostream>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    return 0;\n}\n',
      c: '/* Write your C code here */\n#include <stdio.h>\n\nint main() {\n    return 0;\n}\n',
      java: '// Write your Java code here\nimport java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner scanner = new Scanner(System.in);\n    }\n}\n'
    };
    return templates[lang] || '# Write code here\n';
  }

  function startCountdownTimer(targetTime, containerId) {
    if (state.activeTimerInterval) {
      clearInterval(state.activeTimerInterval);
      state.activeTimerInterval = null;
    }
    const target = new Date(targetTime).getTime();
    const timerElem = document.getElementById(containerId);
    if (!timerElem) return;

    function update() {
      const now = new Date().getTime();
      const diff = target - now;
      if (diff <= 0) {
        if (state.activeTimerInterval) {
          clearInterval(state.activeTimerInterval);
          state.activeTimerInterval = null;
        }
        timerElem.innerHTML = 'Starting now... Refreshing!';
        setTimeout(() => location.reload(), 1500);
        return;
      }
      const hrs = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);
      timerElem.innerHTML = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    update();
    state.activeTimerInterval = setInterval(update, 1000);
  }

  function showToast(msg, type) {
    const toast = document.createElement('div');
    toast.className = `toast-notice ${type || 'info'}`;
    toast.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(msg)}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
})();
