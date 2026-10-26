// test/ask-engine-ui.test.mjs — the panel's engine helpers (cascading-settings-design.md §6 Ask, D12, D16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineOfEntry, chatEngineOf, pickerGroups, attachRefusal, engineSwitchConfirm, readEnginePicks, rememberEnginePick, engineLead, switchEffort, pickerEngineName } from '../ui/public/ask-engine.mjs';
import { chatSwitchChanges } from '../src/shared/engine-switch.mjs';

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
  assert.deepEqual(pickerGroups(CAT.models).map((g) => [g.label, g.models.map((m) => m.id)]), [['Claude', ['claude-opus-5-5']], ['Codex (beta)', ['gpt-5.5']]]);
  assert.deepEqual(pickerGroups(CAT.models, { lock: 'codex' }).map((g) => g.engine), ['codex']);
});

test('attachRefusal: a Codex chat refuses PDFs and names the chats that view them', () => {
  assert.equal(attachRefusal({ ext: '.pdf', engine: 'codex' }), 'a Codex chat cannot view PDFs (Claude, Copilot, Gemini CLI, OpenCode or Qwen Code chats can)');
  assert.equal(attachRefusal({ ext: '.pdf', engine: 'claude' }), null);
  assert.equal(attachRefusal({ ext: '.png', engine: 'codex' }), null);
});

test('pickerGroups: `active` marks the chat\'s own engine and hides none (#943)', () => {
  assert.deepEqual(pickerGroups(CAT.models, { active: 'codex' }).map((g) => g.label), ['Claude', 'Codex (beta) · this chat']);
  assert.deepEqual(pickerGroups(CAT.models, { lock: 'codex', active: 'codex' }).map((g) => g.label), ['Codex (beta) · this chat']);
});

test('chatSwitchChanges: what moving a chat from one engine to another changes (#943)', () => {
  assert.deepEqual(chatSwitchChanges('claude', 'codex').map((c) => c.key), ['tools', 'pdfs']);
  assert.deepEqual(chatSwitchChanges('codex', 'claude').map((c) => c.key), ['tools']);
  assert.deepEqual(chatSwitchChanges('claude', 'copilot').map((c) => c.key), ['tools', 'cost']);
  assert.deepEqual(chatSwitchChanges('codex', 'copilot').map((c) => c.key), ['cost']);
  assert.deepEqual(chatSwitchChanges('claude', 'cursor'), [], 'not a chat engine');
  assert.match(chatSwitchChanges('claude', 'codex')[0].text, /^Codex has no file tools or sub-agents of its own/);
});

test('engineSwitchConfirm: the engine, what changes, lost MCP servers, unviewable files, dropped turns', () => {
  const c = engineSwitchConfirm({ from: 'claude', to: 'codex', model: 'gpt-5.5', effort: 'medium',
    changes: chatSwitchChanges('claude', 'codex'), mcpLost: ['notion'], attachments: [{ id: 'att_1', name: 'trace.pdf' }],
    transcript: { totalTurns: 12, droppedTurns: 3 } }, 'GPT-5.5');
  assert.equal(c.title, 'Switch this chat to Codex?');
  assert.equal(c.confirmLabel, 'Switch to Codex');
  assert.equal(c.danger, true);
  assert.match(c.message, /^Your next message runs on Codex with GPT-5\.5 \(medium\)\. This chat keeps/);
  assert.match(c.message, /\nWhat changes:\n• Codex has no file tools/);
  assert.match(c.message, /• These MCP servers will not start on Codex: notion\./);
  assert.match(c.message, /• Codex cannot view trace\.pdf: it gets only the name\./);
  assert.match(c.message, /• The transcript does not fit Codex's context: the 3 oldest of 12 turns are left out, and Codex will not see their text\./);
  const plain = engineSwitchConfirm({ from: 'codex', to: 'claude', model: 'claude-opus-5-5', effort: 'high', changes: [],
    mcpLost: [], attachments: [], transcript: { totalTurns: 2, droppedTurns: 0 } }, 'Opus 5.5');
  assert.equal('danger' in plain, false);
  assert.doesNotMatch(plain.message, /What changes/);
});

test('per-engine picks: remembered per engine; a switch leads with the last one, else the engine default', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) };
  assert.deepEqual(readEnginePicks(storage), {});
  rememberEnginePick(storage, 'codex', { model: 'gpt-5.4', effort: 'low' });
  rememberEnginePick(storage, 'cursor', { model: 'x', effort: 'low' });   // not a chat engine: ignored
  assert.deepEqual(readEnginePicks(storage), { codex: { model: 'gpt-5.4', effort: 'low' } });
  const models = [{ id: 'gpt-5.5', efforts: ['low', 'medium'] }, { id: 'gpt-5.4', efforts: ['low', 'medium'] }];
  const defaults = { codex: { model: 'gpt-5.5', effort: 'medium' } };
  assert.equal(engineLead(models, readEnginePicks(storage).codex, defaults.codex).id, 'gpt-5.4');
  assert.equal(engineLead(models, { model: 'gone', effort: 'low' }, defaults.codex).id, 'gpt-5.5', 'a vanished pick falls back to the default');
  assert.equal(switchEffort(models[1], 'codex', readEnginePicks(storage), defaults), 'low', 'the last effort used there');
  assert.equal(switchEffort(models[0], 'codex', {}, defaults), 'medium', 'else the engine default');
  assert.equal(switchEffort({ id: 'm', efforts: ['high'] }, 'codex', {}, defaults), 'high', 'else what the model offers');
  storage.setItem('worca-cc.ask.enginePicks', '{broken');
  assert.deepEqual(readEnginePicks(storage), {}, 'a damaged record reads as none');
});

test('engineSwitchConfirm: always says what can differ, and the context window when it changes (#943)', () => {
  const c = engineSwitchConfirm({ from: 'claude', to: 'codex', model: 'gpt-5.5', effort: 'medium', changes: [], mcpLost: [], attachments: [],
    context: { from: 1_000_000, to: 200_000 }, transcript: { totalTurns: 2, droppedTurns: 0 } }, 'GPT-5.5');
  assert.match(c.message, /Its tools, skills, security limits, context window and pricing can differ from Claude's\./);
  assert.match(c.message, /\nWhat changes:\n• Context window: 1M → 200k tokens\.$/);
  const same = engineSwitchConfirm({ from: 'codex', to: 'copilot', model: 'copilot/gpt-5.4', effort: 'high', changes: [], mcpLost: [], attachments: [],
    context: { from: 200_000, to: 200_000 }, transcript: { totalTurns: 2, droppedTurns: 0 } }, 'GPT-5.4');
  assert.doesNotMatch(same.message, /What changes/, 'an equal window is no change');
  assert.match(same.message, /can differ from Codex's\.$/);
  const unknown = engineSwitchConfirm({ from: 'codex', to: 'claude', effort: 'high', context: { from: null, to: 1_000_000 }, transcript: {} }, 'Opus 5.5');
  assert.doesNotMatch(unknown.message, /Context window/, 'an unknown window is not compared');
  assert.match(unknown.message, /with Opus 5\.5 \(high\)\./);
  const flat = engineSwitchConfirm({ from: 'codex', to: 'claude', effort: 'medium', transcript: {} }, 'GLM-4.7', { noEffort: true });
  assert.match(flat.message, /with GLM-4\.7\. This chat keeps/, 'a model without effort names none');
});

test('pickerEngineName: the button names the engine whenever the catalog offers more than one (#943)', () => {
  assert.equal(pickerEngineName(CAT.models, 'codex'), 'Codex');
  assert.equal(pickerEngineName(CAT.models, 'claude'), 'Claude');
  assert.equal(pickerEngineName([CAT.models[0]], 'claude'), '', 'one engine: nothing to tell apart');
});

test('engineLead: a hidden model or one that needs a sign-in never leads; the default does (#943)', () => {
  const def = { model: 'gpt-5.5', effort: 'medium' };
  assert.equal(engineLead([{ id: 'gpt-5.5' }, { id: 'gpt-5.4', hidden: true }], { model: 'gpt-5.4' }, def).id, 'gpt-5.5');
  assert.equal(engineLead([{ id: 'gpt-5.5' }, { id: 'gpt-5.4', needsSignIn: true }], { model: 'gpt-5.4' }, def).id, 'gpt-5.5');
  assert.equal(engineLead([{ id: 'gpt-5.5', hidden: true }], null, def), null);
});
