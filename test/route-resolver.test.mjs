// test/route-resolver.test.mjs
// The model-credential owner (src/core/exec-env/credentials.mjs resolveModelRoute, plans/core-protection-layer-design.md
// §4.2): how one spawn signs its model calls — relayed, brokered, own or direct — and, in direct mode, that the child
// env holds exactly the one credential the resolver picked.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelRoute, isResolved, buildRelayRoute } from '../src/core/exec-env/relay-route.mjs';
import { credentialNamesOf, engineCredential, brokerRefusalText } from '../src/core/exec-env/credentials.mjs';
import { childEnv } from '../src/core/spawn.mjs';
import { ENGINES, setCatalogForTest } from '../src/shared/engine-switch.mjs';

const OFF = { on: false };
const LINE = (e, k) => `${e} signs in with ${k} from worca's environment; the agent can read it. Use a sandbox or the credential broker to keep it out.`;
afterEach(() => setCatalogForTest(null));

test('local, broker off, keychain claude is own', () => {
  const d = resolveModelRoute({ engine: 'claude', serverEnv: {}, broker: OFF });
  assert.equal(d.kind, 'own'); assert.equal(d.signInMode, 'keychain'); assert.equal(d.warning, null); assert.ok(isResolved(d));
});
test('local OAuth env claude is direct with a warning', () => {
  const d = resolveModelRoute({ engine: 'claude', serverEnv: { CLAUDE_CODE_OAUTH_TOKEN: 't' }, broker: OFF });
  assert.equal(d.kind, 'direct'); assert.equal(d.credential, 'CLAUDE_CODE_OAUTH_TOKEN'); assert.equal(d.warning, LINE('claude', 'CLAUDE_CODE_OAUTH_TOKEN'));
});
test('local claude follows the CLI precedence: API key over OAuth token', () => {
  const d = resolveModelRoute({ engine: 'claude', serverEnv: { CLAUDE_CODE_OAUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'k' }, broker: OFF });
  assert.equal(d.signInMode, 'api-key');
});
test('sandbox claude prefers OAuth', () => {
  const d = resolveModelRoute({ engine: 'claude', remote: true, serverEnv: { CLAUDE_CODE_OAUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'k' }, broker: OFF });
  assert.equal(d.kind, 'relayed');
  const r = buildRelayRoute(d, { serverEnv: { CLAUDE_CODE_OAUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'k' }, label: 'E2B sandbox' });
  assert.equal(r.secrets[0], 't');
  assert.match(r.authHeaders({})['anthropic-beta'], /oauth-2025-04-20/);
});
test('sandbox cursor through a broker lease allows the exact Connect calls and forwards no privacy mode', () => {
  const d = resolveModelRoute({ engine: 'cursor', remote: true, serverEnv: { CURSOR_API_KEY: 'k' }, broker: OFF });
  assert.equal(d.kind, 'relayed');
  const r = buildRelayRoute(d, { lease: { baseUrl: 'http://127.0.0.1:5/p/cursor', token: 'spawn-tok', secrets: ['spawn-tok'] }, label: 'E2B sandbox' });
  const ok = (p) => r.allow.some(([m, x]) => m === 'POST' && x === p);
  assert.ok(ok('/agent.v1.AgentService/RunSSE') && ok('/aiserver.v1.AiService/GetUsableModels'));
  assert.ok(r.allow.every(([, x]) => typeof x === 'string'), 'exact paths, no pattern');
  for (const p of ['/aiserver.v1.DashboardService/GetTeams', '/aiserver.v1.AiService/StreamChat']) assert.equal(ok(p), false, p);
  assert.ok(!r.forwardHeaders.includes('x-ghost-mode'));
});
test('broker on, codex API key slot is brokered', () => {
  const d = resolveModelRoute({ engine: 'codex', serverEnv: {}, broker: { on: true, slots: ['openai'] } });
  assert.equal(d.kind, 'brokered'); assert.equal(d.slot, 'openai'); assert.equal(d.signInMode, 'brokered');
});
test('broker on, codex ChatGPT sign-in is refused', () => {
  const d = resolveModelRoute({ engine: 'codex', serverEnv: {}, broker: { on: true, slots: [] } });
  assert.match(d.refusal, /signs in with its own credentials/);
});
test('sandbox own-sign-in is refused with today\'s text', () => {
  const d = resolveModelRoute({ engine: 'codex', remote: true, serverEnv: {}, broker: OFF });
  assert.equal(d.refusal, engineCredential('codex', {}).problem);
  assert.match(d.refusal, /^Codex in a sandbox needs CODEX_API_KEY or OPENAI_API_KEY/);
});
test('exactly one named key', () => {
  const serverEnv = { PATH: 'p', CODEX_API_KEY: 'a', OPENAI_API_KEY: 'b' };
  const d = resolveModelRoute({ engine: 'codex', serverEnv, broker: OFF });
  assert.equal(d.credential, 'CODEX_API_KEY');
  const { env } = childEnv({ engine: 'codex', signInMode: d.signInMode, base: serverEnv });
  assert.equal(env.CODEX_API_KEY, 'a'); assert.equal(env.OPENAI_API_KEY, undefined);
});
test('every engine: direct keeps exactly the picked credential name of its own', () => {
  for (const e of Object.keys(ENGINES)) {
    const names = credentialNamesOf(e);
    const base = Object.fromEntries([['PATH', 'p'], ...names.map((k) => [k, `v-${k}`])]);
    const d = resolveModelRoute({ engine: e, serverEnv: base, broker: OFF });
    const env = childEnv({ engine: e, signInMode: d.signInMode, base }).env;
    assert.deepEqual(names.filter((k) => k in env), d.credential ? [d.credential] : [], e);
  }
});
test('copilot BYOK wins over the token only with its base URL set', () => {
  const tok = { COPILOT_GITHUB_TOKEN: 'g', COPILOT_PROVIDER_API_KEY: 'p' };
  assert.equal(resolveModelRoute({ engine: 'copilot', serverEnv: tok, broker: OFF }).signInMode, 'token');
  assert.equal(resolveModelRoute({ engine: 'copilot', serverEnv: { ...tok, COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:1' }, broker: OFF }).signInMode, 'provider-key');
});
test('a gateway model entry signs with its own key, never the server\'s', () => {
  const d = resolveModelRoute({ engine: 'claude', serverEnv: { CLAUDE_CODE_OAUTH_TOKEN: 't' }, broker: OFF,
    modelEnv: { ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_AUTH_TOKEN: 'g' } });
  assert.equal(d.signInMode, 'model'); assert.equal(d.credential, 'ANTHROPIC_AUTH_TOKEN');
  const env = childEnv({ engine: 'claude', signInMode: d.signInMode, overlay: { ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_AUTH_TOKEN: 'g' },
    base: { PATH: 'p', CLAUDE_CODE_OAUTH_TOKEN: 't' } }).env;
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});
test('a keyless third-party base never gets the server credential', () => {
  const d = resolveModelRoute({ engine: 'claude', serverEnv: { ANTHROPIC_API_KEY: 'k' }, broker: OFF, modelEnv: { ANTHROPIC_BASE_URL: 'https://gw.example' } });
  assert.equal(d.signInMode, 'model'); assert.equal(d.credential, null);
});
test('codex endpoint model: its own key locally, refused under the broker', () => {
  assert.equal(resolveModelRoute({ engine: 'codex', endpoint: true, serverEnv: { OPENAI_API_KEY: 'b' }, broker: OFF }).signInMode, 'endpoint');
  assert.match(resolveModelRoute({ engine: 'codex', endpoint: true, serverEnv: {}, broker: { on: true, slots: ['openai'] } }).refusal, /own endpoint/);
});
test('copilot routed without a model is refused (needsModel)', () => {
  assert.equal(resolveModelRoute({ engine: 'copilot', remote: true, serverEnv: { COPILOT_GITHUB_TOKEN: 'github_pat_' + 'a'.repeat(30) }, broker: OFF }).refusal,
    'Copilot in a sandbox needs a model; pick one for this step.');
  assert.equal(resolveModelRoute({ engine: 'copilot', serverEnv: {}, broker: { on: true, slots: ['copilot-pat'] } }).refusal,
    'Copilot under the credential broker needs a model; pick one for this step.');
  assert.equal(resolveModelRoute({ engine: 'copilot', serverEnv: {}, broker: OFF }).refusal, null, 'local, its own default');
  assert.equal(resolveModelRoute({ engine: 'copilot', remote: true, serverEnv: {}, broker: OFF, checkModel: false }).refusal,
    engineCredential('copilot', {}).problem, 'checkModel false: the credential problem, not the model');
});
test('broker on, Claude signs with runViaBroker\'s model env; a remote codex takes a lease', () => {
  const d = resolveModelRoute({ engine: 'claude', serverEnv: {}, broker: { on: true, slots: ['anthropic'] },
    modelEnv: { ANTHROPIC_BASE_URL: 'http://broker:8080/p/anthropic', ANTHROPIC_AUTH_TOKEN: 'wbt_x' } });
  assert.equal(d.kind, 'brokered'); assert.equal(d.signInMode, 'brokered'); assert.equal(d.slot, null);
  const r = resolveModelRoute({ engine: 'codex', remote: true, serverEnv: {}, broker: { on: true, slots: ['openai'] } });
  assert.equal(r.kind, 'relayed'); assert.equal(r.slot, 'openai'); assert.equal(r.refusal, null);
  // No slot for the engine: refused, never signed with the server's own key (which this env holds).
  const none = resolveModelRoute({ engine: 'codex', remote: true, serverEnv: { CODEX_API_KEY: 'k' }, broker: { on: true, slots: [] } });
  assert.equal(none.refusal, brokerRefusalText('codex'));
  assert.equal(none.source, null);
});
test('the broker default reads worca\'s env, not the sandbox env', () => {
  const saved = process.env.WORCA_BROKER_URL; delete process.env.WORCA_BROKER_URL;
  try {
    const d = resolveModelRoute({ engine: 'codex', remote: true, serverEnv: { WORCA_BROKER_URL: 'http://b:1', CODEX_API_KEY: 'k' } });
    assert.equal(d.source, 'server', 'a sandbox env never turns the broker on');
  } finally { if (saved !== undefined) process.env.WORCA_BROKER_URL = saved; }
});
test('a decision not from the resolver opens no route', () => {
  assert.throws(() => buildRelayRoute({ kind: 'relayed', engine: 'codex', models: [] }, { label: 'x' }), /only from resolveModelRoute/);
});
test('a refused or non-relayed decision opens no relay route', () => {
  // A refusal the route builders would not repeat (the server can sign; the step has no model).
  const pat = 'github_pat_' + 'a'.repeat(30);
  const refused = resolveModelRoute({ engine: 'copilot', remote: true, serverEnv: { COPILOT_GITHUB_TOKEN: pat }, broker: OFF });
  assert.throws(() => buildRelayRoute(refused, { serverEnv: { COPILOT_GITHUB_TOKEN: pat }, label: 'x' }),
    (e) => e.errorClass === 'config' && e.message === 'Copilot in a sandbox needs a model; pick one for this step.');
  const local = resolveModelRoute({ engine: 'codex', serverEnv: { CODEX_API_KEY: 'k' }, broker: OFF });
  assert.throws(() => buildRelayRoute(local, { label: 'x' }), /a direct spawn has no relay route/);
});
test('copilot\'s own provider is refused by exact name in a sandbox, never by a prefix', () => {
  const pat = 'github_pat_' + 'a'.repeat(30);
  const d = resolveModelRoute({ engine: 'copilot', remote: true, serverEnv: { COPILOT_GITHUB_TOKEN: pat }, model: 'gpt-4.1', broker: OFF });
  assert.throws(() => buildRelayRoute(d, { serverEnv: { COPILOT_GITHUB_TOKEN: pat }, spawnEnv: { COPILOT_PROVIDER_TYPE: 'openai' }, label: 'x' }), /sets COPILOT_PROVIDER_TYPE/);
  // The provider's other credential sources copilot names in its own auth error (test/fixtures/copilot/auth-error.jsonl).
  for (const k of ['COPILOT_PROVIDER_BEARER_TOKEN', 'COPILOT_PROVIDER_API_KEY_COMMAND']) {
    assert.throws(() => buildRelayRoute(d, { serverEnv: { COPILOT_GITHUB_TOKEN: pat }, spawnEnv: { [k]: 'x' }, label: 'x' }), new RegExp(`sets ${k}`));
  }
  assert.doesNotThrow(() => buildRelayRoute(d, { serverEnv: { COPILOT_GITHUB_TOKEN: pat }, spawnEnv: { COPILOT_PROVIDER_NOTE: 'x' }, label: 'x' }), 'a name the catalog does not list');
});

// ── a sign-in the CLI's own settings choose (Gemini CLI, Qwen Code: security.auth.selectedType) ─────────────────

test('a configured mode wins over the catalog order: its credential only, set or not', () => {
  const serverEnv = { PATH: 'p', GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'v', GOOGLE_GENAI_USE_VERTEXAI: 'true' };
  assert.equal(resolveModelRoute({ engine: 'gemini', serverEnv, broker: OFF }).signInMode, 'api-key', 'no setting: the catalog order');
  const vertex = resolveModelRoute({ engine: 'gemini', serverEnv, broker: OFF, configured: 'vertex-key' });
  assert.deepEqual([vertex.kind, vertex.signInMode, vertex.credential], ['direct', 'vertex-key', 'GOOGLE_API_KEY']);
  const login = resolveModelRoute({ engine: 'gemini', serverEnv, broker: OFF, configured: 'google-login' });
  assert.deepEqual([login.kind, login.signInMode, login.credential], ['own', 'google-login', null], 'its own login: no key of worca\'s');
  const { env } = childEnv({ engine: 'gemini', signInMode: login.signInMode, base: serverEnv });
  assert.deepEqual(credentialNamesOf('gemini').filter((k) => k in env), []);
  // A chosen mode whose credential is not in worca's env (it is in the CLI's own files): own, keeping none.
  const unset = resolveModelRoute({ engine: 'qwen', serverEnv: { OPENAI_API_KEY: 'o' }, broker: OFF, configured: 'anthropic' });
  assert.deepEqual([unset.kind, unset.signInMode, unset.credential], ['own', 'anthropic', null]);
  // A setting the catalog does not know keeps no credential.
  const none = resolveModelRoute({ engine: 'qwen', serverEnv: { OPENAI_API_KEY: 'o' }, broker: OFF, configured: 'none' });
  assert.deepEqual([none.kind, none.signInMode, none.credential], ['own', 'none', null]);
  // The broker refuses an own sign-in, configured or not.
  assert.match(resolveModelRoute({ engine: 'gemini', serverEnv, broker: { on: true, slots: [] }, configured: 'api-key' }).refusal, /signs in with its own credentials/);
});

test('who serves the calls of an engine without a relay: its mode\'s provider, else the entry\'s', () => {
  assert.equal(resolveModelRoute({ engine: 'gemini', serverEnv: { GEMINI_API_KEY: 'g' }, broker: OFF }).provider, 'google');
  assert.equal(resolveModelRoute({ engine: 'gemini', serverEnv: {}, broker: OFF }).provider, 'google');
  assert.equal(resolveModelRoute({ engine: 'qwen', serverEnv: {}, broker: OFF, configured: 'anthropic' }).provider, 'anthropic');
  assert.equal(resolveModelRoute({ engine: 'qwen', serverEnv: {}, broker: OFF, configured: 'qwen-oauth' }).provider, 'qwen');
  assert.equal(resolveModelRoute({ engine: 'codex', serverEnv: { OPENAI_API_KEY: 'k' }, broker: OFF }).provider, 'openai', 'a relay engine: its upstream');
});

test('an engine whose model id names its provider (Goose): that provider\'s one key, set or not; another provider keeps none', () => {
  const serverEnv = { PATH: 'p', OPENAI_API_KEY: 'o', GOOGLE_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' };
  const google = resolveModelRoute({ engine: 'goose', serverEnv, broker: OFF, model: 'google/gemini-2.5-flash' });
  assert.deepEqual([google.kind, google.signInMode, google.credential, google.provider], ['direct', 'google', 'GOOGLE_API_KEY', 'google']);
  const { env } = childEnv({ engine: 'goose', signInMode: google.signInMode, base: serverEnv });
  assert.deepEqual(credentialNamesOf('goose').filter((k) => k in env), ['GOOGLE_API_KEY']);
  // A provider worca holds no key for (goose's own config signs it in): no key of worca's, the provider still named.
  const ollama = resolveModelRoute({ engine: 'goose', serverEnv, broker: OFF, model: 'ollama/llama3' });
  assert.deepEqual([ollama.kind, ollama.signInMode, ollama.credential, ollama.provider], ['own', 'ollama', null, 'ollama']);
  assert.deepEqual(credentialNamesOf('goose').filter((k) => k in childEnv({ engine: 'goose', signInMode: ollama.signInMode, base: serverEnv }).env), []);
  // No model: the CLI's own provider setting (the adapter passes it as `configured`), else the catalog order.
  assert.equal(resolveModelRoute({ engine: 'goose', serverEnv, broker: OFF, configured: 'anthropic' }).credential, 'ANTHROPIC_API_KEY');
  assert.equal(resolveModelRoute({ engine: 'goose', serverEnv, broker: OFF }).credential, 'OPENAI_API_KEY');
  // The step's model wins over the CLI's setting (goose runs --provider).
  assert.equal(resolveModelRoute({ engine: 'goose', serverEnv, broker: OFF, model: 'google/x', configured: 'anthropic' }).credential, 'GOOGLE_API_KEY');
});

// ── Gemini CLI, Qwen Code, Goose and OpenCode: a route per sign-in mode (R11) ──
const ALL_SLOTS = { on: true, slots: ['anthropic', 'openai', 'openrouter', 'google', 'copilot-pat', 'cursor'] };

test('a per-mode engine in a sandbox: the relayable mode its step resolves to, signed with that mode\'s server key', () => {
  const gemini = resolveModelRoute({ engine: 'gemini', remote: true, serverEnv: { GEMINI_API_KEY: 'g' }, broker: OFF });
  assert.deepEqual([gemini.kind, gemini.signInMode, gemini.relayMode, gemini.source, gemini.provider, gemini.refusal], ['relayed', 'relayed', 'api-key', 'server', 'google', null]);
  // The model's provider (Goose, OpenCode) picks the mode, whatever else is set.
  const goose = resolveModelRoute({ engine: 'goose', remote: true, serverEnv: { OPENAI_API_KEY: 'o', OPENROUTER_API_KEY: 'r' }, broker: OFF, model: 'openrouter/x' });
  assert.deepEqual([goose.relayMode, goose.provider], ['openrouter', 'openrouter']);
  // Qwen Code's OpenAI-compatible mode needs its base URL in the server env; its model is the step's.
  const qwen = resolveModelRoute({ engine: 'qwen', remote: true, serverEnv: { OPENAI_API_KEY: 'o', OPENAI_BASE_URL: 'https://dashscope.example/v1' }, broker: OFF, model: 'qwen3' });
  assert.deepEqual([qwen.relayMode, qwen.refusal], ['openai', null]);
  assert.match(resolveModelRoute({ engine: 'qwen', remote: true, serverEnv: { OPENAI_API_KEY: 'o' }, broker: OFF, model: 'qwen3' }).refusal,
    /^Qwen Code in a sandbox needs the key of one of its sign-ins/);
  // A step with no model on an engine that needs one there (its model names the provider, or Qwen's sign-in needs it).
  for (const engine of ['goose', 'opencode', 'qwen']) {
    assert.equal(resolveModelRoute({ engine, remote: true, serverEnv: { OPENAI_API_KEY: 'o' }, broker: OFF }).refusal, `${ENGINES[engine].label} in a sandbox needs a model; pick one for this step.`);
  }
});

test('a sign-in that needs a token made or refreshed on this machine, or a provider the relay cannot carry, is refused in a sandbox', () => {
  const at = (o) => resolveModelRoute({ remote: true, broker: OFF, ...o }).refusal;
  assert.match(at({ engine: 'gemini', serverEnv: { GEMINI_API_KEY: 'g' }, configured: 'google-login' }),
    /^Gemini CLI's google-login sign-in cannot run in a sandbox: it would need a sign-in that stays on this machine\. In a sandbox worca signs Gemini CLI's sign-ins api-key, vertex-key\./);
  assert.match(at({ engine: 'gemini', serverEnv: { GOOGLE_CLOUD_ACCESS_TOKEN: 't' }, configured: 'access-token' }), /access-token sign-in cannot run in a sandbox: it would need a credential worca cannot sign with there/);
  assert.match(at({ engine: 'qwen', serverEnv: {}, configured: 'qwen-oauth', model: 'q' }), /^Qwen Code's qwen-oauth sign-in cannot run in a sandbox/);
  assert.match(at({ engine: 'goose', serverEnv: { AWS_ACCESS_KEY_ID: 'a' }, model: 'aws_bedrock/claude' }), /^Goose's aws_bedrock provider cannot run in a sandbox.*providers openai, anthropic, google, openrouter, azure_openai, databricks/);
  assert.match(at({ engine: 'opencode', serverEnv: {}, model: 'github-copilot/gpt-5' }), /^OpenCode's github-copilot provider cannot run in a sandbox/);
  // A provider it does relay, without its key in the server env: named, never a key of another provider.
  assert.equal(at({ engine: 'opencode', serverEnv: { OPENAI_API_KEY: 'o' }, model: 'anthropic/x' }),
    "OpenCode's anthropic provider in a sandbox needs ANTHROPIC_API_KEY in the worca server's environment: worca signs its calls there (a key the CLI stores itself stays on this machine). Set it, or pick Local.");
});

test('under the broker a per-mode engine takes the slot of its mode; its own login and a mode with no slot are refused (decision 5)', () => {
  const local = resolveModelRoute({ engine: 'opencode', serverEnv: {}, broker: ALL_SLOTS, model: 'google/gemini-2.5-flash' });
  assert.deepEqual([local.kind, local.signInMode, local.slot, local.relayMode, local.provider], ['brokered', 'brokered', 'google', 'google', 'google']);
  const sandbox = resolveModelRoute({ engine: 'goose', remote: true, serverEnv: {}, broker: ALL_SLOTS, model: 'anthropic/x' });
  assert.deepEqual([sandbox.kind, sandbox.source, sandbox.slot, sandbox.relayMode], ['relayed', 'broker', 'anthropic', 'anthropic']);
  // Gemini CLI: its API key in the google slot; its Google login stays refused.
  assert.equal(resolveModelRoute({ engine: 'gemini', serverEnv: {}, broker: ALL_SLOTS }).slot, 'google');
  assert.match(resolveModelRoute({ engine: 'gemini', serverEnv: {}, broker: ALL_SLOTS, configured: 'google-login' }).refusal,
    /^Gemini CLI's google-login sign-in cannot run under the broker: it would need a sign-in that stays on this machine/);
  // A relayable mode with no slot (OpenCode Zen, Azure OpenAI): named, with the modes that have one.
  assert.match(resolveModelRoute({ engine: 'opencode', serverEnv: {}, broker: ALL_SLOTS, model: 'opencode/x' }).refusal,
    /^the credential broker is on, and OpenCode's opencode provider has no broker slot; pick a model or sign-in that has one \(anthropic, openai, google, openrouter\)/);
  // No slot of the engine's at all: the broker's one refusal.
  assert.equal(resolveModelRoute({ engine: 'qwen', serverEnv: {}, broker: { on: true, slots: ['cursor'] }, model: 'q' }).refusal, brokerRefusalText('qwen'));
});

test('a per-mode relay route: the mode\'s vendor, its auth header, and a CLI pointed at the relay with a dummy key', () => {
  const route = (engine, serverEnv, model) => buildRelayRoute(resolveModelRoute({ engine, remote: true, serverEnv, broker: OFF, model }), { serverEnv, label: 'E2B sandbox' });
  const g = route('gemini', { GEMINI_API_KEY: 'AIza-key-0123456789' });
  assert.equal(g.upstream, 'https://generativelanguage.googleapis.com');
  assert.deepEqual(g.authHeaders({}), { 'x-goog-api-key': 'AIza-key-0123456789' });
  assert.deepEqual(g.secrets, ['AIza-key-0123456789']);
  assert.equal(g.protocol, 'gemini');
  assert.ok(g.allow[0][1].test('/v1beta/models/gemini-2.5-pro:streamGenerateContent'));
  assert.ok(!g.allow[0][1].test('/v1beta/files'), 'only the generate calls');
  const pointed = g.spawn('http://127.0.0.1:9/r/id');
  assert.deepEqual(pointed.env, { GEMINI_API_KEY: 'worca-relay-no-credential', GEMINI_CLI_AUTH_OVERRIDE: 'gemini-api-key', GOOGLE_GEMINI_BASE_URL: 'http://127.0.0.1:9/r/id' });
  // OpenCode: its provider block rides its inline config; small_model pins the title call to the step's model.
  const o = route('opencode', { ANTHROPIC_API_KEY: 'sk-ant-0123456789' }, 'anthropic/claude-sonnet-5');
  assert.deepEqual(o.authHeaders({}), { 'x-api-key': 'sk-ant-0123456789' });
  assert.deepEqual(o.spawn('http://h/r/id').config.provider, { anthropic: { options: { baseURL: 'http://h/r/id/v1', apiKey: 'worca-relay-no-credential' } } });
  assert.equal(o.spawn('http://h/r/id').config.small_model, 'anthropic/claude-sonnet-5');
  // OpenCode Zen: signed in the header the CLI used.
  const z = route('opencode', { OPENCODE_API_KEY: 'zen-key-0123456789' }, 'opencode/gpt-5');
  assert.deepEqual(z.authHeaders({ 'x-api-key': 'dummy' }), { 'x-api-key': 'zen-key-0123456789' });
  assert.deepEqual(z.authHeaders({ authorization: 'Bearer dummy' }), { authorization: 'Bearer zen-key-0123456789' });
  // Goose on Azure OpenAI: the endpoint is the server's, an origin; the deployment rides along as config.
  const a = route('goose', { AZURE_OPENAI_API_KEY: 'az-key-0123456789', AZURE_OPENAI_ENDPOINT: 'https://acme.openai.azure.com/', AZURE_OPENAI_DEPLOYMENT_NAME: 'dep' }, 'azure_openai/gpt-4.1');
  assert.equal(a.upstream, 'https://acme.openai.azure.com');
  assert.deepEqual(a.authHeaders({}), { 'api-key': 'az-key-0123456789' });
  assert.deepEqual(a.spawn('http://h/r/id').env, { AZURE_OPENAI_ENDPOINT: 'http://h/r/id', AZURE_OPENAI_API_KEY: 'worca-relay-no-credential', AZURE_OPENAI_DEPLOYMENT_NAME: 'dep',
    GOOSE_DISABLE_KEYRING: '1', GOOSE_TELEMETRY_OFF: '1' });
  // A server base URL the relay cannot extend is refused, not followed.
  assert.throws(() => route('qwen', { OPENAI_API_KEY: 'o', OPENAI_BASE_URL: 'https://u:p@gw.example/v1' }, 'q'), /carries a user name or password/);
  // Under the broker the relay forwards to the slot, signed with the spawn token only.
  const lease = { baseUrl: 'http://broker/p/openai', token: 'wbt_tok', secrets: ['wbt_tok'] };
  const d = resolveModelRoute({ engine: 'qwen', remote: true, serverEnv: {}, broker: ALL_SLOTS, model: 'qwen3' });
  const b = buildRelayRoute(d, { lease, label: 'E2B sandbox' });
  assert.equal(b.upstream, 'http://broker/p/openai/v1', 'the slot paths start at /v1');
  assert.deepEqual(b.authHeaders({}), { authorization: 'Bearer wbt_tok' });
});

test('a per-mode route holds each call to the step\'s model as its mode says: the body, the Gemini path, the Azure deployment, the Databricks endpoint (R11-1, R11-4)', () => {
  const route = (engine, serverEnv, model) => buildRelayRoute(resolveModelRoute({ engine, remote: true, serverEnv, broker: OFF, model }), { serverEnv, label: 'E2B sandbox' });
  const pin = (r) => [r.modelCheck, r.models, r.stepModel];
  // The body's model, as the CLI sends it: without the provider an engine's id names.
  assert.deepEqual(pin(route('goose', { OPENROUTER_API_KEY: 'or-0123456789' }, 'openrouter/meta-llama/llama-3.3-70b-instruct:free')),
    ['body', ['meta-llama/llama-3.3-70b-instruct:free'], 'meta-llama/llama-3.3-70b-instruct:free']);
  assert.deepEqual(pin(route('opencode', { ANTHROPIC_API_KEY: 'sk-ant-0123456789' }, 'anthropic/claude-sonnet-5')), ['body', ['claude-sonnet-5'], 'claude-sonnet-5']);
  assert.deepEqual(pin(route('opencode', { OPENCODE_API_KEY: 'zen-key-0123456789' }, 'opencode/gpt-5')), ['body', ['gpt-5'], 'gpt-5']);
  assert.deepEqual(pin(route('qwen', { OPENAI_API_KEY: 'o-0123456789', OPENAI_BASE_URL: 'https://gw.example/v1', OPENAI_MODEL: 'q' }, 'qwen3-coder')), ['body', ['qwen3-coder'], 'qwen3-coder']);
  // Gemini's model is in its path.
  const g = route('goose', { GOOGLE_API_KEY: 'AIza-0123456789' }, 'google/gemini-2.5-flash');
  assert.deepEqual(pin(g), ['path', ['gemini-2.5-flash'], 'gemini-2.5-flash']);
  assert.equal(g.pathModel.exec('/v1beta/models/gemini-2.5-flash:streamGenerateContent')[1], 'gemini-2.5-flash');
  assert.deepEqual(pin(route('qwen', { GEMINI_API_KEY: 'AIza-0123456789', GEMINI_MODEL: 'x' }, 'gemini-2.5-pro')), ['path', ['gemini-2.5-pro'], 'gemini-2.5-pro']);
  // Azure: the server's deployment, which goose calls; none set is refused.
  const az = { AZURE_OPENAI_API_KEY: 'az-key-0123456789', AZURE_OPENAI_ENDPOINT: 'https://acme.openai.azure.com/' };
  const a = route('goose', { ...az, AZURE_OPENAI_DEPLOYMENT_NAME: 'dep-1' }, 'azure_openai/gpt-4.1');
  assert.deepEqual(pin(a), ['path', ['dep-1'], 'dep-1']);
  assert.equal(a.pathModel.exec('/openai/deployments/dep-2/chat/completions')[1], 'dep-2', 'the relay compares it with dep-1');
  assert.throws(() => route('goose', az, 'azure_openai/gpt-4.1'), /AZURE_OPENAI_DEPLOYMENT_NAME is not set; the relay admits calls to that one deployment only/);
  // Databricks: the serving endpoint the step names, for its invocations and its own config alike.
  const db = route('goose', { DATABRICKS_TOKEN: 'dapi0123456789', DATABRICKS_HOST: 'https://adb.example' }, 'databricks/my-llm');
  assert.deepEqual(pin(db), ['path', ['my-llm'], 'my-llm']);
  for (const p of ['/serving-endpoints/other/invocations', '/api/2.0/serving-endpoints/other']) assert.equal(db.pathModel.exec(p)[1], 'other', p);
  assert.ok(!db.allow.some(([, re]) => re.test('/serving-endpoints/../invocations')), 'no dot segment');
  // Gemini CLI's own side calls use other models: its catalog check stays partial, the route pins nothing.
  const gem = route('gemini', { GEMINI_API_KEY: 'AIza-0123456789' }, 'gemini-2.5-pro');
  assert.deepEqual([gem.modelCheck, gem.pathModel], ['partial', undefined]);
});
