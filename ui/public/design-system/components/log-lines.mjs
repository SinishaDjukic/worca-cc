// LogLines (docs/rail/components.md): a step's or a run's log. One line per entry: its time, where it came from, its
// words; a warning or an error in its colour. It scrolls by itself; its filters are the sentence above it.
import { attrs, cls, esc } from './html.mjs';

/**
 * @param {object} o
 * @param {string} o.label
 * @param {{t:string, from?:string, text:string, lvl?:'info'|'warn'|'error'}[]} o.lines
 * @param {object} [o.attrs]
 */
export function logLines({ label, lines, attrs: a = {} }) {
  return `<ol class="lg" tabindex="0"${attrs({ 'aria-label': label, ...a })}>${lines.map((l) => `<li class="${cls('lg-row', l.lvl && l.lvl !== 'info' && `is-${l.lvl}`)}"><span class="lg-t">${esc(l.t)}</span><span class="lg-from" title="${esc(l.from || '')}">${esc(l.from || '')}</span><span class="lg-text">${esc(l.text)}</span></li>`).join('')}</ol>`;
}
