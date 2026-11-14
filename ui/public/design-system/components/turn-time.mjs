// TurnTime (panel.turn-time): when a turn in a conversation was said, shown on hover, on focus and on a tap, in the gap
// under the turn at its right edge; showing it moves nothing (rail.css draws it absolute and reveals it by opacity only).
import { esc, attrs } from './html.mjs';
import { dayBucket } from '../../../../src/shared/day-buckets.mjs';

// fixed English month names and a 24-hour clock: the same text in every locale (the Tooltip's "Replying · 14:30")
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');
const msOf = (at) => (typeof at === 'string' ? Date.parse(at) : typeof at === 'number' ? at : NaN);

/** A turn's time in words, local time: `14:32` today, `Yesterday 14:32`, `Nov 3, 14:32` earlier this year,
 *  `Nov 3 2025, 14:32` another year; a time after today (clock skew) reads its date. '' for an invalid or missing time. */
export function turnTimeText(at, now) {
  const t = msOf(at);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t), clock = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const end = new Date(now); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1);
  if (t < end.getTime()) {
    const b = dayBucket(t, now);
    if (b === 'today') return clock;
    if (b === 'yesterday') return `Yesterday ${clock}`;
  }
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}, ${clock}`;
}

/**
 * TurnTime: a turn's `time.turn-time`, or '' when `at` is not a time.
 * @param {object} o
 * @param {number|string} o.at   when the turn was said (ms, or an ISO string)
 * @param {number} [o.now]
 * @param {object} [o.attrs]
 */
export function turnTime({ at, now = Date.now(), attrs: a = {} } = {}) {
  const t = msOf(at);
  if (!Number.isFinite(t)) return '';
  return `<time class="turn-time"${attrs({ datetime: new Date(t).toISOString(), ...a })}>${esc(turnTimeText(t, now))}</time>`;
}
