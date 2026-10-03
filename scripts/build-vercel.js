const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const outputDir = path.join(rootDir, '.vercel', 'output');
const staticDir = path.join(outputDir, 'static');

try {
  fs.rmSync(outputDir, { recursive: true, force: true });
} catch (e) {}

fs.mkdirSync(staticDir, { recursive: true });

const ignoreList = new Set([
  '.git',
  '.gitignore',
  '.vercel',
  'node_modules',
  'server',
  'scripts',
  'tests',
  'tools',
  'scratch',
  'uploads',
  'logs',
  'reports'
]);

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      if (ignoreList.has(file)) continue;
      copyRecursive(path.join(src, file), path.join(dest, file));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

for (const item of fs.readdirSync(rootDir)) {
  if (ignoreList.has(item)) continue;
  copyRecursive(path.join(rootDir, item), path.join(staticDir, item));
}

// Copy HTML aliases to ensure physical files exist for all named routes
const htmlAliases = {
  'notes.html': 'notes.html',
  'pyqs.html': 'pyqs.html',
  'quizzes.html': 'quizzes.html',
  'mock-test.html': 'mock-tests.html',
  'features.html': 'features.html',
  'ai-study.html': 'ai-study.html',
  'career-roadmaps.html': 'career-roadmaps.html',
  'community.html': 'community.html',
  'live-study.html': 'live-study.html',
  'certificates.html': 'certificates.html',
  'roadmap.html': 'career-roadmaps.html',
  'contribute.html': 'academic-contribution-hub.html',
  'membership.html': 'pricing.html',
  'leaderboard.html': 'leaderboards.html',
  'forms.html': 'create-support-request.html',
  'contact.html': 'contact-us.html',
  'campus-feed.html': 'college-feed.html'
};

for (const [alias, target] of Object.entries(htmlAliases)) {
  const targetPath = path.join(staticDir, target);
  const aliasPath = path.join(staticDir, alias);
  if (fs.existsSync(targetPath) && targetPath !== aliasPath) {
    fs.copyFileSync(targetPath, aliasPath);
  }
}

const config = {
  version: 3,
  routes: [
    {
      src: '/(.*)',
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'Permissions-Policy': 'camera=(self "https://meet.jit.si"), microphone=(self "https://meet.jit.si"), geolocation=(), payment=(), usb=()',
        'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline' https://meet.jit.si https://download.agora.io https://accounts.google.com https://www.gstatic.com https://challenges.cloudflare.com https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://college-o.onrender.com https://*.supabase.co wss://*.supabase.co https://meet.jit.si https://download.agora.io https://accounts.google.com https://oauth2.googleapis.com https://challenges.cloudflare.com https://api.razorpay.com; frame-src 'self' https://meet.jit.si https://challenges.cloudflare.com https://api.razorpay.com"
      },
      continue: true
    },
    {
      src: '/sw.js',
      headers: {
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Service-Worker-Allowed': '/',
        'Content-Type': 'application/javascript'
      },
      continue: true
    },
    {
      src: '/manifest.json',
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'public, max-age=3600'
      },
      continue: true
    },
    {
      src: '^/\\.well-known/security\\.txt$',
      dest: '/public/.well-known/security.txt'
    },
    {
      src: '^/favicon\\.ico$',
      dest: 'https://college-o.onrender.com/favicon.ico'
    },
    {
      src: '^/uploads/(.*)$',
      dest: 'https://college-o.onrender.com/uploads/$1'
    },
    {
      src: '^/socket.io/(.*)$',
      dest: 'https://college-o.onrender.com/socket.io/$1'
    },
    {
      src: '^/api/(.*)$',
      dest: 'https://college-o.onrender.com/api/$1'
    },
    {
      handle: 'filesystem'
    },
    {
      src: '^/$',
      dest: '/index.html'
    },
    {
      src: '^/features$',
      dest: '/features.html'
    },
    {
      src: '^/notes$',
      dest: '/notes.html'
    },
    {
      src: '^/pyqs$',
      dest: '/pyqs.html'
    },
    {
      src: '^/quizzes$',
      dest: '/quizzes.html'
    },
    {
      src: '^/mock-tests$',
      dest: '/mock-tests.html'
    },
    {
      src: '^/mock-test$',
      dest: '/mock-tests.html'
    },
    {
      src: '^/ai-study$',
      dest: '/ai-study.html'
    },
    {
      src: '^/career-roadmaps$',
      dest: '/career-roadmaps.html'
    },
    {
      src: '^/community$',
      dest: '/community.html'
    },
    {
      src: '^/live-study$',
      dest: '/live-study.html'
    },
    {
      src: '^/certificates$',
      dest: '/certificates.html'
    },
    {
      src: '^/certificate-verify$',
      dest: '/certificate-verify.html'
    },
    {
      src: '^/pricing$',
      dest: '/pricing.html'
    },
    {
      src: '^/membership$',
      dest: '/pricing.html'
    },
    {
      src: '^/about-us$',
      dest: '/about-us.html'
    },
    {
      src: '^/contact-us$',
      dest: '/contact-us.html'
    },
    {
      src: '^/contact$',
      dest: '/contact-us.html'
    },
    {
      src: '^/help-center$',
      dest: '/help-center.html'
    },
    {
      src: '^/privacy$',
      dest: '/privacy.html'
    },
    {
      src: '^/terms$',
      dest: '/terms.html'
    },
    {
      src: '^/([^/.]+)/?$',
      dest: '/$1.html',
      check: true
    },
    {
      src: '^/(.*)$',
      dest: '/index.html'
    }
  ]
};

fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify(config, null, 2));

console.log('[build-vercel] Successfully generated Vercel Build Output API v3 bundle with multi-page routes!');
