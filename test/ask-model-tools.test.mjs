// test/ask-model-tools.test.mjs
// Ask Worca's model + provider tools (docs/models.md "Ask Worca"): the propose_model_change
// validator over injected readers (credentials only as ${VAR}, read-only sources, warnings that say
// what will still stop a model), the edit merge the apply replays, the conditional tool family and
// its dispatch, the apply over injected setters, and the settings setters' dry run against a
// sandboxed HOME — which must never write.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createModelChangeValidator, mergeEditPatch, maskEntry, modelEventPrompt, modelNoticeText, LOCAL_MIN_WINDOW, MODEL_CHANGE_KINDS } from '../src/core/ask/model-proposal.mjs';
import { applyModelChange } from '../src/core/ask/model-deps.mjs';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { labelForTool } from '../src/core/ask/events.mjs';
import { ASK_SYSTEM_RULES } from '../src/core/ask/prompt.mjs';

const LLAMA = { provider: 'openai', api: 'openai-chat', model: 'qwen', baseUrl: 'http://127.0.0.1:8080/v1', capabilities: { maxPromptTokens: 65536, maxOutputTokens: 8192 } };

/** A validator over an in-memory catalog; the dry-run setters echo what a write would store. */
function fixture({ globals = [], plugins = [], policy = [], env = {}, providers = {}, ready = () => ({ ok: true }), refs = () => ({ steps: [], nodes: [], predefinedShadow: false }), copilot = [] } = {}) {
  const calls = [];
  const cfg = (n) => ({ maxConcurrent: 8, ...(n === 'copilot' ? { accountType: 'individual' } : { baseUrl: n === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com' }), ...(providers[n] || {}) });
  const validate = createModelChangeValidator({
    listGlobalModels: () => globals, listPluginModels: () => plugins, policyModels: () => policy,
    predefined: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }],
    addModel: async (m, o) => { calls.push(['add', m, o]); if (globals.some((g) => g.id === m.id)) throw new Error('a model with id already exists'); return { efforts: ['low', 'medium', 'high'], label: m.label || m.id, ...m }; },
    updateModel: async (id, p, o) => {
      calls.push(['update', id, p, o]);
      const cur = globals.find((g) => g.id === id);
      const envNext = { ...(cur.env || {}) };
      for (const [k, v] of Object.entries(p.env || {})) { if (v === null) delete envNext[k]; else envNext[k] = v; }
      const next = { ...cur, ...(p.label !== undefined ? { label: p.label } : {}), env: envNext };
      if (p.upstream === null) delete next.upstream; else if (p.upstream) next.upstream = p.upstream;
      if (!Object.keys(next.env).length) delete next.env;
      return next;
    },
    updateProvider: async (n, p, o) => { calls.push(['provider', n, p, o]); const next = { ...cfg(n) }; for (const [k, v] of Object.entries(p)) { if (v === null || v === '') delete next[k]; else next[k] = v; } return next; },
    providerConfig: cfg, providerReadiness: ready, modelRefs: refs, envHas: (k) => k in env,
    copilotModels: async () => copilot,
  });
  return { validate, calls };
}

test('add_model: a keyless local llama.cpp entry validates through the dry-run setter and carries no warnings', async () => {
  const { validate, calls } = fixture();
  const r = await validate({ kind: 'add_model', model: { id: 'local-qwen', label: 'Local Qwen', upstream: LLAMA }, note: 'the user asked' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.card.type, 'model');
  assert.equal(r.card.kind, 'add_model');
  assert.equal(r.card.summary, 'Add model Local Qwen');
  assert.equal(r.card.note, 'the user asked');
  assert.deepEqual(r.card.warnings, []);
  assert.deepEqual(calls[0][2], { dryRun: true }, 'the setter ran as a dry run');
  const rows = Object.fromEntries(r.card.rows.map((x) => [x.field, x.after]));
  assert.equal(rows.Connection, 'through provider openai');
  assert.equal(rows['Base URL'], 'http://127.0.0.1:8080/v1');
  assert.match(rows.Limits, /maxPromptTokens 65536/);
  assert.deepEqual(r.card.change, { model: { id: 'local-qwen', label: 'Local Qwen', upstream: LLAMA } });
});

test('credentials only as ${VAR}: literal env tokens, upstream keys and auth headers are refused; references pass', async () => {
  const { validate } = fixture({ env: { OPENAI_KEY: 'x' } });
  let r = await validate({ kind: 'add_model', model: { id: 'gw', env: { ANTHROPIC_BASE_URL: 'https://gw.example.com', ANTHROPIC_AUTH_TOKEN: 'sk-live-123' } } });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /ANTHROPIC_AUTH_TOKEN looks like a credential — pass it as a \$\{VAR\} reference/);
  r = await validate({ kind: 'add_model', model: { id: 'gw', env: { ANTHROPIC_BASE_URL: 'https://gw.example.com', ANTHROPIC_AUTH_TOKEN: '${GW_TOKEN}', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192' } } });
  assert.equal(r.ok, true, 'a reference, and a *_TOKENS knob that is no credential');
  assert.match(r.card.warnings.join(' '), /\$\{GW_TOKEN\} is not set in worca's environment/);
  r = await validate({ kind: 'add_model', model: { id: 'oa', upstream: { ...LLAMA, baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-proj-abc' } } });
  assert.match(r.errors[0], /upstream\.apiKey must be a \$\{VAR\} reference/);
  r = await validate({ kind: 'add_model', model: { id: 'oa', upstream: { ...LLAMA, headers: { Authorization: 'Bearer x' } } } });
  assert.match(r.errors[0], /upstream\.headers\.Authorization looks like a credential/);
  r = await validate({ kind: 'add_model', model: { id: 'oa', upstream: { ...LLAMA, baseUrl: 'https://api.openai.com/v1', apiKey: '${OPENAI_KEY}' } } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.card.warnings, [], 'the variable is set');
});

test('warnings: no prompt limit on a translated model, a too-small local window, a provider that is not ready', async () => {
  const { validate } = fixture({ ready: () => ({ ok: false, message: 'provider openai: no API key — open Settings › Providers' }) });
  let r = await validate({ kind: 'add_model', model: { id: 'a', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-5' } } });
  const w = r.card.warnings.join('\n');
  assert.match(w, /no API key — open Settings › Providers — the model shows "needs sign-in"/);
  assert.match(w, /no prompt limit \(capabilities\.maxPromptTokens\)/);
  r = await validate({ kind: 'add_model', model: { id: 'b', upstream: { ...LLAMA, capabilities: { maxPromptTokens: 32768 } } } });
  assert.match(r.card.warnings.join('\n'), new RegExp(`a 32768-token window is too small for pipelines — serve at least ${LOCAL_MIN_WINDOW}`));
});

test('warnings: an openai-responses model without a prompt limit is flagged like a chat one', async () => {
  const { validate } = fixture();
  const r = await validate({ kind: 'add_model', model: { id: 'r', upstream: { provider: 'openai', api: 'openai-responses', model: 'gpt-5-codex' } } });
  assert.ok(r.card, JSON.stringify(r));
  assert.match(r.card.warnings.join('\n'), /no prompt limit \(capabilities\.maxPromptTokens\)/);
});

test('read-only sources and unknown ids are refused with a way forward', async () => {
  const { validate } = fixture({ plugins: [{ id: 'plug-m', plugin: 'acme' }], policy: [{ id: 'team-m', home: 'org/repo' }] });
  assert.match((await validate({ kind: 'edit_model', id: 'plug-m', model: { label: 'x' } })).errors[0], /comes from plugin acme and is read-only/);
  assert.match((await validate({ kind: 'remove_model', id: 'team-m' })).errors[0], /comes from the team policy of org\/repo/);
  assert.match((await validate({ kind: 'add_model', model: { id: 'plug-m' } })).errors[0], /read-only/);
  assert.match((await validate({ kind: 'edit_model', id: 'claude-opus-5-5', model: { label: 'x' } })).errors[0], /built-in model .* propose add_model with the same id/);
  assert.match((await validate({ kind: 'remove_model', id: 'nope' })).errors[0], /unknown model "nope" — list_models/);
  assert.match((await validate({ kind: 'bogus' })).errors[0], /^kind must be one of add_model, edit_model/);
  assert.match((await validate({ kind: 'edit_model' })).errors[0], /needs an id/);
});

test('add_model over a built-in id says it overrides it', async () => {
  const { validate } = fixture();
  const r = await validate({ kind: 'add_model', model: { id: 'claude-opus-5-5', env: { ANTHROPIC_BASE_URL: 'https://gw.example.com' } } });
  assert.equal(r.card.summary, 'Add model claude-opus-5-5 (overrides the built-in Opus 5.5)');
});

test('edit_model: upstream merges into the stored block, the stored key is kept and never shown', async () => {
  const cur = { id: 'oa', label: 'OA', efforts: ['medium'], upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-5', apiKey: 'sk-secret-literal-1234', capabilities: { maxPromptTokens: 100000 } } };
  const { validate, calls } = fixture({ globals: [cur] });
  const r = await validate({ kind: 'edit_model', id: 'oa', model: { upstream: { capabilities: { maxPromptTokens: 128000, maxOutputTokens: 16000 } } } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const sent = calls.find((c) => c[0] === 'update')[2];
  assert.equal(sent.upstream.apiKey, 'sk-secret-literal-1234', 'the setter got the stored key back');
  assert.deepEqual(sent.upstream.capabilities, { maxPromptTokens: 128000, maxOutputTokens: 16000 });
  assert.deepEqual(r.card.rows, [{ field: 'Limits', before: 'maxPromptTokens 100000', after: 'maxPromptTokens 128000 · maxOutputTokens 16000' }]);
  assert.ok(!JSON.stringify(r.card).includes('sk-secret-literal-1234'), 'the card never carries the literal key');
  assert.deepEqual(r.card.change, { id: 'oa', patch: { upstream: { capabilities: { maxPromptTokens: 128000, maxOutputTokens: 16000 } } } }, 'the card stores the patch, not the merged block');
  // A patch that changes nothing is refused.
  assert.match((await validate({ kind: 'edit_model', id: 'oa', model: { label: 'OA' } })).errors[0], /nothing changes/);
  assert.match((await validate({ kind: 'edit_model', id: 'oa', model: {} })).errors[0], /at least one of label/);
});

test('mergeEditPatch: null removes a field or a limit; upstream:null drops the bridge; env passes through for the setter', () => {
  const cur = { upstream: { provider: 'openai', api: 'openai-chat', model: 'm', baseUrl: 'http://x/v1', capabilities: { maxPromptTokens: 1, maxOutputTokens: 2 } } };
  assert.deepEqual(mergeEditPatch(cur, { upstream: { baseUrl: null, capabilities: { maxOutputTokens: null } } }).upstream,
    { provider: 'openai', api: 'openai-chat', model: 'm', capabilities: { maxPromptTokens: 1 } });
  assert.deepEqual(mergeEditPatch(cur, { upstream: null }), { upstream: null });
  assert.deepEqual(mergeEditPatch(cur, { env: { A: null }, label: 'L' }), { env: { A: null }, label: 'L' });
  assert.deepEqual(mergeEditPatch(null, { upstream: { provider: 'openai' } }).upstream, { provider: 'openai' });
});

test('remove_model: the refs it clears and a built-in it restores become warnings', async () => {
  const { validate } = fixture({ globals: [{ id: 'm1', label: 'M1', efforts: [] }], refs: () => ({ steps: [{}], nodes: [{}, {}], predefinedShadow: true }) });
  const r = await validate({ kind: 'remove_model', id: 'M1' });
  assert.equal(r.card.target, 'm1', 'the catalog spelling');
  assert.equal(r.card.summary, 'Remove model M1');
  assert.match(r.card.warnings[0], /^3 workflow nodes use this model — they fall back to the default model$/);
  assert.match(r.card.warnings[1], /restores the built-in/);
  assert.ok(r.card.rows.every((x) => x.after === null && x.before));
});

test('remove_model: a model Settings › Memory runs defragments on is a warning too', async () => {
  const { validate } = fixture({ globals: [{ id: 'm1', label: 'M1', efforts: [] }], refs: () => ({ steps: [], nodes: [], predefinedShadow: false, memoryDefrag: true }) });
  const r = await validate({ kind: 'remove_model', id: 'm1' });
  assert.deepEqual(r.card.warnings, ['Memory defragment runs use this model (Settings › Memory) — they fall back to the default']);
});

test('provider: base URL / key reference / concurrency validate; sign-in fields and literal keys are refused', async () => {
  const { validate } = fixture({ providers: { openai: { apiKey: 'sk-stored-literal-9999' } } });
  let r = await validate({ kind: 'provider', provider: 'openai', set: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: null } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.card.summary, 'Change the OpenAI-compatible provider');
  const rows = Object.fromEntries(r.card.rows.map((x) => [x.field, x]));
  assert.equal(rows['Base URL'].after, 'http://127.0.0.1:8080/v1');
  assert.equal(rows['API key'].after, null);
  assert.ok(rows['API key'].before.startsWith('••'), 'the stored key is masked');
  assert.deepEqual(r.card.warnings, [], 'a local OpenAI-compatible endpoint needs no key');
  r = await validate({ kind: 'provider', provider: 'anthropic', set: { apiKey: null } });
  assert.match(r.errors[0], /nothing changes/);
  r = await validate({ kind: 'provider', provider: 'openai', set: { apiKey: 'sk-live' } });
  assert.match(r.errors[0], /openai apiKey must be a \$\{VAR\} reference/);
  r = await validate({ kind: 'provider', provider: 'copilot', set: { githubToken: 'gho_x' } });
  assert.match(r.errors[0], /githubToken is not settable here — the Copilot sign-in/);
  r = await validate({ kind: 'provider', provider: 'copilot', set: { acknowledgedTerms: new Date().toISOString() } });
  assert.match(r.errors[0], /acknowledgedTerms is not settable here/);
  r = await validate({ kind: 'provider', provider: 'openai', set: { baseUrl: 'https://api.openai.com/v1' } });
  assert.match(r.errors[0], /nothing changes/);
  r = await validate({ kind: 'provider', provider: 'openai' });
  assert.match(r.errors[0], /provider needs set/);
  r = await validate({ kind: 'provider', provider: 'anthropic', set: { apiKey: '${ANTH_KEY}' } });
  assert.match(r.card.warnings.join(' '), /\$\{ANTH_KEY\} is not set/);
});

test('import_copilot: only ids the account offers; the rows say added or refreshed', async () => {
  const { validate } = fixture({ copilot: [{ id: 'gpt-5', name: 'GPT-5', inCatalog: false }, { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', inCatalog: true }] });
  let r = await validate({ kind: 'import_copilot', ids: ['gpt-5', 'claude-sonnet-4.5', 'gpt-5'] });
  assert.equal(r.ok, true);
  assert.equal(r.card.summary, 'Import 2 Copilot models');
  assert.deepEqual(r.card.rows.map((x) => x.after), ['added as copilot-gpt-5', 'API and capabilities refreshed']);
  assert.deepEqual(r.card.change, { ids: ['gpt-5', 'claude-sonnet-4.5'] });
  r = await validate({ kind: 'import_copilot', ids: ['o9'] });
  assert.match(r.errors[0], /not offered to this Copilot account: o9/);
  r = await validate({ kind: 'import_copilot', ids: [] });
  assert.match(r.errors[0], /import_copilot needs ids/);
});

test('import_endpoint: the card quotes the window the server serves and refuses a row it would not import', async () => {
  const endpoint = {
    server: 'ollama', serverLabel: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1',
    warnings: ['Ollama serves a 4096-token window by default'],
    models: [
      { id: 'qwen3-coder:30b', name: 'qwen3-coder:30b', catalogId: 'ollama-qwen3-coder-30b', servedContext: 65536, trainedContext: 262144, importable: true, inCatalog: false },
      { id: 'small:1b', name: 'small:1b', catalogId: 'ollama-small-1b', servedContext: 8192, trainedContext: 32768, importable: true, inCatalog: true },
      { id: 'unknown:7b', name: 'unknown:7b', catalogId: 'ollama-unknown-7b', servedContext: null, trainedContext: 131072, importable: true, inCatalog: false },
      { id: 'nomic:latest', name: 'nomic:latest', catalogId: 'ollama-nomic-latest', importable: false, blocked: 'an embedding model — not a chat model' },
    ],
  };
  assert.ok(MODEL_CHANGE_KINDS.includes('import_endpoint'));
  const seen = [];
  const { validate } = fixture();
  const withEp = createModelChangeValidator({
    listGlobalModels: () => [], listPluginModels: () => [], policyModels: () => [], predefined: [],
    addModel: async (m) => m, updateModel: async () => ({}), updateProvider: async () => ({}),
    providerConfig: () => ({ baseUrl: 'https://api.openai.com/v1' }), providerReadiness: () => ({ ok: true }),
    modelRefs: () => ({ steps: [], nodes: [] }), envHas: () => true,
    endpointModels: async (baseUrl) => { seen.push(baseUrl); return endpoint; },
  });
  assert.match((await validate({ kind: 'import_endpoint', ids: ['x'] })).errors[0], /endpoint discovery is unavailable/);

  const r = await withEp({ kind: 'import_endpoint', baseUrl: 'http://127.0.0.1:11434/v1', ids: ['qwen3-coder:30b', 'small:1b', 'unknown:7b'], note: 'the local box' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(seen, ['http://127.0.0.1:11434/v1']);
  assert.equal(r.card.kind, 'import_endpoint');
  assert.equal(r.card.summary, 'Import 3 models from Ollama');
  assert.equal(r.card.target, 'http://127.0.0.1:11434/v1');
  assert.deepEqual(r.card.rows, [
    { field: 'qwen3-coder:30b', before: null, after: 'added as ollama-qwen3-coder-30b · 65536 tokens' },
    { field: 'small:1b', before: 'in catalog', after: 'refreshed · 8192 tokens' },
    { field: 'unknown:7b', before: null, after: 'added as ollama-unknown-7b · window not reported (supports 131072)' },
  ]);
  const w = r.card.warnings.join('\n');
  assert.match(w, /^Ollama serves a 4096-token window by default$/m, 'the server\'s own warning rides along');
  assert.match(w, /small:1b: 8192 tokens is below the 65536 a pipeline needs/);
  assert.match(w, /unknown:7b: the server does not report the window it serves/);
  assert.deepEqual(r.card.change, { ids: ['qwen3-coder:30b', 'small:1b', 'unknown:7b'], baseUrl: 'http://127.0.0.1:11434/v1' });

  assert.match((await withEp({ kind: 'import_endpoint', ids: ['nomic:latest'] })).errors[0], /^nomic:latest: an embedding model/);
  assert.match((await withEp({ kind: 'import_endpoint', ids: ['ghost'] })).errors[0], /Ollama at http:\/\/127\.0\.0\.1:11434\/v1 does not serve: ghost/);
  assert.match((await withEp({ kind: 'import_endpoint', ids: [] })).errors[0], /import_endpoint needs ids/);
  // A card made without a baseUrl applies against the provider's own.
  const dflt = await withEp({ kind: 'import_endpoint', ids: ['qwen3-coder:30b'] });
  assert.deepEqual(dflt.card.change, { ids: ['qwen3-coder:30b'] });
});

test('maskEntry masks credentials, keeps routing readable and ${VAR} references readable', () => {
  const m = maskEntry({ id: 'x', env: {
    ANTHROPIC_AUTH_TOKEN: 'literal-secret-value', OPENAI_API_KEY: '${REF}', ANTHROPIC_BASE_URL: 'https://gw.example.com',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '8192', PROXY: 'https://u:p@proxy.example.com', HOOK: 'https://x.example.com/v1?api_key=abc',
  }, upstream: { provider: 'openai', apiKey: 'sk-abcdefgh1234' } });
  assert.ok(m.env.ANTHROPIC_AUTH_TOKEN.startsWith('••'));
  assert.equal(m.env.OPENAI_API_KEY, '${REF}');
  assert.equal(m.env.ANTHROPIC_BASE_URL, 'https://gw.example.com', 'where it routes is config, not a secret');
  assert.equal(m.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '8192');
  assert.ok(m.env.PROXY.startsWith('••'), 'URL userinfo');
  assert.ok(m.env.HOOK.startsWith('••'), 'a key in a query string');
  assert.ok(m.upstream.apiKey.startsWith('••'));
});

test('event and notice text', () => {
  const card = { summary: 'Add model "Local"' };
  assert.equal(modelEventPrompt({ cardId: 'card_1', state: 'applied', card, result: { detail: 'local is in the catalog' } }),
    '[worca event] model card card_1 applied; "Add model \'Local\'"; local is in the catalog');
  assert.equal(modelEventPrompt({ cardId: 'card_1', state: 'failed', card, result: { error: 'boom' } }), '[worca event] model card card_1 failed: boom; "Add model \'Local\'"');
  assert.equal(modelNoticeText({ state: 'declined', card }), 'Declined — Add model "Local"');
});

test('tools: the family is listed only with a models bundle, last, and dispatches to it', async () => {
  const base = { limits: { scriptSourceDefaultBytes: 1, scriptSourceMaxBytes: 2, scriptTestDefaultTimeoutSec: 1, scriptTestMaxTimeoutSec: 2 }, redact: (s) => s };
  const none = createAskTools(base).list().map((t) => t.name);
  assert.ok(!none.includes('list_models'), 'no bundle, no tools');
  const seen = [];
  const tools = createAskTools({ ...base, models: {
    list: async () => ({ models: [{ id: 'm' }] }),
    providers: async () => ({ openai: { keySet: false } }),
    test: async (n) => { seen.push(n); return { ok: true }; },
    copilotModels: async () => { throw new Error('not signed in to GitHub Copilot'); },
    endpointModels: async (baseUrl) => ({ server: 'ollama', baseUrl: baseUrl || 'http://127.0.0.1:11434/v1', models: [] }),
    validateChange: async (i) => ({ ok: false, errors: [`got ${i.kind}`] }),
  } });
  const names = tools.list().map((t) => t.name);
  assert.deepEqual(names.slice(-6), ['list_models', 'get_providers', 'test_provider', 'list_copilot_models', 'list_endpoint_models', 'propose_model_change']);
  assert.deepEqual(names.slice(0, -6), none, 'every other tool is unchanged');
  assert.deepEqual(await tools.call('list_models', {}), { models: [{ id: 'm' }] });
  assert.deepEqual(await tools.call('get_providers', {}), { openai: { keySet: false } });
  assert.deepEqual(await tools.call('test_provider', { provider: 'openai' }), { ok: true });
  assert.deepEqual(seen, ['openai']);
  await assert.rejects(() => tools.call('test_provider', { provider: 'x' }), /provider must be copilot, openai or anthropic/);
  await assert.rejects(() => tools.call('list_copilot_models', {}), /list_copilot_models: not signed in to GitHub Copilot/);
  assert.deepEqual(await tools.call('propose_model_change', { kind: 'provider' }), { ok: false, errors: ['got provider'] });
  assert.deepEqual(await tools.call('list_endpoint_models', { baseUrl: 'http://127.0.0.1:8080/v1' }), { server: 'ollama', baseUrl: 'http://127.0.0.1:8080/v1', models: [] });
  const desc = tools.list().find((t) => t.name === 'propose_model_change').description;
  assert.match(desc, /never the value: a literal key is refused/);
});

test('activity labels and the system prompt carry the family', () => {
  assert.equal(labelForTool('mcp__worca__propose_model_change'), 'Proposing a model change');
  assert.equal(labelForTool('mcp__worca__test_provider', { provider: 'openai' }), 'Testing openai');
  for (const t of ['list_models', 'get_providers', 'test_provider', 'list_copilot_models', 'list_endpoint_models', 'propose_model_change']) {
    assert.ok(ASK_SYSTEM_RULES.split('\n').find((l) => l.startsWith('1.')).includes(t), `rule 1 lists ${t}`);
  }
  const r18 = ASK_SYSTEM_RULES.split('\n').find((l) => l.startsWith('18.'));
  assert.match(r18, /upstream\.baseUrl and upstream\.apiKey win over the provider's/);
  assert.match(r18, /at least 64k/);
  assert.match(r18, /\[worca event\] model card <id> applied/);
});

// The tools and the rules NAME the wire protocols; a name the validator does not know sends the
// model into a refusal it can only recover from by guessing (upstream.api "anthropic-messages"
// was exactly that). Pin both to UPSTREAM_APIS.
test('the api names in the tool descriptions and rule 18 are the ones the validator accepts', async () => {
  const { UPSTREAM_APIS } = await import('../src/core/model-env.mjs');
  const tools = createAskTools({ limits: {}, redact: (s) => s, models: { list: async () => ({}), providers: async () => ({}), test: async () => ({}), copilotModels: async () => [], validateChange: async () => ({}) } });
  const text = [...tools.list().filter((t) => t.name === 'list_models' || t.name === 'propose_model_change').map((t) => t.description),
    ASK_SYSTEM_RULES.split('\n').find((l) => l.startsWith('18.'))].join('\n');
  for (const api of UPSTREAM_APIS) assert.ok(new RegExp(`(^|[^-\\w])${api}([^-\\w]|$)`).test(text), `names the api "${api}"`);
  for (const wrong of ['anthropic-messages', 'anthropic_messages', 'openai_chat', 'messages']) {
    assert.ok(!text.includes(wrong), `never names a protocol "${wrong}" the validator would refuse`);
  }
});

test('applyModelChange replays each kind through the setters and re-merges an edit onto the entry as it is now', async () => {
  const log = [];
  const io = {
    addModel: async (m) => { log.push(['add', m]); return { id: m.id }; },
    listGlobalModels: () => [{ id: 'oa', upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-5', apiKey: 'sk-now' } }],
    updateModel: async (id, p) => { log.push(['update', id, p]); return {}; },
    removeModel: async (id) => { log.push(['remove', id]); return { clearedSteps: 1, clearedNodes: 1 }; },
    patchProvider: async (n, s) => { log.push(['provider', n, s]); },
    importCopilot: async (ids) => { log.push(['import', ids]); return { created: ['copilot-gpt-5'], updated: [], skipped: ['x'] }; },
    importEndpoint: async (ids, o) => { log.push(['import-endpoint', ids, o]); return { created: ['ollama-qwen3-coder-30b'], updated: [], skipped: [{ id: 'nomic', why: 'an embedding model' }], serverLabel: 'Ollama' }; },
  };
  assert.deepEqual(await applyModelChange({ kind: 'add_model', change: { model: { id: 'n' } } }, io), { ok: true, detail: 'n is in the catalog' });
  assert.deepEqual(await applyModelChange({ kind: 'edit_model', change: { id: 'OA', patch: { upstream: { model: 'gpt-5.1' } } } }, io), { ok: true, detail: 'oa updated' });
  assert.equal(log[1][2].upstream.apiKey, 'sk-now', 'the key as stored at apply time');
  assert.equal(log[1][2].upstream.model, 'gpt-5.1');
  assert.deepEqual(await applyModelChange({ kind: 'remove_model', change: { id: 'oa' } }, io), { ok: true, detail: 'oa removed · 2 workflow selections cleared' });
  assert.deepEqual(await applyModelChange({ kind: 'remove_model', change: { id: 'oa' } }, { ...io, removeModel: async () => ({ clearedSteps: 0, clearedNodes: 0, clearedMemoryDefrag: true }) }),
    { ok: true, detail: 'oa removed · Settings › Memory defragment model cleared' }, 'the Settings › Memory ref it cleared is named too');
  assert.deepEqual(await applyModelChange({ kind: 'provider', change: { provider: 'openai', set: { baseUrl: 'http://x/v1' } } }, io), { ok: true, detail: 'openai provider saved' });
  assert.deepEqual(await applyModelChange({ kind: 'import_copilot', change: { ids: ['gpt-5', 'x'] } }, io), { ok: true, detail: 'added copilot-gpt-5 · skipped x' });
  assert.deepEqual(await applyModelChange({ kind: 'import_endpoint', change: { ids: ['qwen3-coder:30b'], baseUrl: 'http://127.0.0.1:11434/v1' } }, io),
    { ok: true, detail: 'added ollama-qwen3-coder-30b · skipped nomic (an embedding model) — from Ollama' });
  assert.deepEqual(log.at(-1)[2], { baseUrl: 'http://127.0.0.1:11434/v1' }, 'the card\'s endpoint, not the provider default');
  await assert.rejects(() => applyModelChange({ kind: 'edit_model', change: { id: 'gone', patch: {} } }, io), /no longer in the catalog/);
  await assert.rejects(() => applyModelChange({ kind: 'nope' }, io), /unknown model change kind/);
});

// ── the setters' dry run, against a sandboxed HOME ───────────────────────────
const home = mkdtempSync(join(tmpdir(), 'worca-cc-askmodel-home-'));
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prev.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(home, { recursive: true, force: true });
});

test('settings setters: dryRun validates exactly as a write and returns the would-be entry without writing', async () => {
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  const file = join(home, '.worca-cc', 'settings.json');
  const start = { models: [{ id: 'keep', upstream: { provider: 'openai', api: 'openai-chat', model: 'm', apiKey: 'sk-literal-key-0000' } }] };
  writeFileSync(file, JSON.stringify(start));
  const { addGlobalModel, updateGlobalModel, updateProvider } = await import('../src/core/settings.mjs');
  const added = await addGlobalModel({ id: 'local', upstream: LLAMA }, { dryRun: true });
  assert.equal(added.id, 'local');
  assert.deepEqual(added.upstream, LLAMA);
  await assert.rejects(() => addGlobalModel({ id: 'keep' }, { dryRun: true }), /already exists/);
  await assert.rejects(() => addGlobalModel({ id: 'bad', upstream: { provider: 'openai', api: 'nope', model: 'x' } }, { dryRun: true }), /upstream\.api must be one of/);
  const edited = await updateGlobalModel('keep', { label: 'Kept' }, { dryRun: true });
  assert.equal(edited.label, 'Kept');
  assert.equal(edited.upstream.apiKey, 'sk-literal-key-0000');
  const prov = await updateProvider('openai', { baseUrl: 'http://127.0.0.1:8080/v1/' }, { dryRun: true });
  assert.equal(prov.baseUrl, 'http://127.0.0.1:8080/v1');
  await assert.rejects(() => updateProvider('openai', { maxConcurrent: 999 }, { dryRun: true }), /maxConcurrent must be an integer/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), start, 'nothing was written');
});

test('mergeEditPatch: re-pointing an entry to another provider or upstream model drops the old model\'s effort levels unless the patch restates them', () => {
  const cur = { id: 'copilot-gpt-5.5', upstream: { provider: 'copilot', api: 'openai-responses', model: 'gpt-5.5', capabilities: { reasoning: true, reasoningEfforts: ['low', 'medium', 'high'] } } };
  assert.deepEqual(mergeEditPatch(cur, { upstream: { provider: 'openai', model: 'o3' } }).upstream.capabilities, { reasoning: true });
  assert.deepEqual(mergeEditPatch(cur, { upstream: { model: 'gpt-5.4', capabilities: { reasoningEfforts: ['low', 'high'] } } }).upstream.capabilities, { reasoning: true, reasoningEfforts: ['low', 'high'] });
  assert.deepEqual(mergeEditPatch(cur, { upstream: { capabilities: { maxPromptTokens: 1000 } } }).upstream.capabilities, { reasoning: true, reasoningEfforts: ['low', 'medium', 'high'], maxPromptTokens: 1000 });
  // The same id restated with padding is not a re-point (the store trims it).
  assert.deepEqual(mergeEditPatch(cur, { upstream: { model: ' gpt-5.5 ' } }).upstream.capabilities, { reasoning: true, reasoningEfforts: ['low', 'medium', 'high'] });
  assert.deepEqual(mergeEditPatch({ upstream: { provider: 'copilot', api: 'openai-chat', model: 'm', capabilities: { reasoningEfforts: ['low'] } } }, { upstream: { model: 'n' } }).upstream, { provider: 'copilot', api: 'openai-chat', model: 'n' });
});
