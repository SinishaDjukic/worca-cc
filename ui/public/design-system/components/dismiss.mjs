// What lies over a page and how it goes (docs/rail/panels.md): one registry per document, so every menu, picker, popover,
// flyout, panel, search result, editor and Dialog closes the same way. A page says when a layer is open, what counts as
// inside it, and how to close it; a click outside or Esc does the rest.
const NEVER_OUTSIDE = '.rc-toast, .toasts, .keys-modal';   // a notice, the keys' sheet
/** What a click on it still does, once what lay over it has closed. */
export const REAL_CONTROL = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], [role="radio"]';
const TEXT = 'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]';
const stores = new WeakMap();

function storeOf(doc) {
  if (stores.has(doc)) return stores.get(doc);
  const s = { layers: [], never: NEVER_OUTSIDE }, win = doc.defaultView;
  const opened = () => s.layers.filter((l) => l.open()).sort((a, b) => b.rank - a.rank);
  const within = (l, t) => (typeof l.inside === 'string' ? !!t.closest?.(l.inside) : l.inside(t));
  const focusBack = (l) => {
    const b = l.back?.();
    const el = typeof b === 'string' ? doc.querySelector(b) : b;
    el?.focus?.({ preventScroll: true });
  };
  let pending = new Set();
  const flush = () => { const p = pending; pending = new Set(); p.forEach((fn) => fn()); };
  doc.addEventListener('click', (e) => {
    const t = e.target;
    for (const l of s.layers) if (!l.open()) l.typed = false;
    if (!t?.closest || t.closest(s.never)) return;
    const gone = [];
    for (const l of opened()) {
      if (within(l, t)) { if (l.dialog) break; continue; }   // nothing under a Dialog is touched
      if (l.dialog && l.typed) { if (!t.closest(REAL_CONTROL)) { e.stopPropagation(); e.preventDefault(); } break; }   // nothing typed is lost
      l.close(); l.typed = false; gone.push(l); pending.add(l.paint);
      if (l.dialog) break;
    }
    if (!gone.length) return;
    if (t.closest(REAL_CONTROL)) return;   // it acts as well: it paints after its own handler (below)
    e.stopPropagation(); e.preventDefault();
    flush();
    focusBack(gone[gone.length - 1]);
  }, true);
  win.addEventListener('click', flush);   // after every handler of a real control, so none of them lost its target
  doc.addEventListener('input', (e) => {
    if (!e.target?.matches?.(TEXT)) return;
    for (const l of opened()) if (l.dialog && within(l, e.target)) l.typed = true;
  }, true);
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || doc.querySelector('.keys-modal')) return;
    const l = opened()[0];
    if (!l) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (l.dialog && l.typed) return;
    if (l.esc?.()) { l.paint(); return; }   // a step before it closes: Esc ends selecting first
    const back = l.back?.();
    l.close(); l.typed = false; l.paint();
    const el = typeof back === 'string' ? doc.querySelector(back) : back;
    el?.focus?.({ preventScroll: true });
  }, true);
  stores.set(doc, s);
  return s;
}

/**
 * Esc takes back the confirm strip or short form that shows (keys.esc-strip): its own Cancel answers, so no page writes this.
 * What lies over the page goes first (the registry above stops the key); a form with something typed stays, as a Dialog does.
 */
export function watchStrips(doc) {
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || doc.querySelector('.keys-modal')) return;
    const strip = [...doc.querySelectorAll('.rc-confirm, [data-strip]')].filter((x) => x.getClientRects().length).pop(), no = strip?.querySelector('[data-confirm="no"], [data-strip-no]');   // data-strip: a question laid out as a row, its Cancel marked data-strip-no
    if (!no || [...strip.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]), textarea')].some((f) => f.value !== f.defaultValue)) return;
    e.preventDefault(); e.stopImmediatePropagation(); no.click();
  });
}

/** What else a page says closes nothing when clicked: tools that live beside the page. */
export function neverOutside(doc, selector) { const s = storeOf(doc); s.never += `, ${selector}`; }

/**
 * @param {Document} doc
 * @param {object} layer
 * @param {() => boolean} layer.open
 * @param {string|((target: Element) => boolean)} layer.inside  what counts as inside it; its own button counts, so that toggles it
 * @param {() => void} layer.close  clears its state; it does not paint
 * @param {() => void} layer.paint  draws the page again (if nothing else did)
 * @param {() => string|Element} [layer.back]  the control that opened it: the focus returns there
 * @param {number} [layer.rank]     what lies on top goes first on Esc: a menu 3, a Dialog 2, a panel 1
 * @param {boolean} [layer.dialog]  a Dialog: its scrim closes it only when nothing was typed; so does Esc
 * @param {() => boolean} [layer.esc]  a step Esc takes before it closes (true: taken)
 * @returns {() => void} removes it
 */
export function dismissOnOutside(doc, layer) {
  const s = storeOf(doc), l = { rank: 1, dialog: false, typed: false, ...layer };
  if (l.dialog && !layer.rank) l.rank = 2;
  s.layers.push(l);
  return () => { s.layers = s.layers.filter((x) => x !== l); };
}
