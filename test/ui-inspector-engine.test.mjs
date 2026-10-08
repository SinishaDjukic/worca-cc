// test/ui-inspector-engine.test.mjs — the composer inspector knows no run engine, so it shows one
// model list grouped Claude / Codex (cascading-settings-design.md D10) and the picked model's
// own efforts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderNodeInspector } from '../ui/public/graph/inspector.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], engine: 'claude' },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex' },
];
const opts = (models) => ({ template: { nodes: [], wires: [] }, portsFn: () => ({ inputs: [], outputs: [] }), meta: { key: 'planner', displayName: 'Plan' }, models, efforts: ['medium', 'high', 'xhigh', 'max'], doc });

test('the agent inspector groups models by engine and offers the picked model\'s own efforts', () => {
  const el = renderNodeInspector({ id: 'n_agent', kind: 'agent', key: 'planner', config: { model: 'gpt-5.5', effort: 'low' } }, opts(MODELS));
  const sel = el.querySelector('[data-field="model"]');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Claude', 'Codex (beta)']);
  assert.deepEqual([...sel.querySelectorAll('optgroup[label="Codex (beta)"] option')].map((o) => o.value), ['gpt-5.5']);
  assert.equal(sel.options[0].value, '', 'inherit stays first, outside the groups');
  assert.equal(sel.value, 'gpt-5.5');
  assert.deepEqual([...el.querySelector('[data-field="effort"]').options].map((o) => o.value), ['', 'minimal', 'low', 'medium', 'high']);
});

test('one engine in the catalog: a flat list and the given efforts, as before', () => {
  const el = renderNodeInspector({ id: 'n_agent', kind: 'agent', key: 'planner', config: {} }, opts([MODELS[0]]));
  assert.equal(el.querySelectorAll('[data-field="model"] optgroup').length, 0);
  assert.deepEqual([...el.querySelector('[data-field="effort"]').options].map((o) => o.value), ['', 'medium', 'high', 'xhigh', 'max']);
});
