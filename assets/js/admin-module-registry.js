/**
 * College OS — Authoritative Admin Module Registry
 * Single Source of Truth for Admin Sidebar, Quick Switch, Breadcrumbs, Canonical Routes, and Permission Guards.
 * 
 * Part 2/15 Architecture Fix
 */

(function (global) {
  'use strict';

  const SECTIONS = [
    { id: 'OVERVIEW', label: 'Overview', order: 1, icon: 'fa-solid fa-chart-pie' },
    { id: 'ACADEMIC', label: 'Academic Content', order: 2, icon: 'fa-solid fa-graduation-cap' },
    { id: 'STUDENTS', label: 'Student Management', order: 3, icon: 'fa-solid fa-user-graduate' },
    { id: 'COMMERCE', label: 'Membership & Commerce', order: 4, icon: 'fa-solid fa-id-card' },
    { id: 'CODING', label: 'Coding & Certification', order: 5, icon: 'fa-solid fa-code' },
    { id: 'EXPERIENCE', label: 'Experience', order: 6, icon: 'fa-solid fa-wand-magic-sparkles' },
    { id: 'COMMUNITY', label: 'Community', order: 7, icon: 'fa-solid fa-users-rays' },
    { id: 'SUPPORT', label: 'Support', order: 8, icon: 'fa-solid fa-headset' },
    { id: 'PLATFORM', label: 'Platform & Governance', order: 9, icon: 'fa-solid fa-sliders' }
  ];

  const MODULES = [
    // --- OVERVIEW ---
    {
      id: 'ADM-01',
      label: 'Dashboard',
      canonicalRoute: '/admin-dashboard.html',
      hashAnchor: '',
      section: 'OVERVIEW',
      icon: 'fa-solid fa-chart-pie',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'view_dashboard',
      description: 'Executive KPI board & system health overview',
      studentFeatureKey: null,
      aliases: ['/admin', '/admin/', '/admin-dashboard', '/admin-dashboard.html']
    },
    {
      id: 'ADM-02',
      label: 'Control Center & Analytics',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '',
      section: 'OVERVIEW',
      icon: 'fa-solid fa-sliders',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'view_analytics',
      description: 'Platform operational control plane, system metrics, and governance tabs',
      studentFeatureKey: 'analytics',
      aliases: ['/admin-control.html#analytics', '/admin-control.html#analytics-dashboard']
    },

    // --- ACADEMIC CONTENT ---
    {
      id: 'ADM-05',
      label: 'Study Materials',
      canonicalRoute: '/admin-materials.html',
      hashAnchor: '',
      section: 'ACADEMIC',
      icon: 'fa-solid fa-folder-open',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_content',
      requiredFeatureFlag: 'materials',
      description: 'Manage downloadable study resources and PDFs',
      studentFeatureKey: 'materials'
    },
    {
      id: 'ADM-06',
      label: 'Notes Library',
      canonicalRoute: '/admin-notes.html',
      hashAnchor: '',
      section: 'ACADEMIC',
      icon: 'fa-solid fa-file-lines',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_content',
      requiredFeatureFlag: 'notes',
      description: 'Manage official and peer-submitted notes',
      studentFeatureKey: 'notes'
    },
    {
      id: 'ADM-07',
      label: 'Previous Papers',
      canonicalRoute: '/admin-papers.html',
      hashAnchor: '',
      section: 'ACADEMIC',
      icon: 'fa-solid fa-file-pdf',
      order: 3,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_content',
      requiredFeatureFlag: 'previous_papers',
      description: 'Manage semester exam question papers',
      studentFeatureKey: 'previous_papers'
    },
    {
      id: 'ADM-11',
      label: 'Academic Structure',
      canonicalRoute: '/admin-academics.html',
      hashAnchor: '',
      section: 'ACADEMIC',
      icon: 'fa-solid fa-graduation-cap',
      order: 4,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_academics',
      description: 'Manage Colleges, Courses, Years, Semesters, and Subjects',
      studentFeatureKey: 'academic_structure',
      aliases: ['/admin-control.html#academic-structure']
    },
    {
      id: 'ADM-08',
      label: 'Quizzes',
      canonicalRoute: '/admin-quizzes.html',
      hashAnchor: '',
      section: 'ACADEMIC',
      icon: 'fa-solid fa-clipboard-question',
      order: 5,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_content',
      requiredFeatureFlag: 'quizzes',
      description: 'Manage interactive quiz questions and attempts',
      studentFeatureKey: 'quizzes'
    },
    {
      id: 'ADM-09',
      label: 'Mock Test Studio',
      canonicalRoute: '/admin-mock-tests.html',
      hashAnchor: '',
      section: 'ACADEMIC',
      icon: 'fa-solid fa-flask-vial',
      order: 6,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_content',
      requiredFeatureFlag: 'mock_tests',
      description: 'Build and schedule exam-style mock tests',
      studentFeatureKey: 'mock_tests',
      aliases: ['/admin-control.html#mock-tests']
    },
    {
      id: 'ADM-10',
      label: 'Study Roadmaps',
      canonicalRoute: '/admin-roadmaps.html',
      hashAnchor: '',
      section: 'ACADEMIC',
      icon: 'fa-solid fa-map-location-dot',
      order: 7,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_content',
      requiredFeatureFlag: 'roadmaps',
      description: 'Manage step-by-step career and study roadmaps',
      studentFeatureKey: 'roadmaps',
      aliases: ['/admin-control.html#roadmaps']
    },
    {
      id: 'ADM-18',
      label: 'Bulk Content',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#content-governance',
      section: 'ACADEMIC',
      icon: 'fa-solid fa-boxes-packing',
      order: 8,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_content',
      description: 'Bulk upload and batch assign study resources',
      studentFeatureKey: 'bulk_content'
    },

    // --- STUDENT MANAGEMENT ---
    {
      id: 'ADM-03',
      label: 'Student Directory',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#students-management',
      section: 'STUDENTS',
      icon: 'fa-solid fa-users',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_students',
      description: 'View, search, lock/unlock, and edit student profiles',
      studentFeatureKey: 'students'
    },
    {
      id: 'ADM-12',
      label: 'Student Contributions',
      canonicalRoute: '/admin-academics.html',
      hashAnchor: '#contributions',
      section: 'STUDENTS',
      icon: 'fa-solid fa-upload',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_contributions',
      requiredFeatureFlag: 'student_contributions',
      description: 'Moderate student-uploaded notes and resources',
      studentFeatureKey: 'contributions'
    },

    // --- MEMBERSHIP & COMMERCE ---
    {
      id: 'ADM-04A',
      label: 'Membership Plans',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#membership-management',
      section: 'COMMERCE',
      icon: 'fa-solid fa-layer-group',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_payments',
      requiredFeatureFlag: 'membership',
      description: 'Configure subscription tiers, features, and pricing',
      studentFeatureKey: 'membership_plans',
      aliases: ['/admin-control.html#membership-plans', '/admin-control.html#memberships', '/admin-memberships.html']
    },
    {
      id: 'ADM-04B',
      label: 'Active Memberships',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#active-memberships',
      section: 'COMMERCE',
      icon: 'fa-solid fa-id-card',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_payments',
      requiredFeatureFlag: 'membership',
      description: 'Monitor student subscription statuses and expirations',
      studentFeatureKey: 'active_memberships',
      aliases: ['/admin-control.html#active-memberships']
    },
    {
      id: 'ADM-04C',
      label: 'Payment Verification',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#payments-verification',
      section: 'COMMERCE',
      icon: 'fa-solid fa-receipt',
      order: 3,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_payments',
      requiredFeatureFlag: 'membership',
      description: 'Review and approve/reject manual UTR payment requests',
      studentFeatureKey: 'payment_verification',
      aliases: ['/admin-control.html#payment-verification', '/admin-control.html#membership-verification']
    },
    {
      id: 'ADM-04E',
      label: 'Payment Transactions',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#payments-transactions',
      section: 'COMMERCE',
      icon: 'fa-solid fa-money-bill-transfer',
      order: 4,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_payments',
      requiredFeatureFlag: 'membership',
      description: 'View full audit log of paid, pending, and failed payment transactions',
      studentFeatureKey: 'payment_transactions',
      aliases: ['/admin-control.html#payments-transactions', '/admin-control.html#transactions']
    },
    {
      id: 'ADM-04D',
      label: 'Payment Settings',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#payments-settings',
      section: 'COMMERCE',
      icon: 'fa-solid fa-credit-card',
      order: 5,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_payment_settings',
      requiredFeatureFlag: 'membership',
      description: 'Configure UPI IDs, Razorpay, Cashfree, and gateway credentials',
      studentFeatureKey: 'payment_settings',
      aliases: ['/admin-control.html#payment-settings', '/admin-control.html#gateway-settings']
    },

    // --- CODING & CERTIFICATION ---
    {
      id: 'ADM-14',
      label: 'Coding Governance',
      canonicalRoute: '/admin-coding-challenges.html',
      hashAnchor: '',
      section: 'CODING',
      icon: 'fa-solid fa-code',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_coding',
      requiredFeatureFlag: 'coding_arena',
      description: 'Manage coding contests, problems, test cases, and IDE settings',
      studentFeatureKey: 'coding_arena',
      aliases: ['/admin-control.html#coding-challenges', '/admin-control.html#coding-governance']
    },
    {
      id: 'ADM-13',
      label: 'Certificates',
      canonicalRoute: '/admin-certificates.html',
      hashAnchor: '',
      section: 'CODING',
      icon: 'fa-solid fa-certificate',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_certificates',
      requiredFeatureFlag: 'certificates',
      description: 'Issue, view, and revoke student course certificates',
      studentFeatureKey: 'certificates'
    },

    // --- EXPERIENCE ---
    {
      id: 'ADM-19',
      label: 'Onboarding Config',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#onboarding',
      section: 'EXPERIENCE',
      icon: 'fa-solid fa-compass-drafting',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_system',
      description: 'Customize student onboarding flow and welcome steps',
      studentFeatureKey: 'onboarding',
      aliases: ['/admin-control.html#onboarding-config']
    },
    {
      id: 'ADM-22',
      label: 'Live Sessions',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#live-sessions',
      section: 'EXPERIENCE',
      icon: 'fa-solid fa-video',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_live',
      requiredFeatureFlag: 'live_sessions',
      description: 'Schedule and manage live video classes (Agora)',
      studentFeatureKey: 'live_hub'
    },
    {
      id: 'ADM-24',
      label: 'Referrals',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#referrals',
      section: 'EXPERIENCE',
      icon: 'fa-solid fa-gift',
      order: 3,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_referrals',
      requiredFeatureFlag: 'referrals',
      description: 'Configure student referral points and reward thresholds',
      studentFeatureKey: 'referrals',
      aliases: ['/admin-control.html#referrals-config']
    },
    {
      id: 'ADM-25',
      label: 'Student Experience',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#experience',
      section: 'EXPERIENCE',
      icon: 'fa-solid fa-wand-magic-sparkles',
      order: 4,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_system',
      description: 'Customize student dashboard hero banner, layout, and sections',
      studentFeatureKey: 'student_dashboard',
      aliases: ['/admin-control.html#student-experience']
    },

    // --- COMMUNITY ---
    {
      id: 'ADM-16',
      label: 'Campus Feed',
      canonicalRoute: '/admin-campus-feed.html',
      hashAnchor: '',
      section: 'COMMUNITY',
      icon: 'fa-solid fa-newspaper',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_feed',
      requiredFeatureFlag: 'campus_feed',
      description: 'Publish and moderate campus announcements and feed posts',
      studentFeatureKey: 'campus_feed'
    },
    {
      id: 'ADM-23',
      label: 'Forum & Feedback',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#moderation',
      section: 'COMMUNITY',
      icon: 'fa-solid fa-comments',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_moderation',
      requiredFeatureFlag: 'forum',
      description: 'Moderate student forum discussions and platform feedback',
      studentFeatureKey: 'forum',
      aliases: ['/admin-control.html#forum-feedback']
    },

    // --- SUPPORT ---
    {
      id: 'ADM-15',
      label: 'Support Governance',
      canonicalRoute: '/admin-support-governance.html',
      hashAnchor: '',
      section: 'SUPPORT',
      icon: 'fa-solid fa-headset',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_support',
      requiredFeatureFlag: 'support_hub',
      description: 'Manage support tickets, tag categories, and helper rewards',
      studentFeatureKey: 'support_hub'
    },
    {
      id: 'ADM-26',
      label: 'Company & Support',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#company',
      section: 'SUPPORT',
      icon: 'fa-solid fa-building',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_company',
      description: 'Edit About Us, Privacy Policy, Terms, and Support Contact Info',
      studentFeatureKey: 'company_support',
      aliases: ['/admin-control.html#company-support']
    },

    // --- PLATFORM & GOVERNANCE ---
    {
      id: 'ADM-17',
      label: 'AI Tools Studio',
      canonicalRoute: '/admin-ai-tools.html',
      hashAnchor: '',
      section: 'PLATFORM',
      icon: 'fa-solid fa-sparkles',
      order: 1,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_ai',
      requiredFeatureFlag: 'ai_tools',
      description: 'Configure AWS Bedrock / OpenAI API keys, prompts, and rate limits',
      studentFeatureKey: 'ai_tools'
    },
    {
      id: 'ADM-27',
      label: 'Settings & Feature Toggles',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#system-settings',
      section: 'PLATFORM',
      icon: 'fa-solid fa-gear',
      order: 2,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_settings',
      description: 'Enable or disable platform modules and system feature flags',
      studentFeatureKey: 'system_settings'
    },
    {
      id: 'ADM-21',
      label: 'Roles & Permissions',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#roles-permissions',
      section: 'PLATFORM',
      icon: 'fa-solid fa-user-shield',
      order: 3,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'manage_roles',
      description: 'Configure RBAC roles, grants, and admin access levels',
      studentFeatureKey: 'roles'
    },
    {
      id: 'ADM-20',
      label: 'Audit Logs',
      canonicalRoute: '/admin-control.html',
      hashAnchor: '#audit-logs',
      section: 'PLATFORM',
      icon: 'fa-solid fa-list-check',
      order: 4,
      showInSidebar: true,
      showInQuickSwitch: true,
      requiredPermission: 'view_audit_logs',
      description: 'Inspect admin actions, security logs, and audit trails',
      studentFeatureKey: 'audit_logs'
    }
  ];

  // Validate registry completeness and uniqueness in dev environment
  function validateRegistry() {
    const ids = new Set();
    const sectionIds = new Set(SECTIONS.map(s => s.id));
    const errors = [];
    const warnings = [];

    MODULES.forEach(mod => {
      if (!mod.id || !mod.label || !mod.canonicalRoute || !mod.section) {
        const msg = `Invalid module entry missing required fields: ${mod.id || 'UNKNOWN'}`;
        warnings.push(msg);
        console.warn('[AdminModuleRegistry]', msg, mod);
      }
      if (ids.has(mod.id)) {
        const msg = `Duplicate module ID found: ${mod.id}`;
        errors.push(msg);
        console.error('[AdminModuleRegistry]', msg);
      }
      ids.add(mod.id);

      if (!sectionIds.has(mod.section)) {
        const msg = `Module ${mod.id} referencing unknown section ID: ${mod.section}`;
        errors.push(msg);
        console.error('[AdminModuleRegistry]', msg);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      totalModules: MODULES.length
    };
  }

  try {
    validateRegistry();
  } catch (e) {
    console.warn('[AdminModuleRegistry] Validation warning:', e && e.message);
  }

  function normalizePath(pathStr) {
    if (!pathStr) return '';
    let clean = String(pathStr).trim().toLowerCase();
    const hashIndex = clean.indexOf('#');
    if (hashIndex !== -1) {
      clean = clean.substring(0, hashIndex);
    }
    const queryIndex = clean.indexOf('?');
    if (queryIndex !== -1) {
      clean = clean.substring(0, queryIndex);
    }
    const lastSlash = clean.lastIndexOf('/');
    if (lastSlash !== -1) {
      clean = clean.substring(lastSlash + 1);
    }
    return clean;
  }

  function getActiveModule(currentLocation = window.location) {
    const rawPathname = String(currentLocation.pathname || '').trim().toLowerCase();
    const pathname = normalizePath(rawPathname);
    const hash = String(currentLocation.hash || '').trim().toLowerCase();

    // 1. Exact match on canonicalRoute + hashAnchor
    for (const mod of MODULES) {
      const modPath = normalizePath(mod.canonicalRoute);
      const modHash = String(mod.hashAnchor || '').trim().toLowerCase();
      if (modHash && pathname === modPath && hash === modHash) {
        return mod;
      }
    }

    // 2. Exact match on canonicalRoute (without hash)
    for (const mod of MODULES) {
      const modPath = normalizePath(mod.canonicalRoute);
      if (!mod.hashAnchor && pathname === modPath && !hash) {
        return mod;
      }
    }

    // 3. Match aliases
    for (const mod of MODULES) {
      if (Array.isArray(mod.aliases)) {
        for (const alias of mod.aliases) {
          const aliasLower = alias.toLowerCase();
          const aliasHashIdx = aliasLower.indexOf('#');
          const aliasPath = aliasHashIdx !== -1 ? normalizePath(aliasLower.substring(0, aliasHashIdx)) : normalizePath(aliasLower);
          const aliasHash = aliasHashIdx !== -1 ? aliasLower.substring(aliasHashIdx) : '';

          if (aliasHash && aliasPath) {
            if (pathname === aliasPath && hash === aliasHash) return mod;
          } else if (aliasHash && !aliasPath) {
            if (hash === aliasHash) return mod;
          } else if (aliasPath) {
            if (pathname === aliasPath || rawPathname === aliasLower || rawPathname.endsWith(aliasLower)) return mod;
          }
        }
      }
    }

    // 4. Substring path matching for clean /admin/ clean routes
    if (rawPathname.includes('/admin/')) {
      const cleanSub = rawPathname.split('/admin/')[1]?.split('/')[0]?.split('?')[0]?.split('#')[0];
      if (cleanSub) {
        for (const mod of MODULES) {
          if (mod.id.toLowerCase() === cleanSub || mod.label.toLowerCase().includes(cleanSub)) return mod;
          if (mod.aliases && mod.aliases.some(a => a.toLowerCase().includes(cleanSub))) return mod;
        }
      }
    }

    // Default to null if no match (to allow 404 handling)
    return null;
  }

  function getSectionById(sectionId) {
    return SECTIONS.find(s => s.id === sectionId) || null;
  }

  function getModulesBySection(sectionId) {
    return MODULES.filter(mod => mod.section === sectionId).sort((a, b) => a.order - b.order);
  }

  function renderSidebar(sidebarContainer, currentLocation = window.location) {
    if (!sidebarContainer) return;
    const activeMod = getActiveModule(currentLocation);

    const sortedSections = [...SECTIONS].sort((a, b) => a.order - b.order);
    let html = '';

    sortedSections.forEach(sec => {
      const secModules = getModulesBySection(sec.id).filter(m => m.showInSidebar);
      if (secModules.length === 0) return;

      html += `
        <section class="co-admin-nav-section">
          <p class="co-admin-nav-label">${sec.label}</p>
          <nav class="co-admin-nav">
      `;

      secModules.forEach(mod => {
        const isActive = activeMod && activeMod.id === mod.id;
        const targetUrl = mod.canonicalRoute + (mod.hashAnchor || '');
        html += `
          <a class="co-admin-nav-link ${isActive ? 'active' : ''}" href="${targetUrl}">
            <i class="${mod.icon}"></i>
            <span>${mod.label}</span>
          </a>
        `;
      });

      html += `
          </nav>
        </section>
      `;
    });

    sidebarContainer.innerHTML = html;
  }

  function renderQuickSwitch(selectNode, currentLocation = window.location) {
    if (!selectNode) return;
    const activeMod = getActiveModule(currentLocation);

    let html = '';
    const quickModules = MODULES.filter(m => m.showInQuickSwitch).sort((a, b) => {
      const secA = getSectionById(a.section)?.order || 99;
      const secB = getSectionById(b.section)?.order || 99;
      if (secA !== secB) return secA - secB;
      return a.order - b.order;
    });

    quickModules.forEach(mod => {
      const targetUrl = mod.canonicalRoute + (mod.hashAnchor || '');
      const isSelected = activeMod && activeMod.id === mod.id;
      const sectionObj = getSectionById(mod.section);
      const sectionPrefix = sectionObj ? `${sectionObj.label} › ` : '';
      html += `<option value="${targetUrl}" ${isSelected ? 'selected' : ''}>${sectionPrefix}${mod.label}</option>`;
    });

    selectNode.innerHTML = html;

    if (selectNode.dataset.boundQuickSwitch !== '1') {
      selectNode.dataset.boundQuickSwitch = '1';
      selectNode.addEventListener('change', (e) => {
        const target = e.target.value;
        if (!target) return;
        const hashIdx = target.indexOf('#');
        if (hashIdx !== -1 && window.location.pathname.endsWith('admin-control.html')) {
          window.location.hash = target.substring(hashIdx);
        } else {
          window.location.href = target;
        }
      });
    }
  }

  function renderBreadcrumb(breadcrumbNode, currentLocation = window.location) {
    if (!breadcrumbNode) return;
    const activeMod = getActiveModule(currentLocation);
    if (!activeMod) return;

    const sec = getSectionById(activeMod.section);
    const secLabel = sec ? sec.label : 'Admin';
    breadcrumbNode.textContent = `${secLabel} › ${activeMod.label}`;

    const badgeTextNode = document.getElementById('activeRouteBreadcrumbText');
    if (badgeTextNode) {
      badgeTextNode.textContent = activeMod.label;
    }
  }

  function initNavigation() {
    const sidebarNode = document.querySelector('.co-admin-sidebar-nav-container')
      || document.querySelector('.co-admin-sidebar nav')?.parentElement
      || document.querySelector('.co-admin-sidebar')
      || document.getElementById('adminSidebar');

    const quickSelectNode = document.getElementById('quickModuleSelect')
      || document.querySelector('.co-admin-quick-switch select');

    const breadcrumbNode = document.getElementById('adminBreadcrumb')
      || document.querySelector('.co-admin-breadcrumb');

    renderSidebar(sidebarNode);
    renderQuickSwitch(quickSelectNode);
    renderBreadcrumb(breadcrumbNode);

    // Sync state on hashchange for SPA panel switching (e.g. admin-control.html)
    window.addEventListener('hashchange', () => {
      renderSidebar(sidebarNode);
      renderQuickSwitch(quickSelectNode);
      renderBreadcrumb(breadcrumbNode);
    });
  }

  const AdminModuleRegistry = {
    SECTIONS,
    MODULES,
    getActiveModule,
    getSectionById,
    getModulesBySection,
    renderSidebar,
    renderQuickSwitch,
    renderBreadcrumb,
    initNavigation,
    validateRegistry
  };

  global.AdminModuleRegistry = AdminModuleRegistry;

})(typeof window !== 'undefined' ? window : this);
