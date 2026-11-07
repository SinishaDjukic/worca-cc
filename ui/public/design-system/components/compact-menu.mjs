// CompactMenu (docs/rail/components.md): one line per item, a leading mark for a choice, a
// hint at the right (a count or a shortcut), the help in the tooltip. A header names a group of choices; danger items
// come last, after one rule.
import { attrs, esc } from './html.mjs';

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
 */

/**
 * One item of a menu, also for a menu that holds more than items (a side menu with its way back).
 * @param {MenuItem} it
 * @param {object} [o]
 * @param {string|null} [o.pickAttr]  the attribute a pick reads; null when `attrs` carries the page's own hook
 * @param {object} [o.attrs]          the page's hooks
 */
export function menuItem(it, { pickAttr = 'data-menu-pick', attrs: a = {} } = {}) {
  const choice = it.checked !== undefined;
  return `<button type="button" class="menu-item${it.danger ? ' is-danger' : ''}"${attrs({
    role: choice ? 'menuitemradio' : 'menuitem', 'aria-disabled': it.off ? 'true' : null,
    'aria-checked': choice ? String(!!it.checked) : null, ...(pickAttr ? { [pickAttr]: it.id || it.text } : {}), title: it.help || null, ...a,
  })}>${it.mark || ''}<span class="mi-l">${esc(it.text)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}</button>`;
}

/**
 * @param {object} o
 * @param {MenuItem[]} o.items
 * @param {string} [o.role]      'menu' (default) or 'dialog' for a picker that holds a field
 * @param {string} [o.label]     aria-label, for a dialog
 * @param {string} [o.cls]       the page's hook class
 * @param {string} [o.pickAttr]  the attribute a pick reads (data-menu-pick)
 * @param {boolean} [o.motion]   false when the page animates what holds it
 */
export function compactMenu({ items, role = 'menu', label, cls = '', pickAttr = 'data-menu-pick', motion = true }) {
  let ruled = false;
  const body = items.map((it, i) => {
    if (it.sep) return '<div class="menu-sep" role="separator"></div>';
    if (it.header) return `<p class="menu-h">${it.mark || ''}${esc(it.header)}</p>`;
    const prev = items[i - 1];
    const rule = it.danger && !ruled && i > 0 && !(prev && prev.sep) ? '<div class="menu-sep" role="separator"></div>' : '';
    if (it.danger) ruled = true;
    return rule + menuItem(it, { pickAttr });
  }).join('');
  return `<div class="menu${cls ? ' ' + cls : ''}"${attrs({ role, 'aria-label': label, 'data-motion': motion ? 'in' : null })}>${body}</div>`;
}
