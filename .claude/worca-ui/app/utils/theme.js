export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
