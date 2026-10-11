// test/node-tunables-engine.test.mjs — New pipeline's engine heal (cascading-settings-design.md §6,
// D10): a stored pick of the other engine is skipped at run time, so the row shows what the run
// uses instead and remembers the pick, which a save of another tunable re-sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeConfigRows, pruneNodeSelection } from '../ui/public/node-tunables.mjs';

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
