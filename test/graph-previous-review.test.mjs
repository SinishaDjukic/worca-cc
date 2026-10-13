// test/graph-previous-review.test.mjs — F: a cycle >= 2 execution of a node with a verdict gets its own
// previous cycle's persisted verdict (the reviews row _afterExecution wrote) as ctx.previousReview, and
// buildAgentPrompt renders it as "## Previous cycle's review". Cycle 1, verdict-less nodes and a never-
// written previous verdict carry null. Generic for every verdict node (refiner here; reviewer, plan
// reviewer and the other verifiers share _execCtx).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { resolveGraph } from '../src/core/workflows.mjs';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeReview } from '../src/core/artifacts.mjs';
import { buildAgentPrompt } from '../src/core/graph/executor.mjs';
import { readVerdict } from '../src/core/graph/exec-io.mjs';

useTempHome(after);
process.env.WORCA_HOST_GUARD = '0';
const dirs = [];
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-prevrev-')); dirs.push(d); return d; };

async function gitRepo() {
  const repo = await tmp();
  const g = (a) => spawnSync('git', a, { cwd: repo });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(repo, 'README.md'), '# hi\n'); g(['add', '-A']); g(['commit', '-qm', 'init']);
  return repo;
}

test('_execCtx: ordinal >= 2 of a verdict node carries the previous cycle\'s reviews row; cycle 1 and verdict-less nodes carry null', async () => {
  const repo = await gitRepo();
  const r = await resolveGraph(repo, 'wf_default', loadAgentRegistry(), DEFAULT_AGENTS_DIR, {});
  const seeded = await seedPipeline(repo, { title: 'prev', status: 'running' });
  const orch = createOrchestrator({ projectDir: repo, prompt: 'x', auto: true, claude: { mock: true } });
  orch.pipeline = { id: seeded.id, dir: seeded.dir, promptText: 'x' };
  orch.resolved = r;
  const refine = { id: 'n_refine', kind: 'agent', key: 'refiner', config: {} };
  const plan = { id: 'n_plan', kind: 'agent', key: 'planner', config: {} };
  const cycle1 = {
    issues: [{ severity: 'major', title: 'Run line never ran', detail: 'd', location: 'Task 2' }],
    resolved: [{ severity: 'major', title: 'Dead anchor', detail: 'replayed', location: 'Task 1' }],
    lanes: ['replay'], summary: 's1',
  };
  await checkRows([
    { name: 'cycle 1: null (nothing before it)', run: () => {
      assert.equal(orch._execCtx(refine, r.nodes.n_refine, { executionId: 'x:n_refine:1', ordinal: 1 }).previousReview, null);
    } },
    { name: 'cycle 2 with no persisted row: null (a never-written verdict skips its row)', run: () => {
      assert.equal(orch._execCtx(refine, r.nodes.n_refine, { executionId: 'x:n_refine:2', ordinal: 2 }).previousReview, null);
    } },
    { name: 'cycle 2 reads reviews(kind=refine, cycle=1), tags it with the cycle, and the prompt carries it', run: async () => {
      await writeReview(seeded.id, 'refine', 1, cycle1);
      const ctx = orch._execCtx(refine, r.nodes.n_refine, { executionId: 'x:n_refine:2', ordinal: 2 });
      assert.deepEqual(ctx.previousReview, { cycle: 1, ...cycle1 });
      const prompt = buildAgentPrompt(ctx);
      assert.ok(prompt.includes("## Previous cycle's review (cycle 1)"));
      assert.ok(prompt.includes('- [major] Run line never ran — Task 2: d'));
      assert.ok(prompt.includes('### Resolved last cycle (1)\n\n- [major] Dead anchor — Task 1: replayed'));
      assert.ok(prompt.includes('Lanes run last cycle: replay'));
    } },
    { name: 'cycle 3 reads cycle 2, never cycle 1', run: async () => {
      await writeReview(seeded.id, 'refine', 2, { issues: [], summary: 's2', resolved: cycle1.issues, lanes: ['suite'] });
      const ctx = orch._execCtx(refine, r.nodes.n_refine, { executionId: 'x:n_refine:3', ordinal: 3 });
      assert.equal(ctx.previousReview.cycle, 2);
      assert.equal(ctx.previousReview.summary, 's2');
      assert.deepEqual(ctx.previousReview.resolved.map((i) => i.title), ['Run line never ran']);
    } },
    { name: 'a DB error reading the previous row loses only the optional block: null, never a throw', run: () => {
      const broken = { pipeline: { id: Symbol('unbindable') }, _verdictKind: () => 'refine' };
      assert.equal(orch._previousReview.call(broken, refine, { ordinal: 2, verdict: { path: '/x/refine-review-cycle2.json' } }), null);
    } },
    { name: 'a node without a verdict (planner) carries null at any ordinal', run: () => {
      assert.equal(orch._execCtx(plan, r.nodes.n_plan, { executionId: 'x:n_plan:2', ordinal: 2 }).previousReview, null);
    } },
    { name: 'readVerdict keeps resolved + lanes from the file the agent wrote (what _afterExecution persists)', run: async () => {
      const f = join(await tmp(), 'refine-review-cycle2.json');
      await writeFile(f, JSON.stringify({ issues: [], resolved: cycle1.issues, lanes: ['replay', 'suite'], summary: 'ok' }), 'utf8');
      const v = await readVerdict(f);
      assert.deepEqual(Object.keys(v), ['issues', 'summary', 'resolved', 'lanes']);
      assert.equal(v.resolved.length, 1);
      assert.deepEqual(v.lanes, ['replay', 'suite']);
    } },
  ]);
});
