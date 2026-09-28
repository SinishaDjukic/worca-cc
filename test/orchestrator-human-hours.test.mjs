// End to end through the real GraphOrchestrator with the offline mock: a producer that edits the
// worktree and writes its md output earns human hours on its ledger row; the run row mirrors the
// sum; the end card earns nothing; a run STOPPED mid-implementation keeps the planner credit AND the
// code written before the stop (the path with no _afterExecution: the estimate's own staging shows it);
// a run PAUSED mid-implementation credits the pre-pause work at the real terminal after resume.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { readPipelineForResume } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

// task → planner (md output) → implementer (code) → end. Built-in keys are used ONLY because
// the mock registry ships them; the estimator never reads them.
const G = {
  id: 'wf_test_human', name: 'human', version: 2,
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 200, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 400, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** The v2 executor ABI: one entry per declared output port (the scheduler routes `res.outputs[port].path`). */
function outsOf(ctx) {
  const o = {};
  for (const p of ctx.ports.outputs || []) o[p.id] = { path: ctx.outputs?.[p.id]?.path ?? null, type: p.type };
  return o;
}
const ok = (ctx) => ({ outputs: outsOf(ctx), verdict: null, summary: 'x' });
const codeFile = (ctx, n = 200) => writeFile(join(ctx.projectDir, 'feature.js'), Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n', 'utf8');
const codeExpect = (files, lines) => Math.round((0.5 + 0.1 * files + Math.pow(lines, 0.85) / 25) * 100) / 100;

const stepRows = (id) => getDb().prepare('SELECT node_id, agent_key, exec_kind, status, human_hours, human_signals FROM pipeline_steps WHERE pipeline_id = ? ORDER BY rowid').all(id);
const runHours = (id) => getDb().prepare('SELECT human_hours FROM pipelines WHERE id = ?').get(id).human_hours;

test('planner earns write hours, implementer earns code hours, end earns nothing, run = Σ', { timeout: 60000 }, async () => {
  await writeGraphWorkflow(G);
  const orch = createOrchestrator({
    projectDir: gitDir('human-1'), workflowId: G.id, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async (ctx) => {
        if (ctx.node.key === 'planner') await writeFile(ctx.outputs.plan.path, 'word '.repeat(1000), 'utf8');
        if (ctx.node.key === 'implementer') await codeFile(ctx);
        return ok(ctx);
      },
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const id = orch.pipeline.id;
  const rows = stepRows(id);
  const plan = rows.find((r) => r.agent_key === 'planner');
  const impl = rows.find((r) => r.agent_key === 'implementer');
  const end = rows.find((r) => r.node_id === 'n_end');   // the harness adds preflight/done rows with agent_key null too
  assert.equal(plan.human_hours, 2.25, 'planner: 0.25 + 1000/500');
  assert.equal(JSON.parse(plan.human_signals).write, 2.25);
  assert.equal(impl.human_hours, codeExpect(1, 200), 'implementer: one NEW file, 200 insertions (intent-to-add makes it visible)');
  assert.equal(JSON.parse(impl.human_signals).code, codeExpect(1, 200));
  assert.equal(end.human_hours, null, 'flow cards carry no estimate');
  assert.ok(rows.filter((r) => r.agent_key == null).every((r) => r.human_hours == null), 'task/end cards and the harness preflight/done rows stay NULL');
  assert.equal(runHours(id), Math.round((2.25 + codeExpect(1, 200)) * 100) / 100);
});

test('a run stopped during the implementer keeps the planner credit and the code written before the stop', { timeout: 60000 }, async () => {
  await writeGraphWorkflow(G);
  let orch;
  orch = createOrchestrator({
    projectDir: gitDir('human-2'), workflowId: G.id, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async (ctx) => {
        if (ctx.node.key === 'planner') await writeFile(ctx.outputs.plan.path, 'word '.repeat(500), 'utf8');
        if (ctx.node.key === 'implementer') {
          // Written BEFORE the stop: this path skips _afterExecution (which stages for sideEffect:'code'
          // agents on the done path), so only _humanMeasure's own `stage` hook can make the new file visible.
          await codeFile(ctx, 100);
          orch.stop();
          const e = new Error('aborted'); e.name = 'AbortError'; throw e;
        }
        return ok(ctx);
      },
    },
  });
  const res = await orch.run();
  assert.equal(res.status, 'stopped');
  const id = orch.pipeline.id;
  assert.equal(stepRows(id).find((r) => r.agent_key === 'planner').human_hours, 1.25);
  assert.equal(stepRows(id).find((r) => r.agent_key === 'implementer').human_hours, codeExpect(1, 100), 'code written before the stop is credited: the estimate stages the tree itself');
  assert.equal(runHours(id), Math.round((1.25 + codeExpect(1, 100)) * 100) / 100);
});

test('a run paused mid-implementation credits the pre-pause code at the real terminal after resume', { timeout: 120000 }, async () => {
  await writeGraphWorkflow(G);
  const dir = gitDir('human-3');
  const seen = { paused: false };
  /** Writes the code, THEN pauses once; on resume returns without writing more. */
  const producer = (getOrch) => async (ctx) => {
    if (ctx.node.key === 'planner') await writeFile(ctx.outputs.plan.path, 'word '.repeat(500), 'utf8');
    if (ctx.node.key === 'implementer' && !seen.paused) {
      await codeFile(ctx);
      seen.paused = true;
      queueMicrotask(() => getOrch().pause());
      return new Promise((_r, rej) => {
        const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
        if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    return ok(ctx);
  };
  let orch;
  orch = createOrchestrator({ projectDir: dir, workflowId: G.id, prompt: 'demo', auto: true, claude: { mock: true }, runners: { producer: producer(() => orch) } });
  const first = await orch.run();
  assert.equal(first.status, 'paused', first.error);
  const id = orch.pipeline.id;
  assert.equal(stepRows(id).find((r) => r.agent_key === 'implementer').human_hours, null, 'a paused execution is not estimated');
  const saved = readPipelineForResume(id);
  assert.deepEqual(saved.resumePoint.humanCursor, { files: 0, insertions: 0, deletions: 0 }, 'the cursor at the last terminal rides the resume point');
  let orch2;
  orch2 = createOrchestrator({ projectDir: dir, workflowId: G.id, auto: true, claude: { mock: true }, resume: saved, runners: { producer: producer(() => orch2) } });
  const second = await orch2.resume();
  assert.equal(second.status, 'done', second.error);
  const impl = stepRows(id).find((r) => r.agent_key === 'implementer');
  assert.equal(impl.status, 'done');
  assert.equal(impl.human_hours, codeExpect(1, 200), 'the file written BEFORE the pause is credited (no re-baseline on resume)');
  assert.equal(runHours(id), Math.round((1.25 + codeExpect(1, 200)) * 100) / 100);
});
