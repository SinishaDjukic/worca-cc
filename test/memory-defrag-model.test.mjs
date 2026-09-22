// test/memory-defrag-model.test.mjs — Settings › Memory: the defragment pair's precedence, the
// pair rule and the catalog degrade (src/core/memory-defrag-model.mjs, pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDefragModel, defragDefaultModel, defragWorkflowView, agentPairText, checkStartPair } from '../src/core/memory-defrag-model.mjs';
import { GRAPH_MEMORY_DEFRAG_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

const MODELS = [
  { id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', efforts: ['medium', 'high'] },
];

test('resolveDefragModel: nothing named, nothing stored → no pair, no warning (today\'s resolution)', () => {
  assert.deepEqual(resolveDefragModel({ models: MODELS }), { model: null, effort: null, source: 'default', warning: null });
  assert.deepEqual(resolveDefragModel({ stored: { model: null, effort: null }, models: MODELS }), { model: null, effort: null, source: 'default', warning: null });
});

test('resolveDefragModel: the stored pair, validated and returned in the catalog\'s casing', () => {
  assert.deepEqual(resolveDefragModel({ stored: { model: 'CLAUDE-OPUS-5-5', effort: 'high' }, models: MODELS }),
    { model: 'claude-opus-5-5', effort: 'high', source: 'setting', warning: null });
  assert.deepEqual(resolveDefragModel({ stored: { model: 'claude-haiku-4-5', effort: null }, models: MODELS }),
    { model: 'claude-haiku-4-5', effort: null, source: 'setting', warning: null });
});

test('resolveDefragModel: a pair named at start wins — verbatim, and the setting\'s effort never rides under it', () => {
  const stored = { model: 'claude-opus-5-5', effort: 'high' };
  assert.deepEqual(resolveDefragModel({ explicit: { model: 'claude-haiku-4-5' }, stored, models: MODELS }),
    { model: 'claude-haiku-4-5', effort: null, source: 'explicit', warning: null });
  assert.deepEqual(resolveDefragModel({ explicit: { model: 'my-proxy-model', effort: 'max' }, stored, models: MODELS }),
    { model: 'my-proxy-model', effort: 'max', source: 'explicit', warning: null }, 'not catalog-checked, like --model everywhere');
  assert.deepEqual(resolveDefragModel({ explicit: { effort: 'max' }, stored, models: MODELS }),
    { model: 'claude-opus-5-5', effort: 'high', source: 'setting', warning: null }, 'an effort without a model means nothing');
});

test('resolveDefragModel: a model gone from the catalog degrades to the default WITH a warning; an effort it does not offer is dropped', () => {
  const gone = resolveDefragModel({ stored: { model: 'gone-model', effort: 'high' }, models: MODELS });
  assert.equal(gone.model, null);
  assert.equal(gone.source, 'default');
  assert.match(gone.warning, /^Memory defragment model "gone-model" \(Settings › Memory\) is not in this project's model catalog$/, 'the problem only: the caller names what the run uses instead');
  const eff = resolveDefragModel({ stored: { model: 'claude-haiku-4-5', effort: 'max' }, models: MODELS });
  assert.deepEqual([eff.model, eff.effort, eff.source], ['claude-haiku-4-5', null, 'setting']);
  assert.match(eff.warning, /effort "max" .* is not offered by claude-haiku-4-5/);
});

test('defragDefaultModel names the built-in template\'s own model', () => {
  assert.equal(defragDefaultModel(), 'claude-sonnet-5');
});

test('defragWorkflowView: pins the resolved pair on a COPY; no pair → the very same object', () => {
  const view = defragWorkflowView(GRAPH_MEMORY_DEFRAG_WORKFLOW, { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(view.pinnedAgentModel, { model: 'claude-opus-5-5', effort: 'high', source: 'settings' });
  assert.equal(view.nodes, GRAPH_MEMORY_DEFRAG_WORKFLOW.nodes, 'the topology is the constant\'s own');
  assert.equal('pinnedAgentModel' in GRAPH_MEMORY_DEFRAG_WORKFLOW, false, 'the frozen constant is untouched');
  assert.deepEqual(defragWorkflowView(GRAPH_MEMORY_DEFRAG_WORKFLOW, { model: 'claude-haiku-4-5', effort: null }).pinnedAgentModel,
    { model: 'claude-haiku-4-5', effort: null, source: 'settings' });
  assert.equal(defragWorkflowView(GRAPH_MEMORY_DEFRAG_WORKFLOW, { model: null, effort: null }), GRAPH_MEMORY_DEFRAG_WORKFLOW);
  assert.equal(defragWorkflowView(GRAPH_MEMORY_DEFRAG_WORKFLOW, null), GRAPH_MEMORY_DEFRAG_WORKFLOW);
});

test('agentPairText names what the agent nodes resolved to — the tail of a degrade warning', () => {
  assert.equal(agentPairText({ n_task: { kind: 'task' }, n_defrag: { kind: 'agent', model: 'claude-sonnet-5', effort: undefined } }), 'claude-sonnet-5 at its default effort');
  assert.equal(agentPairText({ n_defrag: { kind: 'agent', model: 'claude-fable-5-1', effort: 'max' } }), 'claude-fable-5-1 · max', 'a project\'s own pick');
  assert.equal(agentPairText({ a: { kind: 'agent', model: 'm', effort: 'high' }, b: { kind: 'agent', model: 'm', effort: 'high' } }), 'm · high', 'one line per distinct pair');
  assert.equal(agentPairText({}), 'the CLI default model');
});

test('checkStartPair: a POST /api/run pair is checked against the run\'s catalog (casing, the model\'s own efforts); an effort without a model is refused', () => {
  assert.deepEqual(checkStartPair({}, MODELS), { pair: null });
  assert.deepEqual(checkStartPair({ model: '  ', effort: '' }, MODELS), { pair: null });
  assert.deepEqual(checkStartPair({ model: 'CLAUDE-OPUS-5-5', effort: 'max' }, MODELS), { pair: { model: 'claude-opus-5-5', effort: 'max' } });
  assert.deepEqual(checkStartPair({ model: 'claude-haiku-4-5' }, MODELS), { pair: { model: 'claude-haiku-4-5', effort: null } });
  assert.match(checkStartPair({ effort: 'high' }, MODELS).error, /effort needs a model/);
  assert.match(checkStartPair({ model: 7 }, MODELS).error, /catalog model id/);
  assert.match(checkStartPair({ model: 'claude-haiku-4-5', effort: 3 }, MODELS).error, /effort must be a string/);
  assert.match(checkStartPair({ model: 'gone-model' }, MODELS).error, /^unknown model "gone-model"$/);
  assert.match(checkStartPair({ model: 'claude-haiku-4-5', effort: 'max' }, MODELS).error, /^claude-haiku-4-5 does not offer effort "max"$/);
  assert.deepEqual(checkStartPair({ model: 'gone-model', effort: 'max' }, null), { pair: { model: 'gone-model', effort: 'max' } },
    'no catalog (a ticket firing, checked when it was scheduled): verbatim');
});
