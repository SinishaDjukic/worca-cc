// src/shared/currencies.mjs — the display currencies Worca offers (docs/display-currency.md).
// One list for the server (settings validation, the rate fetch) and the browser (the Settings
// picker, the money formatter), served at /src/shared/currencies.mjs. Pure: no node:* and no
// process.env, so it loads in both. Costs stay in USD everywhere; a currency only changes how a
// cost is shown. No decimals field on purpose: Intl.NumberFormat knows each currency's minor
// unit (JPY has none) and a second copy of that fact could drift.

/** @typedef {{ code: string, name: string }} Currency */

/** @type {ReadonlyArray<Readonly<Currency>>} */
export const CURRENCIES = Object.freeze([
  Object.freeze({ code: 'USD', name: 'US dollar' }),
  Object.freeze({ code: 'BRL', name: 'Brazilian real' }),
  Object.freeze({ code: 'EUR', name: 'Euro' }),
  Object.freeze({ code: 'GBP', name: 'British pound' }),
  Object.freeze({ code: 'CAD', name: 'Canadian dollar' }),
  Object.freeze({ code: 'AUD', name: 'Australian dollar' }),
  Object.freeze({ code: 'JPY', name: 'Japanese yen' }),
  Object.freeze({ code: 'MXN', name: 'Mexican peso' }),
  Object.freeze({ code: 'INR', name: 'Indian rupee' }),
  Object.freeze({ code: 'CHF', name: 'Swiss franc' }),
]);

export const CURRENCY_CODES = Object.freeze(CURRENCIES.map((c) => c.code));

/** The unit every cost is stored and computed in. Showing it needs no rate. */
export const DEFAULT_CURRENCY = 'USD';

/** Units of a currency per 1 USD above this are not a real rate (a provider glitch or a typo). */
export const MAX_RATE = 1e6;

/**
 * @param {unknown} code
 * @returns {boolean} true only for an exact upper-case code from CURRENCY_CODES ('brl' is false)
 */
export function isSupportedCurrency(code) {
  return typeof code === 'string' && CURRENCY_CODES.includes(code);
}

/**
 * @param {unknown} rate
 * @returns {boolean} a finite number above 0 and at most MAX_RATE
 */
export function isValidRate(rate) {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 && rate <= MAX_RATE;
}
