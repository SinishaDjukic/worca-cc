// test/workflows-shape-requirements.test.mjs — Shaper's requirements stage as workflows :
// the two variant graphs, the unchanged base graphs, which id a request gets (or why it is refused), and the reserved,
// never-listed ids. The server is booted in-process for GET /api/workflows only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import {
  GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW, GRAPH_SHAPE_REQ_WORKFLOW, GRAPH_SHAPE_UX_REQ_WORKFLOW,
  SHAPE_REQ_WORKFLOW_IDS, RESERVED_WORKFLOW_IDS, isReservedWorkflowId, requirementsVariant,
  GRAPH_SHAPE_SLICE_REQ_WORKFLOW, GRAPH_SHAPE_UX_SLICE_REQ_WORKFLOW, SHAPE_SLICE_REQ_WORKFLOW_IDS,
} from '../src/core/graph/builtin-workflows.mjs';
import { readWorkflow, listWorkflows, writeGraphWorkflow, deleteWorkflow } from '../src/core/workflows.mjs';
import { resolveShapeRequest } from '../src/core/shape/run.mjs';
import { autoCandidates } from '../src/core/auto/match.mjs';
import { isReservedWorkflowId as composerReserved, RESERVED_WORKFLOW_IDS as COMPOSER_RESERVED } from '../ui/public/graph/composer.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';

let home, srv, base;
const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-shapereq-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  Object.assign(process.env, { HOME: home, USERPROFILE: home, WORCA_HOME: home, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' });
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(home, { recursive: true, force: true });
});

const edge = (w) => `${w.id} ${w.from.node}.${w.from.port}->${w.to.node}.${w.to.port}`;
const node = (wf, id) => wf.nodes.find((n) => n.id === id);
const REQ_WIRES = [
  'wr1 n_task.task->n_req.task', 'wr2 n_task.task->n_reqrefine.task', 'wr3 n_req.requirements->n_reqroles.requirements',
  'wr4 n_reqroles.requirements->n_reqrefine.requirements', 'wr5 n_reqroles.findings->n_reqrefine.findings',
  'wr6 n_reqrefine.revise->n_reqroles.revise', 'wr7 n_reqrefine.requirements->n_plan.requirements',
  'wr8 n_reqrefine.requirements->n_roles.requirements', 'wr9 n_reqrefine.requirements->n_refine.requirements',
  'wr10 n_reqrefine.requirements->n_review.requirements',
];
const CODE_REVIEW_CONFIG = { roleReview: { source: 'declared', target: 'diff', checklist: 'coverage', sink: 'implementer' }, extraInputs: [{ id: 'requirements', type: 'md' }] };

test('wf_shape_req and wf_shape_ux_req: Clarify replaced by the stage, every other node and wire id kept; both validate', () => {
  const ports = registryPortsFn(loadAgentRegistry(undefined, { userAgentsDir: null }));
  for (const [wf, baseWf, id] of [[GRAPH_SHAPE_REQ_WORKFLOW, GRAPH_SHAPE_WORKFLOW, 'wf_shape_req'], [GRAPH_SHAPE_UX_REQ_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW, 'wf_shape_ux_req']]) {
    assert.equal(wf.id, id);
    assert.equal(wf.name, 'Shaper');
    assert.deepEqual(wf.nodes.map((n) => n.id), [...baseWf.nodes.map((n) => n.id).filter((x) => x !== 'n_clarify'), 'n_req', 'n_reqroles', 'n_reqrefine']);
    assert.deepEqual(wf.nodes.slice(-3).map((n) => n.key), ['requirementsDrafter', 'requirementsReviewer', 'requirementsRefiner']);
    assert.deepEqual(wf.wires.map(edge), [...baseWf.wires.filter((w) => w.id !== 'w1' && w.id !== 'w3').map(edge), ...REQ_WIRES]);
    assert.deepEqual(node(wf, 'n_reqroles').config.roleReview, { source: 'picked', target: 'requirements', checklist: 'requirements', sink: 'refiner' });
    assert.deepEqual(node(wf, 'n_reqrefine').config, {
      approve: { kind: 'plan', port: 'requirements', check: 'criteria', agreed: 'task', decisions: 'decisions' },
    });
    for (const id2 of ['n_plan', 'n_roles', 'n_refine']) assert.deepEqual(node(wf, id2).config.extraInputs, [{ id: 'requirements', type: 'md' }], id2);
    assert.deepEqual(node(wf, 'n_refine').config.approve, { kind: 'plan', port: 'plan', coverage: 'requirements' });
    assert.deepEqual(node(wf, 'n_review').config, CODE_REVIEW_CONFIG);
    assert.deepEqual(wf.wires.find((w) => w.id === 'wr6').config, { maxCycles: 2, onExhausted: 'clean' });
    assert.ok(Object.isFrozen(wf) && Object.isFrozen(node(wf, 'n_reqrefine').config.approve), 'deep-frozen');
    const v = validateGraph(wf, ports);
    assert.deepEqual(v.errors, [], id);
  }
});

test('the base graphs are unchanged: wf_shape and wf_shape_ux deepEqual their capture from 9a388885b', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/shaper/shape-graphs-before-requirements.json', import.meta.url), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(GRAPH_SHAPE_WORKFLOW)), fixture.wf_shape);
  assert.deepEqual(JSON.parse(JSON.stringify(GRAPH_SHAPE_UX_WORKFLOW)), fixture.wf_shape_ux);
  assert.equal(requirementsVariant(GRAPH_SHAPE_WORKFLOW, 'wf_x').id, 'wf_x');
  assert.deepEqual(JSON.parse(JSON.stringify(GRAPH_SHAPE_WORKFLOW)), fixture.wf_shape, 'the builder never mutates its base');
  assert.doesNotMatch(JSON.stringify(fixture), /"model"/, 'the built-in graphs pin no model (factory-models.mjs)');
});

test('the requirements id only for a medium or large task that is not a slice ticket', () => {
  assert.equal(resolveShapeRequest({ shape: { size: 'large' } }).workflowId, 'wf_shape_req');
  assert.equal(resolveShapeRequest({ shape: { size: 'medium' } }).workflowId, 'wf_shape_req');
  assert.equal(resolveShapeRequest({ shape: { size: 'large', perspectives: ['ux'] } }).workflowId, 'wf_shape_ux_req');
  assert.equal(resolveShapeRequest({ shape: { size: 'small' } }).workflowId, 'wf_shape');
  assert.equal(resolveShapeRequest({ shape: {} }).workflowId, 'wf_shape');
});

const SLICE = { feature: 'f1', index: 1, total: 2, outline: { slices: [
  { id: 's1', title: 'One', goal: 'g', inScope: [], outOfScope: [], acceptance: ['a'], dependsOn: [], estimate: 'small' },
  { id: 's2', title: 'Two', goal: 'g', inScope: [], outOfScope: [], acceptance: ['a'], dependsOn: ['s1'], estimate: 'small' },
] } };

test('a named requirements id is refused on a slice ticket, and for a small or absent size', () => {
  for (const workflowId of SHAPE_REQ_WORKFLOW_IDS) {
    const slice = resolveShapeRequest({ shape: { size: 'large', slice: SLICE }, workflowId }, { internal: true });
    assert.deepEqual(slice, { ok: false, error: 'a slice ticket runs the Shaper workflow (wf_shape)' });
    for (const shape of [{ size: 'small' }, {}]) {
      assert.deepEqual(resolveShapeRequest({ shape, workflowId }),
        { ok: false, error: 'the requirements stage needs a medium or large task' });
    }
  }
  const ticket = resolveShapeRequest({ shape: { size: 'large', slice: SLICE } }, { internal: true });
  assert.equal(ticket.ok, true, ticket.error);
  assert.equal(ticket.workflowId, 'wf_shape', 'a slice ticket with the flag on runs wf_shape');
});

test('shape.lead: validated, kept, and added to the perspectives', () => {
  assert.deepEqual(resolveShapeRequest({ shape: { lead: 'boss' } }),
    { ok: false, error: 'shape.lead must be one of product, architect, ux, qa, security, devops' });
  const r = resolveShapeRequest({ shape: { lead: 'security', perspectives: ['qa'], size: 'large' } });
  assert.deepEqual(r.shape, { perspectives: ['product', 'qa', 'security'], size: 'large', lead: 'security' });
});

test('reserved apart: core and composer refuse both ids; the pinned lists keep their members', () => {
  for (const id of SHAPE_REQ_WORKFLOW_IDS) {
    assert.equal(isReservedWorkflowId(id), true, id);
    assert.equal(composerReserved(id), true, `composer ${id}`);
    assert.equal(RESERVED_WORKFLOW_IDS.includes(id), false);
    assert.equal(COMPOSER_RESERVED.has(id), false);
  }
});

test('readWorkflow resolves both ids; save and delete refuse them; never listed, never an Auto candidate', async () => {
  assert.equal(await readWorkflow('wf_shape_req'), GRAPH_SHAPE_REQ_WORKFLOW);
  assert.equal(await readWorkflow('wf_shape_ux_req'), GRAPH_SHAPE_UX_REQ_WORKFLOW);
  for (const id of SHAPE_REQ_WORKFLOW_IDS) {
    const saved = await writeGraphWorkflow({ id, name: 'Mine', nodes: [], wires: [] });
    assert.equal(saved.id, 'wf_mine', 'an explicit reserved id falls back to the slug');
    assert.equal(await deleteWorkflow(id), false);
    const del = await fetch(`${base}/api/workflows/${id}`, { method: 'DELETE', headers: { Origin: base } });
    assert.equal(del.status, 400, id);
  }
  assert.ok(!(await listWorkflows()).some((w) => SHAPE_REQ_WORKFLOW_IDS.includes(w.id)));
  const listed = await (await fetch(`${base}/api/workflows`)).json();
  const ids = (Array.isArray(listed) ? listed : listed.workflows || []).map((w) => w.id);
  assert.ok(ids.includes('wf_shape'), 'the listing answered');
  assert.equal(ids.some((id) => SHAPE_REQ_WORKFLOW_IDS.includes(id)), false);
  assert.equal((await autoCandidates()).some((w) => SHAPE_REQ_WORKFLOW_IDS.includes(w.id)), false);
});

test('slice variants: `n_task.task` feeds four takers via ws1–ws4 and validate returns no errors', () => {
  const ports = registryPortsFn(loadAgentRegistry(undefined, { userAgentsDir: null }));
  for (const [wf, baseWf, id] of [[GRAPH_SHAPE_SLICE_REQ_WORKFLOW, GRAPH_SHAPE_WORKFLOW, 'wf_shape_slice_req'], [GRAPH_SHAPE_UX_SLICE_REQ_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW, 'wf_shape_ux_slice_req']]) {
    assert.equal(wf.id, id);
    assert.equal(wf.name, 'Shaper');
    assert.deepEqual(wf.nodes.map((n) => n.id), baseWf.nodes.map((n) => n.id), 'Clarify is kept');
    assert.deepEqual(wf.wires.map(edge), [...baseWf.wires.map(edge),
      'ws1 n_task.task->n_plan.requirements', 'ws2 n_task.task->n_roles.requirements', 'ws3 n_task.task->n_refine.requirements', 'ws4 n_task.task->n_review.requirements']);
    for (const id2 of ['n_plan', 'n_roles', 'n_refine']) assert.deepEqual(node(wf, id2).config.extraInputs, [{ id: 'requirements', type: 'md' }], id2);
    assert.deepEqual(node(wf, 'n_refine').config.approve, { kind: 'plan', port: 'plan', coverage: 'requirements' });
    assert.deepEqual(node(wf, 'n_review').config, CODE_REVIEW_CONFIG);
    assert.ok(Object.isFrozen(wf));
    assert.deepEqual(validateGraph(wf, ports).errors, [], id);
  }
});

const REQ_SLICE = { ...SLICE, outline: { ...SLICE.outline, slices: SLICE.outline.slices.map((s, i) => ({ ...s, requirements: i ? ['R-qa-1'] : ['R-po-1'] })),
  agreed: [{ id: 'R-po-1', text: 'a' }, { id: 'R-qa-1', text: 'b' }], leftOut: [] } };

test('slice ticket resolution: ids → wf_shape_slice_req (ux → wf_shape_ux_slice_req); a named slice variant without a slice returns the error', () => {
  const fire = (shape, workflowId = 'wf_shape') => resolveShapeRequest({ shape, workflowId }, { internal: true });
  assert.equal(fire({ size: 'large', slice: REQ_SLICE }).workflowId, 'wf_shape_slice_req');
  assert.equal(fire({ size: 'large', slice: REQ_SLICE, perspectives: ['ux'] }).workflowId, 'wf_shape_ux_slice_req');
  assert.equal(fire({ size: 'large', slice: SLICE }).workflowId, 'wf_shape', 'a slice without ids runs wf_shape');
  assert.deepEqual(fire({ size: 'large', slice: REQ_SLICE }).shape.slice.outline.agreed, REQ_SLICE.outline.agreed);
  for (const id of SHAPE_SLICE_REQ_WORKFLOW_IDS) {
    assert.deepEqual(fire({ size: 'large' }, id), { ok: false, error: `${id} runs only as a slice of a feature with agreed requirements` });
    assert.deepEqual(fire({ size: 'large', slice: SLICE }, id), { ok: false, error: `${id} runs only as a slice of a feature with agreed requirements` });
  }
  assert.equal(fire({ size: 'large', slice: REQ_SLICE }, 'wf_shape_slice_req').workflowId, 'wf_shape_slice_req');
});

test('slice variants are reserved: readWorkflow returns them with the flag off, deleteWorkflow refuses them, listWorkflows hides them', async () => {
  assert.equal(await readWorkflow('wf_shape_slice_req'), GRAPH_SHAPE_SLICE_REQ_WORKFLOW);
  assert.equal(await readWorkflow('wf_shape_ux_slice_req'), GRAPH_SHAPE_UX_SLICE_REQ_WORKFLOW);
  for (const id of SHAPE_SLICE_REQ_WORKFLOW_IDS) {
    assert.equal(isReservedWorkflowId(id), true, id);
    assert.equal(composerReserved(id), true, `composer ${id}`);
    assert.equal(await deleteWorkflow(id), false);
    const del = await fetch(`${base}/api/workflows/${id}`, { method: 'DELETE', headers: { Origin: base } });
    assert.equal(del.status, 400, id);
  }
  assert.ok(!(await listWorkflows()).some((w) => SHAPE_SLICE_REQ_WORKFLOW_IDS.includes(w.id)));
  assert.equal((await autoCandidates()).some((w) => SHAPE_SLICE_REQ_WORKFLOW_IDS.includes(w.id)), false);
});

test('the requirements refiner asks for a plain twin on every decision', () => {
  const text = readFileSync(new URL('../agents/worca-cc-requirements-refiner.md', import.meta.url), 'utf8');
  assert.match(text, /Write `plain` on every decision and every option/);
  assert.doesNotMatch(text, /`plain` \(optional\)/);
});

test('the requirements refiner asks for persona and reason, real questions, and conflict options in findings order', () => {
  const text = readFileSync(new URL('../agents/worca-cc-requirements-refiner.md', import.meta.url), 'utf8');
  assert.match(text, /"persona": "security", "reason": "emails are personal data, and exports get forwarded"/);
  assert.match(text, /`persona` is one key from `product, architect, ux, qa, security, devops, release`/);
  assert.match(text, /`reason` is one plain line, at most 200 characters/);
  assert.match(text, /An option nobody asked for has neither/);
  assert.match(text, /as a question a person can answer/);
  assert.match(text, /Gate the export on read access or write access/);
  // The rule governs the dispositions file, where `conflicts[]` lives: step 3, not the decisions file's step 2.
  assert.match(text, /^3\. .*In a `conflicts` entry, `options` follow the order of `findings`: option 1 is the side of the first finding\./m);
  assert.match(text, /^3\. .*Do not also list that conflict in the decisions file\./m);
  assert.doesNotMatch(text, /When you turn a conflict into a decision/);
});
