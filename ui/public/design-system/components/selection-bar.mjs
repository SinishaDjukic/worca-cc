// The selection's parts (docs/rail/lists.md): the bar at a list's foot, the Select all box in its head, and the touch
// long-press that starts selecting. The logic is selection.mjs.
import { attrs } from './html.mjs';
import { button } from './button.mjs';
import { checkbox } from './checkbox.mjs';
import { PRESS_MS } from './selection.mjs';

/**
 * SelectionBar: `2 selected · Archive 2 · Cancel`. Each action shows how many it applies to and is disabled at 0.
 * Clicks arrive as data-bulk: the action's id, or `cancel`.
 * @param {object} o
 * @param {string} o.label      the toolbar's name for a screen reader ("Selected updates")
 * @param {number} o.count      how many are selected
 * @param {{id:string, label:string, n:number, tip:string, why?:string}[]} o.actions  `why`: disabled with some selected
 * @param {string} [o.cancel]   Cancel's tooltip
 */
export function selectionBar({ label, count, actions = [], cancel = 'Stop selecting · Esc' }) {
  const act = (a) => button({ label: a.label, count: a.n, title: a.n ? a.tip : count ? a.why : 'Nothing selected', attrs: { 'data-bulk': a.id, disabled: !a.n } });
  return `<div class="runs-bulk" role="toolbar"${attrs({ 'aria-label': label })}><span class="runs-bulk-n">${count} selected</span>${actions.map(act).join('')}${button({ label: 'Cancel', kind: 'quiet', title: cancel, attrs: { 'data-bulk': 'cancel' } })}</div>`;
}

/**
 * Select all, which joins the list's head while selecting. Some ticked shows as mixed: data-mixed asks the page to set
 * `indeterminate` once it is drawn.
 * @param {object} o
 * @param {'none'|'some'|'all'} o.state  selectAllState()
 * @param {string} [o.label]             its name for a screen reader
 */
export function selectAllBox({ state, label = 'Select all shown' }) {
  return checkbox({ label: 'Select all', cls: 'runs-all-wrap', checked: state === 'all', attrs: { class: 'runs-check runs-all', 'data-selall': true, 'data-mixed': state === 'some' ? true : null, 'aria-label': label } });
}

/**
 * Touch: holding a row for PRESS_MS calls onPress(row); the click that follows is swallowed. A finger that moves is
 * scrolling, and cancels it. Returns a disposer.
 * @param {object} o
 * @param {EventTarget} o.root
 * @param {string} o.selector          the rows
 * @param {(row: Element) => void} o.onPress
 * @param {(row: Element) => boolean} [o.accept]  this row can be selected
 * @param {Window} [o.win]
 */
export function bindLongPress({ root, selector, onPress, accept = () => true, win = globalThis }) {
  let timer = 0, from = null, pressed = false;
  const cancel = () => { win.clearTimeout(timer); timer = 0; from = null; };
  const down = (e) => {
    pressed = false;
    cancel();
    const row = e.pointerType === 'touch' && e.target.closest?.(selector);
    if (!row || !accept(row)) return;
    from = [e.clientX, e.clientY];
    timer = win.setTimeout(() => { timer = 0; pressed = true; onPress(row); }, PRESS_MS);
  };
  const move = (e) => { if (from && Math.hypot(e.clientX - from[0], e.clientY - from[1]) > 10) cancel(); };
  const swallow = (e) => { if (pressed) { e.preventDefault(); e.stopPropagation(); pressed = false; } };
  const noMenu = (e) => { if (pressed || timer) e.preventDefault(); };
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  for (const t of ['pointerup', 'pointercancel']) root.addEventListener(t, cancel);
  root.addEventListener('click', swallow, true);
  root.addEventListener('contextmenu', noMenu);
  return () => {
    cancel();
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', move);
    for (const t of ['pointerup', 'pointercancel']) root.removeEventListener(t, cancel);
    root.removeEventListener('click', swallow, true);
    root.removeEventListener('contextmenu', noMenu);
  };
}
