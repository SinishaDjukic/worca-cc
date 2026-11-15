// StillhetSwitch (docs/rail/navigation.md `nav.design-switch`): Stillhet's one top-bar icon. Its tip names the new UI in beta;
// a click opens a 2-row menu, "Try Stillhet" and "Back to today's UI", the current UI checked. Locked by WORCA_FLAGS, the tip,
// the name and both rows say why. The watch is the one open/pick/busy/restore flow every host shares; the host's `pick`
// makes the call and says a failure.
import { button } from './button.mjs';
import { icon } from './icons.mjs';
import { compactMenu } from './compact-menu.mjs';
import { dismissOnOutside } from './dismiss.mjs';

export const STILLHET_NAME = 'Stillhet UI · beta';
export const STILLHET_TIP = "Stillhet, Worca's new calmer UI · beta";
export const STILLHET_LOCKED = 'Locked by WORCA_FLAGS';
export const STILLHET_ITEMS = [{ id: 'on', text: 'Try Stillhet' }, { id: 'off', text: "Back to today's UI" }];

const SLOT = '[data-stillhet="design-switch"]';
const ICON = '[data-design-switch]';

/**
 * @param {object} [o]
 * @param {boolean} [o.on]      Stillhet is the current UI
 * @param {boolean} [o.locked]  WORCA_FLAGS fixes the flag
 * @param {boolean} [o.busy]    a pick's call is out
 * @param {boolean} [o.open]    its menu shows
 */
export function stillhetSwitch({ on = false, locked = false, busy = false, open = false } = {}) {
  const shown = open && !busy;
  const ic = button({
    label: locked ? `${STILLHET_NAME} · ${STILLHET_LOCKED}` : STILLHET_NAME, kind: 'quiet', iconOnly: true, icon: icon('stillhet-ui', 20), cls: 'topnav-act',
    title: locked ? `${STILLHET_TIP} · ${STILLHET_LOCKED}` : STILLHET_TIP,
    attrs: { 'data-stillhet': 'ui-icon', 'data-design-switch': '', 'aria-haspopup': 'menu', 'aria-expanded': String(shown), 'aria-busy': busy ? 'true' : null, 'aria-disabled': busy ? 'true' : null },
  });
  const menu = shown ? compactMenu({
    items: STILLHET_ITEMS.map((it) => ({ ...it, checked: (it.id === 'on') === on, off: locked, help: locked ? STILLHET_LOCKED : undefined })),
    label: STILLHET_NAME, pickAttr: 'data-design-pick',
  }) : '';
  return `<span data-stillhet="design-switch" data-on="${on}" data-locked="${locked}"><span class="rc-pop is-right">${ic}${menu}</span></span>`;
}

const watches = new WeakMap();   // document → its disposer

/**
 * The shared behaviour: a click on the icon toggles the menu, a pick of the other UI goes busy and calls `pick`, then shows
 * the outcome (moved, or as it was). Esc and a click outside close the menu. No toast: the caller's `pick` says a failure.
 * Once per document: a second call returns the first disposer, and the first call's `pick` and `current` stay in force.
 * @param {Document} doc
 * @param {object} o
 * @param {(choice: 'on'|'off') => Promise<{ok:boolean}>|{ok:boolean}} o.pick
 * @param {() => boolean} [o.current]  the live flag, read at each click; the flag can move elsewhere (Settings › Labs, another
 *   tab) after the slot was painted. Without it the slot's painted `data-on` decides.
 * @returns {() => void} removes it
 */
export function watchStillhetSwitch(doc, { pick, current }) {
  if (watches.has(doc)) return watches.get(doc);
  const slot = () => doc.querySelector(SLOT);
  const iconOf = () => doc.querySelector(`${SLOT} ${ICON}`);
  const stateOf = (s) => ({ on: typeof current === 'function' ? !!current() : s.dataset.on === 'true', locked: s.dataset.locked === 'true', open: !!s.querySelector('.menu') });
  const paint = (o) => { const s = slot(); if (s) s.outerHTML = stillhetSwitch({ ...stateOf(s), ...o }); };
  const focusIcon = () => iconOf()?.focus?.({ preventScroll: true });

  const onClick = (e) => {
    const t = e.target, s = t?.closest?.(SLOT);
    if (!s || s !== slot()) return;   // the mounted slot only: the one every repaint reads
    const row = t.closest('[data-design-pick]');
    if (row) {
      if (row.getAttribute('aria-disabled') === 'true') return;
      const { on } = stateOf(s), choice = row.dataset.designPick;
      if ((choice === 'on') === on) { paint({ open: false }); focusIcon(); return; }
      paint({ open: false, busy: true });
      focusIcon();
      const done = (r) => {
        const ok = !!(r && r.ok);
        if (!slot()) return;
        const hadFocus = !!doc.activeElement?.closest?.(SLOT);
        paint({ on: ok ? choice === 'on' : on, open: false, busy: false });
        if (hadFocus) focusIcon();
      };
      let r;
      try { r = pick(choice); } catch { done(null); return; }
      if (r && typeof r.then === 'function') r.then(done, () => done(null)); else done(r);
      return;
    }
    const b = t.closest(ICON);
    if (!b || b.getAttribute('aria-busy') === 'true') return;
    const open = stateOf(s).open;
    paint({ open: !open });
    focusIcon();
  };
  doc.addEventListener('click', onClick);
  const undo = dismissOnOutside(doc, { rank: 3, open: () => { const s = slot(); return !!s && stateOf(s).open; }, inside: SLOT, close: () => {}, paint: () => paint({ open: false }), back: () => `${SLOT} ${ICON}` });   // a selector: read after the repaint
  const stop = () => { doc.removeEventListener('click', onClick); undo(); watches.delete(doc); };
  watches.set(doc, stop);
  return stop;
}
