// src/shared/schedule/recurrence.mjs
// Recurrence rules for scheduled runs — ONE source for the server, the CLI and the
// browser (served under /src/shared, like the graph model). Pure: no node: imports,
// no Date.now() — every function takes its instant.
//
// A rule is wall-clock time in an IANA timezone, never a UTC instant: "02:00 every
// night" must stay 02:00 across daylight-saving changes.
//
//   { freq: 'daily'|'weekly'|'monthly', interval: 1..,
//     weekdays: ['mo',..]            (weekly)
//     monthDay: 1..31 | 'last'       (monthly)
//     time: 'HH:MM', tz: 'Europe/Berlin',
//     anchor: 'YYYY-MM-DD'           (local date the interval counts from)
//     end: { type:'never' } | { type:'until', until:'YYYY-MM-DD' } | { type:'count', count:n } }

export const WEEKDAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'];
const WD_LONG = { mo: 'Monday', tu: 'Tuesday', we: 'Wednesday', th: 'Thursday', fr: 'Friday', sa: 'Saturday', su: 'Sunday' };
const WD_SHORT = { mo: 'Mon', tu: 'Tue', we: 'Wed', th: 'Thu', fr: 'Fri', sa: 'Sat', su: 'Sun' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const OVERLAP_POLICIES = ['skip', 'start', 'queue'];
export const MISSED_POLICIES = ['run', 'skip'];
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_SCAN_DAYS = 366 * 12;

/** True when `tz` is a timezone Intl accepts. */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

const _fmtCache = new Map();
function partsFormatter(tz) {
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _fmtCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of instant `ms` in `tz`: { y, m (1-12), d, hh, mm, ss }. */
export function zonedParts(ms, tz) {
  const out = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, hh: out.hour % 24, mm: out.minute, ss: out.second };
}

/** Offset (ms) of `tz` from UTC at instant `ms` (positive east of Greenwich). */
function tzOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - Math.floor(ms / 1000) * 1000;
}

/**
 * The UTC instant of a wall-clock time in `tz`. A time that does not exist (spring
 * forward) moves FORWARD past the gap; a time that occurs twice (autumn) resolves to
 * the FIRST occurrence, so a rule fires once.
 */
export function zonedToUtc({ y, m, d, hh, mm }, tz) {
  const wall = Date.UTC(y, m - 1, d, hh, mm, 0);
  // The offsets a day either side of the wall time cover every transition.
  const offs = [...new Set([tzOffsetMs(wall - 86400000, tz), tzOffsetMs(wall + 86400000, tz), tzOffsetMs(wall, tz)])];
  const hits = [];
  for (const off of offs) {
    const t = wall - off;
    const p = zonedParts(t, tz);
    if (p.y === y && p.m === m && p.d === d && p.hh === hh && p.mm === mm) hits.push(t);
  }
  if (hits.length) return Math.min(...hits);
  // Non-existent local time: read it with the offset in force BEFORE the jump, which
  // lands the same distance past the gap.
  return wall - Math.min(...offs);
}

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function dowIndex(y, m, d) { return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; } // Monday = 0
function weekdayKey(y, m, d) { return WEEKDAYS[dowIndex(y, m, d)]; }
function civilDayNumber(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }
function parseDate(s) { const r = DATE_RE.exec(String(s || '')); return r ? { y: +r[1], m: +r[2], d: +r[3] } : null; }
function pad(n) { return String(n).padStart(2, '0'); }
/** 'YYYY-MM-DD' of civil parts. */
export function civilDate({ y, m, d }) { return `${y}-${pad(m)}-${pad(d)}`; }
/** Today's local date ('YYYY-MM-DD') in `tz` at instant `ms`. */
export function localDate(ms, tz) { return civilDate(zonedParts(ms, tz)); }

/**
 * Validate + normalise a rule. Returns { ok:true, rule } or { ok:false, error }.
 * `todayLocal` ('YYYY-MM-DD') seeds a missing anchor.
 */
export function normalizeRule(input, { todayLocal = null } = {}) {
  const r = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!r) return { ok: false, error: 'repeat.rule must be an object' };
  const freq = String(r.freq || '').toLowerCase();
  if (!['daily', 'weekly', 'monthly'].includes(freq)) return { ok: false, error: 'rule.freq must be daily, weekly or monthly' };
  const interval = r.interval == null ? 1 : Number(r.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) return { ok: false, error: 'rule.interval must be a whole number from 1 to 365' };
  const tm = TIME_RE.exec(String(r.time || ''));
  if (!tm) return { ok: false, error: 'rule.time must be HH:MM (24-hour)' };
  const time = `${pad(+tm[1])}:${tm[2]}`;
  if (!isValidTimeZone(r.tz)) return { ok: false, error: `rule.tz is not a known timezone: ${r.tz ?? '(missing)'}` };
  const out = { freq, interval, time, tz: r.tz };
  if (freq === 'weekly') {
    const days = Array.isArray(r.weekdays) ? [...new Set(r.weekdays.map((x) => String(x).toLowerCase().slice(0, 2)))] : [];
    if (days.some((x) => !WEEKDAYS.includes(x))) return { ok: false, error: 'rule.weekdays must use mo tu we th fr sa su' };
    if (!days.length) return { ok: false, error: 'rule.weekdays needs at least one day' };
    out.weekdays = WEEKDAYS.filter((x) => days.includes(x));
  }
  if (freq === 'monthly') {
    const md = r.monthDay === 'last' ? 'last' : Number(r.monthDay);
    if (md !== 'last' && (!Number.isInteger(md) || md < 1 || md > 31)) return { ok: false, error: 'rule.monthDay must be 1-31 or "last"' };
    out.monthDay = md;
  }
  const anchor = parseDate(r.anchor) ? r.anchor : todayLocal;
  if (!parseDate(anchor)) return { ok: false, error: 'rule.anchor must be YYYY-MM-DD' };
  out.anchor = anchor;
  const end = r.end && typeof r.end === 'object' ? r.end : { type: 'never' };
  const et = String(end.type || 'never');
  if (et === 'never') out.end = { type: 'never' };
  else if (et === 'until') {
    if (!parseDate(end.until)) return { ok: false, error: 'rule.end.until must be YYYY-MM-DD' };
    out.end = { type: 'until', until: end.until };
  } else if (et === 'count') {
    const c = Number(end.count);
    if (!Number.isInteger(c) || c < 1 || c > 100000) return { ok: false, error: 'rule.end.count must be a whole number of 1 or more' };
    out.end = { type: 'count', count: c };
  } else return { ok: false, error: 'rule.end.type must be never, until or count' };
  return { ok: true, rule: out };
}

function matchesDate(rule, y, m, d, anchor) {
  if (rule.freq === 'daily') {
    const diff = civilDayNumber(y, m, d) - civilDayNumber(anchor.y, anchor.m, anchor.d);
    return diff >= 0 && diff % rule.interval === 0;
  }
  if (rule.freq === 'weekly') {
    if (!rule.weekdays.includes(weekdayKey(y, m, d))) return false;
    if (civilDayNumber(y, m, d) < civilDayNumber(anchor.y, anchor.m, anchor.d)) return false;
    // Week index counted from the Monday of the anchor's week.
    const monday = (yy, mm2, dd) => civilDayNumber(yy, mm2, dd) - dowIndex(yy, mm2, dd);
    const diff = (monday(y, m, d) - monday(anchor.y, anchor.m, anchor.d)) / 7;
    return diff % rule.interval === 0;
  }
  // monthly — a day past the month's end clamps to its last day.
  const months = (y - anchor.y) * 12 + (m - anchor.m);
  if (months < 0 || months % rule.interval !== 0) return false;
  const dim = daysInMonth(y, m);
  const want = rule.monthDay === 'last' ? dim : Math.min(rule.monthDay, dim);
  return d === want;
}

/**
 * The first occurrence strictly after `afterMs`, as a UTC ms instant, or null when
 * the rule has ended (`firedCount` feeds end.type 'count').
 */
export function nextOccurrence(rule, afterMs, { firedCount = 0 } = {}) {
  if (rule.end?.type === 'count' && firedCount >= rule.end.count) return null;
  const anchor = parseDate(rule.anchor);
  const [hh, mm] = rule.time.split(':').map(Number);
  const until = rule.end?.type === 'until' ? parseDate(rule.end.until) : null;
  const start = zonedParts(afterMs, rule.tz);
  let dayNo = civilDayNumber(start.y, start.m, start.d);
  for (let i = 0; i < MAX_SCAN_DAYS; i++, dayNo++) {
    const dt = new Date(dayNo * 86400000);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    if (until && dayNo > civilDayNumber(until.y, until.m, until.d)) return null;
    if (!matchesDate(rule, y, m, d, anchor)) continue;
    const t = zonedToUtc({ y, m, d, hh, mm }, rule.tz);
    if (t > afterMs) return t;
  }
  return null;
}

/** The next `n` occurrences after `afterMs` (for the editor preview). */
export function previewOccurrences(rule, afterMs, n = 3, { firedCount = 0 } = {}) {
  const out = [];
  let t = afterMs, fired = firedCount;
  while (out.length < n) {
    const next = nextOccurrence(rule, t, { firedCount: fired });
    if (next == null) break;
    out.push(next); t = next; fired++;
  }
  return out;
}

function listJoin(xs) { return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`; }
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

/** The plain-language sentence of a rule: "Every weekday at 02:00". */
export function describeRule(rule, { withTz = false } = {}) {
  if (!rule) return '';
  const n = rule.interval || 1;
  let head;
  if (rule.freq === 'daily') head = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (rule.freq === 'weekly') {
    const days = rule.weekdays || [];
    const key = days.join(',');
    if (key === 'mo,tu,we,th,fr') head = n === 1 ? 'Every weekday' : `Every ${n} weeks on weekdays`;
    else if (days.length === 7) head = n === 1 ? 'Every day' : `Every ${n} weeks, every day`;
    else head = `${n === 1 ? 'Every' : `Every ${n} weeks on`} ${listJoin(days.map((d) => WD_LONG[d]))}`;
  } else {
    const day = rule.monthDay === 'last' ? 'the last day' : `the ${ordinal(rule.monthDay)}`;
    head = n === 1 ? `Every month on ${day}` : `Every ${n} months on ${day}`;
  }
  let s = `${head} at ${rule.time}`;
  if (rule.end?.type === 'until') s += `, until ${rule.end.until}`;
  if (rule.end?.type === 'count') s += `, ${rule.end.count} time${rule.end.count === 1 ? '' : 's'}`;
  if (withTz) s += ` (${rule.tz})`;
  return s;
}

/** "Sat Sep 19, 02:00" in `tz` — the app's hand-rolled local format (app.js fmtResetAtLocal). */
export function formatInstant(ms, tz, { withYear = false } = {}) {
  const p = zonedParts(ms, tz);
  const wd = WD_SHORT[weekdayKey(p.y, p.m, p.d)];
  return `${wd} ${MONTHS[p.m - 1]} ${p.d}${withYear ? ` ${p.y}` : ''}, ${pad(p.hh)}:${pad(p.mm)}`;
}

/** "7h 12m" / "3d 4h" / "45s" — the distance to a future instant ('' when past). */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Parse the CLI's `--every` shorthand into a rule (tz/anchor filled by the caller):
 *   "day 03:30" · "3 days 02:00" · "weekdays 02:00" · "weekends 09:00"
 *   "mon,wed,fri 02:00" · "2 weeks mon 02:00" · "month 1 02:00" · "3 months last 02:00"
 */
export function parseEvery(text) {
  const toks = String(text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (toks.length < 2) return { ok: false, error: '--every needs a pattern and a time, e.g. "weekdays 02:00"' };
  const time = toks.pop();
  if (!TIME_RE.test(time)) return { ok: false, error: `--every: "${time}" is not a HH:MM time` };
  let interval = 1;
  if (/^\d+$/.test(toks[0])) interval = Number(toks.shift());
  if (!toks.length) return { ok: false, error: '--every: missing unit (day, week, month, weekdays, or day names)' };
  const unit = toks.shift();
  const days = (s) => s.split(',').map((x) => x.trim().slice(0, 2)).filter(Boolean);
  if (['day', 'days', 'daily', 'night', 'nightly'].includes(unit) && !toks.length) return { ok: true, rule: { freq: 'daily', interval, time } };
  if (unit === 'weekdays' && !toks.length) return { ok: true, rule: { freq: 'weekly', interval, weekdays: ['mo', 'tu', 'we', 'th', 'fr'], time } };
  if (unit === 'weekends' && !toks.length) return { ok: true, rule: { freq: 'weekly', interval, weekdays: ['sa', 'su'], time } };
  if (['week', 'weeks', 'weekly'].includes(unit)) {
    if (toks.length !== 1) return { ok: false, error: '--every: name the day(s), e.g. "week mon 02:00" or "2 weeks mon,thu 02:00"' };
    const d = days(toks[0]);
    if (!d.length || d.some((x) => !WEEKDAYS.includes(x))) return { ok: false, error: `--every: unknown day in "${toks[0]}"` };
    return { ok: true, rule: { freq: 'weekly', interval, weekdays: d, time } };
  }
  if (['month', 'months', 'monthly'].includes(unit)) {
    if (toks.length !== 1) return { ok: false, error: '--every: name the day of the month, e.g. "month 1 02:00" or "month last 02:00"' };
    const md = toks[0] === 'last' ? 'last' : Number(toks[0]);
    if (md !== 'last' && (!Number.isInteger(md) || md < 1 || md > 31)) return { ok: false, error: `--every: "${toks[0]}" is not a day of the month` };
    return { ok: true, rule: { freq: 'monthly', interval, monthDay: md, time } };
  }
  if (!toks.length) {
    const d = days(unit);
    if (d.length && d.every((x) => WEEKDAYS.includes(x))) return { ok: true, rule: { freq: 'weekly', interval, weekdays: d, time } };
  }
  return { ok: false, error: `--every: cannot read "${text}" — try "day 03:30", "weekdays 02:00", "mon,thu 02:00" or "month 1 02:00"` };
}

/**
 * Translate a 5-field cron line when a rule can express it (fixed minute + hour, and
 * either a day-of-week set or one day-of-month). Anything else is refused with a hint.
 */
export function parseCron(text) {
  const f = String(text || '').trim().split(/\s+/);
  if (f.length !== 5) return { ok: false, error: '--cron needs five fields: minute hour day-of-month month day-of-week' };
  const [min, hour, dom, mon, dow] = f;
  const hint = ' — only a fixed time with day-of-week or one day-of-month is supported; use --every for the rest';
  if (!/^\d{1,2}$/.test(min) || !/^\d{1,2}$/.test(hour) || +min > 59 || +hour > 23) return { ok: false, error: `--cron: minute and hour must be single numbers${hint}` };
  if (mon !== '*') return { ok: false, error: `--cron: a month field is not supported${hint}` };
  const time = `${pad(+hour)}:${pad(+min)}`;
  if (dom === '*' && dow === '*') return { ok: true, rule: { freq: 'daily', interval: 1, time } };
  if (dom === '*') {
    const set = new Set();
    for (const part of dow.split(',')) {
      const r = /^(\d)(?:-(\d))?$/.exec(part);
      if (!r) return { ok: false, error: `--cron: cannot read day-of-week "${dow}"${hint}` };
      const a = +r[1], b = r[2] == null ? a : +r[2];
      if (a > 7 || b > 7 || b < a) return { ok: false, error: `--cron: cannot read day-of-week "${dow}"${hint}` };
      for (let i = a; i <= b; i++) set.add(WEEKDAYS[((i % 7) + 6) % 7]); // cron 0/7 = Sunday
    }
    return { ok: true, rule: { freq: 'weekly', interval: 1, weekdays: WEEKDAYS.filter((d) => set.has(d)), time } };
  }
  if (dow === '*' && /^\d{1,2}$/.test(dom) && +dom >= 1 && +dom <= 31) return { ok: true, rule: { freq: 'monthly', interval: 1, monthDay: +dom, time } };
  return { ok: false, error: `--cron: this pattern cannot be expressed${hint}` };
}

/**
 * Parse a one-shot `--at` value into a UTC ms instant. Local forms are read in `tz`:
 *   "02:00" (next occurrence) · "today 22:00" · "tomorrow 02:00" · "+90m" "+2h" "+1d"
 *   "2026-09-19 02:00" · "2026-09-19T02:00" · ISO 8601 with an offset or Z
 */
export function parseAt(text, { nowMs, tz }) {
  const s = String(text || '').trim();
  if (!s) return { ok: false, error: '--at needs a time' };
  const rel = /^\+(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)$/i.exec(s);
  if (rel) {
    const n = Number(rel[1]); const u = rel[2][0].toLowerCase();
    return { ok: true, ms: nowMs + n * (u === 's' ? 1000 : u === 'm' ? 60000 : u === 'h' ? 3600000 : 86400000) };
  }
  if (/\d{4}-\d{2}-\d{2}T/.test(s) && /([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? { ok: true, ms } : { ok: false, error: `--at: cannot read "${s}"` };
  }
  const now = zonedParts(nowMs, tz);
  let r = /^(?:(today|tomorrow)\s+)?(\d{1,2}:\d{2})$/i.exec(s);
  if (r) {
    const tm = TIME_RE.exec(r[2]);
    if (!tm) return { ok: false, error: `--at: "${r[2]}" is not a HH:MM time` };
    const base = civilDayNumber(now.y, now.m, now.d) + (String(r[1] || '').toLowerCase() === 'tomorrow' ? 1 : 0);
    const mk = (dayNo) => {
      const dt = new Date(dayNo * 86400000);
      return zonedToUtc({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hh: +tm[1], mm: +tm[2] }, tz);
    };
    let ms = mk(base);
    if (!r[1] && ms <= nowMs) ms = mk(base + 1); // a bare time means its NEXT occurrence
    return { ok: true, ms };
  }
  r = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (r) {
    if (+r[4] > 23 || +r[5] > 59) return { ok: false, error: `--at: "${s}" is not a valid time` };
    return { ok: true, ms: zonedToUtc({ y: +r[1], m: +r[2], d: +r[3], hh: +r[4], mm: +r[5] }, tz) };
  }
  return { ok: false, error: `--at: cannot read "${s}" — try "02:00", "tomorrow 02:00", "+90m" or "2026-09-19 02:00"` };
}

/**
 * Parse an API `scheduledFor`: ISO 8601 WITH an offset or Z only — the server cannot
 * know the caller's zone. Returns { ok, ms } or { ok:false, error }.
 */
export function parseScheduledFor(value) {
  if (typeof value !== 'string' || !value.trim()) return { ok: false, error: 'scheduledFor must be an ISO 8601 string' };
  const s = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    return { ok: false, error: 'scheduledFor must be ISO 8601 with a UTC offset or Z, e.g. 2026-09-19T02:00:00+02:00' };
  }
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return { ok: false, error: 'scheduledFor is not a valid date' };
  return { ok: true, ms };
}
