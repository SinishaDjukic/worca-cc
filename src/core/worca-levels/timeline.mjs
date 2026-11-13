// src/core/worca-levels/timeline.mjs — pure time helpers for the Worca Levels facts layer: the first
// moment two runs were in flight together, and the person's "council" streak of busy days. No I/O,
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

// Calendar arithmetic on a 'YYYY-MM-DD' key, done on the UTC date so DST never shifts it.
function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
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

// Consecutive days with at least `perDay` finishes. `metAt` is the `perDay`-th finish on the last day of
// the first run of `days` such days; `current` is the raw run ending yesterday, plus today if it qualifies.
export function councilStreak(finishTimes, tz, now, { days = 30, perDay = 2 } = {}) {
  const byDay = new Map();
  for (const t of finishTimes || []) {
    const ms = Date.parse(t);
    if (!Number.isFinite(ms)) continue;
    const key = dayKey(ms, tz);
    const list = byDay.get(key);
    if (list) list.push(ms); else byDay.set(key, [ms]);
  }
  const qualifying = [...byDay.keys()].filter((k) => byDay.get(k).length >= perDay).sort();

  let metAt = null;
  let run = 0;
  let prev = null;
  for (const key of qualifying) {
    run = prev !== null && addDays(prev, 1) === key ? run + 1 : 1;
    prev = key;
    if (run >= days) {
      const sorted = [...byDay.get(key)].sort((a, b) => a - b);
      metAt = new Date(sorted[perDay - 1]).toISOString();
      break;
    }
  }

  const qualifies = new Set(qualifying);
  const today = dayKey(now, tz);
  let current = qualifies.has(today) ? 1 : 0;
  for (let k = addDays(today, -1); qualifies.has(k); k = addDays(k, -1)) current += 1;
  return { current, metAt };
}
