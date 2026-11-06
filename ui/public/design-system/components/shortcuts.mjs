// Keyboard shortcuts (docs/rail/keyboard.md): the one table of what a key does, the pure step from a key event's facts
// to an action, and the sheet drawn from the table. The page owns focus, rows and what an action does. Stands alone,
// like run-state.mjs: the app's list-keys.mjs and keys-sheet.mjs are where this came from, and nothing imports them.
import { esc, toElement } from './html.mjs';
import { dialog } from './dialog.mjs';

/** Where keys never fire: typing stays typing. */
export const FIELD = 'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]';

/** Browser-owned combos: no shortcut may use one. 'mod' is ⌘ on a Mac, Ctrl elsewhere. */
export const RESERVED = Object.freeze(['mod+t', 'mod+w', 'mod+n', 'mod+shift+n', 'mod+shift+t', 'mod+l', 'mod+shift+o',
  'mod+d', 'mod+shift+b', 'mod+h', 'mod+q', 'mod+r', 'mod+p', 'mod+s', 'mod+f']);

/**
 * The table. A row: `do` the action, `label` its words in the sheet, `keys` its chords (modifiers, then the key).
 * `onRow`: only with the focus on a row, so Space and Enter stay a button's own elsewhere. `whenSelecting`: only while
 * selecting. `can`: only in a list that has this action (the page says, as `can`). `inField`: also with the focus in a
 * field: Esc, and moving out of a menu's own field into its items.
 */
export const SHORTCUTS = Object.freeze([
  { scope: 'anywhere', title: 'Anywhere', col: 1, rows: [
    { do: 'search', label: 'Search or ask', keys: [['mod', 'K']] },
    { do: 'help', label: 'This sheet', keys: [['?']] },
    { do: 'close', label: 'Close', keys: [['Escape']], inField: true },
  ] },
  { scope: 'list', title: 'A list', col: 1, rows: [
    { do: 'down', label: 'Move down', keys: [['ArrowDown'], ['J']] },
    { do: 'up', label: 'Move up', keys: [['ArrowUp'], ['K']] },
    { do: 'open', label: 'Open', keys: [['Enter']], onRow: true },
    { do: 'menu', label: 'Row menu', keys: [['.']], can: 'menu' },
    { do: 'unfold', label: 'Unfold', keys: [['ArrowRight']], can: 'fold' },
    { do: 'fold', label: 'Fold', keys: [['ArrowLeft']], can: 'fold' },
    { do: 'stop', label: 'Stop', keys: [['S']], can: 'stop' },
    { do: 'archive', label: 'Archive', keys: [['E']], can: 'archive' },
    { do: 'rename', label: 'Rename', keys: [['R']], can: 'rename' },
    { do: 'pin', label: 'Pin', keys: [['P']], can: 'pin' },
    { do: 'add-to-group', label: 'Add to group', keys: [['G']], can: 'group' },
    { do: 'leave-group', label: 'Remove from group', keys: [['shift', 'G']], can: 'group' },
    { do: 'delete', label: 'Delete', keys: [['Backspace'], ['Delete']], can: 'delete' },
  ] },
  { scope: 'selecting', title: 'Selecting', col: 2, rows: [
    { do: 'toggle', label: 'Select row', keys: [['Space']], onRow: true },
    { do: 'extend-down', label: 'Extend down', keys: [['shift', 'ArrowDown']] },
    { do: 'extend-up', label: 'Extend up', keys: [['shift', 'ArrowUp']] },
    { do: 'all', label: 'Select all', keys: [['mod', 'A']] },
    { do: 'clear', label: 'End selecting', keys: [['Escape']], whenSelecting: true, inField: true },
  ] },
  { scope: 'run', title: 'Run page', col: 2, rows: [
    { do: 'labels', label: 'Labels', keys: [['L']] },
    { do: 'terminal', label: 'Terminal', keys: [['ctrl', '`']] },
    { do: 'next', label: 'Next item', keys: [['ArrowRight'], ['ArrowDown']], inField: true },
    { do: 'prev', label: 'Previous item', keys: [['ArrowLeft'], ['ArrowUp']], inField: true },
    { do: 'first', label: 'First item', keys: [['Home']], inField: true },
    { do: 'last', label: 'Last item', keys: [['End']], inField: true },
  ] },
]);

/** A chord as one string, to compare with RESERVED: Ctrl and ⌘ are one key to a browser. */
export const chordId = (chord) => chord.map((t) => (t === 'ctrl' ? 'mod' : String(t).toLowerCase())).join('+');

/** A Mac shows ⌘ ⌥ ⇧ glyphs; elsewhere Ctrl, Alt, Shift. The keys take ⌘ or Ctrl everywhere. */
export function isMac(win) {
  const nav = win?.navigator;
  return /mac|iphone|ipad|ipod/i.test(String(nav?.userAgentData?.platform || nav?.platform || ''));
}

const ARROWS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
const MAC = { mod: '⌘', ctrl: 'Ctrl', alt: '⌥', shift: '⇧', Backspace: '⌫', Enter: '↵', Escape: 'Esc', Space: 'Space', Delete: 'Del' };
const PC = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', Backspace: 'Backspace', Enter: 'Enter', Escape: 'Esc', Space: 'Space', Delete: 'Del' };

/** One key token ('mod', 'shift', 'ArrowUp', 'E', '.') as its chip text. */
export function keyGlyph(token, mac) {
  return ARROWS[token] || (mac ? MAC : PC)[token] || String(token).toUpperCase();
}

/** A chord in a line of text: "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export function keyHint(chord, mac) {
  return chord.map((t) => keyGlyph(t, mac)).join(mac ? '' : '+');
}

/** What a key event says, for shortcutAction. `rowSel` names a list's rows, when the page has one. */
export function keyFacts(e, rowSel = '') {
  return { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey,
    inField: !!e.target?.closest?.(FIELD), onRow: !!(rowSel && e.target?.closest?.(rowSel)) };
}

const NAMED = { Space: ' ' };
function hits(chord, f) {
  const key = chord[chord.length - 1], mods = chord.slice(0, -1);
  if (String(f.key).toLowerCase() !== String(NAMED[key] || key).toLowerCase()) return false;
  const mod = f.metaKey || f.ctrlKey;
  if (mods.includes('mod') ? !mod : mods.includes('ctrl') ? !f.ctrlKey || f.metaKey : mod) return false;
  if (!!f.altKey !== mods.includes('alt')) return false;
  const symbol = key.length === 1 && !/[a-z0-9]/i.test(key);   // ? and . take Shift or not by keyboard layout
  return symbol || !!f.shiftKey === mods.includes('shift');
}

/**
 * The action a key event means here, or null. The page names where the focus is by `scopes`, first one first.
 * @param {object} f   key, metaKey, ctrlKey, altKey, shiftKey, inField, onRow (keyFacts)
 * @param {object} [o]
 * @param {string[]} [o.scopes]    'anywhere', 'list', 'selecting', 'run'
 * @param {boolean} [o.selecting]  the list is selecting now
 * @param {string[]} [o.can]       the actions this list has beyond moving and opening
 */
export function shortcutAction(f, { scopes = [], selecting = false, can = [] } = {}) {
  for (const scope of scopes) for (const r of SHORTCUTS.find((s) => s.scope === scope)?.rows || []) {
    if ((f.inField && !r.inField) || (r.onRow && !f.onRow) || (r.whenSelecting && !selecting) || (r.can && !can.includes(r.can))) continue;
    if (r.keys.some((c) => hits(c, f))) return r.do;
  }
  return null;
}

/** The next row's key from `from`, by `dir` (1 or -1), stopping at the ends; from nowhere, the first row. */
export function listMove(ids, from, dir) {
  const i = ids.indexOf(from);
  return (i < 0 ? ids[0] : ids[Math.max(0, Math.min(ids.length - 1, i + dir))]) || '';
}

/** The sheet's sections: the table's order, the rows this page has. */
export function shortcutSections({ scopes = SHORTCUTS.map((s) => s.scope), can = [] } = {}) {
  return SHORTCUTS.filter((s) => scopes.includes(s.scope)).map((s) => ({ ...s, rows: s.rows.filter((r) => !r.can || can.includes(r.can)) }));
}

/**
 * The Keyboard shortcuts sheet: a Dialog with no form, only Close, drawn from the table.
 * @param {object} o
 * @param {object[]} [o.sections]  shortcutSections()
 * @param {boolean} [o.mac]        ⌘ or Ctrl
 */
export function shortcutsSheet({ sections = shortcutSections(), mac = false } = {}) {
  const row = (r) => `<div class="keys-row"><span class="keys-label">${esc(r.label)}</span><span class="keys-combo">${r.keys.map((c) => c.map((t) => `<kbd class="kbd">${esc(keyGlyph(t, mac))}</kbd>`).join('')).join('<span class="keys-or">or</span>')}</span></div>`;
  const col = (n) => `<div class="keys-col">${sections.filter((s) => s.col === n).map((s) => `<section class="keys-sec"><h3 class="keys-h">${esc(s.title)}</h3>${s.rows.map(row).join('')}</section>`).join('')}</div>`;
  const note = `Keys never fire while you type.${mac ? ' On Windows and Linux, ⌘ is Ctrl.' : ''}`;
  return dialog({ title: 'Keyboard shortcuts', yes: 'Close', view: true, id: 'keys-sheet-t', scrimCls: 'keys-modal', cls: 'keys-dlg', body: `<div class="keys-cols">${col(1)}${col(2)}</div><p class="keys-note">${esc(note)}</p>` });
}

/**
 * Opens the sheet, one at a time. While it is up it holds every key: Esc, Close or a click outside close it, and the
 * focus goes back to `opener`, or to `fallback()` when a redraw replaced the opener.
 * @param {object} o
 * @param {Document} o.doc
 * @param {string[]} [o.scopes]
 * @param {string[]} [o.can]
 * @param {Element} [o.opener]
 * @param {() => Element} [o.fallback]
 */
export function openShortcutsSheet({ doc, scopes, can, opener = doc.activeElement, fallback = () => null }) {
  const open = doc.querySelector('.keys-modal');
  if (open) return open;
  const win = doc.defaultView;
  const modal = toElement(doc, shortcutsSheet({ sections: shortcutSections({ scopes, can }), mac: isMac(win) }));
  const close = modal.querySelector('[data-dialog="yes"]');
  const done = () => {
    win.removeEventListener('keydown', onKey, true);
    modal.remove();
    (opener?.isConnected ? opener : fallback())?.focus?.();
  };
  const onKey = (e) => {
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); done(); }
    if (e.key === 'Tab') { e.preventDefault(); close.focus(); }   // one control: the focus stays on Close
  };
  win.addEventListener('keydown', onKey, true);
  modal.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === modal || e.target.closest('[data-dialog]')) done(); });
  doc.body.append(modal);
  close.focus();
  return modal;
}
