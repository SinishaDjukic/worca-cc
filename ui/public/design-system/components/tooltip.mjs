// Tooltip (docs/stillhet/small-rules.md): help lives in tooltips, so they appear quickly and read well: on hover, on keyboard
// focus, and on a long-press on touch. A page keeps writing `title`; this draws it, and the browser's own never shows.
const SHOW_MS = 180, TOUCH_MS = 450, TOUCH_STAY_MS = 1800, GAP = 6, EDGE = 8;
const seen = new WeakSet();

/**
 * Where a tip goes: under its anchor, above when there is no room, always inside the window. With `beside` (what is open
 * around a menu's item) it goes to that box's right, else its left, level with the item, so it covers no other option;
 * with no room on either side it goes above the box, else under it. It never covers its anchor or, beside a menu, the
 * menu: with no free room, that wins over staying inside the window (small.one-tooltip), so it then takes the side of
 * its anchor with more room.
 */
export function tipPlace(anchor, tip, vw, vh, beside = null) {
  const aRight = anchor.right ?? anchor.left + anchor.width;
  const level = Math.max(EDGE, Math.min(vh - EDGE - tip.height, anchor.top));
  const centred = Math.max(EDGE, Math.min(vw - EDGE - tip.width, anchor.left + (aRight - anchor.left) / 2 - tip.width / 2));
  if (beside) {
    const right = beside.right + GAP, left = beside.left - GAP - tip.width;
    if (right + tip.width <= vw - EDGE) return { top: level, left: right };
    if (left >= EDGE) return { top: level, left };
    const boxTop = Math.min(beside.top ?? anchor.top, anchor.top), boxBottom = Math.max(beside.bottom ?? anchor.bottom, anchor.bottom);
    const above = boxTop - GAP - tip.height;
    return { top: above >= EDGE ? above : boxBottom + GAP, left: centred };
  }
  if (anchor.bottom + GAP + tip.height <= vh - EDGE) return { top: anchor.bottom + GAP, left: centred };
  if (anchor.top - GAP - tip.height >= EDGE) return { top: anchor.top - GAP - tip.height, left: centred };
  return { top: level, left: vw - aRight >= anchor.left ? aRight + GAP : anchor.left - GAP - tip.width };
}

const CONTROL = 'button, a[href], input, select, textarea, ' + ['button', 'menuitem', 'menuitemradio', 'tab', 'switch', 'option', 'checkbox', 'link'].map((r) => `[role=${r}]`).join(', ');

/**
 * Controls that carry more than one tip (small.one-tooltip), in document order. `sources` names each: its own `title`
 * (or the watcher's `data-tip-text`), a titled wrapper it alone fills (`wrapper-title`), a titled child (`child-title`),
 * an `aria-describedby` tooltip (`describedby`), a `data-tip`. Pure: it reads and changes nothing.
 * @param {Element} root
 * @returns {Array<{ el: Element, sources: string[] }>}
 */
export function doubleTips(root) {
  const doc = root.ownerDocument || root;
  const has = (el, a) => !!el.getAttribute(a);
  // a root not in its document (a fragment, a drawn but unattached part) is searched itself
  const byId = (id) => doc.getElementById?.(id) || (root.id === id ? root : [...root.querySelectorAll('[id]')].find((n) => n.id === id));
  const out = [];
  for (const el of [root, ...root.querySelectorAll(CONTROL)]) {
    if (!el.matches?.(CONTROL)) continue;
    const sources = [];
    if (has(el, 'title') || has(el, 'data-tip-text')) sources.push('title');
    const up = el.parentElement;
    if (up && has(up, 'title') && up.children.length === 1) sources.push('wrapper-title');
    if ([...el.querySelectorAll('[title]')].some((c) => has(c, 'title'))) sources.push('child-title');
    if ((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).some((id) => byId(id)?.matches('[role="tooltip"], .stillhet-tip'))) sources.push('describedby');
    if (el.hasAttribute('data-tip')) sources.push('data-tip');
    if (sources.length >= 2) out.push({ el, sources });
  }
  return out;
}

/** Draws every `title` in a document as a Tooltip, from now on. */
export function watchTooltips(doc) {
  if (seen.has(doc)) return;
  seen.add(doc);
  const win = doc.defaultView;
  let el = null, tip = null, timer = 0;
  const give = () => { if (el && el.dataset.tipText !== undefined) { el.setAttribute('title', el.dataset.tipText); delete el.dataset.tipText; } };
  let watch = 0;
  const hide = () => { win.clearTimeout(timer); win.clearInterval(watch); tip?.remove(); tip = null; give(); el = null; };
  const show = () => {
    if (!el?.isConnected || !el.dataset.tipText) { hide(); return; }
    // a menu open over the page owns the moment: nothing outside it shows a tooltip, its own trigger least of all (it would cover the first item)
    if (doc.querySelector('[role="menu"]') && !el.closest('[role="menu"]')) { hide(); return; }
    if (el.closest('[aria-expanded="true"]')) { hide(); return; }   // a trigger whose own popup is open (Pulse, a picker): the popup speaks for it
    tip = doc.createElement('div'); tip.className = 'stillhet-tip'; tip.setAttribute('role', 'tooltip'); tip.textContent = el.dataset.tipText;
    doc.body.append(tip);
    // a menu's item: past every menu open beside it (the profile menu and its side menu), never over the next option
    const boxes = el.closest('[role="menu"]') ? [...doc.querySelectorAll('[role="menu"]')].map((m) => m.getBoundingClientRect()).filter((b) => b.width) : [];
    const beside = boxes.length ? { left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)),
      top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) } : null;
    const at = tipPlace(el.getBoundingClientRect(), tip.getBoundingClientRect(), win.innerWidth, win.innerHeight, beside);
    tip.style.top = `${at.top}px`; tip.style.left = `${at.left}px`;
    watch = win.setInterval(() => { if (!el?.isConnected) hide(); }, 250);   // what it belongs to was drawn away
  };
  const start = (target, wait) => {
    const next = target?.closest?.('[title]');
    if (next === el && next) return;
    hide();
    if (!next || !next.getAttribute('title')) return;
    el = next; el.dataset.tipText = el.getAttribute('title'); el.removeAttribute('title');
    timer = win.setTimeout(show, wait);
  };
  doc.addEventListener('pointerover', (e) => { if (e.pointerType !== 'touch') { if (el && el.contains(e.target)) return; start(e.target, SHOW_MS); } });
  doc.addEventListener('focusin', (e) => { if (e.target.matches?.(':focus-visible')) start(e.target, SHOW_MS); });
  doc.addEventListener('focusout', hide);
  doc.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') start(e.target, TOUCH_MS); else hide(); });
  doc.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') return; if (tip) { win.clearTimeout(timer); timer = win.setTimeout(hide, TOUCH_STAY_MS); } else hide(); });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  doc.addEventListener('scroll', hide, { capture: true, passive: true });
}
