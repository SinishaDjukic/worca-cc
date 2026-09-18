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
 * @param {object} [o.initial]                    { scheduledFor?, rule?, overlap?, maxFailures?, ifMissed?, graceMin? }
 * @param {{graceMin:number, ifMissed:string, maxFailures:number}} [o.defaults]
 * @param {string} [o.runTitle]                   shown under the heading
 * @param {string} [o.warning]                    an amber note (e.g. the workflow can ask questions)
 */
export function openScheduleSheet({
  mode = 'create', allowRepeat = true, initial = {}, defaults = { graceMin: 360, ifMissed: 'run', maxFailures: 3 },
  runTitle = '', warning = '',
} = {}) {
  closeScheduleSheet();
  return new Promise((resolve) => {
    let tz = (initial.rule && isValidTimeZone(initial.rule.tz)) ? initial.rule.tz : browserTimeZone();
    const now = Date.now();
    const startMs = initial.scheduledFor ? Date.parse(initial.scheduledFor) : null;
    // Default slot: tomorrow 02:00 — the feature exists for out-of-hours runs.
    const seedParts = zonedParts(startMs && startMs > now ? startMs : now + 86400000, tz);
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
    };

    const heading = mode === 'ticket' ? 'Change time' : mode === 'series' ? 'Edit schedule' : 'Schedule this run';
    const confirmLabel = mode === 'create' ? 'Schedule run' : 'Save';

    // ── build ────────────────────────────────────────────────────────────────
    const seg = h('div', { class: 'seg sched-presets', role: 'group', 'aria-label': 'How often' });
    for (const [key, label] of PRESETS) {
      if (mode === 'series' && key === 'once') continue;
      seg.append(h('button', { type: 'button', 'data-preset': key, text: label }));
    }
    const showPresets = mode === 'series' || (mode === 'create' && allowRepeat);

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
      showPresets ? seg : null,
      quick, onceRow, daysField, customField, monthField, repeatRow,
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
      if (p.hh < 22) out.push(['Tonight 22:00', at(0, 22)]);
      out.push(['Tomorrow 02:00', at(1, 2)]);
      const dow = (new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() + 6) % 7; // Monday = 0
      out.push(['Monday 06:00', at(((7 - dow) % 7) || 7, 6)]);
      return out;
    };

    function paint() {
      const once = state.preset === 'once';
      const usesDays = state.preset === 'weekly' || (state.preset === 'custom' && state.unit === 'weekly');
      const usesMonth = state.preset === 'monthly' || (state.preset === 'custom' && state.unit === 'monthly');
      for (const b of seg.querySelectorAll('button')) {
        const on = b.dataset.preset === state.preset;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      quick.hidden = !once;
      quick.replaceChildren(...(once ? quickChoices().map(([label, v]) => {
        const b = h('button', { type: 'button', class: 'chip sched-chip', text: label });
        if (v.date === state.date && v.time === state.time) b.classList.add('on');
        b.addEventListener('click', () => { state.date = v.date; state.time = v.time; dateIn.value = v.date; timeIn.value = v.time; paint(); });
        return b;
      }) : []));
      // The time field lives beside Date (once) or beside Ends (repeat).
      const timeField = timeIn.closest('.field');
      if (once) { onceRow.append(timeField); } else { repeatRow.replaceChildren(timeField, endField); }
      onceRow.hidden = !once; repeatRow.hidden = once;
      daysField.hidden = !usesDays; monthField.hidden = !usesMonth; customField.hidden = state.preset !== 'custom';
      policyRow.hidden = once;
      untilIn.hidden = state.endType !== 'until'; countIn.hidden = state.endType !== 'count';
      graceField.hidden = state.ifMissed !== 'run';
      for (const b of days.querySelectorAll('button')) {
        const on = state.weekdays.has(b.dataset.day);
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      }

      // The sentence + proof.
      let problem = '';
      if (once) {
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
      tzLine.replaceChildren(h('span', { text: `${tz} time` }), ' ',
        h('button', { type: 'button', class: 'sched-tz-change', text: tzIn.hidden ? 'Change' : 'Done' }));
      tzLine.querySelector('button').addEventListener('click', () => {
        tzIn.hidden = !tzIn.hidden;
        if (!tzIn.hidden) { tzIn.value = tz; tzIn.focus(); tzIn.select(); }
        paint();
      });
      err.hidden = !problem; err.textContent = problem;
      okBtn.disabled = !!problem;
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
    (showPresets ? seg.querySelector('button.on') : dateIn)?.focus();
  });
}
