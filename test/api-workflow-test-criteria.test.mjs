// test/api-workflow-test-criteria.test.mjs — Part 4 end to end on the mock engine (flag workflowTests): criteria on an example, a
// Try it once now checks them for free, and later tasks' routes. No paid call is possible: WORCA_MOCK=1 makes every judge the mock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, prevHome, srv, base, store, cs, prepare;
const JSONH = { 'Content-Type': 'application/json' };
const WF = '/api/workflows/wf_api_c/tests';
const call = async (method, p, body) => {
  const r = await fetch(`${base}${p}`, { method, headers: JSONH, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};
const graph = {
  version: 2, id: 'wf_api_c', name: 'Brief writer', domain: 'product',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
};
async function finished(runId, ms = 240000) {
  const t0 = Date.now();
  for (;;) {
    const p = await call('GET', `${WF}/runs/${runId}`);
    if (p.body.run.status !== 'running') return p.body;
    if (Date.now() - t0 > ms) throw new Error(`test ${runId} is still running`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftcapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  store = await import('../src/core/workflow-tests/store.mjs');
  cs = await import('../src/core/workflow-tests/criteria-store.mjs');
  ({ prepare } = await import('../src/core/db.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  // Seeded as Part 2's API test does (test/api-workflow-tests.test.mjs:69): through the route, not a module helper.
  assert.equal((await call('POST', '/api/workflows', graph)).status, 201);
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('criteria saved with an example are checked on Try it once now, for free', async () => {
  const made = await call('POST', `${WF}/examples`, { name: 'Bulk export', request: 'Write the brief for a bulk invoice export.',
    criteria: [{ text: 'Names a success metric' }], judge: { model: 'claude-haiku-4-5' } });
  assert.equal(made.status, 201);
  const exId = made.body.example.id;
  const once = await call('POST', `${WF}/examples/${exId}/try-once`);
  assert.equal(once.status, 201);
  await finished(once.body.run.id);
  const [t] = store.triesOfRun(once.body.run.id);
  const js = cs.tryJudgements([t.id]);
  assert.equal(js.length, 1);
  assert.equal(js[0].model, 'claude-haiku-4-5');
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger').get().n, 0, 'the mock books nothing');
});

test('Agree and Disagree on a verdict, and its trust', async () => {
  const ex = store.listExamples('wf_api_c')[0];
  const [j] = cs.tryJudgements(store.triesOfRun(store.listTestRuns('wf_api_c')[0].id).map((t) => t.id));
  const r = await call('POST', `${WF}/judgements/${j.id}/answer`, { agree: false });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.answer, r.body.trust.state, r.body.trust.n], [false, 'confirm', 1]);
  assert.equal((await call('POST', `${WF}/judgements/${j.id}/answer`, { agree: 'yes' })).status, 400);
  assert.equal((await call('POST', `/api/workflows/wf_other/tests/judgements/${j.id}/answer`, { agree: true })).status, 404);
  assert.ok(ex);
});

test('Undo (agree: null) through the route removes the answer of the person', async () => {
  const [j] = cs.tryJudgements(store.triesOfRun(store.listTestRuns('wf_api_c')[0].id).map((t) => t.id));
  const done = await call('POST', `${WF}/judgements/${j.id}/answer`, { agree: true });
  assert.equal(done.body.answer, true);
  const undone = await call('POST', `${WF}/judgements/${j.id}/answer`, { agree: null });
  assert.equal(undone.status, 200);
  assert.equal(undone.body.answer, null);
  assert.equal(undone.body.trust.n, 0);
  assert.equal(cs.answerOf(j.id, null), null);
});

test('I9: the side by side carries the viewer\'s earlier answer', async () => {
  const run = store.listTestRuns('wf_api_c')[0];
  const [t] = store.triesOfRun(run.id);
  const [j] = cs.tryJudgements([t.id]);
  assert.equal((await call('POST', `${WF}/judgements/${j.id}/answer`, { agree: true })).status, 200);
  const r = await call('GET', `${WF}/runs/${run.id}/examples/${t.exampleId}`);
  assert.equal(r.status, 200);
  const crit = r.body.tries.flatMap((x) => [x.a, x.b]).filter(Boolean).flatMap((v) => (v.verdict && v.verdict.criteria) || []);
  assert.equal(crit.find((c) => c.judgementId === j.id).answer, true);
});

test('handle forwards the `errors` of an error list like Part 2 (unit test of the exported handle)', async () => {
  const { handle } = await import('../src/core/workflow-tests/criteria-routes.mjs');
  let code; let body;
  const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
  await handle(async () => { throw Object.assign(new Error('bad'), { code: 'BAD_REQUEST', errors: ['a', 'b'] }); })({}, res);
  assert.deepEqual([code, body], [400, { error: 'bad', errors: ['a', 'b'] }]);
  await handle(async () => { throw new Error('plain'); })({}, res);
  assert.deepEqual([code, body], [500, { error: 'plain' }]);
});

test('GET judge-models lists Claude models with a suggestion', async () => {
  const r = await call('GET', `${WF}/judge-models`);
  assert.equal(r.status, 200);
  assert.ok(r.body.models.some((m) => m.id === 'claude-opus-5-5'));
  assert.equal(typeof r.body.suggested.id, 'string');
});
