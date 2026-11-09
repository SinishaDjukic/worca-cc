// test/workflows-shape.test.mjs — the reserved Shape it first workflows (wf_shape, wf_shape_ux) and the
// shaped-run helpers in src/core/shape/run.mjs.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  readWorkflow, listWorkflows, writeGraphWorkflow, deleteWorkflow, assertRunnableWorkflow, resolveGraph,
} from '../src/core/workflows.mjs';
import * as workflows from '../src/core/workflows.mjs';
import {
  SHAPE_WORKFLOW_ID, SHAPE_UX_WORKFLOW_ID, SHAPE_WORKFLOW_NAME, SHAPE_CLARIFY_HINTS,
  GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW, GRAPH_DEFAULT_WORKFLOW, RESERVED_WORKFLOW_IDS, isReservedWorkflowId,
  SHAPE_CODE_ROLES_CONFIG,
} from '../src/core/graph/builtin-workflows.mjs';
import {
  resolveShapeRequest, validatePlanAnswer, renderPlanFeedback, isShapeWorkflowId, PLAN_ASK_KIND, PLAN_FEEDBACK_MAX,
  initialShaping, planFileOf,
} from '../src/core/shape/run.mjs';
import { DEFAULT_PERSPECTIVES, PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { _testing } from '../src/core/graph/executor.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { getDb } from '../src/core/db.mjs';
import { RESERVED_WORKFLOW_IDS as COMPOSER_RESERVED } from '../ui/public/graph/composer.mjs';

useTempHome(after);

const edge = (w) => `${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`;

test('wf_shape: Default\'s graph with the Clarify cap, role reviews before Refine and the plan approval hold on Refine', () => {
  const wf = GRAPH_SHAPE_WORKFLOW;
  assert.equal(SHAPE_WORKFLOW_ID, 'wf_shape');
  assert.equal(SHAPE_UX_WORKFLOW_ID, 'wf_shape_ux');
  assert.equal(SHAPE_WORKFLOW_NAME, 'Shaper');
  assert.equal(wf.id, 'wf_shape'); assert.equal(wf.name, 'Shaper'); assert.equal(wf.version, 2);
  assert.deepEqual(wf.nodes.find((n) => n.id === 'n_clarify').config, { maxQuestions: 3, promptHints: SHAPE_CLARIFY_HINTS });
  assert.deepEqual(wf.nodes.find((n) => n.id === 'n_refine').config.approve, { kind: 'plan', port: 'plan' });
  assert.deepEqual(wf.nodes.map((n) => [n.id, n.kind, n.key ?? null]),
    [...GRAPH_DEFAULT_WORKFLOW.nodes.map((n) => [n.id, n.kind, n.key ?? null]), ['n_roles', 'agent', 'planReviewer']]);
  assert.deepEqual(wf.wires.map(edge), [
    'n_task.task->n_clarify.task', 'n_task.task->n_plan.task', 'n_clarify.answers->n_plan.answers',
    'n_plan.plan->n_roles.plan', 'n_roles.plan->n_refine.plan', 'n_roles.findings->n_refine.findings',
    'n_refine.revise->n_roles.revise',
    ...GRAPH_DEFAULT_WORKFLOW.wires.filter((w) => !['w1', 'w2', 'w3', 'w4', 'w5'].includes(w.id)).map(edge),
  ]);
  assert.deepEqual(wf.wires.filter((w) => !['w4', 'w5', 'w17', 'w18'].includes(w.id)),
    GRAPH_DEFAULT_WORKFLOW.wires.filter((w) => !['w4', 'w5'].includes(w.id)), 'Default\'s other wires and loop budgets, unchanged');
  assert.ok(Object.isFrozen(wf) && Object.isFrozen(wf.nodes[1].config) && Object.isFrozen(wf.wires.find((w) => w.id === 'w5').config), 'deep-frozen');
});

test('wf_shape_ux: the same head plus the manual-test tail, with no review.pass → end wire', () => {
  const wf = GRAPH_SHAPE_UX_WORKFLOW;
  assert.equal(wf.id, 'wf_shape_ux'); assert.equal(wf.name, 'Shaper'); assert.equal(wf.version, 2);
  assert.deepEqual(wf.nodes.find((n) => n.id === 'n_clarify').config, { maxQuestions: 3, promptHints: SHAPE_CLARIFY_HINTS });
  assert.deepEqual(wf.nodes.find((n) => n.id === 'n_refine').config.approve, { kind: 'plan', port: 'plan' });
  assert.ok(wf.nodes.some((n) => n.id === 'n_check' && n.key === 'manualTestsChecklist'));
  assert.ok(wf.nodes.some((n) => n.id === 'n_webui' && n.key === 'manualWebUiTesting'));
  assert.ok(!wf.wires.some((w) => w.from.node === 'n_review' && w.from.port === 'pass' && w.to.node === 'n_end'));
  assert.ok(wf.wires.some((w) => edge(w) === 'n_webui.pass->n_end.result'));
  assert.ok(wf.wires.some((w) => edge(w) === 'n_or.out->n_impl.fix'));
  assert.ok(Object.isFrozen(wf) && Object.isFrozen(wf.nodes[1].config) && Object.isFrozen(wf.wires.find((w) => w.id === 'w5').config), 'deep-frozen');
});

test('both are reserved ids, in the server list and the composer twin', () => {
  for (const id of ['wf_shape', 'wf_shape_ux']) {
    assert.ok(RESERVED_WORKFLOW_IDS.includes(id), id);
    assert.equal(isReservedWorkflowId(id), true, id);
    assert.ok(COMPOSER_RESERVED.has(id), `composer ${id}`);
  }
  assert.deepEqual([...COMPOSER_RESERVED].sort(), [...['wf_default', 'wf_lean_build', 'wf_memory_defrag', 'wf_shape', 'wf_shape_ux']].sort());
});

test('role reviews (spec §3): both shape graphs fan the plan out to n_roles and loop only roles → refine, at most 2 rounds', () => {
  for (const wf of [GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW]) {
    const roles = wf.nodes.find((n) => n.id === 'n_roles');
    assert.equal(roles.key, 'planReviewer', wf.id);
    assert.deepEqual(roles.config, {
      roleReview: {
        roles: PERSPECTIVES.map(({ key, label }) => ({ key, label })),
        source: 'picked', target: 'plan', checklist: 'perspectives', sink: 'refiner', secondOpinion: 'product',
      },
    }, wf.id, 'no model pins: the models are Models page homes (factory-models.mjs)');
    assert.equal(wf.nodes.find((n) => n.id === 'n_refine').config.awaitAll, true, wf.id);
    assert.ok(!wf.wires.some((w) => edge(w) === 'n_refine.revise->n_refine.revise'), `${wf.id}: no refiner self-loop`);
    const w5 = wf.wires.find((w) => w.id === 'w5');
    assert.equal(edge(w5), 'n_refine.revise->n_roles.revise', wf.id);
    assert.deepEqual(w5.config, { maxCycles: 2, onExhausted: 'clean' }, wf.id);
    for (const e of ['n_plan.plan->n_roles.plan', 'n_roles.plan->n_refine.plan', 'n_roles.findings->n_refine.findings']) {
      assert.ok(wf.wires.some((w) => edge(w) === e), `${wf.id}: ${e}`);
    }
  }
  assert.ok(GRAPH_DEFAULT_WORKFLOW.wires.some((w) => w.id === 'w5' && edge(w) === 'n_refine.revise->n_refine.revise'), 'wf_default keeps its self-loop');
  assert.ok(!GRAPH_DEFAULT_WORKFLOW.nodes.some((n) => n.key === 'planReviewer'));
});

test('code role reviews (#990 slice 4): both shape graphs\' Review declares correctness, security and fit on the diff, wires unchanged', () => {
  const spec = { roleReview: { roles: [{ key: 'correctness', label: 'Correctness' }, { key: 'security', label: 'Security' }, { key: 'fit', label: 'Project fit' }],
    source: 'declared', target: 'diff', sink: 'implementer' } };
  assert.deepEqual(SHAPE_CODE_ROLES_CONFIG, spec);
  for (const wf of [GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW]) {
    const review = wf.nodes.find((n) => n.id === 'n_review');
    assert.equal(review.key, 'reviewer', wf.id);
    assert.deepEqual(review.config, spec, `${wf.id}: no node model, no diversity pick`);
  }
  const into = (wf) => wf.wires.filter((w) => w.from.node === 'n_review' || w.to.node === 'n_review').map((w) => `${w.id} ${edge(w)}`);
  assert.deepEqual(into(GRAPH_SHAPE_WORKFLOW), ['w7 n_refine.plan->n_review.plan', 'w8 n_impl.done->n_review.done',
    'w9 n_review.review->n_impl.fix', 'w10 n_review.pass->n_end.result']);
  assert.deepEqual(into(GRAPH_SHAPE_UX_WORKFLOW), ['w7 n_refine.plan->n_review.plan', 'w8 n_impl.done->n_review.done',
    'w9 n_review.review->n_or.in1', 'w12 n_review.pass->n_check.await']);
  assert.deepEqual(GRAPH_DEFAULT_WORKFLOW.nodes.find((n) => n.id === 'n_review').config, {}, 'Default keeps its single reviewer');
});

test('both validate with zero errors and zero warnings', () => {
  const reg = loadAgentRegistry();
  const portsFn = registryPortsFn(reg, loadScriptRegistry({ agentKeys: Object.keys(reg) }));
  for (const wf of [GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW]) {
    const r = validateGraph(wf, portsFn);
    assert.ok(r.ok, `${wf.id}: ${JSON.stringify(r.errors)}`);
    assert.deepEqual(r.warnings || [], [], `${wf.id} warnings`);
  }
});

test('they read, run and resolve on a fresh home, and are never listed', async () => {
  for (const [id, wf] of [['wf_shape', GRAPH_SHAPE_WORKFLOW], ['wf_shape_ux', GRAPH_SHAPE_UX_WORKFLOW]]) {
    assert.equal(await readWorkflow(id), wf);
    assert.equal(await assertRunnableWorkflow(id), wf);
    const resolved = await resolveGraph(process.cwd(), id, loadAgentRegistry());
    assert.deepEqual(Object.keys(resolved.nodes).sort(), wf.nodes.map((n) => n.id).sort());
  }
  assert.ok(!(await listWorkflows()).some((w) => w.id === 'wf_shape' || w.id === 'wf_shape_ux'));
  assert.equal(workflows.GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_WORKFLOW, 're-exported for the CLI and the Ask catalog');
});

test('a save cannot claim either id, a delete is refused, and the name "Shape" is reserved', async () => {
  for (const id of ['wf_shape', 'wf_shape_ux']) {
    const saved = await writeGraphWorkflow({ id, name: 'Mine', nodes: [], wires: [] });
    assert.equal(saved.id, 'wf_mine', 'an explicit reserved id falls back to the slug of the name');
    assert.equal(await deleteWorkflow(id), false);
  }
  await assert.rejects(() => writeGraphWorkflow({ name: 'Shape', nodes: [], wires: [] }),
    (e) => e.code === 'RESERVED_NAME' && /Shaper/.test(e.message));
});

test('resolveShapeRequest: no shape and no shape workflow leaves the request alone', () => {
  assert.deepEqual(resolveShapeRequest({}), { ok: true, shape: null, workflowId: null });
  assert.deepEqual(resolveShapeRequest({ workflowId: ' wf_default ' }), { ok: true, shape: null, workflowId: 'wf_default' });
  assert.equal(isShapeWorkflowId('wf_shape'), true);
  assert.equal(isShapeWorkflowId('wf_shape_ux'), true);
  assert.equal(isShapeWorkflowId('wf_default'), false);
});

test('resolveShapeRequest: normalizes perspectives and picks the workflow', () => {
  assert.deepEqual(resolveShapeRequest({ shape: { perspectives: ['qa'] } }),
    { ok: true, shape: { perspectives: ['product', 'qa'] }, workflowId: 'wf_shape' });
  assert.deepEqual(resolveShapeRequest({ shape: { perspectives: ['ux'] } }),
    { ok: true, shape: { perspectives: ['product', 'ux'] }, workflowId: 'wf_shape_ux' });
  assert.deepEqual(resolveShapeRequest({ shape: {} }),
    { ok: true, shape: { perspectives: [...DEFAULT_PERSPECTIVES] }, workflowId: 'wf_shape' });
  assert.deepEqual(resolveShapeRequest({ shape: { perspectives: ['qa'] }, workflowId: 'wf_shape' }).workflowId, 'wf_shape');
  // A shape workflow named without `shape` is accepted as-is (resume / explicit), with no shape field.
  assert.deepEqual(resolveShapeRequest({ workflowId: 'wf_shape' }).ok, true);
});

test('resolveShapeRequest: bad input is an error, not a throw', () => {
  const bad = (req) => { const r = resolveShapeRequest(req); assert.equal(r.ok, false, JSON.stringify(req)); return r.error; };
  assert.match(bad({ shape: { perspectives: ['nope'] } }), /nope/);
  assert.match(bad({ shape: { perspectives: ['qa'], slices: 3 } }), /slices/);
  assert.match(bad({ shape: { perspectives: ['qa'] }, workflowId: 'wf_default' }), /wf_default/);
  assert.match(bad({ shape: 'x' }), /object/);
  assert.match(bad({ shape: null }), /object/);
  assert.match(bad({ shape: [] }), /object/);
  assert.match(bad({ shape: { perspectives: 'qa' } }), /array/);
});

test('validatePlanAnswer: approve and stop are always ok', () => {
  assert.equal(PLAN_ASK_KIND, 'plan');
  assert.deepEqual(validatePlanAnswer({ decision: 'approve' }), { ok: true, payload: { decision: 'approve' } });
  assert.deepEqual(validatePlanAnswer({ decision: 'stop', feedback: 'ignored' }), { ok: true, payload: { decision: 'stop' } });
});

test('validatePlanAnswer: a failing criteria check refuses approve and admits revise and stop', () => {
  const criteria = { ok: false, passed: 6, total: 8 };
  assert.deepEqual(validatePlanAnswer({ decision: 'approve' }, { criteria, decisions: [] }),
    { ok: false, errors: [{ path: 'decision', code: 'invalid', message: 'the requirements check has 2 to fix: ask for changes' }] });
  assert.equal(validatePlanAnswer({ decision: 'stop' }, { criteria, decisions: [] }).ok, true);
  assert.equal(validatePlanAnswer({ decision: 'revise', feedback: 'x' }, { revisable: true, criteria, decisions: [] }).ok, true);
  assert.equal(validatePlanAnswer({ decision: 'approve' }, { criteria: { ok: true, passed: 8, total: 8 }, decisions: [] }).ok, true);
});

test('validatePlanAnswer: revise needs feedback and a revisable plan', () => {
  assert.equal(validatePlanAnswer({ decision: 'revise', feedback: 'x' }).ok, false, 'not revisable');
  const none = validatePlanAnswer({ decision: 'revise', feedback: '   ' }, { revisable: true });
  assert.equal(none.ok, false); assert.equal(none.errors[0].path, 'feedback');
  assert.equal(validatePlanAnswer({ decision: 'revise' }, { revisable: true }).ok, false);
  assert.deepEqual(validatePlanAnswer({ decision: 'revise', feedback: '  tighten scope  ' }, { revisable: true }),
    { ok: true, payload: { decision: 'revise', feedback: 'tighten scope' } });
  const long = validatePlanAnswer({ decision: 'revise', feedback: 'x'.repeat(PLAN_FEEDBACK_MAX + 1) }, { revisable: true });
  assert.equal(long.ok, false); assert.equal(long.errors[0].code, 'too-long');
  assert.equal(validatePlanAnswer({ decision: 'revise', feedback: 'x'.repeat(PLAN_FEEDBACK_MAX) }, { revisable: true }).ok, true);
});

test('validatePlanAnswer: junk is rejected', () => {
  for (const raw of [null, undefined, 'approve', {}, { decision: 'maybe' }, { decision: 7 }]) {
    const r = validatePlanAnswer(raw, { revisable: true });
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.equal(r.errors[0].path, 'decision');
  }
});

test('validatePlanAnswer: a revise may change perspectives, never UX', () => {
  const ok = validatePlanAnswer({ decision: 'revise', feedback: 'x', perspectives: ['security', 'architect'] },
    { revisable: true, perspectives: ['product', 'architect', 'qa'] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.payload.perspectives.slice().sort(), ['architect', 'product', 'security']);
  const unknown = validatePlanAnswer({ decision: 'revise', feedback: 'x', perspectives: ['nope'] }, { revisable: true });
  assert.equal(unknown.ok, false); assert.equal(unknown.errors[0].path, 'perspectives');
  const addUx = validatePlanAnswer({ decision: 'revise', feedback: 'x', perspectives: ['product', 'ux'] },
    { revisable: true, perspectives: ['product', 'qa'] });
  assert.equal(addUx.ok, false); assert.equal(addUx.errors[0].path, 'perspectives'); assert.match(addUx.errors[0].message, /UX/);
  const dropUx = validatePlanAnswer({ decision: 'revise', feedback: 'x', perspectives: ['product'] },
    { revisable: true, perspectives: ['product', 'ux'] });
  assert.equal(dropUx.ok, false); assert.equal(dropUx.errors[0].path, 'perspectives');
  assert.deepEqual(validatePlanAnswer({ decision: 'revise', feedback: 'x' }, { revisable: true, perspectives: ['product'] }),
    { ok: true, payload: { decision: 'revise', feedback: 'x' } }, 'no perspectives, payload unchanged');
});

test('initialShaping: defaults, and a resume keeps its versions', () => {
  assert.deepEqual(initialShaping(null), { perspectives: [...DEFAULT_PERSPECTIVES], rounds: [], approved: null, savedTo: null });
  const shape = { perspectives: ['product', 'qa'] };
  const s = initialShaping(shape, { rounds: [{ round: 1, file: '/p/a.md' }, { round: 'x' }, null], approved: { round: 1, file: '/p/a.md' }, savedTo: 'plans/a.md', perspectives: ['ignored'] });
  assert.deepEqual(s, { perspectives: ['product', 'qa'], rounds: [{ round: 1, file: '/p/a.md' }], approved: { round: 1, file: '/p/a.md' }, savedTo: 'plans/a.md' });
  assert.notEqual(s.perspectives, shape.perspectives, 'a copy');
  assert.deepEqual(initialShaping(shape, []).rounds, [], 'a non-object saved is ignored');
});

test('planFileOf: a round, else the open plan ask, else the approved plan; never a bad path', () => {
  const shaping = { rounds: [{ round: 1, file: '/p/plan-v1.md' }, { round: 2, file: 'rel/plan.md' }, { round: 3, file: '/p/plan.txt' }], approved: { round: 1, file: '/p/plan-v1.md' } };
  const pendingQuestion = { kind: PLAN_ASK_KIND, plan: { file: '/p/plan-v4.md' } };
  assert.equal(planFileOf({ shaping }, 1), '/p/plan-v1.md');
  assert.equal(planFileOf({ shaping }, '1'), '/p/plan-v1.md');
  assert.equal(planFileOf({ shaping }, 2), null, 'not absolute');
  assert.equal(planFileOf({ shaping }, 3), null, 'not .md');
  assert.equal(planFileOf({ shaping }, 9), null, 'no such round');
  assert.equal(planFileOf({ shaping }, '1.5'), null, 'not an integer');
  assert.equal(planFileOf({ shaping }, 'x'), null);
  assert.equal(planFileOf({ pendingQuestion, shaping }), '/p/plan-v4.md');
  assert.equal(planFileOf({ pendingQuestion: { kind: 'clarify', plan: { file: '/p/x.md' } }, shaping }), '/p/plan-v1.md');
  assert.equal(planFileOf({ pendingQuestion: { kind: PLAN_ASK_KIND, plan: { file: 'x.md' } }, shaping }), '/p/plan-v1.md');
  assert.equal(planFileOf({ shaping: { rounds: [], approved: null } }), null);
  assert.equal(planFileOf(), null);
});

test('renderPlanFeedback carries the feedback and the plan file', () => {
  const md = renderPlanFeedback('  add a rollback step  ', '/runs/x/plan.md');
  assert.match(md, /^# Feedback on the plan/);
  assert.ok(md.includes('add a rollback step'));
  assert.ok(md.includes('`/runs/x/plan.md`'));
  assert.ok(!renderPlanFeedback('x').includes('at `'), 'no plan file, no path');
});

test('validatePlanAnswer: revise takes an optional source; only check is carried, anything else is a 422', () => {
  const ok = (raw) => validatePlanAnswer(raw, { revisable: true });
  assert.deepEqual(ok({ decision: 'revise', feedback: 'x' }).payload, { decision: 'revise', feedback: 'x' });
  assert.deepEqual(ok({ decision: 'revise', feedback: 'x', source: 'person' }).payload, { decision: 'revise', feedback: 'x' });
  assert.deepEqual(ok({ decision: 'revise', feedback: 'x', source: 'check' }).payload, { decision: 'revise', feedback: 'x', source: 'check' });
  assert.deepEqual(ok({ decision: 'revise', feedback: 'x', source: 'bot' }).errors, [{ path: 'source', code: 'invalid', message: 'source must be person or check' }]);
});

// ── conflict picks (#990 slice 3): optional on every decision, checked against the asked round's conflicts ──

const CONFLICTS = [{ id: 'conflict-1', findings: ['ux-1-1', 'qa-1-1'], roles: ['ux', 'qa'], section: 'Testing', question: 'Modal or inline?', options: ['Modal', 'Inline'] }];

test('validatePlanAnswer: valid picks pass on approve, revise and stop', () => {
  const picks = [{ id: 'conflict-1', choice: 'Inline' }];
  assert.deepEqual(validatePlanAnswer({ decision: 'approve', conflicts: picks }, { conflicts: CONFLICTS }),
    { ok: true, payload: { decision: 'approve', conflicts: picks } });
  assert.deepEqual(validatePlanAnswer({ decision: 'stop', conflicts: picks }, { conflicts: CONFLICTS }).payload, { decision: 'stop', conflicts: picks });
  assert.deepEqual(validatePlanAnswer({ decision: 'revise', feedback: 'x', conflicts: picks }, { revisable: true, conflicts: CONFLICTS }).payload,
    { decision: 'revise', feedback: 'x', conflicts: picks });
});

test('validatePlanAnswer: an unknown pick id is dropped; approve without picks is ok', () => {
  assert.deepEqual(validatePlanAnswer({ decision: 'approve', conflicts: [{ id: 'conflict-9', choice: 'x' }] }, { conflicts: CONFLICTS }),
    { ok: true, payload: { decision: 'approve', conflicts: [] } });
  assert.deepEqual(validatePlanAnswer({ decision: 'approve' }, { conflicts: CONFLICTS }), { ok: true, payload: { decision: 'approve' } });
});

test('validatePlanAnswer: bad picks refuse with 422 errors', () => {
  const r = validatePlanAnswer({ decision: 'approve', conflicts: [{ id: 'conflict-1', choice: 'x'.repeat(501) }] }, { conflicts: CONFLICTS });
  assert.deepEqual(r, { ok: false, errors: [{ path: 'conflicts', code: 'invalid', message: 'a decision is over 500 characters' }] });
});

/** A mock wf_shape run whose UX and QA findings conflict on one section; `onPlan(q, orch)` answers the plan ask. */
async function conflictRun(onPlan) {
  const prev = process.env.WORCA_MOCK_CONFLICTS;
  process.env.WORCA_MOCK_CONFLICTS = JSON.stringify([{ findings: ['ux-1-1', 'qa-1-1'], question: 'Modal or inline?', options: ['Modal', 'Inline'] }]);
  try {
    const orch = createOrchestrator({ projectDir: gitDir('conflicts'), workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: { perspectives: ['ux', 'qa'] } });
    let plan = null;
    orch.on('question', (q) => {
      if (q.kind === 'plan') { plan = q; setImmediate(() => onPlan(q, orch)); } else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
    });
    const res = await orch.run();
    assert.equal(res.status, 'done', res.error);
    const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(orch.getState().id).map((r) => r.text);
    return { orch, plan, audit, text: readFileSync(plan.plan.file, 'utf8') };
  } finally {
    if (prev === undefined) delete process.env.WORCA_MOCK_CONFLICTS; else process.env.WORCA_MOCK_CONFLICTS = prev;
  }
}
const PICK_LINE = '- **conflict-1** — Modal or inline? → **Inline (decided at plan approval)**';

test('approve with a pick: a refused answer first changes nothing; the pick lands in Clarifications once, with an audit line', async () => {
  let before = null; let auditBefore = 0;
  const { text, audit } = await conflictRun((q, orch) => {
    before = readFileSync(q.plan.file, 'utf8');
    auditBefore = getDb().prepare('SELECT count(*) AS n FROM pipeline_events WHERE pipeline_id = ?').get(orch.getState().id).n;
    assert.throws(() => orch.answer(q.id, { decision: 'approve', conflicts: [{ id: 'conflict-1', choice: 'x'.repeat(501) }] }), (e) => e.code === 'INVALID_ANSWER'
      && e.errors[0].path === 'conflicts');
    assert.equal(readFileSync(q.plan.file, 'utf8'), before, 'no plan write');
    assert.equal(getDb().prepare('SELECT count(*) AS n FROM pipeline_events WHERE pipeline_id = ?').get(orch.getState().id).n, auditBefore, 'no audit line');
    orch.answer(q.id, { decision: 'approve', conflicts: [{ id: 'conflict-1', choice: 'Inline' }] });
  });
  assert.equal(text.split(PICK_LINE).length - 1, 1);
  assert.match(text.slice(text.indexOf('## Clarifications (Q&A)')), new RegExp(PICK_LINE.replace(/[*?()]/g, '\\$&')));
  assert.ok(audit.includes('Plan approval: conflict-1 decided: Inline.'), audit.join('\n'));
});

test('approve without a pick never blocks: the conflict is audited as left undecided and the plan is unchanged', async () => {
  let before = null;
  const { text, audit } = await conflictRun((q, orch) => { before = readFileSync(q.plan.file, 'utf8'); orch.answer(q.id, { decision: 'approve' }); });
  assert.equal(text, before);
  assert.ok(audit.includes('conflict-1 left undecided at approval'), audit.join('\n'));
});

// ── Project fit (slice 3): the house brief reaches the fit reviewer only ──

// settings.json resolves through HOME, not WORCA_HOME: sandbox it for the shaped runs below.
let sandboxHome;
const prevEnv = {};
const ENV = ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK_ROLE_REVIEW'];
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-wfshape-home-'));
  for (const k of ENV) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  delete process.env.WORCA_MOCK_ROLE_REVIEW;
});
afterEach(() => { _testing.runClaude = null; });
after(async () => {
  for (const k of ENV) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** A mock wf_shape run on a project with one committed component (so it has a house brief); every prompt captured. */
async function shapedRun(perspectives) {
  const dir = gitDir('fit');
  mkdirSync(join(dir, 'ui/public/shape'), { recursive: true });
  writeFileSync(join(dir, 'ui/public/shape/check-row.mjs'), '// ui/public/shape/check-row.mjs — the shape check row: one row per check.\nexport const row = 1;\n');
  execSync('git add -A && git -c user.email=t@t -c user.name=t commit -qm brief', { cwd: dir });
  const prompts = [];
  _testing.runClaude = (o) => { prompts.push(o.prompt); return runClaude(o); };
  const orch = createOrchestrator({ projectDir: dir, workflowId: 'wf_shape', prompt: 'demo', claude: { mock: true }, shape: { perspectives } });
  const execs = [];
  orch.on('exec', (e) => execs.push(e));
  orch.on('question', (q) => {
    if (q.kind === 'plan') setImmediate(() => orch.answer(q.id, { decision: 'approve' }));
    else if (q.kind === 'clarify' || q.kind === 'questions') setImmediate(() => orch.answer(q.id, { answers: [] }));
  });
  await orch.run();
  return { prompts, execs };
}
const reviewerKeys = (prompts) => prompts.filter((p) => /^MOCK_ROLE: plan-review$/m.test(p))
  .map((p) => /^MOCK_PERSPECTIVE: (\S+)$/m.exec(p)?.[1]).sort();
const BRIEF_RE = /^# House brief$/m;

test('Project fit unticked: no fit reviewer starts and no prompt carries the house brief', async () => {
  const { prompts, execs } = await shapedRun(['product', 'qa']);
  assert.deepEqual(reviewerKeys(prompts), ['product', 'qa']);
  assert.equal(execs.some((e) => e.nodeId === 'n_roles' && e.kind === 'task' && e.title === 'Project fit'), false);
  assert.equal(prompts.filter((p) => BRIEF_RE.test(p)).length, 0);
});

test('Project fit ticked: only the fit reviewer\'s prompt carries the house brief', async () => {
  const { prompts } = await shapedRun(['product', 'qa', 'fit']);
  assert.deepEqual(reviewerKeys(prompts), ['fit', 'product', 'qa']);
  const withBrief = prompts.filter((p) => BRIEF_RE.test(p));
  assert.equal(withBrief.length, 1);
  assert.match(withBrief[0], /^MOCK_PERSPECTIVE: fit$/m);
  assert.match(withBrief[0], /ui\/public\/shape\/check-row\.mjs — the shape check row/);
});
