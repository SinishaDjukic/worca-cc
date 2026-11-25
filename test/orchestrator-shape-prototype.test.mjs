// test/orchestrator-shape-prototype.test.mjs — Shaper small runs C1 end to end on the real orchestrator in mock mode:
// the Prototype step held inside the Requirements approval of a marked run (flags shaperSmallRuns and design), on a
// real Design registry with the mock engine: the ask order, the Split after the confirm, the frozen copy, a remark that
// changes a requirement, resume, --yes, the unmarked run, and the hand-off block in every agent prompt.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { _testing, buildAgentPrompt } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { resolveShapeRequest } from '../src/core/shape/run.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { snapshotVersion } from '../src/core/design/versions.mjs';
import { getDb } from '../src/core/db.mjs';
import { prototypeBlock } from '../src/shared/shape/prototype.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_MOCK_PROTO_REMARK', 'WORCA_MOCK_PROTO_REVIEW'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-shapeproto-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
});
afterEach(() => { _testing.runClaude = null; delete process.env.WORCA_MOCK_PROTO_REMARK; delete process.env.WORCA_MOCK_PROTO_REVIEW; });
after(async () => {
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const registry = () => createDesignBuilds({ broadcast: () => {}, deps: { staggerMs: 0, retryDelayMs: 0, snapshotVersion } });
const isReqAsk = (q) => q.kind === 'plan' && !!(q.plan?.criteria || q.plan?.error);
const auditOf = (orch) => getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(orch.getState().id).map((r) => r.text);

/** A marked small-runs mock run (or unmarked with `smallRuns: false`). `onProto(q, orch)` answers each prototype ask
 *  (default: Worca's pick); every plan ask is approved; `timeline` holds 'ask:<kind>:<moment>' and 'exec:<node>'. */
function start({ position = 'balanced', smallRuns = true, onProto = null, resume = null, designBuilds = registry() } = {}) {
  process.env.WORCA_FLAGS = smallRuns ? 'shaperSmallRuns,design' : 'design';
  const req = resolveShapeRequest({ shape: { size: 'large', lead: 'security' } }, { smallRuns });
  assert.equal(req.ok, true, req.error);
  const dir = gitDir('shapeproto');
  const orch = createOrchestrator({ projectDir: dir, workflowId: req.workflowId, prompt: 'Email templates with a preview page',
    claude: { mock: true }, shape: req.shape, designBuilds, ...(resume ? { resume } : {}) });
  const asks = []; const timeline = [];
  orch.on('exec', (e) => { if (e.status === 'start' && e.kind !== 'task') timeline.push(`exec:${e.nodeId}`); });
  orch.on('question', (q) => {
    asks.push(q);
    timeline.push(`ask:${q.kind}${q.prototype ? `:${q.prototype.moment}` : ''}`);
    if (q.kind === 'care') setImmediate(() => orch.answer(q.id, { care: { position } }));
    else if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
    else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
    else if (q.kind === 'prototype' && !orch.auto) setImmediate(() => (onProto ? onProto(q, orch) : orch.answer(q.id, q.prototype.moment === 'offered' ? { decision: 'build' } : { decision: 'confirm' })));
  });
  const done = resume ? orch.resume() : orch.run();
  return { orch, asks, timeline, done, dir, designBuilds };
}
const protoAsks = (h) => h.asks.filter((q) => q.kind === 'prototype');
const stats = (orch) => JSON.parse(getDb().prepare('SELECT shape_stats FROM pipelines WHERE id = ?').get(orch.getState().id).shape_stats);

test('a marked Balanced run with R-ux-1: offered → built → confirmed, the Split only after the confirm, the frozen copy', async () => {
  const h = start();
  const moved = [];
  h.orch.on('shape-prototype', (e) => moved.push(e.state));
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(protoAsks(h).map((q) => q.prototype.moment), ['offered', 'built']);
  assert.deepEqual(moved, ['offered', 'building', 'built', 'confirmed'], 'each new moment is announced once, for the one card');
  const offer = protoAsks(h)[0].prototype;
  assert.deepEqual(offer.offer, { primary: 'build', menu: 'skip', review: false });
  assert.ok(offer.requirements.some((r) => r.id === 'R-ux-1'));
  const built = protoAsks(h)[1].prototype;
  assert.ok(built.screens.length >= 1 && built.screens.every((sc) => Array.isArray(sc.pieces) && sc.pieces.every((x) => typeof x.text === 'string')), 'pieces as plain words');
  const confirmAt = h.timeline.lastIndexOf('ask:prototype:built');
  const planAt = h.timeline.indexOf('exec:n_plan');
  assert.ok(planAt > confirmAt, `n_plan starts after the confirm: ${h.timeline.join(' ')}`);
  const p = stats(h.orch).prototype;
  assert.equal(p.state, 'confirmed');
  assert.equal(p.ref.dir, join(h.orch.pipeline.dir, 'prototype-confirmed'));
  const manifest = JSON.parse(await readFile(join(p.ref.dir, 'prototype.json'), 'utf8'));
  assert.equal(manifest.version, p.ref.version);
  assert.ok(auditOf(h.orch).includes('Prototype confirmed by you.'));
  // Run 1 (this run, unsplit) owns no slice: no prototype/ folder.
  assert.equal(existsSync(join(h.orch.pipeline.dir, 'prototype')), false);
});

test('a remark that names R-ux-1 changes the requirements file only after "change", then rebuilds before the confirm', async () => {
  let reqFile = null;
  let before = null;
  const h = start({ onProto: async (q, orch) => {
    const m = q.prototype.moment;
    if (m === 'offered') return orch.answer(q.id, { decision: 'build' });
    if (m === 'built' && !q.prototype.rebuilt) {
      reqFile = h.asks.find(isReqAsk).plan.file;
      before = await readFile(reqFile, 'utf8');
      return orch.answer(q.id, { decision: 'remark', remark: 'R-ux-1 should show dark mode' });
    }
    if (m === 'remark') {
      assert.equal(await readFile(reqFile, 'utf8'), before, 'nothing written before "change"');
      assert.equal(q.prototype.remark.id, 'R-ux-1');
      return orch.answer(q.id, { decision: 'change' });
    }
    return orch.answer(q.id, { decision: 'confirm' });
  } });
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  assert.deepEqual(protoAsks(h).map((q) => q.prototype.moment), ['offered', 'built', 'remark', 'built']);
  const after = await readFile(reqFile, 'utf8');
  assert.match(after, /R-ux-1\*\* Mock: the screen as the remark asks\n {2}Example: Mock: the remark shown on the screen/);
  const p = stats(h.orch).prototype;
  assert.equal(p.remarks, 1);
  assert.equal(p.rebuilt, true);
  assert.ok(protoAsks(h)[3].prototype.version > protoAsks(h)[1].prototype.version, 'rebuilt before the confirm');
  assert.equal(JSON.parse(await readFile(join(p.ref.dir, 'prototype.json'), 'utf8')).version, p.ref.version);
});

test('a remark matching nothing leaves the requirements file and the saved record byte-equal', async () => {
  process.env.WORCA_MOCK_PROTO_REMARK = 'none';
  let snap = null;
  const h = start({ onProto: async (q, orch) => {
    const m = q.prototype.moment;
    if (m === 'offered') return orch.answer(q.id, { decision: 'build' });
    if (!snap) {
      const file = h.asks.find(isReqAsk).plan.file;
      snap = { file, text: await readFile(file, 'utf8'), rec: JSON.stringify(stats(orch).prototype) };
      return orch.answer(q.id, { decision: 'remark', remark: 'make it calmer' });
    }
    assert.equal(q.prototype.remarkError, 'no-match');
    assert.equal(q.prototype.remarkText, 'make it calmer');
    assert.equal(await readFile(snap.file, 'utf8'), snap.text);
    assert.equal(JSON.stringify(stats(orch).prototype), snap.rec);
    return orch.answer(q.id, { decision: 'confirm' });
  } });
  assert.equal((await h.done).status, 'done');
  assert.deepEqual(protoAsks(h).map((q) => q.prototype.moment), ['offered', 'built', 'built']);
});

test('Thorough: the review spawn runs as a slice under the Requirements execution with no verdict; the hold still routes to n_plan', async () => {
  process.env.WORCA_MOCK_PROTO_REVIEW = JSON.stringify([[{ role: 'design', text: 'The preview is too small', objection: true }], []]);
  const spawns = [];
  const h = start({ position: 'thorough' });
  const real = h.orch._runNodeAttempts.bind(h.orch);
  h.orch._runNodeAttempts = async (nc, ctx) => {
    if (String(ctx.executionId).includes(':prototype-review-')) spawns.push({ id: ctx.executionId, parent: ctx.parentExecutionId, verdict: ctx.verdict });
    return real(nc, ctx);
  };
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const req = h.asks.find(isReqAsk);
  assert.equal(spawns.length, 2);
  for (const s of spawns) { assert.equal(s.parent, req.executionId); assert.equal(s.verdict, null); }
  const built = protoAsks(h).find((q) => q.prototype.moment === 'built').prototype;
  assert.equal(built.reviewRounds, 2);
  assert.ok(h.timeline.indexOf('exec:n_plan') > h.timeline.lastIndexOf('ask:prototype:built'));
});

test('--yes under Lean skips with its line; an unmarked run raises no prototype ask', async () => {
  // A Lean Care needs a large feature picked down by the person; --yes is switched on once Care is answered.
  const lean = start({ position: 'lean' });
  lean.orch.on('question', (q) => { if (isReqAsk(q)) { lean.orch.opts.auto = true; lean.orch.auto = true; } });
  assert.equal((await lean.done).status, 'done');
  assert.ok(auditOf(lean.orch).includes('Prototype skipped · Lean builds it only when asked.'), 'the skip line');
  assert.equal(stats(lean.orch).prototype.cause, 'lean');
  const plain = start({ smallRuns: false });
  assert.equal((await plain.done).status, 'done');
  assert.equal(protoAsks(plain).length, 0);
  assert.equal('prototype' in (stats(plain.orch) || {}), false);
  assert.equal(existsSync(join(plain.orch.pipeline.dir, 'prototype-confirmed')), false);
});

test('a run resumed at the built moment raises no requirements ask, 1 prototype ask at built, and starts no Design build', async () => {
  let paused = null;
  const h = start({ onProto: (q, orch) => {
    if (q.prototype.moment === 'offered') return orch.answer(q.id, { decision: 'build' });
    paused = orch.pause();
  } });
  await h.done;
  await paused;
  const id = h.orch.getState().id;
  assert.equal(stats(h.orch).prototype.state, 'built');
  const row = readPipelineForResume(id);
  let started = 0;
  const reg = registry();
  const realStart = reg.start.bind(reg);
  reg.start = (o) => { started += 1; return realStart(o); };
  const r = start({ resume: { pipelineId: id, ...row }, designBuilds: reg });
  assert.equal((await r.done).status, 'done');
  assert.equal(r.asks.filter(isReqAsk).length, 0);
  assert.deepEqual(protoAsks(r).map((q) => q.prototype.moment), ['built']);
  assert.equal(started, 0);
});

test('a pause while Design builds stops the step at once; the resume awaits the same build: one design, one build, one "Prototype built"', async () => {
  const reg = registry();
  let started = 0;
  let paused = null;
  const realStart = reg.start.bind(reg);
  const realSettled = reg.whenSettled.bind(reg);
  reg.start = (o) => { started += 1; return realStart(o); };
  reg.whenSettled = async (id) => { await new Promise((r) => setTimeout(r, 150)); return realSettled(id); };
  const h = start({ designBuilds: reg, onProto: (q, orch) => {
    if (q.prototype.moment !== 'offered') return orch.answer(q.id, { decision: 'confirm' });
    orch.answer(q.id, { decision: 'build' });
    setTimeout(() => { paused = orch.pause(); }, 50);
  } });
  await h.done;
  await paused;
  assert.equal(h.orch.getState().status, 'paused');
  const mid = stats(h.orch).prototype;
  assert.equal(mid.state, 'building');
  assert.ok(mid.buildId && mid.designId);
  assert.equal(protoAsks(h).length, 1, 'the paused run raised no built ask');
  const id = h.orch.getState().id;
  const r = start({ resume: { pipelineId: id, ...readPipelineForResume(id) }, designBuilds: reg });
  assert.equal((await r.done).status, 'done');
  assert.equal(started, 1);
  const p = stats(r.orch).prototype;
  assert.equal(p.designId, mid.designId);
  assert.equal(p.state, 'confirmed');
  assert.equal(auditOf(r.orch).filter((t) => t.startsWith('Prototype built')).length, 1);
});

test('a pause right after a remark answer resumes with the remark, not a lost answer or a second round', async () => {
  process.env.WORCA_MOCK_PROTO_REMARK = 'none';
  let paused = null;
  const h = start({ onProto: (q, orch) => {
    if (q.prototype.moment === 'offered') return orch.answer(q.id, { decision: 'build' });
    orch.answer(q.id, { decision: 'remark', remark: 'make it calmer' });
    paused = orch.pause();
  } });
  await h.done;
  await paused;
  const id = h.orch.getState().id;
  const row = readPipelineForResume(id);
  const r = start({ resume: { pipelineId: id, ...row } });
  assert.equal((await r.done).status, 'done');
  const first = protoAsks(r)[0].prototype;
  assert.equal(first.moment, 'built');
  assert.equal(first.remarkText, 'make it calmer', 'the remark was matched on resume, not lost');
});

test('R-arch-12: the prototype block is the only difference in an agent prompt', () => {
  const ctx = { node: { id: 'n_impl', key: 'implementer' }, meta: { runnerType: 'implementer' }, ports: { inputs: [], outputs: [] }, bindings: {},
    pipelineDir: '/p', projectDir: '/w', trigger: { freshPorts: [] } };
  const plain = buildAgentPrompt(ctx);
  const block = prototypeBlock({ dir: '/p/prototype', ids: ['R-ux-1'] });
  const withProto = buildAgentPrompt({ ...ctx, shapePrototype: { dir: '/p/prototype', ids: ['R-ux-1'] } });
  assert.notEqual(withProto, plain);
  assert.equal(withProto.replace(block, ''), plain);
});

test('D14: a slice run owning R-ux-1 stages prototype/ and sets the block; one owning no screen id gets neither', async () => {
  const h = start();
  assert.equal((await h.done).status, 'done');
  const ref = stats(h.orch).prototype.ref;
  const owner = createOrchestrator({ projectDir: h.dir, workflowId: 'wf_default', prompt: 'x', claude: { mock: true } });
  owner.pipeline = { dir: await mkdtemp(join(tmpdir(), 'worca-proto-run-')) };
  owner.runShape = { slice: { index: 1, feature: 'f', outline: { slices: [{ requirements: ['R-po-2', 'R-ux-1'] }] } } };
  owner._shapeRec = { smallRuns: true, prototype: stats(h.orch).prototype };
  const realOf = owner._shapePrototypeCtx.bind(owner);
  const got = await realOf();
  assert.deepEqual(got, { dir: join(owner.pipeline.dir, 'prototype'), ids: ['R-ux-1'] });
  assert.equal(JSON.parse(await readFile(join(got.dir, 'prototype.json'), 'utf8')).version, ref.version);
  const none = createOrchestrator({ projectDir: h.dir, workflowId: 'wf_default', prompt: 'x', claude: { mock: true } });
  none.pipeline = { dir: await mkdtemp(join(tmpdir(), 'worca-proto-run-')) };
  none.runShape = { slice: { index: 1, feature: 'f', outline: { slices: [{ requirements: ['R-po-1'] }] } } };
  none._shapeRec = { smallRuns: true, prototype: owner._shapeRec.prototype };
  assert.equal(await none._shapePrototypeCtx(), null);
  assert.equal(existsSync(join(none.pipeline.dir, 'prototype')), false);
});
