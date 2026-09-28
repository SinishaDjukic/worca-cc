// test/cli-models-openrouter.test.mjs
// `worca models … openrouter` (docs/models.md "OpenRouter"): `set openrouter` is the openai
// provider pointed at OpenRouter, `import openrouter` lists its catalog with the price and can
// narrow it (--search, --free, --tools, --min-context), `test openrouter` reports the key's limits
// and never prints the key, and a model imported under the old `local-` id is refreshed in place
// rather than duplicated. OpenRouter is recognised by host, so its answers come from a fetch stub
// installed on globalThis. Sandboxes HOME (settings.json) + WORCA_HOME (DB).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { cmdModels } from '../src/cli/models.mjs';
import { addGlobalModel, listGlobalModels, providerConfig } from '../src/core/settings.mjs';
import { testProviderConnection } from '../src/core/bridge/provider-ops.mjs';
import { readFileSync } from 'node:fs';

const OR_MODELS = JSON.parse(readFileSync(new URL('./fixtures/bridge/openrouter-models.json', import.meta.url), 'utf8'));

const OR = 'https://openrouter.ai/api/v1';
const SECRET = 'sk-or-v1-secret-value-never-printed';
let homeDir, worcaHomeDir;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, OPENROUTER_KEY: process.env.OPENROUTER_KEY };
const realFetch = globalThis.fetch;
const calls = [];
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-orcli-home-'));
  worcaHomeDir = await mkdtemp(join(tmpdir(), 'worca-cc-orcli-whome-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = worcaHomeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.OPENROUTER_KEY = SECRET;
  _resetForTests();
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, auth: init.headers && (init.headers.authorization || init.headers.Authorization) });
    if (u === `${OR}/models`) return json(OR_MODELS);
    if (u === `${OR}/key`) {
      const auth = init.headers && init.headers.authorization;
      return auth === `Bearer ${SECRET}`
        ? json({ data: { label: 'sk-or-v1-sec...ted', limit: 10, limit_remaining: 10, usage: 0, is_free_tier: false, free_model_daily_requests: { used: 0, limit: 1000, remaining: 1000 } } })
        : json({ error: { message: 'User not found', code: 401 } }, 401);
    }
    return new Response('not found', { status: 404 });
  };
});
after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  _resetForTests();
  await rm(homeDir, { recursive: true, force: true });
  await rm(worcaHomeDir, { recursive: true, force: true });
});

const run = async (argv) => {
  const out = [];
  const code = await cmdModels(argv, { out: (l) => out.push(l), c: (_, s) => s, fail: (m) => { throw new Error(m); } });
  return { code, text: out.join('\n') };
};

test('set openrouter: the openai provider, pointed at OpenRouter, key kept as a ${VAR} reference', async () => {
  const { code, text } = await run(['set', 'openrouter', 'apiKey=${OPENROUTER_KEY}']);
  assert.equal(code, 0);
  assert.equal(providerConfig('openai').baseUrl, OR);
  assert.match(text, /openai\s+key set \(\$\{OPENROUTER_KEY\}\)\s+baseUrl=https:\/\/openrouter\.ai\/api\/v1/);
  assert.ok(!text.includes(SECRET));
  // An explicit baseUrl still wins (a regional or proxied OpenRouter).
  await run(['set', 'openrouter', `baseUrl=${OR}`]);
  assert.equal(providerConfig('openai').baseUrl, OR);
});

test('test openrouter: reachable, the key\'s limits on one line, the key never printed', async () => {
  const { code, text } = await run(['test', 'openrouter']);
  assert.equal(code, 0);
  assert.match(text, /✓ openrouter reachable — 5 models listed/);
  assert.match(text, /credit \$10\.00 of \$10\.00 left · free-model requests today 1000 \/ 1000/);
  assert.ok(!text.includes(SECRET) && !text.includes('sk-or'), 'neither the key nor its label');
  // A key OpenRouter rejects fails the test even though the model list (keyless) answered.
  const bad = await testProviderConnection('openai', { baseUrl: OR, apiKey: 'sk-or-wrong' });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /authentication failed/);
});

test('import openrouter: lists with prices, and --search / --free / --tools / --min-context narrow it', async () => {
  const all = await run(['import', 'openrouter']);
  assert.equal(all.code, 0);
  assert.match(all.text, /^OpenRouter at https:\/\/openrouter\.ai\/api\/v1/m);
  assert.match(all.text, /qwen\/qwen3\.8-27b:free\s+262k\s+tools.*free/);
  assert.match(all.text, /anthropic\/claude-sonnet-4\.5\s+1000k\s+tools.*\$3 \/ \$15 per M/);
  assert.match(all.text, /! :free models run on a pool OpenRouter shares/);

  const free = await run(['import', 'openrouter', '--free']);
  assert.match(free.text, /qwen3\.8-27b:free/);
  assert.doesNotMatch(free.text, /claude-sonnet/);
  const search = await run(['import', 'openrouter', '--search', 'sonnet']);
  assert.match(search.text, /claude-sonnet-4\.5/);
  assert.doesNotMatch(search.text, /qwen/);
  const tools = await run(['import', 'openrouter', '--tools', '--min-context', '500k']);
  assert.match(tools.text, /claude-sonnet-4\.5/);
  assert.match(tools.text, /openrouter\/auto/);
  assert.doesNotMatch(tools.text, /qwen|lunaris/);
  await assert.rejects(() => run(['import', 'openrouter', '--min-context', 'lots']), /--min-context/);
});

test('import openrouter --pick: the entry carries window, price and capabilities; a legacy local- entry is refreshed in place', async () => {
  // What the old importer wrote for the same model: a `local-` id, priced free, no window.
  await addGlobalModel({ id: 'local-claude-sonnet-4-5', label: 'My Sonnet via OR', efforts: ['medium'], upstream: { provider: 'openai', api: 'openai-chat', model: 'anthropic/claude-sonnet-4.5' }, cost: { free: true } });
  const r = await run(['import', 'openrouter', '--pick', 'qwen/qwen3.8-27b:free,anthropic/claude-sonnet-4.5', '--yes']);
  assert.equal(r.code, 0);
  assert.match(r.text, /\+ openrouter-qwen-qwen3-8-27b-free/);
  assert.match(r.text, /~ local-claude-sonnet-4-5 \(upstream refreshed\)/);
  const by = Object.fromEntries(listGlobalModels().map((m) => [m.id, m]));
  assert.equal(by['openrouter-anthropic-claude-sonnet-4-5'], undefined, 'no twin under the new id');
  assert.equal(by['local-claude-sonnet-4-5'].label, 'My Sonnet via OR', 'the user\'s label survives');
  assert.equal(by['local-claude-sonnet-4-5'].upstream.capabilities.maxPromptTokens, 1000000);
  const q = by['openrouter-qwen-qwen3-8-27b-free'];
  assert.deepEqual(q.cost, { free: true });
  assert.equal(q.upstream.model, 'qwen/qwen3.8-27b:free');
  assert.equal(q.upstream.capabilities.maxPromptTokens, 262144);
  assert.equal(q.upstream.capabilities.reasoning, true);
  // A second listing marks both as already in the catalog.
  const again = await run(['import', 'openrouter', '--search', 'sonnet']);
  assert.match(again.text, /claude-sonnet-4\.5.*\(in catalog\)/);
});
