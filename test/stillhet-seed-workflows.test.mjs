// test/stillhet-seed-workflows.test.mjs — tools/stillhet-seed-workflows.mjs (Stillhet slice 7 D21): every seeded Workflows
// record exists through dev's own GET routes after seeding, and the live mapper reads each in its state. An in-process server
// (the usage rows are written to its store).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'worca-seed-wf-');
let srv, base, seeded, seed;

before(async () => {
  process.env.WORCA_MOCK = '1';
  seed = await import('../tools/stillhet-seed-workflows.mjs');
  const { app } = await import('../ui/server.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  seeded = await seed.seedWorkflows({ base, db: getDb() });
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); delete process.env.WORCA_MOCK; });

const get = async (p) => { const r = await fetch(`${base}${p}`); assert.equal(r.status, 200, p); return r.json(); };

test('SEEDED_WORKFLOWS lists 7 records, and each exists through dev\'s GET routes', async () => {
  assert.equal(seed.SEEDED_WORKFLOWS.length, 7);
  assert.deepEqual(seed.SEEDED_WORKFLOWS.map((x) => x.key), ['own', 'imported', 'branching', 'loop', 'used', 'agent', 'script']);
  for (const x of seed.SEEDED_WORKFLOWS) await get(x.read);
  assert.deepEqual(seeded.workflows, ['wf_security-first-review', 'wf_release-checklist', 'wf_branching-review', 'wf_plan-with-a-loop']);
});

test('each seeded record reads in its state through the live mapper', async () => {
  const { workflowOf, agentOf, scriptOf } = await import('../ui/public/stillhet/live/workflow-map.mjs');
  const agents = Object.fromEntries((await get('/api/agents')).agents.map((a) => [a.key, a]));
  const usage = (await get('/api/workflow-usage')).usage;
  const wf = (id) => get(`/api/workflows/${id}`).then((t) => workflowOf(t, { usage, agentsByKey: agents }));
  const own = await wf('wf_security-first-review');
  assert.equal(own.own, true); assert.equal(own.chain, true);
  assert.deepEqual([own.tasks, own.merged], [2, 50]);
  assert.equal((await wf('wf_release-checklist')).title, 'Release checklist');
  assert.equal((await wf('wf_branching-review')).chain, false);
  assert.deepEqual((await wf('wf_plan-with-a-loop')).loops.map((l) => l[2]), [2]);
  const a = agentOf(agents.securityCheck);
  assert.equal(a.own, true); assert.equal(a.model, 'Opus 5.5'); assert.equal(a.effort, 'high');
  const s = scriptOf((await get('/api/scripts')).scripts.find((x) => x.key === 'diffGate'));
  assert.equal(s.cases, 2); assert.equal(s.own, true);
});
