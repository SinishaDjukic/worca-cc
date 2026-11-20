// test/workflow-test-judge-models.test.mjs — D87, D105: Claude models only, and the suggestion is one the workflow does not write with.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { connectionLabel } from '../src/shared/connections.mjs';
import { claudeModels, paysFor, suggestJudgeModel, withJudgeModel, checkJudgeModel } from '../src/core/workflow-tests/judge-models.mjs';

const homes = [];
beforeEach(async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-wftjm-')); homes.push(d); _resetForTests(); process.env.WORCA_HOME = d; });
after(async () => { _resetForTests(); delete process.env.WORCA_HOME; await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true }))); });

// Rows as listModels() composes them: `harnesses` is what runsOn reads first (connections.mjs harnessesOf).
const CATALOG = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', harnesses: ['claude'] },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', harnesses: ['claude'] },
  { id: 'claude-opus-4-8[1m]', label: 'Opus 4.8 (1M)', harnesses: ['claude'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', harnesses: ['claude'] },
];
const models = CATALOG.map(({ id, label }) => ({ id, label }));

test('suggestJudgeModel: Opus first, not a model the workflow writes with, no (1M) twin; all used: the first, not suggested', () => {
  assert.deepEqual(suggestJudgeModel(models, new Set(['claude-sonnet-5-5'])), { id: 'claude-opus-5-5', label: 'Opus 5.5', suggested: true });
  assert.deepEqual(suggestJudgeModel(models, new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])), { id: 'claude-haiku-4-5', label: 'Haiku 4.5', suggested: true });
  assert.deepEqual(suggestJudgeModel(models, new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'])),
    { id: 'claude-opus-5-5', label: 'Opus 5.5', suggested: false });
  assert.equal(suggestJudgeModel([], new Set()), null);
});

test('withJudgeModel: an example with criteria and no model gets the suggestion; a picked model must be in the list', async () => {
  const catalog = async () => CATALOG;
  assert.deepEqual(await withJudgeModel('wf_x', { criteria: [{ text: 'Names a metric' }] }, null, { catalog }),
    { criteria: [{ text: 'Names a metric' }], judge: { model: 'claude-opus-5-5' } });
  assert.deepEqual(await withJudgeModel('wf_x', { name: 'E' }, null, { catalog }), { name: 'E' }, 'no criteria, no model');
  assert.deepEqual(await withJudgeModel('wf_x', { name: 'E' }, { criteria: [{ id: 'k_1', text: 'Names a metric' }], judge: { model: 'claude-haiku-4-5' } }, { catalog }),
    { name: 'E' }, 'a kept model stays');
  await assert.rejects(checkJudgeModel('gpt-9', { catalog }), { code: 'BAD_REQUEST', message: 'pick one of the AI models in the list to check your criteria' });
  assert.equal(claudeModels([{ id: 'gpt-5', label: 'GPT-5', harnesses: ['codex'] }, ...CATALOG], { envOf: () => undefined, processEnv: {}, userEnv: {}, userSettings: {} }).length, 4);
});

const quiet = { envOf: () => undefined, processEnv: {}, userEnv: {}, userSettings: {} };   // nothing routes: the runner's own environment never leaks in
test('P4-Q17: each model says who pays for a check with it', () => {
  assert.deepEqual(claudeModels([{ id: 'claude-opus-5-5', label: 'Opus 5.5' },
    { id: 'claude-opus-5-5-gw', label: 'Opus 5.5 (gateway)', env: { ANTHROPIC_BASE_URL: 'https://gw.example' } }], quiet),
  [{ id: 'claude-opus-5-5', label: 'Opus 5.5', pays: 'Claude sign-in' }, { id: 'claude-opus-5-5-gw', label: 'Opus 5.5 (gateway)', pays: 'Custom endpoint' }]);
});

test('N3: a cloud or broker that routes the model is named, never "Claude sign-in"', () => {
  const row = [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }];
  const pays = (o) => claudeModels(row, { ...quiet, ...o })[0].pays;
  assert.equal(pays({ envOf: () => ({ CLAUDE_CODE_USE_VERTEX: '1' }) }), 'Google Vertex AI', 'the model env routes it');
  assert.equal(pays({ processEnv: { CLAUDE_CODE_USE_BEDROCK: '1' } }), 'Amazon Bedrock, set where Worca runs');
  assert.equal(pays({ userEnv: { CLAUDE_CODE_USE_VERTEX: 'true' } }), 'Google Vertex AI, set in your Claude Code settings');
  assert.equal(pays({ processEnv: { ANTHROPIC_API_KEY: 'x' } }), 'An API key set where Worca runs');
  assert.equal(pays({ processEnv: { WORCA_BROKER_URL: 'http://127.0.0.1:9' } }), "Worca's credential broker");
  assert.equal(pays({ envOf: () => ({ ANTHROPIC_BASE_URL: 'https://gw.example', CLAUDE_CODE_USE_VERTEX: '0' }), processEnv: { CLAUDE_CODE_USE_VERTEX: '1' } }),
    'Custom endpoint', 'the model env sends it to an endpoint and turns the cloud off ("0"), so the ambient Vertex switch does not apply');
});

const quiet2 = quiet;
const pays2 = (o) => claudeModels([{ id: 'claude-opus-5-5', label: 'Opus 5.5' }], { ...quiet2, ...o })[0].pays;

test('Fix round 1: a key in the model own env is named, never "Claude sign-in"', () => {
  assert.equal(pays2({ envOf: () => ({ ANTHROPIC_API_KEY: 'k' }) }), "An API key in this model's settings");
  assert.equal(pays2({ envOf: () => ({ ANTHROPIC_AUTH_TOKEN: 'k' }) }), "An API key in this model's settings");
});

test('Fix round 1: other routing Worca can see, in P4-Q17 order', () => {
  assert.equal(pays2({ processEnv: { ANTHROPIC_BASE_URL: 'https://gw.example' } }), 'Custom endpoint, set where Worca runs');
  assert.equal(pays2({ userEnv: { ANTHROPIC_BASE_URL: 'https://gw.example' } }), 'Custom endpoint, set in your Claude Code settings');
  assert.equal(pays2({ userSettings: { apiKeyHelper: 'x' } }), 'An API key helper in your Claude Code settings');
  assert.equal(pays2({ userSettings: { awsAuthRefresh: 'x' } }), 'Amazon Bedrock, set in your Claude Code settings');
  assert.equal(pays2({ userSettings: { awsCredentialExport: 'x' } }), 'Amazon Bedrock, set in your Claude Code settings');
  assert.equal(pays2({ processEnv: { CLAUDE_CODE_OAUTH_TOKEN: 't' } }), 'A Claude sign-in token set where Worca runs');
  assert.equal(pays2({ userEnv: { CLAUDE_CODE_OAUTH_TOKEN: 't' } }), 'A Claude sign-in token set in your Claude Code settings');
  assert.equal(pays2({ processEnv: { ANTHROPIC_BASE_URL: 'https://gw.example' }, userSettings: { apiKeyHelper: 'x' } }), 'Custom endpoint, set where Worca runs', 'where Worca runs comes before the settings');
  assert.equal(pays2({}), 'Claude sign-in');
});

test('Fix round 1+2: hidden built-ins are never listed, suggested or stored automatically; a saved hidden model still validates', async () => {
  const cat = CATALOG.map((m) => (m.id === 'claude-opus-5-5' ? { ...m, hidden: true } : m));
  const catalog = async () => cat;
  assert.ok(!claudeModels(cat, quiet2).some((m) => m.id === 'claude-opus-5-5'));
  assert.deepEqual(await withJudgeModel('wf_x', { criteria: [{ text: 'Names a metric' }] }, null, { catalog }),
    { criteria: [{ text: 'Names a metric' }], judge: { model: 'claude-sonnet-5-5' } }, 'the hidden Opus is not suggested');
  await checkJudgeModel('claude-opus-5-5', { catalog });   // a saved hidden model validates
  assert.deepEqual(await withJudgeModel('wf_x', { judge: { model: 'claude-opus-5-5' } }, null, { catalog }), { judge: { model: 'claude-opus-5-5' } });
  await assert.rejects(checkJudgeModel('gpt-9', { catalog }), { code: 'BAD_REQUEST' });
});

test('Fix round 2: the connection is named before a key in the model env', () => {
  const bridged = { id: 'claude-opus-5-5', label: 'Opus 5.5', connection: { kind: 'provider', provider: 'openai', api: null, codex: false, prefer: 'claude' } };
  const env = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', ANTHROPIC_AUTH_TOKEN: 'loopback', CLAUDE_CODE_USE_VERTEX: '0' };
  const bridgedLabel = connectionLabel(bridged);
  assert.notEqual(bridgedLabel, 'Claude sign-in');
  assert.equal(paysFor(bridged, { modelEnv: env, processEnv: {}, userEnv: {}, userSettings: {} }), bridgedLabel);
  assert.equal(paysFor({ id: 'x', label: 'X' }, { modelEnv: { ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_AUTH_TOKEN: 'k' }, processEnv: {}, userEnv: {}, userSettings: {} }), 'Custom endpoint');
});

test('your Claude Code settings go over the model env (except over the bridge), so a cloud they switch on is named', () => {
  assert.equal(pays2({ envOf: () => ({ CLAUDE_CODE_USE_VERTEX: '0' }), userEnv: { CLAUDE_CODE_USE_VERTEX: '1' } }), 'Google Vertex AI, set in your Claude Code settings');
  assert.equal(paysFor({ id: 'x', label: 'X' }, { modelEnv: { ANTHROPIC_BASE_URL: 'https://gw.example', CLAUDE_CODE_USE_VERTEX: '0' }, processEnv: {}, userEnv: { CLAUDE_CODE_USE_VERTEX: '1' }, userSettings: {} }),
    'Google Vertex AI, set in your Claude Code settings', 'a gateway row: the settings switch the cloud back on');
  const bridged = { id: 'claude-opus-5-5', label: 'Opus 5.5', connection: { kind: 'provider', provider: 'openai', api: null, codex: false, prefer: 'claude' } };
  const bridgeEnv = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/m/claude-opus-5-5', ANTHROPIC_AUTH_TOKEN: 'loopback', CLAUDE_CODE_USE_VERTEX: '0' };
  assert.equal(paysFor(bridged, { modelEnv: bridgeEnv, processEnv: {}, userEnv: { CLAUDE_CODE_USE_VERTEX: '1' }, userSettings: {} }), connectionLabel(bridged), 'the bridge keeps its routing');
});

test('Fix round 2: a cloud switch set where Worca runs or in your settings beats a model-env key, unless the model env sets it', () => {
  const key = { ANTHROPIC_API_KEY: 'k' };
  assert.equal(pays2({ envOf: () => key, processEnv: { CLAUDE_CODE_USE_VERTEX: '1' } }), 'Google Vertex AI, set where Worca runs');
  assert.equal(pays2({ envOf: () => key, userEnv: { CLAUDE_CODE_USE_BEDROCK: '1' } }), 'Amazon Bedrock, set in your Claude Code settings');
  assert.equal(pays2({ envOf: () => ({ ...key, CLAUDE_CODE_USE_VERTEX: '0' }), processEnv: { CLAUDE_CODE_USE_VERTEX: '1' } }), "An API key in this model's settings");
});

test('Fix round 1: "on" follows the CLI (1, true, yes, on)', () => {
  assert.equal(pays2({ processEnv: { CLAUDE_CODE_USE_VERTEX: 'yes' } }), 'Google Vertex AI, set where Worca runs');
  assert.equal(pays2({ processEnv: { CLAUDE_CODE_USE_VERTEX: 'banana' } }), 'Claude sign-in');
});
