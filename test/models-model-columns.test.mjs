import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harnessTree, initialColumns, selectColumn, stepColumns, columnsValue, columnsLabel, pickEfforts, nodeModelPatch, columnHeight } from '../ui/public/models/model-columns.mjs';

const sign = (engine) => ({ kind: 'signin', engine });
const prov = (provider, api, codex = false) => ({ kind: 'provider', provider, api, codex, prefer: 'claude' });
const CAT = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], engine: 'claude', connection: sign('claude'), harnesses: ['claude'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], engine: 'claude', connection: sign('claude'), harnesses: ['claude'], hidden: true },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex', connection: sign('codex'), harnesses: ['codex'] },
  { id: 'openai-gpt-6.1-sol', label: 'GPT-6.1 Sol (OpenAI-compatible)', efforts: ['low', 'medium', 'high'], custom: 'global', bridged: 'openai', upstreamModel: 'gpt-6.1-sol', connection: prov('openai', 'openai-responses', true), harnesses: ['claude', 'codex'] },
  { id: 'or-kimi-k3', label: 'Kimi K3 (OpenRouter)', custom: 'global', bridged: 'openai', upstreamModel: 'moonshotai/kimi-k3', needsSignIn: true, signInReason: 'no_key', connection: prov('openai', 'openai-chat'), harnesses: ['claude'] },
  { id: 'ant-sonnet', label: 'Sonnet via gateway', custom: 'global', bridged: 'anthropic', needsSignIn: true, signInReason: 'no_key', connection: prov('anthropic', 'anthropic-messages'), harnesses: ['claude'] },
  { id: 'gh-gpt', label: 'GPT-5 (Copilot)', custom: 'global', bridged: 'copilot', needsSignIn: true, signInReason: 'signed_out', connection: prov('copilot', null), harnesses: ['claude'] },
  { id: 'copilot/claude-sonnet-5-5', label: 'Claude Sonnet 5.5', efforts: ['low', 'medium', 'high'], engine: 'copilot', builtin: true, connection: sign('copilot'), harnesses: ['copilot'] },
];
const ENGINES = [{ name: 'claude', label: 'Claude Code', ready: true, reason: null }, { name: 'codex', label: 'OpenAI Codex', ready: false, reason: 'Codex is not signed in.' },
  { name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor is off while the credential broker is on', broker: true }];
const tree = (o = {}) => harnessTree(CAT, { engines: ENGINES, ...o });
const of = (t, engine) => t.find((h) => h.engine === engine);
const provs = (t, engine) => of(t, engine).providers.map((p) => [p.name, p.status ? `${p.status.tone}:${p.status.word}` : null,
  p.models.map((m) => `${m.id}|${m.name}|${m.note}|${m.blocked}`)]);

test('harnessTree: every model harness in order; providers are modelGroups of what it runs plus its own sign-in; a two-harness model on both', () => {
  const t = tree();
  assert.deepEqual(t.map((h) => [h.engine, h.name, h.isDefault]), [['claude', 'Claude Code', true], ['codex', 'OpenAI Codex', false], ['copilot', 'GitHub Copilot', false],
    ['cursor', 'Cursor', false], ['gemini', 'Gemini CLI', false], ['goose', 'Goose', false], ['opencode', 'OpenCode', false], ['qwen', 'Qwen Code', false]]);
  assert.deepEqual(provs(t, 'claude'), [
    ['Claude sign-in', 'ok:Ready', ['claude-opus-5-5|Opus 5.5||false']],
    ['Anthropic-compatible', 'need:Needs key', ['ant-sonnet|Sonnet via gateway|Needs key|true']],
    ['GitHub Copilot', 'need:Needs sign-in', ['gh-gpt|GPT-5|Needs sign-in|true']],
    ['OpenAI-compatible', 'ok:Ready', ['openai-gpt-6.1-sol|GPT-6.1 Sol|also on OpenAI Codex|false', 'or-kimi-k3|Kimi K3|Needs key|true']]]);
  assert.deepEqual(provs(t, 'codex'), [['ChatGPT sign-in', 'off:Not ready', ['gpt-6.1-sol|GPT-6.1 Sol||false']],
    ['OpenAI-compatible', 'ok:Ready', ['openai-gpt-6.1-sol|GPT-6.1 Sol|also on Claude Code|false']]]);
  assert.equal(of(t, 'codex').providers[0].status.title, 'Codex is not signed in.');
  assert.deepEqual(provs(t, 'gemini'), [['Gemini CLI sign-in', 'off:No models yet', []]]);
  assert.deepEqual(provs(t, 'copilot'), [['Copilot sign-in', null, ['copilot/claude-sonnet-5-5|Claude Sonnet 5.5||false']]], 'no readiness row: no word');
  assert.equal(of(t, 'claude').providers[3].models[1].title, 'Its provider is not set up yet. Set it up on the Providers tab.');
});
test('harnessTree: a broker-locked harness blocks its models with the reason; no readiness, no sign-in word; hidden only when picked; a lost pick listed first', () => {
  const t = harnessTree([...CAT, { id: 'cur-1', label: 'Cur One', engine: 'cursor', connection: sign('cursor'), harnesses: ['cursor'] }], { engines: ENGINES });
  assert.equal(of(t, 'cursor').locked, 'cursor is off while the credential broker is on');
  assert.deepEqual(of(t, 'cursor').providers[0].models.map((m) => [m.blocked, m.title]), [[true, 'cursor is off while the credential broker is on']]);
  assert.equal(harnessTree(CAT, { engines: null })[0].providers[0].status, null);
  assert.deepEqual(tree({ current: { model: 'claude-haiku-4-5', engine: 'claude' } })[0].providers[0].models.map((m) => m.id), ['claude-opus-5-5', 'claude-haiku-4-5']);
  const lost = of(tree({ current: { model: 'gone-1', engine: 'codex' } }), 'codex').providers[0].models[0];
  assert.deepEqual([lost.id, lost.name, lost.blocked], ['gone-1', 'gone-1 (not in the catalog)', false]);
  assert.equal(of(tree({ current: { model: 'gone-1' }, defaultEngine: 'codex' }), 'codex').providers[0].models[0].id, 'gone-1', 'a soft lost pick sits on the default harness');
});
test('initialColumns: a pinned pick on its harness, a soft one on the default harness when it runs there, else its own; nothing picked: inherit', () => {
  const st = (value, d = 'claude') => initialColumns(tree({ current: value, defaultEngine: d }), value, { catalog: CAT, defaultEngine: d });
  assert.deepEqual(st({ model: 'openai-gpt-6.1-sol', engine: 'codex' }), { col: 'model', harness: 'codex', provider: 'OpenAI-compatible', model: 'openai-gpt-6.1-sol', tick: { engine: 'codex', model: 'openai-gpt-6.1-sol' } });
  assert.deepEqual(st({ model: 'openai-gpt-6.1-sol' }), { col: 'model', harness: 'claude', provider: 'OpenAI-compatible', model: 'openai-gpt-6.1-sol', tick: { engine: 'claude', model: 'openai-gpt-6.1-sol' } });
  assert.equal(st({ model: 'openai-gpt-6.1-sol' }, 'codex').harness, 'codex');
  assert.deepEqual(st({ model: 'gpt-6.1-sol' }), { col: 'model', harness: 'codex', provider: 'ChatGPT sign-in', model: 'gpt-6.1-sol', tick: { engine: 'codex', model: 'gpt-6.1-sol' } });
  assert.deepEqual(st(null, 'codex'), { col: 'inherit', harness: 'codex', provider: 'ChatGPT sign-in', model: 'gpt-6.1-sol', tick: null });
  assert.deepEqual(st({ model: 'claude-opus-5-5', engine: 'codex' }), { col: 'inherit', harness: 'codex', provider: 'ChatGPT sign-in', model: 'gpt-6.1-sol', tick: { engine: 'codex', model: 'claude-opus-5-5' } });
  assert.deepEqual(st({ model: 'gone-1', engine: 'codex' }), { col: 'model', harness: 'codex', provider: 'ChatGPT sign-in', model: 'gone-1', tick: { engine: 'codex', model: 'gone-1' } });
});
test('selectColumn: a shown harness opens on the tick\'s provider or its first with models; a provider stops on its tick or first open model', () => {
  const t = tree();
  const s = { col: 'model', harness: 'claude', provider: 'Claude sign-in', model: 'claude-opus-5-5', tick: { engine: 'codex', model: 'openai-gpt-6.1-sol' } };
  assert.deepEqual(selectColumn(t, s, 'harness', 'codex'), { ...s, col: 'harness', harness: 'codex', provider: 'OpenAI-compatible', model: 'openai-gpt-6.1-sol' });
  assert.deepEqual(selectColumn(t, s, 'provider', 'Anthropic-compatible'), { ...s, col: 'provider', provider: 'Anthropic-compatible', model: '' });
  assert.deepEqual(selectColumn(t, s, 'model', 'claude-opus-5-5'), { ...s, col: 'model' });
});
test('stepColumns: the keys as the table says', () => {
  const t = tree();
  const at = (s) => ({ tick: null, ...s });
  const go = (s, key) => stepColumns(t, at(s), key);
  const h = { col: 'harness', harness: 'claude', provider: 'Claude sign-in', model: 'claude-opus-5-5' };
  assert.equal(go({ ...h, col: 'inherit' }, 'ArrowDown').state.col, 'harness');
  assert.deepEqual([go({ ...h, col: 'inherit' }, 'Enter').picked, go({ ...h, col: 'inherit' }, ' ').value], [true, null]);
  assert.deepEqual(go(h, 'ArrowDown').state, at({ col: 'harness', harness: 'codex', provider: 'ChatGPT sign-in', model: 'gpt-6.1-sol' }));
  assert.equal(go({ ...h, harness: 'copilot', provider: 'Copilot sign-in', model: 'copilot/claude-sonnet-5-5' }, 'ArrowDown').state.harness, 'gemini', 'the locked Cursor is passed by');
  assert.deepEqual([go(h, 'ArrowUp').state.harness, go(h, 'End').state.harness], ['claude', 'qwen']);
  assert.deepEqual([go(h, 'ArrowRight').state.col, go(h, 'Enter').state.col, go(h, 'ArrowLeft').state.col, go(h, ' ').state.col], ['provider', 'provider', 'harness', 'harness']);
  const p = { ...h, col: 'provider' };
  assert.deepEqual(go(p, 'ArrowDown').state, at({ col: 'provider', harness: 'claude', provider: 'Anthropic-compatible', model: '' }));
  assert.equal(go({ ...p, provider: 'Anthropic-compatible', model: '' }, 'ArrowRight').state.col, 'provider', 'nothing to pick there');
  assert.deepEqual(go(p, 'End').state, at({ col: 'provider', harness: 'claude', provider: 'OpenAI-compatible', model: 'openai-gpt-6.1-sol' }));
  assert.deepEqual([go(p, 'ArrowRight').state.col, go(p, 'ArrowLeft').state.col], ['model', 'harness']);
  const m = { ...h, col: 'model', provider: 'OpenAI-compatible', model: 'openai-gpt-6.1-sol' };
  assert.equal(go(m, 'ArrowDown').state.model, 'openai-gpt-6.1-sol', 'the blocked Kimi K3 is passed by');
  assert.deepEqual([go(m, 'Enter').picked, go(m, 'Enter').value, go(m, ' ').value], [true, { model: 'openai-gpt-6.1-sol', engine: 'claude' }, { model: 'openai-gpt-6.1-sol', engine: 'claude' }]);
  assert.equal(go(m, 'ArrowLeft').state.col, 'provider');
  const none = go(m, 'x');
  assert.deepEqual([none.picked, none.state], [false, at(m)]);
});
test('columnsValue and columnsLabel: a pinned value draws its harness, a soft one the model alone, a lost one says so', () => {
  assert.deepEqual([columnsValue({ model: 'm', engine: 'codex', effort: 'high' }), columnsValue({ model: 'm', engine: '' }), columnsValue({ engine: 'codex' }), columnsValue(null)],
    [{ model: 'm', engine: 'codex' }, { model: 'm' }, null, null]);
  assert.deepEqual(columnsLabel(null, CAT), { text: 'inherit', engine: '', inherit: true, missing: false });
  assert.deepEqual(columnsLabel({ model: 'openai-gpt-6.1-sol', engine: 'codex' }, CAT), { text: 'GPT-6.1 Sol', engine: 'codex', inherit: false, missing: false });
  assert.deepEqual(columnsLabel({ model: 'openai-gpt-6.1-sol' }, CAT), { text: 'GPT-6.1 Sol', engine: '', inherit: false, missing: false });
  assert.deepEqual(columnsLabel({ model: 'gone-1', engine: 'codex' }, CAT), { text: 'gone-1 (not in the catalog)', engine: 'codex', inherit: false, missing: true });
});
test('pickEfforts and nodeModelPatch: the picked model\'s efforts on the picked harness; a pick writes model and engine and drops an effort it lacks', () => {
  assert.deepEqual(pickEfforts({ model: 'openai-gpt-6.1-sol', engine: 'codex' }, { catalog: CAT }), ['low', 'medium', 'high']);
  assert.deepEqual(pickEfforts({ model: 'openai-gpt-6.1-sol' }, { catalog: CAT }), ['medium', 'high']);
  assert.deepEqual(pickEfforts({ model: 'gpt-6.1-sol' }, { catalog: CAT }), ['minimal', 'low', 'medium', 'high'], 'soft, and not on Claude Code: its own harness');
  assert.deepEqual(pickEfforts(null, { defaultEngine: 'codex' }), ['minimal', 'low', 'medium', 'high']);
  const own = (m) => m.efforts;   // stands in for plan 1's pickEffortsOn in the wiring
  assert.deepEqual(pickEfforts({ model: 'openai-gpt-6.1-sol', engine: 'claude' }, { catalog: CAT, effortsOf: own }), ['low', 'medium', 'high']);
  assert.deepEqual(nodeModelPatch({ model: 'gpt-6.1-sol', engine: 'codex' }, { catalog: CAT, effort: 'xhigh' }), { model: 'gpt-6.1-sol', engine: 'codex', effort: null });
  assert.deepEqual(nodeModelPatch({ model: 'openai-gpt-6.1-sol', engine: 'codex' }, { catalog: CAT, effort: 'high' }), { model: 'openai-gpt-6.1-sol', engine: 'codex' });
  assert.deepEqual(nodeModelPatch({ model: 'openai-gpt-6.1-sol', engine: 'claude' }, { catalog: CAT, effort: 'low', effortsOf: own }), { model: 'openai-gpt-6.1-sol', engine: 'claude' });
  assert.deepEqual(nodeModelPatch({ model: 'claude-opus-5-5' }, { catalog: CAT, effort: 'low' }), { model: 'claude-opus-5-5', engine: null, effort: null });
  assert.deepEqual(nodeModelPatch({ model: 'gone-1', engine: 'codex' }, { catalog: CAT, effort: 'max' }), { model: 'gone-1', engine: 'codex' });
  assert.deepEqual(nodeModelPatch(null, { catalog: CAT, effort: 'high' }), { model: null, engine: null });
});
test('columnHeight: min(420px, the larger room below or above the trigger)', () => {
  assert.equal(columnHeight({ viewportHeight: 720, anchorTop: 100, anchorBottom: 132 }), 420);
  assert.equal(columnHeight({ viewportHeight: 300, anchorTop: 100, anchorBottom: 132 }), 154);
  assert.equal(columnHeight({ viewportHeight: 300, anchorTop: 250, anchorBottom: 282 }), 236);
  assert.equal(columnHeight({ viewportHeight: 200, anchorTop: 60, anchorBottom: 92, chrome: 50 }), 44, 'no floor: it never outgrows the room');
});
