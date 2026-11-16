// An open control across a redraw (docs/stillhet/components.md `comp.keep-open`): a menu, inline field or dialog whose control
// is marked data-keep="KEY" keeps its value, caret, selection and focus when a draw rewrites its markup. Once per
// document: it remembers each marked control the user focused or typed into, and when a draw removes that element it moves
// what the user had onto the new element with the same key, in the observer's microtask, before the browser paints.
// A route change carries nothing; a key that no longer exists after a draw is forgotten, so a reopen starts empty.
// The route is the place and its item (#place/item, the item without its '@…' way in), as the pages read it: a side
// panel opened after them (#chat/ask_1/run/run-a/logs) is the same route. What the page means wins: a control whose drawn
// value changed (the page set a new one) takes the page's value; a page clears a kept field in place before it redraws.
const watched = new WeakSet();

/** The route a kept control belongs to: the place and its item, the item without its '@…' way in (`#chat/ask_1/run/run-a` → `#chat/ask_1`). */
export const keptRoute = (h) => String(h || '').split('/').slice(0, 2).map((s) => s.split('@')[0]).join('/');

export function watchKeepOpen(doc) {
  if (!doc || watched.has(doc)) return;
  watched.add(doc);
  const win = doc.defaultView;
  const kept = new Map();   // KEY -> { el, hash }
  let focused = null;       // the KEY that held the focus last, until a control without one takes it
  const hash = () => keptRoute(win.location.hash);
  const remember = (e) => {
    const el = e.target?.closest?.('[data-keep]');
    if (!el) { if (e.type === 'focusin') focused = null; return; }
    const key = el.getAttribute('data-keep'), was = kept.get(key);
    if (was && was.el !== el && !was.el.isConnected) carryOne(key, was);   // the page refocused the new one first: carry before re-pointing
    kept.set(key, { el, hash: hash() });
    if (e.type === 'focusin') focused = key;
  };
  doc.addEventListener('focusin', remember, true);
  doc.addEventListener('input', remember, true);
  // a real blur, not a removal: Chrome blurs a node a draw removes while it is still attached, other browsers do not blur
  // it at all; so the blur is judged after the draw: a field still attached and not focused again was really left
  doc.addEventListener('focusout', (e) => {
    const el = e.target?.closest?.('[data-keep]');
    if (!el) return;
    const key = el.getAttribute('data-keep');
    win.queueMicrotask(() => { if (el.isConnected && focused === key && doc.activeElement !== el) focused = null; });
  }, true);
  const find = (key) => {
    const q = win.CSS?.escape ? win.CSS.escape(key) : key.replace(/["\\]/g, '\\$&');
    return doc.querySelector(`[data-keep="${q}"]`);
  };
  // moves what the user had in the removed control onto the one drawn in its place, or forgets the key
  function carryOne(key, k) {
    const next = find(key);
    if (!next || hash() !== k.hash) { kept.delete(key); if (focused === key) focused = null; return; }
    const old = k.el; k.el = next;
    if ('value' in next && 'value' in old) {
      if (next.defaultValue === old.defaultValue) next.value = old.value;   // a new drawn value is the page's: it wins
      if (next.value === old.value) try {
        const end = next.value.length, at = (n) => Math.min(n ?? end, end);
        next.setSelectionRange(at(old.selectionStart), at(old.selectionEnd), old.selectionDirection || 'none');
      } catch { /* a control without a text selection */ }
    }
    if (focused === key && doc.activeElement !== next) next.focus({ preventScroll: true });
  }
  const carry = () => { for (const [key, k] of kept) if (!k.el.isConnected) carryOne(key, k); };
  new win.MutationObserver(() => { if (kept.size) carry(); }).observe(doc.documentElement, { childList: true, subtree: true });
}

// ---- The focus is never dropped to the page (docs/stillhet/keyboard.md): a draw that replaces the control that had the
// focus gives it to the control drawn in its place (a switch after Space, a radio after an arrow key); when that control
// is gone, to what opened it: a menu's item to its trigger, a dialog's control to the dialog's opener.
const VOLATILE = /^data-(placed|motion|tip-text|tip|flash|lifted)$/;
const quoted = (v) => String(v).replace(/["\\]/g, '\\$&');

/**
 * Where a control is, in words a later draw can find again: `{ sel, n }`, the n-th match of a selector. Its `data-key`
 * first, then its id, its own data-* hooks, its role and name, its place in a named radio group. null: nothing names it.
 * @param {Element|null} el
 * @returns {{sel: string, n: number}|null}
 */
export function controlAddress(el) {
  if (!el?.getAttribute || !el.ownerDocument || el === el.ownerDocument.body) return null;
  const one = (sel) => ({ sel, n: 0 });
  for (const a of ['data-key', 'data-keep']) if (el.getAttribute(a)) return one(`[${a}="${quoted(el.getAttribute(a))}"]`);
  if (el.id) return one(`[id="${quoted(el.id)}"]`);
  const data = [...el.attributes].filter((a) => a.name.startsWith('data-') && !VOLATILE.test(a.name));
  if (data.length) return one(data.map((a) => `[${a.name}="${quoted(a.value)}"]`).join(''));
  const role = el.getAttribute('role'), label = el.getAttribute('aria-label');
  if (role && label) return one(`[role="${role}"][aria-label="${quoted(label)}"]`);
  const group = el.closest('[role="radiogroup"][aria-label], [role="menu"][aria-label], [role="group"][aria-label]');
  if (group) {
    const sel = `[role="${group.getAttribute('role')}"][aria-label="${quoted(group.getAttribute('aria-label'))}"] ${el.tagName.toLowerCase()}`;
    return { sel, n: [...group.querySelectorAll(el.tagName.toLowerCase())].indexOf(el) };
  }
  return null;
}

/** The control an address names in a document now, or null. */
export const atAddress = (doc, addr) => (addr ? doc.querySelectorAll(addr.sel)[addr.n] || null : null);

/** What opened the menu a control sits in: the expanded trigger beside the menu, else the page's one expanded trigger. */
export function triggerOf(el) {
  const menu = el?.closest?.('.menu'); if (!menu) return null;
  const near = menu.parentElement?.querySelector('[aria-haspopup][aria-expanded="true"]');
  if (near && !menu.contains(near)) return near;
  const all = [...el.ownerDocument.querySelectorAll('[aria-haspopup][aria-expanded="true"]')].filter((t) => !menu.contains(t));
  return all[all.length - 1] || null;
}

const FOCUS_BACK_MS = 1500;   // a draw this long after the focus was lost is no longer its answer
const backs = new WeakMap();

/**
 * Keeps the focus across every draw of a document. Returns the two hooks a Dialog reports through.
 * @param {Document} doc
 * @returns {{opened: () => void, closed: () => void}}
 */
export function watchFocusBack(doc) {
  if (backs.has(doc)) return backs.get(doc);
  const win = doc.defaultView;
  let last = null;      // { el, addr, back, home }: the control that had the focus last, what opened it, and the thing it sat in
  let opener = null;    // the address of what opened the dialog that is up
  let before = null;   // what had the focus just before it went into a dialog
  let openerBack = null, dismissedAt = 0;   // the opener's own trigger (a menu's); when a dialog was last closed without its step
  // on the window: before any layer that answers the key and stops it
  win.addEventListener('keydown', (e) => { if (e.key === 'Escape' && doc.querySelector('.viewer-modal')) dismissedAt = Date.now(); }, true);
  win.addEventListener('click', (e) => { if (e.target.closest?.('.viewer-modal [data-dialog="cancel"], .viewer-modal [data-dialog="close"]')) dismissedAt = Date.now(); }, true);
  let lostAt = 0;
  const lost = () => !doc.activeElement || doc.activeElement === doc.body;
  doc.addEventListener('focusin', (e) => {
    const el = e.target; if (!el || el === doc.body) return;
    const inDialog = !!el.closest?.('.viewer-modal');
    // home: the card, row or section the control sat in. When the control leaves with its step done (Answer, Approve) and
    // nothing is drawn in its place, the focus stays with that thing: on its first control, else on the thing itself
    const homes = [];
    for (let box = el.parentElement?.closest?.('[data-anchor], [data-key], [id]'); box && box !== doc.body && homes.length < 5; box = box.parentElement?.closest?.('[data-anchor], [data-key], [id]')) homes.push(box.getAttribute('data-anchor') ? { sel: `[data-anchor="${quoted(box.getAttribute('data-anchor'))}"]`, n: 0 } : controlAddress(box));
    // a page that puts the focus into its dialog as it draws it: what had the focus before is what opened it
    if (inDialog && last && !last.el.closest?.('.viewer-modal')) before = { addr: last.addr, back: last.back };
    last = { el, addr: controlAddress(el), back: controlAddress(triggerOf(el)) || (inDialog ? opener : null), homes };
    lostAt = 0;
  }, true);
  const restore = () => {
    if (!last || last.el.isConnected || !lost()) return;
    const now = Date.now(); lostAt ||= now;
    if (now - lostAt > FOCUS_BACK_MS) { last = null; return; }
    let to = atAddress(doc, last.addr) || atAddress(doc, last.back);
    if (!to || to.disabled) {
      const home = (last.homes || []).map((h) => atAddress(doc, h)).find((x) => x && x.getClientRects().length);
      to = home && ([...home.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')].find((x) => !x.closest('[hidden]') && x.getAttribute('aria-hidden') !== 'true') || home);
      if (to === home && home && !home.hasAttribute('tabindex')) home.setAttribute('tabindex', '-1');
    }
    if (to && !to.disabled) to.focus({ preventScroll: true });
  };
  if (win.MutationObserver && doc.body) new win.MutationObserver(restore).observe(doc.body, { subtree: true, childList: true });
  const hooks = {
    // what opened it, and when that was a menu's item (gone with its menu), the control that opened the menu: "More › New
    // schedule form…" gives the focus back to More
    opened: () => { const inside = !!doc.activeElement?.closest?.('.viewer-modal'), own = last && (last.el.isConnected || lost()); if (inside && before) { opener = before.addr; openerBack = before.back; } else { opener = own ? last.addr : controlAddress(doc.activeElement); openerBack = own ? last.back : null; } before = null; },
    // closed without its step (Esc, Cancel, Close): the focus goes back to what opened it, wherever a draw has put it since;
    // closed by its step, only when the focus was dropped (the page may have moved on)
    closed: () => { const seen = (x) => (x && x.getClientRects().length ? x : null), to = seen(atAddress(doc, opener)) || seen(atAddress(doc, openerBack)); const force = Date.now() - dismissedAt < 600; opener = null; openerBack = null; if (to && (lost() || force) && doc.activeElement !== to) to.focus({ preventScroll: true }); },
  };
  backs.set(doc, hooks);
  return hooks;
}
