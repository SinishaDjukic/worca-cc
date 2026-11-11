// test/exchange-rates.test.mjs
// The pure parts of the display currency (docs/display-currency.md): the shared currency list, the
// rate fetch (src/core/exchange-rates.mjs) with an injected fetch, WORCA_FX_URLS parsing and the shell's
// data-currency attributes (src/core/index-html.mjs). No server, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENCIES, CURRENCY_CODES, DEFAULT_CURRENCY, isSupportedCurrency, isValidRate } from '../src/shared/currencies.mjs';
import { fetchUsdRate, parseQuote, providersFromEnv, FxError, DEFAULT_FX_PROVIDERS } from '../src/core/exchange-rates.mjs';
import { renderIndexHtml, INDEX_THEME_ANCHOR } from '../src/core/index-html.mjs';
import { checkRows } from './helpers/rows.mjs';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test('the shared list holds the ten agreed codes once each, every one formats with Intl, and the guards are exact', async () => {
  await checkRows([
    { name: 'ten codes, USD first and the default', run: () => {
      assert.deepEqual([...CURRENCY_CODES], ['USD', 'BRL', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'MXN', 'INR', 'CHF']);
      assert.equal(new Set(CURRENCY_CODES).size, CURRENCY_CODES.length);
      assert.equal(DEFAULT_CURRENCY, 'USD');
      assert.ok(Object.isFrozen(CURRENCIES) && CURRENCIES.every(Object.isFrozen));
    } },
    { name: 'every code is a currency Intl.NumberFormat accepts', run: () => {
      for (const c of CURRENCY_CODES) assert.doesNotThrow(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(1), c);
    } },
    { name: 'isSupportedCurrency is exact and upper-case only', run: () => {
      assert.equal(isSupportedCurrency('BRL'), true);
      for (const v of ['brl', ' BRL', 'XXX', '', null, undefined, 1, ['BRL']]) assert.equal(isSupportedCurrency(v), false, JSON.stringify(v));
    } },
    { name: 'isValidRate: finite, above 0, at most 1e6', run: () => {
      for (const v of [1, 0.0001, 5.42, 1e6]) assert.equal(isValidRate(v), true, String(v));
      for (const v of [0, -1, 1e6 + 1, NaN, Infinity, '5', null]) assert.equal(isValidRate(v), false, String(v));
    } },
  ]);
});

test('parseQuote reads both provider shapes and refuses anything without a valid rate', async () => {
  await checkRows([
    { name: 'Frankfurter shape keeps the provider date', run: () => {
      assert.deepEqual(parseQuote({ date: '2026-11-10', rates: { BRL: 5.42 } }, 'BRL'), { rate: 5.42, rateDate: '2026-11-10' });
    } },
    { name: 'open.er-api shape turns time_last_update_unix into a date', run: () => {
      assert.deepEqual(parseQuote({ result: 'success', time_last_update_unix: 1762732800, rates: { BRL: 5.5 } }, 'BRL'), { rate: 5.5, rateDate: '2025-11-10' });
    } },
    { name: 'no date at all is rateDate null', run: () => {
      assert.deepEqual(parseQuote({ rates: { BRL: 5 } }, 'BRL'), { rate: 5, rateDate: null });
    } },
    { name: 'refusals', run: () => {
      for (const b of [null, [], 'x', {}, { rates: {} }, { rates: { BRL: 0 } }, { rates: { BRL: '5' } }, { result: 'error', rates: { BRL: 5 } }]) {
        assert.equal(parseQuote(b, 'BRL'), null, JSON.stringify(b));
      }
    } },
  ]);
});

test('fetchUsdRate takes the first good provider, falls through failures, and throws FxError without URLs', async () => {
  const providers = [{ source: 'frankfurter', url: 'https://a.test/{code}' }, { source: 'open-er-api', url: 'https://b.test/{code}' }];
  await checkRows([
    { name: 'the first provider answers: one request, {code} filled in', run: async () => {
      const urls = [];
      const q = await fetchUsdRate('BRL', { providers, fetch: async (u) => { urls.push(u); return okJson({ date: '2026-11-10', rates: { BRL: 5.42 } }); } });
      assert.deepEqual(q, { rate: 5.42, rateDate: '2026-11-10', source: 'frankfurter' });
      assert.deepEqual(urls, ['https://a.test/BRL']);
    } },
    { name: 'a thrown fetch falls through to the second', run: async () => {
      const q = await fetchUsdRate('EUR', { providers, fetch: async (u) => { if (u.includes('a.test')) throw new TypeError('fetch failed https://a.test'); return okJson({ rates: { EUR: 0.9 } }); } });
      assert.equal(q.source, 'open-er-api');
    } },
    { name: 'all failing is an FxError whose message and reasons carry no URL', run: async () => {
      const err = await fetchUsdRate('EUR', { providers, fetch: async () => { throw new TypeError('fetch failed https://a.test/secret'); } }).catch((e) => e);
      assert.ok(err instanceof FxError);
      assert.equal(err.code, 'RATE_UNAVAILABLE');
      assert.deepEqual(err.reasons, ['frankfurter: TypeError', 'open-er-api: TypeError']);
      assert.doesNotMatch(`${err.message} ${err.reasons}`, /https?:|a\.test/);
    } },
    { name: 'each provider gets its own timeout', run: async () => {
      const hang = (u, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(signal.reason)));
      const t0 = Date.now();
      const err = await fetchUsdRate('BRL', { providers, timeoutMs: 50, fetch: hang }).catch((e) => e);
      assert.deepEqual(err.reasons, ['frankfurter: timeout', 'open-er-api: timeout']);
      assert.ok(Date.now() - t0 < 2000);
    } },
    { name: 'a caller abort stops before the next provider', run: async () => {
      const ac = new AbortController();
      let calls = 0;
      const err = await fetchUsdRate('BRL', { providers, signal: ac.signal, fetch: async () => { calls++; ac.abort(); throw new Error('aborted'); } }).catch((e) => e);
      assert.ok(err instanceof FxError);
      assert.equal(calls, 1);
    } },
    { name: 'USD or an unknown code is a caller bug (BAD_CURRENCY), not a fetch', run: async () => {
      for (const c of ['USD', 'XXX', 'brl']) {
        const err = await fetchUsdRate(c, { providers, fetch: async () => assert.fail('no fetch') }).catch((e) => e);
        assert.equal(err.code, 'BAD_CURRENCY', c);
      }
    } },
    { name: 'the real providers are keyless https URLs', run: () => {
      assert.deepEqual(DEFAULT_FX_PROVIDERS.map((p) => p.source), ['frankfurter', 'open-er-api']);
      assert.ok(DEFAULT_FX_PROVIDERS.every((p) => p.url.startsWith('https://') && !/key|token/i.test(p.url)));
    } },
  ]);
});

test('WORCA_FX_URLS keeps only http(s) URLs and is null when unset or empty of them', async () => {
  await checkRows([
    { name: 'unset / blank', run: () => {
      assert.equal(providersFromEnv({}), null);
      assert.equal(providersFromEnv({ WORCA_FX_URLS: '  ' }), null);
    } },
    { name: 'non-http entries are dropped; position names the source', run: () => {
      const p = providersFromEnv({ WORCA_FX_URLS: 'file:///etc/passwd/{code}, http://127.0.0.1:9/a/{code} ,nonsense, https://x.test/{code}' });
      assert.deepEqual(p, [{ source: 'frankfurter', url: 'http://127.0.0.1:9/a/{code}' }, { source: 'open-er-api', url: 'https://x.test/{code}' }]);
    } },
    { name: 'only bad entries is null (the real providers are not silently used instead under mock)', run: () => {
      assert.equal(providersFromEnv({ WORCA_FX_URLS: 'ftp://x/{code},javascript:alert(1)' }), null);
    } },
  ]);
});

test('the shell carries data-currency and data-currency-rate when given, and USD/1 for anything unusable', async () => {
  const html = `<!DOCTYPE html>\n${INDEX_THEME_ANCHOR}\n<head></head><body>x</body></html>`;
  await checkRows([
    { name: 'BRL 5.42', run: () => {
      assert.match(renderIndexHtml(html, 'dark', undefined, undefined, { currency: { currency: 'BRL', rate: 5.42 } }),
        /<html lang="en" data-theme="dark" data-currency="BRL" data-currency-rate="5.42">/);
    } },
    { name: 'omitted: no attribute (the existing callers and tests are unchanged)', run: () => {
      assert.doesNotMatch(renderIndexHtml(html, 'dark'), /data-currency/);
    } },
    { name: 'an injected or invalid value falls back to USD/1, never into the markup', run: () => {
      for (const c of [{ currency: 'BRL"><script>', rate: 5 }, { currency: 'BRL', rate: '5" onload="x' }, { currency: 'BRL', rate: -1 }]) {
        const out = renderIndexHtml(html, 'system', undefined, undefined, { currency: c });
        assert.match(out, /data-currency="USD" data-currency-rate="1"/);
        assert.doesNotMatch(out, /script|onload/);
      }
    } },
  ]);
});
