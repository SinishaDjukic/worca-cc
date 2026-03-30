export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // Toggle Shoelace's dark theme class so sl-dialog and other
  // Shoelace components pick up dark palette variables
  document.documentElement.classList.toggle('sl-theme-dark', theme === 'dark');
}

export function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
