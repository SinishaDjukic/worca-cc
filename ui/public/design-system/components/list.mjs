// ListRow and List (docs/design-system.md › Worca Rail › Which component: "A list of things"; Patterns › A list).
// A row is one thing: its state mark on the rail (hanging left of the text edge, so every title starts on the page's
// text edge), a title line, a meta line, and at its right a figure or time and the row's ⋯. The whole row opens its
// one target. Rows are split by space; a list grouped by something draws one line where each group after the first
// starts, from the text edge. Never a box per item.
import { attrs, esc } from './html.mjs';

/**
 * ListRow.
 * @param {object} o
 * @param {string} o.title          the thing's name
 * @param {string} [o.meta]         one line of facts, as text ("Any project · Fix workflow · updated 3 Oct")
 * @param {string} [o.mark]         the rail mark's markup (a statusDot, a kind icon); empty for a thing with no state
 * @param {string} [o.end]          at the right: a figure or time (text), then the row's ⋯ (markup)
 * @param {string} [o.endText]      a figure or time, as text
 * @param {object} [o.open]         the row's one target: attrs on its button (data-open, title); none, a row that only shows
 * @param {object} [o.attrs]        on the row
 */
export function listRow({ title, meta = '', mark = '', end = '', endText = '', open = null, attrs: a = {} }) {
  const body = `<span class="lr-t">${esc(title)}</span>${meta ? `<span class="lr-m">${esc(meta)}</span>` : ''}`;
  const main = open ? `<button type="button" class="lr-main"${attrs(open)}>${body}</button>` : `<span class="lr-main">${body}</span>`;
  const right = endText || end ? `<span class="lr-end">${endText ? `<span class="lr-fig">${esc(endText)}</span>` : ''}${end}</span>` : '';
  return `<div class="list-row"${attrs(a)}><span class="lr-rail">${mark}</span>${main}${right}</div>`;
}

/**
 * List: its sentence (what it shows), then its groups in a fixed order; an empty group is not drawn; a long group
 * shows its first rows, then Show N more opens the rest in place (never folded).
 * @param {object} o
 * @param {string} [o.sentence]   the list's sentence, markup with SentencePickers ("Showing everything from all projects")
 * @param {{title?:string, count?:string|number, rows:string[], more?:{n:number, attrs:object}}[]} o.groups
 * @param {string} [o.empty]      EmptyState markup when every group is empty
 * @param {object} [o.attrs]
 */
export function list({ sentence = '', groups, empty = '', attrs: a = {} }) {
  const shown = groups.filter((g) => g.rows.length);
  const body = shown.length ? shown.map((g) => `<section class="list-group">${g.title ? `<h3 class="list-h">${esc(g.title)}${g.count !== undefined ? ` <span class="n">${esc(g.count)}</span>` : ''}</h3>` : ''}<div class="list-rows">${g.rows.join('')}</div>${g.more ? `<button type="button" class="dc-link list-more"${attrs(g.more.attrs)}>Show ${esc(g.more.n)} more</button>` : ''}</section>`).join('') : empty;
  return `<div class="list"${attrs(a)}>${sentence ? `<p class="list-sentence">${sentence}</p>` : ''}${body}</div>`;
}
