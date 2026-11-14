// What the usage rings and figures read (docs/rail/small-rules.md): only providers connected right now, refreshed every
// minute, each ring saying exactly what it shows.

import { attrs } from './html.mjs';

export const USAGE_REFRESH_MS = 60_000;

const WINDOW = { session: 'Session', week: 'Weekly', day: 'Daily', month: 'Monthly' };
/** A window's word in a ring's tooltip. */
export const usageWindow = (k) => WINDOW[k] || k;

/** The providers that count: one signed out or removed has no ring and no figures. */
export const connectedUsage = (usage, isConnected) => usage.filter((u) => isConnected(u.p));

/** A ring's tooltip: "Weekly · Claude Code: 55%", then "Resets Wed 5:00 PM". */
export const usageTip = ({ what, who, figure, resets }) => `${what} · ${who}: ${figure}${resets ? `\nResets ${resets}` : ''}`;

/**
 * UsageRing: how much of a limit is used, filling through the warning colours; used up, it is full and solid red.
 * @param {object} o
 * @param {number} o.pct
 * @param {number} o.warnAt  the warning line, %
 * @param {string} [o.tone]  'over' when it is used up
 * @param {string} [o.cls]   where it sits: the avatar's rings, a row's mini ring
 */
export function usageRing({ pct, warnAt, tone = '', cls = '' }) {
  return `<span class="usage-ring${cls ? ' ' + cls : ''}${tone === 'over' ? ' is-over' : ''}"${attrs({ style: `--p:${Math.max(0, Math.min(100, pct))};--w:${warnAt}`, 'aria-hidden': 'true' })}></span>`;
}
