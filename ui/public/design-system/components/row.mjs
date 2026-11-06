// The row primitive (docs/rail/components.md: one rail, one end). Every row on a Rail page has the same four slots:
// its mark on the rail, its text, its end (a figure, a time, a Switch, a button) and its ⋯. The kinds differ only in the
// classes their lists lay out: a list that holds rows gives them one rail and one end, so no row aligns itself.
import { attrs, cls } from './html.mjs';

const KINDS = {
  list: { tag: 'div', row: 'list-row', rail: 'lr-rail', end: 'lr-end' },
  setting: { tag: 'div', row: 'set-row', rail: '', end: 'set-end' },
  step: { tag: 'li', row: 'rd-route-row sc-row', rail: '', end: '' },
  route: { tag: 'li', row: 'rd-route-row', rail: '', end: '' },
  pulse: { tag: 'div', row: 'pz-row', rail: 'pz-rail', end: '' },
  member: { tag: 'div', row: 'rc-member', rail: '', end: '' },
};

/**
 * @param {object} o
 * @param {'list'|'setting'|'step'|'route'|'pulse'|'member'} [o.kind]
 * @param {string} [o.rail]  the mark's markup: a status dot, a step's circle, a tick box
 * @param {string} o.text    the row's text: one or more cells of its list's grid
 * @param {string} [o.end]   a figure, a time, a Switch or a button
 * @param {string} [o.more]  the row's ⋯
 * @param {string} [o.after] what sits under the row's line, inside the row (its detail)
 * @param {string} [o.cls]   state classes (is-…)
 * @param {object} [o.attrs] on the row
 */
export function row({ kind = 'list', rail = '', text = '', end = '', more = '', after = '', cls: c = '', attrs: a = {} }) {
  const k = KINDS[kind];
  if (!k) throw new Error(`row: unknown kind ${kind}`);
  const railHtml = k.rail ? `<span class="${k.rail}">${rail}</span>` : rail;
  const endHtml = k.end ? (end || more || kind === 'setting' ? `<span class="${k.end}">${end}${more}</span>` : '') : end + more;
  return `<${k.tag} class="${cls(k.row, c)}"${attrs(a)}>${railHtml}${text}${endHtml}${after}</${k.tag}>`;
}
