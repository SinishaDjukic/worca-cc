// ui/public/money.mjs - the display currency of every AI cost figure (docs/display-currency.md).
// USD stays the stored and computed unit everywhere; this module only turns a USD amount into the words a person
// reads: `usd * rate`, formatted by Intl.NumberFormat('en-US') in the chosen currency (CA$, A$, MX$ never read as $).
// One module-level choice, so every formatter (app.js fmtUsd/fmtUsd4, graph/run-decor.mjs, ask-meter.mjs, stats,
// team metrics...) prints the same. With USD (the default) every figure is byte for byte what it was before.
// Budget, limit and cap INPUTS stay in USD (settings, not spend): callers keep their own USD text for those.

import { isSupportedCurrency, isValidRate } from '../../src/shared/currencies.mjs';

const USD = Object.freeze({ currency: 'USD', rate: 1, rateAt: null, rateDate: null, source: 'fixed' });

let current = USD;
const formatters = new Map();

/** A cached en-US Intl.NumberFormat: `currency` null = a plain number; `digits` null = the currency's own. */
function nf(currency, digits = null) {
  const key = `${currency}|${digits}`;
  let f = formatters.get(key);
  if (!f) {
    const o = currency ? { style: 'currency', currency } : {};
    if (digits != null) { o.minimumFractionDigits = digits; o.maximumFractionDigits = digits; }
    f = new Intl.NumberFormat('en-US', o);
    formatters.set(key, f);
  }
  return f;
}

/** The currency's own fraction digits (USD 2, JPY 0), as Intl knows them. */
export function currencyDigits(currency = current.currency) {
  try { return nf(currency).resolvedOptions().maximumFractionDigits; } catch { return 2; }
}

/**
 * A `{currency, rate, rateAt, rateDate, source}` (Contrato - Moeda: GET /api/settings' displayCurrency, GET/POST
 * /api/settings/display-currency) made safe: a code off src/shared/currencies.mjs or a rate it does not accept
 * (finite, > 0, <= MAX_RATE) is USD at 1, never a currency with the wrong rate.
 * @param {unknown} dc
 * @returns {{currency:string, rate:number, rateAt:string|null, rateDate:string|null, source:string}}
 */
export function normalizeDisplayCurrency(dc) {
  if (!dc || typeof dc !== 'object') return USD;
  const currency = dc.currency;
  const rate = typeof dc.rate === 'string' ? Number(dc.rate) : dc.rate;   // data-currency-rate is a string
  if (!isSupportedCurrency(currency) || currency === 'USD' || !isValidRate(rate)) return USD;
  try { nf(currency); } catch { return USD; }
  const str = (v) => (typeof v === 'string' && v ? v : null);
  return Object.freeze({ currency, rate, rateAt: str(dc.rateAt), rateDate: str(dc.rateDate), source: str(dc.source) || '' });
}

/**
 * Make `dc` the display currency for every later paint.
 * @param {unknown} dc
 * @returns {boolean} true when the currency or the rate changed
 */
export function setDisplayCurrency(dc) {
  const next = normalizeDisplayCurrency(dc);
  const changed = next.currency !== current.currency || next.rate !== current.rate;
  current = next;
  return changed;
}

/** The current display currency (frozen). */
export function displayCurrency() {
  return current;
}

/** True while figures print in USD (the default): call sites keep their own legacy USD text then. */
export function isUsd() {
  return current.currency === 'USD';
}

/**
 * The display currency the server rendered on `<html data-currency data-currency-rate>` (src/core/index-html.mjs),
 * USD when it is absent or bad.
 * @param {Document} doc
 */
export function readDisplayCurrency(doc) {
  const ds = (doc && doc.documentElement && doc.documentElement.dataset) || {};
  return normalizeDisplayCurrency({ currency: ds.currency, rate: ds.currencyRate });
}

/**
 * A USD amount in the display currency at the currency's own digits: `$1,234.56`, `R$2.28`, `CA$1.37`, `¥66`.
 * A positive amount under the smallest unit prints `<$0.01` / `<¥1`, so real spend never reads as free.
 * Non-finite input -> '' (the caller picks its own placeholder).
 * @param {unknown} usd
 */
export function fmtMoney(usd) {
  const v = Number(usd);
  if (!Number.isFinite(v)) return '';
  const { currency, rate } = current;
  if (currency === 'USD') return v > 0 && v < 0.01 ? '<$0.01' : '$' + nf(null, 2).format(v);
  const d = currencyDigits(currency);
  const x = v * rate;
  const unit = 10 ** -d;
  if (v > 0 && x < unit) return '<' + nf(currency, d).format(unit);
  return nf(currency, d).format(x);
}

/**
 * A call site's own USD text while the display currency is USD (byte for byte as before), else `fmtMoney(usd)`.
 * For the formatters that predate this module and spell USD their own way (`$1234.56` without grouping, `$12`).
 * @param {unknown} usd
 * @param {string | (() => string)} usdText  the legacy USD text (a function, to skip building it when not used)
 * @param {(usd:unknown) => string} [other]  the non-USD formatter (fmtMoney, or fmtMoneyExact for more digits)
 */
export function fmtCost(usd, usdText, other = fmtMoney) {
  if (current.currency === 'USD') return typeof usdText === 'function' ? usdText() : usdText;
  return other(usd);
}

/**
 * A cost range: the call site's own USD text while the display currency is USD (`$0.05–0.20`), else both ends in
 * the display currency (`R$0.27–R$1.08`), one figure when they print alike.
 * @param {number} lo
 * @param {number} hi
 * @param {string | (() => string)} usdText
 */
export function fmtMoneyRange(lo, hi, usdText) {
  if (current.currency === 'USD') return typeof usdText === 'function' ? usdText() : usdText;
  const a = fmtMoney(lo);
  const b = fmtMoney(hi);
  return a === b ? a : `${a}–${b}`;
}

/**
 * A setting that stays in USD whatever the display currency (a cap, a limit, a price per Mtok, a developer rate):
 * its USD text as is while the display currency is USD, else with ` USD` after it so it never reads as the display
 * currency (`$5.00 USD`). Tarefa 1, A10.
 * @param {string} usdText
 */
export function usdSetting(usdText) {
  return current.currency === 'USD' || !usdText ? usdText : `${usdText} USD`;
}

/**
 * The exact figure for a tooltip: `extra` more digits than the currency's own (`$0.4321`, `R$2.3420`, `¥66.38`).
 * Non-finite -> ''.
 * @param {unknown} usd
 * @param {number} [extra]
 */
export function fmtMoneyExact(usd, extra = 2) {
  const v = Number(usd);
  if (!Number.isFinite(v)) return '';
  const { currency, rate } = current;
  if (currency === 'USD') return '$' + nf(null, 2 + extra).format(v);
  return nf(currency, currencyDigits(currency) + extra).format(v * rate);
}

/**
 * A chart axis tick: `$1.2k` at a thousand or more, `$42` at ten or more, else `small(usd)` (the chart's own figure).
 * @param {unknown} usd
 * @param {(usd:number) => string} [small]
 */
export function fmtMoneyAxis(usd, small = fmtMoney) {
  const { currency, rate } = current;
  const u = Number(usd) || 0;
  const v = u * rate;
  if (currency === 'USD') return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : v >= 10 ? `$${Math.round(v)}` : small(u);
  if (v >= 1000) return nf(currency, 1).format(v / 1000) + 'k';
  if (v >= 10) return nf(currency, 0).format(Math.round(v));
  return small(u);
}

/**
 * The tooltip's tail when the display currency is not USD: ` ($0.4321 USD at 5.42 BRL per USD)`, else ''.
 * The stored figure is USD; the tooltip keeps it (Tarefa 1, A10).
 * @param {unknown} usd
 */
export function usdNote(usd) {
  const v = Number(usd);
  if (current.currency === 'USD' || !Number.isFinite(v)) return '';
  return ` ($${nf(null, 4).format(v)} USD at ${current.rate} ${current.currency} per USD)`;
}

/**
 * `1 USD = 5.42 BRL` for the Settings row; '' in USD.
 */
export function rateText() {
  if (current.currency === 'USD') return '';
  return `1 USD = ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(current.rate)} ${current.currency}`;
}
