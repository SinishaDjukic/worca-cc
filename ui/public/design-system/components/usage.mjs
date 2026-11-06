// What the usage rings and figures read (docs/rail/small-rules.md): only providers connected right now, refreshed every
// minute, each ring saying exactly what it shows.

export const USAGE_REFRESH_MS = 60_000;

const WINDOW = { session: 'Session', week: 'Weekly', day: 'Daily', month: 'Monthly' };
/** A window's word in a ring's tooltip. */
export const usageWindow = (k) => WINDOW[k] || k;

/** The providers that count: one signed out or removed has no ring and no figures. */
export const connectedUsage = (usage, isConnected) => usage.filter((u) => isConnected(u.p));

/** A ring's tooltip: "Weekly · Claude Code: 55%", then "Resets Wed 5:00 PM". */
export const usageTip = ({ what, who, figure, resets }) => `${what} · ${who}: ${figure}${resets ? `\nResets ${resets}` : ''}`;
