// test/graph-ports-extra-inputs.test.mjs — the requirements role-review port set and per-node `extraInputs`
// (src/shared/graph/ports.mjs, validate.mjs): extra optional md inputs land after the node's own and before
// `await`; a node without the key resolves exactly today's ports; the validator refuses a clash, a non-md type and
// a fifth input. Pure: no IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  portsFnFor, rolePortsOf, ROLE_REVIEW_PORTS, ROLE_REVIEW_DIFF_PORTS, ROLE_REVIEW_REQUIREMENTS_PORTS,
} from '../src/shared/graph/ports.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { isomorphic } from '../src/shared/graph/isomorphic.mjs';

const REG = {
  planner: { key: 'planner', metaVersion: 2, inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  drafter: { key: 'drafter', metaVersion: 2, inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'requirements', type: 'md', when: 'always' }] },
};
const portsFn = portsFnFor(REG);
const node = (config = {}) => ({ id: 'n_plan', kind: 'agent', key: 'planner', x: 0, y: 0, config });
const ids = (list) => list.map((p) => p.id);

test('rolePortsOf: requirements has its own set; plan and diff are unchanged', () => {
  assert.equal(rolePortsOf('requirements'), ROLE_REVIEW_REQUIREMENTS_PORTS);
  assert.equal(rolePortsOf('plan'), ROLE_REVIEW_PORTS);
  assert.equal(rolePortsOf('diff'), ROLE_REVIEW_DIFF_PORTS);
  assert.deepEqual(ids(ROLE_REVIEW_REQUIREMENTS_PORTS.inputs), ['requirements', 'revise']);
  assert.equal(ROLE_REVIEW_REQUIREMENTS_PORTS.inputs[1].loop, true);
  assert.deepEqual(ROLE_REVIEW_REQUIREMENTS_PORTS.outputs.map((p) => [p.id, p.type, p.filename || null, p.store || null]), [
    ['findings', 'md', '{base}-requirements-findings-r{cycle}.md', 'run'],
    ['requirements', 'md', null, null],
  ]);
  assert.ok(Object.isFrozen(ROLE_REVIEW_REQUIREMENTS_PORTS));
});

test('extraInputs: optional md inputs after the own inputs and before await; no key resolves today\'s ports', () => {
  const plain = portsFn(node());
  assert.deepEqual(ids(plain.inputs), ['task', 'await']);
  assert.deepEqual(portsFn(node({ extraInputs: [] })), plain, 'an empty list is no list');
  const extra = portsFn(node({ extraInputs: [{ id: 'requirements', type: 'md' }] }));
  assert.deepEqual(ids(extra.inputs), ['task', 'requirements', 'await']);
  assert.deepEqual(extra.inputs[1], { id: 'requirements', type: 'md', required: false, extra: true });
  assert.deepEqual(extra.outputs, plain.outputs);
  const role = { id: 'n_roles', kind: 'agent', key: 'planner', x: 0, y: 0,
    config: { roleReview: { roles: [{ key: 'alpha', label: 'Alpha' }], target: 'plan', sink: 'refiner' }, extraInputs: [{ id: 'requirements', type: 'md' }] } };
  assert.deepEqual(ids(portsFn(role).inputs), ['plan', 'revise', 'requirements', 'await'], 'after the role-review set');
  assert.equal(REG.planner.inputs.length, 1, 'the meta is untouched');
});

const graph = (extraInputs) => ({
  id: 'wf_x', name: 'x', version: 2,
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_req', kind: 'agent', key: 'drafter', x: 0, y: 0, config: {} },
    { ...node(extraInputs === undefined ? {} : { extraInputs }) },
    { id: 'n_end', kind: 'end', x: 0, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_req', port: 'task' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
  ],
});
const messages = (tpl) => validateGraph(tpl, portsFn).errors.filter((e) => /extraInputs/.test(e.message)).map((e) => e.message);

test('validate: a valid list passes; a clash, a non-md type, a 5th input or a malformed entry is refused', () => {
  assert.deepEqual(messages(graph(undefined)), []);
  assert.deepEqual(messages(graph([{ id: 'requirements', type: 'md' }])), []);
  assert.deepEqual(messages(graph([{ id: 'task', type: 'md' }])), ["node 'n_plan' config.extraInputs 'task' clashes with an input of this agent"]);
  assert.deepEqual(messages(graph([{ id: 'data', type: 'json' }])), ["node 'n_plan' config.extraInputs 'data' must be of type md"]);
  assert.deepEqual(messages(graph(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, type: 'md' })))), ["node 'n_plan' config.extraInputs holds at most 4 inputs"]);
  assert.deepEqual(messages(graph([{ id: 'a', type: 'md' }, { id: 'a', type: 'md' }])), ["node 'n_plan' config.extraInputs 'a' is declared twice"]);
  assert.deepEqual(messages(graph('requirements')), ["node 'n_plan' config.extraInputs must be a list of { id, type: 'md' }"]);
  assert.deepEqual(messages(graph([{ id: 'Bad Id', type: 'md' }])), ["node 'n_plan' config.extraInputs[0] must be { id, type: 'md' }"]);
});

test('a wire into an extra input is topology; the unwired key is not', () => {
  const a = graph([{ id: 'requirements', type: 'md' }]);
  const b = { ...a, wires: [...a.wires, { id: 'w4', from: { node: 'n_req', port: 'requirements' }, to: { node: 'n_plan', port: 'requirements' } }] };
  assert.deepEqual(validateGraph(b, portsFn).errors, []);
  assert.equal(isomorphic(a, b), null, 'a wire into the extra input is a different graph');
  assert.ok(isomorphic(a, graph(undefined)), 'the unwired key alone is the same graph');
});

test('validate: config.approve takes check, agreed, coverage and decisions; anything else is refused', () => {
  const reg = { ...REG, refiner: { key: 'refiner', metaVersion: 2, inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'requirements', type: 'md', when: 'always' }, { id: 'decisions', type: 'json', when: 'always' }] } };
  const fn = portsFnFor(reg);
  const tpl = (approve) => ({ ...graph(undefined), nodes: [...graph(undefined).nodes,
    { id: 'n_ref', kind: 'agent', key: 'refiner', x: 0, y: 0, config: { approve, extraInputs: [{ id: 'reqs', type: 'md' }] } }],
    wires: [...graph(undefined).wires, { id: 'w9', from: { node: 'n_task', port: 'task' }, to: { node: 'n_ref', port: 'task' } }] });
  const approveErrors = (a) => validateGraph(tpl(a), fn).errors.filter((e) => /config\.approve/.test(e.message)).map((e) => e.message);
  assert.deepEqual(approveErrors({ kind: 'plan', port: 'requirements' }), []);
  assert.deepEqual(approveErrors({ kind: 'plan', port: 'requirements', check: 'criteria', agreed: 'task', decisions: 'decisions', coverage: 'reqs' }), []);
  assert.deepEqual(approveErrors({ kind: 'plan', port: 'requirements', when: 'now' }), ["node 'n_ref' config.approve has unknown key(s): when"]);
  assert.deepEqual(approveErrors({ kind: 'plan', port: 'requirements', check: 'shape' }), ["node 'n_ref' config.approve.check must be 'criteria'"]);
  assert.deepEqual(approveErrors({ kind: 'plan', port: 'requirements', agreed: 'nope' }), ["node 'n_ref' config.approve.agreed 'nope' is not an md input of this agent"]);
  assert.deepEqual(approveErrors({ kind: 'plan', port: 'requirements', decisions: 'requirements' }),
    ["node 'n_ref' config.approve.decisions 'requirements' is not a json output of this agent"]);
});
