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

test('the agent inspector groups models by provider, names a harness other than Claude Code, and offers the picked model\'s own efforts', () => {
  const el = renderNodeInspector({ id: 'n_agent', kind: 'agent', key: 'planner', config: { model: 'gpt-5.5', effort: 'low' } }, opts(MODELS));
  const sel = el.querySelector('[data-field="model"]');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Claude sign-in', 'ChatGPT sign-in']);
  assert.deepEqual([...sel.querySelectorAll('optgroup[label="ChatGPT sign-in"] option')].map((o) => [o.value, o.textContent]), [['gpt-5.5', 'GPT-5.5 · Codex']]);
  assert.equal(sel.options[0].value, '', 'inherit stays first, outside the groups');
  assert.equal(sel.value, 'gpt-5.5');
  assert.deepEqual([...el.querySelector('[data-field="effort"]').options].map((o) => o.value), ['', 'minimal', 'low', 'medium', 'high']);
});

test('one connection in the catalog: still its group (every model picker groups by connection), and the given efforts', () => {
  const el = renderNodeInspector({ id: 'n_agent', kind: 'agent', key: 'planner', config: {} }, opts([MODELS[0]]));
  assert.deepEqual([...el.querySelectorAll('[data-field="model"] optgroup')].map((g) => g.label), ['Claude sign-in']);
  assert.deepEqual([...el.querySelector('[data-field="effort"]').options].map((o) => o.value), ['', 'medium', 'high', 'xhigh', 'max']);
});

test('an endpoint model both harnesses reach is listed once, under its provider, naming both', () => {
  const ep = { id: 'openai-gpt-5.5', label: 'GPT-5.5 (API)', efforts: ['medium', 'high'], engine: 'claude', harnesses: ['claude', 'codex'], connection: { kind: 'provider', provider: 'openai', api: 'openai-responses', codex: true } };
  const el = renderNodeInspector({ id: 'n_agent', kind: 'agent', key: 'planner', config: {} }, opts([...MODELS, ep]));
  const sel = el.querySelector('[data-field="model"]');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Claude sign-in', 'ChatGPT sign-in', 'OpenAI-compatible']);
  assert.deepEqual([...sel.querySelectorAll('optgroup[label="OpenAI-compatible"] option')].map((o) => o.textContent), ['GPT-5.5 (API) · Claude, Codex']);
});
