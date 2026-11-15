// Tabs (docs/rail/components.md): one question per tab, a count by exception. A real tablist: one
// Tab stop (the selected tab), arrows move, each tab names the panel it controls.
import { attrs, esc } from './html.mjs';

/**
 * @param {object} o
 * @param {{id:string, label:string, count?:string|number, selected?:boolean}[]} o.items
 * @param {string} o.label       the tablist's name ("Run detail")
 * @param {string} o.controls    the panel's id
 * @param {string} [o.cls]       the page's hook class
 * @param {string} [o.idPrefix]  each tab's id is idPrefix + item id
 * @param {(t:object)=>object} [o.hooks]  tabs that swap a popover's body, with no panel to name: the page's attrs in place of the id, aria-controls, tabindex and data-tab
 */
export function tabs({ items, label, controls, cls = '', idPrefix = 'tab-', hooks }) {
  const body = items.map((t) => `<button type="button" class="tab"${attrs(hooks ? { role: 'tab', 'aria-selected': String(!!t.selected), ...hooks(t) } : { role: 'tab', id: idPrefix + t.id, 'aria-controls': controls,
    'aria-selected': String(!!t.selected), tabindex: t.selected ? 0 : -1, 'data-tab': t.id, 'data-key': 'tab:' + t.id })}>${esc(t.label)}${t.count ? `<span class="n">${esc(t.count)}</span>` : ''}</button>`).join('');
  return `<div class="tabs${cls ? ' ' + cls : ''}" role="tablist"${attrs({ 'aria-label': label })}>${body}</div>`;
}
