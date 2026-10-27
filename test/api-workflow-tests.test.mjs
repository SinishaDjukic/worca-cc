// test/api-workflow-tests.test.mjs — the Tests routes end to end on the mock engine (flag workflowTests): examples and a
// file, a past run as an example (D29), a test of v1 against the draft with the quick check, reuse (D26), the compare
// and side-by-side reads, Try it once now, and that no try reaches the Runs list (D21). Also the server's runner deps:
// a paused try's reason reaches the runner, the dialog's connector notes (D35), and a try cannot be paused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, prevHome, srv, base, runs, store, service, routesMod, _testing, settingsMod;
const JSONH = { 'Content-Type': 'application/json' };
const WF = '/api/workflows/wf_api_t/tests';
const call = async (method, p, body) => {
  const r = await fetch(`${base}${p}`, { method, headers: JSONH, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
};
const graph = (name) => ({
  version: 2, id: 'wf_api_t', name, domain: 'product',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
async function finished(runId, ms = 240000) {
  const t0 = Date.now();
  for (;;) {
    const p = await call('GET', `${WF}/runs/${runId}`);
    if (p.body.run.status !== 'running') return p.body;
    if (Date.now() - t0 > ms) throw new Error(`test ${runId} is still running`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
async function settled(runId, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const e = runs.get(runId); if (e && e.settled) return e; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`run ${runId} never settled`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  _testing = mod._testing;
  store = await import('../src/core/workflow-tests/store.mjs');
  service = await import('../src/core/workflow-tests/service.mjs');
  routesMod = await import('../src/core/workflow-tests/routes.mjs');
  settingsMod = await import('../src/core/settings.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('examples, a past run as an example, a test of v1 against the draft, reuse, compare, side by side', { timeout: 600000 }, async () => {
  assert.equal((await call('POST', '/api/workflows', graph('Brief writer'))).status, 201);
  let o = (await call('GET', WF)).body;
  assert.deepEqual([o.testable, o.columns, o.examples, o.pastRuns], [true, [{ use: 'draft', label: 'Your draft' }], [], []]);
  assert.equal((await call('POST', '/api/workflows/wf_api_t/versions', { note: 'First' })).status, 201);

  // A past run of v1 (a normal run: it stays in the Runs list), turned into an example with the person's verdict.
  const usage = Buffer.from('filter,uses\nstatus,120\n').toString('base64');
  const past = await call('POST', '/api/run', { noProject: true, workflowId: 'wf_api_t', prompt: 'Plan saved filters for reports', mock: true,
    extras: [{ name: 'usage.csv', dataBase64: usage }] });
  assert.equal(past.status, 200, JSON.stringify(past.body));
  await settled(past.body.runId);
  const pr = (await call('GET', `/api/workflow-tests/past-run/${past.body.pipelineId}`)).body;
  assert.deepEqual([pr.workflowId, pr.testable, pr.use, pr.useLabel, pr.files, pr.request], ['wf_api_t', true, 1, 'v1', ['usage.csv'], 'Plan saved filters for reports']);
  const fr = await call('POST', `${WF}/examples/from-run`, { pipelineId: past.body.pipelineId, name: 'Saved filters', verdict: 'not-good', note: 'It ignored the usage data.' });
  assert.equal(fr.status, 201, JSON.stringify(fr.body));
  assert.deepEqual([fr.body.example.files.map((f) => f.name), fr.body.example.from.verdict, fr.body.example.from.use, fr.body.skipped], [['usage.csv'], 'not-good', 1, []]);

  // A written example with a file.
  const ex = (await call('POST', `${WF}/examples`, { name: 'Bulk invoice export', request: 'Plan a bulk invoice export.', checks: [{ kind: 'words', min: 1 }], tries: 1 })).body.example;
  const up = await call('POST', `${WF}/examples/${ex.id}/files`, { name: 'notes.md', dataBase64: Buffer.from('# Notes').toString('base64') });
  assert.deepEqual(up.body.example.files.map((f) => [f.name, f.size]), [['notes.md', 7]]);
  o = (await call('GET', WF)).body;
  assert.deepEqual(o.columns.map((c) => c.label), ['v1 · the team uses it', 'v2 draft · yours']);
  const saved = o.examples.find((e) => e.name === 'Saved filters');
  assert.deepEqual([saved.cells['1'], saved.cells.draft, saved.files], [{ passed: null, total: null, stale: false, past: 'not-good' }, null, ['usage.csv']]);
  assert.equal(o.pastRuns.length, 1);

  // Test v1 against the draft on the written example, with the free quick check.
  const plan = (await call('GET', `${WF}/plan?a=1&b=draft&examples=${ex.id}&tries=1`)).body;
  assert.deepEqual([plan.a.want, plan.a.reusable, plan.b.label], [1, 0, 'v2 draft · your changes']);
  assert.deepEqual(plan.connectors, { mode: 'pretend', pretend: [], off: [], scripts: [], engines: [] }, 'board 30: no connector, no script step, Claude only');
  const started = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true, capUsd: 5 });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const busy = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  assert.deepEqual([busy.status, busy.body.error], [409, 'A test of this workflow is running. Wait for it, or stop it first.'], 'one test at a time (D37)');
  assert.equal((await call('POST', `${WF}/examples/${ex.id}/try-once`, {})).status, 409, 'Try it once now waits too');
  const p = await finished(started.body.run.id);
  assert.deepEqual([p.run.status, p.run.connectors, p.quick.status, p.done, p.total, p.title], ['done', 'pretend', 'passed', 2, 2, 'Testing your v2 draft']);
  assert.ok(p.rows.every((r) => r.summary === 'Done · 1 of 1 passed' || r.summary === 'Done · 0 of 1 passed'));
  const c = (await call('GET', `${WF}/runs/${started.body.run.id}/compare`)).body;
  assert.equal(c.title, 'Your v2 draft compared with v1');
  assert.deepEqual([c.model.tiles.a.passed.total, c.model.tiles.b.passed.total, c.changes, c.fair], [1, 1, [], []]);
  const s = (await call('GET', `${WF}/runs/${started.body.run.id}/examples/${ex.id}`)).body;
  assert.equal(s.tries.length, 1);
  assert.equal(s.tries[0].a.verdict.basics[0].key, 'noError');
  assert.deepEqual([s.connectors, s.tries[0].b.connectors, s.tries[0].b.wouldHaveSent, s.tries[0].b.answeredReads], ['pretend', 'pretend', [], []], 'board 31: a mock try calls no tool');
  const whole = await call('GET', `${WF}/runs/${started.body.run.id}/tries/${s.tries[0].b.tryId}/result`);
  assert.equal(whole.status, 200);
  assert.equal((await call('POST', `${WF}/runs/${started.body.run.id}/continue`)).status, 400, 'only a stopped test can be finished');

  // D21: no try is in the Runs list; the past run is.
  const tryIds = store.triesOfRun(started.body.run.id).map((t) => t.pipelineId);
  const listed = (await call('GET', '/api/history')).body.pipelines.map((x) => x.id);
  assert.ok(listed.includes(past.body.pipelineId));
  assert.ok(tryIds.every((id) => id && !listed.includes(id)));

  // D26: v1's try is reused; only the draft is tried again.
  const plan2 = (await call('GET', `${WF}/plan?a=1&b=draft&examples=${ex.id}&tries=1`)).body;
  assert.equal(plan2.a.reusable, 1);
  const again = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: true, capUsd: 5 });
  await finished(again.body.run.id);
  assert.equal(store.triesOfRun(again.body.run.id).filter((t) => t.runId === again.body.run.id).length, 1);

  // Try it once now: one try of the draft; the side by side has one column.
  const once = await call('POST', `${WF}/examples/${ex.id}/try-once`, {});
  assert.equal(once.status, 201);
  assert.equal(once.body.run.connectors, 'pretend', 'Try it once now always pretends (D35)');
  await finished(once.body.run.id);
  const s1 = (await call('GET', `${WF}/runs/${once.body.run.id}/examples/${ex.id}`)).body;
  assert.deepEqual([s1.labels.a, s1.tries.length, s1.tries[0].a, s1.compareTitle], [null, 1, null, 'Tried once: Bulk invoice export']);
  o = (await call('GET', WF)).body;
  assert.equal(o.latest.title, 'Latest test: your v2 draft compared with v1');
  assert.equal(o.running, null);
});

test('errors: unknown workflow, a bad example, an unknown example; a workflow that needs a project is not testable', async () => {
  assert.equal((await call('GET', '/api/workflows/wf_nope/tests')).status, 404);
  const bad = await call('POST', `${WF}/examples`, { name: '', request: 'x' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'the name must be 1 to 120 characters']);
  assert.equal((await call('GET', `${WF}/examples/9999`)).status, 404);
  assert.equal((await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [9999], tries: 1 })).status, 404);
  const mode = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [9999], tries: 1, connectors: 'maybe' });
  assert.deepEqual([mode.status, mode.body.error], [400, 'connectors must be "pretend" or "real"']);
  const o = await service.testsOverview('wf_api_t', { registry: { planner: { needsRepo: true } } });
  assert.deepEqual([o.testable, o.reason], [false, 'needs-project']);
});

test("the server's liveRun carries a paused try's reason: a drain-paused try stops the test as a drain", async () => {
  const deps = _testing.workflowTestDeps;
  const key = 'wft-drain-paused';
  runs.set(key, { id: key, status: 'paused', pauseReason: 'drain', pauseDetail: null, pipelineId: null, orch: { state: { totalCostUsd: 0 } }, isTest: true, settled: true });
  try {
    const l = deps.liveRun(key);
    assert.deepEqual([l.status, l.pauseReason, l.pauseDetail], ['paused', 'drain', null]);
    const ex = store.listExamples('wf_api_t').find((e) => e.name === 'Bulk invoice export');
    const fakeApp = Object.fromEntries(['get', 'post', 'put', 'delete'].map((m) => [m, () => {}]));
    const { runner } = routesMod.registerWorkflowTestRoutes(fakeApp, { deps: { ...deps,
      startRun: async () => ({ status: 200, body: { runId: key, pipelineId: null } }), stopRun: async () => {} } });
    const r = await runner.start({ workflowId: 'wf_api_t', kind: 'once', b: 'draft', exampleIds: [ex.id], tries: 1 });
    await runner.idle(r.id);
    assert.deepEqual([store.readTestRun(r.id).status, store.readTestRun(r.id).stopReason], ['stopped', 'drain']);
    assert.deepEqual(store.triesOfRun(r.id).map((t) => t.status), ['stopped'], 'an unfinished try, not a failed one');
  } finally { runs.delete(key); }
});

test('the dialog notes (D35): the file servers a try without a project loads, and steps on another engine', async () => {
  const deps = _testing.workflowTestDeps;
  const root = settingsMod.getProjectsRoot();
  await mkdir(root, { recursive: true });
  await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { shared__db: { command: 'node', args: ['x.js'] } } }));
  try {
    assert.deepEqual(await deps.connectorsPreview(), { copies: [], fileServers: ['shared_db'] }, 'the name as a run loads it');
    const plan = (await call('GET', `${WF}/plan?b=draft&tries=1`)).body;
    assert.deepEqual(plan.connectors.off, [{ name: 'shared_db', reason: 'file-server' }]);
    const codex = await service.testPlan('wf_api_t', { b: 'draft', tries: 1 }, { connectorsPreview: async () => ({ copies: [], fileServers: [] }), runEngine: 'codex' });
    assert.deepEqual(codex.connectors.engines, ['Codex']);
  } finally { await rm(join(root, '.mcp.json'), { force: true }); }
});

test('a test try cannot be paused: POST /api/pause answers 409 and never pauses it', async () => {
  const key = 'wft-live-try';
  let paused = 0;
  runs.set(key, { id: key, status: 'running', isTest: true, pipelineId: null, orch: { pause: () => { paused += 1; return true; } } });
  try {
    const r = await call('POST', '/api/pause', { runId: key });
    assert.deepEqual([r.status, r.body.error, paused], [409, 'A test try cannot be paused: stop its test instead.', 0]);
    assert.equal(runs.get(key).status, 'running');
  } finally { runs.delete(key); }
});
