// What a row is and how it stands, in one mark (docs/rail/lists.md, docs/rail/look.md): the type's icon, inside one smooth
// ring that fills by main stage and deepens into the state's colour. The dot and the icon are one thing: while work
// happens the whole mark breathes. A question, a problem, a pause or a stop takes the centre.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { statusLine } from './status-line.mjs';

const STAGES = 5;
const R = 9, L = 2 * Math.PI * R;
const CENTRE = { ask: 'question', act: 'alert', fail: 'sym-x', pause: 'pause', stop: 'sym-stop' };
const KINDS = { chat: 'kind-chat', task: 'kind-task', schedule: 'kind-schedule', event: 'kind-event', feature: 'kind-feature', group: 'kind-group', workflow: 'kind-workflow' };

/**
 * The tone of a state, from what the library says about it (runState, chatState): never a page's own reading of a word.
 * @param {{word?:string, dot?:string, sym?:string}} st
 * @returns {'wait'|'run'|'ask'|'act'|'fail'|'pause'|'stop'|'ok'|'merged'|'closed'|'idle'}
 */
export function markTone(st = {}) {
  const w = st.word || '', d = st.dot || '';
  if (st.sym === 'q') return 'ask';
  if (st.sym === 'x' || w === 'Failed') return 'fail';
  if (w === 'Paused') return 'pause';
  if (['Stopped', 'Cancelled', 'Discarded'].includes(w)) return 'stop';
  if (w === 'Closed') return 'closed';
  if (['Merged', 'Applied'].includes(w)) return 'merged';
  if (['Ready', 'Ready to merge', 'Finished'].includes(w)) return 'ok';
  if (['Waiting', 'Mock run'].includes(w)) return 'wait';
  if (['Archived', 'Deleted', 'Idle', ''].includes(w)) return 'idle';
  if (/amber/.test(d) || w === 'Needs you') return 'act';
  if (/grey/.test(d)) return 'wait';
  return 'run';
}

/**
 * KindMark.
 * @param {object} o
 * @param {'chat'|'task'|'schedule'|'event'|'feature'|'group'|'workflow'} [o.kind]
 * @param {string} [o.tone]    markTone's answer
 * @param {number} [o.stage]   the main stage it is on, from 0; with none, a live thing wears the whole ring
 * @param {number} [o.stages]
 * @param {number} [o.size]
 * @param {string} [o.title]   the tooltip: its word, then its step
 */
export function kindMark({ kind = 'task', tone = 'idle', stage = -1, stages = STAGES, size = 20, title = '' } = {}) {
  const noRing = kind === 'event' || tone === 'idle' || (kind === 'schedule' && tone === 'wait');
  const reach = tone === 'wait' ? 0 : stage < 0 ? 1 : Math.min(1, (stage + 1) / stages);
  const arc = (from, len, stroke) => `<circle cx="10" cy="10" r="${R}" fill="none" stroke="${stroke}" stroke-width="1.1" stroke-dasharray="${len.toFixed(2)} ${(L - len).toFixed(2)}" stroke-dashoffset="${(L / 4 - from).toFixed(2)}"></circle>`;
  let ring = '';
  if (!noRing) {
    ring = arc(0, L, 'var(--line-2)');
    const steps = Math.round(48 * reach);
    for (let k = 0; k < steps; k++) ring += arc(k * (L / 48), L / 48 + 0.15, `color-mix(in srgb, currentColor ${Math.round(30 + 70 * (k + 1) / steps)}%, var(--line-2))`);
  }
  const centre = !noRing && CENTRE[tone] ? CENTRE[tone] : KINDS[kind] || KINDS.task;
  const glyph = icon(centre, Math.round((noRing ? 15 : centre === 'question' || centre === 'alert' ? 14 : 11) * size / 20));
  return `<span class="kind-mark is-${tone}"${attrs({ style: `--km:${size}px`, title: title || null, role: title ? 'img' : null, 'aria-label': title || null, 'aria-hidden': title ? null : 'true' })}>${ring ? `<svg class="km-ring" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">${ring}</svg>` : ''}${glyph}</span>`;
}

// Git's own icons (Octicons, MIT, github.com/primer/octicons): a person reads these as git before they read anything else.
const OCT = {
  branch: 'M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
  pr: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  merge: 'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z',
  draft: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
  closed: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
};
const GIT = { branch: ['branch', 'Branch only'], draft: ['draft', 'Draft'], open: ['pr', 'Open'], pass: ['pr', 'Checks pass'], fail: ['pr', 'Checks failing'], conflict: ['pr', 'Conflicts'], merged: ['merge', 'Merged'], closed: ['closed', 'Closed'] };

/**
 * GitMark: git's status at a row's end, the rest in its tooltip. While Watch fixes, the icon itself pulses, a little faster than
 * work on the row's mark, so the two read apart; while Watch only waits, its tooltip says so.
 * @param {object} o
 * @param {'branch'|'draft'|'open'|'pass'|'fail'|'conflict'|'merged'|'closed'} o.status
 * @param {''|'idle'|'fix'} [o.watch]
 * @param {string} [o.title]
 * @param {number} [o.size]
 */
export function gitMark({ status, watch = '', title = '', size = 14 }) {
  const [glyph, word] = GIT[status] || GIT.branch, inner = size;
  const svg = `<svg class="gm-i is-${status}" width="${inner}" height="${inner}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="${OCT[glyph]}"></path></svg>`;
  return `<span class="git-mark${watch ? ` is-watch is-${watch}` : ''}"${attrs({ title: title || word, role: 'img', 'aria-label': title || word })}>${svg}</span>`;
}

/**
 * Timeline: a long thing as one strip on the right edge, each tick where its moment is, the band what is on screen. A
 * hover shows what is there; a click goes there.
 * @param {object} o
 * @param {{id:string, at:number, kind:'you'|'work', tone?:string, title:string, line?:string}[]} o.ticks  `at` is 0 to 1
 * @param {[number, number]} [o.view]  the band's start and height, 0 to 1
 * @param {string} [o.label]
 */
export function timeline({ ticks, view = [0, 1], label = 'Timeline' }) {
  return `<nav class="timeline"${attrs({ 'aria-label': label })}><span class="tl-view" style="top:${view[0] * 100}%;height:${view[1] * 100}%"></span>${ticks.map((t) => `<button type="button" class="tl-tick is-${t.kind}${t.tone ? ` is-${t.tone}` : ''}"${attrs({ style: `top:${t.at * 100}%`, 'data-tick': t.id, 'aria-label': `${t.title}${t.line ? `, ${t.line}` : ''}` })}><i></i></button>`).join('')}</nav>`;
}

/**
 * Timeline's hover: one tick, one small card: what it is, its state, its time.
 * @param {object} o
 * @param {string} o.mark
 * @param {string} o.title
 * @param {string} [o.line]
 * @param {number} [o.at]    how far down its strip, 0 to 1
 */
export function timelineCard({ mark, title, line = '', at = 0 }) {
  return `<div class="tline-card" role="status" style="top:${at * 100}%">${mark}<span><b>${esc(title)}</b>${line ? `<span>${esc(line)}</span>` : ''}</span></div>`;
}

/**
 * BarHead: the one bar's head on every feature: the product's mark (the way to the places), what this bar is, its one
 * action, and Hide.
 * @param {object} o
 * @param {string} o.title
 * @param {boolean} [o.home]    the bar is showing the places
 * @param {string} [o.action]   a button's markup
 * @param {string} [o.logo]     the product's mark (markup); the house icon when none
 * @param {string} [o.hide]     the Hide button's markup
 */
export function barHead({ title, home = false, action = '', logo = '', hide = '' }) {
  const label = home ? 'Close the places' : 'Places';
  return `<div class="bar-head"><button type="button" class="bar-house${home ? ' is-on' : ''}"${attrs({ 'data-bar-house': '', title: label, 'aria-label': label, 'aria-expanded': String(home) })}>${logo || icon('home', 16)}</button><h2 class="bar-title">${esc(title)}</h2>${action}${hide}</div>`;
}

/**
 * TurnRow: what Worca did in a conversation, on the rail: its mark, one quiet line, what it took. It folds; a failure opens itself.
 * @param {object} o
 * @param {string} o.mark
 * @param {string} o.text      the line (markup, from esc'd words)
 * @param {string} [o.end]
 * @param {string} [o.body]    what it opens to
 * @param {boolean} [o.open]
 * @param {object} [o.attrs]
 */
export function turnRow({ mark, text, end = '', body = '', open = false, attrs: a = {} }) {
  const head = `<span class="tr-mark">${mark}</span><span class="tr-text">${text}</span><span class="tr-end">${end}</span>`;
  return `<div class="turn-row${open ? ' is-open' : ''}"${attrs(a)}>${body || a['data-fold-turn'] !== undefined ? `<button type="button" class="tr-line"${attrs({ 'aria-expanded': String(open), 'data-turn-toggle': '' })}>${head}</button>` : `<div class="tr-line">${head}</div>`}${open && body ? `<div class="tr-body">${body}</div>` : ''}</div>`;
}

/**
 * Composer: the one way to start anything: its words, then one line with +, the sentence, voice and send; with no
 * sentence, one line: the words and its send. You pick Ask, Task or Schedule; the sentence, Customise and any note open
 * under the words, and the button names what will happen.
 * @param {object} o
 * @param {string} o.value        the words
 * @param {string} o.placeholder
 * @param {string} o.sentence     pickers (SentencePicker's markup, words between)
 * @param {string} [o.detail]     Customise and the note
 * @param {string} o.tools        the foot's left: +, a preset
 * @param {string} o.send         the foot's right: its one action
 * @param {object} [o.attrs]
 */
export function composer({ value = '', placeholder, sentence, detail = '', tools, send, attrs: a = {} }) {
  return `<form class="composer${sentence ? '' : ' is-plain'}"${attrs(a)}><textarea class="composer-t" rows="2" data-composer-t${attrs({ placeholder, 'aria-label': placeholder })}>${esc(value)}</textarea>${detail}<div class="composer-f">${tools ? `<span class="composer-tools">${tools}</span>` : ''}${sentence ? `<div class="composer-s">${sentence}</div>` : ''}<span class="composer-send">${send}</span></div></form>`;
}

/**
 * TaskCard: a task or a schedule in a conversation, in the anatomy of its own page: title and place above, then the card
 * with the status line (its one action, ⋯) and its stages; what follows opens the page. `compact`: what has not started
 * or has no stages is the status line alone, its title for the word.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.place]    the place line (markup)
 * @param {string} o.mark       KindMark
 * @param {string} o.word       its state word
 * @param {string} [o.detail]   one line under the word
 * @param {string} [o.action]   its one action, then ⋯ (markup)
 * @param {string} [o.stages]   StageBar
 * @param {string} [o.foot]     under the card: the way to its page (markup)
 * @param {boolean} [o.compact]
 * @param {object} [o.attrs]
 */
export function taskCard({ title, place = '', mark, word, detail = '', action = '', stages = '', foot = '', compact = false, attrs: a = {} }) {
  const side = action ? `<div class="rc-side">${action}</div>` : '';
  if (compact) return `<article class="task-card rc is-compact"${attrs(a)}><section class="rc-card"${attrs({ 'aria-label': title })}>${statusLine({ dot: mark, word: title, action: side, detail })}</section></article>`;
  return `<article class="task-card rc"${attrs(a)}><div class="rc-head"><h3 class="rc-heading tc-title"${attrs({ title })}>${esc(title)}</h3>${place ? `<div class="rc-facts">${place}</div>` : ''}</div><section class="rc-card"${attrs({ 'aria-label': `${title}: ${word}` })}>${statusLine({ dot: mark, word, action: side, detail })}${stages ? `<div class="rc-zone"><div class="rc-span">${stages}</div></div>` : ''}</section>${foot ? `<div class="tc-foot">${foot}</div>` : ''}</article>`;
}

/**
 * StageBar: a thing's main stages on a card, each deepening into the state's colour up to where it is.
 * @param {object} o
 * @param {string[]} o.labels
 * @param {number} o.stage    the one it is on, from 0
 * @param {string} [o.tone]   markTone's answer
 */
export function stageBar({ labels, stage, tone = 'run' }) {
  const n = labels.length;
  return `<div class="stage-bar is-${tone}" style="--n:${n}"><div class="sb-cells" aria-hidden="true">${labels.map((_, i) => `<i${i <= stage ? ` style="background:color-mix(in srgb, currentColor ${Math.round(30 + 70 * (i + 1) / (stage + 1))}%, var(--line-2))"` : ''}></i>`).join('')}</div><div class="sb-labels">${labels.map((l, i) => (i === stage ? `<b>${esc(l)}</b>` : `<span>${esc(l)}</span>`)).join('')}</div></div>`;
}
