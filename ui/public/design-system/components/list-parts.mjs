// The parts of a list (docs/rail/lists.md): its sentence, a group row with its members, a run's stacked fix rounds, the
// list's own state, and a chat's marks. list.mjs holds the row and the list; list-page.mjs joins them to a page.
import { attrs, esc } from './html.mjs';
import { button } from './button.mjs';
import { compactMenu } from './compact-menu.mjs';
import { emptyState } from './empty-state.mjs';
import { listRow } from './list.mjs';
import { wordPicker } from './settings-row.mjs';
import { icon } from './icons.mjs';
import { ORIGIN_MARKS, originLabel } from '../../chat-origin.mjs';

/**
 * One word of a sentence: the chosen words and a chevron, its menu under it while open. A pick reports `data-pick="<id>|<item>"`.
 * @param {object} p
 * @param {string} p.id
 * @param {string} p.text
 * @param {object[]} p.items  CompactMenu items; each choice carries `hint`, its count
 * @param {string} [p.tip]
 * @param {object} o
 * @param {string} [o.open]     the id of the open menu
 * @param {string} [o.chevron]
 * @param {string} [o.menuCls]  a state on the menu (its fade)
 */
export function listWord({ id, text, items, tip = '', align = '' }, { open = '', chevron = '', menuCls = '' } = {}) {
  const on = open === id;
  const menu = on ? compactMenu({ items: items.map((it) => (it.sep || it.header ? it : { ...it, id: `${id}|${it.id}` })), cls: `pz-menu${align === 'right' ? ' is-right' : ''}${menuCls}`, pickAttr: 'data-pick', motion: false }) : '';
  return wordPicker({ text, tip, cls: 'is-words', wrapCls: 'pz-pick', chevron: chevron || icon('chevron', 12), open: on, menuHtml: menu, attrs: { 'data-menu': id } });
}

/** small.names-short: a picker holding names says the first two and how many more: "a, b, +3". */
export function namesWord(names = [], shown = 2) {
  return names.length > shown ? `${names.slice(0, shown).join(', ')}, +${names.length - shown}` : names.join(', ');
}

/**
 * The list's sentence: `Showing [what ▾] from [where ▾] by [grouping ▾]`, each choice in its menu with its count.
 * @param {object} o
 * @param {{word:string, id:string, text:string, items:object[], tip?:string}[]} o.parts
 * @param {string} [o.open]
 * @param {string} [o.chevron]
 * @param {string} [o.menuCls]
 */
export function listSentence({ parts, open = '', chevron = '', menuCls = '' }) {
  return parts.map((p) => `<span class="list-part">${esc(p.word)} ${listWord(p, { open, chevron, menuCls })}</span>`).join(' ');
}

/**
 * How every list may be grouped, in one order and one set of words: date first (the default), then state, project,
 * person, topic, AI topics. A list offers the ones it has; byPart makes its sentence's `by` word from them.
 */
export const BY_CHOICES = Object.freeze([
  ['day', 'date', 'Today, Yesterday, Previous 7 days, Previous 30 days, Older'],
  ['state', 'state', 'What waits on you, then what runs, then the rest'],
  ['project', 'project', 'One section per project'],
  ['person', 'person', 'One section per person'],
  ['topic', 'topic', 'Your own groups, one section each'],
  ['ai', 'AI topics', 'A helper job names the topics; your groups are kept'],
]);
export const BY_DEFAULT = 'day';
/**
 * The sentence's `by` word for a list, from the choices it has, in the one order.
 * @param {object} o
 * @param {string} o.by                         the one chosen
 * @param {{id:string, help?:string, hint?:string}[]} o.choices   the ones this list has; a help here says it for this list
 */
export function byPart({ by, choices }) {
  const has = new Map(choices.map((c) => [c.id, c]));
  const items = BY_CHOICES.filter(([id]) => has.has(id)).map(([id, text, help]) => ({ id, text, help: has.get(id).help || help, hint: has.get(id).hint, checked: by === id }));
  return { word: 'by', id: 'by', text: (BY_CHOICES.find(([id]) => id === by) || [by, by])[1], tip: 'How the list is grouped', items };
}
/**
 * A list by date: what waits on you first (head), then one section per day, each folding; Older shows 3.
 * @param {object} o
 * @param {object[]} o.rows        anything with a day
 * @param {(r:object) => string} o.dayOf
 * @param {(r:object) => any} [o.row]   what the section holds for each (the row as it is, by default)
 * @param {object[]} [o.head]      sections above the days (What waits on you)
 * @param {string[][]} [o.days]    DAY_SECTIONS, or NEXT_RUN_SECTIONS for what is still to come
 */
export function dateSections({ rows, dayOf, row = (r) => r, head = [], days = DAY_SECTIONS }) {
  return [...head, ...days.map(([d, title]) => ({ id: `day:${d}`, title, fold: true, limit: d === 'older' || d === 'later' ? 3 : undefined, rows: rows.filter((r) => dayOf(r) === d).map(row) }))];
}
/** The sections of what is still to come, by when it next happens (a schedule's next run). */
export const NEXT_RUN_SECTIONS = Object.freeze([['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['later', 'Later']]);

/** How often a schedule repeats, in the words every schedule picker offers. */
export const REPEATS = Object.freeze(['every day', 'every weekday', 'every Monday', 'every Tuesday', 'every Wednesday', 'every Thursday', 'every Friday', 'every Saturday', 'every Sunday', 'every weekend', 'every month on the 1st', 'every hour', 'once']);
/**
 * A repeat and a time in words, and where the next run falls (small.schedule-words): every hour has no time of day.
 * @param {{every:string, at:string, nowAt?:string}} o  nowAt: the clock, "HH:MM", to place today's run
 * @returns {{says:string, runs:string, next:string, time:string, day:string}} says "Every day at 07:30"; runs, its sentence; next, the status; time, the row's end; day, a NEXT_RUN_SECTIONS id
 */
export function scheduleWords({ every, at, nowAt = '15:00' }) {
  const hourly = every === 'every hour', when = every.replace(/^every /, '');
  const runs = hourly ? every : `${every} at ${at}`, day = /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day$/.test(when) ? when : '';
  const next = hourly ? 'Next within the hour' : every === 'every day' ? `Next ${at > nowAt ? 'today' : 'tomorrow'} at ${at}` : day ? `Next on ${day} at ${at}` : every === 'every weekday' ? `Next weekday at ${at}` : every === 'every weekend' ? `Next weekend at ${at}` : /month/.test(every) ? `Next on the 1st at ${at}` : `Next at ${at}`;
  return { runs, says: `${runs[0].toUpperCase()}${runs.slice(1)}`, next, time: hourly ? 'Hourly' : day ? day.slice(0, 3) : /month/.test(every) ? '1st' : at,
    day: hourly || (every === 'every day' && at > nowAt) ? 'today' : every === 'every day' || every === 'every weekday' ? 'tomorrow' : day ? 'week' : 'later' };
}
/**
 * The dates a schedule runs next (New schedule's preview, a card's Next up), after a given moment.
 * @param {{every:string, at:string, from:Date, n?:number, nowAt?:string}} o  `from` is today; `nowAt` its time of day
 * @returns {Date[]}
 */
export function scheduleDates({ every, at, from, n = 3, nowAt = '15:00' }) {
  const day = /^every (Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day$/.exec(every), DAY = ['Sun', 'Mon', 'Tues', 'Wednes', 'Thurs', 'Fri', 'Satur'].indexOf(day?.[1]);
  const fits = (d) => (day ? d.getDay() === DAY : every === 'every weekday' ? d.getDay() % 6 !== 0 : every === 'every weekend' ? d.getDay() % 6 === 0 : /month/.test(every) ? d.getDate() === 1 : true);
  const out = [], d = new Date(from); if (at <= nowAt) d.setDate(d.getDate() + 1);
  for (let i = 0; i < 800 && out.length < n; i += 1, d.setDate(d.getDate() + 1)) if (fits(d)) out.push(new Date(d));
  return out;
}
/** What a schedule's button says it will do: "Schedule weekdays at 09:00". */
export function scheduleButton({ every, at }) {
  const when = every.replace(/^every /, '');
  return `Schedule ${/month/.test(every) ? 'the 1st of each month' : when === 'day' ? 'every day' : `${when}s`} at ${at}`;
}

/** The times a schedule picker offers: every half hour of the day. */
export const TIMES_OF_DAY = Object.freeze(Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`));

/** The sections of a list by day, newest first (docs/rail/lists.md). */
export const DAY_SECTIONS = Object.freeze([['upcoming', 'Waiting'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Previous 7 days'], ['month', 'Previous 30 days'], ['older', 'Older']]);

/**
 * A group row: a feature, a chain, a person's group, a chat group. A ListRow with its count, its ⌄, and its members under
 * it while open.
 * @param {object} o          listRow's options, and:
 * @param {string} o.count    "2/3"
 * @param {boolean} o.shown   its members show
 * @param {string} o.noun     "runs"
 * @param {object} o.toggle   attrs of the ⌄
 * @param {string} [o.rows]   the member rows' markup
 */
export function groupRow({ count, shown, noun, toggle, rows = '', end = '', ...row }) {
  const foldName = `${shown ? 'Hide' : 'Show'} the ${noun} in ${row.title}`;   // the chevron and the mark fold the same thing: one name
  const fold = button({ label: foldName, kind: 'quiet', iconOnly: true, title: false, icon: icon(shown ? 'chevron' : 'chevR', 14), attrs: { 'aria-expanded': String(shown), ...toggle } });
  return listRow({ ...row, endText: count, end: fold + end, markFold: { open: shown, attrs: toggle, label: foldName }, after: shown && rows ? `<div class="lr-members" role="list"><div class="list-rows">${rows}</div></div>` : '' });   // its mark folds it too
}

/**
 * A run's PR fix rounds, stacked under it: the newest round's line and `7 rounds`; while open each round, newest first, then `+n earlier`.
 * @param {object} o
 * @param {string} o.line       the stack's line
 * @param {number} o.n
 * @param {boolean} o.open
 * @param {object} o.toggle     attrs of `7 rounds`
 * @param {{n:number, words:string, time?:string, attrs?:object}[]} [o.rounds]  the ones shown
 * @param {{n:number, attrs:object}} [o.more]   the ones not shown yet
 */
export function roundRows({ line, n, open, toggle, rounds = [], more = null }) {
  const word = `${n} ${n === 1 ? 'round' : 'rounds'}`;
  const head = `<button type="button" class="lr-round-line"${attrs({ 'aria-expanded': String(open), 'aria-label': `${open ? 'Hide' : 'Show'} the ${word}`, title: line, ...toggle })}><span class="lr-m">${esc(line)}</span><span class="lr-round-end">${esc(word)}${icon(open ? 'chevron' : 'chevR', 12)}</span></button>`;
  if (!open) return `<div class="lr-rounds">${head}</div>`;
  return `<div class="lr-rounds">${head}<div class="list-rows">${rounds.map((r) => listRow({ title: `Round ${r.n} · ${r.words}`, endText: r.time || '', open: r.attrs || null })).join('')}</div>${more ? button({ label: `+${more.n} earlier`, kind: 'quiet', attrs: more.attrs }) : ''}</div>`;
}

/**
 * ResetView: the list's Reset view tool. Available, it says where it goes; at the default it is off and says why (list.reset-view).
 * @param {object} o
 * @param {boolean} o.changed  the view differs from the default
 * @param {string} o.to        the default, in the sentence's own words ("all tasks, from all projects, by date")
 */
export function resetViewTool({ changed, to }) {
  return { id: 'reset', text: 'Reset view', off: !changed, help: changed ? `Back to ${to}` : 'This is already the default view' };
}

/**
 * What a list says instead of rows: loading (a page draws nothing for its first 300ms), offline, could not load, empty.
 * @param {object} o
 * @param {'loading'|'offline'|'failed'|'empty'} o.state
 * @param {string} o.noun      "runs"
 * @param {string} [o.text]    empty: its words ("Nothing needs you.")
 * @param {object} [o.retry]   Try again's attrs
 * @param {string} [o.action]  empty: the one way on, a Button
 */
export function listState({ state, noun, text = '', retry = null, action = '' }) {
  const again = retry ? button({ label: 'Try again', kind: 'quiet', attrs: retry }) : '';
  if (state === 'loading') return emptyState({ title: `Loading ${noun}…` });
  if (state === 'offline') return emptyState({ title: `The ${noun} show here once Worca's server is reachable again.`, actions: again });
  if (state === 'failed') return emptyState({ title: `Could not load the ${noun}`, text: 'The server did not answer. Nothing changed.', actions: again, error: true });
  return emptyState({ title: text || `No ${noun} yet.`, actions: action });
}

// The app's own marks (chat-origin.mjs): filled with the text's colour; any other platform gets a plug.
/** A chat a chat integration opened wears its platform's logo before its title. */
export function originMark({ platform, label = '' }) {
  const d = Object.hasOwn(ORIGIN_MARKS, platform) ? ORIGIN_MARKS[platform] : '';
  const name = originLabel({ platform, label });
  if (!d) return `<span class="lr-origin"${attrs({ title: name, 'aria-label': name, role: 'img' })}>${icon('plug', 12)}</span>`;
  return `<span class="lr-origin"${attrs({ title: name, 'aria-label': name, role: 'img' })}><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"></path></svg></span>`;
}

/** An idle chat's mark: what it did, its kind's icon in the dot's place. */
export function chatKindIcon({ icon: name, label }) {
  return `<span class="lr-kind"${attrs({ title: label, 'aria-label': label, role: 'img' })}>${icon(name, 14)}</span>`;
}
