// test/node-tunables-engine.test.mjs — New pipeline's engine heal (cascading-settings-design.md §6,
// D10): a stored pick of the other engine is skipped at run time, so the row shows what the run
// uses instead and remembers the pick, which a save of another tunable re-sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeConfigRows, pruneNodeSelection, buildGraphNodeRows, buildRoleRows } from '../ui/public/node-tunables.mjs';

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', efforts: ['medium', 'high', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], engine: 'claude' },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex' },
];
const REG = { planner: { key: 'planner', displayName: 'Plan', fanOut: true }, reviewer: { key: 'reviewer', displayName: 'Review' } };
const WF = { id: 'wf_t', name: 'T', steps: [[{ id: 'n0', key: 'planner', defaults: { model: 'claude-opus-4-8', effort: 'high', fanOut: true } }], [{ id: 'n1', key: 'reviewer' }]], feedbacks: [] };

test('a Claude pick on a Codex run shows what the run uses and remembers the pick', () => {
  const [n0] = buildNodeConfigRows(WF, REG, { nodes: { n0: { model: 'claude-haiku-4-5', effort: 'medium' } } }, { models: MODELS, engine: 'codex' });
  assert.equal(n0.model, '');
  assert.equal(n0.effort, '');
  assert.equal(n0.def.model, '', 'the workflow default is a Claude model too: no model on codex');
  assert.deepEqual(n0.enginePair, { model: 'claude-haiku-4-5', effort: 'medium' });
  assert.equal(n0.modified, false);
  assert.deepEqual(pruneNodeSelection(n0, { fanOut: false }),
    { model: 'claude-haiku-4-5', effort: 'medium', fanOut: false, askQuestions: undefined, subagentModel: '' },
    'a save of another tunable re-sends the hidden pick');
  assert.equal(pruneNodeSelection(n0, { model: 'gpt-5.5', effort: 'low' }).model, 'gpt-5.5', 'a new pick replaces it');
});

test('a pick of the run engine is untouched; Claude heals a Codex pick the same way; no engine heals nothing', () => {
  const rc = { nodes: { n0: { model: 'gpt-5.5', effort: 'low' } } };
  const [onClaude] = buildNodeConfigRows(WF, REG, rc, { models: MODELS, engine: 'claude' });
  assert.equal(onClaude.model, 'claude-opus-4-8');
  assert.equal(onClaude.effort, 'high');
  assert.deepEqual(onClaude.enginePair, { model: 'gpt-5.5', effort: 'low' });
  const [onCodex] = buildNodeConfigRows(WF, REG, rc, { models: MODELS, engine: 'codex' });
  assert.equal(onCodex.model, 'gpt-5.5');
  assert.equal(onCodex.enginePair, undefined);
  const [noEngine] = buildNodeConfigRows(WF, REG, rc, { models: MODELS });
  assert.equal(noEngine.model, 'gpt-5.5', 'no engine known (the Ask card): nothing is healed');
});

const PINNED = { nodes: { n0: { model: 'gpt-5.5', effort: 'low', engine: 'codex' } } };
// The registry has no v2 ports: classifyLoops still orders the graph (test/node-tunables.test.mjs:7-9).
const TPL = { id: 'wf_p', name: 'P', version: 2, nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
  { id: 'n0', kind: 'agent', key: 'planner', x: 300, y: 0, config: { model: 'gpt-5.5', effort: 'low', engine: 'codex' } }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n0', port: 'task' } }] };
const tplRows = (rc, o = {}) => buildGraphNodeRows(TPL, REG, rc, { models: MODELS, engine: 'claude', ...o });

test('a pinned pick keeps its harness on the row and is judged against it, whatever the run\'s', () => {
  for (const engine of ['claude', 'codex']) {
    const [n0] = buildNodeConfigRows(WF, REG, PINNED, { models: MODELS, engine });
    assert.deepEqual([n0.model, n0.effort, n0.engine, n0.enginePair, n0.modified], ['gpt-5.5', 'low', 'codex', undefined, true], engine);
  }
  const [soft] = buildNodeConfigRows(WF, REG, { nodes: { n0: { model: 'claude-haiku-4-5' } } }, { models: MODELS, engine: 'claude' });
  assert.deepEqual(['engine' in soft, 'engine' in soft.def, 'engine' in soft.override], [false, false, false]);
});
test('a pinned pick its harness no longer runs is healed and remembered with its harness', () => {
  const [n0] = buildNodeConfigRows(WF, REG, { nodes: { n0: { model: 'claude-haiku-4-5', effort: 'medium', engine: 'codex' } } }, { models: MODELS, engine: 'claude' });
  assert.deepEqual([n0.model, 'engine' in n0, n0.enginePair], ['claude-opus-4-8', false, { model: 'claude-haiku-4-5', effort: 'medium', engine: 'codex' }]);
});
test('engine travels with its model: a pinned template alone, a slot that skips a pinned template but fills over a soft one, a node pick over a pinned legacy step', () => {
  assert.deepEqual([tplRows({ nodes: {} })[0].engine, tplRows({ nodes: {} })[0].def.engine], ['codex', 'codex'], 'the template\'s own pin');
  const SLOT = { slotDefaults: { planner: { model: 'claude-opus-4-8' } } };
  const skipped = tplRows({ nodes: {} }, SLOT)[0];
  assert.deepEqual([skipped.model, skipped.engine, skipped.def.model, skipped.def.engine], ['gpt-5.5', 'codex', 'gpt-5.5', 'codex'], 'rule 6: a pinned workflow pick counts as set');
  const soft = { ...TPL, nodes: TPL.nodes.map((n) => (n.id === 'n0' ? { ...n, config: { model: 'claude-haiku-4-5', effort: 'medium' } } : n)) };
  const filled = buildGraphNodeRows(soft, REG, { nodes: {} }, { models: MODELS, engine: 'claude', ...SLOT })[0];
  assert.deepEqual([filled.model, 'engine' in filled, 'engine' in filled.def], ['claude-opus-4-8', false, false], 'over a soft workflow pick the slot wins, as today');
  const over = tplRows({ nodes: { n0: { model: 'claude-haiku-4-5' } } }, { legacySteps: { planner: { model: 'gpt-5.5', engine: 'codex' } } })[0];
  assert.deepEqual([over.model, 'engine' in over, 'engine' in over.override], ['claude-haiku-4-5', false, false]);
});
test('pruneNodeSelection: a pinned row re-sends its harness; a soft model over a stored harness clears it; nothing stored, no key', () => {
  const [n0] = buildNodeConfigRows(WF, REG, PINNED, { models: MODELS, engine: 'claude' });
  assert.deepEqual(pruneNodeSelection(n0, { fanOut: false }), { model: 'gpt-5.5', effort: 'low', engine: 'codex', fanOut: false, askQuestions: undefined, subagentModel: '' });
  assert.equal(pruneNodeSelection(n0, { model: 'claude-haiku-4-5', effort: 'medium', engine: '' }).engine, '');
  assert.deepEqual(pruneNodeSelection(n0, { model: 'claude-opus-4-8', effort: 'high', engine: '' }), { model: '', effort: '', engine: '', fanOut: null, askQuestions: undefined, subagentModel: '' },
    'the workflow\'s own pair: inherit, and the stored harness cleared');
  const [plain] = buildNodeConfigRows(WF, REG, { nodes: {} }, { models: MODELS, engine: 'claude' });
  assert.equal('engine' in pruneNodeSelection(plain, { model: 'claude-haiku-4-5', effort: 'medium' }), false);
  assert.equal(pruneNodeSelection(plain, { model: 'gpt-5.5', effort: 'low', engine: 'codex' }).engine, 'codex');
  const [stale] = buildNodeConfigRows(WF, REG, { nodes: { n0: { model: 'claude-haiku-4-5', effort: 'medium', engine: 'codex' } } }, { models: MODELS, engine: 'claude' });
  assert.deepEqual(pruneNodeSelection(stale, { fanOut: false }), { model: 'claude-haiku-4-5', effort: 'medium', engine: 'codex', fanOut: false, askQuestions: undefined, subagentModel: '' },
    'a pin whose model left its harness rides along untouched (the server keeps it unchecked)');
});
test('buildRoleRows: a role pick carries its harness, the pick of the layer that names the model', async () => {
  const { GRAPH_SHAPE_REQ_WORKFLOW } = await import('../src/core/graph/builtin-workflows.mjs');
  const nodeRows = GRAPH_SHAPE_REQ_WORKFLOW.nodes.filter((n) => n.kind === 'agent').map((n) => ({ nodeId: n.id, label: n.id }));
  const [first, second] = buildRoleRows(GRAPH_SHAPE_REQ_WORKFLOW, nodeRows, { nodes: {} });
  const rc = { nodes: { [first.nodeId]: { roles: { [first.roleKey]: { model: 'gpt-5.5', effort: 'low', engine: 'codex' } } } } };
  const rows = buildRoleRows(GRAPH_SHAPE_REQ_WORKFLOW, nodeRows, rc);
  const one = rows.find((r) => r.nodeId === first.nodeId && r.roleKey === first.roleKey);
  const two = rows.find((r) => r.nodeId === second.nodeId && r.roleKey === second.roleKey);
  assert.deepEqual([one.engine, one.def], ['codex', { model: 'gpt-5.5', effort: 'low', engine: 'codex' }]);
  assert.equal('engine' in two, false);
});
