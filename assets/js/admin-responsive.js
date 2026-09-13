(function () {
  if (typeof document === 'undefined' || !document.body || !document.body.classList.contains('admin-portal')) {
    return;
  }

  const mobileQuery = window.matchMedia('(max-width: 980px)');

  function getShell() {
    return document.querySelector('.co-admin-shell');
  }

  function setDrawerOpen(isOpen) {
    const shell = getShell();
    const backdrop = document.getElementById('coAdminBackdrop');
    const toggle = document.getElementById('coAdminMenuToggle');
    if (!shell) return;

    shell.classList.toggle('co-admin-drawer-open', isOpen);
    document.body.classList.toggle('admin-drawer-open', isOpen);

    if (toggle) {
      toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      toggle.setAttribute('aria-label', isOpen ? 'Close admin navigation' : 'Open admin navigation');
    }

    if (backdrop) {
      backdrop.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  function init() {
    if (window.AdminModuleRegistry && typeof window.AdminModuleRegistry.initNavigation === 'function') {
      try {
        window.AdminModuleRegistry.initNavigation();
      } catch (err) {
        console.warn('[AdminNavigation] Error initializing module registry navigation:', err);
      }
    }

    const shell = getShell();
    const aside = document.querySelector('.co-admin-aside');
    const topbar = document.querySelector('.co-admin-topbar');
    if (!shell || !aside || !topbar) return;
    if (document.getElementById('coAdminMenuToggle')) return;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'coAdminMenuToggle';
    toggle.className = 'co-admin-chip co-admin-menu-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open admin navigation');
    toggle.innerHTML = '<i class="fa-solid fa-bars"></i><span>Menu</span>';

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.id = 'coAdminBackdrop';
    backdrop.className = 'co-admin-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.setAttribute('aria-label', 'Close admin navigation');

    topbar.insertBefore(toggle, topbar.firstChild);
    shell.appendChild(backdrop);

    toggle.addEventListener('click', () => {
      if (!mobileQuery.matches) return;
      setDrawerOpen(!shell.classList.contains('co-admin-drawer-open'));
    });

    backdrop.addEventListener('click', closeDrawer);

    aside.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('a, button') : null;
      if (!target || !mobileQuery.matches) return;
      closeDrawer();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeDrawer();
    });

    const sync = () => {
      if (!mobileQuery.matches) {
        closeDrawer();
      }
    };

    function updateActiveNav() {
      const fullPath = window.location.pathname.split('/').pop() || 'admin-dashboard.html';
      const currentHash = window.location.hash || '';
      const navLinks = document.querySelectorAll('.co-admin-nav-link');

      if (!navLinks.length) return;

      let bestMatch = null;
      let highestScore = -1;

      navLinks.forEach((link) => {
        const rawHref = link.getAttribute('href');
        if (!rawHref) return;

        const [linkPath, linkHash] = rawHref.split('#');
        const targetHash = linkHash ? `#${linkHash}` : '';

        let score = -1;

        if (linkPath === fullPath) {
          if (targetHash && currentHash && targetHash.toLowerCase() === currentHash.toLowerCase()) {
            score = 10; // Exact match with hash
          } else if (!targetHash && !currentHash) {
            score = 5; // Path match without hash
          } else if (!targetHash && currentHash) {
            score = 1; // Fallback path match
          }
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = link;
        }
      });

      if (bestMatch && highestScore > 0) {
        navLinks.forEach((l) => l.classList.remove('active'));
        bestMatch.classList.add('active');
      }
    }

    sync();
    updateActiveNav();

    window.addEventListener('hashchange', updateActiveNav);
    mobileQuery.addEventListener('change', sync);
    window.addEventListener('resize', sync, { passive: true });
  }

  window.CollegeAdminDrawer = {
    open(drawerId) {
      const drawer = document.getElementById(drawerId);
      let backdrop = document.querySelector('.co-admin-drawer-backdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.className = 'co-admin-drawer-backdrop';
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', () => window.CollegeAdminDrawer.closeAll());
      }
      if (drawer) {
        backdrop.classList.add('open');
        drawer.classList.add('open');
      }
    },
    close(drawerId) {
      const drawer = document.getElementById(drawerId);
      if (drawer) drawer.classList.remove('open');
      const openDrawers = document.querySelectorAll('.co-admin-drawer.open');
      if (!openDrawers.length) {
        const backdrop = document.querySelector('.co-admin-drawer-backdrop');
        if (backdrop) backdrop.classList.remove('open');
      }
    },
    closeAll() {
      document.querySelectorAll('.co-admin-drawer.open').forEach((d) => d.classList.remove('open'));
      const backdrop = document.querySelector('.co-admin-drawer-backdrop');
      if (backdrop) backdrop.classList.remove('open');
    }
  };

  window.renderAdminState = function(container, stateType, options = {}) {
    if (!container) return;
    if (stateType === 'loading') {
      const rows = options.rows || 4;
      let html = '<div style="display:grid; gap:12px; padding:16px;">';
      for (let i = 0; i < rows; i++) {
        html += '<div class="co-admin-skeleton" style="width:' + (85 - (i % 3) * 15) + '%;"></div>';
      }
      html += '</div>';
      container.innerHTML = html;
    } else if (stateType === 'empty') {
      container.innerHTML = `
        <div class="co-admin-empty-state">
          <i class="fa-solid ${options.icon || 'fa-inbox'} icon"></i>
          <h4>${options.title || 'No Records Found'}</h4>
          <p>${options.description || 'There are no items matching your criteria.'}</p>
          ${options.actionLabel ? `<button class="btn primary btn-sm" id="${options.actionId || ''}">${options.actionLabel}</button>` : ''}
        </div>`;
    } else if (stateType === 'error') {
      container.innerHTML = `
        <div class="co-admin-error-state">
          <i class="fa-solid fa-triangle-exclamation icon"></i>
          <h4>Unable to Load Data</h4>
          <p>${options.error || 'A network error occurred while connecting to the server.'}</p>
          ${options.retryId ? `<button class="btn secondary btn-sm" id="${options.retryId}">Retry</button>` : ''}
        </div>`;
    }
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.CollegeAdminDrawer.closeAll();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();


