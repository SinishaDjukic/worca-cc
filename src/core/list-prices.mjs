// src/core/list-prices.mjs
// Anthropic list prices for the built-in model ids, in USD per MILLION tokens.
// A zero-import leaf so both config.mjs (the chat footer's live estimate) and the
// credential broker (src/broker/usage.mjs: per-person budgets) price from one table.
//
// From Anthropic's published pricing (platform.claude.com/docs/en/pricing — snapshot
// 2026-06-24; Opus 5.5 added 2026-09-22). `[1m]` twins and dated ids resolve to their
// base row (the long-context premium is not modelled). cacheWrite = 1.25× input
// (5-minute TTL), cacheWrite1h = 2× input, cacheRead = 0.1× input except Fable 5.1
// (0.025×) and Opus 5.5 (0.05×). Refresh by hand when Anthropic moves a price.
export const PREDEFINED_LIST_PRICES = Object.freeze({
  'claude-fable-5-1':  { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5, cacheWrite1h: 20 },
  'claude-opus-5-5':   { input: 4,  output: 20, cacheRead: 0.2,  cacheWrite: 5,    cacheWrite1h: 8 },
  'claude-opus-5':     { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-8':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-7':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-opus-4-6':   { input: 5,  output: 25, cacheRead: 0.5,  cacheWrite: 6.25, cacheWrite1h: 10 },
  'claude-sonnet-5':   { input: 2,  output: 10, cacheRead: 0.2,  cacheWrite: 2.5,  cacheWrite1h: 4 },
  'claude-sonnet-4-6': { input: 3,  output: 15, cacheRead: 0.3,  cacheWrite: 3.75, cacheWrite1h: 6 },
  'claude-haiku-4-5':  { input: 1,  output: 5,  cacheRead: 0.1,  cacheWrite: 1.25, cacheWrite1h: 2 },
});

/** The list-price row for a model id (`[1m]` twins and dated ids map to their base), or null. */
export function listPriceFor(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  if (!id) return null;
  const base = id.replace(/\[1m\]$/, '').replace(/-\d{8}$/, '');
  return PREDEFINED_LIST_PRICES[base] ?? null;
}
