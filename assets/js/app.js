// Polyfill: allow calling `.closest()` on non-Element nodes (like Text) by delegating to parentElement
try {
  if (typeof Node !== 'undefined' && !Node.prototype.closest) {
    Node.prototype.closest = function closestPolyfill(selector) {
      if (this.nodeType === 1) {
        return Element.prototype.closest.call(this, selector);
      }
      return this.parentElement ? this.parentElement.closest(selector) : null;
    };
  }
} catch (e) {
  // best-effort; do not break if prototype is not writable
}

const navGroups = [
  {
    title: 'Main',
    items: [
      { href: 'dashboard.html', label: 'Dashboard', icon: 'fa-gauge-high', key: 'dashboard' }
    ]
  },
  {
    title: 'Learning',
    items: [
      { href: 'study.html', label: 'Study', icon: 'fa-book-open', key: 'study' },
      { href: 'mock-tests.html', label: 'Mock Test', icon: 'fa-flask', key: 'mock' },
      { href: 'notes-library.html', label: 'Notes', icon: 'fa-file-lines', key: 'notes' },
      { href: 'academic-contribution-hub.html', label: 'Contribute', icon: 'fa-upload', key: 'contribute' },
      { href: 'study-roadmap.html', label: 'Roadmap', icon: 'fa-map', key: 'roadmap' },
      { label: 'Live Hub', icon: 'fa-satellite-dish', key: 'liveHub', action: 'liveHub' },
      { href: 'ai-tools.html', label: 'AI Tools', icon: 'fa-sparkles', key: 'aiTools' }
    ]
  },
  {
    title: 'Community',
    items: [
      { href: 'college-feed.html', label: 'Campus Feed', icon: 'fa-newspaper', key: 'campusFeed' },
      { href: 'forum.html', label: 'Forum', icon: 'fa-comments', key: 'forum' },
      { href: 'support-hub.html', label: 'Support Hub', icon: 'fa-life-ring', key: 'supportHub' },
      { href: 'support-dashboard.html', label: 'Support Dashboard', icon: 'fa-chart-line', key: 'supportDashboard', roles: ['admin', 'super_admin', 'support_admin', 'support'] }
    ]
  },
  {
    title: 'Account',
    items: [
      { href: 'profile.html', label: 'Profile', icon: 'fa-user', key: 'profile' },
      { href: 'pricing.html', label: 'Membership', icon: 'fa-crown', key: 'membership' },
      { href: 'settings.html', label: 'Settings', icon: 'fa-gear', key: 'settings' }
    ]
  },
];

const navItems = navGroups.flatMap((group) => group.items);

const iconColors = {
  home: '#0f7b6c',
  dashboard: '#0f7b6c',
  study: '#2f6fed',
  mock: '#da4e3a',
  notes: '#8b6f00',
  contribute: '#0b5fd8',
  roadmap: '#1f7f55',
  aiTools: '#7c3aed',
  leaderboard: '#8c2ad8',
  profile: '#006e8f',
  certificate: '#03614a',
  membership: '#b26a00',
  settings: '#5553a9',
  campusFeed: '#0a6b8f',
  notifications: '#b14b00',
  forum: '#9f2f72',
  supportHub: '#1f4acc',
  supportDashboard: '#026b8f',
  referrals: '#7b3f00',
  feedback: '#b76a00',
  liveHub: '#1a73e8'
};

const tooltipMap = {
  Home: 'Go to Home page',
  Dashboard: 'Track your learning progress',
  Study: 'Access learning materials and resources',
  'Mock Test': 'Take full-length tests',
  Notes: 'Open summary notes library',
  Contribute: 'Submit and track verified academic contributions',
  Roadmap: 'View personalized study path',
  'Live Hub': 'Open mentorship and lab sessions',
  'AI Tools': 'Use AI study and career tools',
  Leaderboard: 'Check your rank',
  Profile: 'Manage profile and achievements',
  Certificate: 'Generate and verify certificates',
  Membership: 'Manage plan, payments, and renewals',
  Settings: 'Update preferences',
  'Campus Feed': 'Read and post college-specific updates',
  Notifications: 'Review alerts',
  Forum: 'Ask and discuss doubts',
  'Support Hub': 'Get structured 24/7 peer academic help',
  'Support Dashboard': 'Track your support activity and points',
  Referrals: 'Invite and earn rewards',
  Feedback: 'Share your product experience'
};

const routeWarmupMap = {
  'dashboard.html': [
    '/api/dashboard/bootstrap',
    '/api/quizzes/attempts/me',
    '/api/mock-tests/dashboard',
    '/api/roadmaps/me',
    '/api/notes/mine'
  ],
  'study.html': [
    '/api/career/roadmaps',
    '/api/roadmaps/me',
    '/api/profile/me',
    '/api/academics/profile'
  ],
  'mock-tests.html': [
    '/api/mock-tests/dashboard',
    '/api/quizzes/attempts/me',
    '/api/profile/me',
    '/api/academics/profile'
  ],
  'notes-library.html': [
    '/api/notes/mine',
    '/api/profile/me',
    '/api/academics/profile'
  ],
  'study-roadmap.html': [
    '/api/career/roadmaps',
    '/api/roadmaps/me',
    '/api/profile/me',
    '/api/academics/profile'
  ],
  'ai-tools.html': [
    '/api/career/ai-tools',
    '/api/profile/me',
    '/api/academics/profile'
  ],
  'college-feed.html': [
    '/api/campus-feed/me/summary',
    '/api/campus-feed/posts/trending?limit=8',
    '/api/campus-feed/collections',
    '/api/profile/me'
  ],
  'notifications.html': [
    '/api/notifications/mine',
    '/api/notifications/unread-count',
    '/api/profile/me'
  ],
  'forum.html': [
    '/api/forum/threads/trending',
    '/api/profile/me'
  ],
  'support-dashboard.html': [
    '/api/profile/me',
    '/api/academics/profile'
  ],
  'support-hub.html': [
    '/api/profile/me',
    '/api/academics/profile'
  ],
  'certificates.html': ['/api/certificates/mine', '/api/profile/me'],
  'leaderboards.html': ['/api/leaderboard?range=monthly', '/api/profile/me'],
  'college-feed.html': ['/api/campus-feed/me/summary', '/api/campus-feed/posts/trending?limit=8', '/api/profile/me'],
  'profile.html': [
    '/api/profile/me',
    '/api/academics/profile',
    '/api/subscriptions/me'
  ],
  'pricing.html': [
    '/api/subscriptions/me',
    '/api/profile/me'
  ],
  'settings.html': [
    '/api/profile/me',
    '/api/notifications/unread-count',
    '/api/settings/icons',
    '/api/settings/sessions'
  ],
  'live-hub': [
    '/api/dashboard/experience-config',
    '/api/live-sessions/upcoming?includeEnded=true&scope=student'
  ]
};

const prefetchedDocuments = new Set();
const warmedRouteKeys = new Set();
let liveHubScriptPromise = null;
let toastHost = null;

const CLEAN_ROUTE_MAP = {
  'index.html': '/',
  'login.html': '/login',
  'signup.html': '/signup',
  'dashboard.html': '/dashboard',
  'study.html': '/study',
  'mock-tests.html': '/mock-tests',
  'notes-library.html': '/notes',
  'study-roadmap.html': '/roadmap',
  'ai-tools.html': '/ai-tools',
  'live-hub.html': '/live-hub',
  'notifications.html': '/notifications',
  'profile.html': '/profile',
  'settings.html': '/settings',
  'support-dashboard.html': '/support-dashboard',
  'support-hub.html': '/support-hub',
  'pricing.html': '/membership',
  'leaderboards.html': '/leaderboard',
  'create-support-request.html': '/forms',
  'academic-contribution-hub.html': '/contribute',
  'certificates.html': '/certificates',
  'leaderboards.html': '/leaderboard',
  'college-feed.html': '/campus-feed'
};

function cleanRouteForPage(file) {
  return CLEAN_ROUTE_MAP[file] || `/${String(file || '').replace(/\.html$/i, '')}`;
}

function pageName() {
  const file = window.location.pathname.split('/').pop() || 'index.html';
  return file.toLowerCase();
}

// Expose protected page names to the client-side for guard checks
window.PROTECTED_PAGES = [
  'dashboard', 'dashboard.html', 'study', 'study.html', 'mock-test', 'mock-tests.html', 'mock-tests', 'notes', 'notes-library.html', 'contribute', 'academic-contribution-hub.html', 'roadmap', 'study-roadmap.html', 'live-hub', 'live-hub.html', 'ai-tools', 'ai-tools.html', 'college-feed', 'college-feed.html', 'forum', 'forum.html', 'support-hub', 'support-hub.html', 'profile', 'profile.html', 'membership', 'pricing.html', 'settings', 'settings.html'
];

function normalizeRoutePath(href) {
  if (!href) return href;
  try {
    const url = new URL(href, window.location.href);
    const file = url.pathname.split('/').pop()?.toLowerCase() || '';
    if (CLEAN_ROUTE_MAP[file]) {
      url.pathname = url.pathname.replace(/[^/]*$/, CLEAN_ROUTE_MAP[file].replace(/^\//, ''));
      return `${url.pathname}${url.search}${url.hash}`;
    }
    if (/\.html$/i.test(file)) {
      url.pathname = url.pathname.replace(/\.html$/i, '');
      return `${url.pathname}${url.search}${url.hash}`;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return String(href);
  }
}

function goToRoute(href, { replace = false } = {}) {
  const nextHref = normalizeRoutePath(href);
  if (replace) {
    window.location.replace(nextHref);
    return;
  }
  window.location.href = nextHref;
}

function resolveThemeMode(theme) {
  const preferredDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return theme === 'system' ? (preferredDark ? 'dark' : 'light') : theme;
}

function getStoredThemePreference() {
  const hasSaved = window.localStorage.getItem('collegeos_theme') !== null;
  const saved = hasSaved ? window.localStorage.getItem('collegeos_theme') : 'light';
  if (!['light', 'dark', 'system'].includes(saved)) return 'light';
  return saved;
}

function applyThemePreference(theme) {
  const resolved = resolveThemeMode(theme);
  document.documentElement.dataset.themeMode = resolved;
  document.documentElement.style.colorScheme = resolved;
}

function restoreTheme() {
  applyThemePreference(getStoredThemePreference());
}

window.CollegeOSTheme = {
  resolveThemeMode,
  getStoredThemePreference,
  applyThemePreference
};

restoreTheme();

try {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (getStoredThemePreference() === 'system') {
      applyThemePreference('system');
    }
  });
} catch {
  // Ignore unsupported environments.
}

window.addEventListener('storage', (event) => {
  if (event.key !== 'collegeos_theme') return;
  applyThemePreference(getStoredThemePreference());
});

function navHtml() {
  const current = pageName();
  return navGroups
    .map((group) => {
      const links = group.items
        .filter((item) => {
          if (!Array.isArray(item.roles) || !item.roles.length) return true;
          const role = String(window.collegeOsCurrentUser?.role || '').toLowerCase();
          return item.roles.some((allowed) => String(allowed || '').toLowerCase() === role);
        })
        .map((item) => {
          const active = item.action ? '' : (current === normalizeRoutePath(item.href).split('/').pop().toLowerCase() ? 'active' : '');
          const color = iconColors[item.key] || '#0f7b6c';
          const badge = item.key === 'notifications' ? '<span class="nav-badge" id="notifNavBadge" style="display:none;">0</span>' : '';
          if (item.action === 'liveHub') {
            return `<button class="nav-link nav-link-action ${active}" type="button" data-live-hub-toggle title="${tooltipMap[item.label] || item.label}" data-label="${item.label}"><i class="fa-solid ${item.icon}" style="color:${color}"></i><span class="nav-label">${item.label}</span>${badge}</button>`;
          }
          return `<a class="nav-link ${active}" href="${normalizeRoutePath(item.href)}" title="${tooltipMap[item.label] || item.label}" data-label="${item.label}"><i class="fa-solid ${item.icon}" style="color:${color}"></i><span class="nav-label">${item.label}</span>${badge}</a>`;
        })
        .join('');

      if (!links) return '';
      return `<section class="nav-group"><p class="nav-group-title">${group.title}</p>${links}</section>`;
    })
    .join('');
}

function renderSidebarNav() {
  const navList = document.querySelector('.sidebar-nav-wrap .nav-list');
  if (!navList) return;
  navList.innerHTML = navHtml();
}

function mobileNavHtml() {
  const current = pageName();
  const quick = [
    { href: '/dashboard', icon: 'fa-house', label: 'Home' },
    { href: '/study', icon: 'fa-book-open', label: 'Study' },
    { href: '/ai-tools', icon: 'fa-sparkles', label: 'AI' },
    { href: '/roadmap', icon: 'fa-map', label: 'Roadmap' },
    { href: '/profile', icon: 'fa-user', label: 'Profile' }
  ];

  return quick
    .map((item) => {
      const active = current === normalizeRoutePath(item.href).split('/').pop().toLowerCase() ? 'active' : '';
      return `<a class="${active}" href="${item.href}" title="${item.label}"><i class="fa-solid ${item.icon}"></i><div>${item.label}</div></a>`;
    })
    .join('');
}

function normalizeHrefTarget(href) {
  if (!href) return '';
  try {
    const url = new URL(href, window.location.href);
    return url.pathname.split('/').pop()?.toLowerCase() || '';
  } catch {
    return String(href).toLowerCase();
  }
}

function getWarmupPathsForTarget(target) {
  const key = normalizeHrefTarget(target);
  const base = [
    '/api/profile/me',
    '/api/academics/profile',
    '/api/notifications/unread-count',
    '/api/subscriptions/me'
  ];
  return [...new Set([...(routeWarmupMap[key] || []), ...base])];
}

function prefetchDocument(href) {
  if (!href || href.startsWith('#')) return;
  if (/^(mailto:|tel:|javascript:)/i.test(href)) return;
  // Ignore non-http(s) or scheme-prefixed routes like "route:/..." which are internal markers
  if (/^[a-zA-Z0-9+.-]+:/i.test(href) && !/^https?:/i.test(href) && !/^file:/i.test(href)) return;

  const resolved = new URL(href, window.location.href).toString();
  if (prefetchedDocuments.has(resolved)) return;
  prefetchedDocuments.add(resolved);

  const existing = document.querySelector(`link[rel="prefetch"][href="${resolved}"]`);
  if (existing) return;

  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = resolved;
  document.head.appendChild(link);
}

function warmupRouteData(target) {
  if (!window.CollegeOSApi?.warmupRequests) return;
  const paths = getWarmupPathsForTarget(target);
  if (!paths.length) return;
  const rawTarget = String(target || '').trim();
  const routeKey = normalizeHrefTarget(rawTarget) || rawTarget.replace(/^route:/i, '').replace(/^\/+/, '');
  if (routeKey) {
    if (warmedRouteKeys.has(routeKey)) return;
    warmedRouteKeys.add(routeKey);
  }
  const warmupOnce = window.CollegeOSApi.warmupRequestsOnce;
  const warmupMany = window.CollegeOSApi.warmupRequests;
  if (typeof warmupOnce === 'function') {
    warmupOnce(`warmup:${routeKey || paths.join('|')}`, paths).catch(() => null);
    return;
  }
  if (typeof warmupMany === 'function') {
    warmupMany(paths).catch(() => null);
  }
}

function primeNavigationTarget(target) {
  if (!target) return;
  if (target.matches('[data-live-hub-toggle]')) {
    if (!liveHubScriptPromise) {
      liveHubScriptPromise = ensureLiveHubScript().catch(() => {
        liveHubScriptPromise = null;
        return null;
      });
    }
    warmupRouteData('live-hub');
    return;
  }

  const href = target.getAttribute('href');
  if (!href) return;
  prefetchDocument(href);
  warmupRouteData(href);
}

function bindNavigationPrefetch() {
  const selector = 'a[href], button[data-live-hub-toggle]';

  function closestAncestor(node, sel) {
    try {
      // If node is not an Element (text node), use parentElement
      let el = node && node.nodeType === 1 ? node : node && node.parentElement ? node.parentElement : null;
      while (el) {
        if (typeof el.matches === 'function' && el.matches(sel)) return el;
        el = el.parentElement;
      }
    } catch (e) {
      // best-effort
    }
    return null;
  }

  const handle = (event) => {
    const target = closestAncestor(event.target, selector);
    if (!target) return;
    primeNavigationTarget(target);
  };

  document.addEventListener('pointerenter', handle, true);
  document.addEventListener('focusin', handle, true);

  document.addEventListener('click', async (event) => {
    const liveHubButton = closestAncestor(event.target, '[data-live-hub-toggle]');
    if (!liveHubButton || window.CollegeOSLiveHub) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    liveHubButton.disabled = true;
    try {
      liveHubScriptPromise = liveHubScriptPromise || ensureLiveHubScript().catch(() => {
        liveHubScriptPromise = null;
        return null;
      });
      await liveHubScriptPromise;
      await window.CollegeOSLiveHub?.boot?.();
      window.CollegeOSLiveHub?.toggle?.();
    } catch {
      // Leave the button usable if Live Hub loading fails.
    } finally {
      liveHubButton.disabled = false;
    }
  }, true);
}

function mountShell() {
  const shell = document.querySelector('[data-shell]');
  if (!shell) return;
  shell.innerHTML = `
    <aside class="sidebar">
      <div class="sidebar-head">
        <a class="logo" href="/dashboard" aria-label="College OS home"><i class="fa-solid fa-graduation-cap"></i><span>College OS</span></a>
        <button class="sidebar-toggle" id="sidebarToggle" type="button" aria-label="Collapse sidebar" title="Collapse sidebar">
          <i class="fa-solid fa-angle-left" id="sidebarToggleIcon"></i>
        </button>
      </div>
      <div class="sidebar-nav-wrap">
        <nav class="nav-list">${navHtml()}</nav>
      </div>
      <section class="sidebar-profile" id="sidebarProfile">
        <div class="sidebar-avatar" id="sidebarUserAvatar">CO</div>
        <div class="sidebar-user-meta">
          <strong id="sidebarUserName">College User</strong>
          <span id="sidebarUserRole">Student</span>
        </div>
      </section>
    </aside>
    <button class="sidebar-backdrop" id="sidebarBackdrop" type="button" aria-hidden="true" aria-label="Close navigation"></button>
    <section class="main-area">
      <header class="topbar">
        <button class="icon-chip mobile-sidebar-toggle" id="mobileSidebarToggle" type="button" aria-expanded="false" aria-label="Open navigation" title="Open navigation">
          <i class="fa-solid fa-bars"></i>
          <span class="mobile-sidebar-toggle-label">Menu</span>
        </button>
        <a class="topbar-brand" href="/dashboard" aria-label="College OS home"><i class="fa-solid fa-graduation-cap"></i><strong id="pageTitle">College OS</strong></a>
        <div class="quick-icons">
          <a class="icon-chip" href="/notifications" id="topbarNotifBtn" title="Notifications"><i class="fa-solid fa-bell"></i><span class="nav-badge" id="notifNavBadge" style="display:none;">0</span></a>
          <a class="icon-chip" href="/roadmap"><i class="fa-solid fa-map"></i> Roadmap</a>
          <a class="icon-chip" href="/ai-tools"><i class="fa-solid fa-sparkles"></i> AI Tools</a>
          <a class="icon-chip" href="/notes"><i class="fa-solid fa-file-lines"></i> Notes</a>
          <a class="icon-chip" href="/contribute"><i class="fa-solid fa-upload"></i> Contribute</a>
          <a class="icon-chip" href="/certificates"><i class="fa-solid fa-graduation-cap"></i> Certificates</a>
          <button class="icon-chip" id="logoutBtn" style="border: 1px solid rgba(0,0,0,0.1); cursor:pointer;"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>
        </div>
      </header>
      <main class="content" id="contentMount"></main>
    </section>
    <nav class="mobile-nav">${mobileNavHtml()}</nav>
  `;
}

function bindMobileSidebar() {
  const shell = document.querySelector('.app-shell');
  const toggle = document.getElementById('mobileSidebarToggle');
  const backdrop = document.getElementById('sidebarBackdrop');
  const sidebar = document.querySelector('.sidebar');
  if (!shell || !toggle || !backdrop || !sidebar) return;

  const syncForViewport = () => {
    if (!isMobileViewport()) {
      closeMobileSidebar();
      return;
    }
    shell.classList.remove('sidebar-collapsed');
    closeMobileSidebar();
  };

  toggle.addEventListener('click', () => {
    if (!isMobileViewport()) return;
    const isOpen = shell.classList.contains('mobile-sidebar-open');
    setMobileSidebarOpen(!isOpen);
  });

  backdrop.addEventListener('click', closeMobileSidebar);

  sidebar.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('a, button') : null;
    if (!target || !isMobileViewport()) return;
    closeMobileSidebar();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMobileSidebar();
  });

  window.addEventListener('resize', syncForViewport, { passive: true });
  syncForViewport();
}

function bindSidebarCollapse() {
  const shell = document.querySelector('.app-shell');
  const toggle = document.getElementById('sidebarToggle');
  const icon = document.getElementById('sidebarToggleIcon');
  if (!shell || !toggle || !icon) return;

  const key = 'collegeos_sidebar_collapsed';

  function applyState(collapsed) {
    if (isMobileViewport()) {
      shell.classList.remove('sidebar-collapsed');
      return;
    }
    shell.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
    icon.className = collapsed ? 'fa-solid fa-angle-right' : 'fa-solid fa-angle-left';
  }

  const saved = window.localStorage.getItem(key) === '1';
  applyState(saved);

  toggle.addEventListener('click', () => {
    if (isMobileViewport()) {
      openMobileSidebar();
      return;
    }
    const collapsed = !shell.classList.contains('sidebar-collapsed');
    applyState(collapsed);
    window.localStorage.setItem(key, collapsed ? '1' : '0');
  });

  window.addEventListener('resize', () => {
    if (isMobileViewport()) {
      shell.classList.remove('sidebar-collapsed');
      return;
    }
    applyState(window.localStorage.getItem(key) === '1');
  }, { passive: true });
}

async function hydrateSidebarProfile() {
  const card = document.getElementById('sidebarProfile');
  const avatar = document.getElementById('sidebarUserAvatar');
  const nameNode = document.getElementById('sidebarUserName');
  const roleNode = document.getElementById('sidebarUserRole');
  const user = window.collegeOsCurrentUser;

  if (!card || !avatar || !nameNode || !roleNode) return;
  if (!user) {
    card.style.display = 'none';
    return;
  }

  const fullName = user.fullName || user.full_name || user.name || 'Student';
  const initials = fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'CO';

  nameNode.textContent = fullName;
  avatar.textContent = initials;

  let subLabel = user.role ? user.role[0].toUpperCase() + user.role.slice(1) : 'Student';
  let planLabel = '';


  // --- Caching for subscription and stats to reduce rate limit issues ---
  if (!window._cachedSubscription) window._cachedSubscription = { data: null, ts: 0 };
  if (!window._cachedStats) window._cachedStats = { data: null, ts: 0 };
  const now = Date.now();
  try {
    if (window.CollegeOSApi) {
      let stats;
      if (window._cachedStats.data && now - window._cachedStats.ts < 60000) {
        stats = window._cachedStats.data;
      } else {
        const [statsPayload, subscriptionPayload] = await Promise.all([
          window.CollegeOSApi.getDashboardStats(),
          window.CollegeOSApi.getSubscription()
        ]);
        stats = statsPayload;
        window._cachedSubscription = { data: subscriptionPayload, ts: now };
        window._cachedStats = { data: stats, ts: now };
      }
      const xp = stats?.xp ?? stats?.totalXp ?? stats?.totalXP ?? null;
      if (xp !== null && xp !== undefined && !Number.isNaN(Number(xp))) {
        subLabel = `${Number(xp)} XP`;
      }

      let subscription;
      if (window._cachedSubscription.data && now - window._cachedSubscription.ts < 60000) {
        subscription = window._cachedSubscription.data;
      } else {
        subscription = await window.CollegeOSApi.getSubscription();
        window._cachedSubscription = { data: subscription, ts: now };
      }
      const statusLabel = subscription?.statusLabel || 'Free';
      const plan = subscription?.plan === 'premium' ? 'Premium' : 'Free';
      planLabel = `<span class="membership-badge ${String(statusLabel).toLowerCase().replace(/\s+/g, '-')}">${plan} · ${statusLabel}</span>`;
    }
  } catch {
    // Keep role text fallback when stats are unavailable.
  }

  roleNode.innerHTML = `${subLabel}${planLabel ? ` ${planLabel}` : ''}`;
}

async function applyPremiumLocks() {
  const premiumPages = {
    'notes-library.html': 'premium notes and downloads',
    'certificates.html': 'certificates',
    'previous-papers.html': 'premium downloads'
  };

  const file = pageName();
  const lockTarget = premiumPages[file];
  if (!lockTarget || !window.CollegeOSApi || !window.collegeOsCurrentUser) return;

  try {
    const membership = await window.CollegeOSApi.getSubscription();
    if (membership.plan === 'premium' && membership.status === 'active') return;

    const content = document.querySelector('.content');
    if (!content || content.querySelector('.premium-lock-overlay')) return;

    const statusLabel = membership.statusLabel || 'Free';
    const messageByStatus = {
      'Pending Approval': 'Payment submitted successfully. Waiting for admin verification.',
      Rejected: 'Your payment request was rejected. Submit a fresh payment proof to continue.',
      Expired: 'Your premium membership has expired. Renew to continue full access.'
    };

    const infoText = messageByStatus[statusLabel] || 'Upgrade to Premium to unlock this feature.';
    const overlay = document.createElement('section');
    overlay.className = 'premium-lock-overlay';
    overlay.innerHTML = `
      <div class="premium-lock-card">
        <p class="lock-kicker">Premium Feature</p>
        <h3>Unlock ${lockTarget}</h3>
        <p>${infoText}</p>
        <a class="btn warn" href="pricing.html">Upgrade Now</a>
      </div>
    `;

    content.classList.add('content-premium-locked');
    content.appendChild(overlay);
  } catch {
    // Keep page usable if membership endpoint fails.
  }
}

async function trackPageViewEvent() {
  if (!window.CollegeOSApi || !window.collegeOsCurrentUser) return;
  try {
    await window.CollegeOSApi.trackLearnerEvent({
      eventType: 'page_view',
      source: 'web',
      eventPayload: {
        page: pageName(),
        path: window.location.pathname,
        timestamp: new Date().toISOString()
      }
    });
  } catch {
    // Keep page rendering resilient if telemetry endpoint is unavailable.
  }
}

function setTitle() {
  const mount = document.getElementById('pageTitle');
  const hero = document.querySelector('[data-page-title]');
  if (mount && hero) {
    mount.textContent = hero.textContent.trim();
  }
}

function setContentLoadingState(isLoading) {
  const target = document.getElementById('contentMount');
  if (!target) return;
  target.classList.toggle('content-loading', isLoading);
  target.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  document.body.classList.toggle('app-loading', isLoading);
}

function isMobileViewport() {
  return Boolean(window.matchMedia && window.matchMedia('(max-width: 980px)').matches);
}

function setMobileSidebarOpen(isOpen) {
  const shell = document.querySelector('.app-shell');
  const backdrop = document.getElementById('sidebarBackdrop');
  const toggle = document.getElementById('mobileSidebarToggle');
  if (!shell) return;

  shell.classList.toggle('mobile-sidebar-open', isOpen);
  document.body.classList.toggle('sidebar-open', isOpen);

  if (toggle) {
    toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  }

  if (backdrop) {
    backdrop.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  }
}

function closeMobileSidebar() {
  setMobileSidebarOpen(false);
}

function openMobileSidebar() {
  setMobileSidebarOpen(true);
}

function mountContent() {
  const template = document.querySelector('template[data-page]');
  const target = document.getElementById('contentMount');
  if (!template || !target) return;
  target.append(template.content.cloneNode(true));
}

function publicPage() {
  const file = pageName();
  return ['index.html', 'login', 'signup', 'pricing.html', 'support.html', 'about-us.html', 'contact-us.html', 'help-center.html', 'login.html', 'signup.html'].includes(file);
}

async function hydrateCommonStats() {
  if (!window.CollegeOSApi) return;

  try {
    const needsProfileTotals = Boolean(document.querySelector('[data-stat="myRoadmaps"]') || document.querySelector('[data-stat="savedNotes"]'));
    const [profile, dashboard] = await Promise.all([
      needsProfileTotals ? window.CollegeOSApi.getProfile() : Promise.resolve(null),
      window.CollegeOSApi.getDashboardStats().catch(() => ({}))
    ]);

    const stats = {
      ...(profile?.totals || {}),
      ...(dashboard || {})
    };

    document.querySelectorAll('[data-stat]').forEach((node) => {
      const key = node.dataset.stat;
      if (stats[key] !== undefined) node.textContent = stats[key];
    });
  } catch {
    // Ignore on pages where stats are not required.
  }
}

async function applyAuthGuard() {
  if (!window.CollegeOSApi) return;
  setContentLoadingState(true);
  let user = null;
  let lastError = null;

  const checkOnce = async () => {
    try {
      const result = await window.CollegeOSApi.getMe();
      return { ok: true, user: result.user };
    } catch (err) {
      return { ok: false, error: err };
    }
  };

  // Try initial check
  let res = await checkOnce();
  if (!res.ok) {
    lastError = res.error;
    // Retry once for transient network issues
    await new Promise((r) => setTimeout(r, 400));
    res = await checkOnce();
    if (!res.ok) {
      lastError = res.error;
    }
  }

  if (res.ok) {
    user = res.user;
  }

  window.collegeOsCurrentUser = user;
  renderSidebarNav();

  // Ensure protected pages are blocked until auth check completes
  const file = pageName();
  const isProtected = (function() {
    const p = window.PROTECTED_PAGES || [];
    const name = String(file || '').toLowerCase();
    if (!p.length) return false;
    return p.includes(name) || p.includes(name.replace(/\.html$/i, ''));
  })();

  if (!user && isProtected) {
    setContentLoadingState(false);
    goToRoute('/login', { replace: true });
    return;
  }

  // If explicit unauthorized, redirect to login for protected pages
  if (!user && lastError && (lastError.status === 401 || lastError.status === 403)) {
    if (!publicPage()) {
      setContentLoadingState(false);
      goToRoute('/login', { replace: true });
      return;
    }
  }

  // If no user and no explicit auth error, avoid aggressive redirect — allow public pages and proceed on transient failures
  if (!user && !publicPage() && !lastError) {
    // No session but no error (unexpected) — redirect conservatively
    setContentLoadingState(false);
    goToRoute('/login', { replace: true });
    return;
  }

  if (!user && !publicPage() && lastError) {
    // Non-auth error (network) — do not redirect immediately; show a gentle message and keep loading off.
    setContentLoadingState(false);
    return;
  }

  if (user && ['login.html', 'signup.html', 'login', 'signup'].includes(pageName())) {
    setContentLoadingState(false);
    goToRoute('/dashboard', { replace: true });
    return;
  }

  setContentLoadingState(false);
}

async function enforceAcademicOnboarding() {
  return;
}

function bindLogout() {
  const button = document.getElementById('logoutBtn');
  if (!button || !window.CollegeOSApi) return;
  if (!window.collegeOsCurrentUser) {
    button.style.display = 'none';
    return;
  }
  button.addEventListener('click', async () => {
    if (button.dataset.busy === '1') return;
    button.dataset.busy = '1';
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Logging out...';

    try {
      try {
        await window.CollegeOSApi.logout();
      } catch {
        // Continue cleanup even if the API call fails or the session is already gone.
      }

      try { window.CollegeOSApiClient?.clearSessionCache?.(); } catch { /* ignore */ }
      try { window.CollegeOSApiClient?.setCsrfToken?.(null); } catch { /* ignore */ }
      try { window.CollegeOSLiveHub?.dispose?.(); } catch { /* ignore */ }
      try { window.CollegeOSLiveHub?.close?.(); } catch { /* ignore */ }
      try { window.CollegeOSLiveHub?.reset?.(); } catch { /* ignore */ }
      try { window.CollegeOSLiveHub?.disconnect?.(); } catch { /* ignore */ }

      try {
        const keys = [
          'collegeOsCurrentUser',
          'collegeos_theme',
          'collegeos_warmup_once:shell:dashboard-bootstrap',
          'collegeos_live_hub_ui_state',
          'collegeos_live_hub_active_session',
          'collegeos_live_hub_selected_session',
          'collegeos_live_hub_chat',
          'collegeos_live_hub_channel'
        ];
        keys.forEach((key) => {
          window.localStorage.removeItem(key);
          window.sessionStorage.removeItem(key);
        });
      } catch {
        // Ignore storage failures.
      }

      try {
        Object.keys(window.sessionStorage || {}).forEach((key) => {
          if (/^(collegeos_|collegeOs|cs?rf|auth)/i.test(key)) {
            window.sessionStorage.removeItem(key);
          }
        });
      } catch {
        // Ignore storage iteration failures.
      }

      showToast('Logged out successfully.', 'success');
      goToRoute('/login', { replace: true });
    } finally {
      button.dataset.busy = '0';
      button.disabled = false;
      button.innerHTML = original;
    }
  });
}

function ensureLiveHubScript() {
  if (window.CollegeOSLiveHub) return Promise.resolve(window.CollegeOSLiveHub);
  if (document.querySelector('script[data-live-hub-script]')) {
    return new Promise((resolve) => {
      const poll = () => {
        if (window.CollegeOSLiveHub) resolve(window.CollegeOSLiveHub);
        else window.setTimeout(poll, 25);
      };
      poll();
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'assets/js/live-hub.js';
    script.defer = true;
    script.dataset.liveHubScript = 'true';
    script.onload = () => resolve(window.CollegeOSLiveHub || null);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function bindAdminShortcut() {
  if (window.__collegeOsAdminShortcutBound) return;
  window.__collegeOsAdminShortcutBound = true;
  window.addEventListener('keydown', (event) => {
    try {
      const isCtrl = Boolean(event.ctrlKey || event.metaKey);
      const isShift = Boolean(event.shiftKey);
      const isA = event.code === 'KeyA' || String(event.key || '').toLowerCase() === 'a';
      if (!isCtrl || !isShift || !isA) return;
      event.preventDefault();
      const target = `${window.location.origin}/admin-login.html`;
      try { window.location.assign(target); } catch { window.location.href = target; }
    } catch (e) { }
  }, { passive: false });
}

function showToast(message, tone = 'info') {
  if (!message) return;
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'app-toast-host';
    document.body.appendChild(toastHost);
  }

  const toast = document.createElement('div');
  toast.className = `app-toast ${tone}`;
  toast.textContent = message;
  toastHost.appendChild(toast);

  window.setTimeout(() => {
    toast.classList.add('is-hiding');
    window.setTimeout(() => toast.remove(), 220);
  }, 2200);
}

window.__collegeOsToast = showToast;

async function hydrateNotificationBadge() {
  const badge = document.getElementById('notifNavBadge');
  if (!badge || !window.CollegeOSApi || !window.collegeOsCurrentUser) return;

  try {
    const result = await window.CollegeOSApi.getUnreadNotificationCount();
    const unread = Number(result?.unreadCount || 0);
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch {
    badge.style.display = 'none';
  }
}

async function applyContributionVisibility() {
  if (!window.CollegeOSApi || !window.collegeOsCurrentUser) return;
  if (window.collegeOsCurrentUser.role === 'admin') return;

  try {
    const payload = await window.CollegeOSApi.getContributionConfig();
    const cfg = payload?.config || {};
    const enabled = cfg.enabled !== false;
    const showEntry = cfg?.visibility?.showHubEntryPoint !== false;
    const visible = enabled && showEntry;

    const desktopLink = document.querySelector('.nav-link[href="/contribute"]');
    if (desktopLink) desktopLink.style.display = visible ? '' : 'none';

    const topbarLink = document.querySelector('.quick-icons .icon-chip[href="/contribute"]');
    if (topbarLink) topbarLink.style.display = visible ? '' : 'none';

    if (!visible && pageName() === 'academic-contribution-hub.html') {
      goToRoute('/dashboard', { replace: true });
    }
  } catch {
    // Keep links visible if config fetch fails.
  }
}

function bindRealtimeNotificationBadge() {
  if (!window.CollegeOSApi || !window.collegeOsCurrentUser || typeof window.EventSource !== 'function') return;
  const streamUrl = window.CollegeOSApi.getNotificationRealtimeStreamUrl
    ? window.CollegeOSApi.getNotificationRealtimeStreamUrl()
    : '/api/notifications/stream';

  let source = null;
  let retryTimer = null;
  let retryDelay = 3000;

  const open = () => {
    if (source) {
      source.close();
      source = null;
    }

    source = new EventSource(streamUrl, { withCredentials: true });
    const refresh = () => {
      hydrateNotificationBadge().catch(() => {
        // Ignore badge refresh failures on background updates.
      });
    };

    const forwardRealtimeEvent = (eventName, event) => {
      let detail = {};
      try {
        detail = event?.data ? JSON.parse(event.data) : {};
      } catch {
        detail = {};
      }
      window.dispatchEvent(new CustomEvent('collegeos:realtime', {
        detail: {
          type: eventName,
          payload: detail
        }
      }));
    };

    ['notification_created', 'notification_updated', 'notification_changed', 'student_updated', 'membership_updated', 'certificate_updated', 'support_updated', 'live_session_updated']
      .forEach((eventName) => source.addEventListener(eventName, (event) => {
        refresh();
        forwardRealtimeEvent(eventName, event);
      }));
    source.addEventListener('content_changed', (event) => forwardRealtimeEvent('content_changed', event));
    source.addEventListener('campus_post_moderated', refresh);
    source.addEventListener('campus_official_post_published', refresh);

    source.onerror = () => {
      source?.close();
      source = null;
      if (retryTimer) clearTimeout(retryTimer);
      // Exponential backoff up to 30s
      retryTimer = setTimeout(() => {
        open();
        retryDelay = Math.min(retryDelay * 2, 30000);
      }, retryDelay);
    };

    // Reset delay on successful open
    source.onopen = () => {
      retryDelay = 3000;
    };
  };

  open();
  window.addEventListener('beforeunload', () => {
    if (retryTimer) clearTimeout(retryTimer);
    source?.close();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindAdminShortcut();
  mountShell();
  bindNavigationPrefetch();
  bindMobileSidebar();
  bindSidebarCollapse();
  mountContent();
  setTitle();
  setContentLoadingState(true);

  try {
    await applyAuthGuard();
    bindLogout();

    setContentLoadingState(false);

    if (window.CollegeOSApi?.warmupRequests) {
      const warmupPaths = [
        '/api/dashboard/bootstrap',
        '/api/notifications/unread-count',
        '/api/contributions/config'
      ];
      const warmupOnce = window.CollegeOSApi.warmupRequestsOnce;
      const warmupMany = window.CollegeOSApi.warmupRequests;
      if (typeof warmupOnce === 'function') {
        warmupOnce('warmup:dashboard-bootstrap', warmupPaths).catch(() => null);
      } else if (typeof warmupMany === 'function') {
        warmupMany(warmupPaths).catch(() => null);
      }
    }

    const backgroundTasks = [
      hydrateSidebarProfile(),
      hydrateCommonStats(),
      hydrateNotificationBadge(),
      applyContributionVisibility(),
      applyPremiumLocks(),
      trackPageViewEvent()
    ];

    Promise.allSettled(backgroundTasks).finally(() => {
      window.requestIdleCallback
        ? window.requestIdleCallback(() => bindRealtimeNotificationBadge())
        : window.setTimeout(() => bindRealtimeNotificationBadge(), 0);
    });
  } finally {
    setContentLoadingState(false);
  }
});
