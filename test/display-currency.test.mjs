// test/display-currency.test.mjs
// Display currency (docs/display-currency.md, 'Contrato - Moeda' v1.2): GET/POST /api/settings/display-currency,
// the displayCurrency field of GET /api/settings, the R12 refusal on POST /api/settings, the shell's
// data-currency attributes and the tolerant settings reader. The rate providers are a local fake reached through
// WORCA_FX_URLS (the real code path, no network); the fake counts every request so "no call" is asserted, not assumed.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

const home = useTempHome(after);
const REAL_HOME = process.env.HOME;
process.env.HOME = home;                     // settings.json lives under HOME, not WORCA_HOME
const settingsPath = join(home, '.worca-cc', 'settings.json');
const readStored = () => { try { return JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return {}; } };
const writeStored = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(settingsPath, JSON.stringify(obj)); };

const USD = { currency: 'USD', rate: 1, rateDate: null, rateAt: null, source: 'fixed' };

// The fake provider: /primary/<code> answers like Frankfurter, /fallback/<code> like open.er-api. Each route's
// behaviour is set per test; every request is counted.
let fake, fakeBase;
let hits = [];
let primary = () => ({ status: 200, body: { date: '2026-11-10', rates: { BRL: 5.42, EUR: 0.93, JPY: 151.2 } } });
let fallback = () => ({ status: 200, body: { result: 'success', time_last_update_unix: 1762732800, rates: { BRL: 5.5, EUR: 0.94 } } });

let srv, base, server;
const JSONH = { 'Content-Type': 'application/json' };
const getDc = () => fetch(`${base}/api/settings/display-currency`);
const postDc = (b) => fetch(`${base}/api/settings/display-currency`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });

before(async () => {
  fake = http.createServer(async (req, res) => {
    const [, which, code] = req.url.split('/');
    hits.push(`${which}/${code}`);
    const r = await (which === 'primary' ? primary : fallback)(code);
    if (r.hang) return;                                   // never answers: the timeout must fire
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
  process.env.WORCA_FX_URLS = `${fakeBase}/primary/{code},${fakeBase}/fallback/{code}`;
  process.env.WORCA_MOCK = '1';
  server = await import('../ui/server.mjs');
  srv = http.createServer(server.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

beforeEach(() => {
  hits = [];
  writeStored({});
  server._testing.resetFxBucket();
  server._testing.setFxFetcher(null);
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (fake) { fake.closeAllConnections?.(); await new Promise((r) => fake.close(r)); }
  delete process.env.WORCA_MOCK;
  delete process.env.WORCA_FX_URLS;
  process.env.HOME = REAL_HOME;
});

test('nothing stored reads as USD at rate 1 everywhere, and no read path calls a rate provider', async () => {
  await checkRows([
    { name: 'GET /api/settings/display-currency answers the USD default', run: async () => {
      const r = await getDc();
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), USD);
    } },
    { name: 'GET /api/settings carries the same object', run: async () => {
      const s = await (await fetch(`${base}/api/settings`)).json();
      assert.deepEqual(s.displayCurrency, USD);
    } },
    { name: 'the shell renders data-currency="USD" data-currency-rate="1"', run: async () => {
      const html = await (await fetch(`${base}/`)).text();
      assert.match(html, /<html [^>]*data-currency="USD" data-currency-rate="1"/);
    } },
    { name: 'none of the above reached the fake provider', run: async () => {
      assert.deepEqual(hits, []);
    } },
  ]);
});

// A socket stand-in in the server's set: it sees exactly what broadcast() sends to an open tab.
function captureFrames() {
  const frames = [];
  const ws = { OPEN: 1, readyState: 1, send: (t) => frames.push(JSON.parse(t)) };
  server._testing.sockets.add(ws);
  return { frames, stop: () => server._testing.sockets.delete(ws) };
}

test('POST a currency fetches the rate once, stores one object, tells the other tabs and every read agrees', async () => {
  const tab = captureFrames();
  let r;
  try { r = await postDc({ currency: 'BRL' }); } finally { tab.stop(); }
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(tab.frames.filter((f) => f.type === 'settings-changed').length, 1, 'one settings-changed frame (contract R6)');
  const body = await r.json();
  assert.equal(body.currency, 'BRL');
  assert.equal(body.rate, 5.42);
  assert.equal(body.rateDate, '2026-11-10');
  assert.equal(body.source, 'frankfurter');
  assert.ok(!Number.isNaN(Date.parse(body.rateAt)), `rateAt is an ISO time: ${body.rateAt}`);
  assert.deepEqual(hits, ['primary/BRL'], 'exactly one provider request');
  assert.deepEqual(readStored().displayCurrency, body, 'stored as the one object the route answered');
  assert.deepEqual(await (await getDc()).json(), body);
  assert.deepEqual((await (await fetch(`${base}/api/settings`)).json()).displayCurrency, body);
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /data-currency="BRL" data-currency-rate="5.42"/);
  assert.deepEqual(hits, ['primary/BRL'], 'the reads and the shell made no further request');
});

test('re-posting the same currency fetches again; JPY and the fallback provider both work', async () => {
  await checkRows([
    { name: 'BRL twice = two provider requests (the way to refresh the rate)', run: async () => {
      assert.equal((await postDc({ currency: 'BRL' })).status, 200);
      assert.equal((await postDc({ currency: 'BRL' })).status, 200);
      assert.deepEqual(hits, ['primary/BRL', 'primary/BRL']);
    } },
    { name: 'JPY stores its rate like any other currency (decimals are the formatter\'s job)', run: async () => {
      const body = await (await postDc({ currency: 'JPY' })).json();
      assert.equal(body.currency, 'JPY');
      assert.equal(body.rate, 151.2);
    } },
    { name: 'primary HTTP 500 falls back to the second provider, with its date and source', run: async () => {
      hits = [];
      primary = () => ({ status: 500, body: { message: 'down' } });
      try {
        const body = await (await postDc({ currency: 'EUR' })).json();
        assert.deepEqual(hits, ['primary/EUR', 'fallback/EUR']);
        assert.equal(body.rate, 0.94);
        assert.equal(body.source, 'open-er-api');
        assert.equal(body.rateDate, '2025-11-10');
      } finally {
        primary = () => ({ status: 200, body: { date: '2026-11-10', rates: { BRL: 5.42, EUR: 0.93, JPY: 151.2 } } });
      }
    } },
  ]);
});

test('back to USD deletes the stored key, answers the default and calls no provider', async () => {
  assert.equal((await postDc({ currency: 'BRL' })).status, 200);
  hits = [];
  const r = await postDc({ currency: 'USD' });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), USD);
  assert.equal('displayCurrency' in readStored(), false, 'USD is the absent key');
  assert.deepEqual(hits, []);
});

test('a bad currency is a 400 BAD_CURRENCY with field currency, nothing stored and no provider call', async () => {
  const bad = [undefined, null, 42, '', 'brl', 'XXX', ['BRL'], { code: 'BRL' }];
  await checkRows(bad.map((currency) => ({ name: `currency ${JSON.stringify(currency)}`, run: async () => {
    const r = await postDc(currency === undefined ? {} : { currency });
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.code, 'BAD_CURRENCY');
    assert.equal(b.field, 'currency');
    assert.match(b.error, /^currency must be one of USD, BRL/);
  } })));
  assert.deepEqual(readStored(), {});
  assert.deepEqual(hits, []);
});

test('when every provider fails the POST is a 502 RATE_UNAVAILABLE with a fixed message and the previous currency stays', async () => {
  assert.equal((await postDc({ currency: 'EUR' })).status, 200);
  const before = readStored().displayCurrency;
  const failures = [
    ['HTTP 500', () => ({ status: 500, body: { error: 'boom' } })],
    ['invalid JSON', () => ({ status: 200, body: 'not json' })],
    ['rate missing', () => ({ status: 200, body: { date: '2026-11-10', rates: {} } })],
    ['rate 0', () => ({ status: 200, body: { date: '2026-11-10', rates: { BRL: 0 } } })],
    ['rate negative', () => ({ status: 200, body: { date: '2026-11-10', rates: { BRL: -5 } } })],
    ['rate as a string', () => ({ status: 200, body: { date: '2026-11-10', rates: { BRL: '5.42' } } })],
    ['rate above 1e6', () => ({ status: 200, body: { date: '2026-11-10', rates: { BRL: 2e6 } } })],
    ['result error', () => ({ status: 200, body: { result: 'error', rates: { BRL: 5 } } })],
  ];
  const savedP = primary; const savedF = fallback;
  try {
    await checkRows(failures.map(([name, reply]) => ({ name, run: async () => {
      primary = reply; fallback = reply;
      const r = await postDc({ currency: 'BRL' });
      assert.equal(r.status, 502);
      const b = await r.json();
      assert.deepEqual(b, { error: 'Could not get the exchange rate for BRL. The currency was not changed.', code: 'RATE_UNAVAILABLE' });
      assert.doesNotMatch(JSON.stringify(b), /127\.0\.0\.1|http|\/primary|stack/i, 'no URL or internals in the body');
      assert.deepEqual(readStored().displayCurrency, before, 'EUR is still stored');
    } })));
  } finally { primary = savedP; fallback = savedF; }
});

test('the network is off under mock without WORCA_FX_URLS: a non-USD POST is a 502 and nothing is stored', async () => {
  const saved = process.env.WORCA_FX_URLS;
  delete process.env.WORCA_FX_URLS;
  try {
    const tab = captureFrames();
    let r;
    try { r = await postDc({ currency: 'BRL' }); } finally { tab.stop(); }
    assert.equal(r.status, 502);
    assert.equal((await r.json()).code, 'RATE_UNAVAILABLE');
    assert.deepEqual(tab.frames.filter((f) => f.type === 'settings-changed'), [], 'a failed save tells no tab anything');
    assert.deepEqual(readStored(), {});
    assert.deepEqual(hits, []);
  } finally { process.env.WORCA_FX_URLS = saved; }
});

test('a provider that never answers times out and the next one is asked (fetcher swapped through _testing)', async () => {
  const { fetchUsdRate } = await import('../src/core/exchange-rates.mjs');
  const t0 = Date.now();
  server._testing.setFxFetcher((code, { signal }) => fetchUsdRate(code, {
    signal, timeoutMs: 150,
    providers: [{ source: 'frankfurter', url: `${fakeBase}/primary/{code}` }, { source: 'open-er-api', url: `${fakeBase}/fallback/{code}` }],
  }));
  const savedP = primary;
  primary = () => ({ hang: true });
  try {
    const r = await postDc({ currency: 'BRL' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).source, 'open-er-api');
    assert.ok(Date.now() - t0 < 3000, 'the hung provider cost about one timeout, not forever');
  } finally { primary = savedP; }
});

test('two POSTs in a row are served in order: a slow BRL then a fast EUR ends in EUR with EUR\'s rate', async () => {
  const savedP = primary;
  primary = async (code) => {
    if (code === 'BRL') await new Promise((r) => setTimeout(r, 300));
    return { status: 200, body: { date: '2026-11-10', rates: { BRL: 5.42, EUR: 0.93 } } };
  };
  try {
    const slow = postDc({ currency: 'BRL' });
    await new Promise((r) => setTimeout(r, 50));            // BRL reaches the queue first
    const fast = postDc({ currency: 'EUR' });
    const [a, b] = await Promise.all([slow, fast]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.deepEqual(hits, ['primary/BRL', 'primary/EUR'], 'EUR waited for BRL');
    const stored = readStored().displayCurrency;
    assert.equal(stored.currency, 'EUR');
    assert.equal(stored.rate, 0.93, 'never EUR with the BRL rate');
  } finally { primary = savedP; }
});

test('the rate bucket answers 429 RATE_LIMITED once spent, and USD is never limited', async () => {
  server._testing.resetFxBucket(2);
  assert.equal((await postDc({ currency: 'BRL' })).status, 200);
  assert.equal((await postDc({ currency: 'BRL' })).status, 200);
  const r = await postDc({ currency: 'BRL' });
  assert.equal(r.status, 429);
  assert.deepEqual(await r.json(), { error: 'Too many currency changes. Try again in a moment.', code: 'RATE_LIMITED' });
  assert.equal(hits.length, 2, 'the refused POST made no provider request');
  assert.equal((await postDc({ currency: 'USD' })).status, 200);
});

test('a failed write is a 500 SAVE_FAILED with a fixed message, and the previous currency stays', { skip: process.getuid?.() === 0 && 'root ignores directory permissions' }, async () => {
  assert.equal((await postDc({ currency: 'EUR' })).status, 200);
  const dir = join(home, '.worca-cc');
  chmodSync(dir, 0o500);                                    // readable, not writable: the temp file cannot be created
  try {
    const r = await postDc({ currency: 'BRL' });
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'Could not save the display currency.', code: 'SAVE_FAILED' });
  } finally { chmodSync(dir, 0o700); }
  assert.equal(readStored().displayCurrency.currency, 'EUR');
});

test('POST /api/settings refuses displayCurrency with a 400 before any write (root intact), and its other saves keep the currency', async () => {
  await checkRows([
    { name: 'R12: displayCurrency in the body is a 400 with field displayCurrency and root is untouched', run: async () => {
      writeStored({ root: home, displayCurrency: { currency: 'EUR', rate: 0.93, rateDate: '2026-11-10', rateAt: '2026-11-11T10:00:00.000Z', source: 'frankfurter' } });
      const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: JSONH, body: JSON.stringify({ displayCurrency: { currency: 'BRL' } }) });
      assert.equal(r.status, 400);
      const b = await r.json();
      assert.equal(b.field, 'displayCurrency');
      assert.equal(typeof b.error, 'string');
      const s = readStored();
      assert.equal(s.root, home, 'root survived');
      assert.equal(s.displayCurrency.currency, 'EUR');
    } },
    { name: 'a POST /api/settings of another key keeps the stored currency', run: async () => {
      const r = await fetch(`${base}/api/settings`, { method: 'POST', headers: JSONH, body: JSON.stringify({ theme: 'dark' }) });
      assert.equal(r.status, 200, await r.clone().text());
      assert.equal((await r.json()).displayCurrency.currency, 'EUR');
      assert.equal(readStored().displayCurrency.currency, 'EUR');
    } },
  ]);
});

test('a partly invalid stored value reads as the whole USD default (never BRL at rate 1), and warns once per value', async () => {
  const { displayCurrency } = await import('../src/core/settings.mjs');
  const rateAt = '2026-11-11T10:00:00.000Z';
  const bad = [
    ['not an object', 'BRL'],
    ['unknown code', { currency: 'XXX', rate: 5, rateDate: null, rateAt, source: 'frankfurter' }],
    ['lower-case code', { currency: 'brl', rate: 5, rateDate: null, rateAt, source: 'frankfurter' }],
    ['rate missing', { currency: 'BRL', rateDate: null, rateAt, source: 'frankfurter' }],
    ['rate 0', { currency: 'BRL', rate: 0, rateDate: null, rateAt, source: 'frankfurter' }],
    ['rate NaN-ish string', { currency: 'BRL', rate: 'abc', rateDate: null, rateAt, source: 'frankfurter' }],
    ['source fixed for BRL', { currency: 'BRL', rate: 5, rateDate: null, rateAt, source: 'fixed' }],
    ['unknown source', { currency: 'BRL', rate: 5, rateDate: null, rateAt, source: 'bank' }],
    ['bad rateDate', { currency: 'BRL', rate: 5, rateDate: '10/11/2026', rateAt, source: 'frankfurter' }],
    ['rateAt missing', { currency: 'BRL', rate: 5, rateDate: null, source: 'frankfurter' }],
    ['USD with a rate other than 1', { currency: 'USD', rate: 5, rateDate: null, rateAt: null, source: 'fixed' }],
  ];
  const warned = [];
  const realWarn = console.warn;
  console.warn = (msg) => { warned.push(String(msg)); };
  try {
    await checkRows(bad.map(([name, v]) => ({ name, run: async () => {
      assert.deepEqual(displayCurrency({ displayCurrency: v }), USD);
      assert.deepEqual(displayCurrency({ displayCurrency: v }), USD);
    } })));
  } finally { console.warn = realWarn; }
  assert.equal(warned.length, bad.length, 'one warning per distinct bad value, not per read');
  assert.ok(warned.every((w) => w.startsWith('[worca] invalid displayCurrency')));
  writeStored({ displayCurrency: { currency: 'BRL', rate: 'x' } });
  assert.deepEqual(await (await getDc()).json(), USD, 'the route reads the same tolerant value');
});
