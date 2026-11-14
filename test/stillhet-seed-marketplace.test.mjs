// test/stillhet-seed-marketplace.test.mjs — tools/stillhet-seed-marketplace.mjs (Stillhet slice 8 D21): after seeding, each
// of the four plugins is in its state through dev's own GET routes, and the live mapper reads that state. An in-process
// server over a real local git market (offline), as test/api-marketplaces.test.mjs runs it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rm } from 'node:fs/promises';
import { useTempHome } from './helpers/temp-home.mjs';
import { pluginsOf } from '../ui/public/stillhet/live/market-map.mjs';

useTempHome(after, 'worca-seed-mk-');
let srv, base, seeded, seed;

before(async () => {
  seed = await import('../tools/stillhet-seed-marketplace.mjs');
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  seeded = await seed.seedMarketplace({ base });
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); if (seeded?.dir) await rm(seeded.dir, { recursive: true, force: true }); });

const get = async (p) => { const r = await fetch(`${base}${p}`); assert.equal(r.status, 200, p); return r.json(); };

test('SEEDED_MARKETPLACE lists the 4 states; each holds through dev\'s GET routes', async () => {
  assert.deepEqual(seed.SEEDED_MARKETPLACE.map((x) => [x.name, x.state]), [['seed-ready', 'installed'], ['seed-update', 'update'], ['seed-setup', 'needs-setup'], ['seed-broken', 'failed-install']]);
  const rows = Object.fromEntries((await get('/api/plugins')).plugins.map((p) => [p.name, p]));
  assert.ok(rows['seed-ready'], 'seed-ready is installed');
  assert.equal(rows['seed-ready'].setup.ok, true);
  assert.equal(rows['seed-update'].latest?.version, '0.2.0');
  assert.equal(rows['seed-setup'].setup.ok, false);
  assert.equal(rows['seed-broken'], undefined, 'seed-broken is not installed');
  assert.match(seeded.refused, /setup\.node declared/);
});

test('seed-broken\'s install answers non-2xx again; the live mapper reads every state', async () => {
  const { marketplaces } = await get('/api/marketplaces');
  const m = marketplaces.find((x) => x.id === seeded.market);
  const r = await fetch(`${base}/api/plugins/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repoUrl: seeded.dir, name: 'seed-broken', sha: m.lastSync.sha, subdir: 'plugins/seed-broken', marketplace: m.id }) });
  assert.ok(r.status >= 400, String(r.status));
  const recs = Object.fromEntries(pluginsOf(marketplaces, (await get('/api/plugins')).plugins, {}).map((p) => [p.id, p]));
  assert.equal(recs['seed-ready'].installed, true);
  assert.equal(recs['seed-update'].update, '0.2.0');
  assert.equal(recs['seed-setup'].needsSetup, true);
  assert.equal(recs['seed-broken'].installed, false);
});

test('the CLI seeds only a blank sandbox: a server that lists projects, or none that answers, is refused', async () => {
  const answering = (projects) => async () => ({ json: async () => ({ projects }) });
  await seed.sandboxOnly('http://x', { fetch: answering([]) });
  await assert.rejects(seed.sandboxOnly('http://x', { fetch: answering([{ name: 'real' }]) }), /not a blank sandbox \(GET \/api\/projects lists 1 projects\)/);
  await assert.rejects(seed.sandboxOnly('http://x', { fetch: async () => { throw new TypeError('fetch failed'); } }), /http:\/\/x is not answering/);
});
