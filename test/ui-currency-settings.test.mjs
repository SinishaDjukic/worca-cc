// test/ui-currency-settings.test.mjs — ui/public/currency-settings.mjs: Settings › General › Appearance › Currency
// (docs/display-currency.md, contract "Contrato - Moeda" v1.1). The exchange-rate service is reached only by a pick or
// Update rate (one POST); only a 200 changes anything and reloads the tab; errors toast by `code`; other tabs re-read.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createCurrencySettings, currencyErrorText, rateLine, CURRENCY_ROUTE } from '../ui/public/currency-settings.mjs';
import { setDisplayCurrency, displayCurrency } from '../ui/public/money.mjs';
import { CURRENCIES } from '../src/shared/currencies.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const ROW = `<div class="drow" id="currency-row" data-min-level="simple"><span class="drow-label">Currency</span>
  <span class="drow-help" id="currencySentence"></span><small class="hint drow-help" id="currencyRate" hidden></small>
  <div class="drow-control" id="currencyActions"></div></div>`;

afterEach(() => setDisplayCurrency(null));

/** A row with spies: every fetch, every menu, every toast, every reload. `answer(url, init)` returns the Response. */
function mount(answer = () => new Response('{}', { status: 200 }), html = '') {
  const doc = new JSDOM(`<!doctype html><html${html}><body>${ROW}</body></html>`).window.document;
  const calls = { fetch: [], menus: [], toasts: [], reloads: 0 };
  const ctl = createCurrencySettings({
    doc, currencies: CURRENCIES,
    fetchFn: async (url, init = {}) => { calls.fetch.push({ url, method: init.method || 'GET', body: init.body }); return answer(url, init); },
    reload: () => { calls.reloads += 1; },
    notify: (t) => { calls.toasts.push(t); },
    toggleMenu: (o) => { calls.menus.push(o); return null; },
  });
  return { doc, ctl, calls };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('the row paints from the current currency with no fetch at all (nothing on boot or render)', () => {
  const { doc, calls } = mount();
  assert.equal(calls.fetch.length, 0, 'mounting never fetches');
  assert.equal(doc.getElementById('currencySentence').textContent, 'AI costs show in US dollar (USD).');
  const pick = doc.querySelector('#currencySentence .spick-b');
  assert.equal(pick.getAttribute('aria-haspopup'), 'menu');
  assert.equal(doc.getElementById('currencyRate').hidden, true, 'USD has no rate line');
  assert.equal(doc.querySelector('#currencyActions .currency-update'), null, 'USD has no Update rate');
});

test('the picker opens one menu of the ten shared currencies with the current one checked', () => {
  const { doc, calls } = mount();
  doc.querySelector('#currencySentence .spick-b').click();
  assert.equal(calls.menus.length, 1);
  const items = calls.menus[0].items;
  assert.deepEqual(items.map((i) => i.label.slice(-4, -1)), CURRENCIES.map((c) => c.code));
  assert.deepEqual(items.filter((i) => i.checked).map((i) => i.label), ['US dollar (USD)']);
});

test('a pick sends ONE POST with only the code; a double pick while it runs sends nothing more; a 200 reloads', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { doc, ctl, calls } = mount(async () => { await gate; return json(200, { currency: 'BRL', rate: 5.42, rateAt: '2026-11-11T13:05:00.000Z', rateDate: '2026-11-11', source: 'frankfurter' }); });
  const first = ctl.choose('BRL');
  assert.equal(ctl.busy(), true);
  const pick = doc.querySelector('#currencySentence .spick-b');
  assert.equal(pick.disabled, true, 'the picker is busy while the rate is fetched');
  assert.equal(pick.getAttribute('aria-busy'), 'true');
  assert.equal(await ctl.choose('EUR'), false, 'a second pick while busy is refused');
  release();
  assert.equal(await first, true);
  assert.equal(calls.fetch.length, 1);
  assert.deepEqual(calls.fetch[0], { url: CURRENCY_ROUTE, method: 'POST', body: JSON.stringify({ currency: 'BRL' }) });
  assert.equal(calls.reloads, 1, 'a save reloads this tab (A8)');
  assert.equal(displayCurrency().currency, 'BRL');
});

test('a failed save changes nothing, toasts why (by code) and gives the row back', async () => {
  const cases = [
    [502, { error: 'Could not get the exchange rate for BRL. The currency was not changed.', code: 'RATE_UNAVAILABLE' }],
    [429, { error: 'Slow down.', code: 'RATE_LIMITED' }],
    [400, { error: 'currency must be one of USD, BRL', code: 'BAD_CURRENCY', field: 'currency' }],
    [500, { error: 'Could not save the display currency.', code: 'SAVE_FAILED' }],
  ];
  for (const [status, body] of cases) {
    const { doc, ctl, calls } = mount(() => json(status, body));
    assert.equal(await ctl.choose('BRL'), false, `${status}`);
    assert.equal(calls.reloads, 0, `${status}: no reload`);
    assert.equal(displayCurrency().currency, 'USD', `${status}: the currency stays`);
    assert.equal(ctl.busy(), false);
    assert.equal(doc.querySelector('#currencySentence .spick-b').disabled, false, `${status}: the picker is back`);
    assert.equal(calls.toasts.length, 1);
    assert.equal(calls.toasts[0].tone, 'err');
    assert.equal(calls.toasts[0].title, 'Currency not changed');
    assert.equal(calls.toasts[0].detail, body.error, `${status}: the contract's own sentence`);
  }
});

test('offline (fetch throws) toasts in our own words and changes nothing', async () => {
  const { ctl, calls } = mount(() => { throw new TypeError('Failed to fetch'); });
  assert.equal(await ctl.choose('EUR'), false);
  assert.equal(calls.toasts[0].detail, 'Worca did not answer. Nothing changed.');
  assert.equal(calls.reloads, 0);
});

test('currencyErrorText branches on code and status, never on the server text', () => {
  assert.match(currencyErrorText(502, { code: 'RATE_UNAVAILABLE', error: 'anything' }, 'BRL'), /exchange rate for BRL/);
  assert.match(currencyErrorText(429, { code: 'RATE_LIMITED' }, 'BRL'), /Too many/);
  assert.match(currencyErrorText(400, {}, 'XYZ'), /XYZ is not a currency/);
  assert.match(currencyErrorText(500, {}, 'BRL'), /Could not save/);
  assert.match(currencyErrorText(0, {}, 'BRL'), /did not answer/);
});

test('in another currency the row shows the rate, its source and date, and Update rate re-fetches the same code', async () => {
  setDisplayCurrency({ currency: 'BRL', rate: 5.42, rateAt: '2026-11-11T13:05:00.000Z', rateDate: '2026-11-07', source: 'frankfurter' });
  assert.equal(rateLine(), '1 USD = 5.42 BRL · Frankfurter (European Central Bank), rate of Nov 7, 2026');
  const { doc, calls } = mount(() => json(200, { currency: 'BRL', rate: 5.5, rateAt: '2026-11-11T14:00:00.000Z', rateDate: '2026-11-11', source: 'frankfurter' }));
  assert.equal(doc.getElementById('currencySentence').textContent, 'AI costs show in Brazilian real (BRL).');
  assert.equal(doc.getElementById('currencyRate').hidden, false);
  const update = doc.querySelector('#currencyActions .currency-update');
  assert.equal(update.textContent, 'Update rate');
  assert.ok(update.classList.contains('btn-quiet'), 'a design-system quiet Button');
  update.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.fetch.length, 1);
  assert.equal(calls.fetch[0].body, JSON.stringify({ currency: 'BRL' }));
  assert.equal(calls.reloads, 1);
});

test('refresh (another tab saved) GETs the currency, mirrors it on <html> and repaints, with no POST and no reload', async () => {
  const { doc, ctl, calls } = mount(() => json(200, { currency: 'EUR', rate: 0.92, rateAt: '2026-11-11T13:05:00.000Z', rateDate: '2026-11-11', source: 'frankfurter' }),
    ' data-currency="USD" data-currency-rate="1"');
  assert.equal(await ctl.refresh(), true);
  assert.deepEqual(calls.fetch.map((f) => f.method), ['GET']);
  assert.equal(calls.reloads, 0);
  assert.equal(doc.documentElement.dataset.currency, 'EUR');
  assert.equal(doc.documentElement.dataset.currencyRate, '0.92');
  assert.equal(doc.getElementById('currencySentence').textContent, 'AI costs show in Euro (EUR).');
});

test('the shell carries the row in Settings › General › Appearance at Simple', () => {
  const doc = new JSDOM(readIndexHtml()).window.document;
  const row = doc.getElementById('currency-row');
  assert.ok(row, '#currency-row is in the shell');
  assert.equal(row.closest('#appearance-card') !== null, true);
  assert.equal(row.dataset.minLevel, 'simple');
  for (const id of ['currencySentence', 'currencyRate', 'currencyActions']) assert.ok(doc.getElementById(id), `#${id}`);
});
