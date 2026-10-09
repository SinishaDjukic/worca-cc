// src/shared/away-mode/describe.mjs — the ONE source of Away mode's plain-English text: the Settings
// card summary, the project card, the run page pill, the New-run hint, Ask Worca and its card.
// Pure; `now` is passed in. Copy: plans/away-mode-wording.md §3.1 A, §3.2, §3.3, §3.4.
import { inWindow, nightState, decideDelayMs, parseWindow, windowStartMs } from './activation.mjs';
import { kindLabel, pillText } from './labels.mjs';

const MIN = 60_000;

function zoneOk(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return true; } catch { return false; }
}
/** The zone the hours are read in: the configured one when valid, else the local one. */
export function zoneOf(config, localZone) {
  return zoneOk(config.timeZone) ? config.timeZone : (localZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
}
export function fmtHHMM(ms, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
}
const joinAnd = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

function hoursOf(config) {
  const w = parseWindow(config.window);
  return w ? config.window.split('-') : null;
}

// Where the status buttons are, on a surface that does not show them (the project tab, Ask Worca's chat).
const SETTINGS_PLACE = ' in Settings › Away mode';

function statusLine(config, toggle, now, tz, localZone, surface, hereSince) {
  const where = surface === 'settings' ? '' : SETTINGS_PLACE;
  // Name the zone when it is not the local one, or when the configured zone was unusable (we fell back).
  const fellBack = !!config.timeZone && !zoneOk(config.timeZone);
  const zoneTag = tz !== localZone || fellBack ? ` ${tz}` : '';
  const hours = hoursOf(config);
  if (toggle === 'off') return { status: 'paused', text: `Away mode is paused. worca answers nothing until you turn it back on${where}. (Marked runs wait too.)` };
  if (toggle === 'on') return { status: 'away-now', text: `Right now you count as away because you said "I'm away now". worca answers on every run until you click "I'm back"${where}.` };
  if (!hours) {
    const extra = config.graceMinutes != null ? `, or on a marked run after a question has waited ${config.graceMinutes} minutes` : '';
    return { status: 'no-hours', text: `No away hours are set. worca only answers when you click "I'm away now"${where}${extra}.` };
  }
  const cfg = { ...config, timeZone: tz };
  const start = windowStartMs(cfg.window, tz, now);
  if (start != null && Number.isFinite(hereSince) && hereSince >= start) return { status: 'here-now', text: `Right now it is ${fmtHHMM(now, tz)}${zoneTag}. You count as here because you said "I'm back". Your away hours apply again from ${hours[0]}.` };
  if (start != null) return { status: 'away-hours', text: `Right now it is ${fmtHHMM(now, tz)}${zoneTag}. You count as away (your away hours). They end at ${hours[1]}.` };
  return { status: 'here', text: `Right now it is ${fmtHHMM(now, tz)}${zoneTag}. You count as here. Next away hours start at ${hours[0]}.` };
}

function scheduleLines(config) {
  const hours = hoursOf(config);
  const lines = [];
  if (hours) {
    lines.push(config.enabled === true
      ? `From ${hours[0]} to ${hours[1]}, worca answers questions on all runs.`
      : `From ${hours[0]} to ${hours[1]}, worca answers questions on runs you marked. Other runs wait for you.`);
    lines.push(config.graceMinutes != null
      ? `Outside those hours, a marked run is answered once a question has waited ${config.graceMinutes} minutes. Unmarked runs always wait.`
      : 'Outside those hours, every run waits for you.');
  }
  return lines;
}

// Which stored fields shape each summary line (wording §3.2: a project marks its overridden lines).
const LINE_FIELDS = { status: ['window', 'timeZone'], schedule: ['window', 'enabled'], byDay: ['graceMinutes'], kinds: ['neverDecide'], decider: ['deciderModel', 'deciderEffort'] };
const PROJECT_TAG = ' (this project)';

/** "worca weighs the options with Opus 5.5 at high effort." — only when a model is set and the
 *  method may weigh the options (never with "Always trust the agent's recommendation"). */
function deciderLine(config, modelLabel) {
  const id = typeof config.deciderModel === 'string' && config.deciderModel ? config.deciderModel : null;
  if (!id || config.strategy === 'weights') return null;
  const name = (typeof modelLabel === 'function' && modelLabel(id)) || id;
  return `worca weighs the options with ${name}${config.deciderEffort ? ` at ${config.deciderEffort} effort` : ''}.`;
}

/** The card summary. `surface`: 'settings' (the card with the status buttons), 'project' (the project tab) or
 *  'chat' (Ask Worca); off Settings, a line that asks for a status button says where it is.
 *  `modelLabel(id)` names a model for the "Decided by" line (the catalog label); absent → the id.
 *  @returns {{status:string, lines:string[]}} */
export function describeAwayMode({ config, toggle = 'auto', now, localZone = null, projectName = null, projectFields = null, surface = 'settings', hereSince = null, modelLabel = null } = {}) {
  try {
    if (!config || typeof config !== 'object' || !Number.isFinite(now)) return { status: 'unknown', lines: ['Away mode settings could not be read.'] };
    const local = localZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tz = zoneOf(config, local);
    const own = new Set(Array.isArray(projectFields) ? projectFields : []);
    const tag = (text, key) => (LINE_FIELDS[key].some((f) => own.has(f)) ? `${text}${PROJECT_TAG}` : text);
    const s = statusLine(config, toggle, now, tz, local, surface, hereSince);
    const sched = scheduleLines(config);
    const lines = [tag(s.text, 'status'), ...sched.map((l, i) => tag(l, i === 0 ? 'schedule' : 'byDay'))];
    const kinds = Array.isArray(config.neverDecide) ? config.neverDecide : [];
    if (kinds.length) lines.push(tag(`${joinAnd(kinds.map(kindLabel))} always wait for you, even when you are away.`, 'kinds'));   // wording §3.1 A line 4, fixed text
    const decider = deciderLine(config, modelLabel);
    if (decider) lines.push(tag(decider, 'decider'));
    if (projectName) lines[0] = `For ${projectName}: ${lines[0]}`;
    return { status: s.status, lines };
  } catch {
    return { status: 'unknown', lines: ['Away mode settings could not be read.'] };
  }
}

/** One run's state for the pill and the tooltip. */
export function describeRun({ config, toggle = 'auto', now, run = {}, localZone = null, hereSince = null } = {}) {
  try {
    if (run.done) return { state: 'never', pill: pillText('never'), reason: 'The run is over.' };
    if (!config || typeof config !== 'object') return { state: 'unknown', pill: '', reason: '' };   // settings not loaded yet
    const tz = zoneOf(config, localZone);
    const cfg = { ...config, timeZone: tz };
    const st = nightState({ config: cfg, toggle, optIn: run.optIn === true, override: run.override || 'auto', now, hereSince });
    if (run.override === 'off') return { state: 'never', pill: pillText('never'), reason: 'You set this run to "Never on this run".' };
    // An open question with no openedAt is on an always-wait kind: it waits, whatever the hour (spec §3.1).
    if (run.waiting === true && !run.openedAt) return { state: 'wait', pill: pillText('wait'), reason: 'This kind of question is on your "Always wait for me on…" list.' };
    if (!st.eligible) return { state: 'wait', pill: pillText('wait'), reason: toggle === 'off' ? 'Away mode is paused.' : 'This run is not marked and your settings allow only marked runs.' };
    if (st.active) return { state: 'now', pill: pillText('now'), reason: run.override === 'on' ? 'You set this run to "Answer for me now".' : toggle === 'on' ? 'You said "I\'m away now".' : 'You are inside your away hours.' };
    const openedAt = run.openedAt ? Date.parse(run.openedAt) : now;
    if (st.graceOn) {
      const delay = decideDelayMs({ state: { ...st, wakeOn: false }, config: cfg, openedAt, now });
      if (delay != null && delay <= 0) return { state: 'now', pill: pillText('now'), reason: 'The question has waited long enough; worca is answering it.' };   // due: never "answers after 1 min"
      if (delay != null) return { state: 'after', pill: pillText('after', delay / MIN), minutes: Math.max(1, Math.round(delay / MIN)), reason: hoursOf(config) ? 'A marked run is answered by day once a question has waited long enough.' : 'A marked run is answered once a question has waited long enough.' };
    }
    if (!hoursOf(config)) return { state: 'wait', pill: pillText('wait'), reason: run.optIn === true ? 'Marked runs wait for you too, until you say you are away.' : 'Unmarked runs wait for you until you say you are away.' };
    return { state: 'wait', pill: pillText('wait'), reason: run.optIn === true ? 'You count as here, and your settings say marked runs wait by day too.' : 'You count as here, and unmarked runs wait for you by day.' };
  } catch {
    return { state: 'wait', pill: pillText('wait'), reason: 'Away mode settings could not be read.' };
  }
}

/** The New-run toggle's hint (proposal §3.4). */
export function describeNewRun({ config, toggle = 'auto' } = {}) {
  if (!config) return '';
  if (toggle === 'off') return 'Away mode is paused: even a marked run waits for you until you turn it back on.';
  const hours = hoursOf(config);
  const n = config.graceMinutes;
  if (config.enabled === true) return `Your settings already allow every run while you are away.${n != null ? ` Marking adds the ${n}-minute rule${hours ? ' by day' : ''}.` : ''}`;
  const when = hours ? `Settings › Away mode: ${hours[0]}–${hours[1]}, or "I'm away now"` : 'Settings › Away mode: "I\'m away now"';
  return `While you are away (${when}), worca answers this run's questions.${n != null ? ` ${hours ? 'By day it' : 'It'} also answers once a question has waited ${n} minutes.` : ''}`;
}

/** Lines 2–3 before and after a stored change (the Ask Worca card). */
export function describeChange(before, after, { toggle = 'auto', now, localZone = null } = {}) {
  const pick = (c) => describeAwayMode({ config: c, toggle, now, localZone }).lines.slice(1);
  return { before: pick(before), after: pick(after) };
}

// The account menu's away row: one row, last in the menu. "Step away" while you count as here
// (posts "I'm away now"), "I'm back" while you count as away (posts "I'm here", which also skips the
// rest of the current away hours). The hint is the next edge: when the away hours start, when they end.
const STEP_AWAY = 'Step away to have worca answer on every run now.';

/** @returns {{state:'here'|'away', status:string, label:string, hint:string, tip:string, disabled:boolean}} */
export function describeAwayRow({ config, toggle = 'auto', now, localZone = null, hereSince = null } = {}) {
  const d = describeAwayMode({ config, toggle, now, localZone, hereSince });
  const hours = d.status === 'unknown' ? null : hoursOf(config);
  const here = { state: 'here', status: d.status, label: 'Step away', disabled: false };
  const away = { state: 'away', status: d.status, label: "I'm back", disabled: false };
  switch (d.status) {
    case 'here':
    case 'here-now': return { ...here, hint: `away at ${hours[0]}`, tip: `${d.lines[0]} ${STEP_AWAY}` };
    case 'no-hours': return { ...here, hint: '', tip: `No away hours are set. ${STEP_AWAY}` };
    case 'paused': return { ...here, hint: 'Away mode paused', tip: 'Away mode is paused. worca answers nothing. Step away to have worca answer on every run, or turn it back on in Settings › Away mode.' };
    case 'away-now': return { ...away, hint: '', tip: 'You said you are away. worca answers on every run until you click "I\'m back".' };
    case 'away-hours': return { ...away, hint: `until ${hours[1]}`, tip: `${d.lines[0]} Click "I'm back" to count as here until they end.` };
    default: return { ...here, status: 'unknown', hint: '', tip: d.lines[0], disabled: true };
  }
}
