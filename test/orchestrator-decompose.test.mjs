import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { _resetForTests } from '../src/core/db.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { listPhases, listTasks } from '../src/core/artifacts.mjs';
import { createOrchestrator, decomposedTaskNode } from '../src/core/orchestrator.mjs';
import { ctxFanOut } from '../src/core/phases.mjs';
import { posix } from './helpers/posix-path.mjs';

let home, proj;
beforeEach(async () => {
  _resetForTests();
  home = await mkdtemp(join(tmpdir(), 'worca-cc-orch-home-'));
  process.env.WORCA_HOME = home;
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-orch-proj-'));
  await writeFile(join(proj, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: proj });
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: proj });
});
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  for (const d of [home, proj]) if (d) await rm(d, { recursive: true, force: true });
});

test('a decomposer run records phases + tasks and fans out implementers (mock)', async () => {
  // Workflow: planner -> refiner -> decomposer -> implementer -> reviewer
  const wf = await writeWorkflow({
    name: 'Decompose Test',
    steps: [
      [{ id: 's0_0', key: 'planner' }],
      [{ id: 's1_0', key: 'refiner' }],
      [{ id: 's_dec', key: 'decomposer' }],
      [{ id: 's2_0', key: 'implementer' }],
      [{ id: 's3_0', key: 'reviewer' }],
    ],
    feedbacks: [{ id: 'fb_review', from: 's3_0', to: 's2_0' }],
  });

  const orch = createOrchestrator({
    projectDir: proj,
    prompt: 'demo decomposed task',
    workflowId: wf.id,
    auto: true,                 // no interactive gates
    claude: { mock: true },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done');

  const pid = orch.getState().id;
  assert.equal(listPhases(pid).length, 2);            // mock decomposer emits 2 phases
  assert.equal(listTasks(pid).length, 3);             // ...and 3 tasks total

  // The persisted UI stepper manifest replaced the single implementer cell with per-task nodes.
  const stepper = orch.getState().stepper;
  const ids = stepper.steps.flatMap((s) => (s.nodes || []).map((n) => n.id));
  assert.ok(ids.includes('s_impl_p1_t1'));
  assert.ok(ids.includes('s_impl_p2_t1'));
  assert.ok(!ids.includes('s2_0'), 'original implementer node should be replaced');
});

test('decomposedTaskNode carries phase siblings (excluding self) for the shared-tree prompt block', () => {
  const implNode = { model: 'sonnet', effort: 'high', tools: ['Read'] };
  const tasks = [
    { id: 'p1t1', nodeId: 's_impl_p1_t1', title: 'A', file: 'tasks/p1-t1-a.md' },
    { id: 'p1t2', nodeId: 's_impl_p1_t2', title: 'B', file: 'tasks/p1-t2-b.md' },
    { id: 'p1t3', nodeId: 's_impl_p1_t3', title: 'C', file: 'tasks/p1-t3-c.md' },
  ];
  const node = decomposedTaskNode(implNode, tasks[1], tasks, '/runs/pipe1');
  assert.equal(node.nodeId, 's_impl_p1_t2');
  assert.equal(posix(node.taskPath), '/runs/pipe1/tasks/p1-t2-b.md');
  assert.equal(node.decomposedTask, true);
  assert.deepEqual(node.siblings, [
    { id: 'p1t1', title: 'A', file: 'tasks/p1-t1-a.md' },
    { id: 'p1t3', title: 'C', file: 'tasks/p1-t3-c.md' },
  ]);
  // Solo task in its phase -> no siblings.
  const solo = decomposedTaskNode(implNode, tasks[0], [tasks[0]], '/runs/pipe1');
  assert.deepEqual(solo.siblings, []);
});

test('decomposedTaskNode inherits fanOut from the implementer node so each task implementer fans out', () => {
  const tasks = [{ id: 'p1t1', nodeId: 's_impl_p1_t1', title: 'A', file: 'tasks/p1-t1-a.md' }];

  // fanOut ON -> the synthetic per-task node carries it -> ctxFanOut(ctx) true per task.
  const on = decomposedTaskNode({ model: 'sonnet', effort: 'high', tools: ['Read'], fanOut: true }, tasks[0], tasks, '/runs/pipe1');
  assert.equal(on.fanOut, true);
  assert.equal(ctxFanOut({ node: on }), true);

  // fanOut OFF -> propagated as false -> ctxFanOut false (byte-identical behavior to today).
  const off = decomposedTaskNode({ model: 'sonnet', effort: 'high', tools: ['Read'], fanOut: false }, tasks[0], tasks, '/runs/pipe1');
  assert.equal(off.fanOut, false);
  assert.equal(ctxFanOut({ node: off }), false);

  // implNode WITHOUT a fanOut field (passthrough undefined) safely coerces to off downstream (D1).
  const bare = decomposedTaskNode({ model: 'sonnet', tools: ['Read'] }, tasks[0], tasks, '/runs/pipe1');
  assert.equal(ctxFanOut({ node: bare }), false);
});

test('decomposed run records a pipeline step per task node', async () => {
  const wf = await writeWorkflow({
    name: 'Decompose Steps',
    steps: [
      [{ id: 's0_0', key: 'planner' }],
      [{ id: 's_dec', key: 'decomposer' }],
      [{ id: 's2_0', key: 'implementer' }],
      [{ id: 's3_0', key: 'reviewer' }],
    ],
    feedbacks: [],
  });
  const orch = createOrchestrator({ projectDir: proj, prompt: 'demo', workflowId: wf.id, auto: true, claude: { mock: true } });
  await orch.run();
  const stepNodeIds = orch.getState().steps.map((s) => s.nodeId);
  assert.ok(stepNodeIds.includes('s_impl_p1_t1'));
  assert.ok(stepNodeIds.includes('s_impl_p1_t2'));
  assert.ok(stepNodeIds.includes('s_impl_p2_t1'));
});
