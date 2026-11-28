// test/ui-inspector-engine.test.mjs — the composer inspector's Model field is the columns picker's trigger
// (models/model-columns.mjs): inherit, a soft pick's model alone, a pinned pick's harness mark and model, and the
// Effort list the picked model takes on the picked harness (pickEffortsOn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderNodeInspector } from '../ui/public/graph/inspector.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], engine: 'claude' },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex' },
  { id: 'openai-gpt-5.5', label: 'GPT-5.5 (API)', efforts: ['low', 'medium', 'high'], engine: 'claude', harnesses: ['claude', 'codex'], connection: { kind: 'provider', provider: 'openai', api: 'openai-responses', codex: true } },
];
const opts = (o = {}) => ({ template: { nodes: [], wires: [] }, portsFn: () => ({ inputs: [], outputs: [] }), meta: { key: 'planner', displayName: 'Plan' }, models: MODELS, efforts: ['medium', 'high', 'xhigh', 'max'], doc, ...o });
const agent = (config) => ({ id: 'n_agent', kind: 'agent', key: 'planner', config });
const trigger = (el) => el.querySelector('button[data-field="model"]');
const efforts = (el) => [...el.querySelector('[data-field="effort"]').options].map((o) => o.value).sort();

test('the Model field is the columns picker\'s trigger: inherit with nothing picked, and Effort offers the default harness\'s efforts', () => {
  const el = renderNodeInspector(agent({}), opts({ defaultEngine: 'codex' }));
  const t = trigger(el);
  assert.deepEqual([t.className, t.value, t.dataset.engine, t.getAttribute('aria-haspopup'), t.getAttribute('aria-expanded'), t.querySelector('.mdl-pick-text').textContent, t.querySelector('.mdl-mark')],
    ['mdl-pick inherit', '', '', 'dialog', 'false', 'inherit', null]);
  assert.equal(t.closest('.ins-f.ins-model').querySelector('.ins-label').textContent, 'Model');
  assert.deepEqual(efforts(el), ['', 'high', 'low', 'medium', 'minimal']);
});
test('a soft pick shows the model alone and its efforts where it runs; a pinned one shows the harness mark, and a stored own effort stays offered', () => {
  const soft = renderNodeInspector(agent({ model: 'gpt-5.5', effort: 'low' }), opts());
  assert.deepEqual([trigger(soft).value, trigger(soft).dataset.engine, trigger(soft).querySelector('.mdl-pick-text').textContent, trigger(soft).querySelector('.mdl-mark')], ['gpt-5.5', '', 'GPT-5.5', null]);
  assert.deepEqual(efforts(soft), ['', 'high', 'low', 'medium', 'minimal'], 'Claude Code cannot run it: its own harness');
  const pinned = renderNodeInspector(agent({ model: 'openai-gpt-5.5', engine: 'codex' }), opts());
  assert.deepEqual([trigger(pinned).dataset.engine, trigger(pinned).querySelector('.mdl-mark.sm img').getAttribute('alt'), trigger(pinned).getAttribute('aria-label')],
    ['codex', 'OpenAI Codex', 'Model: GPT-5.5 (API), on OpenAI Codex']);
  assert.deepEqual(efforts(pinned), ['', 'high', 'low', 'medium']);
  const own = renderNodeInspector(agent({ model: 'openai-gpt-5.5', engine: 'claude', effort: 'low' }), opts());
  assert.deepEqual([efforts(own).includes('low'), own.querySelector('[data-field="effort"]').value], [true, 'low'], 'its own effort on Claude Code, which the server accepts');
});
test('a pick the catalog lost reads "<id> (not in the catalog)" and keeps its harness', () => {
  const t = trigger(renderNodeInspector(agent({ model: 'gone-1', engine: 'codex' }), opts()));
  assert.deepEqual([t.querySelector('.mdl-pick-text').textContent, t.dataset.engine], ['gone-1 (not in the catalog)', 'codex']);
});
