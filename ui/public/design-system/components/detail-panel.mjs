// DetailPanel: what you open to investigate a task, beside the chat and never inside its card. One panel, in tabs
// (Activity, Changes, Decisions, Checks); it names the task it follows in its header. It opens only on intent (a link in
// the card's message, a knot of its train, a vital, the card's Details button) and closes with its close control, Escape
// or the same trigger again; a click elsewhere in the chat leaves it open. Beside the chat it is a named region, not a
// modal; as a sheet (tablet) or full screen (phone) it is a dialog. It has no composer: it is detail, not a chat.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { button } from './button.mjs';
import { tabs } from './tabs.mjs';

/**
 * @param {object} o
 * @param {string} o.title        the task it follows
 * @param {string} [o.mark]       the task's KindMark (markup)
 * @param {string} [o.word]       its state word, before the title
 * @param {{id:string, label:string, count?:string|number, fresh?:boolean}[]} o.tabs   fresh: a quiet mark, something new arrived
 * @param {string} o.tab          the open tab's id
 * @param {string} o.body         the open tab's content (markup: the task page's own parts)
 * @param {boolean} [o.wide]      widened, for logs and diffs
 * @param {boolean} [o.modal]     drawn as a sheet or full screen: a dialog
 * @param {string} [o.foot]       markup under the body (Open task)
 * @param {{close?:object, widen?:object}} [o.hooks]   each control's attributes
 * @param {object} [o.attrs]
 */
export function detailPanel({ title, mark = '', word = '', tabs: list = [], tab = '', body = '', wide = false, modal = false, foot = '', hooks = {}, attrs: a = {} }) {
  const name = `Details of ${title}`;
  const head = `<header class="dp-head"><div class="dp-k">${mark}<span class="dp-w">${esc(word)}</span><span class="dp-tools">${button({ label: wide ? 'Narrow the panel' : 'Widen the panel', kind: 'quiet', iconOnly: true, icon: icon(wide ? 'bar-show' : 'bar-hide', 14), cls: 'dp-widen', attrs: { 'aria-pressed': String(!!wide), ...(hooks.widen || {}) } })}${button({ label: 'Close details', kind: 'quiet', iconOnly: true, icon: icon('x', 14), attrs: { title: 'Close (Esc)', ...(hooks.close || {}) } })}</span></div><h2 class="dp-title" tabindex="-1" data-dp-title>${esc(title)}</h2></header>`;
  const bar = tabs({ label: name, controls: 'dp-body', idPrefix: 'dp-tab-', cls: 'dp-tabs', items: list.map((t) => ({ id: t.id, label: t.fresh ? `${t.label} ·` : t.label, count: t.count, selected: t.id === tab })) });
  return `<aside class="detail-panel${wide ? ' is-wide' : ''}"${attrs({ role: modal ? 'dialog' : 'region', 'aria-modal': modal ? 'true' : null, 'aria-label': name, ...a })}>${head}${bar}<div class="dp-body" id="dp-body" role="tabpanel" tabindex="0"${attrs({ 'aria-labelledby': `dp-tab-${tab}` })}>${body}</div>${foot ? `<footer class="dp-foot">${foot}</footer>` : ''}</aside>`;
}
