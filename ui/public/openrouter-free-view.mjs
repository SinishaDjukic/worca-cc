// ui/public/openrouter-free-view.mjs
// OpenRouter's daily allowance of `:free` requests (src/core/openrouter-free.mjs), where it
// comes up: the row in the account menu's spend card, a run's cost pill, the new-run form's
// warning and the Providers page. Pure helpers; app.js fetches /api/openrouter/free-daily.

/** Below this share of the day's allowance the row turns amber. */
export const FREE_LOW_AT = 0.1;
/** A run's typical free requests when this install has no history yet (a small pipeline run). */
export const FREE_RUN_DEFAULT = 90;

/** "3h 12m" / "12m" / "under a minute". Pure. */
export function untilText(ms) {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return 'under a minute';
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}

/** "00:00 UTC". Pure. */
export function utcClock(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? `${new Date(t).toISOString().slice(11, 16)} UTC` : '';
}

/** 'ok' | 'low' | 'out' for a known status. Pure. */
export function freeLevel(s) {
  if (!s || !s.known || !(s.limit > 0)) return 'ok';
  if (s.remaining <= 0) return 'out';
  return s.remaining / s.limit < FREE_LOW_AT ? 'low' : 'ok';
}

/** The requests a run spent on OpenRouter `:free` models (its steps' bridgeFreeCalls). Pure. */
export function runFreeRequests(steps) {
  return (Array.isArray(steps) ? steps : []).reduce((n, s) => n + (Number.isFinite(s?.bridgeFreeCalls) ? s.bridgeFreeCalls : 0), 0);
}

/** " · 87 free requests" for a cost pill, '' when the run used none. Pure. */
export function freeRequestsSuffix(steps) {
  const n = runFreeRequests(steps);
  return n > 0 ? ` · ${n} free request${n === 1 ? '' : 's'}` : '';
}

/**
 * What a run usually takes on this install: the median of the last `max` finished runs that
 * used free requests, else FREE_RUN_DEFAULT. Pure.
 */
export function typicalFreeRun(runs, { max = 10 } = {}) {
  const done = new Set(['completed', 'failed', 'stopped']);
  const counts = (Array.isArray(runs) ? runs : [])
    .filter((r) => r && done.has(r.status))
    .map((r) => runFreeRequests(r.steps))
    .filter((n) => n > 0)
    .slice(0, max)
    .sort((a, b) => a - b);
  if (!counts.length) return FREE_RUN_DEFAULT;
  const mid = Math.floor(counts.length / 2);
  return counts.length % 2 ? counts[mid] : Math.round((counts[mid - 1] + counts[mid]) / 2);
}

/**
 * The new-run form's warning when a chosen model is `:free` and fewer requests are left than a
 * run usually takes; null otherwise. Pure.
 */
export function newRunFreeWarning(s, { typical = FREE_RUN_DEFAULT, usesFree = false, now = Date.now() } = {}) {
  if (!usesFree || !s || !s.known || s.remaining >= typical) return null;
  const reset = Date.parse(s.resetAt || '');
  const when = Number.isFinite(reset) ? ` (resets ${utcClock(s.resetAt)}, in ${untilText(reset - now)})` : '';
  if (s.remaining <= 0) return `No OpenRouter free requests left today${when}: a free model would pause at its first call. Pick a paid model, or start after the reset.`;
  return `${s.remaining} OpenRouter free request${s.remaining === 1 ? '' : 's'} left today${when}; a run here usually needs ~${typical}.`;
}

/** The Providers card's line about the allowance, '' when unknown. Pure. */
export function providerFreeLine(s, { now = Date.now() } = {}) {
  if (!s || !s.known) return '';
  const reset = Date.parse(s.resetAt || '');
  const when = Number.isFinite(reset) ? ` · resets ${utcClock(s.resetAt)} (in ${untilText(reset - now)})` : '';
  return `Free-model requests today: ${s.remaining} of ${s.limit} left${when}.`;
}

/**
 * The account menu's row in the spend card: "Free requests today  37 / 50", amber below 10%, red at
 * 0, the reset in the tip. null when there is nothing to show. Pure.
 */
export function freeDailyRow(s, { now = Date.now() } = {}) {
  if (!s || !s.enabled || !s.known) return null;
  const level = freeLevel(s);
  const reset = Date.parse(s.resetAt || '');
  const title = `OpenRouter free-model requests left today: ${s.remaining} of ${s.limit}` +
    (Number.isFinite(reset) ? ` · resets ${utcClock(s.resetAt)}, in ${untilText(reset - now)}` : '') +
    ' — every model call on a :free model is one request' +
    (level === 'out' ? '. Used up: free models pause until the reset.' : '');
  return { text: `${s.remaining} / ${s.limit}`, tone: level === 'low' ? 'warn' : level === 'out' ? 'over' : '', title };
}
