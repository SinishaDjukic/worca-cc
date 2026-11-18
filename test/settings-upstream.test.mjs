// test/settings-upstream.test.mjs
// `upstream` on a global catalog entry and the `providers` settings key
// (model-bridge-design.md §6): every §6.1 rejection, the minimal stored shape,
// PATCH semantics, the lenient reader, provider defaults/masking/patching, the
// Copilot sign-in, and the plugin-manifest / team-policy mirrors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  settingsFile, listGlobalModels, addGlobalModel, updateGlobalModel,
  providerConfig, allProviders, updateProvider, providerSecretSet, resolveProviderSecret,
  clearCopilotSignIn, readSettings,
} from '../src/core/settings.mjs';
import { assertModelUpstream, assertModelCapabilities, upstreamEnvConflict, bridgeExcludedTools, isTranslatedApi, UPSTREAM_APIS } from '../src/core/model-env.mjs';
import { providerReadiness } from '../src/core/bridge/registry.mjs';
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

test('isLocalBaseUrl: loopback and private-network hosts only', async () => {
  const { isLocalBaseUrl } = await import('../src/core/model-env.mjs');
  for (const u of ['http://127.0.0.1:8080/v1', 'http://localhost:11434/v1', 'http://[::1]:8080/v1', 'http://10.0.0.5/v1', 'http://192.168.1.20:8000/v1', 'http://172.20.0.2/v1', 'http://gpu-box.local:8080/v1']) {
    assert.equal(isLocalBaseUrl(u), true, u);
  }
  for (const u of ['https://api.openai.com/v1', 'https://172.32.0.1/v1', 'https://gateway.example.com/v1', 'not a url', '', undefined]) {
    assert.equal(isLocalBaseUrl(u), false, String(u));
  }
});

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

test('providers: defaults, patch, delete, masking inputs, secrets and clearing the Copilot sign-in', async () => {
  await withSandbox(async () => {
    assert.deepEqual(providerConfig('copilot'), { maxConcurrent: 4, accountType: 'individual' });
    assert.deepEqual(providerConfig('openai'), { maxConcurrent: 8, baseUrl: 'https://api.openai.com/v1' });
    assert.deepEqual(providerConfig('anthropic'), { maxConcurrent: 8, baseUrl: 'https://api.anthropic.com' });
    assert.deepEqual(Object.keys(allProviders()), ['copilot', 'openai', 'anthropic']);
    assert.throws(() => providerConfig('nope'), /unknown provider/);
    assert.equal(providerSecretSet('copilot'), false);

    const c = await updateProvider('copilot', { githubToken: ' gho_abc ', accountType: 'business', maxConcurrent: 2, login: 'octo' });
    assert.deepEqual(c, { maxConcurrent: 2, accountType: 'business', githubToken: 'gho_abc', login: 'octo' });
    assert.equal(providerSecretSet('copilot'), true);
    assert.deepEqual((await readRaw()).providers.copilot, { githubToken: 'gho_abc', accountType: 'business', maxConcurrent: 2, login: 'octo' });

    await assert.rejects(updateProvider('copilot', { accountType: 'team' }), /accountType must be one of/);
    await assert.rejects(updateProvider('copilot', { maxConcurrent: 0 }), /maxConcurrent must be an integer/);
    await assert.rejects(updateProvider('copilot', { apiKey: 'x' }), /unknown provider field/);
    await assert.rejects(updateProvider('openai', { baseUrl: 'nope' }), /baseUrl must be an http/);
    await assert.rejects(updateProvider('nope', {}), /unknown provider/);

    await clearCopilotSignIn();
    const after = providerConfig('copilot');
    assert.equal(after.githubToken, undefined);
    assert.equal(after.login, undefined);
    await assert.rejects(updateProvider('copilot', { acknowledgedTerms: '2026-09-20T10:00:00Z' }), /unknown provider field "acknowledgedTerms"/);

    const o = await updateProvider('openai', { apiKey: '${OPENAI_KEY}', baseUrl: 'https://gw.example/v1/' });
    assert.equal(o.baseUrl, 'https://gw.example/v1');
    assert.equal(resolveProviderSecret(o.apiKey, { OPENAI_KEY: ' live ' }), 'live');
    assert.equal(resolveProviderSecret(o.apiKey, {}), '');
    assert.equal(resolveProviderSecret('literal', {}), 'literal');
    await updateProvider('openai', { apiKey: null, baseUrl: '' });
    assert.equal(readSettings().providers.openai, undefined);
  });
});


test('Copilot: signed in = ready; an old acknowledgement in settings.json loads silently and changes nothing', async () => {
  await withSandbox(async () => {
    const prevBroker = process.env.WORCA_BROKER_URL; delete process.env.WORCA_BROKER_URL;
    const warns = []; const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      // Not signed in: the only Copilot readiness reason left.
      assert.deepEqual(providerReadiness({ provider: 'copilot' }).reason, 'not_signed_in');
      // Signed in, never acknowledged anything: ready.
      await updateProvider('copilot', { githubToken: 'gho_abc' });
      assert.deepEqual(providerReadiness({ provider: 'copilot' }), { ok: true });
      assert.equal('acknowledgedTerms' in (await readRaw()).providers.copilot, false);
      // A settings.json written by an older Worca still loads: the stale keys are ignored, never warned about.
      await mkdir(dirname(settingsFile()), { recursive: true });
      await writeFile(settingsFile(), JSON.stringify({ providers: { copilot: { githubToken: 'gho_old', acknowledgedTerms: '2026-01-01T00:00:00.000Z', termsVersion: 1 } } }));
      assert.deepEqual(providerConfig('copilot'), { maxConcurrent: 4, accountType: 'individual', githubToken: 'gho_old' });
      assert.deepEqual(providerReadiness({ provider: 'copilot' }), { ok: true });
      // A later provider write keeps the file's other keys as they were (no migration, no rewrite of the old ones).
      await updateProvider('copilot', { maxConcurrent: 2 });
      assert.equal((await readRaw()).providers.copilot.termsVersion, 1);
      assert.deepEqual(warns.filter((w) => /acknowledgedTerms|termsVersion/.test(w)), []);
    } finally {
      console.warn = orig;
      if (prevBroker === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = prevBroker;
    }
  });
});

test('copilot enterpriseHost: normalized on save; invalid forms refused with the field message; clearing works', async () => {
  await withSandbox(async () => {
    const c = await updateProvider('copilot', { accountType: 'ghe-com', enterpriseHost: ' https://ACME.ghe.com/ ' });
    assert.deepEqual(c, { maxConcurrent: 4, accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' });
    assert.deepEqual((await readRaw()).providers.copilot, { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' });
    for (const bad of ['acme.ghe.com/path', 'acme.ghe.com:443', 'http://acme.ghe.com', 'user@acme.ghe.com', 'github.com', 'ghe.com', 'api.acme.ghe.com', 5]) {
      await assert.rejects(updateProvider('copilot', { enterpriseHost: bad }), /enterpriseHost must be a GHE\.com host like acme\.ghe\.com, with no path, port or credentials/, String(bad));
    }
    await assert.rejects(updateProvider('openai', { enterpriseHost: 'acme.ghe.com' }), /unknown provider field "enterpriseHost"/);
    await updateProvider('copilot', { accountType: 'individual', enterpriseHost: null });
    assert.equal(providerConfig('copilot').enterpriseHost, undefined);
  });
});

test('copilot clientId: only with ghe-com; validated; cleared by empty; leaving ghe-com drops it; a change keeps the sign-in', async () => {
  await withSandbox(async () => {
    await assert.rejects(updateProvider('copilot', { clientId: 'Ov23liCUSTOM123' }), /clientId applies only to accountType ghe-com/);
    await updateProvider('copilot', { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' });
    for (const bad of ['bad id!', 'short', 'x'.repeat(65), 7]) {
      await assert.rejects(updateProvider('copilot', { clientId: bad }), /clientId must be a GitHub App or OAuth app client id/, String(bad));
    }
    let c = await updateProvider('copilot', { clientId: ' Ov23liCUSTOM123 ' });
    assert.equal(c.clientId, 'Ov23liCUSTOM123');
    assert.equal((await readRaw()).providers.copilot.clientId, 'Ov23liCUSTOM123');
    c = await updateProvider('copilot', { githubToken: 'gho_a', login: 'octo' });
    c = await updateProvider('copilot', { clientId: 'Ov23liOTHER4567' });                 // a change never signs out
    assert.equal(c.githubToken, 'gho_a'); assert.equal(c.clientId, 'Ov23liOTHER4567');
    c = await updateProvider('copilot', { enterpriseHost: 'acme.ghe.com' });               // same host keeps it
    assert.equal(c.clientId, 'Ov23liOTHER4567');
    c = await updateProvider('copilot', { clientId: '' });
    assert.equal(c.clientId, undefined);
    await updateProvider('copilot', { clientId: 'Ov23liCUSTOM123' });
    c = await updateProvider('copilot', { accountType: 'individual' });
    assert.equal(c.clientId, undefined); assert.equal(c.enterpriseHost, undefined);
    await assert.rejects(updateProvider('openai', { clientId: 'Ov23liCUSTOM123' }), /unknown provider field "clientId" for openai/);
  });
});

test('copilot clientId in a hand-edited block: kept for ghe-com, warned and dropped otherwise', async () => {
  await withSandbox(async () => {
    await mkdir(dirname(settingsFile()), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify({ providers: { copilot: { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com', clientId: ' Ov23liCUSTOM123 ' } } }));
    assert.equal(providerConfig('copilot').clientId, 'Ov23liCUSTOM123');
    const warns = []; const orig = console.warn; console.warn = (m) => warns.push(String(m));
    try {
      await writeFile(settingsFile(), JSON.stringify({ providers: { copilot: { accountType: 'individual', clientId: 'Ov23liCUSTOM123' } } }));
      assert.equal(providerConfig('copilot').clientId, undefined);
      await writeFile(settingsFile(), JSON.stringify({ providers: { copilot: { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com', clientId: 'bad id' } } }));
      assert.equal(providerConfig('copilot').clientId, undefined);
    } finally { console.warn = orig; }
    assert.ok(warns.some((w) => /clientId: ignored unless accountType is ghe-com/.test(w)), warns.join('\n'));
    assert.ok(warns.some((w) => /clientId: must look like a GitHub client id/.test(w)), warns.join('\n'));
  });
});

test('ghe-com needs a host; a host needs ghe-com; switching to another type drops the host', async () => {
  await withSandbox(async () => {
    await assert.rejects(updateProvider('copilot', { accountType: 'ghe-com' }), /accountType ghe-com needs enterpriseHost/);
    await assert.rejects(updateProvider('copilot', { enterpriseHost: 'acme.ghe.com' }), /enterpriseHost applies only to accountType ghe-com/);
    await assert.rejects(updateProvider('copilot', { accountType: 'business', enterpriseHost: 'acme.ghe.com' }), /enterpriseHost applies only to accountType ghe-com/);
    await updateProvider('copilot', { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' });
    await assert.rejects(updateProvider('copilot', { enterpriseHost: null }), /accountType ghe-com needs enterpriseHost/);
    await updateProvider('copilot', { maxConcurrent: 2 });                              // an unrelated patch keeps the pair
    assert.equal(providerConfig('copilot').enterpriseHost, 'acme.ghe.com');
    await updateProvider('copilot', { accountType: 'enterprise' });                    // the type alone drops the host
    assert.deepEqual((await readRaw()).providers.copilot, { accountType: 'enterprise', maxConcurrent: 2 });
  });
});

test('changing the GitHub host signs out in the same write; individual↔business↔enterprise keeps the sign-in', async () => {
  await withSandbox(async () => {
    const signed = (extra = {}) => updateProvider('copilot', { githubToken: 'gho_a', login: 'octo', ...extra });
    // individual → ghe-com
    await signed();
    let c = await updateProvider('copilot', { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' });
    assert.equal(c.githubToken, undefined); assert.equal(c.login, undefined);
    // tenant A → B
    await signed();
    c = await updateProvider('copilot', { enterpriseHost: 'other.ghe.com' });
    assert.equal(c.githubToken, undefined); assert.equal(c.enterpriseHost, 'other.ghe.com');
    // same host again keeps the sign-in
    await signed();
    c = await updateProvider('copilot', { enterpriseHost: 'https://other.ghe.com' });
    assert.equal(c.githubToken, 'gho_a');
    // ghe-com → enterprise
    c = await updateProvider('copilot', { accountType: 'enterprise' });
    assert.equal(c.githubToken, undefined); assert.equal(c.login, undefined); assert.equal(c.enterpriseHost, undefined);
    // individual ↔ business ↔ enterprise keep it
    await signed();
    for (const t of ['business', 'individual', 'enterprise']) {
      c = await updateProvider('copilot', { accountType: t });
      assert.equal(c.githubToken, 'gho_a', t);
    }
    assert.equal(c.login, 'octo');
  });
});

test('a patch that sets githubToken and enterpriseHost together keeps the new token', async () => {
  await withSandbox(async () => {
    await updateProvider('copilot', { githubToken: 'gho_old', login: 'old' });
    const c = await updateProvider('copilot', { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com', githubToken: 'gho_new', login: 'new' });
    assert.equal(c.githubToken, 'gho_new'); assert.equal(c.login, 'new');
    const d = await updateProvider('copilot', { enterpriseHost: 'b.ghe.com', githubToken: 'gho_b' });
    assert.equal(d.githubToken, 'gho_b'); assert.equal(d.login, 'new');   // login not in the patch: only the token was replaced
  });
});

test('a refused patch writes nothing (the stored block is byte-equal)', async () => {
  await withSandbox(async () => {
    await updateProvider('copilot', { githubToken: 'gho_a', login: 'octo', maxConcurrent: 3 });
    const before = await readFile(settingsFile(), 'utf8');
    for (const patch of [{ accountType: 'ghe-com' }, { enterpriseHost: 'acme.ghe.com' }, { accountType: 'ghe-com', enterpriseHost: 'nope' }, { maxConcurrent: 2, enterpriseHost: 'x' }]) {
      await assert.rejects(updateProvider('copilot', patch));
      assert.equal(await readFile(settingsFile(), 'utf8'), before);
    }
  });
});

test('dryRun applies the same rules and persists nothing', async () => {
  await withSandbox(async () => {
    await updateProvider('copilot', { githubToken: 'gho_a', login: 'octo' });
    const before = await readFile(settingsFile(), 'utf8');
    const c = await updateProvider('copilot', { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' }, { dryRun: true });
    assert.deepEqual(c, { maxConcurrent: 4, accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' });   // signed out in the preview too
    await assert.rejects(updateProvider('copilot', { accountType: 'ghe-com' }, { dryRun: true }), /needs enterpriseHost/);
    assert.equal(await readFile(settingsFile(), 'utf8'), before);
  });
});

test('expectCopilotHost: a mismatch throws HOST_CHANGED and stores no token', async () => {
  await withSandbox(async () => {
    await updateProvider('copilot', { accountType: 'ghe-com', enterpriseHost: 'acme.ghe.com' });
    const before = await readFile(settingsFile(), 'utf8');
    for (const expect of [null, 'other.ghe.com']) {
      await assert.rejects(updateProvider('copilot', { githubToken: 'gho_x' }, { expectCopilotHost: expect }), (e) => e.code === 'HOST_CHANGED' && /host changed during the sign-in/.test(e.message));
    }
    assert.equal(await readFile(settingsFile(), 'utf8'), before);
    const ok = await updateProvider('copilot', { githubToken: 'gho_x' }, { expectCopilotHost: 'acme.ghe.com' });
    assert.equal(ok.githubToken, 'gho_x');
    await updateProvider('copilot', { accountType: 'individual' });
    await assert.rejects(updateProvider('copilot', { githubToken: 'gho_y' }, { expectCopilotHost: 'acme.ghe.com' }), (e) => e.code === 'HOST_CHANGED');
    assert.equal((await updateProvider('copilot', { githubToken: 'gho_y' }, { expectCopilotHost: null })).githubToken, 'gho_y');
  });
});

test('sanitize: hand-edited ghe-com without a valid host stays ghe-com with no host (warns); a host under another type is ignored; sign-out still works', async () => {
  await withSandbox(async () => {
    const warns = []; const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      await mkdir(dirname(settingsFile()), { recursive: true });
      await writeFile(settingsFile(), JSON.stringify({ providers: { copilot: { accountType: 'ghe-com', enterpriseHost: 'https://github.com', githubToken: 'gho_t' } } }));
      assert.deepEqual(providerConfig('copilot'), { maxConcurrent: 4, accountType: 'ghe-com', githubToken: 'gho_t' });
      assert.ok(warns.some((w) => /enterpriseHost.*must be a GHE\.com host like acme\.ghe\.com/.test(w)));
      await clearCopilotSignIn();                                                         // logout is not blocked by the bad host
      assert.equal(providerConfig('copilot').githubToken, undefined);
      await writeFile(settingsFile(), JSON.stringify({ providers: { copilot: { accountType: 'business', enterpriseHost: 'acme.ghe.com' } } }));
      warns.length = 0;
      assert.deepEqual(providerConfig('copilot'), { maxConcurrent: 4, accountType: 'business' });
      assert.ok(warns.some((w) => /enterpriseHost.*ignored unless accountType is ghe-com/.test(w)));
    } finally { console.warn = orig; }
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

test('openai-responses api + reasoningEfforts capability: accepted where allowed, validated, normalized, stored', async () => {
  assert.deepEqual(UPSTREAM_APIS, ['anthropic', 'openai-chat', 'openai-responses']);
  assert.deepEqual(
    assertModelUpstream({ provider: 'copilot', api: 'openai-responses', model: 'gpt-6-astra', capabilities: { reasoning: true, reasoningEfforts: ['max', 'low', 'medium', 'low'] } }),
    { provider: 'copilot', api: 'openai-responses', model: 'gpt-6-astra', capabilities: { reasoning: true, reasoningEfforts: ['low', 'medium', 'max'] } },
  );
  assert.equal(assertModelUpstream({ provider: 'openai', api: 'openai-responses', model: 'gpt-5-codex' }).api, 'openai-responses');
  assert.throws(() => assertModelUpstream({ provider: 'anthropic', api: 'openai-responses', model: 'm' }), /cannot be driven through api openai-responses/);
  assert.throws(() => assertModelCapabilities({ reasoningEfforts: 'high' }), /reasoningEfforts must be an array of effort levels/);
  assert.throws(() => assertModelCapabilities({ reasoningEfforts: ['turbo'] }), /reasoningEfforts: unknown level "turbo" — allowed: none, minimal, low, medium, high, xhigh, max/);
  assert.equal(assertModelCapabilities({ reasoningEfforts: [] }), undefined);
  assert.equal(assertModelCapabilities({ reasoningEfforts: null }), undefined);
  assert.throws(() => assertModelCapabilities({ colour: true }), /allowed: toolCalls, vision, reasoning, maxPromptTokens, maxOutputTokens, reasoningEfforts/);
  assert.deepEqual(bridgeExcludedTools({ api: 'openai-responses' }), ['WebSearch', 'WebFetch']);
  assert.equal(isTranslatedApi('openai-responses'), true);
  assert.equal(isTranslatedApi('openai-chat'), true);
  assert.equal(isTranslatedApi('anthropic'), false);
  assert.equal(isTranslatedApi(undefined), false);
  await withSandbox(async () => {
    await addGlobalModel({ id: 'copilot-gpt-6-astra', upstream: { provider: 'copilot', api: 'openai-responses', model: 'gpt-6-astra', capabilities: { reasoning: true, reasoningEfforts: ['low', 'high'] } } });
    const stored = (await readRaw()).models.find((m) => m.id === 'copilot-gpt-6-astra');
    assert.deepEqual(stored.upstream, { provider: 'copilot', api: 'openai-responses', model: 'gpt-6-astra', capabilities: { reasoning: true, reasoningEfforts: ['low', 'high'] } });
    assert.deepEqual(listGlobalModels().find((m) => m.id === 'copilot-gpt-6-astra').upstream.capabilities.reasoningEfforts, ['low', 'high']);
  });
});
