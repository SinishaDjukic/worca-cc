// ui/public/extension-settings-view.mjs — Settings → General → "Browser extension" (docs/browser-extension.md).
// A detached element: no fetch, no listeners — app.js owns I/O and the Revoke clicks ([data-revoke]).
const BROWSERS = Object.freeze({ chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' });
export const browserLabel = (b) => BROWSERS[b] || 'Browser';
export function formatPairCode(code) {
  const s = String(code ?? '');
  return /^\d{6}$/.test(s) ? `${s.slice(0, 3)} ${s.slice(3)}` : s;
}
const day = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : null; };
const shortOrigin = (o) => { const s = String(o || '').replace(/^[a-z-]+:\/\//, ''); return s.length > 12 ? `${s.slice(0, 12)}…` : s; };

export function renderExtensionPairings(data, { doc = document } = {}) {
  const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const root = make('div', 'xp');
  if (data && data.remoteMode) {
    root.append(make('p', 'xp-empty', 'Pairing is off while remote access is on: the browser extension works with a local Worca only.'));
    return root;
  }
  const list = Array.isArray(data && data.paired) ? data.paired : [];
  if (!list.length) {
    root.append(make('p', 'xp-empty', 'No browser extension is paired. Install the Worca extension, open its sidebar and press Connect.'));
    return root;
  }
  const ul = make('ul', 'xp-list');
  for (const e of list) {
    const li = make('li', 'xp-row');
    const main = make('div', 'xp-main');
    main.append(make('div', 'xp-name', `${e.name} · ${browserLabel(e.browser)}`));
    const used = day(e.lastUsedAt);
    main.append(make('div', 'xp-meta', `Paired ${day(e.createdAt) || '—'} · ${used ? `last used ${used}` : 'not used yet'} · id ${shortOrigin(e.origin)}`));
    const btn = make('button', 'btn xp-revoke', 'Revoke');
    btn.type = 'button';
    btn.dataset.revoke = e.id;
    btn.dataset.name = e.name;
    li.append(main, btn);
    ul.append(li);
  }
  root.append(ul);
  return root;
}

/** chrome | edge | firefox from a user agent (Edge's UA also says Chrome, so Edg/ first). Anything else → chrome. */
export function detectBrowser(ua) {
  const s = String(ua || '');
  if (/\bEdg(e|A|iOS)?\//.test(s)) return 'edge';
  if (/\bFirefox\//.test(s)) return 'firefox';
  return 'chrome';
}

const validInstall = (d) => d && typeof d === 'object' && Array.isArray(d.builds) && d.builds.every((b) => b && BROWSERS[b.browser]);

/** Settings → Browser extension → Install. `data` is GET /api/extension/install; `browser` the tab to open on.
 *  Tabs carry [data-xi-browser] and Copy path carries [data-copy-path]: app.js owns the clicks (selectInstallBrowser, clipboard). */
export function renderExtensionInstall(data, { doc = document, browser = 'chrome' } = {}) {
  const make = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const root = make('div', 'xi');
  root.append(make('h3', 'subsection-title xi-head', 'Install'));
  if (!validInstall(data)) { root.append(make('p', 'xp-empty', 'Could not load the packaged browser extension.')); return root; }
  const tabs = make('div', 'tabs xi-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Browser');
  root.append(tabs);
  const pick = data.builds.some((b) => b.browser === browser) ? browser : data.builds[0].browser;
  for (const b of data.builds) {
    const tab = make('button', 'tab', browserLabel(b.browser));
    tab.type = 'button';
    tab.id = `xi-tab-${b.browser}`;
    tab.dataset.xiBrowser = b.browser;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `xi-panel-${b.browser}`);
    tabs.append(tab);
    const panel = make('div', 'xi-panel');
    panel.id = `xi-panel-${b.browser}`;
    panel.dataset.xiPanel = b.browser;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    if (data.remoteMode) {
      panel.append(make('p', 'xi-note', 'This Worca is hosted, so its extension folder is on the server. Download the zip for your browser from the release below.'));
    } else if (!b.present) {
      const p = make('p', 'xi-note', 'No packaged build was found. In a source checkout, build it first:');
      panel.append(p, make('code', 'xi-cmd', data.buildCommand || 'npm run ext:build'));
    } else {
      const row = make('div', 'xi-path-row');
      row.append(make('code', 'xi-path', b.path));
      const copy = make('button', 'btn xi-copy', 'Copy path');
      copy.type = 'button';
      copy.dataset.copyPath = b.path;
      row.append(copy);
      panel.append(row);
    }
    if (b.present || data.remoteMode) {
      const steps = make('ol', 'xi-steps');
      for (const s of b.steps || []) steps.append(make('li', null, s));
      panel.append(steps);
    }
    const meta = make('p', 'xi-meta');
    const ver = b.version || data.version;
    meta.append(doc.createTextNode(`${ver ? `Version ${ver}` : 'Version unknown'}${b.browser === 'firefox' ? ' · unsigned for now' : ''}`));
    if (b.downloadUrl) {
      meta.append(doc.createTextNode(' · '));
      const a = make('a', 'xi-link', `Download worca-${b.browser}-${data.version}.zip`);
      a.href = b.downloadUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      meta.append(a);
    }
    if (data.releaseUrl) {
      meta.append(doc.createTextNode(' · '));
      const r = make('a', 'xi-link', 'Release page');
      r.href = data.releaseUrl;
      r.target = '_blank';
      r.rel = 'noopener noreferrer';
      meta.append(r);
    }
    panel.append(meta);
    root.append(panel);
  }
  selectInstallBrowser(root, pick);
  return root;
}

/** Show one browser's panel; the tab state follows (.on + aria-selected, roving tabindex). */
export function selectInstallBrowser(root, browser) {
  for (const t of root.querySelectorAll('[data-xi-browser]')) {
    const on = t.dataset.xiBrowser === browser;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
  }
  for (const p of root.querySelectorAll('[data-xi-panel]')) p.hidden = p.dataset.xiPanel !== browser;
}
