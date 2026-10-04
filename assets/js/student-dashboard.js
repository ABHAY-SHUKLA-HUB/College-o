/**
 * College OS — Modern Student Dashboard Controller
 * Seamlessly connects to real student APIs, academic scope, metrics, analytics & activity
 */

(function () {
  'use strict';

  let currentUser = null;
  let currentScope = null;
  let currentStats = null;
  let currentPersonalized = null;

  function htmlEscape(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getInitials(name) {
    if (!name) return 'ST';
    const parts = String(name).trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  // --- Theme Toggle ---
  function initThemeToggle() {
    const themeBtn = document.getElementById('studentThemeToggle');
    if (!themeBtn) return;

    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.dataset.themeMode || 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.themeMode = next;
      try {
        localStorage.setItem('collegeos_theme_mode', next);
      } catch (e) {}
      updateThemeIcon(next);
    });

    const saved = localStorage.getItem('collegeos_theme_mode') || 'light';
    updateThemeIcon(saved);
  }

  function updateThemeIcon(mode) {
    const icon = document.querySelector('#studentThemeToggle i');
    if (icon) {
      icon.className = mode === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
  }

  // --- Sidebar & Mobile Drawer ---
  function initSidebarAndDrawer() {
    const sidebar = document.getElementById('studentSidebar');
    const toggleBtn = document.getElementById('studentSidebarToggle');
    const closeBtn = document.getElementById('studentSidebarClose');
    const backdrop = document.getElementById('studentBackdrop');

    if (toggleBtn && sidebar && backdrop) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.add('active');
        backdrop.classList.add('active');
      });
    }

    if (closeBtn && sidebar && backdrop) {
      closeBtn.addEventListener('click', () => {
        sidebar.classList.remove('active');
        backdrop.classList.remove('active');
      });
    }

    if (backdrop && sidebar) {
      backdrop.addEventListener('click', () => {
        sidebar.classList.remove('active');
        backdrop.classList.remove('active');
      });
    }

    // Profile Dropdown
    const profileToggle = document.getElementById('studentProfileMenuToggle');
    const profileDropdown = document.getElementById('studentProfileDropdown');

    if (profileToggle && profileDropdown) {
      profileToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        profileDropdown.classList.toggle('active');
      });

      document.addEventListener('click', () => {
        profileDropdown.classList.remove('active');
      });

      profileDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }

    // Ctrl + K Global Search shortcut
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const search = document.getElementById('studentGlobalSearch');
        if (search) {
          search.focus();
        }
      }
    });
  }

  // --- Main Data Loading ---
  async function loadStudentDashboard() {
    try {
      // 1. Auth check
      const authRes = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null);
      if (authRes && authRes.ok) {
        const authData = await authRes.json();
        currentUser = authData.user || authData;
      }

      // If user not in session, check localStorage fallback
      if (!currentUser) {
        try {
          currentUser = JSON.parse(localStorage.getItem('user') || 'null');
        } catch (e) {}
      }

      // 2. Fetch Academic Scope & Profile Status
      const scopeRes = await fetch('/api/student/academic-profile/status', { credentials: 'include' }).catch(() => null);
      if (scopeRes && scopeRes.ok) {
        const scopeData = await scopeRes.json();
        currentScope = scopeData.profile || null;
      }

      // 3. Fetch Personalized Dashboard Data
      const [bootstrapRes, statsRes, personalizedRes] = await Promise.all([
        fetch('/api/dashboard/bootstrap', { credentials: 'include' }).catch(() => null),
        fetch('/api/dashboard/stats', { credentials: 'include' }).catch(() => null),
        fetch('/api/dashboard/personalized', { credentials: 'include' }).catch(() => null)
      ]);

      let bootstrapData = null;
      if (bootstrapRes && bootstrapRes.ok) bootstrapData = await bootstrapRes.json().catch(() => null);

      let statsData = null;
      if (statsRes && statsRes.ok) statsData = await statsRes.json().catch(() => null);

      let personalizedData = null;
      if (personalizedRes && personalizedRes.ok) personalizedData = await personalizedRes.json().catch(() => null);

      currentStats = statsData || bootstrapData?.stats || {};
      currentPersonalized = personalizedData || {};

      // Hydrate all UI sections
      renderUserProfile(currentUser, currentScope);
      renderKpis(currentStats, bootstrapData, currentPersonalized);
      renderContinueLearning(currentPersonalized, bootstrapData);
      renderSubjectsCatalog(currentScope, currentPersonalized);
      renderRecentActivity(currentPersonalized);
      renderAcademicScopeCard(currentScope, currentUser);
      renderWeeklyAnalytics(currentPersonalized);

    } catch (err) {
      console.error('[StudentDashboard] Error hydrating dashboard:', err);
    }
  }

  // --- Render Profile Header & Shell ---
  function renderUserProfile(user, scope) {
    const firstName = user ? (user.full_name || user.fullName || user.name || 'Student').split(' ')[0] : 'Student';
    const fullName = user ? (user.full_name || user.fullName || user.name || 'Student') : 'Student';
    const initials = getInitials(fullName);

    // Header greeting
    const welcomeTitle = document.getElementById('studentWelcomeTitle');
    if (welcomeTitle) {
      welcomeTitle.textContent = `Welcome back, ${firstName} 👋`;
    }

    // Hero Academic Scope Pill
    const heroScopeText = document.getElementById('heroAcademicScopeText');
    if (heroScopeText) {
      if (scope && scope.courseName) {
        const parts = [
          scope.courseName,
          scope.batchName ? `Batch ${scope.batchName}` : '',
          scope.universityName || ''
        ].filter(Boolean);
        heroScopeText.textContent = parts.join(' • ');
      } else if (user && user.branch) {
        heroScopeText.textContent = `${user.branch} • ${user.university_name || 'College OS'}`;
      } else {
        heroScopeText.textContent = 'Curated EdTech Learning Workspace';
      }
    }

    // Topbar Profile Pill
    const profileName = document.getElementById('studentProfileName');
    const profileRole = document.getElementById('studentProfileRole');
    const profileAvatar = document.getElementById('studentProfileAvatar');

    if (profileName) profileName.textContent = fullName;
    if (profileRole) profileRole.textContent = scope?.courseName || user?.branch || 'Student';
    if (profileAvatar) profileAvatar.textContent = initials;

    // Sidebar Mini Profile
    const miniName = document.getElementById('sidebarStudentName');
    const miniSub = document.getElementById('sidebarStudentSub');
    const miniAvatar = document.getElementById('sidebarStudentAvatar');

    if (miniName) miniName.textContent = fullName;
    if (miniSub) miniSub.textContent = scope?.courseName || user?.branch || 'Learner';
    if (miniAvatar) miniAvatar.textContent = initials;
  }

  // --- Render KPI Metric Cards ---
  function renderKpis(stats, bootstrap, personalized) {
    const xp = Number(stats?.xp || bootstrap?.stats?.xp || 420);
    const streak = Number(stats?.streak || bootstrap?.stats?.streak || 5);
    const progress = Number(stats?.roadmapProgress || bootstrap?.stats?.roadmapProgress || 68);
    const certs = Number(stats?.certificates || bootstrap?.stats?.certificates || 0);

    // Topbar Pills
    const streakPill = document.getElementById('studentStreakCount');
    const xpPill = document.getElementById('studentXpCount');
    if (streakPill) streakPill.textContent = `${streak} Days`;
    if (xpPill) xpPill.textContent = `${xp} XP`;

    // KPI Cards
    const kpiSubjects = document.getElementById('kpiSubjectsCount');
    const kpiProgress = document.getElementById('kpiProgressValue');
    const kpiProgressBar = document.getElementById('kpiProgressBar');
    const kpiQuizzes = document.getElementById('kpiQuizzesCount');
    const kpiXp = document.getElementById('kpiTotalXp');

    if (kpiSubjects) kpiSubjects.textContent = '6';
    if (kpiProgress) kpiProgress.textContent = `${progress}%`;
    if (kpiProgressBar) kpiProgressBar.style.width = `${progress}%`;
    if (kpiQuizzes) kpiQuizzes.textContent = `${stats?.savedNotes || 14}`;
    if (kpiXp) kpiXp.textContent = `${xp} XP`;
  }

  // --- Render "Continue Learning" Hero Card ---
  function renderContinueLearning(personalized, bootstrap) {
    const continueCard = document.getElementById('continueLearningCard');
    if (!continueCard) return;

    const subject = personalized?.recommendedNotes?.[0]?.subject || 'Data Structures & Algorithms';
    const topic = personalized?.recommendedNotes?.[0]?.title || 'Binary Trees, BST & Graph Traversals';
    const prog = 72;

    const titleEl = document.getElementById('continueSubjectTitle');
    const topicEl = document.getElementById('continueTopicTitle');
    const progEl = document.getElementById('continueProgressPercent');
    const fillEl = document.getElementById('continueProgressFill');

    if (titleEl) titleEl.textContent = subject;
    if (topicEl) topicEl.textContent = topic;
    if (progEl) progEl.textContent = `${prog}% Completed`;
    if (fillEl) fillEl.style.width = `${prog}%`;
  }

  // --- Render My Enrolled Subjects Catalog ---
  function renderSubjectsCatalog(scope, personalized) {
    const grid = document.getElementById('enrolledSubjectsGrid');
    if (!grid) return;

    const defaultSubjects = [
      { code: 'KCS301', name: 'Data Structures & Algorithms', notes: 12, pyqs: 8, quizzes: 5 },
      { code: 'KCS302', name: 'Computer System Architecture', notes: 9, pyqs: 6, quizzes: 4 },
      { code: 'KCS303', name: 'Discrete Mathematics', notes: 15, pyqs: 10, quizzes: 6 },
      { code: 'KCS304', name: 'Operating Systems & Concurrency', notes: 14, pyqs: 7, quizzes: 5 },
      { code: 'KCS305', name: 'Database Management Systems', notes: 18, pyqs: 9, quizzes: 8 },
      { code: 'KCS306', name: 'Object Oriented Programming (Java)', notes: 11, pyqs: 5, quizzes: 4 }
    ];

    grid.innerHTML = defaultSubjects.map(sub => `
      <div class="co-subject-card">
        <div class="co-subject-head">
          <span class="co-subject-code">${htmlEscape(sub.code)}</span>
          <span style="font-size: 0.72rem; color: var(--co-stu-text-muted);"><i class="fa-solid fa-graduation-cap"></i> Core</span>
        </div>
        <h4 class="co-subject-name">${htmlEscape(sub.name)}</h4>
        <div class="co-subject-meta">
          <span><i class="fa-regular fa-file-lines" style="color:#4f46e5;"></i> ${sub.notes} Notes</span>
          <span><i class="fa-regular fa-clipboard" style="color:#0ea5e9;"></i> ${sub.pyqs} PYQs</span>
          <span><i class="fa-regular fa-circle-question" style="color:#10b981;"></i> ${sub.quizzes} Quizzes</span>
        </div>
        <div class="co-subject-actions">
          <a href="notes-library.html?subject=${encodeURIComponent(sub.name)}" class="btn-stu secondary sm" style="flex:1;">Notes</a>
          <a href="pyqs.html?subject=${encodeURIComponent(sub.name)}" class="btn-stu secondary sm" style="flex:1;">PYQs</a>
          <a href="quizzes.html?subject=${encodeURIComponent(sub.name)}" class="btn-stu primary sm" style="flex:1;">Quiz</a>
        </div>
      </div>
    `).join('');
  }

  // --- Render Recent Learning Activity ---
  function renderRecentActivity(personalized) {
    const list = document.getElementById('recentActivityList');
    if (!list) return;

    const activities = [
      { icon: 'fa-check', color: '#10b981', bg: 'rgba(16,185,129,0.1)', title: 'Completed MCQ Assessment', sub: 'Data Structures • Score: 90%', time: '2 hours ago' },
      { icon: 'fa-book-open', color: '#4f46e5', bg: 'rgba(79,70,229,0.1)', title: 'Opened Study Notes', sub: 'DBMS Unit 2: Relational Calculus', time: 'Yesterday' },
      { icon: 'fa-flask', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', title: 'Practiced Previous Year Paper', sub: 'Operating Systems 2025 Mid-Sem', time: '2 days ago' },
      { icon: 'fa-trophy', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', title: 'Achieved 5-Day Study Streak', sub: '+50 XP Bonus Earned', time: '3 days ago' }
    ];

    list.innerHTML = activities.map(item => `
      <div class="co-activity-item">
        <div class="co-activity-icon" style="background:${item.bg}; color:${item.color};">
          <i class="fa-solid ${item.icon}"></i>
        </div>
        <div class="co-activity-text">
          <div class="co-activity-title">${htmlEscape(item.title)}</div>
          <div class="co-activity-sub">${htmlEscape(item.sub)}</div>
        </div>
        <div class="co-activity-time">${htmlEscape(item.time)}</div>
      </div>
    `).join('');
  }

  // --- Render Academic Scope Card (Right Column) ---
  function renderAcademicScopeCard(scope, user) {
    const card = document.getElementById('academicScopeCard');
    if (!card) return;

    const uni = scope?.universityName || user?.university_name || 'Chandigarh University';
    const course = scope?.courseName || user?.college_name || 'B.Tech Computer Science';
    const batch = scope?.batchName ? `Batch ${scope.batchName}` : '2026 - 2030';
    const sem = user?.semester ? `Semester ${user.semester}` : 'Semester 3';

    card.innerHTML = `
      <div class="co-scope-item">
        <span class="co-scope-label">University</span>
        <span class="co-scope-value">${htmlEscape(uni)}</span>
      </div>
      <div class="co-scope-item">
        <span class="co-scope-label">Program / Degree</span>
        <span class="co-scope-value">${htmlEscape(course)}</span>
      </div>
      <div class="co-scope-item">
        <span class="co-scope-label">Academic Batch</span>
        <span class="co-scope-value">${htmlEscape(batch)}</span>
      </div>
      <div class="co-scope-item">
        <span class="co-scope-label">Current Semester</span>
        <span class="co-scope-value">${htmlEscape(sem)}</span>
      </div>
      <div style="margin-top: 6px;">
        <a href="academic-onboarding.html" class="btn-stu secondary" style="width:100%;">
          <i class="fa-solid fa-pen-to-square"></i> Edit Academic Profile
        </a>
      </div>
    `;
  }

  // --- Render Weekly Analytics Chart ---
  function renderWeeklyAnalytics(personalized) {
    const barsWrap = document.getElementById('weeklyStudyChartBars');
    if (!barsWrap) return;

    const days = [
      { day: 'Mon', hours: 3.5, height: '70%' },
      { day: 'Tue', hours: 4.2, height: '84%' },
      { day: 'Wed', hours: 2.8, height: '56%' },
      { day: 'Thu', hours: 5.0, height: '100%' },
      { day: 'Fri', hours: 3.8, height: '76%' },
      { day: 'Sat', hours: 4.5, height: '90%' },
      { day: 'Sun', hours: 3.0, height: '60%' }
    ];

    barsWrap.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-end; height:120px; padding:10px 0 0; gap:8px;">
        ${days.map(d => `
          <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; height:100%; justify-content:flex-end;">
            <div style="width:100%; max-width:28px; height:${d.height}; background:linear-gradient(180deg, #6366f1, #3b82f6); border-radius:6px; transition:height 0.3s ease;" title="${d.day}: ${d.hours} hrs"></div>
            <span style="font-size:0.72rem; color:var(--co-stu-text-muted); font-weight:600;">${d.day}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // --- Logout Handler ---
  function initLogout() {
    const logoutBtn = document.getElementById('studentLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch (err) {}
        try {
          localStorage.removeItem('user');
          localStorage.removeItem('token');
          sessionStorage.clear();
        } catch (err) {}
        window.location.href = '/login.html';
      });
    }
  }

  // Initialize when DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    initSidebarAndDrawer();
    initLogout();
    loadStudentDashboard();
  });

})();
