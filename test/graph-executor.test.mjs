// test/graph-executor.test.mjs
// The executor's PURE surface: filename allocation from sidecar templates, the
// "## Ports (this run)" block and its `as` renderers, A3 mode selection, the
// decomposition document, the generic MOCK-role chain and the flow executors.
// Every fixture uses CUSTOM agent keys — no builtin name appears in this file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { posix } from './helpers/posix-path.mjs';
import {
  allocateOutputs, allocateVerdict, portIoBlock, changesInstruction, selectMode, taskSourcedPorts,
  expandsOutputPort, normalizeDecomposition, readDecomposition, resolveMockRole, readVerdict,
  runTaskExecution, runAndExecution, runOrExecution, runEndExecution, runCombineExecution, runExecution,
  buildAgentPrompt, runAgentExecution, runClarifierExecution,
} from '../src/core/graph/executor.mjs';

// `store:'project'` allocations resolve under worcaHome() — MANDATORY isolation:
// projects.mjs throws under node:test when WORCA_HOME is unset.
useTempHome(after);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

const pipelineDir = tmp('worca-exec-pipe-');
const projectDir = tmp('worca-exec-proj-');

function runCtx(over = {}) {
  let v = 0;
  return {
    pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
    workspaceKey: null, duplicateKey: false, slice: null,
    planVersion: () => { v += 1; return v; },
    ...over,
  };
}

const node = (id = 'n_x', over = {}) => ({ id, kind: 'agent', key: 'custom', x: 0, y: 0, config: {}, ...over });

const REFINER_LIKE = {
  inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'revise', type: 'md', loop: true }],
  outputs: [
    { id: 'plan', type: 'md', when: 'clean', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' },
    { id: 'revise', type: 'md', when: 'blocking', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' },
  ],
  verdict: { filename: 'refine-review-cycle{cycle}.json' },
};

test('1 allocation: one resolution per DISTINCT template, one plan-version tick', () => {
  const rc = runCtx();
  const out = allocateOutputs({ node: node(), ports: REFINER_LIKE, ordinal: 2, runCtx: rc });
  assert.equal(out.plan.path, out.revise.path, 'a shared template resolves once');
  assert.match(posix(out.plan.path), /plans\/01-01-26-feature\.md$/, 'version 1 renders no suffix');
  assert.equal(out.plan.store, 'project');
  const second = allocateOutputs({ node: node(), ports: REFINER_LIKE, ordinal: 3, runCtx: rc });
  assert.match(posix(second.plan.path), /plans\/01-01-26-feature-v2\.md$/, 'the next execution ticks to -v2');
});

test('2 allocation: {cycle}, run store, void ports, duplicate-key and slice prefixes', () => {
  const ports = {
    outputs: [
      { id: 'review', type: 'md', when: 'blocking', filename: 'webui-review-cycle{cycle}.md', store: 'run' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
    verdict: { filename: 'webui-review-cycle{cycle}.json' },
  };
  const plain = allocateOutputs({ node: node(), ports, ordinal: 2, runCtx: runCtx() });
  assert.equal(plain.review.path, join(pipelineDir, 'webui-review-cycle2.md'));
  assert.equal(plain.pass, undefined, 'a void port allocates nothing');
  assert.equal(allocateVerdict({ node: node(), ports, ordinal: 2, runCtx: runCtx() }).path,
    join(pipelineDir, 'webui-review-cycle2.json'));
  const dup = allocateOutputs({ node: node('n_two'), ports, ordinal: 1, runCtx: runCtx({ duplicateKey: true }) });
  assert.equal(dup.review.path, join(pipelineDir, 'n_two-webui-review-cycle1.md'));
  const slice = allocateOutputs({ node: node(), ports, ordinal: 1, runCtx: runCtx({ slice: 'p1t2' }) });
  assert.equal(slice.review.path, join(pipelineDir, 'p1t2-webui-review-cycle1.md'));
  assert.equal(allocateVerdict({ node: node(), ports, ordinal: 1, runCtx: runCtx() }).path,
    join(pipelineDir, 'webui-review-cycle1.json'));
  assert.equal(allocateVerdict({ node: node(), ports: { outputs: [] }, ordinal: 1, runCtx: runCtx() }), null);
  const review = allocateOutputs({
    node: node(),
    ports: { outputs: [{ id: 'review', type: 'md', filename: '{base}-impl-review.md', store: 'project' }] },
    ordinal: 1, runCtx: runCtx(),
  });
  assert.match(posix(review.review.path), /reviews\/01-01-26-feature-impl-review\.md$/, 'a {base}-<kind>.md project template goes to the reviews store');
});

test('2b allocation: the duplicate-key prefix reaches the PROJECT store too', () => {
  const REVIEW_LIKE = { outputs: [{ id: 'review', type: 'md', filename: '{base}-impl-review.md', store: 'project' }] };
  const PLAN_LIKE = { outputs: [{ id: 'plan', type: 'md', filename: '{base}{vsuffix}.md', store: 'project', artifactKind: 'plan' }] };
  // A SINGLE card is byte-identical to what shipped: the prefix is empty, so no
  // seed's persisted artifact path moves.
  const lone = allocateOutputs({ node: node('n_rev'), ports: REVIEW_LIKE, ordinal: 1, runCtx: runCtx() });
  assert.match(posix(lone.review.path), /reviews\/01-01-26-feature-impl-review\.md$/);
  const lonePlan = allocateOutputs({ node: node('n_ref'), ports: PLAN_LIKE, ordinal: 1, runCtx: runCtx() });
  assert.match(posix(lonePlan.plan.path), /plans\/01-01-26-feature\.md$/);
  // TWO cards on one agent key: the persisted review/plan must NOT be one file.
  const rc1 = runCtx({ duplicateKey: true });
  const rc2 = runCtx({ duplicateKey: true });
  const a = allocateOutputs({ node: node('n_rev1'), ports: REVIEW_LIKE, ordinal: 1, runCtx: rc1 });
  const b = allocateOutputs({ node: node('n_rev2'), ports: REVIEW_LIKE, ordinal: 1, runCtx: rc2 });
  assert.match(posix(a.review.path), /reviews\/01-01-26-feature-n_rev1-impl-review\.md$/);
  assert.match(posix(b.review.path), /reviews\/01-01-26-feature-n_rev2-impl-review\.md$/);
  assert.notEqual(a.review.path, b.review.path, 'two reviewer cards must not clobber one review file');
  const p1 = allocateOutputs({ node: node('n_ref1'), ports: PLAN_LIKE, ordinal: 1, runCtx: rc1 });
  const p2 = allocateOutputs({ node: node('n_ref2'), ports: PLAN_LIKE, ordinal: 1, runCtx: rc2 });
  assert.match(posix(p1.plan.path), /plans\/01-01-26-n_ref1-feature\.md$/);
  assert.match(posix(p2.plan.path), /plans\/01-01-26-n_ref2-feature\.md$/);
  assert.notEqual(p1.plan.path, p2.plan.path, 'two planner cards must not clobber one plan file');
  // The -vN linkage still hangs off the node's OWN family.
  const p1v2 = allocateOutputs({ node: node('n_ref1'), ports: PLAN_LIKE, ordinal: 2, runCtx: rc1 });
  assert.match(posix(p1v2.plan.path), /plans\/01-01-26-n_ref1-feature-v2\.md$/);
  // A composite slice discriminates the same way (a project-store output on an
  // `expands` consumer would otherwise collapse every parallel task onto one file).
  const sliced = allocateOutputs({ node: node('n_rev'), ports: REVIEW_LIKE, ordinal: 1, runCtx: runCtx({ slice: 'p1t2' }) });
  assert.match(posix(sliced.review.path), /reviews\/01-01-26-feature-p1t2-impl-review\.md$/);
});

test('3 the Ports block: `as` renderers, the await port, shared paths, placeholders; changesInstruction', () => {
  const ports = {
    inputs: [
      { id: 'plan', type: 'md', required: true },
      { id: 'answers', type: 'json', as: 'answers' },
      { id: 'fix', type: 'md', as: 'fix-review', loop: true },
      { id: 'done', type: 'void', as: 'worktree' },
      { id: 'await', type: 'any', required: false, synthetic: true },
    ],
    outputs: REFINER_LIKE.outputs,
  };
  const bindings = {
    plan: { type: 'md', path: '/abs/plan.md' },
    answers: { type: 'json', path: '/abs/clarify.json' },
    fix: { type: 'md', path: '/abs/review.md' },
    done: { type: 'void' },
    // A PAYLOAD-bearing gate token: the scheduler never binds one (its payload is
    // discarded at bind), so only the explicit AWAIT guard keeps it off the block.
    await: { type: 'md', path: '/abs/gate.md' },
  };
  const outputs = allocateOutputs({ node: node(), ports, ordinal: 1, runCtx: runCtx() });
  const block = portIoBlock({
    node: node(), ports, bindings, outputs,
    verdict: { path: join(pipelineDir, 'refine-review-cycle1.json') },
    ctx: { checkpointRef: 'abc1234' },
  });
  assert.ok(block.startsWith('## Ports (this run)\n\n### Inputs\n\n'));
  assert.ok(block.includes('- **plan** (md) -> /abs/plan.md'));
  assert.ok(block.includes('- **answers** (json) -> /abs/clarify.json (the clarifying questions and the answers already given)'));
  assert.ok(block.includes('- **fix** (md) -> /abs/review.md (the review to address — fix EVERY critical and major issue)'));
  assert.ok(block.includes('- **done** (void) -> Inspect the diff with `git diff abc1234`'), 'the worktree arm is the v1 reviewer sentence');
  assert.ok(!block.includes('**await**'), 'the synthesized gate is never listed');
  assert.ok(block.includes(`- Write **plan** (also **revise**) to: ${outputs.plan.path}`), 'shared paths collapse to ONE line');
  assert.ok(block.includes(`- Write the **verdict** JSON (machine-readable) to: ${join(pipelineDir, 'refine-review-cycle1.json')}`));
  const empty = portIoBlock({ node: node(), ports: { inputs: [], outputs: [] }, bindings: {}, outputs: {}, ctx: {} });
  assert.ok(empty.includes('- (none — work from the request above)'));
  assert.ok(empty.includes('- (none — report your findings as your final message)'));
  // The `{diffInstruction}` hint token is the CHANGES-INSPECTION fragment (v1
  // phases.mjs:1076-1084), NOT the reviewer sentence: two different v1 byte sets.
  assert.equal(changesInstruction({ checkpointRef: 'abc1234' }), 'via `git diff` in your cwd');
  assert.equal(
    changesInstruction({
      runRoot: '/run/root',
      workspace: { projects: [{ projectKey: 'api', projectName: 'API', worktreeDir: '/run/root/repos/api', checkpointRef: 'aaa1' }] },
    }),
    'in EVERY member checkout — your cwd is the worca-cc run root, not a repository, so ' +
    'inspect each member on its own:\n\n- **API**: `git -C repos/api diff aaa1`\n\n',
  );
});

test('4 A3: only the FIRST fresh directive port in DECLARED order selects the mode', () => {
  const ports = {
    inputs: [
      { id: 'fix', type: 'md', loop: true, directive: 'FIX ARM' },
      { id: 'task', type: 'json', expands: true, directive: 'SLICE ARM' },
      { id: 'plan', type: 'md', required: true, directive: 'IMPLEMENT ARM' },
      { id: 'await', type: 'any', synthetic: true },
    ],
  };
  const bindings = {
    fix: { type: 'md', path: '/abs/r.md' }, task: { type: 'json', path: '/abs/d.json' },
    plan: { type: 'md', path: '/abs/p.md' }, await: { type: 'void' },
  };
  assert.equal(selectMode({ ports, bindings, freshPorts: ['fix', 'plan'] }).mode, 'fix', 'fix beats plan');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['task', 'plan'] }).mode, 'task', 'task beats plan');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['plan'] }).mode, 'plan');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['plan'] }).directives.length, 1, 'ONE directive renders');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['fix', 'plan'] }).directives.length, 1,
    'still ONE with two fresh directive ports — the first in declared order');
  assert.equal(selectMode({ ports, bindings, freshPorts: ['await'] }).mode, null, 'the gate selects nothing');
  assert.equal(selectMode({ ports, bindings, freshPorts: [] }).mode, null, 'a LATCHED loop token never selects');
  assert.equal(selectMode({ ports, bindings }).mode, 'fix', 'no freshPorts ⇒ first executions treat every bound port as fresh');
});

test('5 graph-derived facts: task-sourced ports and the expands consumer', () => {
  const tpl = {
    nodes: [{ id: 'n_task', kind: 'task' }, { id: 'n_a', kind: 'agent', key: 'a' }, { id: 'n_b', kind: 'agent', key: 'b' }],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
      { id: 'w2', from: { node: 'n_a', port: 'tasks' }, to: { node: 'n_b', port: 'task' } },
    ],
  };
  const portsFn = (n) => (n.id === 'n_b'
    ? { inputs: [{ id: 'task', type: 'json', expands: true }], outputs: [] }
    : { inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'tasks', type: 'json' }] });
  assert.deepEqual([...taskSourcedPorts(tpl, 'n_a')], ['task']);
  assert.deepEqual([...taskSourcedPorts(tpl, 'n_b')], [], 'only a kind:task source counts');
  assert.equal(expandsOutputPort(tpl, portsFn, 'n_a'), 'tasks');
  assert.equal(expandsOutputPort(tpl, portsFn, 'n_b'), null);
});

test('6 the decomposition document parses tolerantly and sorts by ordinal', async () => {
  assert.deepEqual(normalizeDecomposition(null), { phases: [] });
  assert.deepEqual(normalizeDecomposition({ phases: 'nope' }), { phases: [] });
  const d = normalizeDecomposition({
    phases: [
      { ordinal: 2, tasks: [{ id: 'p2t1', file: 'tasks/b.md' }] },
      { ordinal: 'x', tasks: [{ id: 'bad', file: 'x.md' }] },
      { ordinal: 3, tasks: [{ id: 'nofile' }] },
      { ordinal: 1, tasks: [{ id: 'p1t1', title: 'One', file: 'tasks/a.md' }, { file: 'noid.md' }] },
    ],
  });
  assert.deepEqual(d.phases.map((p) => p.ordinal), [1, 2], 'unusable phases are dropped, the rest sorted');
  assert.deepEqual(d.phases[0].tasks, [{ id: 'p1t1', title: 'One', file: 'tasks/a.md' }]);
  assert.deepEqual(d.phases[1].tasks[0], { id: 'p2t1', title: null, file: 'tasks/b.md' });
  assert.deepEqual(await readDecomposition(join(pipelineDir, 'nope.json')), { phases: [] });
  assert.deepEqual(await readDecomposition(null), { phases: [] });
  const p = join(pipelineDir, 'decomposition.json');
  writeFileSync(p, '{ not json', 'utf8');
  assert.deepEqual(await readDecomposition(p), { phases: [] }, 'malformed reads as nothing to fan out');
});

test('7 the MOCK role chain is graph-derived, never keyed on an agent name', () => {
  assert.equal(resolveMockRole({ meta: { mockRole: 'refiner' } }), 'refiner', '1. a validated declaration wins');
  assert.equal(resolveMockRole({ meta: { mockRole: 'not-a-writer-role', runnerType: 'producer' } }), 'generic-producer',
    'an unknown declaration is ignored');
  assert.equal(resolveMockRole({ meta: { runnerType: 'clarifier' } }), 'clarify', '2. clarifier');
  assert.equal(resolveMockRole({ meta: { runnerType: 'producer' }, expandsPort: 'tasks' }), 'decomposer',
    '3. an output wired into an expands input');
  assert.equal(resolveMockRole({ meta: { runnerType: 'verifier', verdict: { filename: 'v.json' } } }), 'generic-verifier',
    '4. a declared verdict');
  assert.equal(resolveMockRole({ meta: { runnerType: 'producer' } }), 'generic-producer', '5. the fallback');
});

test('8 readVerdict: a MISSING file is a clean pass (flagged); a PRESENT broken one throws', async () => {
  // v1 parity: a verifier that declares a verdict and writes none is not a run
  // failure — but the caller has to be able to SAY so, hence `missing: true`.
  assert.deepEqual(await readVerdict(null), { issues: [], summary: '' });
  const gone = await readVerdict(join(pipelineDir, 'gone.json'));
  assert.deepEqual(gone.issues, []);
  assert.equal(gone.missing, true, 'the caller can distinguish "never written" from "approved"');
  const v = join(pipelineDir, 'v.json');
  writeFileSync(v, JSON.stringify({ issues: [{ severity: 'critical', title: 'x' }], summary: 's' }), 'utf8');
  const good = await readVerdict(v);
  assert.equal(good.issues.length, 1);
  assert.equal(good.missing, undefined, 'a real verdict carries no flag');
  const clean = join(pipelineDir, 'clean.json');
  writeFileSync(clean, JSON.stringify({ issues: [], summary: 'ok' }), 'utf8');
  assert.deepEqual(await readVerdict(clean), { issues: [], summary: 'ok' });
  // A file that EXISTS but is not a review is the verifier writing garbage — it is
  // indistinguishable from an approval on every shipped seed (the clean side is
  // wired straight to End), so it must fail the execution instead.
  const bad = join(pipelineDir, 'bad.json');
  writeFileSync(bad, 'not json at all', 'utf8');
  await assert.rejects(() => readVerdict(bad), (e) => {
    assert.equal(e.message, `verdict file is not a review JSON: ${bad} — expected { "issues": [ … ] }`);
    assert.equal(e.code, 'BAD_VERDICT');
    return true;
  });
  const shapeless = join(pipelineDir, 'shapeless.json');
  writeFileSync(shapeless, '{}', 'utf8');
  await assert.rejects(() => readVerdict(shapeless), /verdict file is not a review JSON/);
  const notArray = join(pipelineDir, 'notarray.json');
  writeFileSync(notArray, JSON.stringify({ issues: 'boom' }), 'utf8');
  await assert.rejects(() => readVerdict(notArray), /verdict file is not a review JSON/);
});

test('8b a verifier that never wrote its verdict warns, naming the node and the file', async () => {
  // A verifier that exits 0 without writing its JSON (truncated context, wrong path,
  // a denied tool) is indistinguishable from an approval — and on every shipped seed
  // the clean side is wired straight to End. Parity keeps it a pass, but it is now a
  // LOUD one: the warning rides the result and the scheduler logs it.
  const nodeObj = { id: 'n_c', kind: 'agent', key: 'custom', config: {}, agentPrompt: 'You are custom.', tools: [] };
  // A declared mockRole of 'generic-producer' makes the offline writer skip the
  // verdict JSON while the PORTS still declare one: the file never appears.
  const meta = { ...CUSTOM, mockRole: 'generic-producer' };
  const c = ctx8({ node: nodeObj, meta, ports: meta });
  const r = await runAgentExecution(c);
  assert.deepEqual(r.verdict.issues, [], 'a missing verdict still routes the CLEAN side (v1 parity)');
  assert.deepEqual(r.warnings, ['verdict file missing: n_c custom-review-cycle2.json — treated as clean']);
  // And the happy path carries no warning at all.
  const ok = await runAgentExecution(ctx8());
  assert.deepEqual(ok.warnings, []);
});

test('8c a verdict file that EXISTS but is garbage fails the execution', async () => {
  const nodeObj = { id: 'n_c', kind: 'agent', key: 'custom', config: {}, agentPrompt: 'You are custom.', tools: [] };
  const meta = { ...CUSTOM, mockRole: 'generic-producer' };   // the mock writes no verdict…
  const c = ctx8({ node: nodeObj, meta, ports: meta });
  writeFileSync(c.verdict.path, '{"issues": [ truncated', 'utf8');   // …the agent wrote a truncated one
  await assert.rejects(() => runAgentExecution(c), (e) => {
    assert.equal(e.code, 'BAD_VERDICT');
    assert.equal(e.message, `verdict file is not a review JSON: ${c.verdict.path} — expected { "issues": [ … ] }`);
    return true;
  });
});

// ── flow executors ───────────────────────────────────────────────────────────

test('9 the Task card: a given path passes through, given text is written, neither throws', () => {
  const given = runTaskExecution({ node: { id: 'n_task', kind: 'task', config: {} }, taskArtifact: { path: '/abs/task.md' }, runCtx: runCtx() });
  assert.deepEqual(given, { outputs: { task: { path: '/abs/task.md' } } });
  const written = runTaskExecution({ node: { id: 'n_task', kind: 'task', config: {} }, taskArtifact: { text: '# Build it\n' }, runCtx: runCtx() });
  assert.equal(written.outputs.task.path, join(pipelineDir, 'task.md'));
  assert.equal(readFileSync(join(pipelineDir, 'task.md'), 'utf8'), '# Build it\n');
  assert.throws(
    () => runTaskExecution({ node: { id: 'n_task', kind: 'task', config: {} }, taskArtifact: null, runCtx: runCtx() }),
    /task node "n_task": no task artifact/,
  );
});

test('10 A2 planStoreSeed: the document lands in the plans store and consumes version 1', () => {
  const rc = runCtx();
  const res = runTaskExecution({
    node: { id: 'n_task', kind: 'task', config: { planStoreSeed: true } },
    taskArtifact: { text: '# Provided plan\n' }, runCtx: rc,
  });
  assert.match(posix(res.outputs.task.path), /plans\/01-01-26-feature\.md$/, 'version 1, no suffix');
  assert.equal(readFileSync(res.outputs.task.path, 'utf8'), '# Provided plan\n');
  const next = allocateOutputs({ node: node(), ports: REFINER_LIKE, ordinal: 1, runCtx: rc });
  assert.match(posix(next.plan.path), /-v2\.md$/, 'the counter was consumed at 1');
});

test('11 AND is a void synchronizer, OR forwards the bound payload, End echoes the result', () => {
  assert.deepEqual(runAndExecution({ node: { id: 'n_and', kind: 'and' }, bindings: { in1: { type: 'md', path: '/a.md' } } }),
    { outputs: { out: {} } });
  assert.deepEqual(runOrExecution({ node: { id: 'n_or', kind: 'or' }, bindings: { in2: { type: 'md', path: '/b.md' } } }),
    { outputs: { out: { type: 'md', path: '/b.md', value: null } } });
  assert.deepEqual(runOrExecution({ node: { id: 'n_or', kind: 'or' }, bindings: {} }), { outputs: { out: {} } });
  assert.deepEqual(runEndExecution({ node: { id: 'n_end', kind: 'end' }, bindings: { result: { type: 'md', path: '/r.md' } } }),
    { result: { type: 'md', path: '/r.md', value: null } });
  assert.deepEqual(runEndExecution({ node: { id: 'n_end', kind: 'end' }, bindings: {} }),
    { result: { type: 'void', path: null, value: null } });
});

test('12 Combine concatenates in numeric port order under `## From <node name>` headings', async () => {
  const a = join(pipelineDir, 'a.md'); const b = join(pipelineDir, 'b.md');
  writeFileSync(a, 'AAA\n', 'utf8'); writeFileSync(b, 'BBB\n', 'utf8');
  const res = await runCombineExecution({
    node: { id: 'n_comb', kind: 'combine', config: { arity: 10 } },
    bindings: { in10: { type: 'md', path: b }, in2: { type: 'md', path: a }, in1: { type: 'md', value: 'INLINE' } },
    names: { in1: 'Planner', in2: 'Refiner' },
    ordinal: 1, runCtx: runCtx(),
  });
  assert.equal(res.outputs.out.path, join(pipelineDir, 'combine-n_comb-c1.md'));
  const text = readFileSync(res.outputs.out.path, 'utf8');
  assert.deepEqual(text.match(/^## From .*$/gm), ['## From Planner', '## From Refiner', '## From in10'],
    'in2 before in10, and an unnamed port falls back to its id');
  assert.ok(text.indexOf('INLINE') < text.indexOf('AAA') && text.indexOf('AAA') < text.indexOf('BBB'));
});

test('13 runExecution selects by kind, then by runnerType, and honors the injected seam', async () => {
  const calls = [];
  const runners = { producer: async (c) => { calls.push(c.node.id); return { outputs: {}, seam: true }; } };
  const agent = { id: 'n_a', kind: 'agent', key: 'custom', config: {} };
  const res = await runExecution({ node: agent, meta: { runnerType: 'producer' }, ports: {}, runCtx: runCtx() }, { runners });
  assert.equal(res.seam, true, 'the injected runner wins');
  assert.deepEqual(calls, ['n_a']);
  assert.deepEqual(await runExecution({ node: { id: 'n_or', kind: 'or' }, bindings: { in1: { type: 'md', path: '/x.md' } } }),
    { outputs: { out: { type: 'md', path: '/x.md', value: null } } });
  await assert.rejects(
    async () => runExecution({ node: { id: 'n_z', kind: 'wat' } }),
    /node "n_z": unknown kind "wat"/,
  );
});

// ── prompt assembly and the spawning executors ───────────────────────────────

const CUSTOM = {
  displayName: 'Custom Agent',
  runnerType: 'verifier',
  promptHints: 'Read {pipelineDir}/notes.md at cycle {cycle}. Changes are {diffInstruction}.',
  workspaceStrategy: null,
  verdict: { filename: 'custom-review-cycle{cycle}.json' },
  mockRole: 'generic-verifier',
  inputs: [
    { id: 'fix', type: 'md', loop: true, as: 'fix-review', directive: 'FIX ARM' },
    { id: 'plan', type: 'md', required: true, directive: 'PLAN ARM' },
    { id: 'await', type: 'any', synthetic: true },
  ],
  outputs: [
    { id: 'review', type: 'md', when: 'blocking', filename: 'custom-review-cycle{cycle}.md', store: 'run' },
    { id: 'pass', type: 'void', when: 'clean' },
  ],
};

const TPL8 = {
  id: 'wf_8', name: 'T', version: 2, domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task' }, { id: 'n_c', kind: 'agent', key: 'custom' }],
  wires: [],
};

function ctx8(over = {}) {
  const nodeObj = { id: 'n_c', kind: 'agent', key: 'custom', config: {}, fanOut: false, agentPrompt: 'You are custom.', tools: [] };
  const rc = runCtx();
  const bindings = { plan: { type: 'md', path: '/abs/plan.md' } };
  return {
    node: nodeObj, nodeId: 'n_c', executionId: 'x:n_c:2', ordinal: 2, cycle: 2,
    template: TPL8, ports: CUSTOM, meta: CUSTOM, bindings,
    trigger: { wireIds: [], freshPorts: ['plan'] },
    outputs: allocateOutputs({ node: nodeObj, ports: CUSTOM, ordinal: 2, runCtx: rc }),
    verdict: allocateVerdict({ node: nodeObj, ports: CUSTOM, ordinal: 2, runCtx: rc }),
    expandsPort: null, runCtx: rc, priorAnswers: [],
    projectDir, pipelineDir, taskPrompt: 'BUILD IT', toolInstruction: 'TOOLS', extras: [],
    checkpointRef: 'abc1234', workspace: null, agentPrompts: {}, claudeOpts: { mock: true },
    ...over,
  };
}

test('14 buildAgentPrompt assembles the blocks in the documented order', () => {
  const p = buildAgentPrompt(ctx8());
  const at = (s) => { const i = p.indexOf(s); assert.notEqual(i, -1, `missing: ${s}`); return i; };
  assert.ok(p.startsWith('# Task: Custom Agent\n\n'));
  assert.ok(at('## What to do') < at('You are a verifier.'));
  assert.ok(at('You are a verifier.') < at('Read ' + pipelineDir + '/notes.md at cycle 2.'));
  assert.ok(at('at cycle 2.') < at('Mode: plan'));
  assert.ok(at('Mode: plan') < at('## Ports (this run)'));
  assert.ok(at('PLAN ARM') < at('## Ports (this run)'));
  assert.ok(!p.includes('FIX ARM'), 'A3: the latched loop directive never renders');
  assert.ok(at('## Ports (this run)') < at('The review JSON shape is'));
  assert.ok(at('The review JSON shape is') < at('MOCK_ROLE: generic-verifier'));
  assert.ok(!p.includes('Write each task file under:'), 'no expands consumer ⇒ no decomposition contract');
  assert.ok(!p.includes('MOCK_STRATEGY'), 'a dead marker is never emitted');
  assert.ok(p.includes('MOCK_CYCLE: 2'));
  assert.ok(p.includes(`MOCK_JSON: ${join(pipelineDir, 'custom-review-cycle2.json')}`));
  assert.ok(p.includes(`MOCK_OUT: ${join(pipelineDir, 'custom-review-cycle2.md')}`));
  assert.ok(p.includes('MOCK_IN: /abs/plan.md'));
});

test('15 prompt hints substitute {pipelineDir}, {cycle} and {diffInstruction}; the decomposition contract renders for an expands producer', () => {
  const p = buildAgentPrompt(ctx8());
  assert.ok(p.includes(`Read ${pipelineDir}/notes.md at cycle 2. Changes are via \`git diff\` in your cwd.`),
    '{diffInstruction} is the changes-inspection FRAGMENT, not the reviewer sentence');
  assert.ok(!p.includes('Inspect the diff with'), 'the reviewer sentence belongs to as:worktree only');
  const detached = buildAgentPrompt(ctx8({
    runRoot: '/run/root',
    workspace: { projects: [{ projectKey: 'api', projectName: 'API', worktreeDir: '/run/root/repos/api', checkpointRef: 'aaa1' }] },
  }));
  assert.ok(detached.includes('Changes are in EVERY member checkout — your cwd is the worca-cc run root, not a repository, so inspect each member on its own:\n\n- **API**: `git -C repos/api diff aaa1`\n\n.'),
    'the detached workspace variant');
  const producer = buildAgentPrompt(ctx8({
    meta: { ...CUSTOM, runnerType: 'producer', verdict: undefined, mockRole: undefined },
    ports: { ...CUSTOM, verdict: undefined, outputs: [{ id: 'tasks', type: 'json', filename: 'split.json', store: 'run' }] },
    outputs: { tasks: { path: join(pipelineDir, 'split.json'), store: 'run' } }, verdict: null,
    expandsPort: 'tasks',
  }));
  assert.ok(producer.includes(`Write each task file under: ${join(pipelineDir, 'tasks')}/ (name them p<phase>-t<n>-<kebab-title>.md)`));
  assert.ok(producer.includes('The manifest shape is { "phases": [ { "ordinal", "tasks": [ { "id", "title", "file" } ] } ] }. Use id "p<ordinal>t<n>" and a pipeline-dir-relative "file" path.'));
  assert.ok(producer.includes('MOCK_ROLE: decomposer'), 'the chain resolves the expands producer to the decomposer writer');
  assert.ok(producer.includes(`MOCK_TASKS_DIR: ${join(pipelineDir, 'tasks')}`));
});

test('16 a composite slice renders the shared-working-tree block', () => {
  const p = buildAgentPrompt(ctx8({
    slice: { id: 'p1t1', title: 'One', phase: 1, path: '/abs/t1.md', index: 0, siblings: [{ id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md' }] },
  }));
  assert.ok(p.includes('## Parallel siblings — shared working tree'));
  assert.ok(p.includes('- p1t2 "Two" (tasks/p1-t2.md)'));
  assert.ok(p.indexOf('## Parallel siblings') < p.indexOf('## Ports (this run)'));
  assert.ok(!buildAgentPrompt(ctx8()).includes('## Parallel siblings'), 'and nothing when solo');
  const solo = buildAgentPrompt(ctx8({ slice: { id: 'p2t1', title: 'Three', phase: 2, path: '/abs/t3.md', index: 0, siblings: [] } }));
  assert.ok(!solo.includes('## Parallel siblings'));
  assert.ok(!solo.includes('\n\n\n\n'), 'a solo slice adds no stray blank line');
});

test('17 runAgentExecution spawns through runOpts, returns the same prompt it built, and captures the session id', async () => {
  const c = ctx8();
  const r = await runAgentExecution(c);
  assert.equal(r.prompt, buildAgentPrompt(c), 'the round trip is byte-identical');
  assert.deepEqual(Object.keys(r.outputs).sort(), ['pass', 'review'], 'every declared port is publishable');
  assert.equal(r.outputs.review.path, join(pipelineDir, 'custom-review-cycle2.md'));
  assert.deepEqual(r.outputs.pass, {}, 'a void port publishes an empty payload');
  assert.ok(Array.isArray(r.verdict.issues), 'the verdict JSON is read back');
  assert.ok(r.summary.length > 0);
  assert.match(r.sessionId, /^mock-session-/, 'the session id comes from the session event, not the resolved value');
});

test('18 runClarifierExecution gates the human and rewrites the file as {questions, answers}', async () => {
  const asked = [];
  const meta = {
    displayName: 'Ask First', runnerType: 'clarifier', mockRole: 'clarify', promptHints: '',
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'await', type: 'any', synthetic: true }],
    outputs: [{ id: 'answers', type: 'json', when: 'always', filename: 'clarify.json', store: 'run', artifactKind: 'clarify' }],
  };
  const nodeObj = { id: 'n_ask', kind: 'agent', key: 'asker', config: {}, agentPrompt: 'You ask.', tools: [] };
  const rc = runCtx();
  const c = {
    node: nodeObj, nodeId: 'n_ask', executionId: 'x:n_ask:1', ordinal: 1, cycle: 1,
    template: TPL8, ports: meta, meta, bindings: { task: { type: 'md', path: '/abs/task.md' } },
    trigger: { freshPorts: ['task'] }, runCtx: rc, priorAnswers: [],
    outputs: allocateOutputs({ node: nodeObj, ports: meta, ordinal: 1, runCtx: rc }),
    verdict: null, projectDir, pipelineDir, taskPrompt: 'BUILD IT', toolInstruction: 'T',
    extras: [], workspace: null, agentPrompts: {}, claudeOpts: { mock: true },
    ask: async (a) => { asked.push(a); return { answers: [{ id: a.questions[0].id, choice: 'Option A' }] }; },
  };
  const r = await runClarifierExecution(c);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].id, 'clarify-n_ask-1', 'the ask id is nodeId-scoped');
  assert.equal(asked[0].kind, 'clarify');
  assert.equal(asked[0].nodeId, 'n_ask');
  assert.equal(asked[0].agent, 'Ask First');
  assert.ok(asked[0].questions.length >= 1);
  const written = JSON.parse(readFileSync(join(pipelineDir, 'clarify.json'), 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), ['answers', 'questions']);
  assert.equal(written.answers[0].choice, 'Option A');
  assert.ok(written.answers[0].question.length > 0, 'each answer carries its question text');
  assert.equal(written.answers.length, written.questions.length, 'an unanswered question falls back to its first option');
  assert.equal(r.outputs.answers.path, join(pipelineDir, 'clarify.json'));
  assert.ok(r.prompt.includes('MOCK_PRIOR: 0'));
  assert.ok(r.prompt.includes('Identify the decisions you cannot safely resolve from the task text or the real codebase'));
  assert.match(r.sessionId, /^mock-session-/);
  // Non-interactive (no ctx.ask): the executor owns the default — every question falls
  // back to its first option, and the file is still rewritten as {questions, answers}.
  const { ask, ...noAsk } = c;                                   // eslint-disable-line no-unused-vars
  const r2 = await runClarifierExecution(noAsk);
  assert.equal(r2.answers.length, r2.questions.length, 'one answer per question');
  assert.ok(r2.questions.length >= 1 && r2.answers.every((a) => a.choice.length > 0), 'first-option fallback');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(pipelineDir, 'clarify.json'), 'utf8'))).sort(), ['answers', 'questions']);
});

// ── endpoint-routed nodes ────────────────────────────────────────────────────

const routedNode = (over = {}) => ({
  id: 'n_c', kind: 'agent', key: 'custom', config: {}, fanOut: true, endpointRouted: true,
  subagentModel: '', agentPrompt: 'You are custom.', tools: [], ...over,
});

test('19 a routed fan-out prompt carries the same-endpoint block, never the alias directives', () => {
  const p = buildAgentPrompt(ctx8({ node: routedNode() }));
  assert.ok(p.includes('### Sub-agent model — same endpoint as this node (locked)'));
  assert.ok(p.includes('NEVER pass a `model` parameter'));
  assert.ok(!p.includes('YOUR call, per spawn'), 'no auto rubric on a routed node');
  const pinned = buildAgentPrompt(ctx8({ node: routedNode({ subagentModel: 'sonnet' }) }));
  assert.ok(pinned.includes('### Sub-agent model — same endpoint as this node (locked)'), 'a pin degrades to the same block');
  assert.ok(!pinned.includes('pass `model: "sonnet"`'), 'the pin text never renders');
  const unrouted = buildAgentPrompt(ctx8({ node: routedNode({ endpointRouted: false }) }));
  assert.ok(unrouted.includes('YOUR call, per spawn'), 'unrouted keeps the auto default');
  // D9: a routed workspace-explore node loses the strategy block's Explore steering too.
  const wsExplore = buildAgentPrompt(ctx8({
    node: routedNode(), meta: { ...CUSTOM, workspaceStrategy: 'explore' },
    workspace: { projects: [{ projectKey: 'a' }] },
  }));
  assert.ok(!wsExplore.includes('Explore sub-agent'), 'no Explore order beside the same-endpoint block');
  assert.ok(wsExplore.includes('`general-purpose` investigator'), 'the explore arm degrades, not disappears');
});

test('20 an alias pin on a routed node warns on the execution result; auto/inherit stay silent', async () => {
  const meta = { ...CUSTOM, mockRole: 'generic-verifier' };
  const mk = (over) => ctx8({ node: routedNode(over), meta, ports: meta, claudeOpts: { mock: true, model: 'ds-stable' } });
  const pinned = await runAgentExecution(mk({ subagentModel: 'sonnet' }));
  assert.deepEqual(pinned.warnings, [
    'sub-agent model pin "sonnet" ignored: custom runs on an endpoint-routed model ("ds-stable") — children run without an explicit model',
  ]);
  const auto = await runAgentExecution(mk({ subagentModel: '' }));
  assert.deepEqual(auto.warnings, [], 'the auto default degrades silently');
  const inherit = await runAgentExecution(mk({ subagentModel: 'inherit' }));
  assert.deepEqual(inherit.warnings, [], 'inherit degrades silently');
  const unroutedPin = await runAgentExecution(mk({ subagentModel: 'sonnet', endpointRouted: false }));
  assert.deepEqual(unroutedPin.warnings, [], 'a pin on a normal model is honored, not warned');
});
