require('dotenv').config();

const path = require('path');
const express = require('express');
const compression = require('compression');
const session = require('express-session');
const pgSessionFactory = require('connect-pg-simple');
const { pool } = require('./db/pool');
const { ensureDatabaseBootstrap } = require('./db/bootstrap');

const authRoutes = require('./routes/auth');
const metaRoutes = require('./routes/meta');
const dashboardRoutes = require('./routes/dashboard');
const intelligenceRoutes = require('./routes/intelligence');
const quizRoutes = require('./routes/quizzes');
const mockRoutes = require('./routes/mockTests');
const roadmapRoutes = require('./routes/roadmaps');
const careerRoutes = require('./routes/career');
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

const app = express();
const PgSession = pgSessionFactory(session);
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';

// Render sits behind a proxy; trust the first hop so req.ip and secure cookies are correct.
app.set('trust proxy', 1);

function parseOrigins(input) {
  return String(input || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const jitsiDomain = String(process.env.JITSI_DOMAIN || 'meet.jit.si').trim() || 'meet.jit.si';
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

function getRateLimitKey(req) {
  if (req.user?.id) return `user:${req.user.id}`;
  return `ip:${req.ip || 'unknown'}`;
}

function isPublicReadRoute(req) {
  return req.method === 'GET' && PUBLIC_READ_PATHS.has(req.path);
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
  maxAge: isProduction ? '30d' : '1h',
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
      scriptSrc: ["'self'", "'unsafe-inline'", `https://${jitsiDomain}`, 'https://meet.jit.si', 'https://download.agora.io'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      // Allow framing Jitsi (embedded meeting) from meet.jit.si
      frameSrc: ["'self'", `https://${jitsiDomain}`, 'https://meet.jit.si'],
      connectSrc: ["'self'", `https://${jitsiDomain}`, 'https://meet.jit.si', 'https://download.agora.io'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : []
    }
  },
  hsts: {
    maxAge: 31536000,  // 1 year
    includeSubDomains: true,
    preload: isProduction
  },
  // Disable frameguard (X-Frame-Options) because it conflicts with modern CSP frame-src
  frameguard: false,
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
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
  if (willAllow) {
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

// 7. Session middleware
app.use(session(sessionOptions));

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
  // Serve index.html for all non-API paths (SPA client-side routing)
  return res.sendFile(path.join(__dirname, '..', 'index.html'));
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
  await pool.query('SELECT 1');
  await ensureDatabaseBootstrap();
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
