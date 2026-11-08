// desktop/preload.cjs — the main window's preload (docs/desktop.md "Window and icons"). Sandboxed: CommonJS, and the
// only module it may require is electron. It marks <html> as the desktop shell (data-shell, data-shell-chrome; the
// desktop-only CSS keys off them), reports the theme and the sidebar rail as enums ({ mode, scheme, rail }; main picks
// the colours), and follows main's full-screen flag. It exposes nothing to the page: no bridge API, no globals.
'use strict';

(() => {
  const { ipcRenderer } = require('electron');
  const CHROMES = ['inset', 'overlay', 'native'];
  const MODES = ['system', 'light', 'dark'];
  const ARG = '--worca-chrome=';

  const argv = Array.isArray(process.argv) ? process.argv : [];
  const given = argv.find((a) => typeof a === 'string' && a.startsWith(ARG));
  const chrome = given && CHROMES.includes(given.slice(ARG.length)) ? given.slice(ARG.length) : 'native';

  function mark() {
    const root = document.documentElement;
    if (!root) return false;
    root.setAttribute('data-shell', 'desktop');
    root.setAttribute('data-shell-chrome', chrome);
    return true;
  }

  if (!mark()) {
    const waiting = new MutationObserver(() => { if (mark()) waiting.disconnect(); });
    waiting.observe(document, { childList: true });
  }

  function systemDark() {
    try {
      return typeof window.matchMedia === 'function' && !!window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  let lastSent = null;
  function report() {
    const root = document.documentElement;
    if (!root) return;
    const theme = root.getAttribute('data-theme');
    const mode = MODES.includes(theme) ? theme : 'system';
    const scheme = mode === 'system' ? (systemDark() ? 'dark' : 'light') : mode;
    const rail = !!document.getElementById('side-rail')?.classList.contains('collapsed');
    const key = `${mode}|${scheme}|${rail}`;
    if (key === lastSent) return;
    lastSent = key;
    ipcRenderer.send('worca:shell-state', { mode, scheme, rail });
  }

  let started = false;
  window.addEventListener('DOMContentLoaded', () => {
    mark();
    if (started) return;
    started = true;
    report();
    const changed = new MutationObserver(report);
    if (document.documentElement) changed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const rail = document.getElementById('side-rail');
    if (rail) changed.observe(rail, { attributes: true, attributeFilter: ['class'] });
    try {
      if (typeof window.matchMedia === 'function') window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', report);
    } catch { /* no media queries: the scheme stays as reported */ }
  });

  ipcRenderer.on('worca:shell-fullscreen', (_event, on) => {
    const root = document.documentElement;
    if (!root) return;
    if (on === true) root.setAttribute('data-shell-fullscreen', '');
    else root.removeAttribute('data-shell-fullscreen');
  });
})();
