// comment-thread.mjs — pure helpers for the Diff tab's comment layer. DOM-free on
// purpose (pattern: diff-view.mjs / log-line.mjs) so node:test covers them without
// jsdom. app.js imports both.

/**
 * Group a run's FLAT comment list (server order: path, line, creation) into
 * threads. Roots keep their order; each thread's replies keep theirs. A reply whose
 * root is not in the list (deleted meanwhile, or filtered out) is NEVER dropped —
 * it becomes a one-card thread at the end, so a stale poke can hide nothing.
 * @param {Array<{id:string, parentId?:string|null}>} list
 * @returns {Array<{root: object, replies: object[]}>}
 */
export function groupCommentThreads(list) {
  const rows = Array.isArray(list) ? list : [];
  const threads = [];
  const byRoot = new Map();
  for (const c of rows) {
    if (c.parentId) continue;
    const t = { root: c, replies: [] };
    threads.push(t);
    byRoot.set(c.id, t);
  }
  const strays = [];
  for (const c of rows) {
    if (!c.parentId) continue;
    const t = byRoot.get(c.parentId);
    if (t) t.replies.push(c); else strays.push(c);
  }
  for (const c of strays) threads.push({ root: c, replies: [] });
  return threads;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * The card's time label (D11): relative for the last seven days, then the calendar
 * date WITH the year, so a fixture from last year renders the same forever. UTC
 * date parts, exactly like the `hdCmtStamp` tooltip it sits under — the suite pins
 * UTC instants and sets no TZ, so a local-time label would fail east of +13.
 * The absolute stamp belongs in `title`, not here.
 */
export function commentWhen(iso, now = Date.now()) {
  const t = new Date(iso ?? NaN).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now - t);
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
