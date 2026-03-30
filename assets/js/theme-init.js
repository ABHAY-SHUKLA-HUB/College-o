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
})();
