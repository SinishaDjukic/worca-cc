// test/ask-engine-ui.test.mjs — the panel's engine helpers (cascading-settings-design.md §6 Ask, D12, D16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineOfEntry, chatEngineOf, pickerGroups, attachRefusal } from '../ui/public/ask-engine.mjs';

const CAT = { models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex' }] };

test('engineOfEntry / chatEngineOf: a chat with an assistant row is locked to its model\'s engine', () => {
  assert.equal(engineOfEntry(CAT.models[1]), 'codex');
  assert.equal(engineOfEntry(null), 'claude');
  assert.equal(chatEngineOf([], 'gpt-5.5', CAT), null);
  assert.equal(chatEngineOf([{ role: 'user' }, { role: 'assistant' }], 'gpt-5.5', CAT), 'codex');
  assert.equal(chatEngineOf([{ role: 'assistant' }], 'gone-model', CAT), 'claude');
  assert.equal(chatEngineOf([{ role: 'assistant' }], 'gone-model', CAT, 'codex'), 'codex', 'the server\'s lock wins once the catalog drops the model');
  assert.equal(chatEngineOf([], 'gone-model', CAT, 'codex'), null, 'no lock before the first reply');
});

test('pickerGroups: one group per engine present, Claude first; a lock keeps one', () => {
  assert.deepEqual(pickerGroups(CAT.models).map((g) => [g.label, g.models.map((m) => m.id)]), [['Claude', ['claude-opus-5-5']], ['Codex', ['gpt-5.5']]]);
  assert.deepEqual(pickerGroups(CAT.models, { lock: 'codex' }).map((g) => g.engine), ['codex']);
});

test('attachRefusal: PDFs need a Claude chat', () => {
  assert.equal(attachRefusal({ ext: '.pdf', engine: 'codex' }), 'PDFs need a Claude chat');
  assert.equal(attachRefusal({ ext: '.pdf', engine: 'claude' }), null);
  assert.equal(attachRefusal({ ext: '.png', engine: 'codex' }), null);
});
