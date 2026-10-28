// test/requirements-run-link.test.mjs — starts go through the run handler; run events reach the feature
// (plans/requirements-a2-design.md D6, D9, D10). The hook on its own, then ui/server.mjs in-process in mock
// mode: a Ready feature starts a real mock run, and its first state event links the pipeline id.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

let home; let srv; let base; let prev; let projKey; let projDir; let mod;
let store; let createRunEventHook;

function gitInit(dir) {
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  g(['commit', '-q', '--allow-empty', '-m', 'init']);
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-req-link-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'requirements';
  (await import('../src/core/db.mjs'))._resetForTests();
  projDir = await mkdtemp(join(home, 'shop-'));
  gitInit(projDir);
  const { addProject } = await import('../src/core/projects.mjs');
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  store = await import('../src/core/requirements/store.mjs');
  ({ createRunEventHook } = await import('../src/core/requirements/start.mjs'));
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  for (const r of mod?.runs?.values?.() || []) { try { r.orch?.stop?.(); } catch { /* reap */ } }
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  (await import('../src/core/db.mjs'))._resetForTests();   // release the sqlite handle (Windows cannot unlink an open file)
  // A stopped orchestrator still flushes its live log for a few ticks: reap, wait, reap again.
  const reap = () => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  await reap();
  await new Promise((r) => setTimeout(r, 500));
  await reap();
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const waitFor = async (pred, ms = 5000, what = 'condition') => {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** A feature with one stored start for `runId` (no run behind it): what the hook looks up. */
function featureWithStart(runId) {
  const f = store.createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Hook', description: 'd' }, { by: 't' });
  store.createStart({ featureSeq: f.seq, version: 1, runId, spec: f.spec, title: f.title, ready: true, failing: [] }, { by: 't' });
  return f.seq;
}

test('the hook: unknown runs and other events do nothing', () => {
  const seen = [];
  const hook = createRunEventHook({ notify: (seq) => seen.push(seq) });
  hook('no-such-run', 'state', { id: 'abcd1234', status: 'running' });
  hook('no-such-run', 'done', { status: 'done' });
  const seq = featureWithStart('run-other-events');
  for (const name of ['exec', 'log', 'token', 'title']) hook('run-other-events', name, { id: 'abcd1234', status: 'running' });
  assert.deepEqual(seen, []);
  assert.equal(store.startByRunId('run-other-events').pipelineId, null);
  assert.ok(seq > 0);
});

test('the hook: links once, notifies on a link or a status change, clears on done', () => {
  const seen = [];
  const hook = createRunEventHook({ notify: (seq) => seen.push(seq) });
  const seq = featureWithStart('run-link-1');
  hook('run-link-1', 'state', { status: 'running' });             // no id yet: a status, so one notify
  assert.deepEqual(seen, [seq]);
  assert.equal(store.startByRunId('run-link-1').pipelineId, null);
  hook('run-link-1', 'state', { id: 'abcd1234', status: 'running' });   // the link alone notifies
  assert.equal(store.startByRunId('run-link-1').pipelineId, 'abcd1234');
  assert.deepEqual(seen, [seq, seq]);
  hook('run-link-1', 'state', { id: 'abcd1234', status: 'running' });   // nothing new
  hook('run-link-1', 'state', { id: 'ffff0000', status: 'running' });   // never relinked
  assert.equal(store.startByRunId('run-link-1').pipelineId, 'abcd1234');
  assert.deepEqual(seen, [seq, seq]);
  hook('run-link-1', 'state', { id: 'abcd1234', status: 'paused' });    // a status change
  assert.deepEqual(seen, [seq, seq, seq]);
  hook('run-link-1', 'done', { status: 'stopped' });
  assert.deepEqual(seen, [seq, seq, seq, seq]);
  hook('run-link-1', 'state', { id: 'abcd1234', status: 'stopped' });   // cleared on done: news again
  assert.deepEqual(seen, [seq, seq, seq, seq, seq]);
});

test('the hook: first state with an id links and notifies once; done without a status means done; error', () => {
  const seen = [];
  const hook = createRunEventHook({ notify: (seq) => seen.push(seq) });
  const seq = featureWithStart('run-link-2');
  hook('run-link-2', 'state', { id: '1234abcd', status: 'running' });
  assert.deepEqual(seen, [seq]);
  assert.equal(store.startByRunId('run-link-2').pipelineId, '1234abcd');
  hook('run-link-2', 'state', { id: '1234abcd', status: 'running' });
  assert.deepEqual(seen, [seq]);
  hook('run-link-2', 'done', {});
  assert.deepEqual(seen, [seq, seq]);
  const seq3 = featureWithStart('run-link-3');
  hook('run-link-3', 'error', { message: 'boom' });
  hook('run-link-3', 'error', { message: 'boom' });   // cleared after the first: reported again
  assert.deepEqual(seen, [seq, seq, seq3, seq3]);
});

test('the hook: a throwing notify never throws out', () => {
  const hook = createRunEventHook({ notify: () => { throw new Error('socket gone'); } });
  featureWithStart('run-throw');
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    assert.doesNotThrow(() => hook('run-throw', 'state', { id: 'aaaa1111', status: 'running' }));
    assert.doesNotThrow(() => hook('run-throw', 'done', { status: 'done' }));
  } finally { console.error = orig; }
  assert.ok(logged.length >= 1 && logged.every((l) => l.startsWith('[worca-ui]')), logged.join('\n'));
  assert.equal(store.startByRunId('run-throw').pipelineId, 'aaaa1111');
});

test('server: a Ready feature starts a mock run through the run handler; its pipeline id is linked', async () => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const frames = [];
  ws.on('message', (d) => { try { const m = JSON.parse(String(d)); if (m.type === 'requirements-changed') frames.push(m); } catch { /* other frames */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'Cancel order', description: 'Before it ships' });
    assert.equal(c.status, 201);
    const seq = c.json.feature.seq;
    await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'your_turn', 5000, 'your_turn');
    let v = (await call('GET', `/api/requirements/${seq}`)).json;
    assert.equal((await call('POST', `/api/requirements/${seq}/answers`, { roundTurnId: v.feature.pending.turnId, useRecommended: true })).status, 202);
    await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'done', 5000, 'interview done');
    assert.equal((await call('POST', `/api/requirements/${seq}/assumptions`, { confirmOpen: true })).status, 200);
    v = (await call('GET', `/api/requirements/${seq}`)).json;
    assert.equal(v.feature.readiness.ok, true, JSON.stringify(v.feature.readiness.checks.filter((k) => !k.ok)));

    const before = frames.filter((f) => f.seq === seq).length;
    const s = await call('POST', `/api/requirements/${seq}/start`, {});
    assert.equal(s.status, 201, JSON.stringify(s.json));
    const { runId } = s.json;
    assert.match(runId, /^[0-9a-f-]{36}$/);
    assert.ok(mod.runs.has(runId), 'the run handler registered the reserved run id');
    v = (await call('GET', `/api/requirements/${seq}`)).json;
    assert.equal(v.feature.starts[0].runId, runId);

    // The hook (not the view's fallback) links: read the row directly, without a GET in between.
    const pipelineId = await waitFor(() => store.startByRunId(runId).pipelineId, 10000, 'pipeline id');
    assert.match(pipelineId, /^[0-9a-f]{8}$/);
    // The start route sends exactly one frame; any further one for this seq came from the run-event hook.
    await waitFor(() => frames.filter((f) => f.seq === seq).length >= before + 2, 10000, 'a run-event frame');
    v = (await call('GET', `/api/requirements/${seq}`)).json;
    assert.equal(v.feature.starts[0].pipelineId, pipelineId);
    assert.equal(v.feature.starts[0].run.href, `#running/${runId}`);
    assert.equal(typeof v.feature.starts[0].run.status, 'string');

    // The wf_auto mock run parks on its workflow question: stop it and let the stop land, so the server can
    // close and the temp dir can go (Windows). The stop is a status change, so the feature hears it too.
    const heard = frames.filter((f) => f.seq === seq).length;
    mod.runs.get(runId).orch.stop();
    const settled = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
    await waitFor(() => settled.has(String(mod.runs.get(runId)?.status || '')), 30000, 'the run to settle');
    await waitFor(() => frames.filter((f) => f.seq === seq).length > heard, 10000, 'the stop frame');
  } finally { ws.close(); }
});

test('store: startByPipelineId finds the start a pipeline belongs to', () => {
  const seq = featureWithStart('run-by-pid');
  store.linkPipeline('run-by-pid', 'c0ffee01');
  assert.equal(store.startByPipelineId('c0ffee01').featureSeq, seq);
  assert.equal(store.startByPipelineId('c0ffee01').runId, 'run-by-pid');
  assert.equal(store.startByPipelineId('nope0000'), null);
});

test('the hook: a resumed run (a new UUID, the same pipeline id) is still the feature\'s run', () => {
  const seen = [];
  const hook = createRunEventHook({ notify: (seq) => seen.push(seq) });
  const seq = featureWithStart('run-before-resume');
  hook('run-before-resume', 'state', { id: 'aced0001', status: 'running' });
  hook('run-before-resume', 'done', { status: 'paused' });
  assert.deepEqual(seen, [seq, seq]);
  // resumeRun registers a new UUID; its first state carries the pipeline id
  hook('run-after-resume', 'state', { id: 'aced0001', status: 'running' }, 'aced0001');
  assert.deepEqual(seen, [seq, seq, seq]);
  hook('run-after-resume', 'state', { id: 'aced0001', status: 'running' }, 'aced0001');
  assert.deepEqual(seen, [seq, seq, seq], 'nothing new');
  // done carries no id: the entry's pipeline id (wireRun's 4th argument) finds the start
  hook('run-after-resume', 'done', { status: 'done' }, 'aced0001');
  assert.deepEqual(seen, [seq, seq, seq, seq]);
  hook('run-other-resume', 'error', { message: 'x' }, null);
  assert.deepEqual(seen, [seq, seq, seq, seq], 'an unknown run without a pipeline id stays unknown');
  assert.equal(store.startByRunId('run-before-resume').pipelineId, 'aced0001', 'the row keeps its first run id and pipeline');
});

test('server: runSummary finds a resumed run by its pipeline id; href is the live run, else its History page', () => {
  const { requirementsRunSummary } = mod._testing;
  return (async () => {
    const db = (await import('../src/core/db.mjs')).getDb();
    db.prepare("INSERT INTO pipelines (id, project_key, target, title, status, phase, total_cost_usd) VALUES ('fade0001', ?, 'project', 'R', 'paused', 'test', 1.5)").run(projKey);
    db.prepare("INSERT INTO pipelines (id, project_key, workspace_key, target, title, status, phase) VALUES ('fade0002', ?, 'wsk-1', 'workspace', 'W', 'done', 'learn')").run(projKey);
    // a resumed run: a new runs-Map UUID driving the same pipeline
    const entry = { id: 'resumed-uuid-1', orch: {}, kind: 'run', pipelineId: 'fade0001', status: 'running' };
    mod.runs.set(entry.id, entry);
    try {
      const live = requirementsRunSummary({ runId: 'first-uuid-gone', pipelineId: 'fade0001' });
      assert.equal(live.status, 'running');
      assert.equal(live.pipelineId, 'fade0001');
      assert.equal(live.href, '#running/resumed-uuid-1');
      assert.equal(live.costUsd, 1.5);
    } finally { mod.runs.delete(entry.id); }
    const settled = requirementsRunSummary({ runId: 'first-uuid-gone', pipelineId: 'fade0001' });
    assert.equal(settled.status, 'paused');
    assert.equal(settled.href, `#history/${projKey}/fade0001`);
    const ws = requirementsRunSummary({ runId: 'ws-uuid-gone', pipelineId: 'fade0002' });
    assert.equal(ws.href, '#history/workspaces/wsk-1/fade0002');
    assert.equal(requirementsRunSummary({ runId: 'nobody', pipelineId: null }), null);
  })();
});

test('the hook through the real notifier: flag off, a run event of a started feature sends no frame; on, it does', async () => {
  const { requirementsChangeNotifier } = await import('../src/core/requirements/routes.mjs');
  const frames = [];
  const hook = createRunEventHook({ notify: requirementsChangeNotifier((f) => frames.push(f)) });
  const seq = featureWithStart('run-flag-off');
  delete process.env.WORCA_FLAGS;
  try {
    hook('run-flag-off', 'state', { id: 'f1a90ff0', status: 'running' });
    hook('run-flag-off', 'done', { status: 'done' });
  } finally { process.env.WORCA_FLAGS = 'requirements'; }
  assert.deepEqual(frames, [], 'no requirements-changed frame while the flag is off');
  assert.equal(store.startByRunId('run-flag-off').pipelineId, 'f1a90ff0', 'the link is still kept');
  hook('run-flag-off', 'state', { id: 'f1a90ff0', status: 'paused' });
  assert.deepEqual(frames, [{ type: 'requirements-changed', seq }]);
});

test('the hook: a question from a started run notifies, and the next state after it does too', () => {
  const seen = [];
  const hook = createRunEventHook({ notify: (seq) => seen.push(seq) });
  const seq = featureWithStart('run-question');
  hook('run-question', 'state', { id: 'a5ced001', status: 'running' });
  assert.deepEqual(seen, [seq]);
  hook('run-question', 'question', { id: 'q1', kind: 'workflow' });
  assert.deepEqual(seen, [seq, seq], 'waiting for the person: the pill changes');
  hook('run-question', 'state', { id: 'a5ced001', status: 'running' });
  assert.deepEqual(seen, [seq, seq, seq], 'answered: the same status, but no longer waiting');
  hook('run-question', 'state', { id: 'a5ced001', status: 'running' });
  assert.deepEqual(seen, [seq, seq, seq]);
  hook('no-such-run', 'question', { id: 'q2' });
  assert.deepEqual(seen, [seq, seq, seq]);
});

test('server: runSummary says waiting while the live run has a pending question', () => {
  const { requirementsRunSummary } = mod._testing;
  const entry = { id: 'waiting-uuid-1', orch: {}, kind: 'run', pipelineId: null, status: 'running', pendingQuestion: { id: 'q1' } };
  mod.runs.set(entry.id, entry);
  try {
    assert.equal(requirementsRunSummary({ runId: entry.id, pipelineId: null }).waiting, true);
    entry.pendingQuestion = null;
    assert.equal(requirementsRunSummary({ runId: entry.id, pipelineId: null }).waiting, false);
  } finally { mod.runs.delete(entry.id); }
});

/** Stops a live mock run and waits until it settled, so the server can close and the temp dir can go (Windows). */
async function stopRun(runId) {
  mod.runs.get(runId)?.orch?.stop?.();
  const done = new Set(['done', 'stopped', 'error', 'paused', 'interrupted']);
  await waitFor(() => !mod.runs.get(runId) || done.has(String(mod.runs.get(runId).status || '')), 30000, 'the run to settle');
}
const PIPE = ['mock.md', 'notes (2).md', 'notes.md', 'spec_ v2_.md'];

test('server: a start copies the switched-on files into the run\'s pipeline under Windows-safe, unique names, and leaves no staged copy', async () => {
  const up = (name, text) => ({ name, dataBase64: Buffer.from(text).toString('base64') });
  const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'With files', description: 'Before it ships',
    attachments: [up('notes.md', 'notes'), up('mock.md', 'mock'), up('spec: v2?.md', 'spec')] });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const seq = c.json.feature.seq;
  await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'your_turn', 8000, 'your_turn');
  let v = (await call('GET', `/api/requirements/${seq}`)).json;
  await call('POST', `/api/requirements/${seq}/answers`, { roundTurnId: v.feature.pending.turnId, useRecommended: true });
  await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'done', 8000, 'done');
  await call('POST', `/api/requirements/${seq}/assumptions`, { confirmOpen: true });
  // A document of the scope's brief with the same display name as a feature file: the run gets "notes (2).md"
  const brief = store.beginBrief('project', projKey);
  store.saveBriefResult(brief.id, { sections: { product: 'P', users: [], terms: [], areas: [] } });
  let runId = null;
  try {
    const d = await call('POST', `/api/requirements/brief/project/${projKey}/documents`, { attachments: [up('notes.md', 'the brief\'s notes')] });
    assert.ok(d.status < 300, JSON.stringify(d.json));
    await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.briefDocuments.every((x) => x.status === 'done'), 8000, 'the document read');
    v = (await call('GET', `/api/requirements/${seq}`)).json;
    assert.equal(v.feature.readiness.ok, true, JSON.stringify(v.feature.readiness.checks.filter((k) => !k.ok)));
    for (const a of v.feature.attachments) assert.equal((await call('PATCH', a.href, { sendWithRun: true })).status, 200);
    for (const a of v.feature.briefDocuments) assert.equal((await call('PATCH', a.href, { sendWithEveryRun: true })).status, 200);

    // A start the run handler refuses (an unknown workflow) answers without a path and stores nothing
    const no = await call('POST', `/api/requirements/${seq}/start`, { workflowId: 'wf_no_such_workflow' });
    assert.ok(no.status >= 400 && no.status < 500, JSON.stringify(no.json));
    assert.doesNotMatch(JSON.stringify(no.json), /orchestrator-extras/);
    assert.equal(store.latestStart(seq), null);

    const s = await call('POST', `/api/requirements/${seq}/start`, {});
    assert.equal(s.status, 201, JSON.stringify(s.json));
    runId = s.json.runId;
    assert.deepEqual(s.json.feature.starts[0].files.map((x) => [x.name, x.from]),
      [['notes.md', 'feature'], ['mock.md', 'feature'], ['spec: v2?.md', 'feature'], ['notes.md', 'brief']], 'the start row keeps the display names');
    // createPipeline copies them into <pipeline>/extras, the copy the run's agents read
    const pdir = await waitFor(() => mod.runs.get(runId)?.orch?.pipeline?.dir, 10000, 'the pipeline dir');
    await waitFor(() => { try { return readdirSync(join(pdir, 'extras')).length === PIPE.length; } catch { return false; } }, 10000, 'the pipeline extras');
    assert.deepEqual(readdirSync(join(pdir, 'extras')).sort(), PIPE);
    assert.equal(readFileSync(join(pdir, 'extras', 'notes.md'), 'utf8'), 'notes');
    assert.equal(readFileSync(join(pdir, 'extras', 'notes (2).md'), 'utf8'), 'the brief\'s notes', 'same-named files never overwrite each other');
    // then the staged folder goes: no orchestrator-extras-<runId> is left behind
    const staged = join(tmpdir(), `orchestrator-extras-${runId}`);
    await waitFor(() => !existsSync(staged), 10000, 'the staged folder to go');
    assert.deepEqual(readdirSync(join(pdir, 'extras')).sort(), PIPE, 'the pipeline keeps its own copy');
  } finally {
    if (runId) {
      await stopRun(runId);
      await rm(join(tmpdir(), `orchestrator-extras-${runId}`), { recursive: true, force: true });
    }
    await call('DELETE', `/api/requirements/brief/project/${projKey}`);
  }
});

test('server: invokeStartRun removes the staged copies of a start the run handler refuses (that run id\'s folder)', async () => {
  const src = join(home, 'staged-src.md');
  writeFileSync(src, 'x');
  const runId = randomUUID();
  const staged = join(tmpdir(), `orchestrator-extras-${runId}`);
  const out = await mod._testing.invokeStartRun({ projectDir: projDir, promptMarkdown: '# x', title: 'x', workflowId: 'wf_no_such_workflow' }, null,
    { runId, extrasFiles: [{ name: 'a.md', path: src }] });
  assert.ok(out.status >= 400 && out.status < 500, JSON.stringify(out.body));
  assert.equal(existsSync(staged), false);
  assert.equal(mod.runs.has(runId), false);
});

test('server: POST /api/run never takes _extrasPaths from its body', async () => {
  const secret = join(home, 'secret.txt');
  writeFileSync(secret, 'not for the run');
  const r = await call('POST', '/api/run', { projectDir: projDir, promptMarkdown: '# Hello\n\nA run.', title: 'Plain run', workflowId: 'wf_auto', _extrasPaths: [secret] });
  assert.ok(r.status >= 200 && r.status < 300, JSON.stringify(r.json));
  const runId = r.json.runId || r.json.id;
  try {
    const pdir = await waitFor(() => mod.runs.get(runId)?.orch?.pipeline?.dir, 10000, 'the pipeline dir');
    assert.equal(existsSync(join(pdir, 'extras')), false);
    assert.equal(existsSync(join(tmpdir(), `orchestrator-extras-${runId}`)), false);
  } finally { await stopRun(runId); }
});
