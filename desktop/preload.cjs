// desktop/preload.cjs — the main window's preload (docs/desktop.md "Window and icons"). Sandboxed: CommonJS, and the
// only module it may require is electron. It marks <html> as the desktop shell (data-shell, data-shell-chrome; the
// desktop-only CSS keys off them), reports the theme and the sidebar rail as enums ({ mode, scheme, rail }; main picks
// the colours), and follows main's full-screen flag. A double-click on the title strip's empty space (the drag
// regions of desktop-shell.css, never a control) goes to main over worca:title-dblclick, which zooms or minimizes
// as the OS says. It also reports the page's "needs you" badge over worca:badge as { count, dot }: the count from the
// "(N) " title prefix alerts.mjs writes, the dot from its favicon swapped to a data: URL (main draws the Dock, taskbar
// and tray from it). It exposes nothing to the page: no bridge API, no globals.
'use strict';

(() => {
  const { ipcRenderer } = require('electron');
  const CHROMES = ['inset', 'overlay', 'native'];
  const MODES = ['system', 'light', 'dark'];
  const ARG = '--worca-chrome=';
  // desktop/src/badge.mjs BADGE_CHANNEL and MAX_BADGE_COUNT (test/desktop-preload.test.mjs compares them).
  const BADGE = 'worca:badge';
  const MAX_COUNT = 99999;
  // The double-click mirrors desktop-shell.css: the strips that are app-region: drag per chrome, and every no-drag
  // selector of its rules (test/desktop-preload.test.mjs checks NO_DRAG covers them all).
  const SEND_CHROMES = ['inset', 'overlay'];
  const STRIP = '.brand, .topnav';
  const OVERLAY_STRIP = '.term-head';
  const WORKFLOWS_STRIP = 'body.view-workflows .view[data-view="workflows"]';
  const NO_DRAG = [
    'a', 'button', 'input', 'select', 'textarea', 'label', 'summary', '[role="button"]', '[tabindex]', '[contenteditable]',
    'dialog', '[popover]', '[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]', '[role="tooltip"]',
    '.viewer-modal', '.guide-scrim', '.guide-ring', '.guide-balloon', '.apv', '.req-help', '.ss', '.session-expired',
    '.chat-scrim', '.chat-panel', '.nav-fly', '.activity-pop', '.tsearch-pop', '.info-bubble', '.mention-popup', '.pp-bar',
    '.pp-pop', '.wfv-menu', '.term-pane', '.chart-tip', '.cr-picker', '.tl-pop', '.group-picker', '.label-picker',
    '.mk-tu-pop', '.req-dlg-wrap', '.wfv',
  ];

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

  /** { count, dot } as primitives: the "(N) " title prefix (clamped; 0 without one) and a data: favicon. */
  function readBadge() {
    const m = /^\((\d+)\) /.exec(document.title || '');
    const n = m ? Number(m[1]) : 0;
    const count = Number.isFinite(n) ? Math.min(n, MAX_COUNT) : 0;
    const link = document.querySelector('link[rel~="icon"]');
    const dot = /^data:/i.test((link && link.getAttribute('href')) || '');
    return { count, dot };
  }

  let lastBadge = null;
  function reportBadge() {
    const { count, dot } = readBadge();
    const key = `${count}|${dot}`;
    if (key === lastBadge) return;
    lastBadge = key;
    ipcRenderer.send(BADGE, { count, dot });
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
    // The page's module scripts may already have written the title or the favicon: the first report reads them.
    reportBadge();
    const head = document.head || document.documentElement;
    if (head) new MutationObserver(reportBadge).observe(head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'rel'] });
    try {
      if (typeof window.matchMedia === 'function') window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', report);
    } catch { /* no media queries: the scheme stays as reported */ }
  });

  if (SEND_CHROMES.includes(chrome)) {
    const strip = chrome === 'overlay' ? `${STRIP}, ${OVERLAY_STRIP}` : STRIP;
    const noDrag = NO_DRAG.join(', ');
    document.addEventListener('dblclick', (event) => {
      if (!event || event.button !== 0) return;
      const root = document.documentElement;
      if (chrome === 'inset' && root && root.hasAttribute('data-shell-fullscreen')) return;
      let el = event.target;
      if (el && el.nodeType === 3) el = el.parentElement;
      if (!el || el.nodeType !== 1) return;
      const s = el.closest(strip) || (el.matches(WORKFLOWS_STRIP) ? el : null);
      if (!s) return;
      // As in the CSS, a strip sets drag itself: only a no-drag element inside it (a control, an overlay root) blocks,
      // never a no-drag ancestor (.term-head sits inside the no-drag aside.term-pane).
      const nd = el.closest(noDrag);
      if (nd && s.contains(nd)) return;
      ipcRenderer.send('worca:title-dblclick');
    }, true);
  }

  ipcRenderer.on('worca:shell-fullscreen', (_event, on) => {
    const root = document.documentElement;
    if (!root) return;
    if (on === true) root.setAttribute('data-shell-fullscreen', '');
    else root.removeAttribute('data-shell-fullscreen');
  });
})();
