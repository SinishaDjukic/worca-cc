// A center's parts (docs/rail/panels.md › panel.center, panel.center-shelf): what Tasks, Schedules and Projects share, so a card
// says a task the same way on each. A page says what each thing is; the words and the drawing are here.
import { attrs, esc } from './html.mjs';
import { button } from './button.mjs';
import { list, listRow } from './list.mjs';
import { figuresToggle, figuresLine } from './figures.mjs';
import { cardAction, runState } from './run-state.mjs';
import { alertLevel, kindMark, markTone } from './kind-mark.mjs';

/** How urgent a task's state is on a center: failed first, ready to merge last of what needs you (look.alert-ladder). */
export const taskRank = (id) => (id === 'failed' ? 0 : id === 'question' ? 1 : id === 'gate' ? 2 : id === 'ready' || id === 'approved' ? 3 : 4);

/**
 * What a card says about one task.
 * @param {object} o
 * @param {string} o.state   its runState id
 * @param {string} o.name    its name, as markup (a TextLink to its card)
 * @param {string} [o.detail]
 */
export function taskClause({ state, name, detail = '' }) {
  if (state === 'failed') return `${name} failed at ${esc(detail.split(' · ')[0])}`;
  if (state === 'question') return `${name}: ${esc(detail)}`;
  if (state === 'gate') return `${name} waits for your OK`;
  if (state === 'ready' || state === 'approved') return `${name} is ready to merge`;
  return `${name}: ${esc(detail || runState(state).word)}`;
}

/**
 * A card's actions for the tasks that wait, named when two do; only a Warning's is filled (rail.one-action).
 * @param {{id:string, title:string, short?:string, state:string}[]} tasks  at most two are drawn
 * @returns {string} Buttons, each `data-c-act="does|id"`
 */
export function taskActions(tasks = []) {
  const two = tasks.slice(0, 2);
  return two.map((t) => {
    const a = cardAction(t.state), warn = alertLevel(markTone(runState(t.state))) === 3;
    return button({ label: two.length > 1 ? `${a.label} ${t.short || t.title}` : a.label, kind: warn ? 'primary' : '', attrs: { 'data-c-act': `${a.does}|${t.id}`, title: `${a.label}: ${t.title}` } });
  }).join('');
}

/**
 * CenterSentence: "Showing … by …", Figures at its end, its totals under it when open (look.figures-on-demand).
 * @param {object} o
 * @param {string} o.words   markup: the words and their SentencePickers
 * @param {boolean} [o.open]
 * @param {object} [o.attrs] on Figures
 * @param {string} [o.facts] markup: the totals
 */
export function centerSentence({ words, open = false, attrs: a = {}, facts = '' }) {
  return `<div class="center-sent">${words} ${figuresToggle({ open, attrs: a })}</div>${open ? figuresLine(facts) : ''}`;
}

/**
 * QuietLine: what has nothing going on, folded into one line that opens.
 * @param {object} o
 * @param {number} o.n
 * @param {string} o.noun    project, workflow or workspace
 * @param {string} o.names   who they are, shown while it is folded
 * @param {boolean} [o.open]
 * @param {object} [o.hook]  the attribute that opens it
 */
export function quietLine({ n, noun, names, open = false, hook = {} }) {
  return `<div class="center-quiet">${list({ groups: [{ title: '', rows: [listRow({ title: `${n} quiet ${noun}${n === 1 ? '' : 's'}`, meta: open ? '' : names, mark: kindMark({ kind: noun }), open: { ...hook, 'aria-expanded': String(open), title: open ? 'Folds them' : `Shows the quiet ${noun}s` } })] }] })}</div>`;
}

/**
 * CenterShelf: a group of a center's cards under its name and its worst state word (panel.center-shelf).
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.count]  behind Figures
 * @param {string} [o.link]   markup: a TextLink to where it lives
 * @param {string} [o.word]   its worst state
 * @param {string} [o.tone]   that state's markTone
 * @param {string} [o.facts]  behind Figures
 * @param {string} [o.cards]  PluginCards
 * @param {string} [o.rest]   markup under them: a CenterAlso, a QuietLine
 * @param {object} [o.attrs]
 */
export function centerShelf({ title, count = '', link = '', word = '', tone = '', facts = '', cards = '', rest = '', attrs: a = {} }) {
  const says = [word ? `<span class="pg-state${tone ? ` is-${esc(tone)}` : ''}">${esc(word)}</span>` : '', facts].filter(Boolean).join(' · ');
  return `<section class="pg-shelf center-shelf"${attrs(a)}><h3 class="pg-shelf-h">${esc(title)}${count ? `<span class="n">${esc(count)}</span>` : ''}${link ? `<span class="center-shelf-l">${link}</span>` : ''}</h3>${says ? `<p class="pg-shelf-m">${says}</p>` : ''}${cards ? `<div class="pg-grid">${cards}</div>` : ''}${rest}</section>`;
}

/**
 * CenterAlso: one thing in two groups: its full card under the most urgent, this single line in the other (panel.center-shelf).
 * @param {object} o
 * @param {string} o.mark  its KindMark
 * @param {string} o.name
 * @param {string} o.where the group that holds its card
 * @param {string} o.link  markup: a TextLink to that card
 */
export function centerAlso({ mark, name, where, link }) {
  return `<p class="center-also">${mark}<span><b>${esc(name)}</b> · Also in ${esc(where)} · ${link}</span></p>`;
}
