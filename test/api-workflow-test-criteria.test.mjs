// test/api-workflow-test-criteria.test.mjs — Part 4 end to end on the mock engine (flag workflowTests): criteria on an example, a
// Try it once now checks them for free, and later tasks' routes. No paid call is possible: WORCA_MOCK=1 makes every judge the mock.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
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

/** Waits for the background check of a test to end (the page's poll). */
async function checkDone(runId, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    const r = await call('GET', `${WF}/runs/${runId}/criteria`);
    if (r.body.checking === false) return r.body;
    if (Date.now() - t0 > ms) throw new Error('the check is still running');
    await new Promise((x) => setTimeout(x, 50));
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
  // Task 24 (P4-M2): the overview offers the finished try, to keep its result as the result you liked.
  const row = (await call('GET', WF)).body.examples.find((e) => e.id === exId);
  assert.deepEqual(row.likedTries.map((x) => [x.id, x.tryNo, x.status]), [[t.id, t.tryNo, t.status]]);
  assert.equal(typeof row.likedTries[0].use, 'string');
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
  assert.equal(r.body.pair, null, 'D100: a test of one version has no pair');
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

test('Task 18: GET an example\'s criteria gives the trust of each criterion; another workflow\'s example is 404', async () => {
  const ex = store.listExamples('wf_api_c')[0];
  const r = await call('GET', `${WF}/examples/${ex.id}/criteria`);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.trust), ex.criteria.map((c) => c.id));
  assert.equal(typeof r.body.trust[ex.criteria[0].id].state, 'string');
  assert.equal((await call('GET', `/api/workflows/wf_other/tests/examples/${ex.id}/criteria`)).status, 404);
  assert.equal((await call('GET', `${WF}/examples/999999/criteria`)).status, 404);
});

test('by criterion, the overview trust counts and the plan estimate', async () => {
  const run = store.listTestRuns('wf_api_c')[0];
  const r = await call('GET', `${WF}/runs/${run.id}/criteria`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.rows));
  assert.equal(r.body.counts.total, 1);
  assert.equal((await call('GET', WF)).body.trust.total, 1);
  const plan = await call('GET', `${WF}/plan?b=draft&tries=1`);
  assert.equal(typeof plan.body.b.checkUsd.fresh, 'number', 'M13: Haiku 4.5 has a list price, so the check has one');
  assert.equal(plan.body.criteria.pairsUsd, 0, 'no version to compare with: no pairs');
  assert.equal((await call('POST', `${WF}/runs/${run.id}/criteria/check`)).status, 202);
  await checkDone(run.id);   // the background check ends before the test does
});

test('review: a criterion added after the test is new, one the limit left unchecked is unchecked; the check has a price; reused tries are priced', async () => {
  const { estimateOf } = await import('../src/shared/workflow-tests/compare.mjs');
  const ex = store.listExamples('wf_api_c')[0];
  const run = store.listTestRuns('wf_api_c')[0];
  const [t] = store.triesOfRun(run.id);
  assert.equal((await call('GET', `${WF}/runs/${run.id}/criteria`)).body.checkUsd, 0, 'nothing needs checking: $0 is true');
  store.updateExample('wf_api_c', ex.id, { criteria: [...ex.criteria, { text: 'Names the users' }, { text: 'Explains the legal reasons' }] });
  const limited = cs.criterionFp('Explains the legal reasons');
  cs.insertJudgement({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: null, fp: limited, model: 'claude-haiku-4-5', purpose: 'try', tryId: t.id, j: { error: 'limit' } });
  const r = await call('GET', `${WF}/runs/${run.id}/criteria`);
  const rowOf = (label) => r.body.rows.find((x) => x.label === label);
  assert.deepEqual([rowOf('Names the users').uneven, rowOf('Names the users').reason], [true, 'new']);
  assert.deepEqual([rowOf('Explains the legal reasons').uneven, rowOf('Explains the legal reasons').reason], [true, 'unchecked']);
  assert.equal(r.body.checkUsd, 0, 'two checks are missing, but the checks of a mock test are free (its price is in the runner test)');
  const compare = await call('GET', `${WF}/runs/${run.id}/compare`);
  assert.deepEqual(compare.body.notes.notChecked.map((n) => [n.reason, n.criteria]).sort(),
    [['new', ['Names the users']], ['unchecked', ['Explains the legal reasons']]]);
  assert.equal(compare.body.costUnknown, false, 'P4-Q17: every check of this test has a known cost');
  assert.equal((await call('GET', `${WF}/runs/${run.id}`)).body.criteriaPhase, null, 'P4-M5: the progress read; no criteria phase now');
  // Test again with every try reused: the plan counts the reused try that still misses criteria, and the estimate prices it.
  const plan = (await call('GET', `${WF}/plan?b=draft&examples=${ex.id}&tries=1`)).body;
  assert.equal(plan.b.reusable, 1);
  const e = estimateOf(plan, { reuseB: true });
  assert.equal(e.total, 0);
  assert.deepEqual([plan.criteria, plan.b.checkUsd.withReuse], [{ pairsUsd: 0 }, 0], 'a mock test checks for free (round 2); a real one is priced in the runner test');
  assert.equal((await call('POST', `${WF}/runs/${run.id}/criteria/check`)).status, 202);
  assert.equal((await checkDone(run.id)).checkUsd, 0, 'checked now');
});

test('review: another workflow\'s test is 404, a test at its cost limit is 400', async () => {
  const run = store.listTestRuns('wf_api_c')[0];
  assert.equal((await call('GET', `/api/workflows/wf_other/tests/runs/${run.id}/criteria`)).status, 404);
  assert.equal((await call('POST', `/api/workflows/wf_other/tests/runs/${run.id}/criteria/check`)).status, 404);
  store.updateTestRun(run.id, { capUsd: 0.5 });
  const { recordTestJudgeCost } = await import('../src/core/cost-budget.mjs');
  recordTestJudgeCost({ workflowId: 'wf_api_c', testRunId: run.id, purpose: 'try', model: 'cap-fixture', amountUsd: 0.6 });
  try {
    const r = await call('POST', `${WF}/runs/${run.id}/criteria/check`);
    assert.equal(r.status, 400);
    assert.match(r.body.error, /reached its cost limit/);
  } finally {
    store.updateTestRun(run.id, { capUsd: null });
    prepare(`DELETE FROM wf_test_judge_ledger WHERE model = 'cap-fixture'`).run();
  }
});

test('review: 409 while a check runs, 422 at the spending limit, 400 without a runner', async () => {
  const { createTestRunner, CHECKING_TEXT } = await import('../src/core/workflow-tests/runner.mjs');
  const { registerCriteriaRoutes } = await import('../src/core/workflow-tests/criteria-routes.mjs');
  const run = store.listTestRuns('wf_api_c')[0];
  let release; const gate = new Promise((x) => { release = x; });
  let asked = 0;
  const runner = createTestRunner({ judgeMissing: async () => { asked += 1; await gate; }, notify() {} });
  let blocked = false;
  const mk = async (opts) => {
    const app = express();
    registerCriteriaRoutes(app, opts);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}${WF}/runs/${run.id}/criteria`;
    return { close: () => new Promise((r) => server.close(r)),
      post: async () => { const x = await fetch(`${url}/check`, { method: 'POST' }); return { status: x.status, body: await x.json() }; },
      get: async () => (await fetch(url)).json() };
  };
  const m = await mk({ runner, deps: { budgetStatus: () => ({ blocked }) } });
  try {
    blocked = true;
    const refused = await m.post();
    assert.deepEqual([refused.status, asked], [422, 0], 'refused up front: nothing was asked');
    assert.match(refused.body.error, /Total cost limit reached/);
    blocked = false;
    assert.equal((await m.post()).status, 202);
    assert.equal((await m.get()).checking, true);
    assert.equal((await m.get()).stoppable, true, 'board 59 C: a criteria-only check has "Stop checking"');
    assert.equal(runner.criteriaCheckingOf('wf_api_c'), true);
    const busy = await m.post();
    assert.deepEqual([busy.status, busy.body.error], [409, CHECKING_TEXT]);
    release();
    for (let i = 0; i < 200 && (await m.get()).checking; i += 1) await new Promise((x) => setTimeout(x, 20));
    assert.equal((await m.get()).checking, false);
    assert.equal((await m.get()).stoppable, false);
  } finally { await m.close(); }
  const none = await mk({ runner: null });
  try {
    const r = await none.post();
    assert.equal(r.status, 400);
    assert.equal(typeof r.body.error, 'string');
  } finally { await none.close(); }
});

test('final review I2: DELETE of an example is 409 while a check of a test that covers it runs, and works after', async () => {
  const { registerWorkflowTestRoutes } = await import('../src/core/workflow-tests/routes.mjs');
  let release; const gate = new Promise((x) => { release = x; });
  const app = express();
  app.use(express.json());
  const { runner } = registerWorkflowTestRoutes(app, { deps: { criteriaJudge: { judgeMissing: () => gate, judgeTry: async () => [], leaveUnchecked() {} } } });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const del = async (id) => { const x = await fetch(`http://127.0.0.1:${server.address().port}${WF}/examples/${id}`, { method: 'DELETE' }); return { status: x.status, body: await x.json() }; };
  const ex = store.createExample('wf_api_c', { name: 'Covered', request: 'R' });
  const other = store.createExample('wf_api_c', { name: 'Not covered', request: 'R' });
  try {
    const done = runner.checkCriteriaLater({ id: 987654, workflowId: 'wf_api_c', exampleIds: [ex.id] });
    const busy = await del(ex.id);
    assert.deepEqual([busy.status, busy.body.error], [409, "Worca is checking this example's criteria: delete it when that is done"]);
    assert.equal((await del(other.id)).status, 200, 'an example the check does not cover can go');
    release();
    await done;
    assert.equal((await del(ex.id)).status, 200);
    assert.equal(store.readExample('wf_api_c', ex.id), null);
  } finally { release(); await new Promise((r) => server.close(r)); }
});

test('fix round 2 (N5): a criteria check sends the changed frame when it starts (and when it ends); none while the flag is off', async () => {
  const { registerWorkflowTestRoutes } = await import('../src/core/workflow-tests/routes.mjs');
  const frames = [];
  let release = () => {};
  const { runner } = registerWorkflowTestRoutes(express(), { broadcast: (f) => frames.push(f),
    deps: { criteriaJudge: { judgeMissing: () => new Promise((x) => { release = x; }), judgeTry: async () => [], leaveUnchecked() {} } } });
  const run = { id: 987655, workflowId: 'wf_api_c', exampleIds: [] };
  const done = runner.checkCriteriaLater(run);
  assert.deepEqual(frames, [{ type: 'workflow-tests-changed', workflowId: 'wf_api_c', testRunId: run.id }], 'at the start: other tabs disable Test');
  await new Promise((x) => setImmediate(x)); release(); await done;
  assert.equal(frames.length, 2, 'and at the end');
  const flags = process.env.WORCA_FLAGS;
  delete process.env.WORCA_FLAGS;
  try {
    const quiet = runner.checkCriteriaLater(run);
    await new Promise((x) => setImmediate(x)); release(); await quiet;
    assert.equal(frames.length, 2, 'silent while the flag is off');
  } finally { process.env.WORCA_FLAGS = flags; }
});

test('review: the overview says whether a check is running, and its latest test counts the criteria not checked', async () => {
  const o = await call('GET', WF);
  assert.equal(o.body.checking, false);
  const run = store.listTestRuns('wf_api_c')[0];
  prepare(`UPDATE wf_test_runs SET kind = 'compare' WHERE id = ?`).run(run.id);   // the once-test stands in for a compare in the list
  try {
    const ex = store.listExamples('wf_api_c')[0];
    store.updateExample('wf_api_c', ex.id, { criteria: [...ex.criteria, { text: 'Gives a deadline' }] });
    const latest = (await call('GET', WF)).body.latest;
    assert.equal(latest.runId, run.id);
    assert.ok(latest.notChecked >= 1, 'the new criterion was not checked on the test');
  } finally { prepare(`UPDATE wf_test_runs SET kind = 'once' WHERE id = ?`).run(run.id); }
});

test('round 3: testPlan prices a real (not mock) side per example from the kept tries (the wiring)', async () => {
  const { testPlan } = await import('../src/core/workflow-tests/service.mjs');
  const { recordTestJudgeCost } = await import('../src/core/cost-budget.mjs');
  const WF = 'wf_api_c';
  for (let i = 0; i < 3; i += 1) recordTestJudgeCost({ workflowId: WF, purpose: 'try', model: 'price-fixture', amountUsd: 0.05, costKind: 'billed' });
  const ex = store.createExample(WF, { name: 'Priced', request: 'Write it.', tries: 1, basics: { noError: true, noHelp: false }, judge: { model: 'price-fixture' }, criteria: [{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }] });
  const run = store.createTestRun({ workflowId: WF, kind: 'once', b: 'draft', bFp: 'fp-x', exampleIds: [ex.id], tries: 1 });
  const t = store.insertTry({ runId: run.id, workflowId: WF, exampleId: ex.id, use: 'draft', fp: 'fp-x', exampleFp: ex.fingerprint, tryNo: 1 });
  store.linkTry(run.id, t.id, 'b');
  store.updateTry(t.id, { status: 'passed', pipelineId: 'p0000001', verdict: { passed: true, facts: { status: 'done' }, basics: [], checks: [] } });
  const plan = await testPlan(WF, { b: 'draft', exampleIds: [ex.id], tries: 1 }, { fingerprintOf: async () => 'fp-x', mock: false, connectorsPreview: async () => ({ copies: [], fileServers: [] }) });
  assert.deepEqual([plan.b.want, plan.b.reusable], [1, 1]);
  assert.equal(Math.round(plan.b.checkUsd.withReuse * 1e6) / 1e6, 0.1, 'the kept try misses 2 checks at $0.05');
  assert.equal(Math.round(plan.b.checkUsd.fresh * 1e6) / 1e6, 0.1, '1 new try x 2 criteria x $0.05');
  const mockPlan = await testPlan(WF, { b: 'draft', exampleIds: [ex.id], tries: 1 }, { fingerprintOf: async () => 'fp-x', mock: true, connectorsPreview: async () => ({ copies: [], fileServers: [] }) });
  assert.deepEqual(mockPlan.b.checkUsd, { fresh: 0, withReuse: 0 });
  prepare(`DELETE FROM wf_test_judge_ledger WHERE model = 'price-fixture'`).run();
});

test('PUT and DELETE the result you liked', async () => {
  const ex = store.listExamples('wf_api_c')[0];
  const put = await call('PUT', `${WF}/examples/${ex.id}/liked`, { name: 'good.md', dataBase64: Buffer.from('Good brief.').toString('base64') });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body.example.liked, { kind: 'text', name: 'good.md', size: 11 });
  assert.equal((await call('PUT', `${WF}/examples/${ex.id}/liked`, {})).status, 400);
  assert.equal((await call('DELETE', `${WF}/examples/${ex.id}/liked`)).body.example.liked, null);
});

test('the result you liked comes only from this workflow\'s own runs and tries; from-run with liked is all or nothing', { timeout: 300000 }, async () => {
  const { runs } = await import('../ui/server.mjs');
  const settle = async (runId) => { const t0 = Date.now(); for (;;) { const e = runs.get(runId); if (e && e.settled) return; if (Date.now() - t0 > 120000) throw new Error('never settled'); await new Promise((r) => setTimeout(r, 50)); } };
  const other = { ...graph, id: 'wf_api_c2', name: 'Other writer' };
  assert.equal((await call('POST', '/api/workflows', other)).status, 201);
  const mine = await call('POST', '/api/run', { noProject: true, workflowId: 'wf_api_c', prompt: 'Brief for exports', mock: true });
  const theirs = await call('POST', '/api/run', { noProject: true, workflowId: 'wf_api_c2', prompt: 'Brief for imports', mock: true });
  await settle(mine.body.runId); await settle(theirs.body.runId);
  const ex = (await call('POST', `${WF}/examples`, { name: 'Liked', request: 'R' })).body.example;
  const exB = (await call('POST', `${WF}/examples`, { name: 'Liked B', request: 'R' })).body.example;
  const put = (b, e = ex) => call('PUT', `${WF}/examples/${e.id}/liked`, b);
  // IDOR: another workflow's run is refused, and keeps nothing.
  const bad = await put({ pipelineId: theirs.body.pipelineId });
  assert.deepEqual([bad.status, bad.body.error], [400, 'this run is of another workflow']);
  assert.equal(cs.readLiked(ex.id), null);
  assert.equal((await put({ pipelineId: 'nosuchrun' })).status, 400);
  // The pipelineId path, for its own workflow's run.
  const ok = await put({ pipelineId: mine.body.pipelineId });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(cs.readLiked(ex.id).fromPipeline, mine.body.pipelineId);
  // The tryId path: a try of this example works; a try of another example or another workflow does not.
  const runId = store.listTestRuns('wf_api_c')[0].id;
  const mkTry = (workflowId, exampleId, tryNo, pipelineId) => store.updateTry(store.insertTry({ runId, workflowId, exampleId, use: 'draft', fp: 'f', exampleFp: 'e', tryNo }).id, { pipelineId });
  const tB = mkTry('wf_api_c', exB.id, 91, mine.body.pipelineId);
  assert.equal((await put({ tryId: tB.id }, ex)).status, 400, 'a try of another example');
  assert.equal((await put({ tryId: tB.id }, exB)).status, 200);
  assert.equal(cs.readLiked(exB.id).fromPipeline, mine.body.pipelineId);
  const tX = mkTry('wf_api_c2', exB.id, 92, theirs.body.pipelineId);
  assert.equal((await put({ tryId: tX.id }, exB)).status, 400, 'a try of another workflow');
  assert.equal(cs.readLiked(exB.id).fromPipeline, mine.body.pipelineId, 'kept the earlier one');
  assert.equal((await call('PUT', `/api/workflows/wf_api_c2/tests/examples/${exB.id}/liked`, { tryId: tB.id })).status, 404, 'the other workflow does not see this example');
  // Task 24 (board 3): the past run says it left a result; criteria picked from the suggestions go to the new example, with the
  // suggested checking model (D87); a wrong one is refused before any example exists.
  assert.equal((await call('GET', `/api/workflow-tests/past-run/${mine.body.pipelineId}`)).body.hasResult, true);
  const n0 = store.listExamples('wf_api_c').length;
  const badCrit = await call('POST', `${WF}/examples/from-run`, { pipelineId: mine.body.pipelineId, name: 'Bad', criteria: [{ text: 'x' }] });
  assert.deepEqual([badCrit.status, badCrit.body.error], [400, 'each criterion must be 3 to 300 characters']);
  assert.equal(store.listExamples('wf_api_c').length, n0, 'nothing was created');
  const withCrit = await call('POST', `${WF}/examples/from-run`, { pipelineId: mine.body.pipelineId, name: 'With criteria', criteria: [{ text: 'Says how many people use filters today' }] });
  assert.equal(withCrit.status, 201, JSON.stringify(withCrit.body));
  assert.deepEqual(withCrit.body.example.criteria.map((c) => c.text), ['Says how many people use filters today']);
  assert.ok(withCrit.body.example.judge && withCrit.body.example.judge.model, 'the suggested model');
  assert.deepEqual(store.readExample('wf_api_c', withCrit.body.example.id).criteria.map((c) => c.text), ['Says how many people use filters today']);
  // Final review M10: the criteria and their checking model are part of the one create, so a failure there (reading the model
  // catalog) leaves no example behind, and a retry does not make a second one.
  const service = await import('../src/core/workflow-tests/service.mjs');
  const n1 = store.listExamples('wf_api_c').length;
  await assert.rejects(service.exampleFromRun('wf_api_c', { pipelineId: mine.body.pipelineId, name: 'Lost', criteria: [{ text: 'Says how many people use filters today' }] },
    { catalog: () => { throw new Error('catalog down'); } }), /catalog down/);
  assert.equal(store.listExamples('wf_api_c').length, n1, 'nothing was created');
  // from-run with liked: success keeps the result; a run with no result is refused before an example exists.
  const before = store.listExamples('wf_api_c').length;
  const fr = await call('POST', `${WF}/examples/from-run`, { pipelineId: mine.body.pipelineId, name: 'From run', liked: true });
  assert.equal(fr.status, 201, JSON.stringify(fr.body));
  assert.ok(fr.body.example.liked);
  assert.equal(cs.readLiked(fr.body.example.id).fromPipeline, fr.body.example.from.pipelineId);
  assert.equal(store.listExamples('wf_api_c').length, before + 1);
  // Fake pipeline rows (copies of a real run), always removed again.
  const fake = (id, set = '') => {
    prepare('CREATE TEMP TABLE IF NOT EXISTS p_copy AS SELECT * FROM pipelines WHERE 0').run();
    prepare('INSERT INTO p_copy SELECT * FROM pipelines WHERE id = ?').run(mine.body.pipelineId);
    prepare('UPDATE p_copy SET id = ?' + set).run(id);
    prepare('INSERT INTO pipelines SELECT * FROM p_copy').run();
    prepare('DROP TABLE p_copy').run();
  };
  const ids = ['f00dc0de', 'f00dc0df', 'f00dc0e0', 'f00dc0e1'];
  try {
    fake(ids[0]);
    const none = await call('POST', `${WF}/examples/from-run`, { pipelineId: ids[0], liked: true });
    assert.deepEqual([none.status, none.body.error], [400, 'this run left no result to keep']);
    assert.equal(store.listExamples('wf_api_c').length, before + 1, 'nothing was created');
    const wrong = await call('POST', `${WF}/examples/from-run`, { pipelineId: theirs.body.pipelineId, liked: true });
    assert.equal(wrong.status, 400);
    assert.equal(store.listExamples('wf_api_c').length, before + 1);
    // The workflow is checked before the result is read: another workflow's run with no result says so.
    prepare("UPDATE pipelines SET stepper = (SELECT stepper FROM pipelines WHERE id = ?) WHERE id = ?").run(theirs.body.pipelineId, ids[0]);
    const leak = await call('POST', `${WF}/examples/from-run`, { pipelineId: ids[0], liked: true });
    assert.deepEqual([leak.status, leak.body.error], [400, 'this run is of another workflow']);
    // A hidden try's pipeline, an unfinished run and an archived run are not kept through { pipelineId }.
    fake(ids[1], ', is_test = 1');
    const hidden = await put({ pipelineId: ids[1] });
    assert.deepEqual([hidden.status, hidden.body.error], [400, 'A test try cannot become a result you liked; pick it as a try instead.']);
    fake(ids[2], ", status = 'running'");
    const running = await put({ pipelineId: ids[2] });
    assert.deepEqual([running.status, running.body.error], [400, 'Wait until the run has finished.']);
    fake(ids[3], ", archived_at = '2026-01-01T00:00:00Z'");
    assert.equal((await put({ pipelineId: ids[3] })).status, 404);
    assert.equal(cs.readLiked(ex.id).fromPipeline, mine.body.pipelineId, 'none of them replaced the kept result');
    // The directory-name form of the id: this workflow's own run is accepted, another's is refused.
    const dirForm = (id) => `2026-01-01-run-${id}`;
    assert.equal((await put({ pipelineId: dirForm(theirs.body.pipelineId) })).status, 400);
    assert.equal((await put({ pipelineId: dirForm(mine.body.pipelineId) }, exB)).status, 200);
    assert.equal(cs.readLiked(exB.id).fromPipeline, mine.body.pipelineId);
  } finally {
    for (const id of ids) prepare('DELETE FROM pipelines WHERE id = ?').run(id);
  }
});

test('Check the checker on the mock: start, read until ready, answer all four', async () => {
  const ex = store.listExamples('wf_api_c')[0];
  const s = await call('POST', `${WF}/examples/${ex.id}/checker`, { criterionId: ex.criteria[0].id });
  assert.equal(s.status, 201);
  let v;
  for (let i = 0; i < 100; i += 1) { v = await call('GET', `${WF}/examples/${ex.id}/checker/${s.body.round.id}`); if (v.body.round.status !== 'making') break; await new Promise((r) => setTimeout(r, 50)); }
  assert.equal(v.body.round.status, 'ready');
  assert.ok(v.body.cards.length === 4 && v.body.cards.every((c) => c.met !== null), 'every card has a real verdict');
  for (const c of v.body.cards) v = await call('POST', `${WF}/examples/${ex.id}/checker/${s.body.round.id}/answers`, { judgementId: c.judgementId, right: true });
  assert.equal(v.body.canUse, true);
  assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger').get().n, 0);
});

test('the generic answer route refuses a verdict of a round that is not ready; the round route takes it', async () => {
  const ex = store.listExamples('wf_api_c')[0];
  const round = cs.createRound({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: ex.criteria[0].id, fp: 'f', model: 'm', source: {} });
  const j = cs.insertJudgement({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: ex.criteria[0].id, fp: 'f', model: 'm', purpose: 'real',
    roundId: round.id, card: 0, j: { met: true, reason: 'r', proof: 'p', proofFound: true, costUsd: 0, ms: 1 } });
  const refused = await call('POST', `${WF}/judgements/${j.id}/answer`, { agree: true });
  assert.equal(refused.status, 409);
  assert.equal(cs.answerOf(j.id, null), null);
  cs.updateRound(round.id, { status: 'ready' });
  assert.equal((await call('POST', `${WF}/judgements/${j.id}/answer`, { agree: true })).status, 200);
});

test('the generic answer route sends a round card through the round: no undo, no repeats, no empty verdicts, and the round is done', async () => {
  const ex = store.listExamples('wf_api_c')[0];
  const round = cs.createRound({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: ex.criteria[0].id, fp: 'f', model: 'm', source: {} });
  cs.updateRound(round.id, { status: 'ready' });
  const mk = (purpose, met) => cs.insertJudgement({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: ex.criteria[0].id, fp: 'f', model: 'm', purpose,
    roundId: round.id, card: 0, j: { met, reason: 'r', proof: 'p', proofFound: met !== null, costUsd: 0, ms: 1 } });
  const again = mk('again', true);
  const empty = mk('real', null);
  assert.notEqual((await call('POST', `${WF}/judgements/${again.id}/answer`, { agree: true })).status, 200);
  assert.equal((await call('POST', `${WF}/judgements/${empty.id}/answer`, { agree: true })).status, 400);
  const card = mk('planted', false);
  assert.equal((await call('POST', `${WF}/judgements/${card.id}/answer`, { agree: null })).status, 400);
  const ok = await call('POST', `${WF}/judgements/${card.id}/answer`, { agree: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.answer, true);
  // a round whose only card is answered is done, the same as through the round route
  const r2 = cs.createRound({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: ex.criteria[0].id, fp: 'f2', model: 'm', source: {} });
  cs.updateRound(r2.id, { status: 'ready' });
  const only = cs.insertJudgement({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: ex.criteria[0].id, fp: 'f2', model: 'm', purpose: 'real', roundId: r2.id, card: 0, j: { met: true, reason: 'r', proof: 'p', proofFound: true, costUsd: 0, ms: 1 } });
  assert.equal((await call('POST', `${WF}/judgements/${only.id}/answer`, { agree: true })).status, 200);
  assert.equal(cs.readRound(r2.id).status, 'done');
});

test('GET trust: the report of the workflow', async () => {
  const r = await call('GET', `${WF}/trust`);
  assert.equal(r.status, 200);
  assert.equal(r.body.tests.length, 6);
  assert.equal(r.body.tiles.trusted.of, store.listExamples('wf_api_c').reduce((s, e) => s + e.criteria.length, 0));   // the brief's 1 assumed a smaller file
});

test('GET trust fix round 1: only the newest ready round of the current words and model counts; proof and pairs only count live work', async () => {
  const ex = store.listExamples('wf_api_c')[0];
  const crit = ex.criteria[0];
  const model = ex.judge.model;
  const fp = cs.criterionFp(crit.text);
  const mkRound = (f, m, status, how) => {
    const r = cs.createRound({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: crit.id, fp: f, model: m, source: { criterionText: crit.text } });
    cs.updateRound(r.id, { status });
    const mk = (purpose, card, met) => cs.insertJudgement({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: crit.id, fp: f, model: m, purpose, roundId: r.id, card,
      variant: purpose === 'real' ? null : { how: 'x' }, j: { met, reason: 'r', proof: 'p', proofFound: true, costUsd: 0, ms: 1 } });
    for (const [i, met] of how.entries()) mk(i === 0 ? 'real' : 'planted', i, met);
    return r;
  };
  mkRound(fp, model, 'ready', [true, true, false, false]);      // live: 3 planted, 1 missed
  mkRound(fp, model, 'failed', [true, true, true, true]);       // newer but failed: never counts
  mkRound('stale-fp', model, 'ready', [true, true, true, true]); // old words: never counts
  mkRound(fp, 'old-model', 'ready', [true, true, true, true]);   // old model: never counts
  const r = await call('GET', `${WF}/trust`);
  assert.equal(r.status, 200);
  assert.equal(r.body.tiles.planted.of, 3);
  assert.equal(r.body.tiles.planted.caught, 2);
  assert.deepEqual(r.body.tiles.planted.missedOn, [crit.text]);
  assert.equal(r.body.tests.find((t) => t.key === 'planted').state, 'bad');
  // proof counts only the live (words, model) pairs
  const liveKeys = new Set([`${fp}|${model}`]);
  const before = cs.tryProofCounts('wf_api_c', liveKeys);
  const allBefore = cs.tryProofCounts('wf_api_c').of;
  cs.insertJudgement({ workflowId: 'wf_api_c', exampleId: ex.id, criterionId: crit.id, fp: 'gone', model, purpose: 'try', tryId: store.triesOfRun(store.listTestRuns('wf_api_c')[0].id)[0].id,
    j: { met: true, reason: 'r', proof: 'p', proofFound: false, costUsd: 0, ms: 1 } });
  assert.deepEqual(cs.tryProofCounts('wf_api_c', liveKeys), before);
  assert.equal(cs.tryProofCounts('wf_api_c').of, allBefore + 1);
  // pairs: of a removed example or an old model do not count
  const tid = store.triesOfRun(store.listTestRuns('wf_api_c')[0].id)[0].id;
  const pair = (exId, m) => cs.insertJudgement({ workflowId: 'wf_api_c', exampleId: exId, fp: 'pair', model: m, purpose: 'pair', tryId: tid, otherTryId: tid + 1000,
    j: { winner: 'a', reason: 'r', swapped: 'a', costUsd: 0, ms: 1 } });
  pair(ex.id, model); pair(ex.id, 'old-model'); pair(99999, model);
  const live = new Set([`${ex.id}|${model}`]);
  assert.equal(cs.pairJudgements('wf_api_c', live).length, cs.pairJudgements('wf_api_c').length - 2);
});

test("fix round 1: criteria a test never checked (Worca's spending limit, or the test's own cap) read 'unchecked', and Compare never says they changed after it", { timeout: 300000 }, async () => {
  const { registerWorkflowTestRoutes } = await import('../src/core/workflow-tests/routes.mjs');
  const { createCriteriaJudge } = await import('../src/core/workflow-tests/criteria-runner.mjs');
  const { judgeCriterion } = await import('../src/core/workflow-tests/judge.mjs');
  const deps = (await import('../ui/routes/workflows/workflow-tests.mjs')).workflowTestDeps;
  const { JSDOM } = await import('jsdom');
  const { renderCompare } = await import('../ui/public/workflows/test-compare.mjs');
  const LIM = '/api/workflows/wf_api_lim/tests';
  assert.equal((await call('POST', '/api/workflows', { ...graph, id: 'wf_api_lim', name: 'Limit brief' })).status, 201);
  let asked = 0;
  let mode = 'limit';
  // 'limit': the real judge with Worca's spending limit reached (it refuses before any call); 'cap': the first check costs $1 and
  // reaches the test's own $0.50 cap, so the second is never asked.
  const criteriaJudge = createCriteriaJudge({
    judgeCriterion: async (args, d) => {
      if (mode === 'limit') {
        return judgeCriterion({ ...args, mock: false }, { ...d, mock: () => false, budget: () => ({ blocked: true }),
          helperCall: async () => { asked += 1; throw new Error('no paid call when refused'); } });
      }
      args.book(1, 'billed');
      return { met: true, reason: 'r', proof: null, proofFound: false, error: null, costUsd: 1, ms: 1 };
    },
  });
  const fakeApp = Object.fromEntries(['get', 'post', 'put', 'delete'].map((m) => [m, () => {}]));
  const { runner } = registerWorkflowTestRoutes(fakeApp, { deps: { ...deps, criteriaJudge } });
  const made = await call('POST', `${LIM}/examples`, { name: 'Bulk export', request: 'Write the brief for a bulk invoice export.', tries: 1,
    criteria: [{ text: 'Names a success metric' }, { text: 'Explains the legal reasons' }], judge: { model: 'claude-haiku-4-5' } });
  assert.equal(made.status, 201);
  const exId = made.body.example.id;
  for (const [m, capUsd, unchecked, booked] of [['limit', null, ['Explains the legal reasons', 'Names a success metric'], 0], ['cap', 0.5, ['Explains the legal reasons'], 1]]) {
    mode = m;
    const run = await runner.start({ workflowId: 'wf_api_lim', kind: 'once', b: 'draft', exampleIds: [exId], tries: 1, capUsd });
    await runner.idle(run.id);
    assert.notEqual(store.readTestRun(run.id).status, 'running');
    const crit = await call('GET', `${LIM}/runs/${run.id}/criteria`);
    assert.equal(crit.status, 200);
    assert.deepEqual(crit.body.rows.filter((r) => r.uneven).map((r) => [r.label, r.reason]).sort(), unchecked.map((l) => [l, 'unchecked']), `${m}: unchecked, never new`);
    const compare = await call('GET', `${LIM}/runs/${run.id}/compare`);
    assert.deepEqual(compare.body.notes.notChecked.map((n) => [n.reason, [...n.criteria].sort()]), [['unchecked', unchecked]], m);
    assert.equal(prepare('SELECT COUNT(*) AS n FROM wf_test_judge_ledger WHERE test_run_id = ?').get(run.id).n, booked, `${m}: only a call made is booked`);
    // The page as the app paints it (tests-app.mjs wftCompareRead: the compare read with its criteria beside it).
    const { window } = new JSDOM('<!doctype html><div id="r"></div>');
    const root = window.document.getElementById('r');
    renderCompare(root, { ...compare.body, criteria: crit.body }, { back() {}, testAgain() {}, open() {}, tryMore() {}, checkCriteria() {} }, { doc: window.document });
    assert.doesNotMatch(root.textContent, /changed after this test/, m);
    assert.match(root.textContent, /Not checked on every try, so it does not decide yet/, m);
    root.querySelector('#wft-by-cr').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.doesNotMatch(root.querySelector('.wft-by-crit').textContent, /Added after this test/, m);
  }
  assert.equal(asked, 0, 'no paid call when refused');
});

test("Task 23: the trust report's \"Criteria you can trust\" tile and board 1's card count the same (an exact check made from a criterion is reliable)", async () => {
  const ex = store.listExamples('wf_api_c')[0];
  const put = await call('PUT', `${WF}/examples/${ex.id}`, { checks: [...(ex.checks || []), { kind: 'mentions', text: '200', said: 'Mentions that the export stops at 200' }] });
  assert.equal(put.status, 200);
  const [o, r] = [await call('GET', WF), await call('GET', `${WF}/trust`)];
  assert.ok(o.body.trust.total > 0);
  assert.deepEqual(r.body.tiles.trusted, { n: o.body.trust.reliable, of: o.body.trust.total, unreliable: o.body.trust.unreliable, waiting: o.body.trust.waiting });
});
