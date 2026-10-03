/**
 * College OS - Shared Public Navigation, Mobile Drawer, and Dynamic Stats Hydrator
 */
(function () {
  function initNav() {
    const currentPath = window.location.pathname.replace(/\.html$/i, '') || '/';
    
    // Highlight active link
    document.querySelectorAll('.co-nav-link, .co-drawer-link').forEach((link) => {
      const href = (link.getAttribute('href') || '').replace(/\.html$/i, '');
      if (href === currentPath || (currentPath === '/' && (href === '/' || href === '/index'))) {
        link.classList.add('active');
      } else if (href !== '/' && currentPath.startsWith(href)) {
        link.classList.add('active');
      }
    });

    // Mobile Drawer Toggle
    const toggleBtn = document.getElementById('coNavToggle');
    const drawer = document.getElementById('coMobileDrawer');
    const closeBtn = document.getElementById('coDrawerClose');

    if (toggleBtn && drawer) {
      toggleBtn.addEventListener('click', () => {
        drawer.classList.add('open');
        document.body.style.overflow = 'hidden';
      });
    }

    if (closeBtn && drawer) {
      closeBtn.addEventListener('click', () => {
        drawer.classList.remove('open');
        document.body.style.overflow = '';
      });
    }

    if (drawer) {
      drawer.addEventListener('click', (e) => {
        if (e.target === drawer) {
          drawer.classList.remove('open');
          document.body.style.overflow = '';
        }
      });
    }

    // FAQ Accordion Toggle
    document.querySelectorAll('.co-accordion-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.co-accordion-item');
        if (!item) return;
        const isActive = item.classList.contains('active');
        // Close siblings in same accordion
        const parent = item.closest('.co-accordion');
        if (parent) {
          parent.querySelectorAll('.co-accordion-item').forEach((sibling) => sibling.classList.remove('active'));
        }
        if (!isActive) {
          item.classList.add('active');
        }
      });
    });
  }

  // Hydrate real dynamic stats from backend
  async function hydratePublicStats() {
    try {
      const [branchesRes, semestersRes, subsRes] = await Promise.all([
        fetch('/api/academics/branches').then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
        fetch('/api/academics/semesters').then((r) => (r.ok ? r.json() : { data: [] })).catch(() => ({ data: [] })),
        fetch('/api/subscriptions/config').then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);

      const branchCount = (branchesRes.data || []).length || 6;
      const semesterCount = (semestersRes.data || []).length || 8;
      
      document.querySelectorAll('[data-live-stat="branches"]').forEach((el) => {
        el.textContent = `${branchCount}+`;
      });

      document.querySelectorAll('[data-live-stat="semesters"]').forEach((el) => {
        el.textContent = `${semesterCount} Semesters`;
      });

      if (subsRes && subsRes.plans && subsRes.plans.premium) {
        document.querySelectorAll('[data-live-stat="premium-price"]').forEach((el) => {
          el.textContent = `₹${subsRes.plans.premium.priceInr || 49}/mo`;
        });
      }
    } catch (e) {
      // Fallbacks already in HTML
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    hydratePublicStats();
  });
})();
