// ui/public/stillhet/live/schedule-rule.mjs — the words a schedule picker offers (REPEATS, list-parts.mjs) and dev's
// recurrence rule (src/shared/schedule/recurrence.mjs), both ways (D7). Pure, no DOM: schedule-live.mjs builds the rule
// it sends from the words, live-map.mjs reads the words back from the rule; the pages read only the store and the draft.
import { REPEATS } from '../../design-system/components/list-parts.mjs';

const DAYS = { Monday: 'mo', Tuesday: 'tu', Wednesday: 'we', Thursday: 'th', Friday: 'fr', Saturday: 'sa', Sunday: 'su' };
const NAME_OF = Object.fromEntries(Object.entries(DAYS).map(([k, v]) => [v, k]));
const HOUR = 60;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The rule for a REPEATS word at a time of day in a zone; `{ error }` for a word with no rule (once, unknown) or a bad time. */
export function ruleOf({ every, at, tz } = {}) {
  const tzOk = typeof tz === 'string' && tz ? tz : 'UTC';
  if (every === 'every hour') return { freq: 'daily', interval: 1, step: { minutes: HOUR }, tz: tzOk };
  if (!REPEATS.includes(every) || every === 'once') return { error: `"${every}" is not a repeat` };
  if (!TIME_RE.test(String(at || ''))) return { error: `"${at}" is not a time of day` };
  const base = { interval: 1, time: at, tz: tzOk };
  if (every === 'every day') return { freq: 'daily', ...base };
  if (every === 'every weekday') return { freq: 'weekly', ...base, weekdays: ['mo', 'tu', 'we', 'th', 'fr'] };
  if (every === 'every weekend') return { freq: 'weekly', ...base, weekdays: ['sa', 'su'] };
  if (every === 'every month on the 1st') return { freq: 'monthly', ...base, monthDay: 1 };
  const day = DAYS[every.replace(/^every /, '')];
  return { freq: 'weekly', ...base, weekdays: [day] };
}

/** The REPEATS word a rule reads as, or null when it has none (every 2 days, several times a day): the page then shows dev's sentence. */
export function repeatOf(rule) {
  if (!rule || typeof rule !== 'object' || (rule.interval ?? 1) !== 1 || rule.times) return null;
  if (rule.step) return rule.freq === 'daily' && rule.step.minutes === HOUR && (rule.step.from ?? '00:00') === '00:00' && (rule.step.to ?? '23:59') === '23:59' ? 'every hour' : null;
  if (!rule.time) return null;
  if (rule.freq === 'daily') return 'every day';
  if (rule.freq === 'monthly') return rule.monthDay === 1 ? 'every month on the 1st' : null;
  if (rule.freq !== 'weekly' || !Array.isArray(rule.weekdays)) return null;
  const d = rule.weekdays.join(',');
  if (d === 'mo,tu,we,th,fr') return 'every weekday';
  if (d === 'sa,su') return 'every weekend';
  return rule.weekdays.length === 1 && NAME_OF[d] ? `every ${NAME_OF[d]}` : null;
}

/** A rule's time of day, HH:MM, or '' (every hour, several times). */
export const atOf = (rule) => (rule && typeof rule.time === 'string' ? rule.time : '');

/** A rule moved to another time of day, everything else kept (a rule no picker word reads, its end); `{ error }` for a bad time. */
export function retimed(rule, at) {
  if (!TIME_RE.test(String(at || ''))) return { error: `"${at}" is not a time of day` };
  return { ...rule, time: at };
}

/** The New schedule form's end words as dev's rule.end: null (no end), a run count, or a last day (local YYYY-MM-DD). */
export function endOf(words, { today = new Date() } = {}) {
  const runs = /^after (\d+) runs?$/.exec(String(words || ''));
  if (runs) return { type: 'count', count: Number(runs[1]) };
  const days = /^after (\d+) days?$/.exec(String(words || ''));
  if (!days) return null;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(days[1]));
  const two = (n) => String(n).padStart(2, '0');
  return { type: 'until', until: `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` };
}
