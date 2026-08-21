(() => {
  function applyTheme(theme) {
    const value = ['light', 'dark'].includes(theme) ? theme : 'system';
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value === 'system' ? 'light dark' : value;
  }

  chrome.storage.local.get('shizhenSettings').then(({ shizhenSettings = {} }) => {
    applyTheme(shizhenSettings.theme || 'system');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shizhenSettings) {
      applyTheme(changes.shizhenSettings.newValue?.theme || 'system');
    }
  });
})();
