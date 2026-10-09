// ui/public/side-flyout.mjs — one controller for every popup that hangs off the sidebar: the
// Nodes flyout, the rail's Running actions, and the account menu with its Interface mode side
// menu; and for the top bar's Activity popover, which opens down. Pure DOM: no app state and no
// look of its own — style.css owns how a popup looks, this module owns where it goes, when it
// opens and closes, and the keyboard.
//
// A popup opens on a click, never on hover, and a second click on its trigger closes it. A close the
// pointer makes (that second click, a click outside, a click on a route inside) lets go of focus, so
// the trigger is not left focused; a close the keyboard makes hands focus back to the trigger.
//
// Every open popup of a document sits on one stack. Escape closes the newest one (a submenu
// before the menu it hangs from) and stops there; opening a popup closes every open popup that
// is not its parent; closing a menu closes its submenus first. A key typed in a popup stays in
// it, and focus leaving a popup (Tab away) closes it.

const stacks = new WeakMap();   // document -> { list: entries, newest last }

function stackOf(doc) {
  let st = stacks.get(doc);
  if (st) return st;
  st = { list: [] };
  stacks.set(doc, st);
  // Capture phase on the document, added by the first createFlyout — app.js creates its popups
  // before any page-level handler exists, so this listener runs first. A consumed Escape stops
  // there: preventDefault, and stopImmediatePropagation so no later handler acts on the same key
  // (a run's Details would step back, a wizard would close, the phone drawer would close). Focus
  // goes back to the trigger only when it was in the popup, on its trigger or nowhere.
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    for (let i = st.list.length - 1; i >= 0; i--) {
      const entry = st.list[i];
      if (entry.menu.hidden) { st.list.splice(i, 1); continue; }   // hidden by someone else
      e.preventDefault();
      e.stopImmediatePropagation();
      const a = doc.activeElement;
      entry.close({ refocus: !a || a === doc.body || entry.trigger.contains(a) });
      return;
    }
  }, true);
  return st;
}

/** Position a fixed popup next to its trigger, clamped to the viewport (margin px from every edge).
 *  mode 'side'  : left = right edge of the closest `.sidebar` (or the trigger) + gap; top = trigger.top - 30
 *  mode 'up'    : left = trigger.left; top = trigger.top - menu height - gap (opens upward)
 *  mode 'beside': left = parent.right + 4, or parent.left - width - 4 when there is no room; top = trigger.top - 5
 *  mode 'down'  : left = trigger.right - menu width (right edges aligned); top = trigger.bottom + gap (opens downward)
 *  Writes menu.style.left/top in px; un-hides the menu first so it can be measured. */
export function placeFlyout(menu, trigger, { mode = 'side', parent = null, win = globalThis.window, gap = 6, margin = 8 } = {}) {
  menu.hidden = false;
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  const vw = win.innerWidth;
  const vh = win.innerHeight;
  const t = trigger.getBoundingClientRect();
  let left;
  let top;
  if (mode === 'up') {
    left = t.left;
    top = t.top - h - gap;
  } else if (mode === 'down') {
    left = t.right - w;
    top = t.bottom + gap;
  } else if (mode === 'beside') {
    const p = (parent || trigger).getBoundingClientRect();
    left = p.right + 4;
    if (left + w > vw - margin) left = p.left - w - 4;   // no room on the right: open to the left
    top = t.top - 5;
  } else {
    const side = trigger.closest('.sidebar') || trigger;
    left = side.getBoundingClientRect().right + gap;
    top = t.top - 30;                                     // the popup's own heading sits beside the row above
  }
  left = Math.max(margin, Math.min(left, vw - w - margin));
  top = Math.max(margin, Math.min(top, vh - h - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/** One popup bound to one trigger. Opens on a click (never on hover), closes on: a second click on the
 *  trigger, Escape (refocus trigger), a click outside (trigger, menu and inside(target) count as inside),
 *  focus leaving it (from the same three, or an open submenu, to anywhere else; not during a press on the
 *  popup), window resize, `closeOn` element scroll, and a click on any `[data-nav]` inside the menu.
 *  A pointer close (e.detail > 0) blurs the trigger or the item that held focus instead of refocusing the
 *  trigger; a keyboard close (e.detail === 0, Escape) refocuses the trigger when focus was in the popup.
 *  ArrowDown/ArrowUp/Home/End move focus among visible `[role^="menuitem"]` items; no other key typed in the
 *  menu reaches the page (Escape, Tab and shortcuts with Ctrl, Meta or Alt do, but never with an arrow,
 *  Home, End, Page Up/Down, Delete, Backspace, Space or Enter).
 *  Keeps `aria-expanded` on the trigger in sync. Keyboard open (click with e.detail === 0, Enter/Space) focuses
 *  the first item (or `[aria-checked="true"]` when present, unless `focusChecked` is false). */
export function createFlyout({
  doc = globalThis.document, win = globalThis.window,
  trigger, menu,
  mode = 'side', parent = null,
  closeOn = null,
  focusChecked = true,
  inside = () => false,
  onOpen = () => {}, onClose = () => {},
} = {}) {
  const st = stackOf(doc);
  const entry = { menu, parent, trigger, close: (o) => close(o) };

  const isOpen = () => !menu.hidden;
  const shown = (el) => !el.hidden && !el.closest('[hidden]') && win.getComputedStyle(el).display !== 'none';
  const items = () => [...menu.querySelectorAll('[role^="menuitem"]')].filter(shown);
  /** True when `t` is inside one of this popup's open submenus (at any depth). */
  const inSubmenu = (m, t) => st.list.some((x) => x.parent === m && (x.menu.contains(t) || inSubmenu(x.menu, t)));

  function open({ focus = false } = {}) {
    if (!isOpen()) {
      const keep = new Set([entry]);
      for (let p = parent; p;) {
        const up = st.list.find((x) => x.menu === p);
        if (!up) break;
        keep.add(up);
        p = up.parent;
      }
      for (const other of [...st.list]) if (!keep.has(other)) other.close();
      placeFlyout(menu, trigger, { mode, parent, win });
      trigger.setAttribute('aria-expanded', 'true');
      st.list.push(entry);
      onOpen();
    }
    if (focus) {
      const list = items();
      ((focusChecked && list.find((el) => el.getAttribute('aria-checked') === 'true')) || list[0])?.focus();
    }
  }

  function close({ refocus = false, blur = false } = {}) {
    for (const sub of st.list.filter((x) => x.parent === menu)) sub.close({ blur });
    const i = st.list.indexOf(entry);
    if (i >= 0) st.list.splice(i, 1);
    trigger.setAttribute('aria-expanded', 'false');
    if (!isOpen()) return;
    // A pointer close lets go of focus: neither the trigger nor a hidden item keeps it.
    const a = doc.activeElement;
    if (blur && a && (trigger.contains(a) || menu.contains(a))) a.blur();
    // Focus inside a popup that hides would fall to <body>: hand it back to the trigger.
    const hadFocus = menu.contains(doc.activeElement);
    menu.hidden = true;
    onClose();
    if (refocus || hadFocus) trigger.focus();
  }

  const toggle = () => (isOpen() ? close() : open());
  const reposition = () => { if (isOpen()) placeFlyout(menu, trigger, { mode, parent, win }); };

  trigger.addEventListener('click', (e) => {
    const byKey = e.detail === 0;                         // Enter / Space on a button
    if (!isOpen()) open({ focus: byKey });
    else close(byKey ? { refocus: true } : { blur: true });
  });
  menu.addEventListener('keydown', (e) => {
    // A key typed in the popup is the popup's: no page-level handler may act on it too (the Workflow
    // Composer moves its selected node on the arrows, with or without a modifier, deletes it on Delete
    // or Backspace and swallows Space). Escape (the stack's), Tab (focus leaves) and other shortcuts
    // held with Ctrl, Meta or Alt (Ctrl+K, Ctrl+`) still pass.
    const own = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
      'Delete', 'Backspace', ' ', 'Enter'].includes(e.key);
    if (own || (e.key !== 'Escape' && e.key !== 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey)) e.stopPropagation();
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const list = items();
    if (!list.length) return;
    const i = list.indexOf(doc.activeElement);
    const next = e.key === 'Home' ? list[0]
      : e.key === 'End' ? list[list.length - 1]
        : e.key === 'ArrowDown' ? list[(i + 1) % list.length]
          : list[i <= 0 ? list.length - 1 : i - 1];
    e.preventDefault();
    next.focus();
  });
  doc.addEventListener('click', (e) => {
    if (!isOpen()) return;
    const t = e.target;
    if (!t || !t.isConnected) return;                     // re-rendered under the click: cannot tell
    const how = e.detail === 0 ? {} : { blur: true };    // a pointer click lets go of focus
    if (menu.contains(t)) { if (t.closest('[data-nav]')) close(how); return; }
    if (trigger.contains(t) || inside(t) || inSubmenu(menu, t)) return;
    close(how);
  });
  // Focus leaving the popup (Tab away, a shortcut opening a pane) closes it, so a popup never lingers
  // over the page and takes the Escape meant for where focus went. Only focus that LEAVES counts: it
  // comes from the popup, its trigger, inside() or an open submenu. Focus put back on a re-rendered
  // control (it comes from nowhere), moving between two places outside, or moved by another component
  // during a press on the popup (the Ask sheet closes on any press outside itself and hands focus back)
  // leaves it open. `focusin`, not `focusout`: a row re-rendered under focus inside must not close it.
  // The press is read on the window in the capture phase, before any document listener acts on it; a
  // right-click's context menu takes the mouseup on macOS and Linux, so `contextmenu` ends the press too.
  let press = null;   // the target of the pointer press in progress
  win.addEventListener('pointerdown', (e) => { press = e.target; }, true);
  win.addEventListener('pointerup', () => { press = null; }, true);
  win.addEventListener('pointercancel', () => { press = null; }, true);
  win.addEventListener('contextmenu', () => { press = null; }, true);
  const ours = (n) => !!n && (menu.contains(n) || trigger.contains(n) || inside(n) || inSubmenu(menu, n));
  doc.addEventListener('focusin', (e) => {
    if (!isOpen() || ours(e.target) || !ours(e.relatedTarget) || ours(press)) return;
    close();
  });
  win.addEventListener('resize', () => close());
  closeOn?.addEventListener('scroll', () => close(), { passive: true });

  return { open, close, toggle, isOpen, reposition };
}
