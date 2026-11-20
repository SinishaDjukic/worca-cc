// src/core/worca-levels/timeline.mjs — pure time helpers for the Worca Levels facts layer: the first
// moment two runs were in flight together, and the day counts behind runs-on-days and active days. No I/O,
// no clock (the caller passes `now`), and no input is mutated.

const DAY_MS = 24 * 3600 * 1000;

const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

// 'YYYY-MM-DD' for the instant `iso` (ISO string or epoch ms) as seen in zone `tz`.
export function dayKey(iso, tz) {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) throw new RangeError(`dayKey: invalid instant ${String(iso)}`);
  const parts = {};
  for (const p of formatterFor(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Binary min-heap of { ms, iso, id } ordered by ms.
function pushHeap(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].ms <= heap[i].ms) break;
    [heap[parent], heap[i]] = [heap[i], heap[parent]];
    i = parent;
  }
}
function popHeap(heap) {
  const last = heap.pop();
  if (heap.length === 0) return;
  heap[0] = last;
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let smallest = i;
    if (l < heap.length && heap[l].ms < heap[smallest].ms) smallest = l;
    if (r < heap.length && heap[r].ms < heap[smallest].ms) smallest = r;
    if (smallest === i) break;
    [heap[smallest], heap[i]] = [heap[i], heap[smallest]];
    i = smallest;
  }
}

// The earliest "second finish" among runs that overlapped (strictly): { at, ids: [earlier, later] }.
export function firstParallelPair(intervals) {
  const usable = [];
  for (const iv of intervals || []) {
    const start = Date.parse(iv.start);
    const end = Date.parse(iv.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) usable.push({ id: iv.id, start, end, endIso: iv.end });
  }
  usable.sort((a, b) => a.start - b.start);
  const heap = [];
  let best = null;
  for (const b of usable) {
    while (heap.length && heap[0].ms <= b.start) popHeap(heap);
    if (heap.length) {
      const min = heap[0];
      const useB = b.end >= min.ms;
      const ms = useB ? b.end : min.ms;
      if (!best || ms < best.ms) best = { ms, at: useB ? b.endIso : min.iso, ids: [min.id, b.id] };
    }
    pushHeap(heap, { ms: b.end, iso: b.endIso, id: b.id });
  }
  return best ? { at: best.at, ids: best.ids } : null;
}

const ms = (iso) => Date.parse(iso);
const dayNumber = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY_MS; };

// The usable rows ({ ms, row }) oldest finish first; a row with no readable finish is skipped.
function byFinish(rows) {
  const out = [];
  for (const row of rows || []) {
    const t = ms(row?.finishedAt);
    if (Number.isFinite(t)) out.push({ ms: t, row });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// The active days of real-run rows ({ id, finishedAt, scheduleId }): Map<dayKey, firstFinishMs>, oldest first.
// A day is active with one real run. Runs of one schedule count one day in total, the day of the schedule's
// first real finish, so a repeating schedule earns a single active-day credit (D-9).
export function activeDayKeys(rows, tz) {
  const days = new Map();
  const seenSchedules = new Set();
  for (const { ms: t, row } of byFinish(rows)) {
    if (row.scheduleId) {
      if (seenSchedules.has(row.scheduleId)) continue;
      seenSchedules.add(row.scheduleId);
    }
    const key = dayKey(t, tz);
    if (!days.has(key)) days.set(key, t);
  }
  return days;
}

// { metAt, runs, days } over all rows: `metAt` is the finish of the first run at which both thresholds hold
// (at least `runs` runs on at least `days` distinct local days), else null. Every run counts as a run, but the
// runs of one schedule add a single day in total, the day of its first finish (D-9, as in activeDayKeys).
export function firstRunsOnDays(rows, tz, { runs = 10, days = 3 } = {}) {
  const seen = new Set();
  const seenSchedules = new Set();
  let count = 0;
  let metAt = null;
  for (const { ms: t, row } of byFinish(rows)) {
    count += 1;
    const repeat = !!row.scheduleId && seenSchedules.has(row.scheduleId);
    if (row.scheduleId) seenSchedules.add(row.scheduleId);
    if (!repeat) seen.add(dayKey(t, tz));
    if (metAt === null && count >= runs && seen.size >= days) metAt = new Date(t).toISOString();
  }
  return { metAt, runs: count, days: seen.size };
}

// { inWindow, metAt } from the active-day map: `inWindow` counts the active days in [today-(window-1), today];
// `metAt` is the first finish that completed `need` active days inside some `window`-day window. A day
// without activity never resets anything.
export function activeDaysWindow(dayMap, tz, now, { need = 20, window = 30 } = {}) {
  const sorted = [...dayMap.entries()].map(([key, t]) => ({ n: dayNumber(key), t })).sort((a, b) => a.n - b.n);
  const today = dayNumber(dayKey(now, tz));
  const inWindow = sorted.filter((d) => d.n > today - window && d.n <= today).length;
  let metAt = null;
  let lo = 0;
  for (let hi = 0; hi < sorted.length && metAt === null; hi++) {
    while (sorted[hi].n - sorted[lo].n >= window) lo += 1;
    if (hi - lo + 1 >= need) metAt = new Date(sorted[hi].t).toISOString();
  }
  return { inWindow, metAt };
}
