// ui/public/list-keys.mjs — the one list keyboard (issue #948): which key does what in a divided list. Drives the Runs
// list now and the Chats list next (slice 2). Pure: a key event in, an action id out; the caller owns focus, rows and
// the actions. Grown from runsKeyAction (runs-selection.mjs), which now delegates here.
import { levelShows } from './ui-level.mjs';

/** Where letter keys never fire (the list pane's old guard, app.js). */
export const LIST_FIELD = 'input:not([type="checkbox"]), textarea, select, [contenteditable="true"]';

/** A Mac shows ⌘ ⌥ ⇧ glyphs; elsewhere Ctrl, Alt, Shift (the handlers take ⌘ or Ctrl everywhere). */
export function isMac(win) {
  const nav = win?.navigator;
  return /mac|iphone|ipad|ipod/i.test(String(nav?.userAgentData?.platform || nav?.platform || ''));
}

const ARROWS = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
const MAC = { mod: '⌘', alt: '⌥', shift: '⇧', Backspace: '⌫', Enter: '↵', Escape: 'Esc', Space: 'Space' };
const PC = { mod: 'Ctrl', alt: 'Alt', shift: 'Shift', Backspace: 'Backspace', Enter: 'Enter', Escape: 'Esc', Space: 'Space' };

/** One key token ('mod', 'shift', 'ArrowUp', 'E', '.') as its chip text. */
export function keyGlyph(token, mac) {
  return ARROWS[token] || (mac ? MAC : PC)[token] || String(token).toUpperCase();
}

/** A menu item's hint: "⇧G" on a Mac, "Shift+G" elsewhere. */
export function keyHint(tokens, mac) {
  const g = tokens.map((t) => keyGlyph(t, mac));
  return mac ? g.join('') : g.join('+');
}

/**
 * The action for a keydown in a list: 'toggle' | 'all' | 'clear' | 'down' | 'up' | 'extend-down' | 'extend-up' |
 * 'open' | 'unfold' | 'fold' | 'menu' | 'stop' | 'archive' | 'add-to-group' | 'leave-group' | 'delete' | 'help' | null.
 * `e` carries key, metaKey, ctrlKey, altKey, shiftKey, targetIsRow (focus on a row link) and inField.
 * `level` is the UI level (ui-level.mjs); Delete and the group keys need Advanced on the Runs list, as its ⋯ menu.
 */
export function listKeyAction(e, { size = 0, list = 'runs', level } = {}) {
  if (e.key === 'Escape') return size > 0 ? 'clear' : null;
  if (e.inField) return null;
  if (e.metaKey || e.ctrlKey) return !e.altKey && (e.key === 'a' || e.key === 'A') ? 'all' : null;
  if (e.altKey) return null;
  if (e.key === '?') return 'help';
  if (e.key === ' ') return e.targetIsRow ? 'toggle' : null;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') return `${e.shiftKey ? 'extend-' : ''}${e.key === 'ArrowDown' ? 'down' : 'up'}`;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const adv = list !== 'runs' || levelShows(level, 'advanced');
  if (e.shiftKey) return k === 'g' && adv ? 'leave-group' : null;
  switch (k) {
    case 'j': return 'down';
    case 'k': return 'up';
    case 'Enter': return e.targetIsRow ? 'open' : null;
    case 'ArrowRight': return 'unfold';
    case 'ArrowLeft': return 'fold';
    case '.': return 'menu';
    case 'e': return 'archive';
    case 's': return list === 'runs' ? 'stop' : null;
    case 'g': return adv ? 'add-to-group' : null;
    case 'Backspace': case 'Delete': return adv ? 'delete' : null;
    default: return null;
  }
}
