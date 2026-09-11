// Allocation under <runDir>/steps/<node>-c<N>[-<slice>]/ (spec §3, §5). Every fixture
// here is a CUSTOM sidecar; Task 3 appends the builtin table + the Ports block.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import {
  allocateOutputs, allocateVerdict, runTaskExecution, runCombineExecution, runAgentExecution, buildAgentPrompt,
  portIoBlock,
} from '../src/core/graph/executor.mjs';

useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const pipelineDir = tmp('worca-steps-pipe-');
const projectDir = tmp('worca-steps-proj-');

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
const step = (name, ...rest) => join(pipelineDir, 'steps', name, ...rest);

test("store:'project' is accepted and ignored — every port lands in the step folder as store 'run'", () => {
  const ports = { outputs: [
    { id: 'plan', type: 'md', filename: 'plan{vsuffix}.md', store: 'project', artifactKind: 'plan' },
    { id: 'review', type: 'md', filename: '{base}-impl-review.md', store: 'project' },
    { id: 'notes', type: 'md', filename: 'notes-cycle{cycle}.md', store: 'run' },
  ] };
  const out = allocateOutputs({ node: node(), ports, ordinal: 2, runCtx: runCtx() });
  assert.deepEqual(out.plan, { path: step('n_x-c2', 'plan.md'), store: 'run' });
  assert.deepEqual(out.review, { path: step('n_x-c2', 'feature-impl-review.md'), store: 'run' }, '{base} still renders for third-party sidecars');
  assert.deepEqual(out.notes, { path: step('n_x-c2', 'notes-cycle2.md'), store: 'run' });
});

test('no duplicate-key or slice prefix: the FOLDER is the discriminator', () => {
  const ports = { outputs: [{ id: 'review', type: 'md', filename: 'impl-review-cycle{cycle}.md' }], verdict: { filename: 'impl-review-cycle{cycle}.json' } };
  const dup = allocateOutputs({ node: node('n_two'), ports, ordinal: 1, runCtx: runCtx({ duplicateKey: true }) });
  assert.equal(dup.review.path, step('n_two-c1', 'impl-review-cycle1.md'));
  assert.equal(allocateVerdict({ node: node('n_two'), ports, ordinal: 1, runCtx: runCtx({ duplicateKey: true }) }).path,
    step('n_two-c1', 'impl-review-cycle1.json'), 'the verdict stem is unprefixed, so _verdictKind maps it to impl (D5)');
  const s1 = allocateOutputs({ node: node(), ports, ordinal: 1, runCtx: runCtx({ slice: 'p1t1' }) });
  const s2 = allocateOutputs({ node: node(), ports, ordinal: 1, runCtx: runCtx({ slice: 'p1t2' }) });
  assert.equal(s1.review.path, step('n_x-c1-p1t1', 'impl-review-cycle1.md'));
  assert.equal(s2.review.path, step('n_x-c1-p1t2', 'impl-review-cycle1.md'));
  assert.equal(allocateVerdict({ node: node(), ports, ordinal: 1, runCtx: runCtx({ slice: 'p1t2' }) }).path,
    step('n_x-c1-p1t2', 'impl-review-cycle1.json'));
  const evil = allocateOutputs({ node: node(), ports, ordinal: 1, runCtx: runCtx({ slice: '../up' }) });
  assert.equal(evil.review.path, step('n_x-c1-___up', 'impl-review-cycle1.md'), 'an agent-written task id cannot escape steps/');
});

test('the {vsuffix} counter is run-global and ticks once per distinct template per execution', () => {
  const rc = runCtx();
  const REF = { outputs: [
    { id: 'plan', type: 'md', when: 'clean', filename: 'plan{vsuffix}.md' },
    { id: 'revise', type: 'md', when: 'blocking', filename: 'plan{vsuffix}.md', artifactKind: 'plan' },
  ] };
  const c1 = allocateOutputs({ node: node('n_ref'), ports: REF, ordinal: 1, runCtx: rc });
  assert.equal(c1.plan.path, c1.revise.path, 'one allocation for the shared template');
  assert.equal(c1.plan.path, step('n_ref-c1', 'plan.md'));
  const c2 = allocateOutputs({ node: node('n_ref'), ports: REF, ordinal: 2, runCtx: rc });
  assert.equal(c2.plan.path, step('n_ref-c2', 'plan-v2.md'));
  const other = allocateOutputs({ node: node('n_plan'), ports: REF, ordinal: 1, runCtx: rc });
  assert.equal(other.plan.path, step('n_plan-c1', 'plan-v3.md'), 'run-global: another node continues the count');
});

test('A2 planStoreSeed lands in steps/<task>-c1/plan.md and consumes version 1', () => {
  const rc = runCtx();
  const res = runTaskExecution({ node: { id: 'n_task', kind: 'task', config: { planStoreSeed: true } }, taskArtifact: { text: '# Provided\n' }, runCtx: rc });
  assert.equal(res.outputs.task.path, step('n_task-c1', 'plan.md'));
  assert.equal(readFileSync(res.outputs.task.path, 'utf8'), '# Provided\n');
  const next = allocateOutputs({ node: node('n_ref'), ports: { outputs: [{ id: 'plan', type: 'md', filename: 'plan{vsuffix}.md' }] }, ordinal: 1, runCtx: rc });
  assert.equal(next.plan.path, step('n_ref-c1', 'plan-v2.md'), 'the next plan write is -v2');
  const plain = runTaskExecution({ node: { id: 'n_task', kind: 'task', config: {} }, taskArtifact: { text: '# T\n' }, runCtx: runCtx() });
  assert.equal(plain.outputs.task.path, join(pipelineDir, 'task.md'), 'without the seed the task document stays an engine root file');
});

test('the combine card allocates <stepDir>/combine.md (allocated and fallback paths agree)', async () => {
  const comb = { id: 'n_comb', kind: 'combine', config: { arity: 2 } };
  assert.equal(allocateOutputs({ node: comb, ports: {}, ordinal: 3, runCtx: runCtx() }).out.path, step('n_comb-c3', 'combine.md'));
  const res = await runCombineExecution({ node: comb, bindings: { in1: { type: 'md', value: 'A' }, in2: { type: 'md', value: 'B' } }, ordinal: 1, runCtx: runCtx() });
  assert.equal(res.outputs.out.path, step('n_comb-c1', 'combine.md'));
  assert.match(readFileSync(res.outputs.out.path, 'utf8'), /## From in1\n\nA\n\n## From in2\n\nB\n/);
});

const SPLITTER = {
  displayName: 'Splitter', runnerType: 'producer', mockRole: 'decomposer',
  inputs: [{ id: 'plan', type: 'md', required: true }],
  outputs: [{ id: 'tasks', type: 'json', filename: 'split.json' }],
};
function splitterCtx(over = {}) {
  const n = { id: 'n_split', kind: 'agent', key: 'splitter', config: {}, fanOut: false, agentPrompt: 'You split.', tools: [] };
  const rc = runCtx();
  return {
    node: n, nodeId: n.id, executionId: 'x:n_split:2', ordinal: 2, cycle: 2,
    template: { nodes: [n], wires: [] }, ports: SPLITTER, meta: SPLITTER,
    bindings: { plan: { type: 'md', path: '/abs/plan.md' } }, trigger: { wireIds: [], freshPorts: ['plan'] },
    outputs: allocateOutputs({ node: n, ports: SPLITTER, ordinal: 2, runCtx: rc }), verdict: null,
    expandsPort: 'tasks', runCtx: rc, priorAnswers: [],
    projectDir, pipelineDir, taskPrompt: 'BUILD IT', toolInstruction: 'TOOLS', extras: [],
    checkpointRef: 'abc1234', workspace: null, agentPrompts: {}, claudeOpts: { mock: true },
    ...over,
  };
}

test('the tasks directory is <stepDir>/tasks in the decomposition contract and in MOCK_TASKS_DIR', () => {
  const p = buildAgentPrompt(splitterCtx());
  assert.ok(p.includes(`Write each task file under: ${step('n_split-c2', 'tasks')}/ (name them p<phase>-t<n>-<kebab-title>.md)`));
  assert.ok(p.includes(`MOCK_TASKS_DIR: ${step('n_split-c2', 'tasks')}`));
  assert.ok(p.includes(`MOCK_OUT: ${step('n_split-c2', 'split.json')}`));
});

test('a missing verdict warns with a /-joined run-dir-relative path on every OS', async () => {
  const VERIFIER = {
    displayName: 'Silent', runnerType: 'verifier', mockRole: 'generic-producer',   // the producer mock never writes the verdict
    verdict: { filename: 'silent-verdict-c{cycle}.json' },
    inputs: [{ id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'pass', type: 'void', when: 'clean' }],
  };
  const n = { id: 'n_sil', kind: 'agent', key: 'silent', config: {}, fanOut: false, agentPrompt: 'You verify.', tools: [] };
  const rc = runCtx();
  const res = await runAgentExecution({
    node: n, nodeId: n.id, executionId: 'x:n_sil:1', ordinal: 1, cycle: 1,
    template: { nodes: [n], wires: [] }, ports: VERIFIER, meta: VERIFIER,
    bindings: { plan: { type: 'md', path: '/abs/plan.md' } }, trigger: { wireIds: [], freshPorts: ['plan'] },
    outputs: {}, verdict: allocateVerdict({ node: n, ports: VERIFIER, ordinal: 1, runCtx: rc }),
    expandsPort: null, runCtx: rc, priorAnswers: [],
    projectDir, pipelineDir, taskPrompt: 'BUILD IT', toolInstruction: 'TOOLS', extras: [],
    checkpointRef: 'abc1234', workspace: null, agentPrompts: {}, claudeOpts: { mock: true },
  });
  assert.deepEqual(res.warnings, ['verdict file missing: n_sil steps/n_sil-c1/silent-verdict-c1.json — treated as clean']);
});

// ── the builtin sidecars, allocated through the REAL registry (spec §5 table) ──
const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
const REGISTRY = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const portsFn = registryPortsFn(REGISTRY);
const builtin = (key, ordinal, over = {}) => {
  const n = { id: `n_${key}`, kind: 'agent', key, x: 0, y: 0, config: {} };
  const rc = runCtx(over);
  const ports = portsFn(n);
  return { outputs: allocateOutputs({ node: n, ports, ordinal, runCtx: rc }), verdict: allocateVerdict({ node: n, ports, ordinal, runCtx: rc }), rc, n, ports };
};

test('every builtin sidecar allocates kind+cycle names in its step folder; no store key survives', () => {
  // Only NON-void ports carry a store: agent-meta.mjs#readPortHead ERRORS if a void
  // port declares one (`void ports carry no filename or store`), and readOutputs sets
  // `port.store` inside `if (port.type !== 'void')`. So `pass` (reviewer,
  // planReviewer, workspaceReviewer, manualWebUiTesting) and `done` (implementer)
  // are `undefined` BY DESIGN — asserting 'run' on them would be asserting a bug.
  for (const key of Object.keys(REGISTRY)) {
    for (const p of REGISTRY[key].outputs || []) {
      if (p.type === 'void') { assert.equal(p.store, undefined, `${key}.${p.id}: a void port carries no store`); continue; }
      assert.equal(p.store, 'run', `${key}.${p.id}: the builtin sidecars carry no project store`);
    }
  }
  assert.equal(builtin('planner', 1).outputs.plan.path, step('n_planner-c1', 'plan.md'));
  const ref = builtin('refiner', 2);
  assert.equal(ref.outputs.plan.path, step('n_refiner-c2', 'plan.md'));
  assert.equal(ref.outputs.plan.path, ref.outputs.revise.path, 'plan/revise share one file');
  assert.equal(ref.verdict.path, step('n_refiner-c2', 'refine-review-cycle2.json'));
  const rev = builtin('reviewer', 3);
  assert.equal(rev.outputs.review.path, step('n_reviewer-c3', 'impl-review-cycle3.md'));
  assert.equal(rev.verdict.path, step('n_reviewer-c3', 'impl-review-cycle3.json'));
  assert.equal(builtin('planReviewer', 2).outputs.review.path, step('n_planReviewer-c2', 'plan-review-cycle2.md'));
  assert.equal(builtin('workspaceReviewer', 1).outputs.review.path, step('n_workspaceReviewer-c1', 'ws-review-cycle1.md'));
  assert.equal(builtin('manualWebUiTesting', 2).outputs.review.path, step('n_manualWebUiTesting-c2', 'webui-review-cycle2.md'));
  assert.equal(builtin('manualTestsChecklist', 1).outputs.checklist.path, step('n_manualTestsChecklist-c1', 'manual-tests-checklist.md'));
  assert.equal(builtin('decomposer', 1).outputs.tasks.path, step('n_decomposer-c1', 'decomposition.json'));
  assert.equal(builtin('clarify', 1).outputs.answers.path, step('n_clarify-c1', 'clarify.json'));
  assert.equal(builtin('workspaceScanner', 1).outputs.workspace.path, step('n_workspaceScanner-c1', 'workspace-description.md'));
  assert.equal(builtin('implementer', 1).verdict, null);
  // A void-only sidecar allocates NOTHING — assert the empty object directly:
  // iterating Object.entries({}) would pass without testing anything.
  assert.deepEqual(builtin('implementer', 1).outputs, {}, 'a void port allocates no path');
});

test('the Ports block names the step folder and tells the agent to keep every extra file inside it', () => {
  const ports = { inputs: [{ id: 'plan', type: 'md', required: true }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }] };
  const outputs = allocateOutputs({ node: node(), ports, ordinal: 1, runCtx: runCtx() });
  const block = portIoBlock({ node: node(), ports, bindings: { plan: { type: 'md', path: '/abs/plan.md' } }, outputs, verdict: null, ctx: {}, stepDir: step('n_x-c1') });
  const tail = block.slice(block.indexOf('### Step folder'));
  assert.equal(tail,
    '### Step folder\n\n' +
    `- Your step folder for this execution: ${step('n_x-c1')}\n` +
    '- Put every additional artifact you produce (deviation notes, findings, scratch, screenshots, task files) ' +
    'inside it — never anywhere else in the run store. Files there are indexed and shown to the user after this step.\n\n');
  assert.ok(block.indexOf('### Outputs') < block.indexOf('### Step folder'), 'after the outputs');
  const bare = portIoBlock({ node: node(), ports, bindings: {}, outputs, verdict: null, ctx: {} });
  assert.ok(!bare.includes('### Step folder'), 'no stepDir ⇒ no section (pure callers)');
});

test('buildAgentPrompt renders the step folder for a producer and a verifier, and emits MOCK_STEP_DIR', () => {
  const p = buildAgentPrompt(splitterCtx());
  assert.ok(p.includes(`- Your step folder for this execution: ${step('n_split-c2')}`));
  assert.ok(p.includes(`MOCK_STEP_DIR: ${step('n_split-c2')}`));
  assert.ok(p.indexOf('### Step folder') < p.indexOf('Write each task file under:'), 'Ports block (incl. the step folder) precedes the decomposition contract');
  const sliced = buildAgentPrompt(splitterCtx({ runCtx: runCtx({ slice: 'p1t2' }), slice: { id: 'p1t2', title: 'Two', phase: 1, path: '/abs/t2.md', index: 1, siblings: [] } }));
  assert.ok(sliced.includes(`MOCK_STEP_DIR: ${step('n_split-c2-p1t2')}`), 'a slice gets its own folder');
});
