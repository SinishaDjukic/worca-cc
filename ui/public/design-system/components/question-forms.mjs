// A question asked as a small form, under its question's row (docs/rail/panels.md › panel.question-forms): a number in its
// range with Worca's pick marked on the track, an order to set, rows to pick from a table. Each is the field of one
// question; the card's one filled button answers it, a quiet one takes Worca's pick. And a task card's facts on one line,
// each a way to its detail.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { button } from './button.mjs';
import { checkbox } from './checkbox.mjs';
import { tooltip } from './field.mjs';

// small.disabled-why: the end of the order says why it cannot go further
const moveBtn = (x, d, ic, off, why, move) => { const b = button({ label: `Move ${x.text} ${d}`, kind: 'quiet', iconOnly: true, title: off ? false : undefined, icon: ic, attrs: { disabled: off || null, ...move(x.id, d) } }); return off ? tooltip({ text: why, off: true, html: b }) : b; };

/**
 * SliderPick: a number in its range; the value in words above, Worca's pick as a tick on the track.
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.label       what it asks, for a screen reader
 * @param {number} o.min
 * @param {number} o.max
 * @param {number} o.value
 * @param {number} [o.pick]      Worca's pick
 * @param {(n:number)=>string} [o.words]  the value in words ("3 rounds")
 * @param {object} [o.attrs]     on the range input (data-*)
 */
export function sliderPick({ id, label, min, max, value, pick, words = (n) => String(n), attrs: a = {} }) {
  const at = (n) => `${((n - min) / Math.max(1, max - min)) * 100}%`;
  return `<div class="q-slide"><div class="q-slide-t"><span>${esc(words(min))}</span><b>${esc(words(value))}</b><span>${esc(words(max))}</span></div>
    <div class="q-slide-track">${pick !== undefined ? `<span class="q-slide-tick" style="left:${at(pick)}" title="Worca’s pick: ${esc(words(pick))}"></span><span class="q-slide-pick" style="left:${at(pick)}">Worca’s pick: ${esc(words(pick))}</span>` : ''}<input type="range"${attrs({ id, min, max, step: 1, value, 'aria-label': label, 'aria-valuetext': words(value), ...a })}></div></div>`;
}

/**
 * RankList: an order to set; each row its number, its words, a handle, and Up and Down for the keyboard.
 * @param {object} o
 * @param {string} o.label
 * @param {{id:string, text:string}[]} o.items   in their order now
 * @param {(id:string, dir:'up'|'down')=>object} o.move  the attrs of a row's Up and Down
 */
export function rankList({ label, items, move }) {
  return `<ol class="q-rank" aria-label="${esc(label)}">${items.map((x, i) => `<li class="q-rank-r"><span class="q-rank-n">${i + 1}</span><span class="q-rank-t">${esc(x.text)}</span><span class="q-rank-h" aria-hidden="true">${icon('updown', 14)}</span><span class="q-rank-a">${moveBtn(x, 'up', icon('up', 12), i === 0, 'It is already first', move)}${moveBtn(x, 'down', `<span style="display:inline-flex;transform:rotate(180deg)">${icon('up', 12)}</span>`, i === items.length - 1, 'It is already last', move)}</span></li>`).join('')}</ol>`;
}

/**
 * PickRows: rows to tick from a table; a head of its columns, one row per thing, its first cell the name.
 * @param {object} o
 * @param {string[]} o.cols                 the columns after the tick
 * @param {{id:string, cells:string[], checked:boolean}[]} o.rows
 * @param {(id:string)=>object} o.tick      the attrs of a row's tick box
 */
export function pickRows({ cols, rows, tick }) {
  const grid = `22px minmax(0,1fr)${' 88px'.repeat(Math.max(0, cols.length - 1))}`;
  return `<div class="q-rows" style="--q-cols:${grid}"><div class="q-rows-h"><span></span>${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>${rows.map((r) => `<div class="q-rows-r">${checkbox({ label: '', checked: r.checked, attrs: { 'aria-label': `Pick ${r.cells[0]}`, ...tick(r.id) } })}${r.cells.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`).join('')}</div>`;
}

/**
 * FactsLine: a task card's facts on one line (cost, time, agents, files, artifacts); each that has a detail is a way to it.
 * @param {{n:string, word:string, attrs?:object}[]} facts
 */
export function factsLine(facts) {
  return `<div class="q-facts">${facts.map((f) => (f.attrs ? `<button type="button" class="q-fact"${attrs(f.attrs)}><b>${esc(f.n)}</b> ${esc(f.word)}</button>` : `<span class="q-fact"><b>${esc(f.n)}</b> ${esc(f.word)}</span>`)).join('')}</div>`;
}
