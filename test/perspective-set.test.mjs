// test/perspective-set.test.mjs — the run's chosen perspective set (flag proposedPerspectives,
// src/shared/shape/perspective-set.mjs): role specs rewritten from the set, and Clarify capped per perspective.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPerspectiveSet, REVIEWER_KEY, CLARIFY_TOTAL, capClarifyByPerspective, clarifyPerspectivesBlock,
} from '../src/shared/shape/perspective-set.mjs';
import { roleReviewIssues, roleReviewOf, MAX_ROLES } from '../src/shared/graph/role-review-step.mjs';
import { GRAPH_DEFAULT_WORKFLOW, GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_REQ_WORKFLOW, deepFreeze } from '../src/core/graph/builtin-workflows.mjs';
import { PERSPECTIVE_KEYS, PERSPECTIVES } from '../src/shared/shape/perspectives.mjs';

const nodeOf = (g, id) => g.nodes.find((n) => n.id === id);
const keysOf = (cfg) => cfg.roleReview.roles.map((r) => r.key);

test('applyPerspectiveSet with no set returns an empty map', () => {
  assert.equal(applyPerspectiveSet(GRAPH_DEFAULT_WORKFLOW.nodes, null).size, 0);
  assert.equal(applyPerspectiveSet(GRAPH_SHAPE_WORKFLOW.nodes, undefined).size, 0);
});

test('Default: the reviewer becomes a diff role review with the chosen keys; its other config keys and role models are kept', () => {
  assert.equal(REVIEWER_KEY, 'reviewer');
  const nodes = GRAPH_DEFAULT_WORKFLOW.nodes.map((n) => (n.id === 'n_review'
    ? { ...n, config: { model: 'claude-x', extraInputs: [{ id: 'notes', type: 'md' }] } } : n));
  const m = applyPerspectiveSet(nodes, ['product', 'qa', 'security']);
  assert.deepEqual([...m.keys()], ['n_review']);
  const cfg = m.get('n_review');
  assert.equal(cfg.model, 'claude-x');
  assert.deepEqual(cfg.extraInputs, [{ id: 'notes', type: 'md' }]);
  assert.deepEqual(cfg.roleReview, {
    roles: [{ key: 'product', label: 'Product' }, { key: 'qa', label: 'QA' }, { key: 'security', label: 'Security' }],
    source: 'declared', target: 'diff', sink: 'implementer',
  });
  assert.deepEqual(roleReviewIssues(cfg), []);
});

test('Shaper: n_review runs the chosen keys instead of Correctness, Security and Project fit', () => {
  const m = applyPerspectiveSet(GRAPH_SHAPE_WORKFLOW.nodes, ['product', 'architect', 'qa']);
  assert.deepEqual(keysOf(m.get('n_review')), ['product', 'architect', 'qa']);
  assert.equal(m.has('n_roles'), false, 'no opt-in role named: the plan reviewer is unchanged');
  assert.equal(m.has('n_clarify'), false);
});

test('Shaper: n_roles gains compliance and keeps secondOpinion and its checklist; an undeclared picked spec is materialised', () => {
  const m = applyPerspectiveSet(GRAPH_SHAPE_WORKFLOW.nodes, ['product', 'qa', 'compliance']);
  const cfg = m.get('n_roles');
  assert.deepEqual(keysOf(cfg), [...PERSPECTIVE_KEYS, 'compliance']);
  assert.equal(cfg.roleReview.secondOpinion, 'product');
  assert.equal(cfg.roleReview.checklist, 'perspectives');
  assert.deepEqual(roleReviewIssues(cfg), []);
  const bare = [{ id: 'n_pr', kind: 'agent', key: 'planReviewer', config: { roleReview: { source: 'picked', target: 'plan', checklist: 'perspectives', sink: 'refiner' } } }];
  const got = applyPerspectiveSet(bare, ['product', 'compliance']).get('n_pr');
  assert.deepEqual(keysOf(got), [...PERSPECTIVES.map((p) => p.key), 'compliance']);
  assert.deepEqual(roleReviewIssues(got), []);
  const legacy = applyPerspectiveSet([{ id: 'n_l', kind: 'agent', key: 'planReviewer', config: { roleReview: true } }], ['compliance']).get('n_l');
  assert.deepEqual(roleReviewIssues(legacy), []);
  assert.equal(roleReviewOf(legacy).roles.at(-1).key, 'compliance');
});

test('a coverage spec appends requirements and keeps its checklist and extra inputs', () => {
  const m = applyPerspectiveSet(GRAPH_SHAPE_REQ_WORKFLOW.nodes, ['product', 'qa']);
  const cfg = m.get('n_review');
  assert.deepEqual(keysOf(cfg), ['product', 'qa', 'requirements']);
  assert.equal(cfg.roleReview.checklist, 'coverage');
  assert.ok(Array.isArray(cfg.extraInputs) && cfg.extraInputs.length === 1);
  assert.deepEqual(roleReviewIssues(cfg), []);
});

test('a picked spec whose provider has no optInRoles opts in nothing', () => {
  const nodes = [{ id: 'n_rq', kind: 'agent', key: 'requirementsReviewer', config: { roleReview: { source: 'picked', target: 'requirements', checklist: 'requirements', sink: 'refiner' } } }];
  assert.equal(applyPerspectiveSet(nodes, ['product', 'qa', 'compliance']).size, 0);
});

test('10 chosen keys give 11 code roles on the coverage variant, every spec valid and within MAX_ROLES', () => {
  const all = [...PERSPECTIVE_KEYS, 'compliance'];
  assert.equal(all.length, 10);
  const m = applyPerspectiveSet(GRAPH_SHAPE_REQ_WORKFLOW.nodes, all);
  assert.equal(m.get('n_review').roleReview.roles.length, 11);
  assert.ok(11 <= MAX_ROLES);
  for (const cfg of m.values()) assert.deepEqual(roleReviewIssues(cfg), []);
  for (const cfg of applyPerspectiveSet(GRAPH_SHAPE_WORKFLOW.nodes, all).values()) assert.deepEqual(roleReviewIssues(cfg), []);
});

test('an old role keeps its model and effort; a reviewer with a non-diff target is left as is', () => {
  const nodes = [
    { id: 'a', kind: 'agent', key: 'reviewer', config: { roleReview: { roles: [{ key: 'qa', label: 'QA', model: 'm1', effort: 'high' }, { key: 'correctness', label: 'Correctness' }], target: 'diff', sink: 'implementer' } } },
    { id: 'b', kind: 'agent', key: 'reviewer', config: { roleReview: { roles: [{ key: 'qa', label: 'QA' }], target: 'plan', sink: 'refiner' } } },
    { id: 'c', kind: 'agent', key: 'planner', config: {} },
  ];
  const m = applyPerspectiveSet(nodes, ['product', 'qa']);
  assert.deepEqual([...m.keys()], ['a']);
  assert.deepEqual(m.get('a').roleReview.roles, [{ key: 'product', label: 'Product' }, { key: 'qa', label: 'QA', model: 'm1', effort: 'high' }]);
});

test('inputs are never mutated, frozen ones included', () => {
  const nodes = deepFreeze(structuredClone([...GRAPH_SHAPE_REQ_WORKFLOW.nodes]));
  const before = JSON.stringify(nodes);
  const m = applyPerspectiveSet(nodes, ['product', 'qa', 'compliance']);
  assert.ok(m.size >= 1);
  assert.equal(JSON.stringify(nodes), before);
  const plain = structuredClone(GRAPH_DEFAULT_WORKFLOW.nodes);
  const snap = JSON.stringify(plain);
  applyPerspectiveSet(plain, ['product']);
  assert.equal(JSON.stringify(plain), snap);
});

const q = (id) => ({ id, question: `${id}?`, options: [{ label: 'A' }, { label: 'B' }] });

test('capClarifyByPerspective keeps the first question per key, an unknown prefix counting as product', () => {
  const r = capClarifyByPerspective(['security-a', 'security-b', 'qa-a', 'x-a', 'ux-a'].map(q), ['product', 'qa', 'security']);
  assert.deepEqual(r.questions.map((x) => x.id), ['security-a', 'qa-a', 'x-a']);
  assert.deepEqual(r.dropped.map((x) => x.id), ['security-b', 'ux-a']);
});

test('5 chosen keys with one question each keep the first 3', () => {
  assert.equal(CLARIFY_TOTAL, 3);
  const chosen = ['product', 'architect', 'qa', 'ux', 'security'];
  const r = capClarifyByPerspective(chosen.map((k) => q(`${k}-one`)), chosen);
  assert.deepEqual(r.questions.map((x) => x.id), ['product-one', 'architect-one', 'qa-one']);
  assert.equal(r.dropped.length, 2);
  assert.deepEqual(capClarifyByPerspective([q('noprefix'), q('other')], chosen).questions.map((x) => x.id), ['noprefix']);
});

test('clarifyPerspectivesBlock: \'\' for an invalid list, the block for a valid one', () => {
  for (const bad of [null, 'qa', ['nope'], [1]]) assert.equal(clarifyPerspectivesBlock(bad), '', String(bad));
  const b = clarifyPerspectivesBlock(['product', 'security', 'compliance']);
  assert.ok(b.startsWith('## Perspectives for your questions\n'));
  assert.ok(b.includes('Product (product)') && b.includes('Security (security)') && b.includes('Compliance (compliance)'));
  assert.ok(b.includes('Ask at most one question per perspective and at most 3 in total. Start each question\'s `id` with its perspective key and a dash, for example `security-retention`.'));
});

test('codeReviewRoleKeys names the diff role reviews\' keys only', async () => {
  const { codeReviewRoleKeys } = await import('../src/shared/shape/perspective-set.mjs');
  const m = applyPerspectiveSet(GRAPH_SHAPE_WORKFLOW.nodes, ['product', 'qa', 'compliance']);
  const configs = GRAPH_SHAPE_WORKFLOW.nodes.map((n) => m.get(n.id) || n.config);
  assert.deepEqual(codeReviewRoleKeys(configs), ['product', 'qa', 'compliance']);
  assert.deepEqual(codeReviewRoleKeys(GRAPH_DEFAULT_WORKFLOW.nodes.map((n) => n.config)), []);
});
