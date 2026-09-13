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

const config = {
  version: 3,
  routes: [
    {
      src: '^/$',
      dest: '/index.html'
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
      src: '^/api/(.*)$',
      dest: 'https://college-o.onrender.com/api/$1'
    },
    {
      src: '^/contact$',
      dest: '/contact-us.html'
    },
    {
      src: '^/forms$',
      dest: '/create-support-request.html'
    },
    {
      src: '^/leaderboard$',
      dest: '/leaderboards.html'
    },
    {
      src: '^/membership$',
      dest: '/pricing.html'
    },
    {
      src: '^/mock-test$',
      dest: '/mock-tests.html'
    },
    {
      src: '^/notes$',
      dest: '/notes-library.html'
    },
    {
      src: '^/roadmap$',
      dest: '/study-roadmap.html'
    },
    {
      src: '^/contribute$',
      dest: '/academic-contribution-hub.html'
    },
    {
      handle: 'filesystem'
    },
    {
      src: '^/([^/.]+)/?$',
      dest: '/$1.html',
      check: true
    }
  ]
};

fs.writeFileSync(path.join(outputDir, 'config.json'), JSON.stringify(config, null, 2));

console.log('[build-vercel] Successfully generated Vercel Build Output API v3 bundle!');
