// CompactMenu (docs/stillhet/components.md): one line per item, a leading mark for a choice, a
// hint at the right (a count or a shortcut), the help in the tooltip. A header names a group of choices; danger items
// come last, after one rule.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';

/**
 * @typedef {object} MenuItem
 * @property {string} [id]       what a pick reports (data-menu-pick); the text when not given
 * @property {string} [text]
 * @property {string} [help]     the tooltip
 * @property {string} [hint]     a count or a shortcut, at the right
 * @property {boolean} [checked] a choice: true or false (absent: a plain step)
 * @property {boolean} [danger]  cannot be taken back: last, after a rule
 * @property {boolean} [off]     disabled; its help says why
 * @property {string} [header]   a group heading instead of an item; with `end`, a quiet caption over the items' hints ("need you")
 * @property {boolean} [sep]     a rule instead of an item
 * @property {string} [mark]     a small mark before its words: an area's icon, a KindMark
 * @property {MenuItem[]} [sub]  its items: it opens them in place (comp.menu-sub), and picks nothing itself
 * @property {boolean} [back]    the open sub-menu's way back (drawn by compactMenu only)
 * @property {string} [line]     one supporting line under its words, shown (a mode says what it adds); `help` stays the tooltip
 */

/**
 * One item of a menu, also for a menu that holds more than items (a side menu with its way back).
 * @param {MenuItem} it
 * @param {object} [o]
 * @param {string|null} [o.pickAttr]  the attribute a pick reads; null when `attrs` carries the page's own hook
 * @param {object} [o.attrs]          the page's hooks
 */
// A hint is a count or a shortcut. A shortcut is not part of the item's name: it is said as aria-keyshortcuts and its glyphs
// are hidden from the name ("Pin", never "PinP"). A count or a word is part of the name, after a space ("Chat 5").
const KEY_HINT = /^(?:[⌘⌃⌥⇧↑↓←→⌫?\/]|Ctrl\b|Alt\b|Shift\b|Space$|Enter$|Esc$|Del$|Tab$|[A-Z]$)/;
const KEY_NAMES = [[/⌘/g, 'Meta+'], [/⌃/g, 'Control+'], [/⌥/g, 'Alt+'], [/⇧/g, 'Shift+'], [/\bCtrl\b/g, 'Control'], [/⌫/g, 'Backspace'], [/\bDel\b/g, 'Delete'], [/\bEsc\b/g, 'Escape'], [/↑/g, 'ArrowUp'], [/↓/g, 'ArrowDown'], [/←/g, 'ArrowLeft'], [/→/g, 'ArrowRight']];
export const isKeyHint = (hint) => String(hint).length <= 12 && KEY_HINT.test(String(hint));
export const keyShortcuts = (hint) => KEY_NAMES.reduce((t, [re, to]) => t.replace(re, to), String(hint)).replace(/\s+/g, '+').replace(/\++/g, '+').replace(/\+$/, '');

export function menuItem(it, { pickAttr = 'data-menu-pick', attrs: a = {} } = {}) {
  if (it.back) return `<button type="button" class="menu-item menu-back"${attrs({ role: 'menuitem', 'data-menu-sub': '', 'aria-label': 'Back to every maker' })}><span class="mi-l"><span class="menu-back-i">${icon('chevL', 12)}</span>${esc(it.text)}</span></button>`;
  if (it.sub) {   // comp.menu-sub: an opener; the group holding the choice carries the tick (comp.menu-tick)
    const ticked = it.sub.some((x) => x.checked);
    return `<button type="button" class="menu-item"${attrs({ role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-disabled': it.off ? 'true' : null, 'data-menu-sub': it.id || it.text, title: it.help || null, ...a })}>${it.mark || ''}<span class="mi-l">${esc(it.text)}</span>${ticked ? `<span class="menu-check">${icon('check', 12)}</span>` : ''}<span class="menu-sub-chev">${icon('chevR', 12)}</span></button>`;
  }
  const choice = it.checked !== undefined, keys = it.hint && isKeyHint(it.hint);
  return `<button type="button" class="menu-item${it.danger ? ' is-danger' : ''}${it.line ? ' has-line' : ''}"${attrs({
    role: choice ? 'menuitemradio' : 'menuitem', 'aria-disabled': it.off ? 'true' : null,
    'aria-checked': choice ? String(!!it.checked) : null, 'aria-keyshortcuts': keys ? keyShortcuts(it.hint) : null, ...(pickAttr ? { [pickAttr]: it.id || it.text } : {}), title: it.help || null, ...a,
  })}>${it.mark || ''}<span class="mi-l">${esc(it.text)}${it.line ? `<span class="mi-line">${esc(it.line)}</span>` : ''}</span>${it.hint ? (keys ? `<span class="mi-hint" aria-hidden="true">${esc(it.hint)}</span>` : ` <span class="mi-hint">${esc(it.hint)}</span>`) : ''}${it.mark && it.checked ? `<span class="menu-check">${icon('check', 12)}</span>` : ''}</button>`;   // comp.menu-tick: a mark takes the choice's place, so the choice is a tick at the end
}

/**
 * @param {object} o
 * @param {MenuItem[]} o.items
 * @param {string} [o.role]      'menu' (default) or 'dialog' for a picker that holds a field
 * @param {string} [o.label]     aria-label, for a dialog
 * @param {string} [o.cls]       the page's hook class
 * @param {string} [o.pickAttr]  the attribute a pick reads (data-menu-pick)
 * @param {boolean} [o.motion]   false when the page animates what holds it
 * @param {string} [o.openSub]   the open opener's id: its items replace the list, under a back row (comp.menu-sub)
 */
export function compactMenu({ items, role = 'menu', label, cls = '', pickAttr = 'data-menu-pick', motion = true, openSub = '' }) {
  const opener = openSub ? items.find((it) => it.sub && (it.id || it.text) === openSub) : null;
  if (opener) { items = [{ back: true, text: opener.text }, ...opener.sub]; label = opener.text; }
  let ruled = false, inGroup = false;   // comp.menu-groups: a head and its options are one block, so columns never part them
  const endGroup = () => { const end = inGroup ? '</div>' : ''; inGroup = false; return end; };
  const body = items.map((it, i) => {
    if (it.sep) return `${endGroup()}<div class="menu-sep" role="separator"></div>`;
    if (it.header) { const end = endGroup(); inGroup = true; return `${end}<div class="menu-g"><p class="menu-h${it.end ? ' has-end' : ''}">${it.mark || ''}${esc(it.header)}${it.end ? `<span class="menu-h-end">${esc(it.end)}</span>` : ''}</p>`; }
    const prev = items[i - 1];
    const rule = it.danger && !ruled && i > 0 && !(prev && prev.sep) ? '<div class="menu-sep" role="separator"></div>' : '';
    if (it.danger) ruled = true;
    return rule + menuItem(it, { pickAttr });
  }).join('') + endGroup();
  return `<div class="menu${cls ? ' ' + cls : ''}"${attrs({ role, 'aria-label': label, 'data-sub-of': opener ? openSub : null, 'data-motion': motion ? 'in' : null })}>${/\bis-two-cols\b/.test(cls) ? `<div class="menu-cols">${body}</div>` : body}</div>`;   // the columns live inside what scrolls: a height on a multicol box makes more columns
}

const ITEM = '.menu-item:not([aria-disabled="true"])';
const quote = (v) => String(v).replace(/["\\]/g, '\\$&');   // an id inside an attribute selector
const focusIn = (doc, sel) => doc.querySelector(sel)?.focus?.({ preventScroll: true });

/**
 * The keys of a picker's menu (comp.menu-sub), called from the page's keydown listener: ↓ ↑ move and wrap, → Enter Space open
 * a group, ← and the back row return to it, Enter Space take an item. Only a key inside a `.spick` is touched; every key it
 * takes stops there, so neither the global shortcuts nor the composer's Enter-to-send see it.
 * @param {KeyboardEvent} e
 * @param {object} o
 * @param {(id: string) => void} o.openSub  opens the group and repaints at once
 * @param {() => void} o.closeSub           back to the groups, repainted at once
 * @returns {boolean} true when it took the key
 */
export function menuKeys(e, { openSub, closeSub }) {
  const t = e.target, doc = t?.ownerDocument, pick = t?.closest?.('.spick');
  if (!pick || !doc || !['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(e.key)) return false;
  const menu = pick.querySelector('.menu'), item = t.closest('.menu-item');
  const take = () => { e.preventDefault(); e.stopPropagation(); return true; };
  if (!item) {   // on the picker's own button: ↓ goes into its open menu
    if (e.key !== 'ArrowDown' || !menu || t.getAttribute('aria-expanded') !== 'true') return false;
    menu.querySelector(ITEM)?.focus({ preventScroll: true });
    return take();
  }
  const level = item.closest('.menu'), all = [...level.querySelectorAll(ITEM)];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (all.length) all[(all.indexOf(item) + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length].focus({ preventScroll: true });
    return take();
  }
  const off = item.getAttribute('aria-disabled') === 'true', sub = item.dataset.menuSub, of = level.dataset.subOf;
  if (sub === '' || (e.key === 'ArrowLeft' && of)) {   // back to the groups
    if (sub === '' && e.key === 'ArrowRight') return take();
    closeSub();
    focusIn(doc, `[data-menu-sub="${quote(of)}"]`);
    return take();
  }
  if (e.key === 'ArrowLeft') return take();
  if (sub !== undefined) {   // an opener
    if (off) return take();
    openSub(sub);
    const sel = `.menu[data-sub-of="${quote(sub)}"]`;
    focusIn(doc, `${sel} [aria-checked="true"]:not([aria-disabled="true"])`);
    if (!doc.activeElement?.closest?.(sel)) focusIn(doc, `${sel} ${ITEM}:not(.menu-back)`);
    return take();
  }
  if (e.key === 'ArrowRight') return take();
  if (!off) item.click();
  return take();
}

// ---- Menus and radio groups by keyboard, on every page (docs/stillhet/keyboard.md): one listener per document, ahead of
// a page's own shortcuts, so the bar never takes an arrow key that belongs to an open menu or a group of answers.
const MENU = '.menu[role="menu"], .menu[role="dialog"]';
const RADIO = '[role="radio"]:not([disabled]):not([aria-disabled="true"])';
const keyed = new WeakSet();

/**
 * Where a key moves inside a list of choices: ↓ → next, ↑ ← previous (both wrap), Home first, End last.
 * @param {number} count  how many choices
 * @param {number} from   the one that has the focus (-1: none)
 * @param {string} key
 * @returns {number} the index to move to; -1 when the key does not move
 */
export function choiceMove(count, from, key) {
  if (!count) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (from + 1) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (Math.max(from, 0) - 1 + count) % count;
  return -1;
}

/**
 * Type-ahead: the next choice after `from` whose words start with what was typed.
 * @param {string[]} texts  each choice's words
 * @param {number} from
 * @param {string} typed
 * @returns {number} -1 when none does
 */
export function typeAhead(texts, from, typed) {
  const t = typed.toLowerCase(); if (!t) return -1;
  for (let i = 1; i <= texts.length; i++) { const at = (Math.max(from, -1) + i) % texts.length; if (texts[at].trim().toLowerCase().startsWith(t)) return at; }
  return -1;
}

/** The menu a trigger opened: the one drawn beside it, else the page's one open pop-up menu. */
function menuOf(trigger) {
  const near = trigger.parentElement?.querySelector(MENU);
  if (near && !near.contains(trigger)) return near;
  // a trigger inside a menu (a side menu's opener) opened another: the one pop-up menu it is not in
  const all = [...trigger.ownerDocument.querySelectorAll(MENU)].filter((m) => !m.contains(trigger) && m.ownerDocument.defaultView.getComputedStyle(m).position !== 'static');
  return all.length === 1 ? all[0] : null;
}
const firstOf = (menu) => menu.querySelector('input:not([disabled]), textarea') || menu.querySelector('.menu-item[role="menuitemradio"][aria-checked="true"]:not([aria-disabled="true"])') || menu.querySelector(ITEM);   // the chosen answer of a choice, else the first item

/**
 * A menu that has just opened takes the focus: on its field when it holds one, else on the chosen item, else on the first.
 * Only when the focus is on its trigger or nowhere: a menu redrawn while you are inside it is left alone.
 */
export function focusMenu(menu) {
  const doc = menu.ownerDocument, a = doc.activeElement;
  if (a && a !== doc.body && (a.matches?.('input, textarea, select, [contenteditable="true"]') || !(a.matches?.('[aria-haspopup]') && menuOf(a) === menu))) return false;   // typing is never interrupted
  const to = firstOf(menu); if (!to) return false;
  to.focus({ preventScroll: true });
  return true;
}

/** Arrow keys, Home, End and type-ahead in every menu; arrow keys in every radio group; Tab from a trigger into its open menu. */
export function watchChoiceKeys(doc) {
  if (keyed.has(doc)) return;
  keyed.add(doc);
  const win = doc.defaultView;
  let typed = '', typedAt = 0;
  win.addEventListener('keydown', (e) => {
    const t = e.target; if (!t?.closest || e.altKey || e.ctrlKey || e.metaKey) return;
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    // a radio group: an arrow moves the choice, and the choice follows the focus
    const radio = t.closest('[role="radio"]'), group = radio?.closest('[role="radiogroup"]');
    if (group) {
      const all = [...group.querySelectorAll(RADIO)], to = all[choiceMove(all.length, all.indexOf(radio), e.key)];
      if (!to || e.key === 'Home' || e.key === 'End') return;
      take();
      to.focus({ preventScroll: true });
      if (to.getAttribute('aria-checked') !== 'true') to.click();
      return;
    }
    // a trigger: ↓ opens its menu, or goes into the open one; Tab goes into the open one, which is next after its trigger
    const trigger = t.closest('[aria-haspopup="menu"], [aria-haspopup="dialog"][data-menu]');
    if (trigger && !t.closest(MENU)) {
      const isOpen = trigger.getAttribute('aria-expanded') === 'true', menu = isOpen ? menuOf(trigger) : null;
      if (e.key === 'ArrowDown' && !isOpen && !trigger.matches('input, textarea')) { take(); trigger.click(); return; }
      if ((e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) && menu) { const to = firstOf(menu); if (to) { take(); to.focus({ preventScroll: true }); } }
      return;
    }
    const menu = t.closest(MENU); if (!menu) return;
    const item = t.closest('.menu-item'), all = [...menu.querySelectorAll(ITEM)];
    if (t.matches('input, textarea')) {   // a menu's own field: ↓ goes to its first item, every other key is the field's
      if (e.key === 'ArrowDown' && all[0]) { take(); all[0].focus({ preventScroll: true }); }
      return;
    }
    if (e.key === 'Tab') {   // Tab leaves a menu the way it came: back to its trigger (Shift), or on from it
      const back = [...doc.querySelectorAll('[aria-haspopup][aria-expanded="true"]')].filter((x) => !menu.contains(x)).pop();
      if (e.shiftKey && back && item === all[0]) { take(); back.focus({ preventScroll: true }); }
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      const to = all[choiceMove(all.length, all.indexOf(item), e.key)];
      if (to) { take(); to.focus({ preventScroll: true }); }
      return;
    }
    if (e.key.length === 1 && e.key !== ' ' && item) {
      const now = Date.now(); typed = now - typedAt > 700 ? e.key : typed + e.key; typedAt = now;
      const to = all[typeAhead(all.map((x) => x.textContent || ''), typed.length > 1 ? all.indexOf(item) - 1 : all.indexOf(item), typed)];
      if (to) { take(); to.focus({ preventScroll: true }); }
    }
  }, true);
}
