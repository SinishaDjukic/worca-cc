// test/graph-executor.test.mjs
//
// The generic execution layer (src/core/graph/executor.mjs): output allocation
// from filename templates, the "## Ports (this run)" prompt block, A3 fresh-port
// mode selection, the generic MOCK_ROLE resolution chain, the clarifier gate, and
// the five flow-node executors. Every assertion here is genericity-driven — the
// executor is keyed by node.kind + meta.runnerType and by port metadata, NEVER by
// an agent key, so the custom fixtures below exercise the same code paths the
// builtins do.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { FIXTURE_DEFAULT, FIXTURE_FLOW, FIXTURE_PORTS, portsFnFor } from '../src/core/graph/fixtures.mjs';
import { planPath, reviewPath, readStepQuestions, readClarifyRow } from '../src/core/artifacts.mjs';
import { renderPromptArtifact } from '../src/core/phases.mjs';
import { MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';
import {
  allocateOutputs,
  allocateVerdict,
  portIoBlock,
  buildAgentPrompt,
  selectMode,
  resolveMockRole,
  expandsOutputPort,
  taskSourcedPorts,
  runAgentExecution,
  runClarifierExecution,
  runAndExecution,
  runOrExecution,
  runEndExecution,
  runTaskExecution,
  runCombineExecution,
  readVerdict,
} from '../src/core/graph/executor.mjs';

useTempHome(after);

const ports = portsFnFor(FIXTURE_PORTS);
const nodeOf = (tpl, id) => tpl.nodes.find((n) => n.id === id);

const dirs = [];
async function tmpDir(prefix = 'worca-cc-exec-') {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
after(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

/** A token in the shape ports.makeToken mints. */
const tok = (over = {}) => ({
  seq: 1, type: 'md', path: null, value: null, meta: null,
  sourceExecutionId: 'e0', forced: false, ...over,
});

/**
 * The run-level allocation context. `planVersion()` is the run-global plan
 * version counter: it RETURNS the version it hands out and advances, so a
 * template carrying `{vsuffix}` consumes exactly one tick per execution.
 */
function runCtxFor({ pipelineDir, projectDir, baseName = 'feature', datePrefix = '01-01-26',
  workspaceKey = null, duplicateKey = false, start = 1 } = {}) {
  let v = start;
  return {
    pipelineDir, projectDir, baseName, datePrefix, workspaceKey, duplicateKey,
    planVersion: () => v++,
    peekVersion: () => v,
  };
}

// ── allocation ────────────────────────────────────────────────────────────────

test('allocateOutputs: a void output with no filename allocates no path', async () => {
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_impl');
  const alloc = allocateOutputs({
    node, ports: ports(node), executionId: 'x1', ordinal: 1,
    runCtx: runCtxFor({ pipelineDir, projectDir: pipelineDir }),
  });
  assert.equal(alloc.done, undefined);
  assert.deepEqual(Object.keys(alloc), []);
});

test('allocateVerdict: {cycle} renders the execution ordinal into the pipeline dir', async () => {
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_review');
  const v = allocateVerdict({
    node, ports: ports(node), ordinal: 2,
    runCtx: runCtxFor({ pipelineDir, projectDir: pipelineDir }),
  });
  assert.equal(v.path, join(pipelineDir, 'impl-review-cycle2.json'));
});

test('allocateOutputs: store project + {vsuffix} walks the run plan-version counter', async () => {
  const projectDir = await tmpDir('worca-cc-exec-proj-');
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_plan');
  const runCtx = runCtxFor({ pipelineDir, projectDir });
  const first = allocateOutputs({ node, ports: ports(node), executionId: 'x1', ordinal: 1, runCtx });
  const second = allocateOutputs({ node, ports: ports(node), executionId: 'x2', ordinal: 2, runCtx });
  assert.equal(first.plan.store, 'project');
  assert.equal(first.plan.path, planPath(projectDir, 'feature', 1, '01-01-26'));
  assert.equal(second.plan.path, planPath(projectDir, 'feature', 2, '01-01-26'));
  assert.match(first.plan.path, /\/plans\/01-01-26-feature\.md$/);
  assert.match(second.plan.path, /\/plans\/01-01-26-feature-v2\.md$/);
  // the store lives under the isolated WORCA_HOME, never inside the project
  assert.ok(!first.plan.path.startsWith(projectDir));
});

test('allocateOutputs: store project review outputs route through reviewPath', async () => {
  const projectDir = await tmpDir('worca-cc-exec-proj-');
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_review');
  const alloc = allocateOutputs({
    node, ports: ports(node), executionId: 'x1', ordinal: 1,
    runCtx: runCtxFor({ pipelineDir, projectDir }),
  });
  assert.equal(alloc.review.path, reviewPath(projectDir, 'feature', '01-01-26', 'impl-review'));
  assert.equal(alloc.pass, undefined);   // void, no filename
});

test('allocateOutputs: identical filename templates resolve to ONE path and burn ONE version', async () => {
  const projectDir = await tmpDir('worca-cc-exec-proj-');
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_refine');
  const runCtx = runCtxFor({ pipelineDir, projectDir });
  const alloc = allocateOutputs({ node, ports: ports(node), executionId: 'x1', ordinal: 1, runCtx });
  assert.equal(alloc.plan.path, alloc.revise.path);
  assert.equal(alloc.plan.path, planPath(projectDir, 'feature', 1, '01-01-26'));
  assert.equal(runCtx.peekVersion(), 2);  // exactly ONE tick consumed across the execution
});

test('allocateOutputs: duplicate agent keys prefix run-store outputs and the verdict with the node id', async () => {
  const pipelineDir = await tmpDir();
  const nodeA = { id: 'n_a', kind: 'agent', key: 'manualWebUiTesting', x: 0, y: 0, config: {} };
  const nodeB = { id: 'n_b', kind: 'agent', key: 'manualWebUiTesting', x: 0, y: 0, config: {} };
  const dup = runCtxFor({ pipelineDir, projectDir: pipelineDir, duplicateKey: true });
  const a = allocateOutputs({ node: nodeA, ports: ports(nodeA), executionId: 'a1', ordinal: 1, runCtx: dup });
  const b = allocateOutputs({ node: nodeB, ports: ports(nodeB), executionId: 'b1', ordinal: 1, runCtx: dup });
  assert.equal(a.review.path, join(pipelineDir, 'n_a-webui-review-cycle1.md'));
  assert.equal(b.review.path, join(pipelineDir, 'n_b-webui-review-cycle1.md'));
  assert.notEqual(a.review.path, b.review.path);
  assert.equal(
    allocateVerdict({ node: nodeA, ports: ports(nodeA), ordinal: 1, runCtx: dup }).path,
    join(pipelineDir, 'n_a-webui-review-cycle1.json'),
  );
  assert.equal(
    allocateVerdict({ node: nodeB, ports: ports(nodeB), ordinal: 1, runCtx: dup }).path,
    join(pipelineDir, 'n_b-webui-review-cycle1.json'),
  );
  // single-instance graphs stay byte-identical to today (no prefix at all)
  const solo = runCtxFor({ pipelineDir, projectDir: pipelineDir });
  const s = allocateOutputs({ node: nodeA, ports: ports(nodeA), executionId: 'a1', ordinal: 1, runCtx: solo });
  assert.equal(s.review.path, join(pipelineDir, 'webui-review-cycle1.md'));
  assert.equal(
    allocateVerdict({ node: nodeA, ports: ports(nodeA), ordinal: 1, runCtx: solo }).path,
    join(pipelineDir, 'webui-review-cycle1.json'),
  );
});

test('allocateOutputs: a combine node allocates combine-<nodeId>-c<ordinal>.md in the pipeline dir', async () => {
  const pipelineDir = await tmpDir();
  const node = { id: 'n_comb', kind: 'combine', x: 0, y: 0, config: { arity: 2 } };
  const alloc = allocateOutputs({
    node, ports: ports(node), executionId: 'c1', ordinal: 3,
    runCtx: runCtxFor({ pipelineDir, projectDir: pipelineDir }),
  });
  assert.equal(alloc.out.path, join(pipelineDir, 'combine-n_comb-c3.md'));
});

// ── the Ports block ───────────────────────────────────────────────────────────

test('portIoBlock lists bound inputs and EVERY output path, conditional ones included (D7)', async () => {
  const projectDir = await tmpDir('worca-cc-exec-proj-');
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_review');
  const p = ports(node);
  const runCtx = runCtxFor({ pipelineDir, projectDir });
  const outputs = allocateOutputs({ node, ports: p, executionId: 'x1', ordinal: 1, runCtx });
  const verdict = allocateVerdict({ node, ports: p, ordinal: 1, runCtx });
  const block = portIoBlock({
    node, ports: p, outputs, verdict,
    bindings: { plan: tok({ path: '/abs/plan.md' }), done: tok({ type: 'void' }) },
  });
  assert.match(block, /^## Ports \(this run\)/);
  assert.ok(block.includes('- **plan** (md) -> /abs/plan.md'));
  // the review output is conditional (when: 'blocking') yet is ALWAYS rendered
  assert.ok(block.includes(`- Write **review** to: ${outputs.review.path}`));
  assert.ok(block.includes(`to: ${verdict.path}`));
  // void outputs carry no path, so they are not writable targets
  assert.ok(!block.includes('**pass**'));
});

test('portIoBlock renderer comes from meta `as`, never from the port id', () => {
  const node = { id: 'n_c', kind: 'agent', key: 'custom', x: 0, y: 0, config: {} };
  const withAs = {
    runnerType: 'producer',
    inputs: [{ id: 'notes', type: 'md', required: true, as: 'fix-review' }],
    outputs: [],
  };
  const withoutAs = {
    runnerType: 'producer',
    inputs: [{ id: 'notes', type: 'md', required: true }],
    outputs: [],
  };
  const bindings = { notes: tok({ path: '/abs/notes.md' }) };
  const a = portIoBlock({ node, ports: withAs, bindings, outputs: {} });
  const b = portIoBlock({ node, ports: withoutAs, bindings, outputs: {} });
  assert.ok(a.includes('fix EVERY critical and major issue'));
  assert.ok(b.includes('- **notes** (md) -> /abs/notes.md'));
  assert.ok(!b.includes('fix EVERY critical and major issue'));
});

test('portIoBlock renders the worktree arm for an `as: worktree` input', () => {
  const node = nodeOf(FIXTURE_DEFAULT, 'n_review');
  const block = portIoBlock({
    node, ports: ports(node), outputs: {},
    bindings: { done: tok({ type: 'void' }) },
  });
  assert.ok(block.includes('the working tree — inspect with `git diff`'));
});

test('portIoBlock never lists the synthesized await port, even if a binding carries one', () => {
  const node = nodeOf(FIXTURE_FLOW, 'n_check');
  const p = ports(node);
  assert.ok(p.inputs.some((i) => i.id === 'await'));   // it IS a resolved input
  const block = portIoBlock({
    node, ports: p, outputs: {},
    bindings: { plan: tok({ path: '/abs/plan.md' }), await: tok({ type: 'void' }) },
  });
  assert.ok(block.includes('- **plan** (md) -> /abs/plan.md'));
  assert.ok(!block.includes('**await**'));
});

// ── A3: mode selection is port FRESHNESS ──────────────────────────────────────

const FIX_DIRECTIVE = 'Address EVERY critical and major issue in the review below';
const SLICE_DIRECTIVE = 'The TASK file is a';
const REVISE_HEADING = '## Revise to address the review';

function promptCtx({ node, meta, bindings, freshPorts, pipelineDir, projectDir, outputs = {}, verdict = null }) {
  return {
    node, ports: meta, meta, bindings, trigger: { freshPorts },
    ordinal: 1, executionId: 'x1', outputs, verdict,
    projectDir, pipelineDir, taskPrompt: 'BUILD THE THING',
    runCtx: runCtxFor({ pipelineDir, projectDir }),
    template: FIXTURE_DEFAULT,
  };
}

test('selectMode + buildAgentPrompt: a FRESH directive port selects its mode and renders its arm', async () => {
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_impl');
  const p = ports(node);
  const bindings = { plan: tok({ path: '/abs/plan.md' }), fix: tok({ path: '/abs/review.md', seq: 9 }) };
  const sel = selectMode({ ports: p, bindings, freshPorts: ['fix'] });
  assert.equal(sel.mode, 'fix');
  const prompt = buildAgentPrompt(promptCtx({
    node, meta: p, bindings, freshPorts: ['fix'], pipelineDir, projectDir: pipelineDir,
  }));
  assert.ok(prompt.includes('Mode: fix'));
  assert.ok(prompt.includes(FIX_DIRECTIVE));
});

test('selectMode + buildAgentPrompt: a LATCHED directive port selects nothing and renders no arm', async () => {
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_impl');
  const p = ports(node);
  const bindings = { plan: tok({ path: '/abs/plan.md', seq: 12 }), fix: tok({ path: '/abs/review.md', seq: 3 }) };
  const sel = selectMode({ ports: p, bindings, freshPorts: ['plan'] });
  assert.equal(sel.mode, null);
  const prompt = buildAgentPrompt(promptCtx({
    node, meta: p, bindings, freshPorts: ['plan'], pipelineDir, projectDir: pipelineDir,
  }));
  assert.ok(!prompt.includes('Mode: fix'));
  assert.ok(!prompt.includes(FIX_DIRECTIVE));
  // the latched review is still BOUND, so its path is still named in the Ports block
  assert.ok(prompt.includes('/abs/review.md'));
});

test('buildAgentPrompt: a fresh expands input renders the decomposed-slice arm', async () => {
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_impl');
  const p = ports(node);
  const bindings = { plan: tok({ path: '/abs/plan.md' }), task: tok({ type: 'json', path: '/abs/task.md' }) };
  const prompt = buildAgentPrompt(promptCtx({
    node, meta: p, bindings, freshPorts: ['task'], pipelineDir, projectDir: pipelineDir,
  }));
  assert.ok(prompt.includes('Mode: task'));
  assert.ok(prompt.includes(SLICE_DIRECTIVE));
});

test('buildAgentPrompt: a fresh revise input renders the REVISE arm', async () => {
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_DEFAULT, 'n_plan');
  const p = ports(node);
  const bindings = { task: tok({ path: '/abs/task.md' }), revise: tok({ path: '/abs/plan-review.md' }) };
  const prompt = buildAgentPrompt(promptCtx({
    node, meta: p, bindings, freshPorts: ['revise'], pipelineDir, projectDir: pipelineDir,
  }));
  assert.ok(prompt.includes('Mode: revise'));
  assert.ok(prompt.includes(REVISE_HEADING));
});

test('buildAgentPrompt: an await-only re-fire renders the base prompt (no mode, no await port)', async () => {
  const pipelineDir = await tmpDir();
  const node = nodeOf(FIXTURE_FLOW, 'n_check');
  const p = ports(node);
  const bindings = { plan: tok({ path: '/abs/plan.md' }) };
  const prompt = buildAgentPrompt(promptCtx({
    node, meta: p, bindings, freshPorts: ['await'], pipelineDir, projectDir: pipelineDir,
  }));
  assert.ok(!prompt.includes('Mode: '));
  assert.ok(!prompt.includes('**await**'));
});

test('buildAgentPrompt: the request/attachment gate is task-source + wantsRequest, never a key', async () => {
  const pipelineDir = await tmpDir();
  // planner binds the task node's token -> gets the request AND the attachments
  const planNode = nodeOf(FIXTURE_DEFAULT, 'n_plan');
  const fromTask = buildAgentPrompt({
    ...promptCtx({
      node: planNode, meta: ports(planNode),
      bindings: { task: tok({ path: '/abs/task.md' }) }, freshPorts: ['task'],
      pipelineDir, projectDir: pipelineDir,
    }),
    extras: [{ name: 'spec.md', path: '/abs/spec.md' }],
  });
  assert.ok(fromTask.includes('## Original request'));
  assert.ok(fromTask.includes('BUILD THE THING'));
  assert.ok(fromTask.includes('## Attached files'));

  // reviewer carries wantsRequest but binds no task token -> request, NO attachments
  const revNode = nodeOf(FIXTURE_DEFAULT, 'n_review');
  const wants = buildAgentPrompt({
    ...promptCtx({
      node: revNode, meta: ports(revNode),
      bindings: { plan: tok({ path: '/abs/plan.md' }) }, freshPorts: ['plan'],
      pipelineDir, projectDir: pipelineDir,
    }),
    extras: [{ name: 'spec.md', path: '/abs/spec.md' }],
  });
  assert.ok(wants.includes('## Original request'));
  assert.ok(!wants.includes('## Attached files'));

  // a custom node with neither -> upstream-input header, no request text at all
  const custom = { id: 'n_c', kind: 'agent', key: 'custom', x: 0, y: 0, config: {} };
  const meta = {
    runnerType: 'producer', displayName: 'Custom',
    inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
    outputs: [{ id: 'out', type: 'md', when: 'always', filename: 'out.md', store: 'run', artifactKind: 'out' }],
  };
  const neither = buildAgentPrompt(promptCtx({
    node: custom, meta, bindings: { plan: tok({ path: '/abs/plan.md' }) }, freshPorts: ['plan'],
    pipelineDir, projectDir: pipelineDir,
  }));
  assert.ok(neither.includes('## Upstream input'));
  assert.ok(!neither.includes('BUILD THE THING'));
});

test('taskSourcedPorts names the inputs fed by a kind:task node', () => {
  assert.deepEqual([...taskSourcedPorts(FIXTURE_DEFAULT, 'n_plan')], ['task']);
  assert.deepEqual([...taskSourcedPorts(FIXTURE_DEFAULT, 'n_refine')], []);
});

// ── the generic MOCK_ROLE chain ───────────────────────────────────────────────

const CUSTOM_CLARIFIER = {
  runnerType: 'clarifier', displayName: 'Ask Me',
  inputs: [{ id: 'task', type: 'md', required: true, as: 'file' }],
  outputs: [{ id: 'qa', type: 'json', when: 'always', filename: 'qa.json', store: 'run', artifactKind: 'qa' }],
};
const CUSTOM_PRODUCER = {
  runnerType: 'producer', displayName: 'Slicer',
  inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
  outputs: [{ id: 'out', type: 'json', when: 'always', filename: 'slices.json', store: 'run', artifactKind: 'out' }],
};
const CUSTOM_VERIFIER = {
  runnerType: 'verifier', displayName: 'Checker',
  verdict: { filename: 'custom-review-cycle{cycle}.json' },
  inputs: [{ id: 'plan', type: 'md', required: true, as: 'file' }],
  outputs: [
    { id: 'review', type: 'md', when: 'blocking', filename: 'custom-review-cycle{cycle}.md', store: 'run', artifactKind: 'review' },
    { id: 'pass', type: 'void', when: 'clean' },
  ],
};
const EXPANDS_TPL = {
  id: 'wf_expands', name: 'Expands', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_src', kind: 'agent', key: 'slicer', x: 0, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 280, y: 0, config: {} },
  ],
  wires: [{ id: 'w1', from: { node: 'n_src', port: 'out' }, to: { node: 'n_impl', port: 'task' } }],
};
const CUSTOM_TABLE = { ...FIXTURE_PORTS, slicer: CUSTOM_PRODUCER, asker: CUSTOM_CLARIFIER, checker: CUSTOM_VERIFIER };

test('expandsOutputPort finds the output wired into an expands input', () => {
  const fn = portsFnFor(CUSTOM_TABLE);
  assert.equal(expandsOutputPort(EXPANDS_TPL, fn, 'n_src'), 'out');
  assert.equal(expandsOutputPort(EXPANDS_TPL, fn, 'n_impl'), null);
});

test('resolveMockRole follows the generic five-step chain', () => {
  // 1. a validated declared mockRole wins
  assert.equal(resolveMockRole({ meta: { ...CUSTOM_PRODUCER, mockRole: 'refiner' } }), 'refiner');
  // an unvalidated one is ignored (agent-registry drops these upstream; be defensive anyway)
  assert.equal(resolveMockRole({ meta: { ...CUSTOM_PRODUCER, mockRole: 'bogus-role' } }), 'generic-producer');
  // 2. a clarifier runner
  assert.equal(resolveMockRole({ meta: CUSTOM_CLARIFIER }), 'clarify');
  // 3. an output wired into an expands input
  assert.equal(resolveMockRole({ meta: CUSTOM_PRODUCER, expandsPort: 'out' }), 'decomposer');
  // 4. a declared verdict
  assert.equal(resolveMockRole({ meta: CUSTOM_VERIFIER }), 'generic-verifier');
  // 5. the fallback
  assert.equal(resolveMockRole({ meta: CUSTOM_PRODUCER }), 'generic-producer');
});

test('resolveMockRole never yields a role the mock writer cannot handle', () => {
  const metas = [...Object.values(CUSTOM_TABLE), { runnerType: 'producer' }, { runnerType: 'verifier', verdict: {} }];
  for (const meta of metas) {
    for (const expandsPort of [null, 'out']) {
      assert.ok(MOCK_WRITER_ROLES.has(resolveMockRole({ meta, expandsPort })));
    }
  }
});

// ── flow executors ────────────────────────────────────────────────────────────

test('runAndExecution emits a void out token with no payload', () => {
  const node = nodeOf(FIXTURE_FLOW, 'n_and');
  assert.deepEqual(runAndExecution({ node }), { outputs: { out: {} } });
});

test('runOrExecution forwards the sole bound token, preserving path AND type', () => {
  const node = nodeOf(FIXTURE_FLOW, 'n_or');
  const r = runOrExecution({ node, bindings: { in2: tok({ type: 'md', path: '/abs/refined.md', seq: 7 }) } });
  assert.deepEqual(r, { outputs: { out: { type: 'md', path: '/abs/refined.md', value: null } } });
});

test('runEndExecution echoes the bound result and emits NO outputs', () => {
  const node = nodeOf(FIXTURE_FLOW, 'n_end');
  const md = runEndExecution({ node, bindings: { result: tok({ type: 'md', path: '/abs/checklist.md' }) } });
  assert.deepEqual(md, { result: { type: 'md', path: '/abs/checklist.md', value: null } });
  assert.equal('outputs' in md, false);
  const nothing = runEndExecution({ node, bindings: { result: tok({ type: 'void' }) } });
  assert.deepEqual(nothing, { result: { type: 'void', path: null, value: null } });
});

test('runCombineExecution concatenates in port order under ## From headings', async () => {
  const pipelineDir = await tmpDir();
  const a = join(pipelineDir, 'a.md');
  const b = join(pipelineDir, 'b.md');
  await writeFile(a, 'ALPHA BODY\n', 'utf8');
  await writeFile(b, 'BETA BODY\n', 'utf8');
  const node = { id: 'n_comb', kind: 'combine', x: 0, y: 0, config: { arity: 2 } };
  const out = await runCombineExecution({
    node,
    bindings: { in1: tok({ path: a }), in2: tok({ path: b }) },
    allocatedPath: join(pipelineDir, 'combine-n_comb-c1.md'),
    names: { in1: 'Alpha', in2: 'Beta' },
  });
  assert.equal(out.outputs.out.path, join(pipelineDir, 'combine-n_comb-c1.md'));
  const text = await readFile(out.outputs.out.path, 'utf8');
  assert.ok(text.indexOf('## From Alpha') < text.indexOf('## From Beta'));
  assert.ok(text.includes('ALPHA BODY'));
  assert.ok(text.includes('BETA BODY'));
});

test('runCombineExecution falls back to its own combine-<nodeId>-c<ordinal>.md allocation', async () => {
  const pipelineDir = await tmpDir();
  const a = join(pipelineDir, 'a.md');
  await writeFile(a, 'ONLY\n', 'utf8');
  const node = { id: 'n_c2', kind: 'combine', x: 0, y: 0, config: { arity: 1 } };
  const out = await runCombineExecution({
    node, bindings: { in1: tok({ path: a }) }, ordinal: 4,
    runCtx: runCtxFor({ pipelineDir, projectDir: pipelineDir }),
  });
  assert.equal(out.outputs.out.path, join(pipelineDir, 'combine-n_c2-c4.md'));
});

// ── the task source node (Amendment A2) ───────────────────────────────────────

test('runTaskExecution without planStoreSeed emits the pipelineDir document verbatim', async () => {
  const pipelineDir = await tmpDir();
  const runCtx = runCtxFor({ pipelineDir, projectDir: pipelineDir });
  const node = nodeOf(FIXTURE_DEFAULT, 'n_task');
  const extras = [{ name: 'spec.md', path: '/abs/spec.md' }];
  const r = runTaskExecution({
    node, runCtx,
    taskArtifact: { promptText: 'BUILD THE THING', extras },
  });
  assert.equal(r.outputs.task.path, join(pipelineDir, 'task.md'));
  const text = await readFile(r.outputs.task.path, 'utf8');
  assert.equal(text, renderPromptArtifact('BUILD THE THING', extras));
  assert.equal(runCtx.peekVersion(), 1);   // the counter is untouched without the flag
});

test('runTaskExecution with planStoreSeed writes the plans store and consumes version 1', async () => {
  const projectDir = await tmpDir('worca-cc-exec-proj-');
  const pipelineDir = await tmpDir();
  const runCtx = runCtxFor({ pipelineDir, projectDir });
  const node = { id: 'n_task', kind: 'task', x: 0, y: 0, config: { planStoreSeed: true } };
  const r = runTaskExecution({ node, runCtx, taskArtifact: { promptText: 'MID-STREAM PLAN' } });
  const seeded = planPath(projectDir, 'feature', 1, '01-01-26');
  assert.equal(r.outputs.task.path, seeded);
  assert.equal(await readFile(seeded, 'utf8'), renderPromptArtifact('MID-STREAM PLAN', []));
  // the counter is now consumed at 1, so the next plan-store write allocates -v2
  const planNode = nodeOf(FIXTURE_DEFAULT, 'n_plan');
  const next = allocateOutputs({
    node: planNode, ports: ports(planNode), executionId: 'x1', ordinal: 1, runCtx,
  });
  assert.equal(next.plan.path, planPath(projectDir, 'feature', 2, '01-01-26'));
});

// ── the agent + clarifier executors (offline mock) ────────────────────────────

function mockCtxFor({ node, meta, bindings, pipelineDir, projectDir, freshPorts, extra = {} }) {
  const runCtx = runCtxFor({ pipelineDir, projectDir });
  return {
    node, ports: meta, meta, bindings, trigger: { freshPorts: freshPorts || Object.keys(bindings) },
    ordinal: 1, executionId: `${node.id}#1`, runCtx,
    projectDir, pipelineDir, taskPrompt: 'BUILD THE THING',
    agentPrompts: { [node.key]: `You are ${meta.displayName}.` },
    claudeOpts: { mock: true },
    template: FIXTURE_DEFAULT,
    ...extra,
  };
}

test('runAgentExecution spawns through the shared runClaude path and reads its verdict back', async () => {
  const pipelineDir = await tmpDir();
  const node = { id: 'n_check2', kind: 'agent', key: 'checker', x: 0, y: 0, config: {} };
  const ctx = mockCtxFor({
    node, meta: CUSTOM_VERIFIER, pipelineDir, projectDir: pipelineDir,
    bindings: { plan: tok({ path: '/abs/plan.md' }) },
  });
  const r = await runAgentExecution(ctx);
  assert.equal(r.outputs.review.path, join(pipelineDir, 'custom-review-cycle1.md'));
  // a void port still publishes a token, so it is present with an empty payload
  assert.deepEqual(r.outputs.pass, {});
  // the offline generic-verifier mock writes a blocking cycle-1 verdict
  assert.ok(Array.isArray(r.verdict.issues) && r.verdict.issues.length > 0);
  assert.ok(r.prompt.includes('MOCK_ROLE: generic-verifier'));
  assert.ok(r.prompt.includes(`MOCK_JSON: ${join(pipelineDir, 'custom-review-cycle1.json')}`));
  assert.ok(r.prompt.includes('MOCK_CYCLE: 1'));
});

test('runClarifierExecution gates on a nodeId-scoped ask id and rewrites the file to {questions, answers}', async () => {
  const projectDir = await tmpDir('worca-cc-exec-proj-');
  const pipelineDir = await tmpDir();
  const { id: pipelineId } = await seedPipeline(projectDir);
  const node = { id: 'n_ask', kind: 'agent', key: 'asker', x: 0, y: 0, config: {} };
  const asked = [];
  const ctx = mockCtxFor({
    node, meta: CUSTOM_CLARIFIER, pipelineDir, projectDir,
    bindings: { task: tok({ path: '/abs/task.md' }) },
    extra: {
      pipelineId,
      ask: async (q) => { asked.push(q); return { answers: [{ id: 'invalid-input', choice: 'Coerce to a safe default' }] }; },
    },
  });
  const r = await runClarifierExecution(ctx);

  assert.equal(asked.length, 1);
  assert.equal(asked[0].id, 'clarify-n_ask-1');
  assert.equal(asked[0].kind, 'clarify');
  assert.equal(asked[0].nodeId, 'n_ask');
  assert.equal(asked[0].agent, 'Ask Me');
  assert.equal(asked[0].questions.length, 2);

  const answersPath = join(pipelineDir, 'qa.json');
  assert.equal(r.outputs.qa.path, answersPath);
  const written = JSON.parse(await readFile(answersPath, 'utf8'));
  assert.equal(written.questions.length, 2);
  assert.equal(written.answers.length, 2);
  assert.equal(written.answers[0].choice, 'Coerce to a safe default');
  // an unanswered question falls back to its first option, and carries its text
  assert.equal(written.answers[1].id, 'delete-behavior');
  assert.equal(written.answers[1].choice, 'Hard delete');
  assert.ok(written.answers[1].question.length > 0);

  // persistence: per-node step questions keyed by the executionId, plus the legacy row
  const rows = readStepQuestions(pipelineId).filter((x) => x.nodeId === 'n_ask');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].questions.length, 2);
  assert.equal(rows[0].answers.length, 2);
  const legacy = readClarifyRow(pipelineId);
  assert.equal(legacy.answers?.answers?.length, 2);
});

test('runClarifierExecution with zero questions skips the gate and still emits the answers token', async () => {
  const pipelineDir = await tmpDir();
  const node = { id: 'n_ask2', kind: 'agent', key: 'asker', x: 0, y: 0, config: {} };
  const asked = [];
  const ctx = mockCtxFor({
    node, meta: CUSTOM_CLARIFIER, pipelineDir, projectDir: pipelineDir,
    bindings: { task: tok({ path: '/abs/task.md' }) },
    // MOCK_PRIOR > 0 makes the offline clarifier report no further questions
    extra: { priorAnswers: [{ id: 'q1', question: 'Q?', choice: 'A' }], ask: async (q) => { asked.push(q); return {}; } },
  });
  const r = await runClarifierExecution(ctx);
  assert.equal(asked.length, 0);
  const written = JSON.parse(await readFile(r.outputs.qa.path, 'utf8'));
  assert.deepEqual(written, { questions: [], answers: [] });
});

test('readVerdict normalizes a review json and tolerates a missing file', async () => {
  const pipelineDir = await tmpDir();
  const p = join(pipelineDir, 'v.json');
  await mkdir(pipelineDir, { recursive: true });
  await writeFile(p, JSON.stringify({ issues: [{ severity: 'MAJOR', title: 'T' }], summary: ' s ' }), 'utf8');
  const v = await readVerdict(p);
  assert.equal(v.issues[0].severity, 'major');
  assert.equal(v.summary, 's');
  assert.deepEqual(await readVerdict(join(pipelineDir, 'nope.json')), { issues: [], summary: '' });
});
