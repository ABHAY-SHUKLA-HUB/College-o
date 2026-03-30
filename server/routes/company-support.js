const express = require('express');
const { pool } = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ─── Default CMS Content ───────────────────────────────────────────────────

const DEFAULT_ABOUT_CONFIG = {
  hero: {
    tagline: 'Building the Future of College Education',
    headline: 'About College OS',
    description:
      'College OS is a student-first learning platform built to help engineering and degree students ace exams, build skills, and launch careers — all in one place.',
    ctaLabel: 'Get Started Free',
    ctaHref: 'signup.html',
    highlightStats: [
      { value: '10,000+', label: 'Students Enrolled' },
      { value: '500+', label: 'Study Resources' },
      { value: '98%', label: 'Student Satisfaction' },
      { value: '24/7', label: 'AI-Powered Support' }
    ]
  },
  mission: {
    visible: true,
    title: 'Our Mission',
    description:
      'We exist to democratise quality education for every college student — regardless of college name, city, or budget. Every student deserves a smart, personalised learning experience.',
    icon: 'fa-rocket'
  },
  vision: {
    visible: true,
    title: 'Our Vision',
    description:
      'A future where every student in India walks into an exam room fully prepared, fully confident, and focused on their potential — not their limitations.',
    icon: 'fa-eye'
  },
  values: {
    visible: true,
    title: 'What We Stand For',
    items: [
      { icon: 'fa-graduation-cap', title: 'Student First', description: 'Every feature, every decision starts with the student\'s learning outcome.' },
      { icon: 'fa-shield-halved', title: 'Trust & Transparency', description: 'Clear pricing, zero dark patterns, and honest progress tracking.' },
      { icon: 'fa-sparkles', title: 'AI-Powered Learning', description: 'Smart tools that adapt to your study pace, strengths, and weak areas.' },
      { icon: 'fa-people-group', title: 'Community Driven', description: 'Forums, peer learning, and collaborative study paths — no student learns alone.' },
      { icon: 'fa-chart-line', title: 'Measurable Growth', description: 'XP, streaks, analytics, and roadmaps that show real progress every week.' },
      { icon: 'fa-infinity', title: 'Always Improving', description: 'We ship new features weekly based on direct student feedback.' }
    ]
  },
  story: {
    visible: true,
    title: 'The College OS Story',
    paragraphs: [
      'College OS started with a simple observation: most college students study hard but still fail to perform in exams because they lack structure, quality resources, and personalised guidance.',
      'We built College OS to change that — combining academic resources, AI tools, roadmaps, and gamification into a single platform that fits into every student\'s life.',
      'Today, students across dozens of colleges use College OS to prepare for exams, earn certificates, explore career paths, and connect with a community that pushes them forward.'
    ]
  },
  cta: {
    visible: true,
    title: 'Join Thousands of Students Already Learning Smarter',
    description: 'Start free today. Upgrade to Premium when you\'re ready for the full experience.',
    primaryLabel: 'Start Learning Free',
    primaryHref: 'signup.html',
    secondaryLabel: 'Explore Features',
    secondaryHref: 'home.html'
  }
};

const DEFAULT_CONTACT_CONFIG = {
  hero: {
    title: 'Get in Touch',
    description: 'Have a question, feedback, or need support? We\'re here to help. Pick the right channel and we\'ll get back to you fast.'
  },
  channels: [
    { icon: 'fa-envelope', label: 'Email Support', value: 'support@collegeos.in', href: 'mailto:support@collegeos.in', description: 'Best for billing, account, or detailed queries. We reply within 24 hours.' },
    { icon: 'fa-brands fa-whatsapp', label: 'WhatsApp', value: '+91 90000 00000', href: 'https://wa.me/919000000000', description: 'Quick questions and real-time help. Available 9 AM – 9 PM IST.' },
    { icon: 'fa-phone', label: 'Phone', value: '+91 90000 00000', href: 'tel:+919000000000', description: 'Call us during business hours for urgent issues.' }
  ],
  hours: {
    visible: true,
    title: 'Support Hours',
    lines: [
      'Monday – Friday: 9:00 AM – 9:00 PM IST',
      'Saturday: 10:00 AM – 6:00 PM IST',
      'Sunday: Emergency support only'
    ],
    sla: 'Most tickets resolved within 4–24 hours.'
  },
  social: {
    visible: true,
    title: 'Find Us Online',
    links: [
      { icon: 'fa-brands fa-instagram', label: 'Instagram', href: '#', handle: '@collegeos' },
      { icon: 'fa-brands fa-linkedin', label: 'LinkedIn', href: '#', handle: 'College OS' },
      { icon: 'fa-brands fa-youtube', label: 'YouTube', href: '#', handle: 'College OS' },
      { icon: 'fa-brands fa-x-twitter', label: 'Twitter / X', href: '#', handle: '@collegeos' }
    ]
  },
  form: {
    visible: true,
    title: 'Send Us a Message',
    description: 'Fill out the form and we\'ll get back to you within 24 hours.',
    categories: ['General Query', 'Technical Bug', 'Billing & Payment', 'Account Issue', 'Feature Request', 'Study Help', 'Other'],
    successMessage: 'Your message has been sent! We\'ll get back to you within 24 hours.'
  },
  faq_preview: {
    visible: true,
    title: 'Quick Answers',
    items: [
      { q: 'How do I upgrade to Premium?', a: 'Go to Membership page, choose Premium, pay via UPI, and submit your transaction ID for admin approval.' },
      { q: 'My payment was approved but I\'m still on Free.', a: 'Please wait 15 minutes and refresh. If the issue persists, contact us with your transaction ID.' },
      { q: 'Can I get a refund?', a: 'We don\'t offer refunds, but you can contact us if there are exceptional circumstances.' }
    ]
  }
};

const DEFAULT_HELP_CONFIG = {
  hero: {
    title: 'Help Center',
    description: 'Find answers to common questions, explore guides, or submit a support ticket if you need more help.'
  },
  categories: [
    {
      id: 'getting-started',
      title: 'Getting Started',
      icon: 'fa-play-circle',
      color: '#2f6fed',
      articles: [
        { title: 'How to create your account', body: 'Visit the Sign Up page, enter your name, college email, and college name, then click Create Account. You\'re ready to start learning.' },
        { title: 'Setting up your academic profile', body: 'After signing up, go to Profile > Academic Profile to set your branch, semester, and learning goals. This powers your personalised recommendations.' },
        { title: 'Understanding your Dashboard', body: 'Your Dashboard shows your XP, streak, daily tasks, AI recommendations, and progress charts. Check it every morning to plan your study session.' }
      ]
    },
    {
      id: 'membership',
      title: 'Membership & Billing',
      icon: 'fa-crown',
      color: '#b26a00',
      articles: [
        { title: 'What is Premium?', body: 'Premium unlocks unlimited notes, all AI tools, unlimited mock tests, certificate downloads, and advanced roadmap access — for just ₹49/month.' },
        { title: 'How to upgrade to Premium', body: 'Go to Membership in the sidebar. Scan the UPI QR or copy the UPI ID, pay the amount, then submit your transaction ID and payment screenshot.' },
        { title: 'How long does activation take?', body: 'Premium is activated within minutes after an admin reviews your payment. You\'ll receive a notification once it\'s active.' },
        { title: 'What happens when my Premium expires?', body: 'Your access reverts to Free plan limits. All your notes, history, and certificates remain saved. You can renew anytime.' }
      ]
    },
    {
      id: 'study-tools',
      title: 'Study Tools',
      icon: 'fa-book-open',
      color: '#1f7f55',
      articles: [
        { title: 'How to use Mock Tests', body: 'Go to Mock Tests, select a test, and click Start. Answer all questions within the time limit. Results and detailed analysis show immediately after.' },
        { title: 'Understanding XP and Streaks', body: 'You earn XP for quizzes, mock tests, daily challenges, and other actions. Streaks reward you for consistent daily activity. Both unlock badges and leaderboard rank.' },
        { title: 'How AI Tools work', body: 'AI Tools use your academic profile and performance history to generate personalised study plans, concept explanations, flashcards, and exam predictions.' }
      ]
    },
    {
      id: 'certificates',
      title: 'Certificates',
      icon: 'fa-graduation-cap',
      color: '#03614a',
      articles: [
        { title: 'How to earn a certificate', body: 'Complete the required milestones shown on your Roadmap or score above the threshold in a Mock Test. Your certificate generates automatically.' },
        { title: 'Verifying a certificate', body: 'Each certificate has a unique ID and QR code. Anyone can visit the verification page and enter the ID to confirm it\'s authentic.' }
      ]
    },
    {
      id: 'account',
      title: 'Account & Profile',
      icon: 'fa-user-circle',
      color: '#006e8f',
      articles: [
        { title: 'How to reset your password', body: 'On the Login page, click Forgot Password and follow the email instructions to reset your password securely.' },
        { title: 'Updating your profile photo', body: 'Go to Profile and click on your avatar image to upload a new profile picture (JPEG, PNG, max 5MB).' },
        { title: 'How to delete your account', body: 'Go to Settings > Privacy and click Request Account Deletion. This is permanent. Contact support before proceeding.' }
      ]
    }
  ],
  contact_cta: {
    visible: true,
    title: 'Still need help?',
    description: 'Can\'t find what you\'re looking for? Our support team is ready to help.',
    label: 'Contact Support',
    href: 'contact-us.html'
  }
};

// ─── Helper ────────────────────────────────────────────────────────────────

async function getSetting(key, defaultValue) {
  const { rows } = await pool.query('SELECT value_json FROM platform_settings WHERE key = $1', [key]);
  if (rows.length === 0) return defaultValue;
  return rows[0].value_json;
}

async function saveSetting(key, value, userId) {
  await pool.query(
    `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [key, JSON.stringify(value), userId]
  );
}

let supportTicketSchemaCache = null;

async function getSupportTicketSchema() {
  if (supportTicketSchemaCache) return supportTicketSchemaCache;

  const { rows } = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'support_tickets'`
  );

  const columns = new Set(rows.map((row) => row.column_name));
  supportTicketSchemaCache = {
    modern: columns.has('subject') && columns.has('message') && columns.has('category'),
    hasAdminReply: columns.has('admin_reply'),
    hasRepliedAt: columns.has('replied_at')
  };

  return supportTicketSchemaCache;
}

// ─── Public: Company Content ───────────────────────────────────────────────

router.get('/about-config', async (_req, res) => {
  try {
    const config = await getSetting('about-us-config', DEFAULT_ABOUT_CONFIG);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load about config' });
  }
});

router.get('/contact-config', async (_req, res) => {
  try {
    const config = await getSetting('contact-us-config', DEFAULT_CONTACT_CONFIG);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load contact config' });
  }
});

router.get('/help-config', async (_req, res) => {
  try {
    const config = await getSetting('help-center-config', DEFAULT_HELP_CONFIG);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load help config' });
  }
});

// ─── Auth: Support Tickets ─────────────────────────────────────────────────

router.post('/tickets', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  const { subject, category, message, priority } = req.body;

  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are required.' });
  }
  const cleanSubject = String(subject).slice(0, 220);
  const cleanCategory = String(category || 'General Query').slice(0, 80);
  const cleanMessage = String(message).slice(0, 4000);
  const cleanPriority = ['low', 'medium', 'high'].includes(String(priority).toLowerCase())
    ? String(priority).toLowerCase()
    : 'medium';

  try {
    const schema = await getSupportTicketSchema();
    let rows;

    if (schema.modern) {
      ({ rows } = await pool.query(
        `INSERT INTO support_tickets
           (user_id, subject, category, message, priority, status)
         VALUES ($1, $2, $3, $4, $5, 'open')
         RETURNING id, subject, category, priority, status, message, admin_reply, replied_at, created_at`,
        [userId, cleanSubject, cleanCategory, cleanMessage, cleanPriority]
      ));
    } else {
      ({ rows } = await pool.query(
        `INSERT INTO support_tickets
           (user_id, issue_type, priority, description, status)
         VALUES ($1, $2, $3, $4, 'open')
         RETURNING
           id,
           issue_type AS subject,
           issue_type AS category,
           priority,
           status,
           description AS message,
           NULL::TEXT AS admin_reply,
           NULL::TIMESTAMP AS replied_at,
           created_at`,
        [userId, cleanCategory || cleanSubject, cleanPriority, cleanMessage]
      ));
    }

    res.json({ ticket: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit ticket.' });
  }
});

router.get('/tickets/mine', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    const schema = await getSupportTicketSchema();
    let rows;

    if (schema.modern) {
      ({ rows } = await pool.query(
        `SELECT id, subject, category, priority, status, message, admin_reply, replied_at, created_at
         FROM support_tickets
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT
           id,
           issue_type AS subject,
           issue_type AS category,
           priority,
           status,
           description AS message,
           NULL::TEXT AS admin_reply,
           NULL::TIMESTAMP AS replied_at,
           created_at
         FROM support_tickets
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      ));
    }

    res.json({ tickets: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tickets.' });
  }
});

// ─── Admin: Company Config CMS ─────────────────────────────────────────────

router.put('/admin/about-config', requireAdmin, async (req, res) => {
  const { config } = req.body;
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'config object required' });
  }
  try {
    await saveSetting('about-us-config', config, req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save about config.' });
  }
});

router.put('/admin/contact-config', requireAdmin, async (req, res) => {
  const { config } = req.body;
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'config object required' });
  }
  try {
    await saveSetting('contact-us-config', config, req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save contact config.' });
  }
});

router.put('/admin/help-config', requireAdmin, async (req, res) => {
  const { config } = req.body;
  if (!config || typeof config !== 'object') {
    return res.status(400).json({ error: 'config object required' });
  }
  try {
    await saveSetting('help-center-config', config, req.session.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save help config.' });
  }
});

// ─── Admin: Support Ticket Management ─────────────────────────────────────

router.get('/admin/tickets', requireAdmin, async (req, res) => {
  const { status, category, priority, search, page } = req.query;
  const limit = 30;
  const offset = (Math.max(1, parseInt(page) || 1) - 1) * limit;
  const conditions = [];
  const params = [];

  if (status && status !== 'all') {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }
  if (category && category !== 'all') {
    params.push(category);
    conditions.push(`t.category = $${params.length}`);
  }
  if (priority && priority !== 'all') {
    params.push(priority);
    conditions.push(`t.priority = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const schema = await getSupportTicketSchema();
    const subjectExpr = schema.modern ? 't.subject' : 't.issue_type';
    const categoryExpr = schema.modern ? 't.category' : 't.issue_type';
    const messageExpr = schema.modern ? 't.message' : 't.description';
    const adminReplyExpr = schema.hasAdminReply ? 't.admin_reply' : 'NULL::TEXT';
    const repliedAtExpr = schema.hasRepliedAt ? 't.replied_at' : 'NULL::TIMESTAMP';

    if (search) {
      const searchParamIndex = params.length - 1;
      conditions[conditions.length - 1] = `(${subjectExpr} ILIKE $${searchParamIndex} OR u.full_name ILIKE $${searchParamIndex} OR u.email ILIKE $${searchParamIndex})`;
    }

    const appliedWhere = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT t.id,
              ${subjectExpr} AS subject,
              ${categoryExpr} AS category,
              t.priority,
              t.status,
              ${messageExpr} AS message,
              ${adminReplyExpr} AS admin_reply,
              ${repliedAtExpr} AS replied_at,
              t.created_at,
              u.full_name AS student_name, u.email AS student_email
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       ${appliedWhere}
       ORDER BY
         CASE WHEN t.status = 'open' THEN 0
              WHEN t.status = 'in_progress' THEN 1
              ELSE 2 END,
         CASE WHEN t.priority = 'high' THEN 0
              WHEN t.priority = 'medium' THEN 1
              ELSE 2 END,
         t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const countParams = params.slice(0, -2);
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS total FROM support_tickets t JOIN users u ON u.id = t.user_id ${appliedWhere}`,
      countParams
    );

    res.json({ tickets: rows, total: parseInt(countRows[0].total) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tickets.' });
  }
});

router.put('/admin/tickets/:id', requireAdmin, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const { status, admin_reply } = req.body;

  const allowed = ['open', 'in_progress', 'resolved', 'closed'];
  const cleanStatus = allowed.includes(status) ? status : null;
  const cleanReply = admin_reply ? String(admin_reply).slice(0, 4000) : null;

  const schema = await getSupportTicketSchema();
  const supportsReply = schema.hasAdminReply;
  const supportsRepliedAt = schema.hasRepliedAt;

  if (cleanReply !== null && !supportsReply) {
    return res.status(400).json({ error: 'Ticket replies are not supported by this database schema.' });
  }

  if (!cleanStatus && cleanReply === null) {
    return res.status(400).json({ error: 'status or admin_reply required' });
  }

  const sets = [];
  const params = [];

  if (cleanStatus) {
    params.push(cleanStatus);
    sets.push(`status = $${params.length}`);
  }
  if (cleanReply !== null) {
    params.push(cleanReply);
    sets.push(`admin_reply = $${params.length}`);
    if (supportsRepliedAt) {
      sets.push(`replied_at = NOW()`);
    }
  }

  params.push(ticketId);
  try {
    const { rowCount } = await pool.query(
      `UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ticket.' });
  }
});

module.exports = router;
