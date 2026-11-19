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
let homeDir, prevHome, srv, base, runs, store, service, routesMod, settingsMod, getDb;
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
  store = await import('../src/core/workflow-tests/store.mjs');
  service = await import('../src/core/workflow-tests/service.mjs');
  routesMod = await import('../src/core/workflow-tests/routes.mjs');
  settingsMod = await import('../src/core/settings.mjs');
  ({ getDb } = await import('../src/core/db.mjs'));
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
  assert.deepEqual([o.columns, o.examples, o.pastRuns], [[{ use: 'draft', label: 'Your draft' }], [], []]);
  assert.equal('testable' in o || 'reason' in o, false, '3a D62: every workflow can be tested, so the overview no longer says so');
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
  // U-T7 (D7): the draft is still the saved v1, so it has no column of its own.
  assert.deepEqual([o.columns.map((c) => c.label), o.draftSameAs], [['v1 · in use'], 1]);
  const saved = o.examples.find((e) => e.name === 'Saved filters');
  assert.deepEqual([saved.cells['1'], saved.cells.draft, saved.files], [{ passed: null, total: null, stale: false, past: 'not-good' }, null, ['usage.csv']]);
  assert.equal(o.pastRuns.length, 1);

  // Test v1 against the draft on the written example, with the free quick check.
  const plan = (await call('GET', `${WF}/plan?a=1&b=draft&examples=${ex.id}&tries=1`)).body;
  assert.deepEqual([plan.a.want, plan.a.reusable, plan.b.label], [1, 0, 'Your draft (same as v1)']);
  assert.equal(plan.perTryMs, null, 'finding 4: mock mode and no mock try yet: not known yet, not the past normal run\'s time');   // U-T4: the draft is still the saved v1, so "your changes" would be untrue
  assert.deepEqual(plan.connectors, { mode: 'pretend', pretend: [], off: [], scripts: [], quickScripts: [], engines: [], personalOff: true },
    "board 30: no connector, no script step, Claude only; 3b (D78): Pretend on Claude Code, so the person's plugins are off");
  const started = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, quickCheck: true, capUsd: 5 });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const busy = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1 });
  assert.deepEqual([busy.status, busy.body.error], [409, 'A test of this workflow is running. Wait for it, or stop it first.'], 'one test at a time (D37)');
  assert.equal((await call('POST', `${WF}/examples/${ex.id}/try-once`, {})).status, 409, 'Try it once now waits too');
  const p = await finished(started.body.run.id);
  assert.deepEqual([p.run.status, p.run.connectors, p.quick.status, p.done, p.total, p.title], ['done', 'pretend', 'passed', 2, 2, 'Your v2 draft compared with v1']);
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
  // Mock browser check, finding 4: in mock mode the Time row's per-try time comes from the mock tries' own times (U-T8).
  assert.equal(typeof plan2.perTryMs, 'number', 'the finished mock tries give the estimate its time');
  assert.equal(plan2.perTryMs, service.perTryMs('wf_api_t', { mock: true }), 'the mock tries\' time, never a normal run\'s');
  const again = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 1, reuseA: true, capUsd: 5 });
  await finished(again.body.run.id);
  assert.equal(store.triesOfRun(again.body.run.id).filter((t) => t.runId === again.body.run.id).length, 1);

  // U-T14 (F34): an example marked good from a past run of v1 now has v1's tries; the cell says the tries replaced that mark.
  getDb().prepare('UPDATE wf_test_examples SET from_pipeline = ?, from_use = ?, from_verdict = ? WHERE id = ?').run(past.body.pipelineId, store.useRef(1), 'good', ex.id);
  const marked = (await call('GET', WF)).body.examples.find((e) => e.id === ex.id);
  assert.equal(marked.cells['1'].past, null);
  assert.equal(marked.cells['1'].pastGood, true);
  assert.equal(marked.cells.draft.pastGood, false, 'a version the past run was not of has no such flag');
  getDb().prepare('UPDATE wf_test_examples SET from_pipeline = NULL, from_use = NULL, from_verdict = NULL WHERE id = ?').run(ex.id);

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

test('errors: unknown workflow, a bad example, an unknown example; a workflow that needs a project is testable (3a D62)', async () => {
  assert.equal((await call('GET', '/api/workflows/wf_nope/tests')).status, 404);
  const bad = await call('POST', `${WF}/examples`, { name: '', request: 'x' });
  assert.deepEqual([bad.status, bad.body.error], [400, 'the name must be 1 to 120 characters']);
  assert.equal((await call('GET', `${WF}/examples/9999`)).status, 404);
  assert.equal((await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [9999], tries: 1 })).status, 404);
  const mode = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [9999], tries: 1, connectors: 'maybe' });
  assert.deepEqual([mode.status, mode.body.error], [400, 'connectors must be "pretend" or "real"']);
  const o = await service.testsOverview('wf_api_t', { registry: { planner: { needsRepo: true } } });
  assert.deepEqual([o.needsProject, 'testable' in o], [true, false]);
});

test("the server's liveRun carries a paused try's reason: a drain-paused try stops the test as a drain", async () => {
  const deps = (await import('../ui/routes/workflows/workflow-tests.mjs')).workflowTestDeps;   // the route file since #919
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
  const deps = (await import('../ui/routes/workflows/workflow-tests.mjs')).workflowTestDeps;   // the route file since #919
  const root = settingsMod.getProjectsRoot();
  await mkdir(root, { recursive: true });
  await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { shared__db: { command: 'node', args: ['x.js'] } } }));
  try {
    assert.deepEqual(await deps.connectorsPreview(), { copies: [], fileServers: ['shared_db'] }, 'the name as a run loads it');
    const plan = (await call('GET', `${WF}/plan?b=draft&tries=1`)).body;
    assert.deepEqual(plan.connectors.off, [{ name: 'shared_db', reason: 'file-server' }]);
    const codex = await service.testPlan('wf_api_t', { b: 'draft', tries: 1 }, { connectorsPreview: async () => ({ copies: [], fileServers: [] }), runEngine: 'codex' });
    assert.deepEqual(codex.connectors.engines, ['OpenAI Codex']);   // the engine catalog's name (dev renamed Codex)
  } finally { await rm(join(root, '.mcp.json'), { force: true }); }
});

test('the example routes: edit, delete a file, add from runs, stop a test, a try is no past run, bad ids, a deleted workflow', { timeout: 300000 }, async () => {
  // A Windows-unsafe file name is refused at the route too (400, the store's plain-name text).
  const ex = (await call('POST', `${WF}/examples`, { name: 'Edit me', request: 'Plan a CSV import.', tries: 1 })).body.example;
  const nul = await call('POST', `${WF}/examples/${ex.id}/files`, { name: 'nul.txt', dataBase64: Buffer.from('x').toString('base64') });
  assert.deepEqual([nul.status, nul.body.error], [400, 'give the file a plain name, such as notes.md']);
  assert.equal((await call('POST', `${WF}/examples/${ex.id}/files`, { name: 'a.md', dataBase64: Buffer.from('# A').toString('base64') })).status, 200);
  const put = await call('PUT', `${WF}/examples/${ex.id}`, { name: 'Edited', note: 'A note' });
  assert.deepEqual([put.status, put.body.example.name, put.body.example.note, put.body.example.request], [200, 'Edited', 'A note', 'Plan a CSV import.']);
  const delFile = await call('DELETE', `${WF}/examples/${ex.id}/files/a.md`);
  assert.deepEqual([delFile.status, delFile.body.example.files], [200, []]);

  // From runs: ids are de-duplicated, and one run that cannot become an example adds none of them.
  const pastId = (await service.recentRuns('wf_api_t'))[0].pipelineId;
  const tryId = store.triesOfRun(store.listTestRuns('wf_api_t').at(-1).id)[0].pipelineId;
  const pr = (await call('GET', `/api/workflow-tests/past-run/${tryId}`)).body;
  assert.deepEqual([pr.testable, pr.reason, pr.reasonText], [false, 'test-try', 'A test try cannot become an example.']);
  const count = () => store.listExamples('wf_api_t').length;
  const before = count();
  const mixed = await call('POST', `${WF}/examples/from-runs`, { pipelineIds: [pastId, tryId] });
  assert.deepEqual([mixed.status, mixed.body.error, count()], [400, 'A test try cannot become an example.', before], 'nothing is added');
  // A run whose request is too long for an example: checked with the others before anything is added.
  const longId = 'f00dfeed';
  const db = getDb();
  db.prepare('CREATE TEMP TABLE IF NOT EXISTS p_copy AS SELECT * FROM pipelines WHERE 0').run();
  db.prepare('INSERT INTO p_copy SELECT * FROM pipelines WHERE id = ?').run(pastId);
  db.prepare('UPDATE p_copy SET id = ?, prompt = ?').run(longId, 'x'.repeat(100_001));
  db.prepare('INSERT INTO pipelines SELECT * FROM p_copy').run();
  db.prepare('DROP TABLE p_copy').run();
  const long = await call('POST', `${WF}/examples/from-runs`, { pipelineIds: [pastId, longId] });
  assert.deepEqual([long.status, long.body.error, count()], [400, 'the request is longer than 100000 characters', before], 'nothing is added');
  const twice = await call('POST', `${WF}/examples/from-runs`, { pipelineIds: [pastId, pastId] });
  assert.deepEqual([twice.status, twice.body.examples.length, twice.body.skipped, count()], [201, 1, [], before + 1]);
  // U-T14 (F25): the run it came from says which example it already is; the others say nothing.
  const listed = await service.recentRuns('wf_api_t');
  assert.equal(listed.find((r) => r.pipelineId === pastId).alreadyExample, twice.body.examples[0].name);
  assert.ok(listed.filter((r) => r.pipelineId !== pastId).every((r) => r.alreadyExample === null));
  assert.equal((await call('DELETE', `${WF}/examples/${twice.body.examples[0].id}`)).status, 200);
  assert.equal(count(), before);

  // exampleIds must be whole numbers: a 400, not "no example NaN".
  const nan = await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: ['x'], tries: 1 });
  assert.deepEqual([nan.status, nan.body.error], [400, 'example must be a whole number']);

  // Stop a running test: its tries stop, the test says the person stopped it.
  const run = (await call('POST', `${WF}/runs`, { a: 1, b: 'draft', exampleIds: [ex.id], tries: 3, reuseA: false })).body.run;
  assert.equal((await call('GET', `${WF}/runs/${run.id}`)).body.run.status, 'running', 'still running when the stop is sent (else this row proves nothing)');
  assert.deepEqual((await call('GET', WF)).body.running.exampleIds, [ex.id], 'U-T9 (F17): the overview names the examples the running test tries');
  const stopped = await call('POST', `${WF}/runs/${run.id}/stop`);
  assert.deepEqual([stopped.status, stopped.body.run.status, stopped.body.run.stopReason], [200, 'stopped', 'person']);

  // A deleted workflow's examples cannot be edited, and its test cannot be finished; stopping stays allowed.
  assert.equal((await call('DELETE', '/api/workflows/wf_api_t')).status, 200);
  for (const [method, p, body] of [['PUT', `${WF}/examples/${ex.id}`, { name: 'x' }], ['DELETE', `${WF}/examples/${ex.id}`],
    ['POST', `${WF}/examples/${ex.id}/files`, { name: 'b.md', dataBase64: 'eA==' }], ['DELETE', `${WF}/examples/${ex.id}/files/b.md`],
    ['POST', `${WF}/runs/${run.id}/continue`, {}]]) {
    const r = await call(method, p, body);
    assert.deepEqual([r.status, r.body.error], [404, 'unknown workflow "wf_api_t"'], `${method} ${p}: the workflow gate answered`);
  }
  assert.equal((await call('POST', `${WF}/runs/${run.id}/stop`)).status, 200);
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
