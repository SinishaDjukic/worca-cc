// test/connections.test.mjs — harness ⟂ provider ⟂ model (src/shared/connections.mjs): a catalog model's harnesses
// follow from its connection, never from a tag. A sign-in runs only in its own harness; routing env is Claude Code's;
// a provider is reached by Claude Code through the bridge and, for an OpenAI Responses endpoint, by Codex directly.
// Also: a gateway twin of a built-in id gets an id of its own (R6). Sandboxes HOME (settings.json) and WORCA_HOME.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  connectionOf, harnessesOf, runsOn, effortOn, effortsOn, connectionLabel, connectionKey, suggestModelHandle, runsOnText, codexReaches,
} from '../src/shared/connections.mjs';
import { listModels, enginesOfModel, engineOfModel, modelRunsOn, modelForEngine, foreignRunModel, catalogHasModel, modelConnection } from '../src/core/config.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { findCodexEndpointEntry } from '../src/core/engines/codex-endpoint.mjs';
import { _resetForTests } from '../src/core/db.mjs';

const dirs = [];
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
beforeEach(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-conn-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-conn-whome-'));
  dirs.push(home, whome);
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  _resetForTests();
  for (const [k, v] of [['HOME', prevEnv.HOME], ['USERPROFILE', prevEnv.USERPROFILE], ['WORCA_HOME', prevEnv.WORCA_HOME], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevEnv.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const RESPONSES = { provider: 'openai', api: 'openai-responses', model: 'gpt-5.5', baseUrl: 'http://127.0.0.1:8000/v1' };

test('a connection decides the harnesses: sign-in its own, env Claude Code, a provider Claude Code (+ Codex for Responses)', () => {
  assert.deepEqual(harnessesOf({ id: 'claude-opus-5-5' }), ['claude']);
  assert.deepEqual(harnessesOf({ id: 'gpt-5.5', engine: 'codex' }), ['codex']);
  assert.deepEqual(harnessesOf({ id: 'sonnet-4.5', engine: 'cursor' }), ['cursor']);
  assert.deepEqual(harnessesOf({ id: 'glm', env: { ANTHROPIC_BASE_URL: 'https://x' } }), ['claude']);
  assert.deepEqual(harnessesOf({ id: 'gw', upstream: RESPONSES }), ['claude', 'codex']);
  assert.deepEqual(harnessesOf({ id: 'gw', engine: 'codex', upstream: RESPONSES }), ['codex', 'claude'], 'its own engine first');
  assert.deepEqual(harnessesOf({ id: 'gw', upstream: { ...RESPONSES, api: 'openai-chat' } }), ['claude'], 'codex refuses chat completions');
  assert.deepEqual(harnessesOf({ id: 'or', upstream: { ...RESPONSES, openrouter: { provider: { order: ['x'] } } } }), ['claude'], 'OpenRouter routing is the bridge’s');
  assert.deepEqual(harnessesOf({ id: 'cp', upstream: { provider: 'copilot', api: 'openai-responses', model: 'gpt-5' } }), ['claude'], 'copilot needs the bridge');
  assert.deepEqual(harnessesOf({ id: 'an', upstream: { provider: 'anthropic', api: 'anthropic', model: 'x' } }), ['claude']);
  assert.equal(runsOn({ id: 'gw', upstream: RESPONSES }, 'codex'), true);
  assert.equal(runsOn({ id: 'gpt-5.5', engine: 'codex' }, 'claude'), false);
  assert.equal(runsOn({ id: 'x', harnesses: ['claude', 'codex'] }, 'codex'), true, 'a composed row carries its list');
  assert.equal(codexReaches(RESPONSES), true);
});

test('labels and keys: whose allowance a model spends', () => {
  assert.equal(connectionLabel({ id: 'claude-opus-5-5' }), 'Claude sign-in');
  assert.equal(connectionLabel({ id: 'gpt-5.5', engine: 'codex' }), 'ChatGPT sign-in');
  assert.equal(connectionLabel({ id: 'gw', upstream: RESPONSES }), 'OpenAI-compatible');
  assert.equal(connectionLabel({ id: 'glm', env: { ANTHROPIC_BASE_URL: 'https://x' } }), 'Custom endpoint');
  assert.equal(connectionKey({ id: 'a' }), connectionKey({ id: 'b' }), 'every Claude sign-in model shares one allowance');
  assert.notEqual(connectionKey({ id: 'a' }), connectionKey({ id: 'gw', upstream: RESPONSES }));
  assert.equal(connectionOf({ bridged: 'openai', upstreamApi: 'openai-responses' }).kind, 'provider', 'a masked row');
});

test('efforts: a model on two harnesses keeps its own list; the other harness takes the nearest', () => {
  assert.equal(effortOn('max', 'codex'), 'high');
  assert.equal(effortOn('xhigh', 'codex'), 'high');
  assert.equal(effortOn('minimal', 'claude'), 'medium');
  assert.equal(effortOn('medium', 'codex'), 'medium');
  assert.equal(effortOn('high', 'cursor'), null, 'Cursor takes none');
  assert.deepEqual(effortsOn({ efforts: ['medium', 'high', 'xhigh', 'max'] }, 'codex'), ['medium', 'high']);
  assert.deepEqual(effortsOn({ efforts: ['minimal', 'low', 'medium', 'high'] }, 'claude'), ['medium', 'high']);
});

test('the editor words: a suggested id and what a connection runs on', () => {
  assert.equal(suggestModelHandle('gpt-5.5', 'openai'), 'openai-gpt-5.5');
  assert.equal(suggestModelHandle('Org/Model X'), 'gw-org-model-x');
  assert.match(runsOnText({ kind: 'signin', engine: 'codex' }), /^Runs on Codex only/);
  assert.match(runsOnText({ kind: 'env' }), /^Runs on Claude Code only/);
  assert.equal(runsOnText({ kind: 'provider', provider: 'openai', api: 'openai-responses', codex: true }), "Runs on Claude Code (through worca's bridge) and Codex (directly).");
});

test('catalog: an OpenAI Responses endpoint added once runs on Claude Code and Codex; a run on either keeps it', async () => {
  await addGlobalModel({ id: 'openai-gpt-5.5', upstream: RESPONSES });
  const row = (await listModels('')).find((r) => r.id === 'openai-gpt-5.5');
  assert.deepEqual(row.harnesses, ['claude', 'codex']);
  assert.equal(row.engine, 'claude');
  assert.deepEqual(enginesOfModel('openai-gpt-5.5'), ['claude', 'codex']);
  assert.equal(engineOfModel('openai-gpt-5.5'), 'claude', 'the preferred harness');
  assert.equal(modelRunsOn('openai-gpt-5.5', 'codex'), true);
  assert.equal(modelForEngine('openai-gpt-5.5', 'codex'), 'openai-gpt-5.5', 'kept on a Codex run');
  assert.equal(foreignRunModel('openai-gpt-5.5', 'codex'), null);
  assert.equal(catalogHasModel('openai-gpt-5.5', { engine: 'codex' }), true);
  assert.equal(findCodexEndpointEntry('openai-gpt-5.5')?.upstream.model, 'gpt-5.5', 'Codex connects to it itself');
  assert.equal(modelConnection('openai-gpt-5.5').kind, 'provider');
  // A sign-in model stays in its own harness; the run-level refusal names where it runs.
  assert.equal(modelRunsOn('gpt-5.6-sol', 'claude'), false);
  assert.match(foreignRunModel('gpt-5.6-sol', 'claude'), /runs on codex, not on claude — .*--engine codex/);
  assert.equal(modelRunsOn('totally-unknown', 'claude'), null, 'an id no catalog knows: undecided');
  assert.deepEqual(modelConnection('claude-opus-5-5'), { kind: 'signin', engine: 'claude' });
});

test('R6: a gateway twin of a Codex built-in id gets an id of its own; the endpoint is still sent the model id', async () => {
  await assert.rejects(() => addGlobalModel({ id: 'gpt-5.5', env: { ANTHROPIC_BASE_URL: 'https://gw' } }),
    /"gpt-5.5" is the id of Codex's built-in gpt-5.5 \(ChatGPT sign-in\) — give this entry its own id, such as "gw-gpt-5.5", and set ANTHROPIC_MODEL=gpt-5.5 in its env/);
  await assert.rejects(() => addGlobalModel({ id: 'gpt-5.5', upstream: RESPONSES }),
    /such as "openai-gpt-5.5", and keep gpt-5.5 as its upstream model id/);
  const m = await addGlobalModel({ id: 'gw-gpt-5.5', env: { ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_MODEL: 'gpt-5.5' } });
  assert.equal(m.id, 'gw-gpt-5.5');
  assert.deepEqual(enginesOfModel('gw-gpt-5.5'), ['claude']);
  assert.deepEqual(enginesOfModel('gpt-5.5'), ['codex'], 'the built-in stays Codex’s');
});

// Ask Worca: list_models names every engine a model runs on, and the system prompt says to leave the engine to the
// user's default and never pick a beta one unasked.
test('Ask Worca knows the engines: list_models carries harnesses; the prompt keeps beta engines for when the user asks', async () => {
  const { listModelsForAsk } = await import('../src/core/ask/model-deps.mjs');
  const { buildSystemPrompt } = await import('../src/core/ask/prompt.mjs');
  await addGlobalModel({ id: 'openai-gpt-5.5', upstream: RESPONSES });
  const { models } = await listModelsForAsk();
  const row = (id) => models.find((m) => m.id === id) || {};
  assert.deepEqual(row('openai-gpt-5.5').harnesses, ['claude', 'codex']);
  assert.deepEqual(row('gpt-5.5').harnesses, ['codex']);
  assert.deepEqual(row('claude-haiku-4-5').harnesses, ['claude']);
  const prompt = buildSystemPrompt('');
  assert.match(prompt, /Leave engine out and the run starts on the user's default engine/);
  assert.match(prompt, /never pick a beta engine on your own/);
});
