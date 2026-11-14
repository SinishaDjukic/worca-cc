// Menus keep inside what shows them (docs/rail/small-rules.md › Menus): a menu opens under what opened it, and above when
// there is no room under it and more room above; it slides sideways to stay inside, and taller than its room it scrolls
// inside. "Inside" is the window and every box around it that clips (a sidebar, a scrolling list). A page draws its menus
// as it always did; one watcher places them all.
const GAP = 6, EDGE = 8;
const seen = new WeakSet();

/**
 * comp.menu-groups: where a scrolling menu must end so no group head is left alone at its fold.
 * @param {{head:number, option:number|undefined}[]} groups  each head's top and its first option's bottom
 * @param {number} bottom  the menu's bottom
 * @returns {number|null}  the top of the highest head cut off from its option; null when none is
 */
export function foldCut(groups, bottom) {
  const alone = groups.filter((g) => g.option !== undefined && g.head < bottom && g.option > bottom).map((g) => g.head);
  return alone.length ? Math.min(...alone) : null;
}

/**
 * Whether a menu opens above what opened it: only when it would leave its room below and has more room above.
 * @param {{top:number, bottom:number}} anchor
 * @param {number} height  the menu's height
 * @param {number} vh      the bottom of the room (the window's height, or a clipping box's bottom)
 * @param {number} [top]   the top of the room
 */
export function menuUp(anchor, height, vh, top = 0) {
  const below = vh - EDGE - (anchor.bottom + GAP), above = anchor.top - GAP - EDGE - top;
  return height > below && above > below;
}

/**
 * How far a menu slides sideways to stay inside its room: 0 when it fits.
 * @param {{left:number, right:number}} menu
 * @param {{left:number, right:number}} room
 */
export function menuShift(menu, room) {
  if (menu.right > room.right - EDGE) return Math.max(room.left + EDGE - menu.left, room.right - EDGE - menu.right);
  if (menu.left < room.left + EDGE) return room.left + EDGE - menu.left;
  return 0;
}

// the room a menu has: the window, cut by every ancestor that clips its overflow
function roomOf(m, win) {
  const r = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
  for (let e = m.parentElement?.parentElement; e && e !== m.ownerDocument.body; e = e.parentElement) {
    const cs = win.getComputedStyle(e);
    if (!/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)) continue;
    const b = e.getBoundingClientRect();
    r.left = Math.max(r.left, b.left); r.top = Math.max(r.top, b.top); r.right = Math.min(r.right, b.right); r.bottom = Math.min(r.bottom, b.bottom);
  }
  return r;
}

/** Places every pop-up menu in a document (any `.menu` that floats: a ⋯, a picker, a list's own), now and whenever one opens. */
export function watchMenus(doc) {
  if (seen.has(doc)) return;
  seen.add(doc);
  const win = doc.defaultView;
  // comp.menu-off: a disabled item never acts, in any menu; it stays open and the page is told why
  win.addEventListener('click', (e) => {
    const off = e.target.closest?.('.menu-item[aria-disabled="true"]'); if (!off) return;
    e.stopImmediatePropagation(); e.preventDefault();
    doc.dispatchEvent(new win.CustomEvent('rail:disabled', { detail: { why: off.title } }));
  }, true);
  const place = () => {
    for (const m of doc.querySelectorAll('.menu:is([role="menu"], [role="dialog"]):not([data-placed])')) {
      m.dataset.placed = '';
      if (win.getComputedStyle(m).position !== 'absolute') continue;   // a menu in the flow (a panel's own list) is not a pop-up
      const a = m.parentElement.getBoundingClientRect(), room = roomOf(m, win);
      if (m.matches('.is-two-cols')) m.style.maxHeight = `${Math.max(room.bottom - EDGE - a.bottom - GAP, a.top - GAP - EDGE - room.top, m.clientHeight)}px`;   // comp.menu-groups: a grouped menu takes the free height before it scrolls
      const h = m.getBoundingClientRect().height;
      const up = menuUp(a, h, room.bottom, room.top), space = Math.floor(up ? a.top - GAP - EDGE - room.top : room.bottom - EDGE - a.bottom - GAP);
      if (up) { m.classList.add('is-up'); m.style.top = 'auto'; m.style.bottom = `calc(100% + ${GAP}px)`; }
      if (h > space && space > 0) { m.style.maxHeight = `${space}px`; m.style.overflowY = 'auto'; }   // no room either way: it scrolls inside
      const dx = menuShift(m.getBoundingClientRect(), room);
      if (dx) m.style.translate = `${Math.round(dx)}px 0`;
      for (let i = 0; i < 3 && m.scrollHeight > m.clientHeight; i++) {
        const r = m.getBoundingClientRect(), cut = foldCut([...m.querySelectorAll('.menu-h')].map((x) => ({ head: x.getBoundingClientRect().top, option: x.nextElementSibling?.getBoundingClientRect().bottom })), r.bottom);
        if (cut === null || cut <= r.top) break;
        m.style.maxHeight = `${Math.floor(cut - r.top)}px`;
      }
    }
  };
  place();
  if (win.MutationObserver && doc.body) new win.MutationObserver(place).observe(doc.body, { subtree: true, childList: true });
}
