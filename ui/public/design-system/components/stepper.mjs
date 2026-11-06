// Stepper and StepRow (docs/rail/components.md): how far along, and its steps. One segment per stage, one cell per step,
// a real tablist under it; a stage's steps are rows on the rail, cells of their list's grid, so columns line up.
import { esc, attrs, cls } from './html.mjs';
import { icon } from './icons.mjs';
import { row } from './row.mjs';

/**
 * @param {object} o
 * @param {{key:string, label:string, meta?:string, selected?:boolean, aria?:string, cells:string[]}[]} o.stages
 * @param {string} [o.label]
 */
export function stepper({ stages, label = 'Stages' }) {
  const cols = `grid-template-columns:repeat(${stages.length},minmax(0,1fr))`;
  const track = stages.map((st) => `<div class="sc-seg">${st.cells.map((c) => `<span class="sc-cell ${c}"></span>`).join('')}</div>`).join('');
  const tabs = stages.map((st) => `<button type="button" class="sc-stage" role="tab" id="st-${esc(st.key)}" aria-controls="stage-panel" aria-selected="${!!st.selected}" tabindex="${st.selected ? 0 : -1}" data-stage="${esc(st.key)}" data-key="stage:${esc(st.key)}" aria-label="${esc(st.aria || st.label)}" title="${esc(st.aria || st.label)}"${attrs(st.attrs || {})}><span class="l">${esc(st.label)}</span><span class="m">${esc(st.meta || '')}</span></button>`).join('');
  return `<div class="sc-track" style="${cols}" aria-hidden="true">${track}</div><div class="sc-stages" style="${cols}" role="tablist" aria-label="${esc(label)}">${tabs}</div>`;
}

/** A step's mark on the rail: its circle and icon, and the word a screen reader hears. */
export const stepDot = ({ dotCls, word, icon: name, size = 10 }) => `<span class="rd-route-dot ${dotCls}" role="img" aria-label="${esc(word)}">${icon(name, size)}</span>`;

/**
 * StepRow: mark · name · time · loops; in Activity also model · cost · its one action; then the live line and evidence.
 * @param {object} r
 * @param {string} r.name
 * @param {string} r.rowCls, r.dotCls, r.icon, r.word   the step's look (stepLook)
 * @param {string} [r.ref]      opens the step in Activity
 * @param {string} [r.akey]     the step's key in Activity, when it can take the focus
 * @param {string} [r.time]
 * @param {number} [r.loops]
 * @param {string} [r.roundsKey]  its rounds open under it
 * @param {boolean} [r.roundsOpen]
 * @param {string} [r.live]     the second line
 * @param {string} [r.when]
 * @param {string} [r.model]
 * @param {string} [r.cost]
 * @param {boolean} [r.focus]
 * @param {boolean} [o.full]    Activity's columns
 * @param {string} [o.action]   Activity's one action on the step
 * @param {string} [o.below]    what sits under the row (its evidence)
 */
export function stepRow(r, { full = false, action = '', below = '' } = {}) {
  const name = r.ref ? `<button type="button" class="sc-step rd-route-name sc-name" data-ref="${esc(r.ref)}" data-key="ref:${esc(r.ref)}" title="Open ${esc(r.name)} in Activity">${esc(r.name)}</button>`
    : `<span class="rd-route-name sc-name" title="${esc(r.name)}"${r.akey ? ` tabindex="-1" data-key="act:${esc(r.akey)}"` : ''}>${esc(r.name)}</span>`;
  const loopIcon = icon('refresh', 11);
  const loops = !r.loops ? '' : r.roundsKey ? `<button type="button" class="sc-loop is-btn" aria-expanded="${!!r.roundsOpen}" data-rounds="${esc(r.roundsKey)}" data-key="rounds:${esc(r.roundsKey)}" title="${r.roundsOpen ? 'Hide' : 'Show'} the ${r.loops} rounds">${loopIcon}${r.loops}</button>`
    : `<span class="sc-loop" title="Ran ${r.loops} times">${loopIcon}${r.loops}</span>`;
  const rest = `<span class="sc-rest"><span class="sc-loops">${loops}</span>${full ? `<span class="sc-model">${esc(r.model || '')}</span><span class="sc-cost">${esc(r.cost || '')}</span><span class="sc-act">${action}</span>` : ''}</span>`;
  const live = r.live ? `<div class="rd-route-second sc-line" title="${esc(r.live)}">${esc(r.live)}${r.when ? `<span class="rc-when"> · ${esc(r.when)}</span>` : ''}</div>` : '';
  return row({ kind: 'step', cls: cls(r.rowCls, r.focus && 'is-focus'), rail: stepDot(r),
    text: `${name}<span class="sc-time">${esc(r.time || '')}</span>${rest}${live}${below}` });
}

/** A PR or a slice in a stack: its mark, number, title and one line; its own actions (a ⋯) at the end. */
export function stackRow(r) {
  return row({ kind: 'route', cls: r.rowCls, rail: stepDot({ ...r, size: 11 }),
    text: `<div class="rd-route-main"><div class="rd-route-place"><span class="sk-num">${esc(r.num)}</span><span class="rd-route-name" title="${esc(r.title)}">${esc(r.title)}</span></div><div class="rd-route-second" title="${esc(`${r.word} · ${r.sub}`)}"><span class="sk-word is-${esc(r.state)}">${esc(r.word)}</span> · ${esc(r.sub)}</div></div>`, end: r.end || '' });
}

/**
 * LineRow: one line that opens its detail in place, or goes to it: its mark, its words, a chevron.
 * @param {object} o
 * @param {string} o.mark     stepDot
 * @param {string} o.text
 * @param {boolean} [o.open]
 * @param {string} [o.more]   markup: what it opens, shown while open
 * @param {boolean} [o.link]  it goes elsewhere instead of opening
 * @param {object} [o.attrs]  on its button: its hook, data-key, title
 */
export function lineRow({ mark, text, open = false, more = '', link = false, attrs: a = {} }) {
  const expanded = link ? {} : { 'aria-expanded': String(open) };
  return row({ kind: 'route', cls: cls('ov-line', open && 'is-open'), rail: mark,
    text: `<button type="button" class="row-btn ov-line-btn${link ? ' is-link' : ''}"${attrs({ ...a, ...expanded })}><span>${esc(text)}</span>${icon('chevron', 14)}</button>`,
    after: open ? `<div class="ov-line-more" data-motion="open">${more}</div>` : '' });
}

/**
 * FileRow: a changed file, the row that opens its diff.
 * @param {object} o
 * @param {'A'|'M'} o.status
 * @param {string} o.name
 * @param {string} o.dir
 * @param {string} o.path     its tooltip
 * @param {number} [o.notes]  review comments on it
 * @param {number} o.added
 * @param {number} o.removed
 * @param {string} [o.blocks] the size's small blocks
 * @param {boolean} [o.open]
 * @param {object} [o.attrs]
 */
export function fileRow({ status, name, dir, path, notes = 0, added, removed, blocks = '', open = false, attrs: a = {} }) {
  return `<button type="button" class="ch-row"${attrs({ 'aria-expanded': String(open), ...a })}><span class="ch-st is-${esc(status)}"${attrs({ title: status === 'A' ? 'Added' : 'Modified' })}>${esc(status)}</span><span class="ch-name"${attrs({ title: path })}>${esc(name)}<span class="ch-path">${esc(dir)}</span></span>${notes ? `<span class="ch-notes"${attrs({ title: `${notes} review comments` })}>${esc(notes)}</span>` : '<span class="ch-notes"></span>'}<span class="ct"><span class="add">+${esc(added)}</span><span class="del">−${esc(removed)}</span></span><span class="ch-blocks" aria-hidden="true">${blocks}</span></button>`;
}

/**
 * StackedPrRow: a PR of a stack in the Create PR dialog: the row that opens its fields, shown once.
 * @param {object} o
 * @param {number} o.n          its place, from 1
 * @param {string} o.title
 * @param {string} o.line       markup: its one line under the title
 * @param {string[]} o.meta     its size, what it goes into
 * @param {boolean} [o.open]
 * @param {boolean} [o.made]    already opened: it no longer opens
 * @param {string} [o.body]     its fields, while open
 * @param {object} [o.attrs]
 */
export function stackedPrRow({ n, title, line, meta, open = false, made = false, body = '', attrs: a = {} }) {
  return `<li class="st-row"><button type="button" class="st-head"${attrs({ ...a, 'aria-expanded': String(!!open), disabled: !!made })}>${icon(open ? 'chevron' : 'chevSide', 14)}<span class="st-num">PR ${esc(n)}</span><span class="st-mid"><span class="st-t"${attrs({ title })}>${esc(title)}</span>${line}</span><span class="st-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</span></button>${open && !made ? `<div class="st-body">${body}</div>` : ''}</li>`;
}
