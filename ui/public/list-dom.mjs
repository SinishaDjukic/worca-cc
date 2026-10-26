// The DOM side of the shared list (issue #948): the one roving Tab stop of the Runs list and the Chats column, the
// selection bar's counts, and pointer selection (⌘/Shift-click, long-press). list-keys.mjs maps keys to actions; this
// module moves the focus and paints the bar.
import { rangeKeys } from './runs-selection.mjs';

/** The Tab stops of a list: rows and foldable section heads. */
export const LIST_NAV = 'a.runs-row, button.runs-sec-head[data-section-key]';
/** A stop's key across repaints: `row:KEY` or `sec:KEY`. */
export const navKey = (n) => (n.dataset.rowKey ? `row:${n.dataset.rowKey}` : `sec:${n.dataset.sectionKey}`);

/**
 * host: the list element. `state.focusKey` is read and written (runsUi, the Chats column's state). current: the open
 * item's selector (the stop's fallback). inner: controls inside a row that leave the Tab order.
 */
export function createListRove({ host, state, nav = LIST_NAV, keyOf = navKey, current = 'a.runs-row.selected',
  row = 'a.runs-row', inner = '.runs-more, .runs-expand, .runs-check' }) {
  const items = () => (host ? [...host.querySelectorAll(nav)].filter((n) => !n.closest('[hidden]')) : []);
  /** The first of `keys` still in the list, or null. */
  const find = (keys, list = items()) => keys.map((k) => list.find((x) => keyOf(x) === k)).find(Boolean) || null;
  /** The one Tab stop: the remembered stop, else the open item, else the first row, else the first stop. */
  function rove() {
    if (!host) return null;
    const list = items();
    const want = list.find((n) => keyOf(n) === state.focusKey) || host.querySelector(current)
      || list.find((n) => n.matches(row)) || list[0] || null;
    // Every match, hidden or not: an <a href> with no tabindex attribute is a Tab stop, so none may keep the default.
    for (const n of host.querySelectorAll(nav)) n.tabIndex = n === want ? 0 : -1;
    for (const b of host.querySelectorAll(inner)) b.tabIndex = -1;
    return want;
  }
  function focus(n) {
    if (!n) return;
    n.focus();
    n.scrollIntoView?.({ block: 'nearest' });
  }
  function move(from, dir) {
    const list = items();
    const i = from ? list.indexOf(from) : -1;
    focus(i < 0 ? rove() : list[Math.max(0, Math.min(list.length - 1, i + dir))]);
  }
  /** Keys to land on when `n` leaves the list: [n itself when `self`, next, previous]. */
  function around(n, { self = false } = {}) {
    const list = items();
    const i = n ? list.indexOf(n) : -1;
    return i < 0 ? [] : [self && list[i], list[i + 1], list[i - 1]].filter(Boolean).map(keyOf);
  }
  host?.addEventListener('focusin', (e) => {
    const n = e.target.closest?.(nav);
    if (!n) return;
    state.focusKey = keyOf(n);
    for (const x of host.querySelectorAll(nav)) x.tabIndex = x === n ? 0 : -1;
  });
  return { items, find, rove, focus, move, around, keyOf };
}

/** The selection bar: `label` into .runs-bulk-n; per `[data-bulk=KEY]` in `actions`, its .runs-bulk-c count, disabled at
 *  0, its title (removed when empty) and, when given, its .runs-bulk-w word. Buttons not in `actions` are left alone. */
export function paintBulkBar(bar, { label, actions = {} }) {
  if (!bar) return;
  const n = bar.querySelector('.runs-bulk-n');
  if (n) n.textContent = label;
  for (const [key, a] of Object.entries(actions)) {
    const b = bar.querySelector(`[data-bulk="${key}"]`);
    if (!b) continue;
    const c = b.querySelector('.runs-bulk-c');
    if (c) c.textContent = String(a.count);
    b.disabled = a.count === 0;
    if (a.title) b.title = a.title; else b.removeAttribute('title');
    const w = a.word != null ? b.querySelector('.runs-bulk-w') : null;
    if (w) w.textContent = a.word;
  }
}

/**
 * Pointer selection (A11, spec §3.2), the Runs list's and the Chats column's: ⌘/Ctrl-click toggles a row and sets the
 * anchor; Shift-click adds the range from the anchor (no anchor, or a row outside `visibleKeys()`: a toggle); a touch
 * long-press toggles the row and swallows the click that follows. None of them opens the row. A middle click or the
 * context menu fires no primary `click`, so the browser keeps "open in a new tab". Capture phase on `list`, so the
 * list's own open handler never sees these clicks. `toggle(key)` and `selectRange(keys)` enter selection and repaint
 * (the caller owns its state). Returns a disposer.
 */
export function bindPointerSelect({ list, visibleKeys, getAnchor, setAnchor, toggle, selectRange, win = list?.ownerDocument?.defaultView, pressMs = 500 }) {
  if (!list) return () => {};
  const w = win || globalThis;
  const keyOf = (n) => (n && n.closest ? n.closest('.runs-item')?.dataset.rowKey || '' : '');
  let press = null;
  let pressed = '';
  const cancel = () => { if (press) w.clearTimeout(press); press = null; };
  const onDown = (e) => {
    if (e.pointerType !== 'touch') return;
    const key = keyOf(e.target);
    if (!key) return;
    cancel();
    press = w.setTimeout(() => { press = null; pressed = key; toggle(key); }, pressMs);
  };
  const onClick = (e) => {
    if (pressed) { e.preventDefault(); e.stopPropagation(); pressed = ''; return; }
    const row = e.target && e.target.closest ? e.target.closest('a.runs-row') : null;
    if (!row || e.button || !(e.metaKey || e.ctrlKey || e.shiftKey)) return;
    const key = keyOf(row);
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    const anchor = getAnchor();
    const range = e.shiftKey && anchor ? rangeKeys(visibleKeys(), anchor, key) : [];
    if (range.length) { selectRange(range); return; }   // adds: the range joins the selection
    setAnchor(key);
    toggle(key);
  };
  list.addEventListener('pointerdown', onDown);
  for (const t of ['pointerup', 'pointercancel', 'pointermove']) list.addEventListener(t, cancel);
  list.addEventListener('click', onClick, true);
  return () => {
    cancel();
    list.removeEventListener('pointerdown', onDown);
    for (const t of ['pointerup', 'pointercancel', 'pointermove']) list.removeEventListener(t, cancel);
    list.removeEventListener('click', onClick, true);
  };
}
