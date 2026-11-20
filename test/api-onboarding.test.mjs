// test/api-onboarding.test.mjs
// GET/POST /api/onboarding — the derived checklist plus the two stored flags.
// Server-test shape (api-run-report.test.mjs): useTempHome at module top level,
// the app imported INSIDE before(), an ephemeral http server and real fetch.
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
const get = () => fetch(`${base}/api/onboarding`);
const post = (b) => fetch(`${base}/api/onboarding`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });

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

test('GET answers the nine derived steps, counts, the CLI probe and both flags; a step ticks by itself once product state changes', async () => {
  await checkRows([
    { name: 'GET answers the nine derived steps, counts, the CLI probe and both flags', run: async () => {
      const r = await get();
      assert.equal(r.status, 200);
      const s = await r.json();
      assert.deepEqual(Object.keys(s.steps).sort(),
        ['ask', 'claude', 'project', 'realRun', 'run', 'teamMetrics', 'teamPolicy', 'workflows', 'workspace']);
      assert.equal(s.total, 9);
      assert.equal(s.done, Object.values(s.steps).filter(Boolean).length);
      assert.equal(s.hidden, false);
      assert.equal(s.welcomeSeen, false);
      assert.equal(typeof s.claude.bin, 'string');
      assert.ok('hint' in s.claude);
    } },
    { name: 'a step ticks by itself once the product state changes (no client write)', run: async () => {
      const proj = join(home, 'p1');
      mkdirSync(proj, { recursive: true });
      const add = await fetch(`${base}/api/projects`, { method: 'POST', headers: JSONH, body: JSON.stringify({ name: 'p1', path: proj }) });
      assert.equal(add.status, 200, await add.text());
      const s = await (await get()).json();
      assert.equal(s.steps.project, true);
    } },
  ]);
});

test('POST writes ONLY the stored flags (Show again keeps welcomeSeen) and refuses non-booleans/unknown keys with 400, writing nothing', async () => {
  await checkRows([
    { name: 'POST writes ONLY the flags and echoes the full payload; Show again keeps welcomeSeen', run: async () => {
      let s = await (await post({ hidden: true })).json();
      assert.equal(s.hidden, true);
      assert.equal(s.welcomeSeen, false);
      assert.equal(s.steps.project, true, 'the derived ticks ride along');
      s = await (await post({ welcomeSeen: true })).json();
      assert.deepEqual([s.hidden, s.welcomeSeen], [true, true]);
      s = await (await post({ hidden: false })).json();
      assert.deepEqual([s.hidden, s.welcomeSeen], [false, true], 'only the checklist comes back, not the welcome');
      s = await (await get()).json();
      assert.deepEqual([s.hidden, s.welcomeSeen], [false, true], 'persisted');
    } },
    { name: 'POST accepts workspaceGuideSeen (boolean only) and GET carries it', run: async () => {
      let r = await post({ workspaceGuideSeen: 'yes' });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /onboarding\.workspaceGuideSeen/);
      r = await post({ workspaceGuideSeen: true });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).workspaceGuideSeen, true);
      assert.equal((await (await get()).json()).workspaceGuideSeen, true, 'persisted');
      await post({ workspaceGuideSeen: false });
    } },
    { name: 'POST refuses non-booleans and unknown keys with 400, writing nothing', run: async () => {
      for (const body of [{ hidden: 'yes' }, { steps: { project: true } }, { welcomeSeen: 1 }]) {
        const r = await post(body);
        assert.equal(r.status, 400, JSON.stringify(body));
        assert.match((await r.json()).error, /onboarding/);
      }
      const s = await (await get()).json();
      assert.deepEqual([s.hidden, s.welcomeSeen], [false, true], 'unchanged');
    } },
  ]);
});

test('DELETE of the LAST workspace clears workspaceGuideSeen; deleting one of two keeps it', async () => {
  const { getDb } = await import('../src/core/db.mjs');
  const now = new Date().toISOString();
  const seed = (id) => getDb().prepare("INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)").run(id, id, now, now);
  const del = (id) => fetch(`${base}/api/workspaces/${id}`, { method: 'DELETE' });
  seed('wks-guide-0000000a');
  seed('wks-guide-0000000b');
  await post({ workspaceGuideSeen: true });
  await checkRows([
    { name: 'one of two deleted: still seen', run: async () => {
      assert.equal((await del('wks-guide-0000000a')).status, 200);
      assert.equal((await (await get()).json()).workspaceGuideSeen, true);
    } },
    { name: 'the last deleted: unseen again', run: async () => {
      assert.equal((await del('wks-guide-0000000b')).status, 200);
      assert.equal((await (await get()).json()).workspaceGuideSeen, false);
    } },
  ]);
});
