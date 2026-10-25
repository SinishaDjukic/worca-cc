// test/api-onboarding-fresh.test.mjs
// GET/POST /api/onboarding's derived `fresh` (D18, AC-4.1): welcome not seen, no project, no run.
// Its own temp home, so the ordered rows cannot pass for the wrong reason (qa-1-4). Same server-test
// shape as test/api-onboarding.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

const home = useTempHome(after);
const REAL_HOME = process.env.HOME;
process.env.HOME = home;                     // settings.json lives under HOME, not WORCA_HOME

let srv, base;
const JSONH = { 'Content-Type': 'application/json' };
const get = async () => (await fetch(`${base}/api/onboarding`)).json();
const post = async (b) => {
  const r = await fetch(`${base}/api/onboarding`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });
  assert.equal(r.status, 200);
  return r.json();
};

before(async () => {
  process.env.WORCA_MOCK = '1';
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  process.env.HOME = REAL_HOME;
});

test('fresh is derived: true on an empty home, false once the welcome is seen or a project exists', async () => {
  await checkRows([
    { name: 'an empty home is fresh', run: async () => {
      assert.equal((await get()).fresh, true);
    } },
    { name: 'welcomeSeen ends fresh (no project, no run yet): the POST answer and the next GET', run: async () => {
      assert.equal((await post({ welcomeSeen: true })).fresh, false);
      assert.equal((await get()).fresh, false);
    } },
    { name: 'welcomeSeen back to false: fresh again', run: async () => {
      await post({ welcomeSeen: false });
      assert.equal((await get()).fresh, true);
    } },
    { name: 'a registered project ends fresh while welcomeSeen stays false', run: async () => {
      const proj = join(home, 'p1');
      mkdirSync(proj, { recursive: true });
      const add = await fetch(`${base}/api/projects`, { method: 'POST', headers: JSONH, body: JSON.stringify({ name: 'p1', path: proj }) });
      assert.equal(add.status, 200, await add.text());
      const s = await get();
      assert.equal(s.welcomeSeen, false);
      assert.equal(s.fresh, false);
    } },
  ]);
});
