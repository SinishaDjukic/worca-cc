// test/auto-classify-model-facts.test.mjs — the Auto classifier's model lines carry the picking facts (model-tiers.mjs)
// and its tuning guide states the SAME picking policy the Ask rules do. checkShapeModels is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassifierSystemPrompt } from '../src/core/auto/classify.mjs';
import { MODEL_PICK_POLICY } from '../src/core/model-tiers.mjs';

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], harnesses: ['claude'] },
  { id: 'gw-free', label: 'Gateway free', efforts: ['medium', 'high'], harnesses: ['claude'], connection: { kind: 'env' }, capabilities: { maxPromptTokens: 32000, toolCalls: false } },
  { id: 'claude-hidden-9', label: 'Hidden', efforts: ['high'], hidden: true },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['high', 'max'], harnesses: ['claude'] },
];

test('classifier model lines carry vendor, price tier, list price, free, the window and a missing capability; the tuning guide states the shared policy', () => {
  const sys = buildClassifierSystemPrompt({ models: MODELS, costOf: (id) => (id === 'gw-free' ? { free: true } : null) });
  assert.ok(sys.includes('\n- claude-opus-5-5 (Opus 5.5): efforts medium/high/xhigh/max · anthropic · top tier · $4/$20 per Mtok · 1M context\n'));
  assert.ok(sys.includes('\n- gw-free (Gateway free): efforts medium/high · other · economy tier · $0/$0 per Mtok · free · 32k context · no tool calls\n'),
    'the guide\'s free-model rule names tool calls and the window, so the line shows them');
  assert.equal(sys.includes('claude-hidden-9'), false, 'a hidden model is still never offered');
  assert.ok(sys.includes('\n- claude-fable-5-1 (Fable 5.1): efforts high/max · anthropic · premium tier · $10/$50 per Mtok · 1M context\n'),
    'the line says premium: the guide keeps that tier for a model the user names');
  assert.ok(sys.includes(`\nTuning guide (price tiers as the model lines show them): ${MODEL_PICK_POLICY} Set fanOut only where allowed and only for wide tasks.\n`));
  assert.equal(sys.includes('producer stages (checklist, decomposer) the cheapest'), false, 'the old one-line guide is gone');
});
