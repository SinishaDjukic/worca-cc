// test/ui-money.test.mjs — ui/public/money.mjs: the display currency of every AI cost figure (docs/display-currency.md).
// USD must print byte for byte as before (Tarefa 1, A1); other currencies print `usd * rate` through Intl en-US.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  fmtMoney, fmtMoneyExact, fmtMoneyAxis, fmtMoneyRange, fmtCost, usdSetting, usdNote, rateText, isUsd,
  setDisplayCurrency, displayCurrency, normalizeDisplayCurrency, readDisplayCurrency, currencyDigits,
} from '../ui/public/money.mjs';
import { fmtUsd as decorUsd } from '../ui/public/graph/run-decor.mjs';
import { fmtUsd as meterUsd } from '../ui/public/ask-meter.mjs';
import { DEFAULT_FMT } from '../ui/public/stats-view.mjs';
import { TM_FMT } from '../ui/public/team-metrics-view.mjs';
import { checkRows } from './helpers/rows.mjs';

afterEach(() => setDisplayCurrency(null));

test('USD (the default) prints every figure exactly as the formatters did before the display currency existed', async () => {
  setDisplayCurrency(null);
  assert.equal(isUsd(), true);
  await checkRows([
    { name: 'fmtMoney groups thousands', run: () => assert.equal(fmtMoney(1234.5), '$1,234.50') },
    { name: 'fmtMoney floors sub-cent spend', run: () => assert.equal(fmtMoney(0.004), '<$0.01') },
    { name: 'fmtMoney keeps a true zero', run: () => assert.equal(fmtMoney(0), '$0.00') },
    { name: 'fmtMoney non-finite is empty', run: () => { assert.equal(fmtMoney(NaN), ''); assert.equal(fmtMoney(undefined), ''); } },
    { name: 'fmtMoneyExact is 4 dp', run: () => assert.equal(fmtMoneyExact(0.4321), '$0.4321') },
    { name: 'run-decor keeps no grouping and $0.00 for unknown', run: () => { assert.equal(decorUsd(1234.5), '$1234.50'); assert.equal(decorUsd(null), '$0.00'); assert.equal(decorUsd(0.001), '<$0.01'); } },
    { name: 'ask-meter keeps toFixed and null', run: () => { assert.equal(meterUsd(0.426), '$0.43'); assert.equal(meterUsd(NaN), null); } },
    { name: 'stats DEFAULT_FMT', run: () => { assert.equal(DEFAULT_FMT.usd(10456.123), '$10,456.12'); assert.equal(DEFAULT_FMT.usd4(1.5), '$1.5000'); } },
    { name: 'team metrics TM_FMT', run: () => assert.equal(TM_FMT.usd(2500), '$2,500.00') },
    { name: 'axis ticks', run: () => { assert.equal(fmtMoneyAxis(1234), '$1.2k'); assert.equal(fmtMoneyAxis(42.4), '$42'); } },
    { name: 'fmtCost returns the legacy text', run: () => assert.equal(fmtCost(5, () => '$5'), '$5') },
    { name: 'a range keeps its legacy text', run: () => assert.equal(fmtMoneyRange(0.05, 0.2, '$0.05–0.20'), '$0.05–0.20') },
    { name: 'a USD setting is unlabelled', run: () => assert.equal(usdSetting('$5.00'), '$5.00') },
    { name: 'no USD note and no rate line', run: () => { assert.equal(usdNote(1), ''); assert.equal(rateText(), ''); } },
  ]);
});

test('another currency converts usd * rate, at that currency\'s own digits, with its own symbol', async () => {
  setDisplayCurrency({ currency: 'BRL', rate: 5.42, rateAt: '2026-11-11T13:05:00.000Z', rateDate: '2026-11-11', source: 'frankfurter' });
  await checkRows([
    { name: 'BRL', run: () => assert.equal(fmtMoney(1234.5), 'R$6,690.99') },
    { name: 'BRL exact', run: () => assert.equal(fmtMoneyExact(0.4321), 'R$2.3420') },
    { name: 'BRL floor in its own unit', run: () => assert.equal(fmtMoney(0.001), '<R$0.01') },
    { name: 'run-decor follows', run: () => assert.equal(decorUsd(1), 'R$5.42') },
    { name: 'ask-meter follows', run: () => assert.equal(meterUsd(1), 'R$5.42') },
    { name: 'stats follows', run: () => assert.equal(DEFAULT_FMT.usd(1), 'R$5.42') },
    { name: 'team metrics follows', run: () => assert.equal(TM_FMT.usd(1), 'R$5.42') },
    { name: 'axis', run: () => { assert.equal(fmtMoneyAxis(1000), 'R$5.4k'); assert.equal(fmtMoneyAxis(10), 'R$54'); } },
    { name: 'a range shows both ends', run: () => assert.equal(fmtMoneyRange(0.05, 0.2, '$0.05–0.20'), 'R$0.27–R$1.08') },
    { name: 'a setting stays USD and says so', run: () => assert.equal(usdSetting('$5.00'), '$5.00 USD') },
    { name: 'the tooltip keeps the stored USD', run: () => assert.equal(usdNote(0.1234), ' ($0.1234 USD at 5.42 BRL per USD)') },
    { name: 'rate line', run: () => assert.equal(rateText(), '1 USD = 5.42 BRL') },
  ]);
});

test('JPY has no minor unit: whole yen, a <¥1 floor and a 2-digit exact figure', async () => {
  setDisplayCurrency({ currency: 'JPY', rate: 153.2 });
  assert.equal(currencyDigits('JPY'), 0);
  assert.equal(fmtMoney(1234.56), '¥189,135');
  assert.equal(fmtMoney(0.004), '<¥1');
  assert.equal(fmtMoneyExact(0.4321), '¥66.20');
});

test('dollar-sign currencies never read as US dollars (en-US symbols)', async () => {
  setDisplayCurrency({ currency: 'CAD', rate: 1.37 });
  assert.equal(fmtMoney(1), 'CA$1.37');
  setDisplayCurrency({ currency: 'AUD', rate: 1.5 });
  assert.equal(fmtMoney(1), 'A$1.50');
  setDisplayCurrency({ currency: 'MXN', rate: 18 });
  assert.equal(fmtMoney(1), 'MX$18.00');
});

test('a bad currency or rate is USD at 1, never a currency with the wrong rate', async () => {
  await checkRows([
    { name: 'null', run: () => assert.equal(normalizeDisplayCurrency(null).currency, 'USD') },
    { name: 'unknown code', run: () => assert.equal(normalizeDisplayCurrency({ currency: 'XXX', rate: 2 }).currency, 'USD') },
    { name: 'lower case', run: () => assert.equal(normalizeDisplayCurrency({ currency: 'brl', rate: 5 }).currency, 'USD') },
    { name: 'zero rate', run: () => assert.equal(normalizeDisplayCurrency({ currency: 'BRL', rate: 0 }).currency, 'USD') },
    { name: 'NaN rate', run: () => assert.equal(normalizeDisplayCurrency({ currency: 'BRL', rate: 'abc' }).currency, 'USD') },
    { name: 'rate above 1e6', run: () => assert.equal(normalizeDisplayCurrency({ currency: 'BRL', rate: 2e6 }).currency, 'USD') },
    { name: 'missing rate', run: () => assert.equal(normalizeDisplayCurrency({ currency: 'EUR' }).currency, 'USD') },
    { name: 'USD is always rate 1', run: () => assert.equal(normalizeDisplayCurrency({ currency: 'USD', rate: 3 }).rate, 1) },
  ]);
  assert.equal(setDisplayCurrency({ currency: 'EUR', rate: 0.92 }), true, 'a change reports true');
  assert.equal(setDisplayCurrency({ currency: 'EUR', rate: 0.92 }), false, 'the same currency and rate report false');
  assert.equal(displayCurrency().currency, 'EUR');
});

test('readDisplayCurrency reads <html data-currency data-currency-rate> and falls back to USD', async () => {
  const doc = new JSDOM('<!doctype html><html data-currency="BRL" data-currency-rate="5.42"><body></body></html>').window.document;
  assert.deepEqual([readDisplayCurrency(doc).currency, readDisplayCurrency(doc).rate], ['BRL', 5.42]);
  const bare = new JSDOM('<!doctype html><body></body>').window.document;
  assert.equal(readDisplayCurrency(bare).currency, 'USD');
  const bad = new JSDOM('<!doctype html><html data-currency="BRL" data-currency-rate="-1"><body></body></html>').window.document;
  assert.equal(readDisplayCurrency(bad).currency, 'USD');
});
