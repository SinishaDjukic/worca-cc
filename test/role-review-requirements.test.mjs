// test/role-review-requirements.test.mjs — the engine capabilities behind Shaper's requirements stage, used by a
// HAND-BUILT workflow that is not Shaper: a requirements role-review target with declared roles and no checklist
// provider, the criteria check and decisions on an approval hold, and a planner with an extra `requirements` input
// whose plan hold reports coverage. Mock engine; the test edits no engine file. Approval stops are armed by a run
// `shape` (scheduler `approvalStops`), so the runs carry one with no lead.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';

useTempHome(after);

let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-rrreq-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prevEnv[k] = process.env[k];
  Object.assign(process.env, { HOME: sandboxHome, USERPROFILE: sandboxHome, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
});
afterEach(() => { delete process.env.WORCA_MOCK_UNCOVERED; delete process.env.WORCA_MOCK_DIFF_UNCOVERED; _testing.runClaude = null; });
after(async () => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const w = (id, from, to, config) => ({ id, from: { node: from[0], port: from[1] }, to: { node: to[0], port: to[1] }, ...(config ? { config } : {}) });
const at = { x: 0, y: 0 };

const REQUIREMENTS_GRAPH = {
  id: 'wf_req_review', name: 'Requirements review', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', ...at, config: {} },
    { id: 'n_draft', kind: 'agent', key: 'requirementsDrafter', ...at, config: {} },
    { id: 'n_rr', kind: 'agent', key: 'requirementsReviewer', ...at, config: {
      roleReview: { source: 'declared', roles: [{ key: 'alpha', label: 'Alpha' }, { key: 'beta', label: 'Beta' }], target: 'requirements', sink: 'refiner' },
    } },
    { id: 'n_ref', kind: 'agent', key: 'requirementsRefiner', ...at, config: {
      approve: { kind: 'plan', port: 'requirements', check: 'criteria', decisions: 'decisions' }, awaitAll: true,
    } },
    { id: 'n_end', kind: 'end', ...at, config: {} },
  ],
  wires: [
    w('w1', ['n_task', 'task'], ['n_draft', 'task']),
    w('w2', ['n_task', 'task'], ['n_ref', 'task']),
    w('w3', ['n_draft', 'requirements'], ['n_rr', 'requirements']),
    w('w4', ['n_rr', 'requirements'], ['n_ref', 'requirements']),
    w('w5', ['n_rr', 'findings'], ['n_ref', 'findings']),
    w('w6', ['n_ref', 'revise'], ['n_rr', 'revise'], { maxCycles: 2, onExhausted: 'clean' }),
    w('w7', ['n_ref', 'requirements'], ['n_end', 'result']),
  ],
};

const COVERAGE_GRAPH = {
  id: 'wf_req_cover', name: 'Requirements coverage', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', ...at, config: {} },
    { id: 'n_draft', kind: 'agent', key: 'requirementsDrafter', ...at, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', ...at, config: { extraInputs: [{ id: 'requirements', type: 'md' }] } },
    { id: 'n_refine', kind: 'agent', key: 'refiner', ...at, config: {
      extraInputs: [{ id: 'requirements', type: 'md' }], approve: { kind: 'plan', port: 'plan', coverage: 'requirements' },
    } },
    { id: 'n_end', kind: 'end', ...at, config: {} },
  ],
  wires: [
    w('w1', ['n_task', 'task'], ['n_draft', 'task']),
    w('w2', ['n_task', 'task'], ['n_plan', 'task']),
    w('w3', ['n_draft', 'requirements'], ['n_plan', 'requirements']),
    w('w4', ['n_draft', 'requirements'], ['n_refine', 'requirements']),
    w('w5', ['n_plan', 'plan'], ['n_refine', 'plan']),
    w('w6', ['n_refine', 'revise'], ['n_refine', 'revise'], { maxCycles: 1, onExhausted: 'clean' }),
    w('w7', ['n_refine', 'plan'], ['n_end', 'result']),
  ],
};

function start(workflowId) {
  const orch = createOrchestrator({ projectDir: gitDir('rrreq'), workflowId, prompt: 'demo', claude: { mock: true },
    shape: { perspectives: ['product'] } });
  const asks = []; const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    asks.push(q);
    setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] }));
  });
  return { orch, asks, execs, done: orch.run() };
}

test('a requirements role review with declared roles: 2 slices see the requirements path; the hold asks with 8 criteria and no lead', async () => {
  await writeGraphWorkflow(REQUIREMENTS_GRAPH);
  const prompts = [];
  _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
  const h = start('wf_req_review');
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const slices = h.execs.filter((e) => e.nodeId === 'n_rr' && e.kind === 'task' && e.status === 'start');
  assert.deepEqual(slices.map((e) => e.title), ['Alpha', 'Beta']);
  const slicePrompts = prompts.filter((p) => /^MOCK_ROLE: requirements-review$/m.test(p));
  assert.equal(slicePrompts.length, 2);
  for (const p of slicePrompts) assert.match(p, /- \*\*requirements\*\* \(md\) -> .*-requirements-draft\.md/);
  const ask = h.asks.find((q) => q.kind === 'plan');
  assert.equal(ask.nodeId, 'n_ref');
  assert.equal(ask.plan.criteria.total, 8);
  assert.equal(ask.plan.decisions.length, 3);
  assert.equal('lead' in ask.plan, false, 'no shape lead, no plan.lead');
  const round = h.orch.state.roleReviews.rounds[0];
  assert.deepEqual([round.node, round.target, round.roles.map((r) => r.key)], ['n_rr', 'requirements', ['alpha', 'beta']]);
});

test('a planner with an extra requirements input: the plan hold reports coverage 7 of 8 with R-ops-1 not covered', async () => {
  await writeGraphWorkflow(COVERAGE_GRAPH);
  process.env.WORCA_MOCK_UNCOVERED = 'R-ops-1';
  const h = start('wf_req_cover');
  const res = await h.done;
  assert.equal(res.status, 'done', res.error);
  const ask = h.asks.find((q) => q.kind === 'plan');
  assert.deepEqual([ask.plan.coverage.passed, ask.plan.coverage.total], [7, 8]);
  assert.deepEqual(ask.plan.coverage.items.filter((i) => !i.pass).map((i) => [i.label, i.detail]),
    [['R-ops-1 · not covered by any step', 'Turning the flag off removes the export']]);
  assert.equal(ask.plan.coverage.items.find((i) => i.id === 'R-sec-2').label, 'R-sec-2 · covered by Step 1');
});

const DIFF_GRAPH = {
  id: 'wf_diff_cover', name: 'Diff coverage', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', ...at, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', ...at, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', ...at, config: {} },
    { id: 'n_review', kind: 'agent', key: 'reviewer', ...at, config: {
      roleReview: { source: 'declared', target: 'diff', checklist: 'coverage', sink: 'implementer' }, extraInputs: [{ id: 'requirements', type: 'md' }],
    } },
    { id: 'n_end', kind: 'end', ...at, config: {} },
  ],
  wires: [
    w('w1', ['n_task', 'task'], ['n_plan', 'task']),
    w('w2', ['n_plan', 'plan'], ['n_impl', 'plan']),
    w('w3', ['n_plan', 'plan'], ['n_review', 'plan']),
    w('w4', ['n_impl', 'done'], ['n_review', 'done']),
    w('w5', ['n_review', 'review'], ['n_impl', 'fix'], { maxCycles: 3 }),
    w('w6', ['n_review', 'pass'], ['n_end', 'result']),
    w('w7', ['n_task', 'task'], ['n_review', 'requirements']),
  ],
};

test('diff target: an uncovered R-* is a blocking finding, no Shaper, no engine change', async () => {
  await writeGraphWorkflow(DIFF_GRAPH);
  process.env.WORCA_MOCK_DIFF_UNCOVERED = 'R-ops-1';
  const prompts = [];
  _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
  const orch = createOrchestrator({ projectDir: gitDir('rrdiff'), workflowId: 'wf_diff_cover', claude: { mock: true },
    prompt: '# Demo\n\n- **R-po-1** People see the chart\n- **R-ops-1** Turning the flag off removes it\n' });
  orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })));
  const res = await orch.run();
  assert.equal(res.status, 'done', res.error);
  const rounds = orch.state.roleReviews.rounds.filter((r) => r.node === 'n_review');
  assert.equal(rounds.length, 2);
  const blocking = rounds[0].roles.flatMap((r) => r.findings).filter((f) => f.severity === 'major' || f.severity === 'critical');
  assert.deepEqual(blocking.map((f) => [f.severity, f.title]), [['major', 'R-ops-1 · not covered by the diff']]);
  const fixes = orch._graphSnapshot.execs.filter((e) => e.nodeId === 'n_impl' && e.bindings?.fix?.path);
  assert.equal(fixes.length, 1);
  assert.match(fixes[0].bindings.fix.path, /-code-role-findings-r1\.md$/);
  const reqPrompts = prompts.filter((p) => /^MOCK_PERSPECTIVE: requirements$/m.test(p));
  assert.equal(reqPrompts.length, 2);
  for (const p of reqPrompts) assert.match(p, /^MOCK_CHECKLIST: R-po-1,R-ops-1$/m);
  const correctness = prompts.find((p) => /^MOCK_PERSPECTIVE: correctness$/m.test(p));
  assert.ok(correctness);
  assert.doesNotMatch(correctness, /not covered by the diff/);
  assert.deepEqual(rounds[1].roles.filter((r) => !r.skipped).flatMap((r) => r.findings).filter((f) => f.severity === 'major'), []);
  assert.ok(orch._graphSnapshot.tokens['n_end.result'], 'round 2 routes pass to End');
});

// Shaper requirements s3 (D1-D6): a hand-built, non-Shaper plan review with a requirements input raises a requirement
// concern through the same plan approval, with no workflow-specific code.
const HANDBUILT_PROMPT = '# Demo\n\n- **R-po-1** People see the chart\n- **R-ops-1** Turning the flag off removes it\n';
const handbuilt = (id, { requirements = true } = {}) => ({
  id, name: `Hand-built ${id}`, version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', ...at, config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', ...at, config: {} },
    { id: 'n_roles', kind: 'agent', key: 'planReviewer', ...at, config: {
      roleReview: { source: 'declared', roles: [{ key: 'alpha', label: 'Alpha' }, { key: 'beta', label: 'Beta' }], target: 'plan', sink: 'refiner' },
      ...(requirements ? { extraInputs: [{ id: 'requirements', type: 'md' }] } : {}),
    } },
    { id: 'n_refine', kind: 'agent', key: 'refiner', ...at, config: { approve: { kind: 'plan', port: 'plan' }, awaitAll: true } },
    { id: 'n_end', kind: 'end', ...at, config: {} },
  ],
  wires: [
    w('w1', ['n_task', 'task'], ['n_plan', 'task']),
    w('w2', ['n_plan', 'plan'], ['n_roles', 'plan']),
    w('w3', ['n_roles', 'plan'], ['n_refine', 'plan']),
    w('w4', ['n_roles', 'findings'], ['n_refine', 'findings']),
    w('w5', ['n_refine', 'revise'], ['n_roles', 'revise'], { maxCycles: 2, onExhausted: 'clean' }),
    w('w6', ['n_refine', 'plan'], ['n_end', 'result']),
    ...(requirements ? [w('w7', ['n_task', 'task'], ['n_roles', 'requirements'])] : []),
  ],
});
const shellsOf = (execs, nodeId) => execs.filter((e) => e.nodeId === nodeId && e.kind !== 'task' && e.status === 'start');
function startHandbuilt(workflowId) {
  // The approval stop is armed by a run `shape` (this file's convention); the workflow itself is not Shaper's.
  const orch = createOrchestrator({ projectDir: gitDir('rrconcern'), workflowId, prompt: HANDBUILT_PROMPT, claude: { mock: true },
    shape: { perspectives: ['product'] } });
  const asks = []; const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => { asks.push(q); setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })); });
  return { orch, asks, execs, done: orch.run() };
}
const withRoleReview = async (table, fn) => {
  process.env.WORCA_MOCK_ROLE_REVIEW = JSON.stringify(table);
  try { return await fn(); } finally { delete process.env.WORCA_MOCK_ROLE_REVIEW; }
};

test('hand-built plan review (wf_handbuilt_req): a finding naming R-po-1 pauses on one plan approval with the concern', () => withRoleReview(
  { alpha: { 1: { severity: 'major', requirement: 'R-po-1' } } }, async () => {
    await writeGraphWorkflow(handbuilt('wf_handbuilt_req'));
    const prompts = [];
    _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
    const h = startHandbuilt('wf_handbuilt_req');
    const res = await h.done;
    assert.equal(res.status, 'done', res.error);
    assert.equal(h.orch.workflowId ?? h.orch.opts.workflowId, 'wf_handbuilt_req');
    assert.equal(h.orch.runShape?.slice, undefined, 'no Shaper slice');
    assert.deepEqual(h.asks.map((q) => q.id), ['plan-n_refine-1']);
    assert.equal(h.asks[0].concern.kind, 'requirement');
    assert.deepEqual(h.asks[0].concern.requirements, ['R-po-1']);
    assert.equal(shellsOf(h.execs, 'n_plan').length, 1, 'the Planner ran once');
    assert.equal(shellsOf(h.execs, 'n_refine').length, 1, 'Refine ran once');
    const reviewer = prompts.filter((p) => /^MOCK_PERSPECTIVE: alpha$/m.test(p));
    assert.ok(reviewer.length >= 1);
    for (const p of reviewer) assert.match(p, /^## Requirement concerns$/m);
  }));

test('hand-built plan review without a requirements input: no concern block in the prompt, and the finding blocks', () => withRoleReview(
  { alpha: { 1: { severity: 'major', requirement: 'R-po-1' } } }, async () => {
    await writeGraphWorkflow(handbuilt('wf_handbuilt_plain', { requirements: false }));
    const prompts = [];
    _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
    const h = startHandbuilt('wf_handbuilt_plain');
    const res = await h.done;
    assert.equal(res.status, 'done', res.error);
    assert.equal(prompts.some((p) => /^## Requirement concerns$/m.test(p)), false);
    assert.equal(h.asks[0].concern, undefined);
    assert.equal(h.orch.state.roleReviews.rounds.filter((r) => r.node === 'n_roles').length, 2, 'the finding blocked: a second round');
  }));

test('diff and requirements targets: a finding carrying an agreed requirement still fires revise', () => withRoleReview(
  { correctness: { 1: { severity: 'major', requirement: 'R-po-1' } }, alpha: { 1: { severity: 'major', requirement: 'R-po-1' } } }, async () => {
    await writeGraphWorkflow(DIFF_GRAPH);
    const orch = createOrchestrator({ projectDir: gitDir('rrdiffc'), workflowId: 'wf_diff_cover', claude: { mock: true }, prompt: HANDBUILT_PROMPT });
    orch.on('question', (q) => setImmediate(() => orch.answer(q.id, q.kind === 'plan' ? { decision: 'approve' } : { answers: [] })));
    assert.equal((await orch.run()).status, 'done');
    const diff = orch.state.roleReviews.rounds.filter((r) => r.node === 'n_review');
    assert.equal(diff.length, 2, 'the diff finding blocked');
    assert.equal(diff[0].roles.flatMap((r) => r.findings).some((f) => 'requirement' in f), false);
    await writeGraphWorkflow(REQUIREMENTS_GRAPH);
    const h = start('wf_req_review');
    assert.equal((await h.done).status, 'done');
    const req = h.orch.state.roleReviews.rounds.filter((r) => r.node === 'n_rr');
    assert.equal(req.length, 2, 'the requirements finding blocked');
  }));

test('guard: the concern code path names no workflow', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const body = (src, name) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => new RegExp(`^\\s*(async\\s+)?(function\\s+)?${name}\\(`).test(l));
    assert.ok(from >= 0, `found ${name}`);
    const indent = /^\s*/.exec(lines[from])[0].length;
    const to = lines.findIndex((l, i) => i > from && new RegExp(`^\\s{0,${indent}}\\}`).test(l));
    return lines.slice(from, to + 1).join('\n');
  };
  assert.doesNotMatch(read('../src/shared/review/plan-concern.mjs'), /wf_/);
  assert.doesNotMatch(read('../src/shared/graph/role-review-step.mjs'), /wf_/);
  assert.doesNotMatch(body(read('../src/core/orchestrator.mjs'), '_planAsk'), /wf_/);
  assert.doesNotMatch(body(read('../src/core/graph/executor.mjs'), 'roleBriefFor'), /wf_/);
  assert.match(body(read('../src/core/graph/executor.mjs'), 'roleBriefFor'), /requirementConcernBlock/);
  assert.match(body(read('../src/core/orchestrator.mjs'), '_planAsk'), /requirementConcernOf/);
});
