// src/core/exchange-rates.mjs — one USD -> currency rate, fetched only when the person picks a
// display currency (docs/display-currency.md). Never at boot, never on a page load, never in the
// background: the caller is POST /api/settings/display-currency and nothing else.
//
// Why two keyless providers in a row: Frankfurter (ECB data) is the primary; open.er-api.com
// covers it being down. Each gets its own timeout (5 s), so the request the person waits on is
// bounded at about 10 s. fetch is the process-wide one, which already goes through the configured
// proxy (src/core/env-proxy.mjs#useEnvProxy installs it at boot), so no proxy code lives here.
//
// WORCA_FX_URLS (tests and manual review only) replaces the provider list: comma separated
// http(s) URLs with {code} for the currency. A response is read by shape, not by host, so a fake
// can answer in either provider's format.
import { DEFAULT_CURRENCY, isSupportedCurrency, isValidRate } from '../shared/currencies.mjs';

export const FX_TIMEOUT_MS = 5000;
export const FX_ENV = 'WORCA_FX_URLS';

/** @typedef {'frankfurter' | 'open-er-api'} FxSource */
/** @typedef {{ rate: number, rateDate: string|null, source: FxSource }} FxQuote */
/** @typedef {{ source: FxSource, url: string }} FxProvider */

/** @type {ReadonlyArray<Readonly<FxProvider>>} */
export const DEFAULT_FX_PROVIDERS = Object.freeze([
  Object.freeze({ source: 'frankfurter', url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols={code}' }),
  Object.freeze({ source: 'open-er-api', url: 'https://open.er-api.com/v6/latest/USD' }),
]);

/** Thrown when no provider gave a usable rate. `message` and `reasons` are safe to log (no URL, no body). */
export class FxError extends Error {
  /** @param {string} message @param {string[]} [reasons] */
  constructor(message, reasons = []) {
    super(message);
    this.code = 'RATE_UNAVAILABLE';
    this.reasons = reasons;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The provider list from WORCA_FX_URLS, or null when the env is unset or names no http(s) URL.
 * Read at the point of use: tests change the env between requests. Position decides the
 * `source` label (first = frankfurter, rest = open-er-api) so the enum stays closed.
 * @param {Record<string, string|undefined>} [env]
 * @returns {FxProvider[]|null}
 */
export function providersFromEnv(env = process.env) {
  const raw = env[FX_ENV];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const out = [];
  for (const part of raw.split(',')) {
    const url = part.trim();
    try {
      const { protocol } = new URL(url.replaceAll('{code}', 'USD'));
      if (protocol === 'http:' || protocol === 'https:') out.push({ source: out.length ? 'open-er-api' : 'frankfurter', url });
    } catch { /* not a URL: skipped, a bad test-aid entry must never reach fetch */ }
  }
  return out.length ? out : null;
}

/**
 * Read a provider's JSON by shape. Frankfurter: { date, rates: { BRL } }. open.er-api:
 * { result: 'success', time_last_update_unix, rates: { BRL } }.
 * @param {unknown} body
 * @param {string} code
 * @returns {{ rate: number, rateDate: string|null }|null} null when the body holds no valid rate
 */
export function parseQuote(body, code) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (body.result !== undefined && body.result !== 'success') return null;
  const rates = body.rates;
  const rate = rates && typeof rates === 'object' ? rates[code] : undefined;
  if (!isValidRate(rate)) return null;
  let rateDate = null;
  if (typeof body.date === 'string' && DATE_RE.test(body.date)) rateDate = body.date;
  else if (Number.isFinite(body.time_last_update_unix)) rateDate = new Date(body.time_last_update_unix * 1000).toISOString().slice(0, 10);
  return { rate, rateDate };
}

/**
 * The rate for 1 USD in `code`, from the first provider that answers with a valid one.
 * @param {string} code  a supported currency other than USD
 * @param {{ fetch?: typeof globalThis.fetch, providers?: ReadonlyArray<FxProvider>,
 *   timeoutMs?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<FxQuote>}
 * @throws {FxError} when every provider failed, or the caller aborted
 * @throws {Error} code BAD_CURRENCY for USD or an unsupported code (a caller bug, not a provider failure)
 */
export async function fetchUsdRate(code, { fetch = globalThis.fetch, providers = DEFAULT_FX_PROVIDERS, timeoutMs = FX_TIMEOUT_MS, signal } = {}) {
  if (!isSupportedCurrency(code) || code === DEFAULT_CURRENCY) {
    throw Object.assign(new Error('a rate is fetched only for a supported currency other than USD'), { code: 'BAD_CURRENCY' });
  }
  const reasons = [];
  for (const p of providers) {
    if (signal?.aborted) break;
    const timeout = AbortSignal.timeout(timeoutMs);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await fetch(p.url.replaceAll('{code}', code), { signal: sig, headers: { accept: 'application/json' } });
      if (!res.ok) { reasons.push(`${p.source}: HTTP ${res.status}`); continue; }
      const quote = parseQuote(await res.json(), code);
      if (!quote) { reasons.push(`${p.source}: no valid rate`); continue; }
      return { ...quote, source: p.source };
    } catch (err) {
      // The error name only: a fetch message can carry the URL, and a proxy URL can carry a login.
      reasons.push(`${p.source}: ${timeout.aborted ? 'timeout' : signal?.aborted ? 'aborted' : (err && err.name) || 'error'}`);
    }
  }
  throw new FxError(signal?.aborted ? 'rate fetch aborted' : `no exchange rate for ${code}`, reasons);
}
