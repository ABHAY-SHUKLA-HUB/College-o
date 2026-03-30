const express = require('express');
const { pool } = require('../db/pool');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin dashboard endpoints must require an authenticated admin session.
router.use(requireAdmin);

let dashboardSectionsInitialized = false;

async function resolveDashboardConfigActorId(preferredUserId) {
  const normalizedPreferred = Number(preferredUserId || 0);
  if (Number.isInteger(normalizedPreferred) && normalizedPreferred > 0) {
    const { rows: preferredRows } = await pool.query(
      'SELECT id FROM users WHERE id = $1 LIMIT 1',
      [normalizedPreferred]
    );
    if (preferredRows.length) return preferredRows[0].id;
  }

  const { rows: adminRows } = await pool.query(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
  );
  if (adminRows.length) return adminRows[0].id;

  const { rows: anyRows } = await pool.query(
    'SELECT id FROM users ORDER BY id ASC LIMIT 1'
  );
  return anyRows[0]?.id || null;
}

const DEFAULT_SECTIONS = [
  {
    section_key: 'hero',
    section_name: 'Hero Welcome Section',
    icon: 'image',
    description: 'Premium banner with welcome message and roadmap progress',
    category: 'main',
    default_position: 0
  },
  {
    section_key: 'stats',
    section_name: 'Statistics Cards',
    icon: 'chart-bar',
    description: 'XP, streak, roadmap progress, and certificates',
    category: 'main',
    default_position: 1
  },
  {
    section_key: 'continue-learning',
    section_name: 'Continue Learning',
    icon: 'play-circle',
    description: 'Resume last note, quiz, and roadmap step',
    category: 'main',
    default_position: 2
  },
  {
    section_key: 'recommended',
    section_name: 'Recommended For You',
    icon: 'wand-magic-sparkles',
    description: 'Personalized content recommendations',
    category: 'main',
    default_position: 3
  },
  {
    section_key: 'tasks',
    section_name: "Today's Learning Tasks",
    icon: 'list-check',
    description: 'Daily learning checklist and milestones',
    category: 'main',
    default_position: 4
  },
  {
    section_key: 'recent-activity',
    section_name: 'Recent Activity',
    icon: 'clock-rotate-left',
    description: 'Recent notes, quizzes, and progress',
    category: 'main',
    default_position: 5
  },
  {
    section_key: 'membership',
    section_name: 'Membership Status',
    icon: 'crown',
    description: 'Premium plan info and upgrade options',
    category: 'sidebar',
    default_position: 0
  },
  {
    section_key: 'ai-suggestions',
    section_name: 'AI Suggestions',
    icon: 'robot',
    description: 'Smart learning recommendations from AI',
    category: 'sidebar',
    default_position: 1
  },
  {
    section_key: 'quick-access',
    section_name: 'Quick Access',
    icon: 'bolt',
    description: 'Fast links to notes, tests, roadmap, AI tools',
    category: 'sidebar',
    default_position: 2
  },
  {
    section_key: 'achievements',
    section_name: 'Achievements',
    icon: 'award',
    description: 'Badges, milestones, and accomplishments',
    category: 'sidebar',
    default_position: 3
  }
];

async function ensureDashboardSections(preferredUserId) {
  if (dashboardSectionsInitialized) return;

  try {
    const actorUserId = await resolveDashboardConfigActorId(preferredUserId);
    if (!actorUserId) {
      console.warn('Skipping dashboard defaults initialization: no user available for created_by');
      return;
    }

    for (const section of DEFAULT_SECTIONS) {
      await pool.query(
        `INSERT INTO dashboard_sections (section_key, section_name, icon, description, category, is_enabled, default_position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (section_key) DO NOTHING`,
        [
          section.section_key,
          section.section_name,
          section.icon,
          section.description,
          section.category,
          true,
          section.default_position
        ]
      );
    }

    // Initialize default stats cards
    const DEFAULT_STATS = [
      { stat_key: 'xp', stat_label: 'XP Points', icon: 'star', position: 0 },
      { stat_key: 'streak', stat_label: 'Learning Streak', icon: 'fire', position: 1 },
      { stat_key: 'roadmapProgress', stat_label: 'Roadmap Progress', icon: 'route', position: 2 },
      { stat_key: 'certificates', stat_label: 'Certificates Earned', icon: 'graduation-cap', position: 3 }
    ];

    for (const stat of DEFAULT_STATS) {
      await pool.query(
        `INSERT INTO dashboard_stats_config (stat_key, stat_label, icon, is_enabled, is_visible_free, is_visible_premium, position_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (stat_key) DO NOTHING`,
        [stat.stat_key, stat.stat_label, stat.icon, true, true, true, stat.position, actorUserId]
      );
    }

    // Initialize default quick access cards
    const DEFAULT_QUICK_ACCESS = [
      { card_key: 'notes', card_label: 'Notes', icon: 'file-lines', url: '/notes-library.html', position: 0 },
      { card_key: 'mock-tests', card_label: 'Mock Tests', icon: 'flask', url: '/mock-tests.html', position: 1 },
      { card_key: 'roadmap', card_label: 'Roadmap', icon: 'map-location-dot', url: '/study-roadmap.html', position: 2 },
      { card_key: 'ai-tools', card_label: 'AI Tools', icon: 'sparkles', url: '/ai-tools.html', position: 3 },
      { card_key: 'certificates', card_label: 'Certificates', icon: 'graduation-cap', url: '/certificates.html', position: 4 }
    ];

    for (const card of DEFAULT_QUICK_ACCESS) {
      await pool.query(
        `INSERT INTO dashboard_quick_access (card_key, card_label, icon, url, is_enabled, is_visible_free, is_visible_premium, position_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (card_key) DO NOTHING`,
        [card.card_key, card.card_label, card.icon, card.url, true, true, true, card.position, actorUserId]
      );
    }

    dashboardSectionsInitialized = true;
    console.log('Dashboard sections initialized successfully');
  } catch (error) {
    console.error('Error initializing dashboard sections:', error);
  }
}

// Auto-initialize on first request
router.use(async (req, res, next) => {
  await ensureDashboardSections(req.session?.userId);
  next();
});

// ========== SECTIONS MANAGEMENT ==========

// Get dashboard sections with visibility filtering
router.get('/sections', async (req, res) => {
  try {
    const { branch, tier } = req.query;

    const query = `
      SELECT 
        ds.id,
        ds.section_key,
        ds.section_name,
        ds.icon,
        ds.description,
        ds.is_enabled,
        ds.category,
        COALESCE(dsv.is_visible, ds.is_enabled) as is_visible,
        COALESCE(dsv.position_order, ds.default_position) as position_order,
        COALESCE(dsv.title_override, ds.section_name) as display_name
      FROM dashboard_sections ds
      LEFT JOIN dashboard_section_visibility dsv 
        ON ds.id = dsv.section_id
        AND (dsv.branch_id = $1::text OR dsv.branch_id IS NULL)
        AND (dsv.membership_tier = $2::text OR dsv.membership_tier IS NULL)
      ORDER BY COALESCE(dsv.position_order, ds.default_position)
    `;

    const result = await pool.query(query, [branch || null, tier || null]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dashboard sections:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a new dashboard section
router.post('/sections', requireAdmin, async (req, res) => {
  try {
    const { section_key, section_name, icon, description, category } = req.body;

    const result = await pool.query(
      `INSERT INTO dashboard_sections (section_key, section_name, icon, description, category, is_enabled)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING *`,
      [section_key, section_name, icon, description, category]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating dashboard section:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update section visibility for specific branch/membership
router.post('/sections/:id/visibility', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { branch_id, membership_tier, is_visible, position_order, title_override } = req.body;

    const result = await pool.query(
      `INSERT INTO dashboard_section_visibility 
        (section_id, branch_id, membership_tier, is_visible, position_order, title_override, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (section_id, COALESCE(branch_id, ''), COALESCE(membership_tier, ''))
       DO UPDATE SET 
         is_visible = $4,
         position_order = $5,
         title_override = $6,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [id, branch_id, membership_tier, is_visible, position_order, title_override, req.session.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating section visibility:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== ANNOUNCEMENTS MANAGEMENT ==========

// Get active announcements
router.get('/announcements', async (req, res) => {
  try {
    const { branch, tier } = req.query;

    const result = await pool.query(
      `SELECT * FROM dashboard_announcements
       WHERE is_active = TRUE
         AND (start_date IS NULL OR start_date <= CURRENT_TIMESTAMP)
         AND (end_date IS NULL OR end_date >= CURRENT_TIMESTAMP)
       ORDER BY position, created_at DESC`
    );

    // Filter by branch and tier client-side for flexibility
    let announcements = result.rows;
    if (branch) {
      announcements = announcements.filter(a =>
        !a.target_branches || a.target_branches.includes(branch)
      );
    }
    if (tier) {
      announcements = announcements.filter(a =>
        !a.target_tiers || a.target_tiers.includes(tier)
      );
    }

    res.json(announcements);
  } catch (error) {
    console.error('Error fetching announcements:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create announcement (admin only)
router.post('/announcements', requireAdmin, async (req, res) => {
  try {
    const { title, message, banner_type, target_branches, target_tiers, start_date, end_date, icon, action_url, action_label } = req.body;

    const result = await pool.query(
      `INSERT INTO dashboard_announcements
        (title, message, banner_type, target_branches, target_tiers, start_date, end_date, icon, action_url, action_label, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [title, message, banner_type, JSON.stringify(target_branches), JSON.stringify(target_tiers), start_date, end_date, icon, action_url, action_label, req.session.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating announcement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update announcement
router.put('/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, message, banner_type, target_branches, target_tiers, is_active, start_date, end_date, position, icon, action_url, action_label } = req.body;

    const result = await pool.query(
      `UPDATE dashboard_announcements
       SET title = $1, message = $2, banner_type = $3, target_branches = $4, target_tiers = $5,
           is_active = $6, start_date = $7, end_date = $8, position = $9, icon = $10,
           action_url = $11, action_label = $12, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13
       RETURNING *`,
      [title, message, banner_type, JSON.stringify(target_branches), JSON.stringify(target_tiers), is_active, start_date, end_date, position, icon, action_url, action_label, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating announcement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete announcement
router.delete('/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM dashboard_announcements WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting announcement:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== HERO CONFIGURATION ==========

// Get hero configuration
router.get('/hero-config', async (req, res) => {
  try {
    const { branch } = req.query;

    const result = await pool.query(
      `SELECT * FROM dashboard_hero_config
       WHERE is_active = TRUE AND (branch_id = $1 OR branch_id IS NULL)
       ORDER BY branch_id DESC NULLS LAST LIMIT 1`,
      [branch]
    );

    res.json(result.rows[0] || {});
  } catch (error) {
    console.error('Error fetching hero config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Save hero configuration (admin only)
router.post('/hero-config', requireAdmin, async (req, res) => {
  try {
    const { title, subtitle, featured_message, featured_image_url, cta_primary_label, cta_primary_url, cta_secondary_label, cta_secondary_url, background_gradient, branch_id } = req.body;

    const result = await pool.query(
      `INSERT INTO dashboard_hero_config
        (title, subtitle, featured_message, featured_image_url, cta_primary_label, cta_primary_url, cta_secondary_label, cta_secondary_url, background_gradient, is_active, branch_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, $11)
       ON CONFLICT (branch_id, is_active) DO UPDATE SET
         title = $1, subtitle = $2, featured_message = $3, featured_image_url = $4,
         cta_primary_label = $5, cta_primary_url = $6, cta_secondary_label = $7, cta_secondary_url = $8,
         background_gradient = $9, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [title, subtitle, featured_message, featured_image_url, cta_primary_label, cta_primary_url, cta_secondary_label, cta_secondary_url, background_gradient, branch_id || null, req.session.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error saving hero config:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== STATS CONFIGURATION ==========

// Get stats configuration
router.get('/stats-config', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM dashboard_stats_config WHERE is_enabled = TRUE ORDER BY position_order`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching stats config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update individual stat card configuration
router.put('/stats-config/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_visible_free, is_visible_premium, position_order } = req.body;

    const result = await pool.query(
      `UPDATE dashboard_stats_config
       SET is_visible_free = COALESCE($1, is_visible_free),
           is_visible_premium = COALESCE($2, is_visible_premium),
           position_order = COALESCE($3, position_order),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [is_visible_free, is_visible_premium, position_order, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating stats config:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== QUICK ACCESS CONFIGURATION ==========

// Get quick access cards
router.get('/quick-access', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM dashboard_quick_access WHERE is_enabled = TRUE ORDER BY position_order`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching quick access:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update quick access card
router.put('/quick-access/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_visible_free, is_visible_premium, position_order } = req.body;

    const result = await pool.query(
      `UPDATE dashboard_quick_access
       SET is_visible_free = COALESCE($1, is_visible_free),
           is_visible_premium = COALESCE($2, is_visible_premium),
           position_order = COALESCE($3, position_order),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [is_visible_free, is_visible_premium, position_order, id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating quick access:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== RECOMMENDATIONS MANAGEMENT ==========

// Get recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const { branch, tier } = req.query;

    let query = `
      SELECT * FROM dashboard_recommendations
      WHERE (branch_id = $1::text OR branch_id IS NULL)
        AND (membership_tier = $2::text OR membership_tier IS NULL)
      ORDER BY is_featured DESC, position_order
    `;

    const result = await pool.query(query, [branch || null, tier || null]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create recommendation
router.post('/recommendations', requireAdmin, async (req, res) => {
  try {
    const { content_type, content_id, title, branch_id, membership_tier, is_featured, position_order } = req.body;

    const result = await pool.query(
      `INSERT INTO dashboard_recommendations
        (content_type, content_id, title, branch_id, membership_tier, is_featured, position_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [content_type, content_id, title, branch_id, membership_tier, is_featured, position_order, req.session.userId]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating recommendation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete recommendation
router.delete('/recommendations/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM dashboard_recommendations WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting recommendation:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========== DASHBOARD PREVIEW ==========

// Get complete dashboard configuration for student view
router.get('/config', async (req, res) => {
  try {
    const userId = req.session?.userId;
    let branch = req.query.branch;
    let tier = req.query.tier || 'free';

    // If user is logged in, get their actual branch and tier
    if (userId) {
      const userResult = await pool.query(
        `SELECT u.subscription_tier, up.course_branch
         FROM users u
         LEFT JOIN user_profiles up ON u.id = up.user_id
         WHERE u.id = $1`,
        [userId]
      );

      if (userResult.rows[0]) {
        branch = userResult.rows[0].course_branch;
        tier = userResult.rows[0].subscription_tier || 'free';
      }
    }

    // Fetch all configuration data in parallel
    const [sections, announcements, hero, stats, quickAccess, recommendations] = await Promise.all([
      pool.query(
        `SELECT ds.*, COALESCE(dsv.is_visible, ds.is_enabled) as is_visible,
                COALESCE(dsv.position_order, ds.default_position) as position_order
         FROM dashboard_sections ds
         LEFT JOIN dashboard_section_visibility dsv
           ON ds.id = dsv.section_id
           AND (dsv.branch_id = $1::text OR dsv.branch_id IS NULL)
           AND (dsv.membership_tier = $2::text OR dsv.membership_tier IS NULL)
         WHERE ds.is_enabled = TRUE
         ORDER BY COALESCE(dsv.position_order, ds.default_position)`,
        [branch, tier]
      ),
      pool.query(
        `SELECT * FROM dashboard_announcements
         WHERE is_active = TRUE
           AND (start_date IS NULL OR start_date <= CURRENT_TIMESTAMP)
           AND (end_date IS NULL OR end_date >= CURRENT_TIMESTAMP)
         ORDER BY position`
      ),
      pool.query(
        `SELECT * FROM dashboard_hero_config
         WHERE is_active = TRUE AND (branch_id = $1::text OR branch_id IS NULL)
         ORDER BY branch_id DESC NULLS LAST LIMIT 1`,
        [branch]
      ),
      pool.query(
        `SELECT * FROM dashboard_stats_config
         WHERE is_enabled = TRUE AND
         (($1 = 'premium' AND is_visible_premium = TRUE) OR ($1 = 'free' AND is_visible_free = TRUE))
         ORDER BY position_order`,
        [tier]
      ),
      pool.query(
        `SELECT * FROM dashboard_quick_access
         WHERE is_enabled = TRUE AND
         (($1 = 'premium' AND is_visible_premium = TRUE) OR ($1 = 'free' AND is_visible_free = TRUE))
         ORDER BY position_order`,
        [tier]
      ),
      pool.query(
        `SELECT * FROM dashboard_recommendations
         WHERE (branch_id = $1::text OR branch_id IS NULL)
           AND (membership_tier = $2::text OR membership_tier IS NULL)
         ORDER BY is_featured DESC, position_order`,
        [branch, tier]
      )
    ]);

    res.json({
      sections: sections.rows,
      announcements: announcements.rows,
      hero: hero.rows[0],
      stats: stats.rows,
      quickAccess: quickAccess.rows,
      recommendations: recommendations.rows
    });
  } catch (error) {
    console.error('Error fetching dashboard config:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
