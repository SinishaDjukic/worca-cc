// ui/public/schedule-sheet.mjs
// The schedule sheet: ONE dialog for "run once, later" and "repeat", used by the New
// pipeline form, the Ask run card and the Schedules view's Change time / Edit.
//
// The editor never shows cron. It builds a SENTENCE and proves it with the next dates —
// both computed here, in the browser, from the same recurrence module the server and the
// CLI use (src/shared/schedule/recurrence.mjs), so what is previewed is what will run.
//
// openScheduleSheet(opts) -> Promise<result|null>
//   result (once):      { scheduledFor: ISO-with-Z, ifMissed, graceMin }
//   result (recurring): { repeat: { rule, overlap, maxFailures }, ifMissed, graceMin }
//   result (after):     { after: { kind, id, title }, afterPolicy }

import {
  WEEKDAYS, normalizeRule, previewOccurrences, describeRule, formatInstant, formatCountdown,
  zonedToUtc, zonedParts, localDate, isValidTimeZone,
} from '../../src/shared/schedule/recurrence.mjs';

const DAY_LABEL = { mo: 'Mo', tu: 'Tu', we: 'We', th: 'Th', fr: 'Fr', sa: 'Sa', su: 'Su' };
const DAY_NAME = { mo: 'Monday', tu: 'Tuesday', we: 'Wednesday', th: 'Thursday', fr: 'Friday', sa: 'Saturday', su: 'Sunday' };
const PRESETS = [
  ['once', 'Once'], ['daily', 'Every day'], ['weekdays', 'Weekdays'],
  ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['custom', 'Custom'],
];
/** The sheet's kind switch (run chains): a time, or another run. */
const KINDS = [['time', 'At a time'], ['after', 'After a run']];
const AFTER_STATE_WORD = { running: 'running', starting: 'starting', created: 'starting', pausing: 'pausing', paused: 'paused',
  scheduled: 'scheduled', firing: 'starting', missed: 'missed', fired: 'starting',
  done: 'finished', error: 'ended with an error', stopped: 'stopped', interrupted: 'interrupted', canceled: 'canceled',
  failed: 'could not start', skipped: 'skipped' };
const GRACE_CHOICES = [[30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [360, '6 hours'], [720, '12 hours'], [1440, '24 hours']];
const pad = (n) => String(n).padStart(2, '0');

export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'hidden') node.hidden = !!v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

function selectEl(id, options, value, label) {
  const sel = h('select', { id, class: 'select', 'aria-label': label });
  for (const [v, text] of options) sel.append(h('option', { value: String(v), text }));
  sel.value = String(value);
  return h('div', { class: 'select-wrap' }, sel);
}

/** The preset a stored rule corresponds to (for Edit). */
function presetOfRule(rule) {
  if (!rule) return 'once';
  if ((rule.interval || 1) !== 1) return 'custom';
  if (rule.freq === 'daily') return 'daily';
  if (rule.freq === 'weekly') return (rule.weekdays || []).join(',') === 'mo,tu,we,th,fr' ? 'weekdays' : 'weekly';
  return 'monthly';
}

let openSheet = null; // one sheet at a time

/** Close the sheet if one is open (a view change must not strand it). */
export function closeScheduleSheet() {
  if (openSheet) openSheet(null);
}

/**
 * @param {object} o
 * @param {'create'|'ticket'|'series'} [o.mode]   create = both kinds; ticket = Change time; series = Edit
 * @param {boolean} [o.allowRepeat]               false hides the repeat presets (an Ask card runs once)
 * @param {boolean} [o.allowAfter]                false hides the At a time · After a run switch even when candidates are given
 * @param {() => Promise<{runs:object[], tickets:object[]}>} [o.candidates]  the host's after-candidates fetch; given (and not a series) => the kind switch shows
 * @param {{kind:string, id:string, title?:string, status?:string}} [o.initial.after]  a stored predecessor: the sheet opens on the After side
 * @param {'done'|'any'} [o.initial.afterPolicy]  the stored outcome policy
 * @param {object} [o.initial]                  { scheduledFor?, rule?, overlap?, maxFailures?, ifMissed?, graceMin? }
 * @param {{graceMin:number, ifMissed:string, maxFailures:number}} [o.defaults]
 * @param {string} [o.runTitle]                   shown under the heading
 * @param {string} [o.warning]                    an amber note (e.g. the workflow can ask questions)
 */
export function openScheduleSheet({
  mode = 'create', allowRepeat = true, allowAfter = true, candidates = null,
  initial = {}, defaults = { graceMin: 360, ifMissed: 'run', maxFailures: 3 },
  runTitle = '', warning = '',
} = {}) {
  closeScheduleSheet();
  return new Promise((resolve) => {
    let tz = (initial.rule && isValidTimeZone(initial.rule.tz)) ? initial.rule.tz : browserTimeZone();
    const now = Date.now();
    const startMs = initial.scheduledFor ? Date.parse(initial.scheduledFor) : null;
    // Default slot: tomorrow 02:00 — the feature exists for out-of-hours runs.
    const seedParts = zonedParts(startMs && startMs > now ? startMs : now + 86400000, tz);
    // The kind switch needs a candidate list; a series can never wait for a run.
    const showKind = mode !== 'series' && allowAfter && typeof candidates === 'function';
    const state = {
      preset: mode === 'series' || initial.rule ? presetOfRule(initial.rule) : 'once',
      date: `${seedParts.y}-${pad(seedParts.m)}-${pad(seedParts.d)}`,
      time: startMs && startMs > now ? `${pad(seedParts.hh)}:${pad(seedParts.mm)}` : (initial.rule?.time || '02:00'),
      weekdays: new Set(initial.rule?.weekdays?.length ? initial.rule.weekdays : ['mo']),
      monthDay: initial.rule?.monthDay ?? 1,
      interval: initial.rule?.interval || 2,
      unit: initial.rule?.freq === 'monthly' ? 'monthly' : initial.rule?.freq === 'daily' ? 'daily' : 'weekly',
      endType: initial.rule?.end?.type || 'never',
      until: initial.rule?.end?.until || '',
      count: initial.rule?.end?.count || 10,
      overlap: initial.overlap || 'skip',
      maxFailures: initial.maxFailures ?? defaults.maxFailures,
      ifMissed: initial.ifMissed || defaults.ifMissed,
      graceMin: initial.graceMin ?? defaults.graceMin,
      kind: showKind && initial.after ? 'after' : 'time',
      after: initial.after || null, afterAny: initial.afterPolicy === 'any', cands: null, candsLoading: false, candsError: '',
    };

    const heading = mode === 'ticket' ? (showKind ? 'Change when it starts' : 'Change time') : mode === 'series' ? 'Edit schedule' : 'Schedule this run';
    const confirmLabel = mode === 'create' ? 'Schedule run' : 'Save';

    // ── build ────────────────────────────────────────────────────────────────
    const seg = h('div', { class: 'seg sched-presets', role: 'group', 'aria-label': 'How often' });
    for (const [key, label] of PRESETS) {
      if (mode === 'series' && key === 'once') continue;
      seg.append(h('button', { type: 'button', 'data-preset': key, text: label }));
    }
    const showPresets = mode === 'series' || (mode === 'create' && allowRepeat);

    const kindSeg = h('div', { class: 'seg sched-kind', role: 'group', 'aria-label': 'Start it' });
    for (const [key, label] of KINDS) kindSeg.append(h('button', { type: 'button', 'data-kind': key, text: label }));

    const quick = h('div', { class: 'sched-quick' });
    const dateIn = h('input', { type: 'date', id: 'sched-date', class: 'input', 'aria-label': 'Date' });
    const timeIn = h('input', { type: 'time', id: 'sched-time', class: 'input', 'aria-label': 'Time' });
    const onceRow = h('div', { class: 'field-grid-2 sched-once' },
      h('div', { class: 'field field-compact' }, h('label', { for: 'sched-date', text: 'Date' }), dateIn),
      h('div', { class: 'field field-compact sched-time-field' }, h('label', { for: 'sched-time', text: 'Time' }), timeIn));

    const days = h('div', { class: 'sched-days', role: 'group', 'aria-label': 'Days of the week' });
    for (const d of WEEKDAYS) days.append(h('button', { type: 'button', class: 'sched-day', 'data-day': d, title: DAY_NAME[d], 'aria-label': DAY_NAME[d], text: DAY_LABEL[d] }));
    const daysField = h('div', { class: 'field field-compact' }, h('span', { class: 'label', text: 'On' }), days);

    const intervalIn = h('input', { type: 'number', id: 'sched-interval', class: 'input', min: '1', max: '365', 'aria-label': 'Interval' });
    const unitSel = selectEl('sched-unit', [['daily', 'days'], ['weekly', 'weeks'], ['monthly', 'months']], state.unit, 'Unit');
    const customField = h('div', { class: 'field field-compact' }, h('label', { for: 'sched-interval', text: 'Every' }),
      h('div', { class: 'sched-inline' }, intervalIn, unitSel));

    const monthOpts = [...Array.from({ length: 31 }, (_, i) => [i + 1, `Day ${i + 1}`]), ['last', 'Last day']];
    const monthSel = selectEl('sched-monthday', monthOpts, state.monthDay, 'Day of the month');
    const monthField = h('div', { class: 'field field-compact' }, h('label', { for: 'sched-monthday', text: 'On' }), monthSel);

    const afterSel = h('select', { id: 'sched-after', class: 'select', 'aria-label': 'The run to wait for' });
    const afterAny = h('div', { class: 'switch', id: 'sched-after-any', role: 'switch', tabindex: '0', 'aria-checked': 'false', 'aria-label': 'Start even if it fails or is stopped' });
    const afterRow = h('div', { class: 'sched-after' },
      h('div', { class: 'field field-compact' }, h('label', { for: 'sched-after', text: 'After' }), h('div', { class: 'select-wrap' }, afterSel)),
      h('div', { class: 'field field-compact switch-row' }, afterAny, h('span', { class: 'txt', text: 'Start even if it fails or is stopped' })));

    const endSel = selectEl('sched-end', [['never', 'Never'], ['until', 'On a date'], ['count', 'After a number of runs']], state.endType, 'Ends');
    const untilIn = h('input', { type: 'date', id: 'sched-until', class: 'input', 'aria-label': 'Last day' });
    const countIn = h('input', { type: 'number', id: 'sched-count', class: 'input', min: '1', max: '100000', 'aria-label': 'Number of runs' });
    const endField = h('div', { class: 'field field-compact' }, h('label', { for: 'sched-end', text: 'Ends' }),
      h('div', { class: 'sched-inline' }, endSel, untilIn, countIn));
    const repeatRow = h('div', { class: 'field-grid-2 sched-repeat' }); // time + ends (time field moves in here)

    const sentence = h('div', { class: 'sched-sentence', 'aria-live': 'polite' });
    const tzLine = h('div', { class: 'sched-tz' });
    const tzIn = h('input', { type: 'text', id: 'sched-tz', class: 'input', spellcheck: 'false', list: 'sched-tz-list', 'aria-label': 'Timezone', hidden: true });
    const tzList = h('datalist', { id: 'sched-tz-list' });
    try { for (const z of Intl.supportedValuesOf('timeZone')) tzList.append(h('option', { value: z })); } catch { /* older browser: free text */ }

    const overlapSel = selectEl('sched-overlap', [['skip', 'Skip this one'], ['queue', 'Wait, then start'], ['start', 'Start anyway']], state.overlap, 'If the previous run is still going');
    const failIn = h('input', { type: 'number', id: 'sched-maxfail', class: 'input', min: '0', max: '100', 'aria-label': 'Pause after failures in a row' });
    const policyRow = h('div', { class: 'field-grid-2 sched-policies' },
      h('div', { class: 'field field-compact' }, h('label', { for: 'sched-overlap', text: 'If the previous run is still going' }), overlapSel),
      h('div', { class: 'field field-compact' }, h('label', { for: 'sched-maxfail', text: 'Pause after failures in a row' }), failIn,
        h('small', { class: 'hint', text: '0 never pauses it.' })));

    const missedSel = selectEl('sched-missed', [['run', 'Start it late'], ['skip', 'Skip it']], state.ifMissed, 'If Worca is not running at that time');
    const graceSel = selectEl('sched-grace', GRACE_CHOICES.some(([m]) => m === state.graceMin) ? GRACE_CHOICES : [...GRACE_CHOICES, [state.graceMin, `${state.graceMin} minutes`]], state.graceMin, 'At most this late');
    const graceField = h('div', { class: 'field field-compact' }, h('label', { for: 'sched-grace', text: 'At most this late' }), graceSel);
    const missedRow = h('div', { class: 'field-grid-2' },
      h('div', { class: 'field field-compact' }, h('label', { for: 'sched-missed', text: 'If Worca is not running then' }), missedSel),
      graceField);

    const err = h('div', { class: 'hint err sched-err', hidden: true });
    const cancelBtn = h('button', { type: 'button', class: 'btn btn-mini sched-cancel', text: 'Cancel' });
    const okBtn = h('button', { type: 'button', class: 'btn btn-primary btn-mini sched-ok', text: confirmLabel });
    const closeBtn = h('button', { type: 'button', class: 'btn btn-mini', text: 'Close' });

    const card = h('div', { class: 'card sched-card' },
      h('div', { class: 'card-head' }, h('h2', { id: 'sched-title', text: heading }), closeBtn),
      runTitle ? h('div', { class: 'sched-run-title', text: runTitle }) : null,
      showKind ? kindSeg : null,
      showPresets ? seg : null,
      quick, onceRow, daysField, customField, monthField, showKind ? afterRow : null, repeatRow,
      sentence, tzLine, tzIn, tzList,
      policyRow, missedRow,
      h('small', { class: 'hint sched-note', text: 'A scheduled run starts only while Worca is running and this computer is awake.' }),
      warning ? h('div', { class: 'hint warn sched-warn', text: warning }) : null,
      err,
      h('div', { class: 'confirm-actions' }, cancelBtn, okBtn));
    const modal = h('div', { id: 'schedule-modal', class: 'viewer-modal confirm-modal sched-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sched-title' }, card);

    // ── state -> DOM ─────────────────────────────────────────────────────────
    dateIn.value = state.date; timeIn.value = state.time; intervalIn.value = state.interval;
    untilIn.value = state.until; countIn.value = state.count; failIn.value = state.maxFailures;

    const currentRule = () => {
      const base = { time: state.time, tz, anchor: initial.rule?.anchor };
      const end = state.endType === 'until' ? { type: 'until', until: state.until } : state.endType === 'count' ? { type: 'count', count: Number(state.count) } : { type: 'never' };
      let r;
      if (state.preset === 'daily') r = { freq: 'daily', interval: 1 };
      else if (state.preset === 'weekdays') r = { freq: 'weekly', interval: 1, weekdays: ['mo', 'tu', 'we', 'th', 'fr'] };
      else if (state.preset === 'weekly') r = { freq: 'weekly', interval: 1, weekdays: [...state.weekdays] };
      else if (state.preset === 'monthly') r = { freq: 'monthly', interval: 1, monthDay: state.monthDay };
      else {
        r = { freq: state.unit, interval: Number(state.interval) };
        if (state.unit === 'weekly') r.weekdays = [...state.weekdays];
        if (state.unit === 'monthly') r.monthDay = state.monthDay;
      }
      return normalizeRule({ ...base, ...r, end }, { todayLocal: localDate(Date.now(), tz) });
    };

    const onceInstant = () => {
      const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(state.date);
      const t = /^(\d{1,2}):(\d{2})$/.exec(state.time);
      if (!d || !t) return null;
      return zonedToUtc({ y: +d[1], m: +d[2], d: +d[3], hh: +t[1], mm: +t[2] }, tz);
    };

    const quickChoices = () => {
      const p = zonedParts(Date.now(), tz);
      const at = (addDays, hh, mm = 0) => {
        const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + addDays));
        return { date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`, time: `${pad(hh)}:${pad(mm)}` };
      };
      const inHour = zonedParts(Date.now() + 3600000, tz);
      const out = [['In 1 hour', { date: `${inHour.y}-${pad(inHour.m)}-${pad(inHour.d)}`, time: `${pad(inHour.hh)}:${pad(inHour.mm)}` }]];
      // 22:00 is always offered: today's while it is still ahead, else tomorrow's.
      out.push(p.hh < 22 ? ['Today 22:00', at(0, 22)] : ['Tomorrow 22:00', at(1, 22)]);
      out.push(['Tomorrow 02:00', at(1, 2)]);
      const dow = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7; // Monday = 0
      out.push(['Monday 06:00', at(((7 - dow) % 7) || 7, 6)]);
      // Chronological, whatever the hour: after 21:00 "In 1 hour" is later than 22:00.
      const ms = (v) => zonedToUtc({ y: +v.date.slice(0, 4), m: +v.date.slice(5, 7), d: +v.date.slice(8, 10), hh: +v.time.slice(0, 2), mm: +v.time.slice(3, 5) }, tz);
      return out.sort((a, b) => ms(a[1]) - ms(b[1]));
    };

    const afterKey = (a) => (a ? `${a.kind}:${a.id}` : '');
    function fillAfter() {
      const c = state.cands || { runs: [], tickets: [] };
      afterSel.replaceChildren();
      const running = h('optgroup', { label: 'Running' });
      for (const r of c.runs) running.append(h('option', { value: `pipeline:${r.pipelineId}`, text: `${r.title || r.pipelineId} · ${AFTER_STATE_WORD[r.status] || r.status}` }));
      const scheduled = h('optgroup', { label: 'Scheduled' });
      for (const t of c.tickets) scheduled.append(h('option', { value: `ticket:${t.id}`, text: `${t.title || t.id.slice(0, 8)} · ${t.after ? 'after another run' : (AFTER_STATE_WORD[t.status] || t.status)}` }));
      if (c.runs.length) afterSel.append(running);
      if (c.tickets.length) afterSel.append(scheduled);
      const all = [...c.runs.map((r) => ({ kind: 'pipeline', id: r.pipelineId, title: r.title || r.pipelineId, status: r.status })),
                   ...c.tickets.map((t) => ({ kind: 'ticket', id: t.id, title: t.title || t.id.slice(0, 8), status: t.status }))];
      const keep = state.after && all.find((a) => afterKey(a) === afterKey(state.after));
      // after-candidates lists live runs and open tickets only; a ticket may wait on a run that has already finished.
      if (state.after && !keep) {
        const a = { kind: state.after.kind, id: state.after.id, title: state.after.title || state.after.id, status: state.after.status || null };
        const current = h('optgroup', { label: 'Current' });
        current.append(h('option', { value: afterKey(a), text: `${a.title}${a.status ? ` · ${AFTER_STATE_WORD[a.status] || a.status}` : ''}` }));
        afterSel.prepend(current);
        all.unshift(a);
      }
      state.after = keep || all[0] || null;
      if (state.after) afterSel.value = afterKey(state.after);
      afterSel._all = all;
    }
    function loadCandidates() {
      // One request per sheet: every repaint (the policy switch, the 30 s interval) calls this while the
      // list is still loading, so latch on the in-flight flag, not only on the settled result.
      if (state.cands || state.candsLoading || !candidates) return;
      state.candsLoading = true;
      Promise.resolve().then(candidates).then((c) => { state.cands = { runs: c && Array.isArray(c.runs) ? c.runs : [], tickets: c && Array.isArray(c.tickets) ? c.tickets : [] }; })
        .catch(() => { state.cands = { runs: [], tickets: [] }; state.candsError = 'The list of runs could not be loaded.'; })
        .then(() => { state.candsLoading = false; fillAfter(); paint(); });
    }

    function paint() {
      const once = state.preset === 'once';
      const after = state.kind === 'after'; if (after) loadCandidates();
      for (const b of kindSeg.querySelectorAll('button')) { const on = b.dataset.kind === state.kind; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      seg.hidden = after;            // the time presets belong to At a time
      const usesDays = state.preset === 'weekly' || (state.preset === 'custom' && state.unit === 'weekly');
      const usesMonth = state.preset === 'monthly' || (state.preset === 'custom' && state.unit === 'monthly');
      for (const b of seg.querySelectorAll('button')) {
        const on = b.dataset.preset === state.preset;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      quick.hidden = !once || after;
      quick.replaceChildren(...(once && !after ? quickChoices().map(([label, v]) => {
        const b = h('button', { type: 'button', class: 'chip sched-chip', text: label });
        if (v.date === state.date && v.time === state.time) b.classList.add('on');
        b.addEventListener('click', () => { state.date = v.date; state.time = v.time; dateIn.value = v.date; timeIn.value = v.time; paint(); });
        return b;
      }) : []));
      // The time field lives beside Date (once) or beside Ends (repeat).
      const timeField = timeIn.closest('.field');
      if (once) { onceRow.append(timeField); } else { repeatRow.replaceChildren(timeField, endField); }
      onceRow.hidden = !once || after; repeatRow.hidden = once || after;
      afterRow.hidden = !after;
      daysField.hidden = after || !usesDays; monthField.hidden = after || !usesMonth; customField.hidden = after || state.preset !== 'custom';
      policyRow.hidden = once || after;
      missedRow.hidden = after;
      afterAny.classList.toggle('on', state.afterAny); afterAny.setAttribute('aria-checked', state.afterAny ? 'true' : 'false');
      untilIn.hidden = state.endType !== 'until'; countIn.hidden = state.endType !== 'count';
      graceField.hidden = state.ifMissed !== 'run';
      for (const b of days.querySelectorAll('button')) {
        const on = state.weekdays.has(b.dataset.day);
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }

      // The sentence + proof.
      let problem = '';
      if (after) {
        if (!state.cands) problem = '';
        else if (state.candsError) problem = state.candsError;
        else if (!state.after) problem = 'Nothing is running or scheduled for this project.';
        sentence.replaceChildren(
          h('b', { text: state.after ? `After ‘${state.after.title}’ finishes` : 'After a run' }),
          h('div', { class: 'sched-next', text: state.after && state.after.status ? `${state.after.title} is ${AFTER_STATE_WORD[state.after.status] || state.after.status}` : '' }));
      } else if (once) {
        const ms = onceInstant();
        if (ms == null) problem = 'Pick a date and a time.';
        else if (ms <= Date.now()) problem = 'That time is already in the past.';
        sentence.replaceChildren(
          h('b', { text: ms == null ? 'Once' : `Once, on ${formatInstant(ms, tz, { withYear: true })}` }),
          h('div', { class: 'sched-next', text: ms != null && ms > Date.now() ? `Starts in ${formatCountdown(ms - Date.now())}` : '' }));
      } else {
        const norm = currentRule();
        if (!norm.ok) {
          problem = norm.error.replace(/^rule\.weekdays needs at least one day$/, 'Pick at least one day.')
            .replace(/^rule\.end\.until.*/, 'Pick the last day it may run.').replace(/^rule\.end\.count.*/, 'Enter how many times it should run.')
            .replace(/^rule\.interval.*/, 'Enter how often it repeats, from 1 to 365.').replace(/^rule\.time.*/, 'Pick a time.');
          sentence.replaceChildren(h('b', { text: 'Repeats' }), h('div', { class: 'sched-next', text: '' }));
        } else {
          const next = previewOccurrences(norm.rule, Date.now(), 3, { firedCount: 0 });
          if (!next.length) problem = 'This schedule has no future run.';
          sentence.replaceChildren(
            h('b', { text: describeRule(norm.rule) }),
            h('div', { class: 'sched-next', text: next.length ? `Next: ${next.map((t) => formatInstant(t, tz)).join('  ·  ')}` : '' }));
        }
      }
      sentence.classList.toggle('bad', !!problem);
      if (after) tzIn.hidden = true;
      tzLine.hidden = after;
      tzLine.replaceChildren(h('span', { text: `${tz} time` }), ' ',
        h('button', { type: 'button', class: 'sched-tz-change', text: tzIn.hidden ? 'Change' : 'Done' }));
      tzLine.querySelector('button').addEventListener('click', () => {
        tzIn.hidden = !tzIn.hidden;
        if (!tzIn.hidden) { tzIn.value = tz; tzIn.focus(); tzIn.select(); }
        paint();
      });
      err.hidden = !problem; err.textContent = problem;
      okBtn.disabled = !!problem || (after && !state.cands);
    }

    // ── DOM -> state ─────────────────────────────────────────────────────────
    seg.addEventListener('click', (e) => { const b = e.target.closest('button[data-preset]'); if (b) { state.preset = b.dataset.preset; paint(); } });
    days.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-day]'); if (!b) return;
      if (state.weekdays.has(b.dataset.day)) state.weekdays.delete(b.dataset.day); else state.weekdays.add(b.dataset.day);
      paint();
    });
    const bind = (node, key, conv = (v) => v) => node.addEventListener('input', () => { state[key] = conv(node.value); paint(); });
    bind(dateIn, 'date'); bind(timeIn, 'time'); bind(intervalIn, 'interval', Number); bind(untilIn, 'until'); bind(countIn, 'count', Number);
    bind(failIn, 'maxFailures', Number);
    const bindSel = (wrap, key, conv = (v) => v) => wrap.firstChild.addEventListener('change', () => { state[key] = conv(wrap.firstChild.value); paint(); });
    bindSel(unitSel, 'unit'); bindSel(endSel, 'endType'); bindSel(overlapSel, 'overlap'); bindSel(missedSel, 'ifMissed');
    bindSel(graceSel, 'graceMin', Number);
    bindSel(monthSel, 'monthDay', (v) => (v === 'last' ? 'last' : Number(v)));
    kindSeg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-kind]');
      if (!b || b.dataset.kind === state.kind) return;
      state.kind = b.dataset.kind; paint();
    });
    afterSel.addEventListener('change', () => { state.after = (afterSel._all || []).find((a) => afterKey(a) === afterSel.value) || null; paint(); });
    const flipAny = () => { state.afterAny = !state.afterAny; paint(); };
    afterAny.addEventListener('click', flipAny);
    afterAny.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipAny(); } });
    tzIn.addEventListener('change', () => { if (isValidTimeZone(tzIn.value.trim())) { tz = tzIn.value.trim(); tzIn.hidden = true; } paint(); });

    // ── lifecycle ────────────────────────────────────────────────────────────
    const prevFocus = document.activeElement;
    const tick = setInterval(paint, 30000); // keep "Starts in …" and the quick chips honest
    function finish(result) {
      clearInterval(tick);
      document.removeEventListener('keydown', onKey, true);
      modal.remove();
      openSheet = null;
      if (prevFocus && typeof prevFocus.focus === 'function') { try { prevFocus.focus(); } catch { /* gone */ } }
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
    }
    document.addEventListener('keydown', onKey, true);
    modal.addEventListener('click', (e) => { if (e.target === modal) finish(null); });
    cancelBtn.addEventListener('click', () => finish(null));
    closeBtn.addEventListener('click', () => finish(null));
    okBtn.addEventListener('click', () => {
      const maxFailures = Number.isInteger(state.maxFailures) && state.maxFailures >= 0 && state.maxFailures <= 100 ? state.maxFailures : defaults.maxFailures;
      const common = { ifMissed: state.ifMissed, graceMin: state.graceMin };
      if (state.kind === 'after') {
        if (!state.after) return paint();
        return finish({ after: { kind: state.after.kind, id: state.after.id, title: state.after.title }, afterPolicy: state.afterAny ? 'any' : 'done' });
      }
      if (state.preset === 'once') {
        const ms = onceInstant();
        if (ms == null || ms <= Date.now()) return paint();
        return finish({ scheduledFor: new Date(ms).toISOString(), ...common });
      }
      const norm = currentRule();
      if (!norm.ok) return paint();
      finish({ repeat: { rule: norm.rule, overlap: state.overlap, maxFailures }, ...common });
    });

    openSheet = finish;
    document.body.append(modal);
    paint();
    (showKind ? kindSeg.querySelector('button.on') : showPresets ? seg.querySelector('button.on') : dateIn)?.focus();
  });
}
