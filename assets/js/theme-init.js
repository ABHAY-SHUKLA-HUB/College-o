(function () {
  try {
    var hasStored = localStorage.getItem('collegeos_theme') !== null;
    var stored = hasStored ? localStorage.getItem('collegeos_theme') : 'light';
    if (stored !== 'light' && stored !== 'dark' && stored !== 'system') {
      stored = 'light';
    }

    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = stored === 'system' ? (prefersDark ? 'dark' : 'light') : stored;

    document.documentElement.dataset.themeMode = resolved;
    document.documentElement.style.colorScheme = resolved;
  } catch (error) {
    document.documentElement.dataset.themeMode = 'light';
    document.documentElement.style.colorScheme = 'light';
  }

  // Set target="_blank" only for external links
  document.addEventListener('DOMContentLoaded', function () {
    document.body.addEventListener('click', function (event) {
      var link = event.target.closest('a');
      if (!link) return;

      var href = link.getAttribute('href');
      if (!href) return;

      // Ignore hash/fragment links, mailto, tel, and javascript protocols
      if (href.indexOf('#') === 0 || /^(mailto:|tel:|javascript:)/i.test(href)) return;

      try {
        var targetUrl = new URL(href, window.location.href);
        // Only set target _blank for third-party / external domains
        if (targetUrl.origin !== window.location.origin) {
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
        }
      } catch (e) {
        // Relative URLs are internal - let them navigate normally
      }
    }, true);
  });
})();
