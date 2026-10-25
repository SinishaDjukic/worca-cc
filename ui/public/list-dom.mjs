// The DOM side of the shared list (issue #948): the one roving Tab stop of the Runs list and the Chats column, and the
// selection bar's counts. list-keys.mjs maps keys to actions; this module moves the focus and paints the bar.

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
