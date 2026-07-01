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

    sync();
    mobileQuery.addEventListener('change', sync);
    window.addEventListener('resize', sync, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
