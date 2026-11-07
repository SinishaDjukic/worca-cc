// What a row is and how it stands, in one mark (docs/rail/lists.md, docs/rail/look.md): the type's icon, inside one smooth
// ring that fills by main stage and deepens into the state's colour. The dot and the icon are one thing: while work
// happens the whole mark breathes. A question, a problem, a pause or a stop takes the centre.
import { attrs, esc } from './html.mjs';
import { icon } from './icons.mjs';
import { statusLine } from './status-line.mjs';
import { orbMark } from './orb.mjs';
import { button, splitButton } from './button.mjs';

const STAGES = 5;
const R = 9, L = 2 * Math.PI * R;
const CENTRE = { ask: 'question', act: 'alert', fail: 'sym-x', pause: 'pause', stop: 'sym-stop' };
const TYPED = new Set(['feature', 'workflow']), NEEDS_YOU = new Set(['ask', 'act', 'fail']);
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
 * @param {boolean} [o.keepType]  the type stays in the centre whatever the state (a summary of many)
 */
export function kindMark({ kind = 'task', tone = 'idle', stage = -1, stages = STAGES, size = 20, title = '', keepType = false } = {}) {
  const noRing = kind === 'event' || tone === 'idle' || (kind === 'schedule' && tone === 'wait');
  const reach = tone === 'wait' ? 0 : stage < 0 ? 1 : Math.min(1, (stage + 1) / stages);
  const arc = (from, len, stroke, k = -1) => `<circle cx="10" cy="10" r="${R}" fill="none" stroke="${stroke}" stroke-width="1.1" stroke-dasharray="${len.toFixed(2)} ${(L - len).toFixed(2)}" stroke-dashoffset="${(L / 4 - from).toFixed(2)}"${k >= 0 ? ` style="--k:${k}"` : ''}></circle>`;   // --k: a filled step's order, so a changed mark's ring can fill in turn
  let ring = '';
  if (!noRing) {
    ring = arc(0, L, 'var(--line-2)');
    const steps = Math.round(48 * reach);
    for (let k = 0; k < steps; k++) ring += arc(k * (L / 48), L / 48 + 0.15, `color-mix(in srgb, currentColor ${Math.round(30 + 70 * (k + 1) / steps)}%, var(--line-2))`, k);
  }
  const typed = TYPED.has(kind) && !NEEDS_YOU.has(tone);   // a Shaper task or a workflow run says so; only what needs you takes its centre
  const centre = !noRing && !keepType && !typed && CENTRE[tone] ? CENTRE[tone] : KINDS[kind] || KINDS.task;
  const glyph = icon(centre, Math.round((noRing ? 15 : centre === 'question' || centre === 'alert' ? 14 : 11) * size / 20));
  return `<span class="kind-mark is-${tone}"${attrs({ style: `--km:${size}px`, title: title || null, role: title ? 'img' : null, 'aria-label': title || null, 'aria-hidden': title ? null : 'true' })}>${ring ? `<svg class="km-ring" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">${ring}</svg>` : ''}${glyph}</span>`;
}

/**
 * How far a thing made of parts is, in words: "2 of 3" (parts merged, ready or applied, of all).
 * @param {string[]} parts  markTone answers
 */
export function partsWord(parts = []) {
  return `${parts.filter((t) => t === 'ok' || t === 'merged').length} of ${parts.length}`;
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
 * ThinkingRow: Worca thinking, as one turn on the rail. While it thinks: Worca's orb (OrbMark) turning, one line saying what
 * it does now ("Thinking" only until it says), a slow light passing through it, and its seconds. Done, the same row reads "Thought for
 * 8s" and folds its steps under it, one line each; the row never moves.
 * @param {object} o
 * @param {boolean} [o.done]
 * @param {string} [o.step]      now: what it does, "Searching the code for “export”"
 * @param {string} [o.secs]      now: "4s"; done: the whole time, "8s"
 * @param {string[]} [o.steps]   done: what it did
 * @param {'think'|'tool'|'write'} [o.phase]  now: the orb's phase; writing the answer spins it
 * @param {boolean} [o.open]
 * @param {object} [o.attrs]     done: the fold's hook (data-fold-turn)
 */
export function thinkingRow({ done = false, step = '', secs = '', steps = [], phase = 'think', open = false, attrs: a = {} } = {}) {
  if (!done) return turnRow({ mark: orbMark({ phase, size: 18 }), text: `<span class="think-w">${esc(step || 'Thinking')}</span>`, end: `<span class="think-t">${esc(secs)}</span>`, attrs: { 'aria-live': 'polite', ...a } });
  const body = steps.length ? `<span class="think-steps">${steps.map((x) => `<span>${esc(x)}</span>`).join('')}</span>` : '';
  return turnRow({ mark: icon(open ? 'chevron' : 'chevR', 14), text: `Thought for ${esc(secs)}`, body, open, attrs: a }).replace('class="tr-body"', 'class="tr-body is-steps"');
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
 * CardHead: the one head every chat card has: its kicker (its mark and one word: Proposed, Running, Plan), its title, at most
 * one line under it, and its facts (a branch, a place). TaskCard, TaskProposal, ChangeProposal and PlanCard all use it.
 * @param {object} o
 * @param {string} o.mark
 * @param {string} o.kicker
 * @param {string} [o.kickerHtml]   instead, markup (the plan's version picker inside it)
 * @param {string} [o.title]        plain words; or titleHtml (TaskProposal's input)
 * @param {string} [o.titleHtml]
 * @param {string} [o.why]
 * @param {string} [o.facts]        markup
 * @param {string} [o.menu]         its ⋯, at the head's right
 */
export function cardHead({ mark, kicker, kickerHtml = '', title = '', titleHtml = '', why = '', facts = '', menu = '' }) {
  return `<div class="rc-head"><p class="tp-kicker">${mark}<span>${kickerHtml || esc(kicker)}</span>${menu ? `<span class="tp-menu">${menu}</span>` : ''}</p>${titleHtml || `<h3 class="rc-heading tc-title"${attrs({ title })}>${esc(title)}</h3>`}${facts ? `<div class="rc-facts">${facts}</div>` : ''}${why ? `<p class="tp-why">${esc(why)}</p>` : ''}</div>`;
}

/**
 * TaskCard: a task in a conversation, in every chat card's shape: its head (its mark and state word, its title, one line
 * where it is, its branch), its stage bar, its one action and ⋯, then How it ran, which opens its whole stage stream in
 * place (`stream`, when `open`). Compact (waiting, scheduled, a schedule): one line, its action at its end.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.place]    its facts: the branch, into dev, git's icon (markup)
 * @param {string} o.mark       KindMark
 * @param {string} o.word       its state word
 * @param {string} [o.detail]   one line under the title
 * @param {string} [o.action]   its one action (markup)
 * @param {string} [o.menu]     its ⋯ (markup), at its head's right
 * @param {string} [o.stages]   StageBar
 * @param {string} [o.rows]     a feature's slices, one TurnRow each (markup)
 * @param {string} [o.foot]     How it ran (markup)
 * @param {string} [o.stream]   what How it ran opens (markup)
 * @param {boolean} [o.open]
 * @param {boolean} [o.compact]
 * @param {object} [o.attrs]
 */
export function taskCard({ title, place = '', mark, word, detail = '', action = '', menu = '', stages = '', rows = '', foot = '', stream = '', open = false, compact = false, attrs: a = {} }) {
  if (compact) return `<article class="task-card rc is-compact"${attrs(a)}>${turnRow({ mark, text: `<b>${esc(title)}</b> ${esc(detail)}`, end: action })}</article>`;
  return `<article class="task-card rc${open ? ' is-open' : ''}"${attrs(a)}>${cardHead({ mark, kicker: word, title, why: detail, facts: place, menu })}<section class="rc-card tp-body"${attrs({ 'aria-label': `${title}: ${word}` })}>${stages}${rows ? `<div class="tc-rows">${rows}</div>` : ''}${action ? `<div class="tp-actions">${action}</div>` : ''}</section>${foot ? `<div class="tc-foot">${foot}</div>` : ''}${open && stream ? `<div class="tc-stream">${stream}</div>` : ''}</article>`;
}

/**
 * TaskProposal: a task Worca proposes, before anything starts; the running TaskCard's shape, so Start turns it into that
 * card in place. Its head: Proposed, the title (edited in place) and one line why. Its body: the composer's own sentence
 * (project · workflow · engine · then), Customise folding open to the composer's own rows, one quiet line offering to shape
 * it first when it has open decisions, and one action: Start, beside a quiet Not now.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.why]
 * @param {string} o.sentence     the composer's SentencePickers, as markup
 * @param {string} [o.more]       Customise's rows, as markup; open when given with `open`
 * @param {boolean} [o.open]
 * @param {string} [o.nudge]      the line offering to shape it first, as markup (its button inside)
 * @param {string} [o.start]      its primary's word: Start, Schedule, Start planning
 * @param {string} [o.kicker]     Proposed, or Proposed · from preset Hotfix
 * @param {string} [o.extra]      a quiet action at the row's far end (Edit in the composer)
 * @param {{open:boolean, menu:string, attrs:object}} [o.alts]   other ways to start (Run as is, Shape it first): Start's ▾
 * @param {object} [o.hooks]      { title, more, start, later }: each control's attributes
 * @param {object} [o.attrs]
 */
export function taskProposal({ title, why = '', sentence, more = '', open = false, nudge = '', start = 'Start', kicker = 'Proposed task', extra = '', alts = null, hooks = {}, attrs: a = {} }) {
  const btn = (label, kind, h, extra = {}) => button({ label, kind, attrs: { ...extra, ...(h || {}) } });
  return `<article class="task-card rc tp"${attrs(a)}>${cardHead({ mark: kindMark({ kind: 'task', tone: 'idle', size: 16 }), kicker, titleHtml: `<span class="tp-title-w"><input class="tp-title"${attrs({ value: title, 'aria-label': 'Task title', spellcheck: 'false', ...(hooks.title || {}) })}><span class="tp-edit" aria-hidden="true">${icon('edit', 13)}</span></span>`, why })}`
    + `<section class="rc-card tp-body"${attrs({ 'aria-label': `Proposed: ${title}` })}><div class="tp-sentence">${sentence}</div>${nudge ? `<p class="tp-nudge">${nudge}</p>` : ''}`
    + `<div class="tp-more">${btn(open ? 'Hide Customise' : 'Customise', 'quiet', hooks.more, { 'aria-expanded': String(!!open), title: 'Title, labels, branch, memory, guardrails and more' })}${open && more ? `<div class="composer-more">${more}</div>` : ''}</div>`
    + `<div class="tp-actions">${alts ? splitButton({ main: { label: start, kind: 'primary', attrs: hooks.start || {} }, moreLabel: 'Other ways to start', chevron: icon('chevron', 12), open: alts.open, menuHtml: alts.menu, moreAttrs: alts.attrs || {} }) : btn(start, 'primary', hooks.start)}${btn('Not now', 'quiet', hooks.later)}${extra ? `<span class="tp-extra">${extra}</span>` : ''}</div></section></article>`;
}

/**
 * ChangeProposal: a change Worca proposes to something that is not a task (a setting, a workflow, a schedule): what it is,
 * one line why, each change as before → after (or a body such as a WorkflowGraph), then Apply beside a quiet Not now. Once
 * applied it is a one-line receipt with Revert; declined or failed, one quiet line. The TaskProposal's family.
 * @param {object} o
 * @param {string} o.kind        what it changes: Models, Away, Schedule, Workflow
 * @param {string} o.title
 * @param {string} [o.why]
 * @param {{name:string, before:string, after:string}[]} [o.rows]
 * @param {string} [o.body]      instead of rows, markup (a WorkflowGraph)
 * @param {'proposed'|'applied'|'declined'|'failed'} [o.state]
 * @param {string} [o.apply]     Apply's word: Apply, Save
 * @param {{label:string, kind?:string, attrs?:object}[]} [o.actions]   instead, a kind's own choices (web access: Allow in chat, Always allow, Deny; a schedule: Run now, Move, Apply, Delete)
 * @param {string} [o.menu]      its ⋯
 * @param {object} [o.hooks]     { apply, decline, revert }
 * @param {object} [o.attrs]
 */
export function changeProposal({ kind, title, why = '', rows = [], body = '', state = 'proposed', apply = 'Apply', actions = null, menu = '', hooks = {}, attrs: a = {} }) {
  const btn = (label, k, h, c = '') => button({ label, kind: k, cls: c, attrs: h || {} });
  if (state === 'applied') return turnRow({ mark: icon('check', 14), text: `<b>${esc(title)}</b> ${esc(rows.map((r) => `${r.name}: ${r.after}`).join(' · ') || kind)}`, end: btn('Revert', 'quiet', hooks.revert), attrs: a });
  if (state !== 'proposed') return turnRow({ mark: kindMark({ kind: 'chat', tone: state === 'failed' ? 'fail' : 'idle', size: 16 }), text: `${state === 'failed' ? 'Could not change' : 'Not changed'}: <b>${esc(title)}</b>`, attrs: a });
  const list = rows.length ? `<dl class="cp-rows">${rows.map((r) => `<div class="cp-row"><dt>${esc(r.name)}</dt><dd>${r.before && r.before !== '—' ? `<s>${esc(r.before)}</s><span aria-hidden="true">→</span>` : ''}<b>${esc(r.after)}</b></dd></div>`).join('')}</dl>` : '';
  return `<article class="task-card rc cp"${attrs(a)}>${cardHead({ mark: icon('set-general', 14), kicker: kind, title, why, menu })}`
    + `<section class="rc-card tp-body"${attrs({ 'aria-label': `Proposed change: ${title}` })}>${list}${body}<div class="tp-actions">${actions ? actions.map((x) => (x.kind === 'danger' ? btn(x.label, 'quiet', x.attrs, 'is-danger') : btn(x.label, x.kind || 'quiet', x.attrs))).join('') : `${btn(apply, 'primary', hooks.apply)}${btn('Not now', 'quiet', hooks.decline)}`}</div></section></article>`;
}

/**
 * TurnDivider: a quiet rule across the conversation with a few words on it, where its ground changes ("Switched to
 * billing-api").
 * @param {object} o
 * @param {string} o.text
 */
export function turnDivider({ text }) {
  return `<div class="turn-div" role="separator"${attrs({ 'aria-label': text })}><span>${esc(text)}</span></div>`;
}

/**
 * PlanCard: the Shaper's plan, when it stops for you: its version (a picker of earlier ones), its title, one line on what
 * it does, "Reviewed by N roles · M open" folding open to one row per role (its mark, name, what it said), then Approve
 * and build beside Ask for changes and Full plan. A disagreement between roles comes after it as a question.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.summary]
 * @param {string} o.version          its picker (a SentencePicker), or plain words: "v2 of 2"
 * @param {{name:string, ok:boolean, note:string}[]} o.roles
 * @param {boolean} [o.open]
 * @param {string} [o.menu]           its ⋯ (Fix all, Save to plans/, Open in the composer, Stop)
 * @param {string} [o.extra]          lines above the review (the Shape check, Perspectives with Update plan)
 * @param {object} [o.hooks]          { roles, approve, changes, full }
 * @param {string} [o.full]           the plan itself (markup: its sections), read before approving; Full plan folds it open here
 * @param {boolean} [o.fullOpen]
 * @param {object} [o.attrs]
 */
export function planCard({ title, summary = '', version, roles, open = false, menu = '', extra = '', hooks = {}, full = '', fullOpen = false, attrs: a = {} }) {
  const left = roles.filter((r) => !r.ok).length;
  const rows = roles.map((r) => turnRow({ mark: kindMark({ kind: 'chat', tone: r.ok ? 'ok' : 'ask', size: 16, keepType: false }), text: `<b>${esc(r.name)}</b> ${esc(r.note)}` })).join('');
  const reviewed = turnRow({ mark: icon(open ? 'chevron' : 'chevR', 14), text: `Reviewed by ${roles.length} roles${left ? ` · ${left} open` : ''}`, body: `<span class="plan-roles">${rows}</span>`, open, attrs: { 'data-fold-turn': '', ...(hooks.roles || {}) } }).replace('class="tr-body"', 'class="tr-body is-steps"');
  return `<article class="task-card rc plan"${attrs(a)}>${cardHead({ mark: kindMark({ kind: 'task', tone: 'ask', size: 16 }), kicker: 'Plan', kickerHtml: `Plan · ${version}`, title, why: summary, menu })}`
    + `<section class="rc-card tp-body"${attrs({ 'aria-label': `Plan: ${title}` })}>${fullOpen && full ? `<div class="plan-full">${full}</div>` : ''}${extra}${reviewed}<div class="tp-actions">${button({ label: 'Approve and build', kind: 'primary', attrs: hooks.approve || {} })}${button({ label: 'Ask for changes', kind: 'quiet', attrs: hooks.changes || {} })}${full ? button({ label: fullOpen ? 'Hide the plan' : 'Full plan', kind: 'quiet', icon: icon(fullOpen ? 'chevron' : 'chevR', 12), attrs: { 'aria-expanded': String(fullOpen), ...(hooks.full || {}) } }) : ''}</div></section></article>`;
}

/**
 * FilesCard: files Worca shows you: pictures as tiles, other files as rows, each with Download; View opens it.
 * @param {object} o
 * @param {{name:string, meta?:string, image?:boolean, view?:object, download?:object}[]} o.files
 * @param {string} [o.label]
 */
export function filesCard({ files, label = 'Files' }) {
  const pics = files.filter((f) => f.image), docs = files.filter((f) => !f.image);
  const tile = (f) => `<figure class="fc-tile"><button type="button" class="fc-pic"${attrs({ 'aria-label': `View ${f.name}`, ...(f.view || {}) })}>${icon('image', 20)}</button><figcaption><span>${esc(f.name)}</span>${button({ label: `Download ${f.name}`, kind: 'quiet', iconOnly: true, icon: icon('download', 14), attrs: f.download || {} })}</figcaption></figure>`;
  const row = (f) => turnRow({ mark: icon('file', 14), text: `<b>${esc(f.name)}</b> ${esc(f.meta || '')}`, end: button({ label: 'View', kind: 'quiet', attrs: f.view || {} }) + button({ label: `Download ${f.name}`, kind: 'quiet', iconOnly: true, icon: icon('download', 14), attrs: f.download || {} }) });
  return `<div class="files-card"${attrs({ role: 'group', 'aria-label': label })}>${pics.length ? `<div class="fc-grid">${pics.map(tile).join('')}</div>` : ''}${docs.map(row).join('')}</div>`;
}

/**
 * YouTurn: what you said, on the right: your words, then what came with them (a quote you answered, files you attached).
 * @param {object} o
 * @param {string} o.text
 * @param {string} [o.quote]
 * @param {string[]} [o.files]
 * @param {{text:string, mark?:string, attrs?:object}[]} [o.refs]   tasks named in it: chips that lead to their cards
 * @param {object} [o.attrs]
 */
export function youTurn({ text, quote = '', files = [], refs = [], attrs: a = {} }) {
  const chips = refs.map((r) => `<button type="button" class="kind-chip you-ref"${attrs({ title: `Opens ${r.text} in its chat`, ...(r.attrs || {}) })}>${r.mark || ''}${esc(r.text)}</button>`).join('');
  return `<div class="convo-you"${attrs(a)}>${quote ? `<blockquote class="you-quote">${esc(quote)}</blockquote>` : ''}${esc(text)}${files.length || chips ? `<span class="you-files">${files.map((f) => `<span class="kind-chip">${icon('file', 12)}${esc(f)}</span>`).join('')}${chips}</span>` : ''}</div>`;
}

/**
 * StageLine: a stage of a task, read down like a conversation: its mark, its name and time, its parts at its end
 * (Decisions, Changes, Activity), and what it opens under it.
 * @param {object} o
 * @param {string} o.mark
 * @param {string} o.label
 * @param {string} [o.meta]
 * @param {string} [o.parts]   buttons
 * @param {string} [o.body]    what is open under it
 * @param {boolean} [o.next]   not started: quiet
 * @param {object} [o.attrs]   on its line (the click that opens it)
 */
export function stageLine({ mark, label, meta = '', parts = '', body = '', next = false, attrs: a = {} }) {
  return `<div class="stage-line${body ? ' is-open' : ''}${next ? ' is-next' : ''}"><div class="stage-head">${turnRow({ mark, text: `<b>${esc(label)}</b>`, end: esc(meta), attrs: { 'data-fold-turn': '', ...a } })}${parts ? `<span class="stage-tools">${parts}</span>` : ''}</div>${body}</div>`;
}

/**
 * StagePart: a part of a task at its stage's end, saying what is inside before it opens; open, it shows under the stage.
 * @param {object} o
 * @param {string} o.label   the part: Decisions, Changes, Activity
 * @param {string} [o.says]  what is inside, in a few words: 5 files +358 −144
 * @param {boolean} [o.open]
 * @param {object} [o.attrs]
 */
export function stagePart({ label, says = '', open = false, attrs: a = {} }) {
  return `<button type="button" class="stage-part-b${open ? ' is-open' : ''}"${attrs({ 'aria-expanded': String(!!open), ...a })}><b>${esc(label)}</b>${says ? `<span>${esc(says)}</span>` : ''}${icon('chevron', 10)}</button>`;
}

/**
 * StageBar: a thing's main stages on a card, filled up to where it is; the state's colour marks the stage it is on (a failed Build
 * is red, the Plan before it is not), and done or merged wear theirs all along.
 * @param {object} o
 * @param {string[]} o.labels
 * @param {number} o.stage    the one it is on, from 0
 * @param {string} [o.tone]   markTone's answer
 */
export function stageBar({ labels, stage, tone = 'run' }) {
  const n = labels.length, whole = tone === 'ok' || tone === 'merged';   // done and merged wear their colour all along; a failure, a question, a pause only where it is
  const fill = (i) => (whole || i === stage ? `color-mix(in srgb, currentColor ${Math.round(30 + 70 * (i + 1) / (stage + 1))}%, var(--line-2))` : `color-mix(in srgb, var(--ink-3) ${Math.round(30 + 50 * (i + 1) / (stage + 1))}%, var(--line-2))`);
  return `<div class="stage-bar is-${tone}" style="--n:${n}"><div class="sb-cells" aria-hidden="true">${labels.map((_, i) => `<i${i <= stage ? ` style="background:${fill(i)}"` : ''}></i>`).join('')}</div><div class="sb-labels">${labels.map((l, i) => (i === stage ? `<b>${esc(l)}</b>` : `<span>${esc(l)}</span>`)).join('')}</div></div>`;
}
