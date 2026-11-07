// Tooltip (docs/rail/small-rules.md): help lives in tooltips, so they appear quickly and read well: on hover, on keyboard
// focus, and on a long-press on touch. A page keeps writing `title`; this draws it, and the browser's own never shows.
const SHOW_MS = 180, TOUCH_MS = 450, TOUCH_STAY_MS = 1800, GAP = 6, EDGE = 8;
const seen = new WeakSet();

/** Where a tip goes: under its anchor, above when there is no room, always inside the window. */
export function tipPlace(anchor, tip, vw, vh) {
  const below = anchor.bottom + GAP + tip.height <= vh - EDGE;
  const top = below ? anchor.bottom + GAP : Math.max(EDGE, anchor.top - GAP - tip.height);
  const left = Math.max(EDGE, Math.min(vw - EDGE - tip.width, anchor.left + anchor.width / 2 - tip.width / 2));
  return { top, left };
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
    tip = doc.createElement('div'); tip.className = 'rail-tip'; tip.setAttribute('role', 'tooltip'); tip.textContent = el.dataset.tipText;
    doc.body.append(tip);
    const at = tipPlace(el.getBoundingClientRect(), tip.getBoundingClientRect(), win.innerWidth, win.innerHeight);
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
