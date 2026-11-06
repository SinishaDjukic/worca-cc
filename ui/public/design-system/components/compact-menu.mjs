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
 */

/**
 * @param {object} o
 * @param {MenuItem[]} o.items
 * @param {string} [o.role]   'menu' (default) or 'dialog' for a picker that holds a field
 * @param {string} [o.label]  aria-label, for a dialog
 * @param {string} [o.cls]    the page's hook class
 */
export function compactMenu({ items, role = 'menu', label, cls = '' }) {
  let ruled = false;
  const body = items.map((it, i) => {
    if (it.sep) return '<div class="menu-sep" role="separator"></div>';
    if (it.header) return `<p class="menu-h">${esc(it.header)}</p>`;
    const prev = items[i - 1];
    const rule = it.danger && !ruled && i > 0 && !(prev && prev.sep) ? '<div class="menu-sep" role="separator"></div>' : '';
    if (it.danger) ruled = true;
    const choice = it.checked !== undefined;
    return `${rule}<button type="button" class="menu-item${it.danger ? ' is-danger' : ''}"${attrs({
      role: choice ? 'menuitemradio' : 'menuitem', 'aria-disabled': it.off ? 'true' : null,
      'aria-checked': choice ? String(!!it.checked) : null, 'data-menu-pick': it.id || it.text, title: it.help || null,
    })}><span class="mi-l">${esc(it.text)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}</button>`;
  }).join('');
  return `<div class="menu${cls ? ' ' + cls : ''}"${attrs({ role, 'aria-label': label, 'data-motion': 'in' })}>${body}</div>`;
}
