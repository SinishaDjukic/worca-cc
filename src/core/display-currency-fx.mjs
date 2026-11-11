// src/core/display-currency-fx.mjs: the rate fetching behind POST /api/settings/display-currency
// (docs/display-currency.md). It lives here, not in ui/server.mjs, so the server file stays under its size cap.
// This is the ONLY place Worca asks a rate provider, and only for a currency other than USD. Under mock / node:test
// there is no network unless WORCA_FX_URLS points at a fake; tests can also swap the fetcher with setFxFetcher.
// Saves run one at a time (the last one to arrive is the last to write) and a bucket bounds how often a page can
// make us call out.
import { TokenBucket } from './chat/rate-limiter.mjs';
import { fetchUsdRate, providersFromEnv, FxError } from './exchange-rates.mjs';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const mockMode = () => TRUTHY.has(String(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK ?? '').toLowerCase());

let fetcherOverride = null;
let bucket = new TokenBucket(10);
let queue = Promise.resolve();

function defaultFetcher(code, { signal } = {}) {
  const providers = providersFromEnv();
  if (providers) return fetchUsdRate(code, { providers, signal });
  if (mockMode() || process.env.NODE_TEST_CONTEXT) return Promise.reject(new FxError('exchange rates are off under mock / tests'));
  return fetchUsdRate(code, { signal });
}

/** @returns {Promise<import('./exchange-rates.mjs').FxQuote>} */
export function fetchDisplayRate(code, opts) { return (fetcherOverride || defaultFetcher)(code, opts); }

export function fxTryConsume() { return bucket.tryConsume(); }

/** Run `fn` after every earlier display-currency save has settled (src/core/flags.mjs keeps the same queue). */
export function serializeDisplayCurrency(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

/** Test hooks, spread into ui/server.mjs `_testing`: swap the fetcher (null = the real one again), refill the 429 bucket. */
export const fxTesting = {
  setFxFetcher: (fn) => { fetcherOverride = typeof fn === 'function' ? fn : null; },
  resetFxBucket: (perMin = 10) => { bucket = new TokenBucket(perMin); },
};
