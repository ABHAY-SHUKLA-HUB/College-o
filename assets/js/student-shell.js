/**
 * College OS — Unified Student Portal Shell Controller
 * Standardizes navigation, mobile drawer, active state, theme toggle, and profile display across all student pages.
 */

(function (global) {
  'use strict';

  function getInitials(name) {
    if (!name) return 'ST';
    const parts = String(name).trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  function initThemeToggle() {
    const themeBtn = document.getElementById('studentThemeToggle') || document.getElementById('themeToggleBtn');
    if (!themeBtn) return;

    function updateThemeIcon(mode) {
      const icon = themeBtn.querySelector('i') || document.getElementById('themeIcon');
      if (icon) {
        icon.className = mode === 'dark' ? 'fa-solid fa-sun' : 'fa-regular fa-sun';
      }
    }

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

  function initSidebarAndDrawer() {
    const sidebar = document.getElementById('studentSidebar');
    const toggleBtn = document.getElementById('studentSidebarToggle') || document.getElementById('mobileNavToggle');
    const closeBtn = document.getElementById('studentSidebarClose');
    const backdrop = document.getElementById('studentBackdrop');

    function openDrawer() {
      if (sidebar) sidebar.classList.add('active');
      if (backdrop) backdrop.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
      if (sidebar) sidebar.classList.remove('active');
      if (backdrop) backdrop.classList.remove('active');
      document.body.style.overflow = '';
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (sidebar && sidebar.classList.contains('active')) {
          closeDrawer();
        } else {
          openDrawer();
        }
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDrawer();
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDrawer();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

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
        const search = document.getElementById('studentGlobalSearch') || document.querySelector('.co-quick-search input');
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      }
    });

    // Global Search Redirection on Enter
    const globalSearchInput = document.getElementById('studentGlobalSearch') || document.querySelector('.co-quick-search input');
    if (globalSearchInput) {
      globalSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const q = globalSearchInput.value.trim();
          if (q) {
            window.location.href = `notes-library.html?search=${encodeURIComponent(q)}`;
          }
        }
      });
    }
  }

  function highlightActiveNav() {
    const currentPath = window.location.pathname.split('/').pop().toLowerCase() || 'dashboard.html';
    const navItems = document.querySelectorAll('.co-sidebar-nav .nav-item, .co-sidebar-nav .co-nav-item');

    navItems.forEach(item => {
      const href = item.getAttribute('href') || '';
      const targetPath = href.split('/').pop().split('#')[0].toLowerCase();
      
      if (targetPath === currentPath || 
         (currentPath === 'dashboard.html' && targetPath === '') ||
         (currentPath === 'notes.html' && targetPath === 'notes-library.html') ||
         (currentPath === 'previous-papers.html' && targetPath === 'pyqs.html') ||
         (currentPath === 'career-roadmaps.html' && targetPath === 'study-roadmap.html') ||
         (currentPath === 'ai-study.html' && targetPath === 'ai-tools.html') ||
         (currentPath === 'college-feed.html' && targetPath === 'community.html') ||
         (currentPath === 'support-hub.html' && targetPath === 'support-hub.html') ||
         (currentPath === 'my-tickets.html' && targetPath === 'support-hub.html') ||
         (currentPath === 'create-support-request.html' && targetPath === 'support-hub.html') ||
         (currentPath === 'live-hub.html' && targetPath === 'live-study.html')) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  }

  async function populateStudentProfile() {
    let user = null;
    try {
      user = JSON.parse(localStorage.getItem('user') || 'null');
    } catch (e) {}

    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (data.user || data.email) {
          user = data.user || data;
        }
      }
    } catch (e) {}

    if (!user) return;

    const name = user.name || user.fullName || user.email?.split('@')[0] || 'Student';
    const initials = getInitials(name);
    const role = user.role || 'Scholar';

    // Sidebar footer
    const sbAvatar = document.getElementById('sidebarStudentAvatar') || document.getElementById('sidebarUserInitials');
    const sbName = document.getElementById('sidebarStudentName') || document.getElementById('sidebarUserName');
    const sbSub = document.getElementById('sidebarStudentSub') || document.getElementById('sidebarUserRole');
    if (sbAvatar) sbAvatar.textContent = initials;
    if (sbName) sbName.textContent = name;
    if (sbSub) sbSub.textContent = role;

    // Topbar
    const tpAvatar = document.getElementById('studentProfileAvatar') || document.getElementById('topbarUserAvatar');
    const tpName = document.getElementById('studentProfileName');
    const tpRole = document.getElementById('studentProfileRole');
    if (tpAvatar) tpAvatar.textContent = initials;
    if (tpName) tpName.textContent = name;
    if (tpRole) tpRole.textContent = role;

    // Dropdown details
    const ddName = document.getElementById('dropdownStudentName');
    const ddEmail = document.getElementById('dropdownStudentEmail');
    if (ddName) ddName.textContent = name;
    if (ddEmail) ddEmail.textContent = user.email || '';
  }

  function init() {
    initThemeToggle();
    initSidebarAndDrawer();
    highlightActiveNav();
    populateStudentProfile();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  global.CollegeStudentShell = {
    init,
    highlightActiveNav,
    populateStudentProfile
  };

})(typeof window !== 'undefined' ? window : this);
