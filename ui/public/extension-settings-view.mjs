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
    const btn = make('button', 'btn-ghost xp-revoke', 'Revoke');
    btn.type = 'button';
    btn.dataset.revoke = e.id;
    btn.dataset.name = e.name;
    li.append(main, btn);
    ul.append(li);
  }
  root.append(ul);
  return root;
}
