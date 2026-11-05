// tools/parity/crawl-page.mjs — in-page helpers for the differential crawler. Each function is self-contained (no
// closure over module scope) so crawl.mjs can run it with page.evaluate(`(${fn})(document, window)`); tests run it in jsdom.
export const CRAWL_TEXT = 'parity crawl 919';

/** Every interactive element under `doc` (a document or an overlay element). `opt.keep` stashes the elements in
 *  window.__crawlEls, index-aligned with the result. */
export function enumerateIn(doc, win, opt = {}) {
  const SEL = 'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=switch], [role=tab], '
    + '[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=checkbox], [role=radio], [role=option], '
    + '[contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex="-1"]), .info-tip, [aria-haspopup], [aria-expanded]';
  const visible = opt.visible ?? ((el) => { const r = el.getBoundingClientRect(); const s = win.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; });
  const KEY_ATTRS = ['data-action', 'data-tab', 'data-theme-mode', 'data-flag-switch', 'data-view', 'name', 'aria-label', 'type', 'role'];
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/[0-9a-f]{8}-[0-9a-f-]{27,}|ask_[0-9a-f]{8}/gi, '<id>').slice(0, 40);
  const anchorOf = (el) => el.parentElement?.closest('[role=dialog], dialog, [role=menu], [data-view], [id]');
  const anchorSel = (a) => (!a ? 'body' : a.matches('[data-view]') ? `${a.tagName.toLowerCase()}[data-view="${a.getAttribute('data-view')}"]`
    : a.id && !/\d{3,}|ask_/.test(a.id) ? `#${a.id}` : `${a.tagName.toLowerCase()}[role="${a.getAttribute('role') ?? ''}"]`);
  const sigOf = (el) => `${el.tagName.toLowerCase()}${KEY_ATTRS.filter((k) => el.hasAttribute(k)).map((k) => `[${k}="${norm(el.getAttribute(k))}"]`).join('')}`
    + (el.classList.length ? `.${[...el.classList].sort().join('.')}` : '');
  const kindOf = (el) => {
    const t = el.tagName.toLowerCase(); const role = el.getAttribute('role'); const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (el.classList.contains('info-tip')) return 'tip';
    if (t === 'select') return 'select';
    if (t === 'textarea' || el.isContentEditable || el.getAttribute('contenteditable') !== null || (t === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color'].includes(type))) return 'text';
    if (['checkbox', 'radio'].includes(type) || ['switch', 'checkbox', 'radio', 'menuitemcheckbox', 'menuitemradio'].includes(role) || el.hasAttribute('aria-pressed')) return 'toggle';
    if (t === 'summary' || (el.hasAttribute('aria-expanded') && !el.hasAttribute('aria-haspopup'))) return 'disclosure';
    if (t === 'a') return 'link';
    return 'button';
  };
  const seen = new Map(); const out = []; const kept = [];
  for (const el of doc.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    const anchor = anchorOf(el); const sig = sigOf(el); const text = el.tagName === 'A' || el.tagName === 'BUTTON' ? norm(el.textContent) : '';
    const base = `${anchorSel(anchor)} ${sig}${text && !el.hasAttribute('data-action') ? `:text("${text}")` : ''}`;
    const n = seen.get(base) ?? 0; seen.set(base, n + 1);
    const key = n ? `${base}:nth(${n})` : base;
    const list = el.closest('li, tr, [role=row], [role=option]')?.parentElement;
    const dupBase = `${anchorSel(anchor)} ${sig}`;
    const first = out.find((o) => o.dupBase === dupBase && o.list === list && list);
    out.push({ key, dupBase, list, kind: kindOf(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), cls: el.className || '',
      href: el.getAttribute('href'), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      chrome: !!el.closest('#side-rail, aside.sidebar, #topnav'), dupOf: first ? first.key : null });   // the app has no #sidebar
    kept.push(el);
  }
  if (opt.keep) win.__crawlEls = kept;   // the crawler acts on element i through window.__crawlEls[i] (no DOM attribute)
  return out.map(({ list, dupBase, ...e }) => e);
}

/** One line per visible element: `path\t<tag attrs>text`. Paths are the index chain from body, so a mask can name one. */
export function serializeDom(doc, win, opt = {}) {
  const visible = opt.visible ?? ((el) => { const s = win.getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; });
  const KEEP = /^(id|class|role|name|type|href|value|checked|disabled|hidden|open|selected|tabindex|title|placeholder|aria-.+|data-.+)$/;
  // entrance-animation markers: whether a row is marked depends on which of two channels (the send's reply, a WebSocket
  // frame) lands first, and with reduced motion they animate nothing
  const MOTION = ['data-ask-enter'];
  const lines = [];
  const walk = (el, path) => {
    if (!visible(el)) return;
    const attrs = [...el.attributes].filter((a) => KEEP.test(a.name) && !MOTION.includes(a.name)).map((a) => `${a.name}="${a.name === 'class' ? a.value.split(/\s+/).sort().join(' ') : a.value}"`).sort().join(' ');
    const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const live = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ? ` value=${JSON.stringify(el.value)}${el.checked ? ' checked' : ''}` : '';
    lines.push(`${path}\t<${el.tagName.toLowerCase()}${attrs ? ` ${attrs}` : ''}${live}>${own}`);
    [...el.children].forEach((c, i) => walk(c, `${path}.${i}`));
  };
  walk(doc.body, '0');
  return lines;
}

export function actionsFor(e) {
  switch (e.kind) {
    case 'text': return [['fill', CRAWL_TEXT], ['press', 'Enter'], ['press', 'Escape']];
    case 'select': return [['selectNext'], ['press', 'Escape']];
    case 'toggle': return [['click'], ['click']];
    case 'tip': return [['hover']];
    default: return [['click'], ['press', 'Escape']];   // button, link, tab, menu item, disclosure: open, then close
  }
}
