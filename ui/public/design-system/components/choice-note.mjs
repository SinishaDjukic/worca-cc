// ChoiceNote (docs/rail/components.md, forms.md › form.run-options): a problem with a choice, shown before it is made, on
// the rail with its dot: one note, what it means, its rows (each with its own way out), and the ways out as buttons. A
// grey note only tells (the team policy notes) and offers no way. `end` is a slot for a Checkbox (a consent).
import { esc, cls } from './html.mjs';
import { button } from './button.mjs';
import { statusDot } from './status-line.mjs';

/**
 * @param {object} o
 * @param {boolean} [o.needsYou]    true (amber): it needs you; false (grey): it only tells, and offers no way
 * @param {string} o.text            the note (markup-free)
 * @param {string} [o.means]         what it means (markup-free)
 * @param {{text:string, way?:{label:string, kind?:string, attrs?:object}}[]} [o.rows]  one line per item, each with its own way out
 * @param {{label:string, kind?:string, attrs?:object}[]} [o.ways]  the ways out, as Buttons
 * @param {string} [o.end]           a Checkbox's markup, after the ways (never a person's text)
 */
export function choiceNote({ needsYou = true, text, means = '', rows = [], ways = [], end = '' }) {
  const tone = needsYou ? 'is-amber' : 'is-grey';   // the meaning picks the dot (comp.look-options): never a colour option
  const way = (w) => button({ label: w.label, kind: w.kind || 'quiet', attrs: w.attrs || {} });
  const lines = rows.map((r) => `<span class="rc-detail choice-note-row">${esc(r.text)}${r.way ? ` ${way(r.way)}` : ''}</span>`).join('');
  return `<div class="${cls('rc-zone choice-note', tone)}" role="status"><span class="rc-rail">${statusDot({ tone })}</span><span class="rc-main rc-word">${esc(text)}</span>${means ? `<span class="rc-detail">${esc(means)}</span>` : ''}${lines}${ways.length ? `<span class="rc-detail choice-note-ways">${ways.map((w) => button({ label: w.label, kind: w.kind || '', attrs: w.attrs || {} })).join('')}</span>` : ''}${end ? `<span class="rc-detail choice-note-end">${end}</span>` : ''}</div>`;
}
