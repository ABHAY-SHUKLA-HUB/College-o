/**
 * Dashboard Configuration Bootstrap
 * Loads and applies admin-configured dashboard sections based on user profile
 */

async function initDashboardConfig() {
  try {
    // Fetch user profile for branch and membership info
    const userProfile = await Promise.all([
      window.CollegeOSApi.getProfile(),
      window.CollegeOSApi.getStudentAcademicProfile(),
      window.CollegeOSApi.getSubscription()
    ]);

    const user = userProfile[0] || {};
    const academic = userProfile[1] || {};
    const subscription = userProfile[2] || {};

    const role = String(user.role || user.user?.role || '').toLowerCase();
    const isAdmin = role === 'admin' || role === 'super_admin';
    if (!isAdmin) {
      // Learner dashboard should not hit admin-only config endpoints.
      return null;
    }

    const branch = academic.branch || academic.category || 'general';
    const tier = subscription.status === 'active' ? 'premium' : 'free';

    // Fetch dashboard configuration from admin API
    const config = await window.CollegeOSApiClient.request(
      `/api/admin/dashboard/config?branch=${encodeURIComponent(branch)}&tier=${encodeURIComponent(tier)}`
    );
    
    // Apply announcements
    if (config.announcements && config.announcements.length > 0) {
      applyAnnouncements(config.announcements);
    }

    // Apply hero configuration
    if (config.hero) {
      applyHeroConfig(config.hero);
    }

    // Apply stats card configuration
    if (config.stats) {
      applyStatsConfig(config.stats);
    }

    // Apply quick access configuration
    if (config.quickAccess) {
      applyQuickAccessConfig(config.quickAccess);
    }

    // Filter and reorder sections based on visibility
    const visibleSections = (config.sections || []).filter(s => s.is_visible);
    
    // Reorder main content columns based on section ordering
    reorderDashboardSections(visibleSections);

    return config;
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status !== 401 && status !== 403) {
      console.error('Error initializing dashboard config:', error);
    }
    return null;
  }
}

function applyAnnouncements(announcements) {
  const container = document.querySelector('.dash-announcements-container') || createAnnouncementsContainer();
  
  const html = announcements.map(a => `
    <div class="dash-announcement-banner" style="background: ${getBannerColor(a.banner_type)}; margin-bottom: 1rem;">
      <div style="padding: 1rem; border-radius: 8px; display: flex; gap: 1rem; align-items: center;">
        <i class="fas fa-${getBannerIcon(a.banner_type)}" style="font-size: 1.2rem; flex-shrink: 0;"></i>
        <div style="flex: 1;">
          <h3 style="margin: 0 0 0.3rem; font-size: 1rem; color: inherit;">${a.title}</h3>
          <p style="margin: 0; font-size: 0.9rem; opacity: 0.95;">${a.message}</p>
        </div>
        ${a.action_url ? `<a href="${a.action_url}" class="btn primary" style="white-space: nowrap; margin: 0;">${a.action_label || 'Learn More'}</a>` : ''}
      </div>
    </div>
  `).join('');
  
  container.innerHTML = html;
}

function createAnnouncementsContainer() {
  const container = document.createElement('div');
  container.className = 'dash-announcements-container';
  const mainContent = document.querySelector('main.dash-page');
  if (mainContent) {
    mainContent.insertBefore(container, mainContent.firstChild);
  }
  return container;
}

function applyHeroConfig(hero) {
  const heroSection = document.querySelector('.dash-hero');
  if (!heroSection) return;

  // Update title
  if (hero.title) {
    const titleEl = heroSection.querySelector('h1');
    if (titleEl) titleEl.textContent = hero.title;
  }

  // Update subtitle
  if (hero.subtitle) {
    const subtitleEl = heroSection.querySelector('p');
    if (subtitleEl) subtitleEl.textContent = hero.subtitle;
  }

  // Update CTA buttons
  const buttons = heroSection.querySelectorAll('.dash-hero-actions .btn');
  if (buttons[0] && hero.cta_primary_label && hero.cta_primary_url) {
    buttons[0].textContent = hero.cta_primary_label;
    buttons[0].href = hero.cta_primary_url;
  }
  if (buttons[1] && hero.cta_secondary_label && hero.cta_secondary_url) {
    buttons[1].textContent = hero.cta_secondary_label;
    buttons[1].href = hero.cta_secondary_url;
  }

  // Apply custom gradient if provided
  if (hero.background_gradient) {
    heroSection.style.background = hero.background_gradient;
  }
}

function applyStatsConfig(statsConfig) {
  const statsCards = document.querySelectorAll('.dash-stat-card');
  const visibleStats = new Set(statsConfig.map(s => s.stat_key));

  statsCards.forEach(card => {
    const label = card.querySelector('.dash-stat-label');
    const statKey = label?.textContent?.trim().toLowerCase().replace(' ', '');
    
    // Check if this stat should be visible
    const shouldShow = Array.from(visibleStats).some(key => 
      statKey?.includes(key.toLowerCase())
    );

    if (!shouldShow) {
      card.style.display = 'none';
    }
  });
}

function applyQuickAccessConfig(quickAccessCards) {
  const container = document.querySelector('.dash-quick-grid');
  if (!container) return;

  // Reorder quick access cards based on config
  const cardMap = new Map();
  container.querySelectorAll('.dash-feature-card').forEach(card => {
    const href = card.getAttribute('href');
    cardMap.set(href, card);
  });

  // Create new ordered list
  const orderedCards = quickAccessCards
    .filter(config => config.is_enabled)
    .map(config => mapConfigToCard(config))
    .filter(card => cardMap.has(card.href))
    .map(card => cardMap.get(card.href));

  // Reorder
  container.innerHTML = '';
  orderedCards.forEach(card => container.appendChild(card));
}

function mapConfigToCard(config) {
  const mapping = {
    'notes': { href: 'notes-library.html' },
    'mock-tests': { href: 'mock-tests.html' },
    'roadmap': { href: 'study-roadmap.html' },
    'ai-tools': { href: 'ai-tools.html' },
    'certificates': { href: 'certificates.html' },
    'quizzes': { href: 'quiz-library.html' }
  };
  return mapping[config.card_key] || { href: '#' };
}

function reorderDashboardSections(sections) {
  const layout = document.querySelector('.dash-layout');
  if (!layout) return;

  // Get all section elements
  const leftCol = layout.querySelector('.dash-col:first-child');
  const rightCol = layout.querySelector('.dash-col:last-child');
  
  if (!leftCol || !rightCol) return;

  // Map section keys to elements
  const sectionMap = {
    'continue-learning': leftCol.querySelector('[id*="continueLearning"]')?.closest('.dash-card'),
    'recommended': leftCol.querySelector('[id*="recommended"]')?.closest('.dash-card'),
    'tasks': leftCol.querySelector('[id*="taskList"]')?.closest('.dash-card'),
    'recent-activity': leftCol.querySelector('[id*="recentActivity"]')?.closest('.dash-card'),
    'membership': rightCol.querySelector('.dash-membership'),
    'ai-suggestions': rightCol.querySelector('.dash-ai-card'),
    'quick-access': rightCol.querySelector('[id*="quick"]')?.closest('.dash-card'),
    'achievements': rightCol.querySelector('[id*="achievement"]')?.closest('.dash-card')
  };

  // Reorder based on position_order
  // This is a simplified implementation
  // In production, this would properly reorder the DOM
}

function getBannerColor(type) {
  const colors = {
    'info': 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
    'success': 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
    'warning': 'linear-gradient(135deg, #fef3c7, #fde68a)',
    'error': 'linear-gradient(135deg, #fee2e2, #fecaca)'
  };
  return colors[type] || colors['info'];
}

function getBannerIcon(type) {
  const icons = {
    'info': 'circle-info',
    'success': 'circle-check',
    'warning': 'triangle-exclamation',
    'error': 'circle-xmark'
  };
  return icons[type] || icons['info'];
}

// Initialize when dashboard page loads
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('main.dash-page')) {
    initDashboardConfig().catch(err => console.warn('Dashboard config init failed:', err));
  }
});
