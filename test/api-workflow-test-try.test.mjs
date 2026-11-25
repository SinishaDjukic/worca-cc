// test/api-workflow-test-try.test.mjs — one test try through the run handler (mock engine): it runs the version it was
// given, is hidden from every list and tab, sends no chat notification, and mounts no memory (D19–D23).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, base, runs, _testing, artifacts;
const frames = [];
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });
const graph = (name) => ({
  version: 2, id: 'wf_try', name, domain: 'product',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
});
async function settled(runId, ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const e = runs.get(runId);
    if (e && e.settled) return e;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`try ${runId} never settled`);
}

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfttry-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  // Settings (the enforced tag test) live under HOME: sandbox it, as test/api-run-tags.test.mjs does.
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing } = mod);
  artifacts = await import('../src/core/artifacts.mjs');
  _testing.sockets.add({ readyState: 1, OPEN: 1, send: (t) => frames.push(JSON.parse(t)) });
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

test('the in-process option is checked: a try runs without a project, on the draft or a version', async () => {
  const bad1 = await _testing.invokeStartRun({ projectDir: homeDir, prompt: 'x' }, null, { workflowTest: { use: 'draft' } });
  assert.deepEqual([bad1.status, bad1.body.error], [400, "a test try runs without a project, or in Worca's copy of one"]);
  const bad2 = await _testing.invokeStartRun({ noProject: true, prompt: 'x' }, null, { workflowTest: { use: 'live' } });
  assert.deepEqual([bad2.status, bad2.body.error], [400, 'a test try names the draft or a version number']);
});

test('a try of v1 runs v1, is hidden everywhere, sends nothing to tabs or chat, and mounts no memory', { timeout: 180000 }, async () => {
  assert.equal((await post('/api/workflows', graph('Try me'))).status, 201);
  assert.equal((await post('/api/workflows/wf_try/versions', { note: 'First' })).status, 201);
  assert.equal((await post('/api/workflows', graph('Try me (draft)'))).status, 201);
  const attach = _testing.chatNotifier.attach;
  const attached = [];
  _testing.chatNotifier.attach = (orch, o) => { attached.push(o && o.runId); return attach.call(_testing.chatNotifier, orch, o); };
  try {
    let seen = null;
    const out = await _testing.invokeStartRun({ noProject: true, workflowId: 'wf_try', prompt: 'Plan a bulk invoice export', title: 'Test: Bulk · try 1' }, null,
      { workflowTest: { use: 1, onOrch: (orch, o) => { seen = { orch, ...o }; } } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const { runId, pipelineId } = out.body;
    assert.equal(seen.runKey, runId, 'onOrch gets the orchestrator before it runs');
    const entry = runs.get(runId);
    assert.equal(entry.isTest, true);
    await settled(runId);
    const row = artifacts.findPipelineRowById(pipelineId);
    assert.equal(row.is_test, 1);
    const stepper = JSON.parse(row.stepper);
    assert.deepEqual(stepper.workflowVersion, { no: 1 });
    assert.equal(stepper.template.name, 'Try me');
    assert.equal(row.title, 'Test: Bulk · try 1', 'the fixed title is kept');
    assert.equal(entry.orch.memory, null, 'D19: nothing mounted');
    assert.equal(existsSync(join(entry.orch.pipeline.dir, 'memory')), false);
    assert.ok(!_testing.summarizeRuns().some((r) => r.runId === runId), 'not in the hello');
    assert.ok(!frames.some((f) => f.runId === runId), 'no frame of the try reached a tab');
    assert.ok(!attached.includes(runId), 'no chat notifier');
    const h = await (await fetch(`${base}/api/history`)).json();
    assert.ok(!h.pipelines.some((p) => p.id === pipelineId));
    const c = await (await fetch(`${base}/api/counts`)).json();
    assert.equal(c.pipelines, 0);
    const own = await (await fetch(`${base}/api/runs?projectDir=${encodeURIComponent(entry.projectDir)}`)).json();
    assert.ok(!(own.live || []).some((r) => r.runId === runId), 'no live try in the run list of its work folder');
  } finally { _testing.chatNotifier.attach = attach; }
});

async function seedPausedTry() {
  const { getDb } = await import('../src/core/db.mjs');
  getDb().prepare(`INSERT OR REPLACE INTO pipelines (id, project_key, status, is_test, resume_point) VALUES ('feed0001', 'no-project-00000000', 'paused', 1, '{"version":2,"pauseReason":"drain"}')`).run();   // version 2: autoResumeCandidates skips any other point
}

test('auto-resume on boot skips a paused test try', async () => {
  await seedPausedTry();
  const out = await _testing.autoResumeOnBoot({ env: { WORCA_AUTO_RESUME: '1' }, mock: true });   // drain.mjs autoResumeMode: truthy = 'all'
  assert.ok(!out.resumed.some((r) => r.pipelineId === 'feed0001'));
  assert.ok(!out.failed.some((r) => r.pipelineId === 'feed0001'));
});

test('a test try is never resumed by hand either (review I7)', async () => {
  await seedPausedTry();
  await assert.rejects(_testing.resumeRun('feed0001', { mock: true }),
    (e) => e.status === 409 && e.body.error === 'A test try cannot be resumed: finish the rest from its test.');
});

test('a paused try settled elsewhere sends no frame to a tab', async () => {
  await seedPausedTry();
  const { getDb } = await import('../src/core/db.mjs');
  const entry = { id: 'try-settle-1', kind: 'run', isTest: true, pipelineId: 'feed0001', status: 'paused', events: [], pendingQuestion: null };
  runs.set('try-settle-1', entry);
  try {
    getDb().prepare(`UPDATE pipelines SET status = 'stopped' WHERE id = 'feed0001'`).run();
    _testing.settleStaleParkedEntries();
    assert.equal(entry.status, 'stopped', 'the entry still settles');
    assert.ok(!frames.some((f) => f.runId === 'try-settle-1'), 'but no frame left for a tab');
  } finally { runs.delete('try-settle-1'); getDb().prepare(`UPDATE pipelines SET status = 'paused' WHERE id = 'feed0001'`).run(); }
});

test('an onOrch that throws leaves no entry behind', async () => {
  await post('/api/workflows', graph('Try me'));
  const before = new Set(runs.keys());
  const out = await _testing.invokeStartRun({ noProject: true, workflowId: 'wf_try', prompt: 'x', title: 'Test: throw' }, null,
    { workflowTest: { use: 'draft', onOrch: () => { throw new Error('boom'); } } });
  assert.equal(out.status, 500, JSON.stringify(out.body));
  assert.deepEqual([...runs.keys()].filter((k) => !before.has(k)), [], 'no dead starting entry');
});

test('a try that pauses on a usage limit books no resume ticket (Review Focus 10)', async () => {
  await seedPausedTry();
  const { EventEmitter } = await import('node:events');
  const orch = new EventEmitter();
  const entry = { id: 'try-limit-1', orch, kind: 'run', isTest: true, pipelineId: 'feed0001', status: 'paused', events: [], pendingQuestion: null };
  _testing.wireRun(entry);
  orch.emit('done', { status: 'paused', reason: 'usage_limit', limitResetAt: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(entry._limitResumeP, undefined, 'maybeScheduleLimitResume never ran');
  assert.ok(!frames.some((f) => f.runId === 'try-limit-1'), 'and no frame left for a tab');
});

test('enforced run tags neither refuse nor tag a try (review I2)', async () => {
  const CCD = { key: 'cc', label: 'Cost centre', values: ['4410', '4420'], required: true };
  await post('/api/settings', { tagDimensions: [CCD], enforceTags: true });   // runTags has graduated: tags are always on
  try {
    const plain = await post('/api/run', { noProject: true, workflowId: 'wf_try', prompt: 'x', mock: true });
    assert.equal(plain.status, 422, 'a normal run without the tag is refused');
    const out = await _testing.invokeStartRun({ noProject: true, workflowId: 'wf_try', prompt: 'Plan it', title: 'Test: Bulk · try 2' }, null,
      { workflowTest: { use: 'draft' } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    await settled(out.body.runId);
    assert.deepEqual(runs.get(out.body.runId).tags, [], 'no enforced tag lands on a hidden try');
  } finally { await post('/api/settings', { tagDimensions: [], enforceTags: false }); }
});

test('a try names its connectors: pretend (the default) or real', async () => {
  const bad = await _testing.invokeStartRun({ noProject: true, prompt: 'x' }, null, { workflowTest: { use: 'draft', connectors: 'maybe' } });
  assert.deepEqual([bad.status, bad.body.error], [400, 'a test try names its connectors: pretend or real']);
  const out = await _testing.invokeStartRun({ noProject: true, workflowId: 'wf_try', prompt: 'Plan it', title: 'Test: Bulk · try 3' }, null,
    { workflowTest: { use: 'draft' } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = runs.get(out.body.runId);
  assert.equal(entry.orch._testConnectors(), 'pretend');
  await settled(out.body.runId);
});
