// extension/src/content/content.mjs — injected (activeTab + scripting) into the ONE tab the Worca sidebar is active
// for. Pinpoint lives here, in a closed shadow root (open in test builds) so the page's CSS cannot reach it and its
// CSS cannot leak. No token, no fetch to worca: everything goes through the service worker's ports. Pinpoint opens on
// request (the worca-pinpoint command) unless the user turned on "Show Pinpoint when I select text" (the SW sends it,
// D11); the area capture's overlay (capture-overlay.mjs) also lives here.
import { createPinpoint } from '../../../ui/public/pinpoint.mjs';
import { extractReadable } from '../readable.mjs';
import { createPortFetch } from './port-fetch.mjs';
import { SELECTION_MAX } from '../page-context.mjs';
import { TEST_BUILD } from '../ext-api.mjs';
import { startCapture as mountCapture } from './capture-overlay.mjs';
import { cssSelector, elementUnder, htmlSnippet } from '../element-snippet.mjs';
import SHADOW_CSS from 'worca:shadow-css';   // tools/build-extension.mjs inlines the generated shadow CSS

(() => {
  const api = globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome;   // v8: as ext-api.mjs
  if (globalThis.__worcaContent) { globalThis.__worcaContent.hello(); return; }
  const port = api.runtime.connect({ name: 'worca-content' });
  let pp = null; let host = null; let pageSheet = null; let fontsAsked = false; let cancelCapture = null;

  function collect(withText) {
    const sel = String(window.getSelection ? window.getSelection().toString() : '').trim();
    const out = { url: location.href, title: document.title, selection: sel.slice(0, SELECTION_MAX) };
    if (withText) { const r = extractReadable(document); out.text = r.text; out.truncated = r.truncated; }
    return out;
  }

  // ::highlight() must be in the PAGE document: a shadow-only rule would not paint light-DOM text. System colours only.
  function addHighlightRule() {
    const rule = '::highlight(pinpoint-active){background-color:Highlight;color:HighlightText}';
    try { pageSheet = new CSSStyleSheet(); pageSheet.replaceSync(rule); document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet]; }
    catch { pageSheet = document.createElement('style'); pageSheet.textContent = rule; (document.head || document.documentElement).append(pageSheet); }
  }
  function removeHighlightRule() {
    if (!pageSheet) return;
    if (pageSheet instanceof CSSStyleSheet) { try { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== pageSheet); } catch { /* page replaced it */ } }
    else pageSheet.remove();
    pageSheet = null;
  }

  // The layer follows the browser's colour scheme (:host carries color-scheme: light dark), as worca's
  // data-theme="system" does: the host never gets a data-theme.
  function activate(autoSelect) {
    if (pp) { pp.setAuto(!!autoSelect); return; }
    // v8: a page can customElements.define('worca-pinpoint', …) and attach its own shadow root on upgrade, which makes
    // our attachShadow throw. Fall back to a <div> (a built-in a page cannot define). E2E selectors use the
    // `data-worca-pinpoint` attribute, which both hosts carry.
    const mount = (tag) => {
      const h = document.createElement(tag);
      h.setAttribute('data-worca-pinpoint', '');
      return { h, r: h.attachShadow({ mode: TEST_BUILD ? 'open' : 'closed' }) };
    };
    let made;
    try { made = mount('worca-pinpoint'); } catch { made = mount('div'); }
    host = made.h;
    const root = made.r;
    for (const [k, v] of [['position', 'fixed'], ['top', '0'], ['left', '0'], ['width', '0'], ['height', '0'], ['z-index', '2147483647'], ['display', 'block']]) host.style.setProperty(k, v, 'important');
    try { const s = new CSSStyleSheet(); s.replaceSync(SHADOW_CSS); root.adoptedStyleSheets = [s]; }
    catch { const s = document.createElement('style'); s.textContent = SHADOW_CSS; root.append(s); }
    const layer = document.createElement('div');
    layer.className = 'wx-layer';
    root.append(layer);
    // On <html>, NOT <body>: the Pinpoint surface below is document.body, so text selected inside our own popover
    // (an Explain answer) is outside every surface and never opens a second bar (review suggestion).
    document.documentElement.append(host);
    addHighlightRule();
    if (!fontsAsked) { fontsAsked = true; port.postMessage({ type: 'fonts' }); }
    // shadow: Pinpoint resolves targets/focus through the root we hold — the same code path for the closed (production)
    // and open (test) root (review C1, D13).
    pp = createPinpoint({ doc: document, win: window, fetch: createPortFetch(() => api.runtime.connect({ name: 'worca-pinpoint' })), trustedOnly: true, shadow: { host, root }, auto: !!autoSelect });
    if (!document.body) return;   // v8: SVG/XML documents have no <body>; Pinpoint has no surface there
    pp.addSurface(document.body, {
      kind: 'web',
      // The selection's unit: the nearest article/main, else <body>. Without it every evaluate() walks the whole body,
      // and Explain's context could pull in script/style text (review suggestion).
      unit: (n) => (n && n.closest && n.closest('article, main')) || document.body,
      container: () => document.documentElement,
      layer: () => layer,
      source: () => location.hostname,
      // Send to chat (text ''), Use this / Discuss / Go deeper (text = Pinpoint's wording): both reach the sidebar (D24).
      draft: (quote, text) => port.postMessage({ type: 'send-to-chat', quote: { text: String((quote && quote.text) || '') }, text: String(text || '') }),
    });
  }

  function startCapture() {
    if (cancelCapture) return;   // one overlay at a time
    pp?.close();
    // capture-state tells the sidebar an overlay is up, so Esc pressed there (where focus usually is) can cancel it.
    const ended = () => { cancelCapture = null; try { port.postMessage({ type: 'capture-state', on: false }); } catch { /* disconnected (deactivate) */ } };
    cancelCapture = mountCapture({
      doc: document, win: window, css: SHADOW_CSS, open: TEST_BUILD,
      onCancel: ended,
      onDone: (rect, skip) => {
        ended();
        const el = elementUnder(document, rect, skip);
        port.postMessage({ type: 'capture-rect', meta: {
          title: document.title, rect,
          viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
          selector: el ? cssSelector(el) : null, snippet: el ? htmlSnippet(el) : '',
        } });
      },
    });
    port.postMessage({ type: 'capture-state', on: true });
  }

  function deactivate() {
    cancelCapture?.();
    if (pp) { pp.destroy(); pp = null; }
    if (host) { host.remove(); host = null; }
    removeHighlightRule();
  }

  port.onMessage.addListener((m) => {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'activate') activate(m.autoSelect === true);
    else if (m.type === 'deactivate') deactivate();
    else if (m.type === 'pinpoint-auto') pp?.setAuto(m.on === true);
    else if (m.type === 'pinpoint-open') { if (!pp || !pp.openAtSelection()) port.postMessage({ type: 'pinpoint-none' }); }
    else if (m.type === 'capture-start') startCapture();
    else if (m.type === 'capture-cancel') cancelCapture?.();
    else if (m.type === 'collect') port.postMessage({ type: 'context', id: m.id, data: collect(!!m.withText) });
    else if (m.type === 'fonts') {
      for (const f of m.fonts || []) {
        try {
          const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
          const face = new FontFace(f.family, bytes, { weight: f.weight, style: 'normal' });
          document.fonts.add(face);
          void face.load();
        } catch { /* the page's own fonts remain */ }
      }
    }
  });
  port.onDisconnect.addListener(() => { deactivate(); delete globalThis.__worcaContent; });
  globalThis.__worcaContent = { hello: () => port.postMessage({ type: 'hello' }) };
  port.postMessage({ type: 'hello' });
})();
