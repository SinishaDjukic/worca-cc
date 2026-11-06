// Selecting in a list (docs/rail/lists.md): pure logic, no DOM. A selection is { on, ids, anchor }: selecting or not,
// the ticked keys, where a range starts. `shown` is the keys the list shows now, in its order. Written for every list
// that has selecting: Pulse's Updates now, the Runs list and Chat in their waves.
import { shortcutAction } from './shortcuts.mjs';

/** How long a touch holds a row before it starts selecting. */
export const PRESS_MS = 500;

/** The empty selection, not selecting: where a list starts, and what Cancel or Esc leaves. */
export const selectClear = () => ({ on: false, ids: [], anchor: '' });

/** Selecting with nothing ticked yet: the list's menu, `Select`. */
export const selectStart = (s = selectClear()) => ({ ...s, on: true });

/** Ticks or unticks one and makes it the anchor. Unticking the last one ends selecting. */
export function selectToggle(s, id) {
  const ids = s.ids.includes(id) ? s.ids.filter((x) => x !== id) : [...s.ids, id];
  return ids.length ? { on: true, ids, anchor: id } : selectClear();
}

/** Adds every row from the anchor to `id`. With no anchor in the list, a plain toggle. The anchor stays. */
export function selectRange(s, shown, id) {
  const a = shown.indexOf(s.anchor), b = shown.indexOf(id);
  if (b < 0) return s;
  if (a < 0) return selectToggle(s, id);
  return { ...s, on: true, ids: [...new Set([...s.ids, ...shown.slice(Math.min(a, b), Math.max(a, b) + 1)])] };
}

/** Every row shown is ticked. */
export const selectAll = (s, shown) => ({ ...s, on: true, ids: [...shown] });

/** Keeps only what is in `shown`; selecting goes on. */
export const selectPrune = (s, shown) => ({ ...s, ids: s.ids.filter((x) => shown.includes(x)) });

/** How many of the rows shown are ticked. */
export const selectCount = (s, shown) => shown.filter((x) => s.ids.includes(x)).length;

/** The Select all box: 'none', 'some' or 'all'. */
export function selectAllState(s, shown) {
  const n = selectCount(s, shown);
  return !n ? 'none' : n === shown.length ? 'all' : 'some';
}

/** Shift and an arrow: moves on from `from` by `dir`, adding to the range. { pick, to }: the selection and the new row. */
export function selectExtend(s, shown, from, dir) {
  const i = shown.indexOf(from);
  const to = shown[i < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, i + dir))];
  if (!to) return { pick: s, to: '' };
  return { pick: selectRange({ ...s, anchor: shown.includes(s.anchor) ? s.anchor : from || to }, shown, to), to };
}

/**
 * The selection action a click, a long-press or a key means, or null (a plain click opens the row).
 * A click: { click: true, button, onBox, metaKey, ctrlKey, shiftKey }. A long-press: { press: true }. A key: keyFacts().
 * @returns {'toggle'|'range'|'all'|'clear'|'extend-down'|'extend-up'|null}
 */
export function selectionAction(f, { selecting = false } = {}) {
  if (f.press) return 'toggle';
  if (f.click) {
    if (f.button) return null;   // a middle click keeps what the browser does
    if (f.shiftKey) return 'range';
    return f.onBox || f.metaKey || f.ctrlKey || selecting ? 'toggle' : null;   // while selecting a plain click or tap ticks
  }
  return shortcutAction(f, { scopes: ['selecting'], selecting });
}

/** Applies 'toggle', 'range', 'all' or 'clear' to a selection. */
export function selectApply(s, action, { id = '', shown = [] } = {}) {
  if (action === 'toggle') return selectToggle(s, id);
  if (action === 'range') return selectRange(s, shown, id);
  if (action === 'all') return selectAll(s, shown);
  if (action === 'clear') return selectClear();
  return s;
}

/**
 * What a selection key does to a selection: 'toggle', 'all', 'extend-down' or 'extend-up'. { pick, to }: the selection and
 * the row the focus moves to ('' stays).
 */
export function selectStep(s, act, { from = '', shown = [] } = {}) {
  if (act === 'extend-down' || act === 'extend-up') return selectExtend(s, shown, from, act === 'extend-down' ? 1 : -1);
  return { pick: selectApply(s, act, { id: from, shown }), to: '' };
}

/** Where the focus goes after a redraw: the same row, else the next one still there, else the one before, else ''. */
export function keepFocus(before, after, id) {
  if (after.includes(id)) return id;
  const i = before.indexOf(id);
  if (i < 0) return after[0] || '';
  return before.slice(i + 1).find((x) => after.includes(x)) || before.slice(0, i).reverse().find((x) => after.includes(x)) || '';
}
