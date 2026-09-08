// End-to-end (offline mock, real orchestrator, real DB): every execution's files
// land under <runDir>/steps/<node>-cN[-slice]/ and are indexed with their
// attribution — allocated outputs, the verdict (kind 'verdict') and the scanned
// extras (format kinds). Same harness as test/orchestrator-graph.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator, GraphOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { listRunArtifacts, artifactPaths } from '../src/core/artifacts.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-steps-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  for (const t of SEED_TEMPLATES) await writeGraphWorkflow({ id: t.id, name: t.name, domain: t.domain, nodes: t.nodes, wires: t.wires });
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

const EXTRA = 'DEVIATIONS.md=# Deviations\n\nnone;notes/scratch.txt=hi';
async function runWithExtras(workflowId, tag) {
  const prev = process.env.WORCA_MOCK_EXTRA_FILES;
  process.env.WORCA_MOCK_EXTRA_FILES = EXTRA;
  try {
    const dir = gitDir(tag);
    const orch = createOrchestrator({ projectDir: dir, workflowId, prompt: 'steps probe', claude: { mock: true }, auto: true });
    const frames = [];
    orch.on('artifact', (a) => frames.push(a));
    const res = await orch.run();
    assert.equal(res.status, 'done', res.error);
    const st = orch.getState();
    const rows = await listRunArtifacts(st.id);
    return { dir, orch, st, res, rows, frames, runDir: st.pipelineDir };
  } finally {
    if (prev === undefined) delete process.env.WORCA_MOCK_EXTRA_FILES; else process.env.WORCA_MOCK_EXTRA_FILES = prev;
  }
}
const rels = (rows, kind) => rows.filter((r) => r.kind === kind).map((r) => r.relPath).sort();
const attrOf = (rows, rel) => { const r = rows.find((x) => x.relPath === rel); return r && { kind: r.kind, stepKey: r.stepKey, nodeId: r.nodeId, cycle: r.cycle }; };

test('wf_default: outputs, verdicts and scanned extras are indexed per node/cycle under steps/', { timeout: 120000 }, async () => {
  const { dir, rows, frames, runDir } = await runWithExtras('wf_default', 'steps-default');
  assert.deepEqual(rels(rows, 'clarify'), ['steps/n_clarify-c1/clarify.json']);
  assert.deepEqual(rels(rows, 'plan'), ['steps/n_plan-c1/plan.md', 'steps/n_refine-c1/plan-v2.md', 'steps/n_refine-c2/plan-v3.md']);
  assert.deepEqual(rels(rows, 'review'), ['steps/n_review-c1/impl-review-cycle1.md', 'steps/n_review-c2/impl-review-cycle2.md'], 'no cross-cycle overwrite');
  assert.deepEqual(rels(rows, 'verdict'), [
    'steps/n_refine-c1/refine-review-cycle1.json', 'steps/n_refine-c2/refine-review-cycle2.json',
    'steps/n_review-c1/impl-review-cycle1.json', 'steps/n_review-c2/impl-review-cycle2.json',
  ]);
  assert.deepEqual(attrOf(rows, 'steps/n_refine-c1/refine-review-cycle1.json'), { kind: 'verdict', stepKey: 'x:n_refine:1', nodeId: 'n_refine', cycle: 1 });
  assert.deepEqual(attrOf(rows, 'steps/n_review-c2/impl-review-cycle2.md'), { kind: 'review', stepKey: 'x:n_review:2', nodeId: 'n_review', cycle: 2 });
  // The scanned extras: format kinds, attributed to the execution that produced them.
  assert.deepEqual(attrOf(rows, 'steps/n_impl-c1/DEVIATIONS.md'), { kind: 'markdown', stepKey: 'x:n_impl:1', nodeId: 'n_impl', cycle: 1 });
  assert.deepEqual(attrOf(rows, 'steps/n_impl-c2/DEVIATIONS.md'), { kind: 'markdown', stepKey: 'x:n_impl:2', nodeId: 'n_impl', cycle: 2 });
  assert.deepEqual(attrOf(rows, 'steps/n_impl-c1/notes/scratch.txt'), { kind: 'text', stepKey: 'x:n_impl:1', nodeId: 'n_impl', cycle: 1 });
  // One row per file: an allocated file is never re-indexed by the scan under a format kind.
  assert.equal(rows.filter((r) => r.relPath === 'steps/n_review-c1/impl-review-cycle1.md').length, 1);
  assert.equal(rows.filter((r) => r.relPath === 'steps/n_refine-c1/refine-review-cycle1.json').length, 1);
  assert.ok(rows.every((r) => !r.relPath.startsWith('plans/') && !r.relPath.startsWith('reviews/')), 'nothing lands in the project store');
  for (const p of [artifactPaths(dir).plans, artifactPaths(dir).reviews]) {
    assert.ok(!existsSync(p) || readdirSync(p).length === 0, `${p} received no file`);
  }
  assert.ok(existsSync(join(runDir, 'steps', 'n_review-c2', 'impl-review-cycle2.md')));
  assert.equal(rows.find((r) => r.relPath === 'steps/n_review-c2/impl-review-cycle2.md').bytes,
    (await readFile(join(runDir, 'steps', 'n_review-c2', 'impl-review-cycle2.md'))).length, 'bytes stat the run-dir file');
  // The live frames carry the same attribution, in outputs → verdict → scanned order.
  const refine1 = frames.filter((f) => f.executionId === 'x:n_refine:1').map((f) => f.kind);
  assert.deepEqual(refine1.slice(0, 2), ['plan', 'verdict']);
  assert.ok(refine1.slice(2).every((k) => ['markdown', 'text'].includes(k)));
  const dev = frames.find((f) => f.kind === 'markdown' && f.path === join(runDir, 'steps', 'n_impl-c1', 'DEVIATIONS.md'));
  assert.deepEqual({ nodeId: dev.nodeId, executionId: dev.executionId, cycle: dev.cycle }, { nodeId: 'n_impl', executionId: 'x:n_impl:1', cycle: 1 });
});

test('wf_full: task files under the decomposer step, one folder per slice, none for the composite parent', { timeout: 180000 }, async () => {
  // Seed trace (test/fixtures/seed-traces/wf_full.json): implementer ×5 = three slices
  // of x:n_impl:1 + the plain fix cycles c2 and c3; reviewer ×3; checklist/webui ×2.
  const { rows, runDir } = await runWithExtras('wf_full', 'steps-full');
  assert.deepEqual(rels(rows, 'decomposition'), ['steps/n_decompose-c1/decomposition.json']);
  const tasks = rows.filter((r) => r.relPath.startsWith('steps/n_decompose-c1/tasks/'));
  assert.deepEqual(tasks.map((r) => r.relPath).sort(), [
    'steps/n_decompose-c1/tasks/p1-t1-slice-one.md', 'steps/n_decompose-c1/tasks/p1-t2-slice-two.md', 'steps/n_decompose-c1/tasks/p2-t1-slice-three.md',
  ]);
  for (const t of tasks) assert.deepEqual({ kind: t.kind, stepKey: t.stepKey, nodeId: t.nodeId, cycle: t.cycle }, { kind: 'markdown', stepKey: 'x:n_decompose:1', nodeId: 'n_decompose', cycle: 1 });
  assert.deepEqual(attrOf(rows, 'steps/n_impl-c1-p1t1/DEVIATIONS.md'), { kind: 'markdown', stepKey: 'x:n_impl:1:p1t1', nodeId: 'n_impl', cycle: 1 });
  assert.deepEqual(attrOf(rows, 'steps/n_impl-c1-p2t1/DEVIATIONS.md'), { kind: 'markdown', stepKey: 'x:n_impl:1:p2t1', nodeId: 'n_impl', cycle: 1 });
  assert.equal(existsSync(join(runDir, 'steps', 'n_impl-c1')), false, 'the composite parent x:n_impl:1 allocates nothing and gets no folder');
  assert.ok(existsSync(join(runDir, 'steps', 'n_impl-c2', 'DEVIATIONS.md')), 'the fix cycle is a plain execution with its own folder');
  assert.deepEqual(rels(rows, 'checklist'), ['steps/n_check-c1/manual-tests-checklist.md', 'steps/n_check-c2/manual-tests-checklist.md']);
  assert.deepEqual(rels(rows, 'webui'), ['steps/n_webui-c1/webui-review-cycle1.md', 'steps/n_webui-c2/webui-review-cycle2.md']);
  assert.deepEqual(rels(rows, 'review'), ['steps/n_review-c1/impl-review-cycle1.md', 'steps/n_review-c2/impl-review-cycle2.md', 'steps/n_review-c3/impl-review-cycle3.md']);
  assert.ok(rels(rows, 'verdict').includes('steps/n_webui-c1/webui-review-cycle1.json'));
});

test('a manifest task file outside the run folder fails the expansion; in-run relative and absolute files pass', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'worca-expand-'));
  after(() => rmSync(scratch, { recursive: true, force: true }));
  const run = join(scratch, 'run');
  const outside = join(scratch, 'elsewhere');
  mkdirSync(join(run, 'steps', 'n_dec-c1', 'tasks'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  const orch = Object.create(GraphOrchestrator.prototype);
  orch.pipeline = { id: 'deadbeef', dir: run };
  orch._log = () => {};
  const manifest = (tasks) => { const p = join(run, 'steps', 'n_dec-c1', 'decomposition.json'); writeFileSync(p, JSON.stringify({ phases: [{ ordinal: 1, tasks }] })); return p; };
  const expand = (p) => orch._expandDecomposition({ id: 'n_dec' }, { executionId: 'x:n_dec:1', ordinal: 1, expandsPort: 'tasks', bindings: { tasks: { path: p } } });
  await assert.rejects(() => expand(manifest([{ id: 'p1t1', title: 'x', file: join(outside, 'evil.md') }])), /n_dec: task "p1t1" file resolves outside the run folder/);
  await assert.rejects(() => expand(manifest([{ id: 'p1t1', title: 'x', file: '../elsewhere/evil.md' }])), /n_dec: task "p1t1" file resolves outside the run folder/);
  const ok = await expand(manifest([
    { id: 'p1t1', title: 'abs', file: join(run, 'steps', 'n_dec-c1', 'tasks', 'a.md') },
    { id: 'p1t2', title: 'rel', file: 'steps/n_dec-c1/tasks/b.md' },
  ]));
  assert.deepEqual(ok.phases[0].tasks.map((t) => t.path), [join(run, 'steps', 'n_dec-c1', 'tasks', 'a.md'), join(run, 'steps', 'n_dec-c1', 'tasks', 'b.md')]);
  assert.equal(ok.phases[0].tasks[1].nodeId, 'x:n_dec:1:p1t2');
});
