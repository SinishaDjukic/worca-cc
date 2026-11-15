// src/shared/day-buckets.mjs — the day sections both of dev's lists share (moved verbatim from ui/public/runs-list.mjs,
// which re-exports them). Pure: no DOM. Stillhet's live mapper (ui/public/stillhet/live/live-map.mjs) files with them too,
// so a row lands in the same day in both.

/** The day sections both lists share (Runs and Chats Group by Date), top to bottom: Today, Yesterday, 2–7 days ago,
 *  8–30 days ago, then the rest. The boundaries are local midnights, stepped with setDate so a DST day is still one day. */
export const DAY_BUCKETS = Object.freeze([
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Previous 7 days'], ['month', 'Previous 30 days'], ['older', 'Older'],
]);
export function dayBucket(t, now = Date.now()) {
  if (!Number.isFinite(t)) return 'older';
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  if (t >= day.getTime()) return 'today';
  day.setDate(day.getDate() - 1);
  if (t >= day.getTime()) return 'yesterday';
  day.setDate(day.getDate() - 6);
  if (t >= day.getTime()) return 'week';
  day.setDate(day.getDate() - 23);
  return t >= day.getTime() ? 'month' : 'older';
}
