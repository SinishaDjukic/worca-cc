// Menus keep inside the window (docs/rail/small-rules.md › Menus): a menu opens under what opened it, and above when there
// is no room under it and more room above; taller than its room, it scrolls inside. A page draws its menus as it always did; one watcher places them all.
const GAP = 6, EDGE = 8;
const seen = new WeakSet();

/**
 * Whether a menu opens above what opened it: only when it would leave the window below and has more room above.
 * @param {{top:number, bottom:number}} anchor
 * @param {number} height  the menu's height
 * @param {number} vh      the window's height
 */
export function menuUp(anchor, height, vh) {
  const below = vh - EDGE - (anchor.bottom + GAP), above = anchor.top - GAP - EDGE;
  return height > below && above > below;
}

/** Places every pop-up menu in a document (a `.rc-pop > .menu`), now and whenever one opens. */
export function watchMenus(doc) {
  if (seen.has(doc)) return;
  seen.add(doc);
  const win = doc.defaultView;
  const place = () => {
    for (const m of doc.querySelectorAll('.rc-pop > .menu:not([data-placed])')) {
      m.dataset.placed = '';
      const a = m.parentElement.getBoundingClientRect(), h = m.getBoundingClientRect().height, vh = win.innerHeight;
      const up = menuUp(a, h, vh), room = Math.floor(up ? a.top - GAP - EDGE : vh - EDGE - a.bottom - GAP);
      if (up) m.classList.add('is-up');
      if (h > room && room > 0) { m.style.maxHeight = `${room}px`; m.style.overflowY = 'auto'; }   // no room either way: it scrolls inside
    }
  };
  place();
  if (win.MutationObserver && doc.body) new win.MutationObserver(place).observe(doc.body, { subtree: true, childList: true });
}
