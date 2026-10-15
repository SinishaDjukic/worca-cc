// ui/public/ask-meter.mjs — the Ask composer's context-window and cost figures. Pure; shared by the Chat page
// (ask-panel.mjs re-exports them) and the browser extension's sidebar composer.
export function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1000 ? `${n} tok` : `${(n / 1000).toFixed(1)}k tok`;
}
/** Context window meter (docs: Claude Code compacts about 33k short of the window — 967k of 1M). */
export const CTX_COMPACT_BUFFER = 33000;
export const CTX_WARN = 0.75;          // amber, as a share of the compaction trigger
export const CTX_HIGH = 0.9;           // red: compaction soon
export const CTX_COST_HINT = 200000;   // from here the hover notes every message re-sends the whole context
export const validWindow = (w) => Number.isInteger(w) && w > 0;
export const kTok = (n) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

/** 1000000 → "1M", 1500000 → "1.5M", 200000 → "200k"; null for an unknown window. */
export function fmtWindow(w) {
  if (!validWindow(w)) return null;
  if (w >= 1e6) return `${+(w / 1e6).toFixed(1)}M`;
  if (w >= 1000) return `${+(w / 1000).toFixed(1)}k`;
  return String(w);
}
/** Where automatic compaction starts: window − buffer (the window itself when it is too small for one). */
export function ctxTrigger(w) {
  if (!validWindow(w)) return null;
  return w > 2 * CTX_COMPACT_BUFFER ? w - CTX_COMPACT_BUFFER : w;
}
export function ctxLevel(ctx, w) {
  const t = ctxTrigger(w);
  if (!t || !Number.isFinite(ctx) || ctx <= 0) return null;
  const r = ctx / t;
  return r >= CTX_HIGH ? 'high' : r >= CTX_WARN ? 'warn' : 'ok';
}
/** Share of the FULL window (Claude's own meter does the same); not clamped — a model switch can pass 100. */
export function ctxPercent(ctx, w) {
  return validWindow(w) && Number.isFinite(ctx) && ctx > 0 ? Math.round((ctx / w) * 100) : null;
}
/** Context fill (usage.ctx / totals.ctx) — a snapshot, never a cumulative sum — against the window when known. */
export function fmtCtx(n, w) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const win = fmtWindow(w);
  return win ? `${kTok(n)} / ${win} ctx` : `${kTok(n)} ctx`;
}
/** The meter's hover text, or null when there is nothing worth saying. */
export function ctxTitle(ctx, w) {
  if (!Number.isFinite(ctx) || ctx <= 0) return null;
  const parts = [];
  const pct = ctxPercent(ctx, w);
  if (pct != null) {
    if (ctxLevel(ctx, w) === 'high') parts.push('Compaction soon.');
    parts.push(`${pct}% of the ${fmtWindow(w)} context window. Automatic compaction starts around ${fmtWindow(ctxTrigger(w))}.`);
  }
  if (ctx >= CTX_COST_HINT) parts.push(`Each message re-sends about ${(ctx / 1000).toFixed(1)}k tokens.`);
  return parts.length ? parts.join(' ') : null;
}
/** Share of the window with one decimal, as the popover's rows show it: 120400 of 1M → "12.0%". */
export function fmtShare(n, w) {
  return validWindow(w) && Number.isFinite(n) && n >= 0 ? `${((n / w) * 100).toFixed(1)}%` : null;
}
/** The context popover's figures, or null without a known window and fill. Only what Worca knows:
 *  the fill, the window and the documented compaction buffer — never a per-category split. */
export function ctxBreakdown(ctx, w) {
  if (!validWindow(w) || !Number.isFinite(ctx) || ctx <= 0) return null;
  const trigger = ctxTrigger(w);
  const buffer = w - trigger;
  return {
    used: ctx, buffer, free: Math.max(0, w - ctx - buffer), untilCompact: Math.max(0, trigger - ctx),
    pct: ctxPercent(ctx, w), level: ctxLevel(ctx, w),
  };
}
export function fmtUsd(x) {
  return Number.isFinite(x) ? `$${x.toFixed(2)}` : null;
}
