// test/ask-engine-ui.test.mjs — the panel's engine helpers (cascading-settings-design.md §6 Ask, D12, D16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineOfEntry, chatEngineOf, chatSpawnsAgents, pickerGroups, engineNotReady, needsHarness, SET_UP_HARNESS, moreHarnesses, notInstalledHarnesses, attachRefusal, engineSwitchConfirm, readEnginePicks, rememberEnginePick, engineLead, switchEffort, pickerEngineName, pickerEngineLabel } from '../ui/public/ask-engine.mjs';
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
  assert.deepEqual(pickerGroups(CAT.models).map((g) => [g.label, g.models.map((m) => m.id)]), [['Claude Code', ['claude-opus-5-5']], ['OpenAI Codex (beta)', ['gpt-5.5']]]);
  assert.deepEqual(pickerGroups(CAT.models, { lock: 'codex' }).map((g) => g.engine), ['codex']);
});

test('moreHarnesses: the sign-in chat engines with no model, in picker order; none once each has one', () => {
  assert.deepEqual(moreHarnesses(CAT.models), [
    { engine: 'gemini', label: 'Gemini CLI (beta)' }, { engine: 'goose', label: 'Goose (beta)' },
    { engine: 'opencode', label: 'OpenCode (beta)' }, { engine: 'qwen', label: 'Qwen Code (beta)' }]);
  const some = [...CAT.models, { id: 'openai/gpt-5', engine: 'opencode' }, { id: 'gemini-3-pro', engine: 'gemini' }];
  assert.deepEqual(moreHarnesses(some).map((h) => h.engine), ['goose', 'qwen']);
  const all = [...some, { id: 'g', engine: 'goose' }, { id: 'q', engine: 'qwen' }];
  assert.deepEqual(moreHarnesses(all), []);
  assert.deepEqual(moreHarnesses(null).map((h) => h.engine), ['gemini', 'goose', 'opencode', 'qwen'], 'an engine with built-ins (Claude Code, Codex, Copilot) is never one');
  assert.deepEqual(moreHarnesses(CAT.models, { gemini: 'Gemini CLI is not installed', qwen: 'Qwen Code is not installed' }).map((h) => h.engine),
    ['goose', 'opencode'], 'an engine not installed here is left out');
});

test('needsHarness: nothing a new chat can take for want of an installed engine; a chat on a missing engine keeps its own', () => {
  const none = { ...CAT, notReady: { claude: 'Claude Code is not installed.', codex: 'OpenAI Codex is not installed.' } };
  assert.equal(SET_UP_HARNESS, 'Set up a harness');
  assert.equal(needsHarness(none, none.models), true);
  assert.equal(needsHarness(none, none.models, { active: 'claude', current: 'claude-opus-5-5' }), false, 'a chat already on Claude keeps its section');
  const some = { ...CAT, notReady: { claude: 'Claude Code is not installed.' } };
  assert.equal(needsHarness(some, some.models), false, 'Codex is installed');
  assert.deepEqual(pickerGroups(some.models, { notReady: some.notReady }).map((g) => g.engine), ['codex'], 'Claude is left out like any missing engine');
  assert.deepEqual(notInstalledHarnesses(some).map((h) => h.engine), ['claude'], 'and listed among the harnesses to set up');
  assert.equal(needsHarness({ models: [] }, []), false, 'an empty catalog with every engine installed is not one');
  assert.equal(needsHarness(null, []), false);
});

test('notInstalledHarnesses: the engines the catalog says are missing, in picker order, with their setup docs; a shown one is left out', () => {
  const catalog = {
    ...CAT,
    notReady: { qwen: 'Qwen Code is not installed.', codex: 'OpenAI Codex is not installed.' },
    setupDocs: { qwen: 'https://docs.example.test/qwen', codex: 'https://docs.example.test/codex' },
  };
  assert.deepEqual(notInstalledHarnesses(catalog), [
    { engine: 'codex', label: 'OpenAI Codex (beta)', reason: 'OpenAI Codex is not installed.', docsUrl: 'https://docs.example.test/codex' },
    { engine: 'qwen', label: 'Qwen Code (beta)', reason: 'Qwen Code is not installed.', docsUrl: 'https://docs.example.test/qwen' },
  ], 'an engine with models (Codex) is listed too: the picker has no section for it');
  assert.deepEqual(notInstalledHarnesses(catalog, ['claude', 'codex']).map((h) => h.engine), ['qwen'], 'a chat already on Codex has its section');
  assert.equal(notInstalledHarnesses({ notReady: { goose: 'Goose is not installed.' } })[0].docsUrl, null, 'no setup docs: no link');
  assert.deepEqual(notInstalledHarnesses(CAT), [], 'every engine installed');
  assert.deepEqual(notInstalledHarnesses(null), []);
});

test('attachRefusal: a Codex chat refuses PDFs and names the chats that view them', () => {
  assert.equal(attachRefusal({ ext: '.pdf', engine: 'codex' }), 'an OpenAI Codex chat cannot view PDFs (Claude Code, GitHub Copilot, Gemini CLI, OpenCode or Qwen Code chats can)');
  assert.equal(attachRefusal({ ext: '.pdf', engine: 'claude' }), null);
  assert.equal(attachRefusal({ ext: '.png', engine: 'codex' }), null);
});

test('pickerGroups: `active` marks the chat\'s own engine and hides none (#943)', () => {
  assert.deepEqual(pickerGroups(CAT.models, { active: 'codex' }).map((g) => g.label), ['Claude Code', 'OpenAI Codex (beta) · this chat']);
  assert.deepEqual(pickerGroups(CAT.models, { lock: 'codex', active: 'codex' }).map((g) => g.label), ['OpenAI Codex (beta) · this chat']);
});

test('chatSwitchChanges: what moving a chat from one engine to another changes (#943)', () => {
  assert.deepEqual(chatSwitchChanges('claude', 'codex').map((c) => c.key), ['tools', 'pdfs']);
  assert.deepEqual(chatSwitchChanges('codex', 'claude').map((c) => c.key), ['tools']);
  assert.deepEqual(chatSwitchChanges('claude', 'copilot').map((c) => c.key), ['tools', 'cost']);
  assert.deepEqual(chatSwitchChanges('codex', 'copilot').map((c) => c.key), ['cost']);
  assert.deepEqual(chatSwitchChanges('claude', 'cursor'), [], 'not a chat engine');
  assert.match(chatSwitchChanges('claude', 'codex')[0].text, /^OpenAI Codex has no file tools or sub-agents of its own/);
});

test('engineSwitchConfirm: the engine, what changes, lost MCP servers, unviewable files, dropped turns', () => {
  const c = engineSwitchConfirm({ from: 'claude', to: 'codex', model: 'gpt-5.5', effort: 'medium',
    changes: chatSwitchChanges('claude', 'codex'), mcpLost: ['notion'], attachments: [{ id: 'att_1', name: 'trace.pdf' }],
    transcript: { totalTurns: 12, droppedTurns: 3 } }, 'GPT-5.5');
  assert.equal(c.title, 'Switch this chat to OpenAI Codex?');
  assert.equal(c.confirmLabel, 'Switch to OpenAI Codex');
  assert.equal(c.danger, true);
  assert.match(c.message, /^Your next message runs on OpenAI Codex with GPT-5\.5 \(medium\)\. This chat keeps/);
  assert.match(c.message, /\nWhat changes:\n• OpenAI Codex has no file tools/);
  assert.match(c.message, /• These MCP servers will not start on OpenAI Codex: notion\./);
  assert.match(c.message, /• OpenAI Codex cannot view trace\.pdf: it gets only the name\./);
  assert.match(c.message, /• The transcript does not fit OpenAI Codex's context: the 3 oldest of 12 turns are left out, and OpenAI Codex will not see their text\./);
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
  assert.match(c.message, /Its tools, skills, security limits, context window and pricing can differ from Claude Code's\./);
  assert.match(c.message, /\nWhat changes:\n• Context window: 1M → 200k tokens\.$/);
  const same = engineSwitchConfirm({ from: 'codex', to: 'copilot', model: 'copilot/gpt-5.4', effort: 'high', changes: [], mcpLost: [], attachments: [],
    context: { from: 200_000, to: 200_000 }, transcript: { totalTurns: 2, droppedTurns: 0 } }, 'GPT-5.4');
  assert.doesNotMatch(same.message, /What changes/, 'an equal window is no change');
  assert.match(same.message, /can differ from OpenAI Codex's\.$/);
  const unknown = engineSwitchConfirm({ from: 'codex', to: 'claude', effort: 'high', context: { from: null, to: 1_000_000 }, transcript: {} }, 'Opus 5.5');
  assert.doesNotMatch(unknown.message, /Context window/, 'an unknown window is not compared');
  assert.match(unknown.message, /with Opus 5\.5 \(high\)\./);
  const flat = engineSwitchConfirm({ from: 'codex', to: 'claude', effort: 'medium', transcript: {} }, 'GLM-4.7', { noEffort: true });
  assert.match(flat.message, /with GLM-4\.7\. This chat keeps/, 'a model without effort names none');
});

test('pickerGroups notReady: an engine not installed here is left out, unless the chat is on it (then only its model)', () => {
  const many = [...CAT.models, { id: 'gpt-5.4', label: 'GPT-5.4', engine: 'codex' }];
  const notReady = { codex: 'not installed' };
  assert.deepEqual(pickerGroups(many, { notReady }).map((g) => g.engine), ['claude']);
  assert.deepEqual(pickerGroups(many, { notReady, active: 'claude' }).map((g) => g.engine), ['claude']);
  const own = pickerGroups(many, { notReady, active: 'codex', current: 'gpt-5.4' });
  assert.deepEqual(own.map((g) => [g.engine, g.models.map((m) => m.id), g.notReady || null]), [['claude', ['claude-opus-5-5'], null], ['codex', ['gpt-5.4'], 'not installed']]);
  assert.deepEqual(pickerGroups(many, { notReady, lock: 'codex', active: 'codex', current: 'gpt-5.5' }).map((g) => g.models.map((m) => m.id)), [['gpt-5.5']]);
  assert.deepEqual(pickerGroups(many, { notReady: {}, active: 'codex' }).map((g) => g.models.length), [1, 2], 'an empty map hides nothing');
  // A model both harnesses reach stays in the Claude section.
  const both = [{ id: 'resp-1', engine: 'claude', harnesses: ['claude', 'codex'] }];
  assert.deepEqual(pickerGroups(both, { notReady }).map((g) => g.engine), ['claude']);
});

test('engineNotReady: the catalog\'s reason for an engine, else null', () => {
  assert.equal(engineNotReady({ notReady: { codex: 'why' } }, 'codex'), 'why');
  assert.equal(engineNotReady({ notReady: { codex: 'why' } }, 'claude'), null);
  assert.equal(engineNotReady({}, 'codex'), null);
  assert.equal(engineNotReady(null, 'codex'), null);
});

test('pickerEngineName: the button names the engine whenever the catalog offers more than one (#943)', () => {
  assert.equal(pickerEngineName(CAT.models, 'codex'), 'OpenAI Codex');
  assert.equal(pickerEngineName(CAT.models, 'claude'), 'Claude Code');
  assert.equal(pickerEngineName([CAT.models[0]], 'claude'), '', 'one engine: nothing to tell apart');
  assert.equal(pickerEngineName(CAT.models, 'claude', { notReady: { codex: 'x' } }), '', 'an engine the picker leaves out is not counted');
  assert.equal(pickerEngineName(CAT.models, 'codex', { notReady: { codex: 'x' }, active: 'codex', current: 'gpt-5.5' }), 'OpenAI Codex', 'a chat on it still counts it');
});

test('engineLead: a hidden model or one that needs a sign-in never leads; the default does (#943)', () => {
  const def = { model: 'gpt-5.5', effort: 'medium' };
  assert.equal(engineLead([{ id: 'gpt-5.5' }, { id: 'gpt-5.4', hidden: true }], { model: 'gpt-5.4' }, def).id, 'gpt-5.5');
  assert.equal(engineLead([{ id: 'gpt-5.5' }, { id: 'gpt-5.4', needsSignIn: true }], { model: 'gpt-5.4' }, def).id, 'gpt-5.5');
  assert.equal(engineLead([{ id: 'gpt-5.5', hidden: true }], null, def), null);
});

test('chatSpawnsAgents: a plain chat on Claude only (a chat with a design is one); the Workflows chat and every other engine start none', () => {
  assert.equal(chatSpawnsAgents(null, 'claude'), true);
  assert.equal(chatSpawnsAgents(undefined, 'claude'), true);
  assert.equal(chatSpawnsAgents('composer', 'claude'), false, 'the Workflows chat');
  for (const engine of ['codex', 'copilot', 'cursor', 'gemini', 'qwen', 'opencode', 'goose', null]) assert.equal(chatSpawnsAgents(null, engine), false, String(engine));
});

test('pickerEngineLabel: the Copilot engine is named as the Copilot CLI, so it never reads like the GitHub Copilot provider', () => {
  assert.equal(pickerEngineLabel('copilot'), 'GitHub Copilot CLI');
  assert.equal(pickerEngineLabel('copilot', { beta: true }), 'GitHub Copilot CLI (beta)');
  assert.equal(pickerEngineLabel('claude', { beta: true }), 'Claude Code');
  assert.equal(pickerEngineLabel('codex', { beta: true }), 'OpenAI Codex (beta)');
  const models = [{ id: 'claude-opus-5-5' }, { id: 'copilot/gpt-5.5', engine: 'copilot' }];
  assert.deepEqual(pickerGroups(models).map((g) => g.label), ['Claude Code', 'GitHub Copilot CLI (beta)']);
  assert.equal(pickerEngineName(models, 'copilot'), 'GitHub Copilot CLI');
});
