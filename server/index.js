if (String(process.env.NODE_ENV || '').toLowerCase() !== 'production') {
  require('dotenv').config();
}

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const pgSessionFactory = require('connect-pg-simple');
const { pool } = require('./db/pool');
const { ensureDatabaseBootstrap } = require('./db/bootstrap');
const { initializeAcademicStructure } = require('./db/academic-migration');

const authRoutes = require('./routes/auth');
const metaRoutes = require('./routes/meta');
const dashboardRoutes = require('./routes/dashboard');
const intelligenceRoutes = require('./routes/intelligence');
const quizRoutes = require('./routes/quizzes');
const mockRoutes = require('./routes/mockTests');
const roadmapRoutes = require('./routes/roadmaps');
const careerRoutes = require('./routes/career');
const aiRoutes = require('./routes/ai');
const notesRoutes = require('./routes/notes');
const certificateRoutes = require('./routes/certificates');
const leaderboardRoutes = require('./routes/leaderboard');
const referralRoutes = require('./routes/referrals');
const profileRoutes = require('./routes/profile');
const settingsRoutes = require('./routes/settings');
const notificationRoutes = require('./routes/notifications');
const forumRoutes = require('./routes/forum');
const contentRoutes = require('./routes/content');
const feedbackRoutes = require('./routes/feedback');
const subscriptionRoutes = require('./routes/subscriptions');
const liveSessionRoutes = require('./routes/live-sessions');
const adminRoutes = require('./routes/admin');
const adminControlRoutes = require('./routes/admin-control');
const adminDashboardRoutes = require('./routes/admin-dashboard');
const adminIntelligenceRoutes = require('./routes/admin-intelligence');
const adminAiOpsRoutes = require('./routes/admin-ai-ops');
const healthRoutes = require('./routes/health');
const academicsRoutes = require('./routes/academics');
const academicsAdminRoutes = require('./routes/academics-admin');
const companySupportRoutes = require('./routes/company-support');
const campusFeedRoutes = require('./routes/campus-feed');
const adminCampusFeedRoutes = require('./routes/admin-campus-feed');
const contributionRoutes = require('./routes/contributions');
const contributionAdminRoutes = require('./routes/contributions-admin');
const supportHubRoutes = require('./routes/support-hub');
const supportAnswersRoutes = require('./routes/support-answers');
const supportModerationRoutes = require('./routes/support-moderation');
const adminSupportGovernanceRoutes = require('./routes/admin-support-governance');
const academicsContentMgmtRoutes = require('./routes/academics-content-management');
const studentLibraryUnifiedRoutes = require('./routes/student-library-unified');
const { initMailerTransporter } = require('./utils/mailer');
const { createSignedSupabaseUrl, validateSupabaseStorageConfiguration } = require('./services/supabaseStorage');
// Socket / realtime integration
const { initSocket } = require('./services/socketManager');

// Security middleware imports
const helmet = require('helmet');
const { csrfInit, csrfProtect } = require('./middleware/csrf');
const { 
  preventJsonBomb, 
  sanitizeRequestBody,
  limitRequestSize 
} = require('./middleware/validation');
const { rateLimit } = require('./middleware/rateLimiter');
const {
  requestIdMiddleware,
  requestLogger,
  securityEventLogger,
  errorLogger,
  performanceMonitor,
  notFoundHandler,
  globalErrorHandler
} = require('./middleware/logging');
const jwt = require('jsonwebtoken');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { requireRole, requireStudent, requireSupport, requireSuperAdmin, auditAction } = require('./middleware/rbac');
const { validateLoginRequest, validateSignupRequest, rejectUnexpectedFields } = require('./middleware/inputValidation');
const { rateLimitLogin, rateLimitOTP, rateLimitPasswordReset } = require('./middleware/rateLimitAdvanced');
const { logSecurityEvent, logLoginAttempt, logUnauthorizedAccess } = require('./middleware/auditLog');
const PgSession = pgSessionFactory(session);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

const app = express();

// Render sits behind a proxy; trust the first hop so req.ip and secure cookies are correct.
app.set('trust proxy', 1);

function parseOrigins(input) {
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const PROD_BACKEND_ORIGIN = 'https://college-o.onrender.com';
const jitsiDomain = String(process.env.JITSI_DOMAIN || 'meet.jit.si').trim() || 'meet.jit.si';
const localDevOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://localhost:3000',
  'https://127.0.0.1:3000'
];
const productionFrontendOrigins = [
  'https://college-o.vercel.app',
  'https://college-o-33sg7jg49-abhayshukla2072006-2030s-projects.vercel.app',
  'https://collegeo.in',
  'https://www.collegeo.in'
];

// Support multiple env names used across deployments
const configuredOrigins = [
  ...parseOrigins(process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS),
  ...parseOrigins(process.env.FRONTEND_URL || process.env.FRONTEND_PUBLIC_URL),
  ...parseOrigins(process.env.APP_BASE_URL)
];
const allowedOrigins = new Set([
  ...configuredOrigins,
  ...(isProduction ? productionFrontendOrigins : [])
]);
const CORS_ALLOW_ALL = String(process.env.CORS_ALLOW_ALL || '').toLowerCase() === 'true';
const PUBLIC_READ_PATHS = new Set([
  '/api/auth/config',
  '/api/auth/me',
  '/api/auth/captcha/challenge',
  '/api/academics/categories',
  '/api/academics/semesters',
  '/api/academics/onboarding/config',
  '/api/academics/branches'
]);

const ONBOARDING_PUBLIC_API_PATHS = [
  '/api/auth/config',
  '/api/auth/me',
  '/api/auth/login',
  '/api/auth/login/email-otp',
  '/api/auth/logout',
  '/api/auth/signup',
  '/api/auth/google',
  '/api/auth/password/forgot',
  '/api/auth/password/reset',
  '/api/auth/captcha/challenge',
  '/api/auth/verification/request',
  '/api/auth/verification/verify',
  '/api/admin/login',
  '/api/health',
  '/api/academics/categories',
  '/api/academics/colleges',
  '/api/academics/courses',
  '/api/academics/years',
  '/api/academics/branches',
  '/api/academics/semesters',
  '/api/academics/subjects',
  '/api/academics/onboarding/config',
  '/api/academics/onboarding/complete',
  '/api/academics/profile'
];

const CLEAN_PAGE_ROUTES = new Map([
  ['/login', 'login.html'],
  ['/signup', 'signup.html'],
  ['/academic-onboarding', 'academic-onboarding.html'],
  ['/dashboard', 'dashboard.html'],
  ['/study', 'study.html'],
  ['/mock-test', 'mock-tests.html'],
  ['/mock-tests', 'mock-tests.html'],
  ['/notes', 'notes-library.html'],
  ['/roadmap', 'study-roadmap.html'],
  ['/ai-tools', 'ai-tools.html'],
  ['/live-hub', 'live-hub.html'],
  ['/notifications', 'notifications.html'],
  ['/profile', 'profile.html'],
  ['/settings', 'settings.html'],
  ['/support-dashboard', 'support-dashboard.html'],
  ['/support-hub', 'support-hub.html'],
  ['/certificates', 'certificates.html'],
  ['/leaderboard', 'leaderboards.html'],
  ['/campus-feed', 'college-feed.html'],
  ['/contribute', 'academic-contribution-hub.html']
  ,['/reset-password', 'reset-password.html']
  ,['/admin-login', 'admin-login.html']
  ,['/admin-dashboard', 'admin-dashboard.html']
  ,['/admin-dashboard-mgmt', 'admin-dashboard-mgmt.html']
  ,['/admin-control', 'admin-control.html']
  ,['/admin-academics', 'admin-academics.html']
  ,['/admin-materials', 'admin-materials.html']
  ,['/admin-notes', 'admin-notes.html']
  ,['/admin-certificates', 'admin-certificates.html']
  ,['/admin-mock-tests', 'admin-mock-tests.html']
  ,['/admin-quizzes', 'admin-quizzes.html']
  ,['/admin-papers', 'admin-papers.html']
  ,['/admin-roadmaps', 'admin-roadmaps.html']
  ,['/admin-campus-feed', 'admin-campus-feed.html']
  ,['/admin-ai-tools', 'admin-ai-tools.html']
  ,['/admin-support-governance', 'admin-support-governance.html']
]);

function getRateLimitKey(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  return `ip:${req.ip || 'unknown'}`;
}

function isPublicReadRoute(req) {
  return req.method === 'GET' && PUBLIC_READ_PATHS.has(req.path);
}

function isOnboardingPublicApiPath(pathname) {
  return ONBOARDING_PUBLIC_API_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

async function isStudentOnboardingComplete(userId) {
  if (!userId) return false;
  const { rows } = await pool.query(
    `SELECT onboarding_completed, category_id, branch_id, semester_id, college_id, course_id, year_id
     FROM user_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  const profile = rows[0] || {};
  return Boolean(
    profile.onboarding_completed &&
    profile.category_id &&
    profile.branch_id &&
    profile.semester_id &&
    profile.college_id &&
    profile.course_id &&
    profile.year_id
  );
}
const hasLocalhostOrigin = configuredOrigins.some((origin) => /localhost|127\.0\.0\.1/i.test(origin));

function normalizeSameSite(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'none' || value === 'lax' || value === 'strict') return value;
  return isProduction ? 'lax' : 'lax';
}

const sessionOptions = {
  name: 'college_os_sid',
  secret: process.env.SESSION_SECRET || 'unsafe-dev-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: isProduction ? 'none' : normalizeSameSite(process.env.SESSION_COOKIE_SAMESITE),
    secure: isProduction ? true : process.env.SESSION_COOKIE_SECURE === 'true',
    domain: String(process.env.SESSION_COOKIE_DOMAIN || '').trim() || undefined,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
};

// Production environment validation - fail fast
if (isProduction) {
  const secret = String(process.env.SESSION_SECRET || '');
  if (!secret || secret.length < 32 || secret === 'unsafe-dev-secret' || secret === 'replace-with-strong-secret') {
    throw new Error('SESSION_SECRET must be set to a strong value (32+ chars) in production.');
  }
  if (!allowedOrigins.size) {
    throw new Error('ALLOWED_ORIGINS (or FRONTEND_PUBLIC_URL/APP_BASE_URL) must be set in production.');
  }
  if (hasLocalhostOrigin) {
    throw new Error('Production origins must not include localhost/127.0.0.1 values.');
  }
  if (sessionOptions.cookie.sameSite === 'none' && !sessionOptions.cookie.secure) {
    throw new Error('SESSION cookie sameSite=none requires secure cookies in production.');
  }
  console.log('[Production Mode] All security validations passed ✅');
}

const assetStaticOptions = {
  etag: true,
  lastModified: true,
  // In development keep max-age low to avoid stale client caches; production remains long-lived.
  maxAge: isProduction ? '30d' : 0,
  immutable: isProduction,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
};

sessionOptions.store = new PgSession({
  pool,
  tableName: 'session',
  createTableIfMissing: false
});

/**
 * CRITICAL: Middleware order matters for security!
 * Order ensures:
 * 1. Trust proxy FIRST (for correct IP detection)
 * 2. Request ID tracking EARLY (for logging)
 * 3. Helmet EARLY (sets security headers)
 * 4. Body parsers BEFORE validators
 * 5. Validators BEFORE routes
 * 6. CSRF protection AFTER session
 * 7. Error handler LAST
 */

// 1. Request ID middleware - must be early for request tracing
app.use(requestIdMiddleware);

// 2. Helmet - sets critical HTTP security headers
//    CSP, HSTS, X-XSS-Protection, etc.
// Note: We intentionally allow trusted external script/frame origins required by the
// Live Hub (Jitsi and Agora). Keep this list minimal and explicit to avoid broad relaxations.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      // Allow the Jitsi external API and Agora SDK to be loaded as scripts.
      // Inline HTML pages in this app still depend on embedded scripts.
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        `https://${jitsiDomain}`,
        'https://meet.jit.si',
        'https://download.agora.io',
        'https://accounts.google.com',
        'https://www.gstatic.com',
        'https://challenges.cloudflare.com',
        ...(!isProduction ? localDevOrigins : [])
      ],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      // Allow framing Jitsi (embedded meeting) from meet.jit.si
      frameSrc: [
        "'self'",
        `https://${jitsiDomain}`,
        'https://meet.jit.si',
        'https://challenges.cloudflare.com',
        ...(!isProduction ? localDevOrigins : [])
      ],
      connectSrc: [
        "'self'",
        PROD_BACKEND_ORIGIN,
        `https://${jitsiDomain}`,
        'https://meet.jit.si',
        'https://download.agora.io',
        'https://accounts.google.com',
        'https://oauth2.googleapis.com',
        'https://challenges.cloudflare.com',
        ...(!isProduction ? localDevOrigins : [])
      ],
      frameAncestors: ["'self'"],
      manifestSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      ...(isProduction ? { upgradeInsecureRequests: [] } : {})
    }
  },
  hsts: isProduction ? {
    maxAge: 31536000,  // 1 year
    includeSubDomains: true,
    preload: true
  } : false,
  // Disable frameguard (X-Frame-Options) because it conflicts with modern CSP frame-src
  frameguard: false,
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permissionsPolicy: {
    features: {
      camera: ["'self'", 'https://meet.jit.si'],
      microphone: ["'self'", 'https://meet.jit.si'],
      geolocation: [],
      payment: [],
      usb: []
    }
  }
}));

app.disable('x-powered-by');

app.use(compression({
  threshold: 1024
}));

// 3. Body parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 4. Input validation middleware stack
app.use(limitRequestSize(2));                                      // Request size limit
app.use(preventJsonBomb(10));                                      // JSON nesting depth limit
app.use(sanitizeRequestBody(['description', 'content', 'body', 'title', 'message', 'text'])); // XSS prevention

// 5. CORS middleware
app.use((req, res, next) => {
  const origin = String(req.headers.origin || '').trim();
  const hasOrigin = Boolean(origin);
  const isAllowedOrigin = hasOrigin && allowedOrigins.has(origin);

  if (hasOrigin && !isAllowedOrigin && isProduction && !CORS_ALLOW_ALL) {
    console.warn('[CORS] Rejected origin', { origin, method: req.method, path: req.path });
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const willAllow = isAllowedOrigin || (hasOrigin && CORS_ALLOW_ALL);
  // In development, be more permissive for localhost origins so credentialed requests work during local testing.
  const willAllowDev = !isProduction && hasOrigin;
  if (willAllow || willAllowDev) {
    // Echo origin back to allow credentialed requests from arbitrary origins
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token');
    if (CORS_ALLOW_ALL && !isAllowedOrigin) {
      console.warn(`[CORS] WARNING: CORS_ALLOW_ALL=true - allowing origin ${origin}. Disable in production when possible.`);
    }
  }

  if (req.method === 'OPTIONS') {
    // Preflight request - respond early when we have allowed CORS
    if (willAllow) return res.status(204).end();
    console.warn('[CORS] Preflight rejected', { origin, method: req.method, path: req.path });
    return res.status(403).end();
  }

  return next();
});

// Explicit OPTIONS handler to ensure preflight checks succeed for all routes
app.options('*', (req, res) => {
  const origin = String(req.headers.origin || '').trim();
  const isAllowed = origin && (allowedOrigins.has(origin) || CORS_ALLOW_ALL);
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token');
    return res.status(204).end();
  }
  console.warn('[CORS] Global OPTIONS rejected', { origin, path: req.path });
  return res.status(403).end();
});

// 6. Static file serving - serve assets before session/csrf middleware.
app.use('/assets', express.static(path.join(__dirname, '..', 'assets'), assetStaticOptions));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), assetStaticOptions));

// Page route serving - serve specific HTML pages directly
app.get('/referrals', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'referrals.html'));
});
app.get('/feedback', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'feedback.html'));
});
app.get('/pricing', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'pricing.html'));
});
app.get('/contact-us', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'contact-us.html'));
});
app.get('/about-us', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'about-us.html'));
});
app.get('/help-center', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'help-center.html'));
});
app.get('/terms', (_req, res) => res.sendFile(path.join(__dirname, '..', 'terms.html')));
app.get('/privacy', (_req, res) => res.sendFile(path.join(__dirname, '..', 'privacy.html')));
app.get('/contact', (_req, res) => res.sendFile(path.join(__dirname, '..', 'contact-us.html')));
app.get('/my-tickets', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'my-tickets.html'));
});

app.get('/api/auth/captcha/challenge', (req, res) => {
  const startedAt = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');

  console.info('[auth:captcha] request received', {
    requestId,
    ip: req.ip || 'unknown',
    path: req.path,
    origin: req.headers.origin || '',
    userAgent: req.headers['user-agent'] || ''
  });

  try {
    const challengeBuilder = authRoutes.buildCaptchaChallenge;
    const challenge = typeof challengeBuilder === 'function'
      ? challengeBuilder(req)
      : null;

    if (!challenge) {
      throw new Error('Captcha challenge builder unavailable');
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({
      ok: true,
      captchaId: challenge.id,
      captcha: challenge,
      question: challenge.question,
      challenge: challenge.challengeText,
      challengeText: challenge.challengeText,
      prompt: challenge.prompt,
      captchaText: challenge.captchaText,
      expiresAt: challenge.expiresAt,
      expiresInSeconds: 300
    });

    console.info('[auth:captcha] captcha generated', {
      requestId,
      responseTimeMs: Date.now() - startedAt,
      captchaId: challenge.id
    });
  } catch (error) {
    console.warn('[auth:captcha] captcha failed', {
      requestId,
      responseTimeMs: Date.now() - startedAt,
      reason: error?.message || String(error)
    });
    res.status(500).json({ ok: false, error: 'Captcha generation failed' });
  }
});

// 7. Session middleware
app.use(session(sessionOptions));

app.get('/api/files/:id', async (req, res) => {
  const fileId = Number(req.params.id);
  if (!Number.isSafeInteger(fileId) || fileId <= 0) {
    return res.status(400).json({ error: 'Invalid file id' });
  }

  try {
    const result = await pool.query(
      `SELECT id, bucket, storage_path, visibility, user_id
       FROM uploaded_files
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [fileId]
    );
    const file = result.rows[0];
    if (!file) return res.status(404).json({ error: 'File not found' });

    const isOwner = Number(req.session?.userId || 0) === Number(file.user_id || 0);
    const role = String(req.session?.role || '').toLowerCase();
    const isAdmin = role === 'admin' || role === 'super_admin';
    if (file.visibility !== 'public' && !isOwner && !isAdmin) {
      return res.status(403).json({ error: 'File access denied' });
    }

    const signedUrl = await createSignedSupabaseUrl({
      bucket: file.bucket,
      path: file.storage_path,
      expiresIn: 15 * 60
    });
    return res.redirect(302, signedUrl);
  } catch (error) {
    console.error('[File Delivery] failed', { message: error?.message || String(error) });
    return res.status(502).json({ error: 'File delivery unavailable' });
  }
});

// 8. CSRF protection initialization - must be after session
app.use(csrfInit());

// 9. Rate limiting - general API limit
// Relax rate limiting in development mode
const generalRateLimiter = process.env.NODE_ENV === 'development'
  ? rateLimit({
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 10000, // Very high limit for dev
      keyGenerator: getRateLimitKey,
      skipSuccessfulRequests: false,
      skipFailedRequests: false
    })
  : rateLimit({
      windowMs: 15 * 60 * 1000,  // 15 minutes
      maxRequests: 300,
      keyGenerator: getRateLimitKey,
      skipSuccessfulRequests: false,
      skipFailedRequests: false
    });

app.use((req, res, next) => {
  if (isPublicReadRoute(req)) {
    return next();
  }
  return generalRateLimiter(req, res, next);
});

// 10. CSRF protection for state-changing endpoints
app.use(csrfProtect());

// 11. Request logging middleware - logs requests/responses
app.use(requestLogger);

// 12. Security event logging - logs auth, CSRF, admin actions
app.use(securityEventLogger);

// 13. Performance monitoring - alerts on slow endpoints
app.use(performanceMonitor);

app.use((req, res, next) => {
  return next();
});

// Admin page protection: serve admin HTML only when admin session exists.
// Register AFTER session and csrf initialization so requireAdmin can access req.session.
const adminPages = [
  '/admin-login.html', '/admin-login',
  '/admin-dashboard.html', '/admin-dashboard', '/admin-dashboard-mgmt',
  '/admin-control.html', '/admin-control',
  '/admin-academics.html',
  '/admin-materials.html', '/admin-notes.html', '/admin-certificates.html',
  '/admin-mock-tests.html', '/admin-quizzes.html', '/admin-papers.html',
  '/admin-roadmaps.html', '/admin-campus-feed.html', '/admin-ai-tools.html',
  '/admin-support-governance.html'
];

adminPages.forEach((p) => {
  app.get(p, (req, res, next) => {
    // Allow admin login page to be public
    if (p === '/admin-login.html' || p === '/admin-login') return res.sendFile(path.join(__dirname, '..', 'admin-login.html'));
    // All other admin pages need an admin session; redirect to admin login if not authenticated
    return requireAdmin(req, res, (err) => {
      if (err) return res.redirect('/admin-login');
      // Serve mapped file if present in CLEAN_PAGE_ROUTES
      const key = req.path.toLowerCase();
      const file = CLEAN_PAGE_ROUTES.get(key) || key.replace(/^\//, '');
      return res.sendFile(path.join(__dirname, '..', file));
    });
  });
});


app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/academics', academicsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/mock-tests', mockRoutes);
app.use('/api/roadmaps', roadmapRoutes);
app.use('/api/career', careerRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/live-sessions', liveSessionRoutes);
app.use('/api/admin/ai-ops', adminAiOpsRoutes);
app.use('/api/admin-ai-ops', adminAiOpsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/control', adminControlRoutes);
app.use('/api/admin/dashboard', adminDashboardRoutes);
app.use('/api/admin/intelligence', adminIntelligenceRoutes);
app.use('/api/admin', academicsAdminRoutes);
app.use('/api/company', companySupportRoutes);
app.use('/api/campus-feed', campusFeedRoutes);
app.use('/api/admin/campus-feed', adminCampusFeedRoutes);
app.use('/api/contributions', contributionRoutes);
app.use('/api/admin/contributions', contributionAdminRoutes);
app.use('/api/support', supportHubRoutes);
app.use('/api/support', supportAnswersRoutes);
app.use('/api/support', supportModerationRoutes);
app.use('/api/admin/support-governance', adminSupportGovernanceRoutes);
app.use('/api', academicsContentMgmtRoutes);
app.use('/api', studentLibraryUnifiedRoutes);

// Safe notifications stream endpoint (fallback for missing SSE or polling)
app.get('/api/notifications/stream', (req, res) => {
  try {
    // Set headers for SSE (Server-Sent Events) or polling
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const origin = String(req.headers.origin || '').trim();
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    // Send initial connection message
    res.write('data: {"type":"connected","message":"Notification stream connected"}\n\n');

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
      res.write(':\n\n');
    }, 30_000);

    // Clean up on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      res.end();
    });

    // Send a keep-alive message immediately for polling clients
    setTimeout(() => {
      res.write('data: {"type":"heartbeat","timestamp":"' + new Date().toISOString() + '"}\n\n');
    }, 1000);
  } catch (error) {
    console.warn('[Notifications Stream] error:', error.message);
    res.status(500).json({ ok: false, error: 'Stream unavailable' });
  }
});

// Map direct page routes to HTML files
const PAGE_ROUTES = new Map([
  ['/referrals', 'referrals.html'],
  ['/feedback', 'feedback.html'],
  ['/pricing', 'pricing.html'],
  ['/contact-us', 'contact-us.html'],
  ['/about-us', 'about-us.html'],
  ['/help-center', 'help-center.html'],
  ['/my-tickets', 'my-tickets.html']
]);

// Serve mapped page routes directly
// Protected pages set (clean paths & HTML files)
const PROTECTED_PAGE_PATHS = new Set([
  '/dashboard', '/dashboard.html',
  '/study', '/study.html', '/materials-library', '/materials-library.html', '/previous-papers', '/previous-papers.html',
  '/notes', '/notes.html', '/notes-library', '/notes-library.html', '/notes-library-enhanced', '/notes-library-enhanced.html', '/my-notes', '/my-notes.html', '/note-editor', '/note-editor.html',
  '/mock-test', '/mock-tests', '/mock-tests.html', '/mock-test-attempt', '/mock-test-attempt.html', '/mock-test-results', '/mock-test-results.html',
  '/quiz-library', '/quiz-library.html', '/quiz-attempt', '/quiz-attempt.html', '/quiz-results', '/quiz-results.html',
  '/roadmap', '/study-roadmap', '/study-roadmap.html',
  '/live-hub', '/live-hub.html',
  '/ai-tools', '/ai-tools.html',
  '/contribute', '/academic-contribution-hub', '/academic-contribution-hub.html',
  '/campus-feed', '/college-feed', '/college-feed.html',
  '/forum', '/forum.html',
  '/support-hub', '/support-hub.html', '/support-request-detail', '/support-request-detail.html', '/create-support-request', '/create-support-request.html', '/support', '/support.html',
  '/profile', '/profile.html', '/academic-profile-setup', '/academic-profile-setup.html',
  '/settings', '/settings.html',
  '/notifications', '/notifications.html',
  '/certificates', '/certificates.html',
  '/badges', '/badges.html',
  '/leaderboards', '/leaderboards.html',
  '/referrals', '/referrals.html',
  '/feedback', '/feedback.html',
  '/daily-challenges', '/daily-challenges.html',
  '/top-helpers', '/top-helpers.html',
  '/my-tickets', '/my-tickets.html',
  '/membership'
]);

// Routes that have been removed or consolidated; users should be redirected
const REMOVED_ROUTE_PATHS = new Set([
  '/home', '/homepage', '/contact-us', '/contactus', '/about-us', '/help-center', '/my-tickets', '/leaderboard', '/certificate', '/referrals', '/feedback', '/support-dashboard'
]);

// Strictly protect the live-hub page: require an authenticated session or a valid join token
app.get(['/live-hub', '/live-hub.html'], async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

    // Allow authenticated users
    if (req.session && req.session.userId) {
      return res.sendFile(path.join(__dirname, '..', 'live-hub.html'));
    }

    // Allow one-time join tokens (signed JWTs) - validate signature and session existence
    const joinToken = req.query.joinToken || req.query.jointoken || req.query.token || null;
    if (!joinToken) {
      return res.redirect(302, '/login');
    }

    try {
      const secret = String(process.env.LIVE_SESSION_TOKEN_SECRET || process.env.SESSION_SECRET || 'unsafe-dev-secret');
      const payload = jwt.verify(joinToken, secret, { issuer: 'college-os', audience: 'live-session' });
      const sid = payload?.sid || payload?.sessionId || null;
      if (!sid) return res.redirect(302, '/login');

      // Ensure the referenced live session exists and is not ended/cancelled
      const { rows } = await pool.query('SELECT id, status FROM live_sessions WHERE session_id = $1 LIMIT 1', [sid]);
      if (!rows[0]) return res.status(403).send('Invalid or expired join token');
      const status = String(rows[0].status || '').toLowerCase();
      if (['ended', 'cancelled'].includes(status)) return res.status(403).send('Session not available');

      return res.sendFile(path.join(__dirname, '..', 'live-hub.html'));
    } catch (err) {
      console.warn('[live-hub] token validation failed', String(err?.message || err));
      return res.redirect(302, '/login');
    }
  } catch (err) {
    return res.status(500).send('Server error');
  }
});

PAGE_ROUTES.forEach((file, route) => {
  app.get(route, (req, res) => {
    // If this route is considered protected, enforce redirect to login for unauthenticated users
    try {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      const cleanPath = route.toLowerCase();

      // Handle removed/consolidated routes: redirect unauthenticated users to login,
      // authenticated students to dashboard, and enforce access for support dashboard.
      if (REMOVED_ROUTE_PATHS.has(cleanPath)) {
        if (!req.session || !req.session.userId) {
          return res.redirect(302, '/login');
        }
        // If support-dashboard, only allow admins/support roles
        if (cleanPath === '/support-dashboard') {
          const role = req.session.role || '';
          if (!['admin', 'super_admin', 'support', 'support_admin'].includes(role)) {
            return res.status(403).send('Forbidden');
          }
        }
        // For other removed paths, send logged-in users to dashboard
        return res.redirect(302, '/dashboard');
      }

      if (PROTECTED_PAGE_PATHS.has(cleanPath)) {
        if (!req.session || !req.session.userId) {
          return res.redirect(302, '/login');
        }
        return res.sendFile(path.join(__dirname, '..', file));
      }

      return res.sendFile(path.join(__dirname, '..', file));
    } catch (err) {
      return res.status(500).send('Server error');
    }
  });
});

app.get(['/home', '/home.html'], (_req, res) => res.redirect(301, '/dashboard'));

app.use(async (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/assets/') || req.path.startsWith('/uploads/')) {
    return next();
  }

  const pathKey = req.path.toLowerCase();
  if (pathKey === '/academic-onboarding' || pathKey === '/academic-onboarding.html') {
    return res.redirect(302, '/dashboard');
  }

  if (/\.html$/i.test(pathKey)) {
    const cleanPath = pathKey.replace(/\.html$/i, '');
    // If the clean path is protected, require session
    if (REMOVED_ROUTE_PATHS && REMOVED_ROUTE_PATHS.has(cleanPath)) {
      if (!req.session || !req.session.userId) return res.redirect(302, '/login');
      if (cleanPath === '/support-dashboard') {
        const role = req.session.role || '';
        if (!['admin', 'super_admin', 'support', 'support_admin'].includes(role)) return res.status(403).send('Forbidden');
      }
      return res.redirect(302, '/dashboard');
    }

    if (PROTECTED_PAGE_PATHS && PROTECTED_PAGE_PATHS.has(cleanPath)) {
      if (!req.session || !req.session.userId) {
        return res.redirect(302, '/login');
      }
    }

    return res.redirect(301, CLEAN_PAGE_ROUTES.has(cleanPath) ? cleanPath : cleanPath || '/');
  }

  if (CLEAN_PAGE_ROUTES.has(pathKey)) {
    // If this clean route was removed, redirect appropriately
    if (REMOVED_ROUTE_PATHS && REMOVED_ROUTE_PATHS.has(pathKey)) {
      if (!req.session || !req.session.userId) return res.redirect(302, '/login');
      if (pathKey === '/support-dashboard') {
        const role = req.session.role || '';
        if (!['admin', 'super_admin', 'support', 'support_admin'].includes(role)) return res.status(403).send('Forbidden');
      }
      return res.redirect(302, '/dashboard');
    }

    // For protected clean routes enforce auth before serving the HTML
    if (PROTECTED_PAGE_PATHS && PROTECTED_PAGE_PATHS.has(pathKey)) {
      if (!req.session || !req.session.userId) {
        return res.redirect(302, '/login');
      }
    }

    return res.sendFile(path.join(__dirname, '..', CLEAN_PAGE_ROUTES.get(pathKey)));
  }

  return next();
});

app.get('/favicon.ico', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
  res.type('image/svg+xml');
  return res.send(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="College OS">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#g)" />
      <path d="M18 22h28v6H18zM18 32h20v6H18zM18 42h28v4H18z" fill="#fff" opacity="0.95" />
      <circle cx="46" cy="18" r="6" fill="#f59e0b" />
    </svg>
  `);
});

app.use(express.static(path.join(__dirname, '..'), assetStaticOptions));

// SPA fallback - serve index.html for client-side routing
app.get('*', (req, res) => {
  if (res.headersSent) {
    return;
  }

  if (req.path.startsWith('/api')) {
    // API routes should reach 404 handler instead
    return res.status(404).json({
      success: false,
      error: 'API endpoint not found',
      code: 'NOT_FOUND',
      path: req.path
    });
  }

  if (req.path.startsWith('/socket.io')) {
    return res.status(404).json({
      success: false,
      error: 'Socket endpoint not found',
      code: 'SOCKET_NOT_FOUND',
      path: req.path
    });
  }

  // Serve index.html for all non-API paths (SPA client-side routing)
  return res.status(404).sendFile(path.join(__dirname, '..', '404.html'));
});

// 14. 404 Not Found handler - catches unhandled routes

// 15. Error logging middleware - logs all errors
app.use(errorLogger);

// 16. Global error handler - MUST BE LAST
app.use(globalErrorHandler);

// Handle uncaught exceptions
process.on('unhandledRejection', (reason) => {
  const safeReason = reason instanceof Error ? reason.message : String(reason || 'Unhandled rejection');
  console.error('[Unhandled Promise Rejection]', safeReason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err.message);
  process.exit(1);
});

async function startServer() {
  const dbSource = process.env.SUPABASE_POOLER_URL
    ? 'SUPABASE_POOLER_URL'
    : process.env.SUPABASE_DATABASE_URL
    ? 'SUPABASE_DATABASE_URL'
    : process.env.CURRENT_DATABASE_URL
    ? 'CURRENT_DATABASE_URL'
    : 'DATABASE_URL';

  const storageProvider = isProduction
    ? 'supabase'
    : String(process.env.STORAGE_PROVIDER || 'supabase').toLowerCase();

  const mailerProvider = String(process.env.OTP_EMAIL_PROVIDER || 'resend').toLowerCase();

  try {
    console.info(`[Storage] provider: ${storageProvider}`);
    console.info(`[Storage] URL configured: ${Boolean(process.env.SUPABASE_URL)}`);
    console.info(`[Storage] service key configured: ${Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}`);
    console.info(`[Storage] bucket configured: ${Boolean(process.env.SUPABASE_STORAGE_BUCKET || 'college-os')}`);

    console.info(`[Mailer] provider: ${mailerProvider}`);
    console.info(`[Mailer] key configured: ${Boolean(process.env.RESEND_API_KEY)}`);
    console.info(`[Mailer] sender configured: ${Boolean(process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM)}`);

    if (isProduction) {
      validateSupabaseStorageConfiguration();
    }

    await initMailerTransporter();
  } catch (error) {
    console.warn('[Mailer] OTP transporter setup failed', {
      code: error?.code,
      message: error?.message
    });
  }

  await ensureDatabaseBootstrap();
  console.info(`[DB] connection source: ${dbSource}`);
  console.info('[DB] connected: true');
  console.info('[Startup] DB connected and bootstrap complete');

  const academicMigration = await initializeAcademicStructure();
  console.info('[Startup] Academic migration complete', {
    migrationPath: academicMigration?.migrationPath || '(unknown)',
    statementsApplied: academicMigration?.statementsApplied ?? 0
  });

  if (typeof liveSessionRoutes.runLiveSessionMaintenance === 'function') {
    liveSessionRoutes.runLiveSessionMaintenance().catch((error) => {
      console.warn('[Live Session Maintenance] initial run failed:', error.message);
    });
    setInterval(() => {
      liveSessionRoutes.runLiveSessionMaintenance().catch((error) => {
        console.warn('[Live Session Maintenance] sweep failed:', error.message);
      });
    }, 2 * 60 * 1000);
  }

  const server = app.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`College OS server listening on http://${displayHost}:${port}`);
  });

  // Initialize real-time socket layer (Socket.IO)
  try {
    initSocket(server, { allowedOrigins: Array.from(allowedOrigins) });
    console.info('[Startup] Socket.IO initialized');
  } catch (e) {
    console.warn('[Socket Init] failed to initialize socket manager:', e && e.message);
  }

  server.keepAliveTimeout = 65 * 1000;
  server.headersTimeout = 70 * 1000;
}

startServer().catch((error) => {
  console.error('Server startup failed:', error.message);
  process.exit(1);
});
