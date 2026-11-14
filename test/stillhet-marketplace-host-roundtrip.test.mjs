// test/stillhet-marketplace-host-roundtrip.test.mjs — the live Marketplace module (slice 8) against a real server in a child
// process (temp HOME and WORCA_HOME) and a real local git market: an install lands in GET /api/plugins, an update after
// the market moves on raises the version, and a refused install leaves GET /api/plugins byte-equal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { startServer } from './helpers/stillhet-server.mjs';
import { startMarketLive } from '../ui/public/stillhet/live/market-live.mjs';
import { makeSeedMarket } from '../tools/stillhet-seed-marketplace.mjs';

let srv, live, market;
const text = async (p) => (await fetch(`${srv.base}${p}`)).text();
const row = async (name) => JSON.parse(await text('/api/plugins')).plugins.find((p) => p.name === name);

before(async () => {
  srv = await startServer();
  market = await makeSeedMarket();
  const r = await fetch(`${srv.base}/api/marketplaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: market.dir }) });
  assert.equal(r.status, 200, await r.clone().text());
  live = startMarketLive({ fetch: (u, o) => fetch(`${srv.base}${u}`, o), open: () => {} });
  await live.load();
  assert.equal(live.status(), 'ready');
});
after(async () => { await srv?.stop(); if (market?.dir) await rm(market.dir, { recursive: true, force: true }); });

test('Install seed-ready: GET /api/plugins lists it, and the record reads installed', async () => {
  const a = await live.install('seed-ready');
  assert.deepEqual(a, { ok: true, text: 'Installed seed-ready' });
  assert.ok(await row('seed-ready'));
  assert.equal(live.data().plugins.find((p) => p.id === 'seed-ready').installed, true);
});

test('the market moves to 0.2.0 and syncs; Update seed-update raises its version', async () => {
  assert.equal((await live.install('seed-update')).ok, true);
  await market.bump('0.2.0');
  const m = live.data().plugins.find((p) => p.id === 'seed-update').market;
  assert.equal((await live.sync(m)).ok, true);
  assert.equal(live.data().plugins.find((p) => p.id === 'seed-update').update, '0.2.0');
  const a = await live.update('seed-update');
  assert.equal(a.ok, true, a.text);
  assert.equal((await row('seed-update')).version, '0.2.0');
});

test('Install seed-broken: Could not install …, and GET /api/plugins is byte-equal before and after', async () => {
  const before = await text('/api/plugins');
  const a = await live.install('seed-broken');
  assert.equal(a.ok, false);
  assert.match(a.text, /^Could not install seed-broken: /);
  assert.equal(await text('/api/plugins'), before);
});
