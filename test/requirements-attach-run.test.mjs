// test/requirements-attach-run.test.mjs — POST /api/run (startRunHandler) accepts `requirements:[{seq}]` (FEAT-21 P3-T2).
// The real handler in mock mode over a temp home; the created orchestrator's options are read off the live run entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { stopAndSettle } from './helpers/stop-and-settle.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { createFeature, updateFeature, createStart, listStarts, appendTurn } from '../src/core/requirements/store.mjs';
import { getDb } from '../src/core/db.mjs';
import { pendingAgreement } from '../src/core/requirements/attached-gate.mjs';

useTempHome(after, 'worca-req-attach-run-');
const prevFlags = process.env.WORCA_FLAGS;
const prevMock = process.env.WORCA_MOCK;
process.env.WORCA_FLAGS = 'requirements';
process.env.WORCA_MOCK = '1';

let server; let runs; let projDir; let projKey; let otherKey; let n = 0;
const started = [];

before(async () => {
  const mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  server = mod._testing;
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = gitDir('attach-run');
  const other = gitDir('attach-run-other');
  const list = await addProject({ name: 'shop', path: projDir });
  projKey = list.find((p) => p.name === 'shop').key;
  otherKey = (await addProject({ name: 'other', path: other })).find((p) => p.name === 'other').key;
});
after(async () => {
  for (const id of started) await stopAndSettle(runs, (e) => e.id === id);
  if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags;
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  rmSync(projDir, { recursive: true, force: true });
});

const specWith = (...texts) => ({ ...emptySpec(), goal: { text: 'G', measure: '' }, criteria: texts.map((t, i) => ({ id: `R-po-${i + 1}`, text: t })) });
const readySpec = (...texts) => ({ ...emptySpec(), goal: { text: 'G', measure: 'M' }, criteria: texts.map((t, i) => ({ id: `R-po-${i + 1}`, text: t })) });
/** `readyNow` makes the feature Ready now: a done interview round and a spec that passes every check. */
const feat = (title, { scopeKey = projKey, ready = true, spec = specWith('alpha', 'beta'), begun = true, readyNow = false } = {}) => {
  const f = createFeature({ scopeType: 'project', scopeKey, title, description: `d ${title}` });
  if (begun) createStart({ featureSeq: f.seq, version: 1, runId: `old-run-${f.seq}-${n++}`, spec, title, ready });
  if (readyNow) {
    appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
    updateFeature(f.seq, { status: 'done', spec: readySpec('current one', 'current two', 'current three') });
  }
  return f;
};
const send = async (body) => {
  let out = null;
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { out = { status: this.statusCode, body: b }; return this; } };
  const runId = `attach-run-${n++}`;
  await server.startRunHandler({ body: { projectDir: projDir, workflowId: 'wf_default', mock: true, ...body }, headers: {}, _startedBy: 'test', _runId: runId }, res);
  if (out.status === 200) started.push(runId);
  return { ...out, runId };
};
const optsOf = (runId) => runs.get(runId).orch.opts;
const startRows = () => getDb().prepare('SELECT COUNT(*) AS n FROM req_starts').get().n;

test('no requirements field, or an empty list, behaves as before (prompt required, nothing attached)', async () => {
  let r = await send({});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /prompt or promptMarkdown is required/);
  r = await send({ prompt: 'plain', requirements: [] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(optsOf(r.runId).prompt, 'plain');
  assert.equal('attachedRequirements' in optsOf(r.runId), false);
});

test('flag off: 403 REQUIREMENTS_DISABLED', async () => {
  const f = feat('Off');
  process.env.WORCA_FLAGS = '';
  try {
    const r = await send({ prompt: 'x', requirements: [{ seq: f.seq }] });
    assert.equal(r.status, 403);
    assert.deepEqual([r.body.code, r.body.error], ['REQUIREMENTS_DISABLED', 'Requirements disabled']);
  } finally { process.env.WORCA_FLAGS = 'requirements'; }
});

test('no project and a plugin task source are refused with their codes', async () => {
  const f = feat('Scope');
  let r = await send({ projectDir: undefined, noProject: true, prompt: 'x', requirements: [{ seq: f.seq }] });
  assert.deepEqual([r.status, r.body.code], [400, 'REQUIREMENTS_SCOPE']);
  r = await send({ prompt: undefined, source: { type: 'plugin', plugin: 'p', sourceId: 's', taskId: 't' }, requirements: [{ seq: f.seq }] });
  assert.deepEqual([r.status, r.body.code], [400, 'REQUIREMENTS_SOURCE']);
});

test('a malformed requirements field is a 400', async () => {
  let r = await send({ prompt: 'x', requirements: 'FEAT-1' });
  assert.equal(r.status, 400);
  r = await send({ prompt: 'x', requirements: [{ seq: 'nope' }] });
  assert.equal(r.status, 400);
});

test('an attached feature that is archived, not Ready, or in another project is a 409 naming it; nothing starts', async () => {
  const arch = feat('Gone later'); updateFeature(arch.seq, { status: 'archived' });
  const draft = feat('Draft only', { begun: false });
  const away = feat('Elsewhere', { scopeKey: otherKey });
  const before = runs.size;
  const r = await send({ prompt: 'x', requirements: [{ seq: arch.seq }, { seq: draft.seq }, { seq: away.seq }] });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'REQUIREMENTS_UNAVAILABLE');
  assert.deepEqual(r.body.features.map((x) => [x.seq, x.id, x.title, x.reason]), [
    [arch.seq, `FEAT-${arch.seq}`, 'Gone later', 'archived'],
    [draft.seq, `FEAT-${draft.seq}`, 'Draft only', 'not Ready'],
    [away.seq, `FEAT-${away.seq}`, 'Elsewhere', 'not in this target'],
  ]);
  assert.match(r.body.error, /^Remove FEAT-\d+ "Gone later" \(archived\)/);
  assert.equal(runs.size, before);
});

test('a Ready never-started feature attaches with its current spec; agreed, so the run does not pause; no start row', async () => {
  const f = feat('Ready fresh', { begun: false, readyNow: true });
  const rows = startRows();
  const r = await send({ prompt: 'x', requirements: [{ seq: f.seq }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = optsOf(r.runId);
  assert.match(o.prompt, new RegExp(`# FEAT-${f.seq} \\(current spec\\): Ready fresh`));
  assert.match(o.prompt, /current three/);
  assert.deepEqual(o.attachedRequirements, [
    { seq: f.seq, id: `FEAT-${f.seq}`, title: 'Ready fresh', version: null, ready: true, criteriaCount: 3, agreed: true },
  ]);
  assert.deepEqual(pendingAgreement(o.attachedRequirements), []);
  assert.equal(startRows(), rows, 'no req_starts row is written');
  assert.equal(listStarts(f.seq).length, 0);
});

test('a feature with a live run needs confirmAttachedRunning; with it the run starts', async () => {
  const f = feat('Busy');
  const live = listStarts(f.seq)[0];
  runs.set(live.runId, { id: live.runId, kind: 'run', status: 'running', events: [], pipelineId: null, orch: {} });
  try {
    let r = await send({ prompt: 'x', requirements: [{ seq: f.seq }] });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'RUN_IN_PROGRESS');
    assert.equal(r.body.runId, live.runId);
    assert.equal(r.body.features[0].seq, f.seq);
    assert.match(r.body.error, new RegExp(`^FEAT-${f.seq} "Busy" already has a run in progress`), 'the client can show and confirm it');
    r = await send({ prompt: 'x', requirements: [{ seq: f.seq }], confirmAttachedRunning: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  } finally { runs.delete(live.runId); }
});

test('with no prompt and no task text the composed requirements are the prompt; attached list is threaded; req_starts untouched', async () => {
  const ready = feat('Ready one', { ready: true });
  const notReady = feat('Not ready', { ready: false });
  const rows = startRows();
  const r = await send({ requirements: [{ seq: ready.seq, markdown: 'EVIL', title: 'EVIL' }, { seq: notReady.seq }], attachedRequirements: [{ seq: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = optsOf(r.runId);
  assert.match(o.prompt, /## Attached requirements/);
  assert.match(o.prompt, new RegExp(`# FEAT-${ready.seq} v1: Ready one`));
  assert.match(o.prompt, /\*\*R-po-1\*\* alpha/);
  assert.ok(!o.prompt.includes('EVIL'));
  assert.deepEqual(o.attachedRequirements, [
    { seq: ready.seq, id: `FEAT-${ready.seq}`, title: 'Ready one', version: 1, ready: true, criteriaCount: 2, agreed: true },
    { seq: notReady.seq, id: `FEAT-${notReady.seq}`, title: 'Not ready', version: 1, ready: false, criteriaCount: 2, agreed: false },
  ]);
  assert.equal(startRows(), rows, 'no req_starts row is written');
  assert.equal(listStarts(ready.seq).length, 1);
  assert.equal('extrasFiles' in o, false);
});

test('the user text comes first, then the requirements; promptMarkdown wins over prompt', async () => {
  const f = feat('With text');
  let r = await send({ prompt: 'Do the thing', requirements: [{ seq: f.seq }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(optsOf(r.runId).prompt.startsWith('Do the thing\n\n## Attached requirements'));
  r = await send({ promptMarkdown: '# From markdown', requirements: [{ seq: f.seq }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(optsOf(r.runId).prompt.startsWith('# From markdown\n\n## Attached requirements'));
});

test('the run prompt uses the newest STARTED spec, not a newer draft', async () => {
  const f = feat('Drafted', { spec: specWith('started text') });
  updateFeature(f.seq, { spec: { ...emptySpec(), criteria: [{ id: 'R-po-1', text: 'DRAFT ONLY' }] } });
  const r = await send({ requirements: [{ seq: f.seq }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(optsOf(r.runId).prompt, /started text/);
  assert.ok(!optsOf(r.runId).prompt.includes('DRAFT ONLY'));
});

test('a shaped start passes the composed prompt and the attached features to the run', async () => {
  const f = feat('Shaped');
  const r = await send({ requirements: [{ seq: f.seq }], workflowId: 'wf_shape', shape: { slices: 'off' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = optsOf(r.runId);
  assert.ok(o.shape, 'shape reached the run');
  assert.match(o.prompt, new RegExp(`# FEAT-${f.seq} v1: Shaped`));
  assert.equal(o.attachedRequirements[0].seq, f.seq);
});

test('attach, then a NEWER start, then run: the run carries the newer started version (invariant 2)', async () => {
  const f = feat('Moving', { spec: specWith('first text') });
  createStart({ featureSeq: f.seq, version: 2, runId: `old-run-${f.seq}-v2`, spec: specWith('second text'), title: 'Moving', ready: true });
  const r = await send({ requirements: [{ seq: f.seq }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const o = optsOf(r.runId);
  assert.match(o.prompt, new RegExp(`# FEAT-${f.seq} v2: Moving`));
  assert.match(o.prompt, /second text/);
  assert.ok(!o.prompt.includes('first text'));
  assert.equal(o.attachedRequirements[0].version, 2);
});

test('a renamed feature keeps the title its start froze in the version heading', async () => {
  const f = feat('Before rename');
  updateFeature(f.seq, { title: 'After rename' });
  const r = await send({ requirements: [{ seq: f.seq }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(optsOf(r.runId).prompt, new RegExp(`# FEAT-${f.seq} v1: Before rename`));
});

test('a workspace run threads the attached features to its orchestrator too', async () => {
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  const a = gitDir('attach-ws-a');
  const b = gitDir('attach-ws-b');
  const ws = await createWorkspace({ name: 'Attach WS', projectPaths: [a, b] });
  const wsFeat = createFeature({ scopeType: 'workspace', scopeKey: ws.id, title: 'WS feature', description: 'd' });
  createStart({ featureSeq: wsFeat.seq, version: 1, runId: `old-run-${wsFeat.seq}-ws`, spec: specWith('ws criterion'), title: 'WS feature', ready: true });
  const out = await (async () => {
    let got = null;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(x) { got = { status: this.statusCode, body: x }; return this; } };
    const runId = `attach-ws-run-${n++}`;
    await server.startRunHandler({ body: { workspaceId: ws.id, workflowId: 'wf_default', mock: true, requirements: [{ seq: wsFeat.seq }] }, headers: {}, _startedBy: 'test', _runId: runId }, res);
    if (got.status === 200) started.push(runId);
    return { ...got, runId };
  })();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(runs.get(out.runId).kind, 'workspace-run');
  assert.deepEqual(runs.get(out.runId).orch.opts.attachedRequirements.map((x) => x.seq), [wsFeat.seq]);
});
