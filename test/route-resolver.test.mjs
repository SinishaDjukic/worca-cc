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
