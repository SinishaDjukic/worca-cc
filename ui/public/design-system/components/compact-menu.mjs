// CompactMenu (docs/rail/components.md): one line per item, a leading mark for a choice, a
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
 * @property {string} [header]   a group heading instead of an item
 * @property {boolean} [sep]     a rule instead of an item
 * @property {string} [mark]     a small mark before its words: an area's icon, a KindMark
 * @property {MenuItem[]} [sub]  its items: it opens them in place (comp.menu-sub), and picks nothing itself
 * @property {boolean} [back]    the open sub-menu's way back (drawn by compactMenu only)
 */

/**
 * One item of a menu, also for a menu that holds more than items (a side menu with its way back).
 * @param {MenuItem} it
 * @param {object} [o]
 * @param {string|null} [o.pickAttr]  the attribute a pick reads; null when `attrs` carries the page's own hook
 * @param {object} [o.attrs]          the page's hooks
 */
export function menuItem(it, { pickAttr = 'data-menu-pick', attrs: a = {} } = {}) {
  if (it.back) return `<button type="button" class="menu-item menu-back"${attrs({ role: 'menuitem', 'data-menu-sub': '', 'aria-label': 'Back to every maker' })}><span class="mi-l"><span class="menu-back-i">${icon('chevL', 12)}</span>${esc(it.text)}</span></button>`;
  if (it.sub) {   // comp.menu-sub: an opener; the group holding the choice carries the tick (comp.menu-tick)
    const ticked = it.sub.some((x) => x.checked);
    return `<button type="button" class="menu-item"${attrs({ role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-disabled': it.off ? 'true' : null, 'data-menu-sub': it.id || it.text, title: it.help || null, ...a })}>${it.mark || ''}<span class="mi-l">${esc(it.text)}</span>${ticked ? `<span class="menu-check">${icon('check', 12)}</span>` : ''}<span class="menu-sub-chev">${icon('chevR', 12)}</span></button>`;
  }
  const choice = it.checked !== undefined;
  return `<button type="button" class="menu-item${it.danger ? ' is-danger' : ''}"${attrs({
    role: choice ? 'menuitemradio' : 'menuitem', 'aria-disabled': it.off ? 'true' : null,
    'aria-checked': choice ? String(!!it.checked) : null, ...(pickAttr ? { [pickAttr]: it.id || it.text } : {}), title: it.help || null, ...a,
  })}>${it.mark || ''}<span class="mi-l">${esc(it.text)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}${it.mark && it.checked ? `<span class="menu-check">${icon('check', 12)}</span>` : ''}</button>`;   // comp.menu-tick: a mark takes the choice's place, so the choice is a tick at the end
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
    if (it.header) { const end = endGroup(); inGroup = true; return `${end}<div class="menu-g"><p class="menu-h">${it.mark || ''}${esc(it.header)}</p>`; }
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
