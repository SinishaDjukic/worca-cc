// test/settings-upstream.test.mjs
// `upstream` on a global catalog entry and the `providers` settings key
// (model-bridge-design.md §6): every §6.1 rejection, the minimal stored shape,
// PATCH semantics, the lenient reader, provider defaults/masking/patching, the
// terms acknowledgement, and the plugin-manifest / team-policy mirrors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  settingsFile, listGlobalModels, addGlobalModel, updateGlobalModel,
  providerConfig, allProviders, updateProvider, providerSecretSet, resolveProviderSecret,
  copilotTermsAcknowledged, acknowledgeCopilotTerms, clearCopilotSignIn, readSettings,
} from '../src/core/settings.mjs';
import { assertModelUpstream, assertModelCapabilities, upstreamEnvConflict, bridgeExcludedTools, COPILOT_TERMS_VERSION } from '../src/core/model-env.mjs';
import { normalizeManifest } from '../src/core/plugin-manifest.mjs';
import { normalizePolicyDoc } from '../src/core/policy/registry.mjs';

async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-upstream-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); } finally {
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true });
  }
}
const readRaw = async () => JSON.parse(await readFile(settingsFile(), 'utf8'));

test('assertModelUpstream: every §6.1 rejection names the field', () => {
  const ok = assertModelUpstream({ provider: 'openai', api: 'openai-chat', model: ' gpt-4.1 ', baseUrl: 'https://gw.example/v1/', apiKey: '${K}', headers: { 'X-Team': 'w' }, capabilities: { reasoning: true, maxOutputTokens: '4096' } });
  assert.deepEqual(ok, { provider: 'openai', api: 'openai-chat', model: 'gpt-4.1', baseUrl: 'https://gw.example/v1', apiKey: '${K}', headers: { 'X-Team': 'w' }, capabilities: { reasoning: true, maxOutputTokens: 4096 } });
  assert.equal(assertModelUpstream(undefined), undefined);
  assert.equal(assertModelUpstream(null), undefined);
  const bad = (u, re) => assert.throws(() => assertModelUpstream(u), re);
  bad('x', /must be an object/);
  bad({ provider: 'nope', api: 'anthropic', model: 'm' }, /upstream\.provider must be one of/);
  bad({ provider: 'openai', api: 'nope', model: 'm' }, /upstream\.api must be one of/);
  bad({ provider: 'openai', api: 'anthropic', model: 'm' }, /cannot be driven through api anthropic/);
  bad({ provider: 'anthropic', api: 'openai-chat', model: 'm' }, /cannot be driven through/);
  bad({ provider: 'copilot', api: 'anthropic', model: '' }, /upstream\.model must be a non-empty string/);
  bad({ provider: 'copilot', api: 'anthropic', model: 'm', baseUrl: 'https://x' }, /baseUrl cannot be set for the copilot provider/);
  bad({ provider: 'copilot', api: 'anthropic', model: 'm', apiKey: 'k' }, /apiKey cannot be set for the copilot provider/);
  bad({ provider: 'openai', api: 'openai-chat', model: 'm', baseUrl: 'ftp://x' }, /http\(s\) URL/);
  bad({ provider: 'openai', api: 'openai-chat', model: 'm', baseUrl: 'https://x/v1?y=1' }, /no query or fragment/);
  bad({ provider: 'openai', api: 'openai-chat', model: 'm', headers: { Authorization: 'x' } }, /set by the bridge/);
  bad({ provider: 'openai', api: 'openai-chat', model: 'm', headers: { 'bad name': 'x' } }, /invalid header name/);
  bad({ provider: 'openai', api: 'openai-chat', model: 'm', headers: { X: '' } }, /must be a non-empty string/);
  bad({ provider: 'openai', api: 'openai-chat', model: 'm', capabilities: { vision: 'yes' } }, /capabilities\.vision must be true or false/);
  bad({ provider: 'openai', api: 'openai-chat', model: 'm', capabilities: { maxPromptTokens: -1 } }, /positive integer/);
  bad({ provider: 'openai', api: 'openai-chat', model: 'm', capabilities: { colour: true } }, /unknown upstream\.capabilities key/);
  assert.equal(assertModelCapabilities({ toolCalls: null, maxOutputTokens: '' }), undefined);
  assert.equal(upstreamEnvConflict({ ANTHROPIC_MODEL: 'x' }), 'ANTHROPIC_MODEL');
  assert.equal(upstreamEnvConflict({ CLAUDE_CODE_X: '1' }), null);
  assert.deepEqual(bridgeExcludedTools({ api: 'openai-chat' }), ['WebSearch', 'WebFetch']);
  assert.deepEqual(bridgeExcludedTools({ api: 'anthropic' }), []);
});

test('catalog: add/update/read an upstream entry; env routing keys are rejected beside it', async () => {
  await withSandbox(async () => {
    const added = await addGlobalModel({ id: 'copilot-gpt-5', label: 'GPT-5 (Copilot)', efforts: ['medium', 'high'], upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5' }, cost: { free: true } });
    assert.deepEqual(added, { id: 'copilot-gpt-5', label: 'GPT-5 (Copilot)', efforts: ['medium', 'high'], cost: { free: true }, upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5' } });
    const raw = await readRaw();
    assert.deepEqual(raw.models[0], { id: 'copilot-gpt-5', label: 'GPT-5 (Copilot)', efforts: ['medium', 'high'], cost: { free: true }, upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5' } });
    await assert.rejects(addGlobalModel({ id: 'x', upstream: { provider: 'openai', api: 'openai-chat', model: 'm' }, env: { ANTHROPIC_BASE_URL: 'https://y' } }), /ANTHROPIC_BASE_URL.*cannot be set on a model with an upstream/);
    await assert.rejects(updateGlobalModel('copilot-gpt-5', { env: { ANTHROPIC_AUTH_TOKEN: 'k' } }), /cannot be set on a model with an upstream/);
    // Other env keys still merge; upstream replaced wholesale; null clears it.
    const upd = await updateGlobalModel('copilot-gpt-5', { env: { CLAUDE_CODE_KNOB: '1' }, upstream: { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-4.5', capabilities: { vision: true } } });
    assert.deepEqual(upd.env, { CLAUDE_CODE_KNOB: '1' });
    assert.deepEqual(upd.upstream, { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-4.5', capabilities: { vision: true } });
    const cleared = await updateGlobalModel('copilot-gpt-5', { upstream: null });
    assert.equal(cleared.upstream, undefined);
    assert.equal((await readRaw()).models[0].upstream, undefined);
    // An unknown-field update keeps the block.
    await updateGlobalModel('copilot-gpt-5', { upstream: { provider: 'openai', api: 'openai-chat', model: 'q' } });
    assert.equal((await updateGlobalModel('copilot-gpt-5', { label: 'renamed' })).upstream.model, 'q');
  });
});

test('reader: a malformed upstream is dropped loudly, a clashing env key is dropped for the bridge', async () => {
  await withSandbox(async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(settingsFile()), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ models: [
      { id: 'bad', upstream: { provider: 'nope' } },
      { id: 'clash', upstream: { provider: 'openai', api: 'openai-chat', model: 'm' }, env: { ANTHROPIC_MODEL: 'zzz', KEEP: '1' } },
    ] }));
    const warns = [];
    const orig = console.warn; console.warn = (s) => warns.push(String(s));
    try {
      const list = listGlobalModels();
      assert.equal(list[0].upstream, undefined);
      assert.deepEqual(list[1].env, { KEEP: '1' });
      assert.equal(list[1].upstream.model, 'm');
    } finally { console.warn = orig; }
    assert.ok(warns.some((w) => /dropping invalid upstream/.test(w)));
    assert.ok(warns.some((w) => /dropping env key "ANTHROPIC_MODEL"/.test(w)));
  });
});

test('providers: defaults, patch, delete, masking inputs, secrets and the terms acknowledgement', async () => {
  await withSandbox(async () => {
    assert.deepEqual(providerConfig('copilot'), { maxConcurrent: 4, accountType: 'individual' });
    assert.deepEqual(providerConfig('openai'), { maxConcurrent: 8, baseUrl: 'https://api.openai.com/v1' });
    assert.deepEqual(providerConfig('anthropic'), { maxConcurrent: 8, baseUrl: 'https://api.anthropic.com' });
    assert.deepEqual(Object.keys(allProviders()), ['copilot', 'openai', 'anthropic']);
    assert.throws(() => providerConfig('nope'), /unknown provider/);
    assert.equal(providerSecretSet('copilot'), false);
    assert.equal(copilotTermsAcknowledged(), false);

    const c = await updateProvider('copilot', { githubToken: ' gho_abc ', accountType: 'business', maxConcurrent: 2, login: 'octo' });
    assert.deepEqual(c, { maxConcurrent: 2, accountType: 'business', githubToken: 'gho_abc', login: 'octo' });
    assert.equal(providerSecretSet('copilot'), true);
    assert.deepEqual((await readRaw()).providers.copilot, { githubToken: 'gho_abc', accountType: 'business', maxConcurrent: 2, login: 'octo' });

    await assert.rejects(updateProvider('copilot', { accountType: 'team' }), /accountType must be one of/);
    await assert.rejects(updateProvider('copilot', { maxConcurrent: 0 }), /maxConcurrent must be an integer/);
    await assert.rejects(updateProvider('copilot', { apiKey: 'x' }), /unknown provider field/);
    await assert.rejects(updateProvider('openai', { baseUrl: 'nope' }), /baseUrl must be an http/);
    await assert.rejects(updateProvider('nope', {}), /unknown provider/);

    await acknowledgeCopilotTerms(new Date('2026-09-20T10:00:00Z'));
    assert.equal(copilotTermsAcknowledged(), true);
    assert.equal(providerConfig('copilot').termsVersion, COPILOT_TERMS_VERSION);
    await clearCopilotSignIn();
    const after = providerConfig('copilot');
    assert.equal(after.githubToken, undefined);
    assert.equal(after.login, undefined);
    assert.equal(after.acknowledgedTerms, '2026-09-20T10:00:00.000Z');   // the acknowledgement stays

    const o = await updateProvider('openai', { apiKey: '${OPENAI_KEY}', baseUrl: 'https://gw.example/v1/' });
    assert.equal(o.baseUrl, 'https://gw.example/v1');
    assert.equal(resolveProviderSecret(o.apiKey, { OPENAI_KEY: ' live ' }), 'live');
    assert.equal(resolveProviderSecret(o.apiKey, {}), '');
    assert.equal(resolveProviderSecret('literal', {}), 'literal');
    await updateProvider('openai', { apiKey: null, baseUrl: '' });
    assert.equal(readSettings().providers.openai, undefined);
  });
});

test('plugin manifest: upstream accepted with a ${VAR} apiKey, rejected with a literal, bridge env key ignored', () => {
  const base = { name: 'p', version: '1.0.0', engines: { 'worca-cc-api': 3 } };
  const ok = normalizeManifest({ ...base, models: [{ id: 'm', upstream: { provider: 'openai', api: 'openai-chat', model: 'x', apiKey: '${K}' }, env: { ANTHROPIC_MODEL: 'zzz' } }] }, { dir: '/tmp/nope' });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.deepEqual(ok.manifest.models[0].upstream, { provider: 'openai', api: 'openai-chat', model: 'x', apiKey: '${K}' });
  assert.equal(ok.manifest.models[0].env, undefined);
  assert.ok(ok.warnings.some((w) => /ANTHROPIC_MODEL.*ignored/.test(w)));
  const bad = normalizeManifest({ ...base, models: [{ id: 'm', upstream: { provider: 'openai', api: 'openai-chat', model: 'x', apiKey: 'sk-literal' } }] }, { dir: '/tmp/nope' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /must be a \$\{VAR\} reference/.test(e)));
  const cop = normalizeManifest({ ...base, models: [{ id: 'c', upstream: { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-4.5' } }] }, { dir: '/tmp/nope' });
  assert.equal(cop.ok, true);
});

test('team policy: upstream shipped, a literal key drops the entry', () => {
  const doc = normalizePolicyDoc({ catalogs: { models: [
    { id: 'pol-gpt', upstream: { provider: 'openai', api: 'openai-chat', model: 'g', apiKey: '${TEAM_KEY}' } },
    { id: 'pol-bad', upstream: { provider: 'openai', api: 'openai-chat', model: 'g', apiKey: 'sk-literal' } },
  ] } });
  const models = doc.doc ? doc.doc.catalogs.models : doc.catalogs.models;
  assert.deepEqual(models.map((m) => m.id), ['pol-gpt']);
  assert.equal(models[0].upstream.model, 'g');
  assert.ok((doc.warnings || []).some((w) => /pol-bad.*\$\{VAR\}/.test(w)));
});
