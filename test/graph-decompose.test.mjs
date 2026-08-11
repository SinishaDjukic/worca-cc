// test/graph-decompose.test.mjs
// COMPOSITE fan-out executions (spec §3, "Decomposer fan-out (graph-native)").
//
// A fresh token on an `expands` input — and no fresh loop trigger (A3) — runs ONE
// composite execution of the consumer node: phases sequential, task
// sub-executions parallel under the global semaphore, each recorded `kind:'task'`
// under the SAME node, the node's outputs firing ONCE at the end.
//
// GENERICITY: nothing here may key off an agent key. The scheduler-level cases run
// the SAME machinery over a wholly custom ports table (`slicer` -> `builder`), and
// the end-to-end case registers two user agents the engine has never heard of. If
// a builtin key ever leaks into the composite path, the custom cases go red first.

import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { createScheduler, sliceExecutionId } from '../src/core/graph/scheduler.mjs';
import { readDecomposition, normalizeDecomposition } from '../src/core/graph/executor.mjs';
import { FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import { _resetForTests } from '../src/core/db.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { listPhases, listTasks } from '../src/core/artifacts.mjs';

// ── fixtures ──────────────────────────────────────────────────────────────────

const BLOCKING = (title) => ({ issues: [{ severity: 'major', title, detail: '', location: '' }], summary: '' });
const CLEAN = { issues: [], summary: '' };

/** A decomposer/implementer graph in miniature: the expands wire is w4. */
const DECOMP = {
  id: 'wf_decomp_fixture',
  name: 'Decompose',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', x: 200, y: 0, config: {} },
    { id: 'n_dec', kind: 'agent', key: 'decomposer', x: 400, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', x: 800, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1000, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_dec', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w4', from: { node: 'n_dec', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w5', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w6', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w7', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w8', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** The SAME shape with keys the engine has never heard of: `slicer` emits json into
 *  `builder`'s expands input. Zero overlap with the builtin table. */
const CUSTOM_TABLE = {
  slicer: {
    runnerType: 'producer',
    inputs: [{ id: 'brief', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'slices', type: 'json', when: 'always', filename: 'slices.json', store: 'run', artifactKind: 'slices' }],
  },
  builder: {
    runnerType: 'producer', sideEffect: 'code',
    inputs: [
      { id: 'brief', type: 'md', required: true, as: 'file' },
      { id: 'slice', type: 'json', required: false, expands: true, as: 'file',
        directive: 'Build exactly this slice.' },
    ],
    outputs: [{ id: 'built', type: 'void', when: 'always' }],
  },
};

const CUSTOM_DECOMP = {
  id: 'wf_custom_decomp',
  name: 'Custom Decompose',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_slice', kind: 'agent', key: 'slicer', x: 200, y: 0, config: {} },
    { id: 'n_build', kind: 'agent', key: 'builder', x: 400, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_slice', port: 'brief' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_build', port: 'brief' } },
    { id: 'w3', from: { node: 'n_slice', port: 'slices' }, to: { node: 'n_build', port: 'slice' } },
    { id: 'w4', from: { node: 'n_build', port: 'built' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** Two phases of two tasks — the shape every composite mechanics case asserts. */
const TWO_BY_TWO = [
  { ordinal: 1, tasks: [
    { id: 'p1t1', title: 'Slice one', path: '/pipe/tasks/p1-t1.md' },
    { id: 'p1t2', title: 'Slice two', path: '/pipe/tasks/p1-t2.md' },
  ] },
  { ordinal: 2, tasks: [
    { id: 'p2t1', title: 'Slice three', path: '/pipe/tasks/p2-t1.md' },
    { id: 'p2t2', title: 'Slice four', path: '/pipe/tasks/p2-t2.md' },
  ] },
];

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Scripted fake `execute` that speaks the composite protocol: `composite:'expand'`
 * hands back the decomposition, `'phase'` records the status transition, `'finish'`
 * closes the composite, and everything else is an ordinary execution. Records every
 * call IN CALL ORDER and tracks live agent concurrency.
 */
function harness({ template, ports, phases = TWO_BY_TWO, script = {}, maxParallel, expandsNodeId }) {
  const calls = [];
  const events = [];
  const snapshots = [];
  let live = 0;
  let maxLive = 0;
  const gates = [];

  const execute = async (args) => {
    const nodeId = args.node.id;
    if (args.composite === 'expand') {
      calls.push({ call: 'expand', nodeId, executionId: args.executionId, port: args.expandsPort });
      return { phases: typeof phases === 'function' ? phases(args) : phases };
    }
    if (args.composite === 'phase') {
      calls.push({ call: 'phase', nodeId, phase: args.phase, status: args.phaseStatus });
      return {};
    }
    if (args.composite === 'finish') {
      calls.push({ call: 'finish', nodeId, executionId: args.executionId, phases: args.phases.length });
      return { outputs: {} };
    }
    const rec = {
      call: 'run', nodeId, executionId: args.executionId, ordinal: args.ordinal,
      bindings: args.bindings, trigger: args.trigger, slice: args.slice || null, signal: args.signal,
    };
    calls.push(rec);
    if (args.node.kind !== 'agent') return script[nodeId] ? script[nodeId](args) : {};
    live += 1;
    maxLive = Math.max(maxLive, live);
    try {
      await tick();
      await tick();
      return script[nodeId] ? await script[nodeId](args) : {};
    } finally {
      live -= 1;
    }
  };

  const scheduler = createScheduler({
    template,
    portsFn: ports,
    execute,
    taskArtifact: { path: '/pipe/task.md' },
    maxParallel,
    onEvent: (name, payload) => events.push({ name, ...payload }),
    onSnapshot: (s) => snapshots.push(s),
    ask: async (q) => { gates.push(q); return 'continue'; },
  });

  return {
    scheduler, calls, events, snapshots, gates,
    maxLive: () => maxLive,
    starts: () => events.filter((e) => e.name === 'exec' && e.status === 'start'),
    execSeq: () => events
      .filter((e) => e.name === 'exec' && e.status === 'start')
      .map((e) => (e.kind === 'task' ? `${e.nodeId} t:${e.taskId}` : `${e.nodeId} c${e.ordinal}`)),
    tokensFrom: (nodeId, port) => events.filter(
      (e) => e.name === 'token' && e.from.node === nodeId && e.from.port === port,
    ),
    runsFor: (nodeId) => calls.filter((c) => c.call === 'run' && c.nodeId === nodeId),
    expandsNodeId,
  };
}

// ── 1. the decomposition document (tolerant parse) ────────────────────────────

const dirs = [];
async function tmpDir(prefix = 'worca-cc-decomp-') {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

test('normalizeDecomposition keeps well-formed phases and drops the rest', () => {
  const { phases } = normalizeDecomposition({
    phases: [
      { ordinal: 2, tasks: [{ id: 'p2t1', title: 'Two', file: 'tasks/b.md' }] },
      { ordinal: 1, tasks: [{ id: 'p1t1', file: 'tasks/a.md' }, { id: 'no-file' }, null] },
      { ordinal: 'x', tasks: [{ id: 'p9t1', file: 'tasks/z.md' }] },   // unusable ordinal
      { ordinal: 3, tasks: [] },                                       // no runnable task
      { ordinal: 4 },                                                  // no tasks at all
    ],
  });
  assert.deepEqual(phases, [
    { ordinal: 1, tasks: [{ id: 'p1t1', title: null, file: 'tasks/a.md' }] },
    { ordinal: 2, tasks: [{ id: 'p2t1', title: 'Two', file: 'tasks/b.md' }] },
  ], 'phases come back ordinal-sorted, tasks without an id or a file are dropped');
});

test('normalizeDecomposition is total: any shape resolves to a phases array', () => {
  for (const raw of [null, undefined, {}, { phases: null }, { phases: 'nope' }, [], 7]) {
    assert.deepEqual(normalizeDecomposition(raw), { phases: [] }, JSON.stringify(raw ?? null));
  }
});

test('readDecomposition parses a manifest and tolerates missing/malformed files', async () => {
  const dir = await tmpDir();
  const good = join(dir, 'decomposition.json');
  await writeFile(good, JSON.stringify({
    phases: [{ ordinal: 1, tasks: [{ id: 'p1t1', title: 'One', file: 'tasks/p1-t1.md' }] }],
  }), 'utf8');
  assert.deepEqual(await readDecomposition(good), {
    phases: [{ ordinal: 1, tasks: [{ id: 'p1t1', title: 'One', file: 'tasks/p1-t1.md' }] }],
  });

  const bad = join(dir, 'broken.json');
  await writeFile(bad, '{ not json', 'utf8');
  assert.deepEqual(await readDecomposition(bad), { phases: [] }, 'malformed reads as empty');
  assert.deepEqual(await readDecomposition(join(dir, 'nope.json')), { phases: [] }, 'missing reads as empty');
  assert.deepEqual(await readDecomposition(null), { phases: [] }, 'no path reads as empty');
});

// ── 2. composite mechanics (builtin ports) ────────────────────────────────────

const ports = portsFnFor(FIXTURE_PORTS);

/** Reviewer blocks at ordinal 1, passes from ordinal 2 — one fix cycle. */
const reviewScript = () => ({
  n_review: async (args) => ({ verdict: args.ordinal === 1 ? BLOCKING('fix me') : CLEAN }),
});

test('a fresh expands input runs ONE composite execution: 2 phases x 2 tasks under the same node', async () => {
  const h = harness({ template: DECOMP, ports, script: reviewScript() });
  assert.equal(await h.scheduler.run(), 'done');

  assert.deepEqual(h.execSeq(), [
    'n_task c1', 'n_plan c1', 'n_dec c1',
    'n_impl c1',
    'n_impl t:p1t1', 'n_impl t:p1t2', 'n_impl t:p2t1', 'n_impl t:p2t2',
    'n_review c1',
    'n_impl c2',
    'n_review c2',
    'n_end c1',
  ]);

  const slices = h.starts().filter((e) => e.kind === 'task');
  assert.equal(slices.length, 4, 'one sub-execution per task');
  for (const s of slices) {
    assert.equal(s.nodeId, 'n_impl', 'sub-executions are recorded under the CONSUMER node');
    assert.equal(s.agentKey, 'implementer');
    assert.equal(s.ordinal, 1, 'they belong to the composite execution, ordinal 1');
  }
  assert.deepEqual(slices.map((s) => s.phase), [1, 1, 2, 2]);
  assert.deepEqual(slices.map((s) => s.title), ['Slice one', 'Slice two', 'Slice three', 'Slice four']);
  assert.deepEqual(
    slices.map((s) => s.executionId),
    ['x:n_impl:1:p1t1', 'x:n_impl:1:p1t2', 'x:n_impl:1:p2t1', 'x:n_impl:1:p2t2'],
    'the composite id is <parent>:<taskId>',
  );
  assert.equal(sliceExecutionId('x:n_impl:1', 'p1t1'), 'x:n_impl:1:p1t1');
});

test('the composite binds the expands port to the individual task FILE and keeps it fresh', async () => {
  const h = harness({ template: DECOMP, ports, script: reviewScript() });
  await h.scheduler.run();

  const slices = h.runsFor('n_impl').filter((c) => c.slice);
  assert.equal(slices.length, 4);
  assert.deepEqual(slices.map((c) => c.bindings.task.path), [
    '/pipe/tasks/p1-t1.md', '/pipe/tasks/p1-t2.md', '/pipe/tasks/p2-t1.md', '/pipe/tasks/p2-t2.md',
  ], 'each sub-execution binds its OWN task file, not the decomposition json');
  for (const c of slices) {
    assert.ok(c.trigger.freshPorts.includes('task'), 'the slice directive renders (A3: the port is fresh)');
    assert.ok(c.bindings.plan, 'the other inputs keep their latched bindings');
    assert.equal(c.bindings.task.type, 'md', 'the bound payload is the task markdown');
  }
  assert.deepEqual(
    slices.map((c) => `${c.slice.phase}/${c.slice.id}`),
    ['1/p1t1', '1/p1t2', '2/p2t1', '2/p2t2'],
  );
});

test('phases run sequentially and their tasks in parallel, under the global semaphore', async () => {
  const wide = harness({ template: DECOMP, ports, script: reviewScript(), maxParallel: 4 });
  await wide.scheduler.run();
  assert.equal(wide.maxLive(), 2, 'both tasks of a phase are in flight together');

  const starts = wide.starts().filter((e) => e.kind === 'task').map((e) => e.taskId);
  const dones = wide.events.filter((e) => e.name === 'exec' && e.status === 'done' && e.kind === 'task')
    .map((e) => e.taskId);
  assert.deepEqual(starts, ['p1t1', 'p1t2', 'p2t1', 'p2t2']);
  assert.ok(
    wide.events.findIndex((e) => e.name === 'exec' && e.status === 'done' && e.taskId === 'p1t2')
      < wide.events.findIndex((e) => e.name === 'exec' && e.status === 'start' && e.taskId === 'p2t1'),
    'phase 2 starts only after every phase-1 task has settled',
  );
  assert.deepEqual(dones.slice(0, 2).sort(), ['p1t1', 'p1t2']);

  const narrow = harness({ template: DECOMP, ports, script: reviewScript(), maxParallel: 1 });
  assert.equal(await narrow.scheduler.run(), 'done');
  assert.equal(narrow.maxLive(), 1, 'maxParallel 1 serializes the slices — the shell holds no slot');
});

test('the composite node publishes ONCE, at the end, after the last phase', async () => {
  const h = harness({ template: DECOMP, ports, script: reviewScript() });
  await h.scheduler.run();

  const done = h.tokensFrom('n_impl', 'done');
  assert.equal(done.length, 2, 'one token for the composite, one for the fix cycle — never one per task');

  const seq = h.calls.map((c) => `${c.call}:${c.slice ? c.slice.id : c.phase ?? c.nodeId}`);
  const composite = seq.slice(seq.indexOf('expand:n_impl'));
  assert.deepEqual(composite.slice(0, 8), [
    'expand:n_impl',
    'phase:1', 'run:p1t1', 'run:p1t2', 'phase:1',
    'phase:2', 'run:p2t1', 'run:p2t2',
  ], 'phase status brackets each wave');
  assert.ok(
    h.calls.findIndex((c) => c.call === 'finish') > h.calls.findLastIndex((c) => c.slice),
    'finish (worktree staging) lands after the LAST phase',
  );
  const finish = h.calls.find((c) => c.call === 'finish');
  assert.equal(finish.executionId, 'x:n_impl:1');
  assert.equal(finish.phases, 2);
});

test('a fix-cycle re-fire is ONE normal execution on the combined diff (A3: the loop wins)', async () => {
  const h = harness({ template: DECOMP, ports, script: reviewScript() });
  await h.scheduler.run();

  const second = h.runsFor('n_impl').filter((c) => c.ordinal === 2);
  assert.equal(second.length, 1, 'the fix pass never fans out');
  assert.equal(second[0].slice, null);
  assert.deepEqual(second[0].trigger.freshPorts, ['fix'], 'only the loop port is fresh, so no composite');
  assert.equal(h.calls.filter((c) => c.call === 'expand').length, 1, 'the decomposition is expanded exactly once');
  assert.equal(
    h.starts().filter((e) => e.kind === 'task').length, 4,
    'no second wave of sub-executions',
  );
});

test('an empty or malformed decomposition runs ONE normal execution with the expands input unbound', async () => {
  const h = harness({ template: DECOMP, ports, phases: [], script: reviewScript() });
  assert.equal(await h.scheduler.run(), 'done');

  assert.deepEqual(h.execSeq(), [
    'n_task c1', 'n_plan c1', 'n_dec c1', 'n_impl c1', 'n_review c1', 'n_impl c2', 'n_review c2', 'n_end c1',
  ], 'no task rows at all');
  const first = h.runsFor('n_impl')[0];
  assert.equal(first.bindings.task, undefined, 'the expands input is left UNBOUND');
  assert.equal(first.trigger.freshPorts.includes('task'), false, 'so its directive cannot render either');
  assert.ok(first.bindings.plan, 'the rest of the bindings are untouched');
});

test('a sibling failure aborts the rest of its phase and errors the run', async () => {
  const seen = [];
  const h = harness({
    template: DECOMP,
    ports,
    script: {
      n_impl: async (args) => {
        if (!args.slice) return {};
        seen.push(args.slice.id);
        if (args.slice.id === 'p1t1') throw new Error('slice blew up');
        await new Promise((resolve, reject) => {
          if (args.signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          args.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
        return {};
      },
      n_review: async () => ({ verdict: CLEAN }),
    },
  });
  assert.equal(await h.scheduler.run(), 'error');
  assert.deepEqual(seen, ['p1t1', 'p1t2'], 'phase 2 never starts');
  const errored = h.events.find((e) => e.name === 'exec' && e.status === 'error' && e.kind === 'cycle');
  assert.equal(errored.nodeId, 'n_impl');
  assert.match(errored.error, /phase 1/);
  assert.match(errored.error, /Slice one/);
  assert.equal(h.calls.some((c) => c.call === 'finish'), false, 'a failed composite never publishes');
});

// ── 3. custom x custom: zero builtin coupling ─────────────────────────────────

test('custom producer -> custom consumer: the SAME 2x2 composite, under the custom node', async () => {
  const customPorts = portsFnFor(CUSTOM_TABLE);
  const h = harness({ template: CUSTOM_DECOMP, ports: customPorts, script: {} });
  assert.equal(await h.scheduler.run(), 'done');

  assert.deepEqual(h.execSeq(), [
    'n_task c1', 'n_slice c1',
    'n_build c1',
    'n_build t:p1t1', 'n_build t:p1t2', 'n_build t:p2t1', 'n_build t:p2t2',
    'n_end c1',
  ], 'the composite path never names a builtin key');

  const slices = h.runsFor('n_build').filter((c) => c.slice);
  assert.equal(slices.length, 4);
  for (const c of slices) {
    assert.equal(c.bindings.slice.type, 'md', 'the custom expands port binds the task file');
    assert.ok(c.trigger.freshPorts.includes('slice'));
    assert.ok(c.bindings.brief, 'the custom latched input survives');
  }
  assert.equal(h.tokensFrom('n_build', 'built').length, 1, 'the custom node publishes exactly once');
  assert.equal(h.calls.filter((c) => c.call === 'finish').length, 1);
});

// ── 4. end-to-end: the guard is gone and the seeded decomposer templates run ──

const prevHome = process.env.WORCA_HOME;
let home;
let proj;

beforeEach(async () => {
  _resetForTests();
  home = await mkdtemp(join(tmpdir(), 'worca-cc-decomp-home-'));
  process.env.WORCA_HOME = home;
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-decomp-proj-'));
  await writeFile(join(proj, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: proj });
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: proj });
});

afterEach(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME;
  else process.env.WORCA_HOME = prevHome;
  for (const d of [home, proj]) if (d) await rm(d, { recursive: true, force: true });
  home = undefined;
  proj = undefined;
});

after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

/** The mock decomposer writes 2 phases — p1t1 + p1t2, then p2t1. */
const MOCK_TASK_IDS = ['p1t1', 'p1t2', 'p2t1'];

test('wf_full runs clean under mock: the temporary wired-expands guard is gone', async () => {
  const seed = SEED_TEMPLATES.find((t) => t.id === 'wf_full');
  await writeWorkflow(structuredClone(seed));
  const orch = createOrchestrator({
    projectDir: proj, prompt: 'demo decompose', workflowId: 'wf_full', auto: true, claude: { mock: true },
  });
  const execs = [];
  orch.on('exec', (e) => { if (e.status === 'start') execs.push(e); });
  const res = await orch.run();
  assert.equal(res.status, 'done', 'the seed that wires the decomposer now runs to completion');

  const slices = execs.filter((e) => e.kind === 'task');
  assert.deepEqual(slices.map((e) => e.taskId), MOCK_TASK_IDS);
  for (const s of slices) {
    assert.equal(s.nodeId, 'n_impl');
    assert.equal(s.agentKey, 'implementer');
  }
  assert.deepEqual(
    slices.map((e) => e.executionId),
    MOCK_TASK_IDS.map((id) => `x:n_impl:1:${id}`),
  );

  // The status plumbing _persistDecomposition used to own, stamped with EXECUTION
  // ids — never the v1 `s_impl_*` synthetic node ids.
  const pipelineId = orch.getState().id;
  assert.deepEqual(
    listPhases(pipelineId).map((p) => `${p.ordinal}:${p.status}`),
    ['1:done', '2:done'],
  );
  const tasks = listTasks(pipelineId);
  assert.deepEqual(tasks.map((t) => `${t.id}:${t.status}`), MOCK_TASK_IDS.map((id) => `${id}:done`));
  for (const t of tasks) {
    assert.match(t.nodeId, /^x:n_impl:1:/, 'the task row carries the sub-execution id');
    assert.equal(t.nodeId.startsWith('s_impl_'), false, 'never a v1 synthetic node id');
  }

  // Every slice recorded its own step row; the composite shell spawned nothing.
  const steps = orch.getState().steps;
  for (const id of MOCK_TASK_IDS) {
    assert.ok(steps.find((s) => s.key === `x:n_impl:1:${id}`), `step row for ${id}`);
  }
  assert.equal(steps.find((s) => s.key === 'x:n_impl:1'), undefined, 'the composite shell is a $0 engine row');
});

test('end-to-end custom x custom: a user producer expands a user consumer', async () => {
  const agents = join(home, '.worca-cc', 'agents');
  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, 'slicer.md'), '# Slicer\n\nYou split briefs into slices.\n');
  await writeFile(join(agents, 'slicer.meta.json'), JSON.stringify({
    metaVersion: 2,
    key: 'slicer', displayName: 'Slicer', description: 'splits the brief',
    color: 'green', icon: '<p/>', agentFile: 'slicer.md', runnerType: 'producer', order: 30,
    inputs: [{ id: 'brief', type: 'md' }],
    outputs: [{ id: 'slices', type: 'json', filename: 'slices.json' }],
  }));
  await writeFile(join(agents, 'builder.md'), '# Builder\n\nYou build one slice.\n');
  await writeFile(join(agents, 'builder.meta.json'), JSON.stringify({
    metaVersion: 2,
    key: 'builder', displayName: 'Builder', description: 'builds a slice',
    color: 'blue', icon: '<p/>', agentFile: 'builder.md', runnerType: 'producer',
    order: 31, sideEffect: 'code',
    inputs: [
      { id: 'brief', type: 'md' },
      { id: 'slice', type: 'json', required: false, expands: true, directive: 'Build exactly this slice.' },
    ],
    outputs: [{ id: 'built', type: 'void' }],
  }));

  const saved = structuredClone(CUSTOM_DECOMP);
  delete saved.id;                                  // let the store mint one
  const wf = await writeWorkflow(saved);
  const orch = createOrchestrator({
    projectDir: proj, prompt: 'demo custom expands', workflowId: wf.id, auto: true, claude: { mock: true },
  });
  const execs = [];
  orch.on('exec', (e) => { if (e.status === 'start') execs.push(e); });
  const res = await orch.run();
  assert.equal(res.status, 'done', 'an all-custom expands graph completes offline');

  const slices = execs.filter((e) => e.kind === 'task');
  assert.deepEqual(slices.map((e) => e.taskId), MOCK_TASK_IDS,
    'the graph-derived mock role made the custom producer a decomposer — no key table');
  for (const s of slices) {
    assert.equal(s.nodeId, 'n_build', 'the composite runs under the CUSTOM consumer');
    assert.equal(s.agentKey, 'builder');
  }
  assert.equal(
    execs.filter((e) => e.nodeId === 'n_build' && e.kind === 'cycle').length, 1,
    'exactly one composite execution of the custom node',
  );
  assert.deepEqual(
    listTasks(orch.getState().id).map((t) => t.status), ['done', 'done', 'done'],
  );
});
