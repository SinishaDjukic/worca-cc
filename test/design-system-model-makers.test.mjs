// test/design-system-model-makers.test.mjs — the model picker's makers (ui/public/design-system/components/model-makers.mjs):
// each catalog row goes under who makes the model, and a row off its maker's own engine names its engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../ui/public/design-system/components/index.mjs';

test('maps each engine\'s rows to its maker', () => {
  assert.equal(R.makerOf({ id: 'claude-sonnet-5-5' }), 'anthropic');
  assert.equal(R.makerOf({ id: 'gpt-5.5-codex', engine: 'codex' }), 'openai');
  assert.equal(R.makerOf({ id: 'gemini-3-pro', engine: 'gemini' }), 'google');
  assert.equal(R.makerOf({ id: 'qwen3-coder', engine: 'qwen' }), 'local');
  assert.equal(R.makerOf({ id: 'mystery-1' }), 'other');
  assert.equal(R.makerOf({ id: 'opus' }), 'anthropic', 'a short alias');
  assert.equal(R.makerOf({ id: 'o3' }), 'openai');
  assert.equal(R.makerOf({ id: 'ollama/llama3' }), 'local');
  assert.equal(R.makerOf({ id: 'house-model', engine: 'codex' }), 'openai', 'the engine when no id rule matches');
  assert.equal(R.makerOf({ id: 'house-model', engine: 'gemini' }), 'google');
  assert.equal(R.makerOf({ label: 'no id' }), 'other');
});

test('copilot rows go to their maker', () => {
  assert.equal(R.makerOf({ id: 'copilot/claude-sonnet', engine: 'copilot' }), 'anthropic');
  assert.equal(R.makerOf({ id: 'copilot/gemini-2.5-pro', engine: 'copilot' }), 'google');
  assert.equal(R.makerOf({ id: 'copilot/gpt-5', engine: 'copilot' }), 'openai');
  assert.equal(R.modelText({ id: 'copilot/gemini-2.5-pro', label: 'Gemini 2.5 Pro', engine: 'copilot' }), 'Gemini 2.5 Pro · Copilot');
});

test('the id wins over Qwen Code\'s engine', () => {
  const oss = { id: 'gpt-oss', label: 'GPT OSS', engine: 'qwen' };
  assert.equal(R.makerOf(oss), 'openai');
  assert.match(R.modelText(oss), /· Qwen Code$/);
  assert.equal(R.makerOf({ id: 'my-model', engine: 'qwen' }), 'local');
});

test('a Copilot-run Sonnet reads Sonnet · Copilot', () => {
  assert.equal(R.modelText({ id: 'copilot/claude-sonnet', label: 'Sonnet', engine: 'copilot' }), 'Sonnet · Copilot');
  assert.equal(R.modelText({ id: 'copilot/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', engine: 'copilot' }), 'Sonnet 5.5 · Copilot');
});

test('native rows carry no engine', () => {
  assert.equal(R.modelText({ id: 'opus', label: 'Opus 5.5' }), 'Opus 5.5');
  assert.equal(R.modelText({ id: 'claude-opus', label: 'Claude Opus 5.5', engine: 'claude' }), 'Opus 5.5');
  assert.equal(R.modelText({ id: 'mystery', label: 'Mystery', engine: 'claude' }), 'Mystery · Claude Code');
  assert.equal(R.modelText({ id: 'gpt', label: 'Codex 5', engine: 'codex' }), 'Codex 5');
  assert.equal(R.modelText({ id: 'x-1', engine: 'acme' }), 'x-1 · acme', 'the id when no label; an unknown engine as its raw id');
});

test('makers come in a fixed order and empty ones are left out', () => {
  const rows = [{ id: 'gpt', label: 'Codex 5', engine: 'codex' }, { id: 'opus', label: 'Opus 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' }];
  const groups = R.modelMakers(rows, { chosen: 'sonnet' });
  assert.deepEqual(groups.map((g) => g.id), ['anthropic', 'openai']);
  assert.deepEqual(groups.map((g) => g.name), ['Anthropic', 'OpenAI']);
  assert.deepEqual(groups[0].items, [{ id: 'opus', text: 'Opus 5.5', checked: false }, { id: 'sonnet', text: 'Sonnet 5.5', checked: true }], 'catalog order');
  assert.deepEqual(R.MAKERS.map((m) => m.id), ['anthropic', 'openai', 'google', 'local', 'other']);
  assert.ok(Object.isFrozen(R.MAKERS));
});

test('no row is dropped or doubled', () => {
  const rows = [{ id: 'opus' }, { id: 'gpt', engine: 'codex' }, { id: 'gemini-pro', engine: 'gemini' }, { id: 'qwen3', engine: 'qwen' }, { id: 'odd' }, { label: 'no id' }, { id: 7 }];
  const n = R.modelMakers(rows).reduce((s, g) => s + g.items.length, 0);
  assert.equal(n, rows.filter((r) => typeof r.id === 'string').length);
  assert.deepEqual(R.modelMakers(rows).map((g) => g.id), ['anthropic', 'openai', 'google', 'local', 'other']);
});

test('one maker lists flat, several open as sub-menus', () => {
  assert.deepEqual(R.makerItems([{ id: 'opus', label: 'Opus 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' }], { chosen: 'opus' }),
    [{ header: 'Anthropic' }, { id: 'opus', text: 'Opus 5.5', checked: true }, { id: 'sonnet', text: 'Sonnet 5.5', checked: false }]);
  assert.deepEqual(R.makerItems([{ id: 'opus', label: 'Opus 5.5' }, { id: 'gpt', label: 'Codex 5', engine: 'codex' }]),
    [{ id: 'anthropic', text: 'Anthropic', sub: [{ id: 'opus', text: 'Opus 5.5', checked: false }] }, { id: 'openai', text: 'OpenAI', sub: [{ id: 'gpt', text: 'Codex 5', checked: false }] }]);
});

test('no rows, no items', () => {
  assert.deepEqual(R.makerItems([]), []);
  assert.deepEqual(R.makerItems(), []);
});
