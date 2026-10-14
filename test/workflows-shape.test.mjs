// test/workflows-shape.test.mjs — the reserved Shape it first workflows (wf_shape, wf_shape_ux) and the
// shaped-run helpers in src/core/shape/run.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  readWorkflow, listWorkflows, writeGraphWorkflow, deleteWorkflow, assertRunnableWorkflow, resolveGraph,
} from '../src/core/workflows.mjs';
import * as workflows from '../src/core/workflows.mjs';
import {
  SHAPE_WORKFLOW_ID, SHAPE_UX_WORKFLOW_ID, SHAPE_WORKFLOW_NAME, SHAPE_CLARIFY_HINTS,
  GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW, GRAPH_DEFAULT_WORKFLOW, RESERVED_WORKFLOW_IDS, isReservedWorkflowId,
} from '../src/core/graph/builtin-workflows.mjs';
import {
  resolveShapeRequest, validatePlanAnswer, renderPlanFeedback, isShapeWorkflowId, PLAN_ASK_KIND, PLAN_FEEDBACK_MAX,
} from '../src/core/shape/run.mjs';
import { DEFAULT_PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { loadScriptRegistry } from '../src/core/script-registry.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { RESERVED_WORKFLOW_IDS as COMPOSER_RESERVED } from '../ui/public/graph/composer.mjs';

useTempHome(after);

const edge = (w) => `${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`;

test('wf_shape: Default\'s graph with the Clarify cap and the plan approval hold on Refine', () => {
  const wf = GRAPH_SHAPE_WORKFLOW;
  assert.equal(SHAPE_WORKFLOW_ID, 'wf_shape');
  assert.equal(SHAPE_UX_WORKFLOW_ID, 'wf_shape_ux');
  assert.equal(SHAPE_WORKFLOW_NAME, 'Shape it first');
  assert.equal(wf.id, 'wf_shape'); assert.equal(wf.name, 'Shape it first'); assert.equal(wf.version, 2);
  assert.deepEqual(wf.nodes.find((n) => n.id === 'n_clarify').config, { maxQuestions: 3, promptHints: SHAPE_CLARIFY_HINTS });
  assert.deepEqual(wf.nodes.find((n) => n.id === 'n_refine').config.approve, { kind: 'plan', port: 'plan' });
  assert.deepEqual(wf.nodes.map((n) => [n.id, n.kind, n.key ?? null]),
    GRAPH_DEFAULT_WORKFLOW.nodes.map((n) => [n.id, n.kind, n.key ?? null]));
  assert.deepEqual(wf.wires, GRAPH_DEFAULT_WORKFLOW.wires, 'the same wires and loop budgets as Default w1–w10');
  assert.ok(Object.isFrozen(wf) && Object.isFrozen(wf.nodes[1].config) && Object.isFrozen(wf.wires[4].config), 'deep-frozen');
});

test('wf_shape_ux: the same head plus the manual-test tail, with no review.pass → end wire', () => {
  const wf = GRAPH_SHAPE_UX_WORKFLOW;
  assert.equal(wf.id, 'wf_shape_ux'); assert.equal(wf.name, 'Shape it first'); assert.equal(wf.version, 2);
  assert.deepEqual(wf.nodes.find((n) => n.id === 'n_clarify').config, { maxQuestions: 3, promptHints: SHAPE_CLARIFY_HINTS });
  assert.deepEqual(wf.nodes.find((n) => n.id === 'n_refine').config.approve, { kind: 'plan', port: 'plan' });
  assert.ok(wf.nodes.some((n) => n.id === 'n_check' && n.key === 'manualTestsChecklist'));
  assert.ok(wf.nodes.some((n) => n.id === 'n_webui' && n.key === 'manualWebUiTesting'));
  assert.ok(!wf.wires.some((w) => w.from.node === 'n_review' && w.from.port === 'pass' && w.to.node === 'n_end'));
  assert.ok(wf.wires.some((w) => edge(w) === 'n_webui.pass->n_end.result'));
  assert.ok(wf.wires.some((w) => edge(w) === 'n_or.out->n_impl.fix'));
  assert.ok(Object.isFrozen(wf) && Object.isFrozen(wf.nodes[1].config) && Object.isFrozen(wf.wires[4].config), 'deep-frozen');
});

test('both are reserved ids, in the server list and the composer twin', () => {
  for (const id of ['wf_shape', 'wf_shape_ux']) {
    assert.ok(RESERVED_WORKFLOW_IDS.includes(id), id);
    assert.equal(isReservedWorkflowId(id), true, id);
    assert.ok(COMPOSER_RESERVED.has(id), `composer ${id}`);
  }
  assert.deepEqual([...COMPOSER_RESERVED].sort(), [...['wf_default', 'wf_memory_defrag', 'wf_shape', 'wf_shape_ux']].sort());
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
    (e) => e.code === 'RESERVED_NAME' && /Shape it first/.test(e.message));
});

test('resolveShapeRequest: no shape and no shape workflow leaves the request alone', () => {
  assert.deepEqual(resolveShapeRequest({}, { enabled: false }), { ok: true, shape: null, workflowId: null });
  assert.deepEqual(resolveShapeRequest({ workflowId: ' wf_default ' }, { enabled: true }), { ok: true, shape: null, workflowId: 'wf_default' });
  assert.equal(isShapeWorkflowId('wf_shape'), true);
  assert.equal(isShapeWorkflowId('wf_shape_ux'), true);
  assert.equal(isShapeWorkflowId('wf_default'), false);
});

test('resolveShapeRequest: the gate off refuses the shape field and the shape workflows', () => {
  assert.equal(resolveShapeRequest({ shape: {} }, { enabled: false }).ok, false);
  const r = resolveShapeRequest({ workflowId: 'wf_shape' }, { enabled: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /wf_shape/);
  assert.equal(resolveShapeRequest({ workflowId: 'wf_shape_ux' }, { enabled: false }).ok, false);
});

test('resolveShapeRequest: gate on normalizes perspectives and picks the workflow', () => {
  assert.deepEqual(resolveShapeRequest({ shape: { perspectives: ['qa'] } }, { enabled: true }),
    { ok: true, shape: { perspectives: ['product', 'qa'] }, workflowId: 'wf_shape' });
  assert.deepEqual(resolveShapeRequest({ shape: { perspectives: ['ux'] } }, { enabled: true }),
    { ok: true, shape: { perspectives: ['product', 'ux'] }, workflowId: 'wf_shape_ux' });
  assert.deepEqual(resolveShapeRequest({ shape: {} }, { enabled: true }),
    { ok: true, shape: { perspectives: [...DEFAULT_PERSPECTIVES] }, workflowId: 'wf_shape' });
  assert.deepEqual(resolveShapeRequest({ shape: { perspectives: ['qa'] }, workflowId: 'wf_shape' }, { enabled: true }).workflowId, 'wf_shape');
  // A shape workflow named without `shape` is accepted as-is (resume / explicit), with no shape field.
  assert.deepEqual(resolveShapeRequest({ workflowId: 'wf_shape' }, { enabled: true }).ok, true);
});

test('resolveShapeRequest: bad input is an error, not a throw', () => {
  const bad = (req) => { const r = resolveShapeRequest(req, { enabled: true }); assert.equal(r.ok, false, JSON.stringify(req)); return r.error; };
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

test('renderPlanFeedback carries the feedback and the plan file', () => {
  const md = renderPlanFeedback('  add a rollback step  ', '/runs/x/plan.md');
  assert.match(md, /^# Feedback on the plan/);
  assert.ok(md.includes('add a rollback step'));
  assert.ok(md.includes('`/runs/x/plan.md`'));
  assert.ok(!renderPlanFeedback('x').includes('at `'), 'no plan file, no path');
});
