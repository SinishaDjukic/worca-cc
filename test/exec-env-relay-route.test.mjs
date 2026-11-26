// test/exec-env-relay-route.test.mjs
// remoteModelRoute (src/core/exec-env/relay-route.mjs): which upstream and which auth headers worca adds
// for one remote Claude spawn, or a refusal. Pure function; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteModelRoute } from '../src/core/exec-env/relay-route.mjs';

const label = 'E2B sandbox';
const OAUTH = { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' };
const route = (o) => remoteModelRoute({ spawnEnv: {}, modelEnv: null, serverEnv: {}, label, ...o });
const refusal = (o, re) => assert.throws(() => route(o), (e) => { assert.equal(e.errorClass, 'config'); assert.match(e.message, re); return true; });

test('no broker, OAuth server: Bearer + merged beta to api.anthropic.com', () => {
  const r = route({ serverEnv: OAUTH });
  assert.equal(r.upstream, 'https://api.anthropic.com');
  assert.deepEqual(r.authHeaders({ 'anthropic-beta': 'a' }), { authorization: 'Bearer sk-ant-oat01-x', 'anthropic-beta': 'a,oauth-2025-04-20' });
  assert.deepEqual(r.authHeaders({}), { authorization: 'Bearer sk-ant-oat01-x', 'anthropic-beta': 'oauth-2025-04-20' });
  assert.ok(r.secrets.includes('sk-ant-oat01-x'));
});

test('no broker, API key server: x-api-key; OAuth wins when both are set', () => {
  const r = route({ serverEnv: { ANTHROPIC_API_KEY: 'k' } });
  assert.deepEqual(r.authHeaders({}), { 'x-api-key': 'k' });
  assert.deepEqual(r.secrets, ['k']);
  const both = route({ serverEnv: { ...OAUTH, ANTHROPIC_API_KEY: 'k' } });
  assert.match(both.authHeaders({})['authorization'], /^Bearer sk-ant-oat01-x$/);
  assert.equal(both.authHeaders({})['x-api-key'], undefined);
});

test('api.anthropic.com base with trailing path/slash still gets the server credential', () => {
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: ' https://api.anthropic.com/ ' }, serverEnv: { ANTHROPIC_API_KEY: 'k' } });
  assert.deepEqual(r.authHeaders({}), { 'x-api-key': 'k' });
});

test('gateway with its own key: that key, never the server credential', () => {
  const base = 'https://gw.example/v1';
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: base }, modelEnv: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'g' }, serverEnv: OAUTH });
  assert.equal(r.upstream, base);
  assert.deepEqual(r.authHeaders({ 'anthropic-beta': 'a' }), { authorization: 'Bearer g' });
  assert.deepEqual(r.secrets, ['g']);
  assert.ok(!JSON.stringify(r.authHeaders({})).includes('sk-ant-oat01-x'));
});

test('entry ANTHROPIC_API_KEY goes as x-api-key; the auth token wins over it', () => {
  const spawnEnv = { ANTHROPIC_BASE_URL: 'https://gw.example' };
  assert.deepEqual(route({ spawnEnv, modelEnv: { ANTHROPIC_API_KEY: 'a' } }).authHeaders({}), { 'x-api-key': 'a' });
  assert.deepEqual(route({ spawnEnv, modelEnv: { ANTHROPIC_API_KEY: 'a', ANTHROPIC_AUTH_TOKEN: 't' } }).authHeaders({}), { authorization: 'Bearer t' });
});

test('keyless third-party gateway never gets the server credential', () => {
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: 'https://gw.example/v1' }, serverEnv: { ...OAUTH, ANTHROPIC_API_KEY: 'k' } });
  assert.deepEqual(r.authHeaders({}), {});
  assert.deepEqual(r.secrets, []);
});

test('broker slot: wbt_ token as Bearer, upstream as given', () => {
  const base = 'http://broker:8080/p/anthropic';
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: base }, modelEnv: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: 'wbt_abc' }, serverEnv: OAUTH });
  assert.equal(r.upstream, base);
  assert.deepEqual(r.authHeaders({}), { authorization: 'Bearer wbt_abc' });
});

test('bridge on loopback is allowed', () => {
  const base = 'http://127.0.0.1:4317/m/openai-gpt';
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: base }, modelEnv: { ANTHROPIC_AUTH_TOKEN: 'bridge-secret' } });
  assert.equal(r.upstream, base);
  assert.deepEqual(r.authHeaders({}), { authorization: 'Bearer bridge-secret' });
});

test('custom headers are carried and their values are secrets', () => {
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: 'https://gw.example', ANTHROPIC_CUSTOM_HEADERS: 'X-Team: blue\n\nX-Trace:  a: b \r\n' } });
  assert.deepEqual(r.extraHeaders, { 'X-Team': 'blue', 'X-Trace': 'a: b' });
  assert.ok(r.secrets.includes('blue') && r.secrets.includes('a: b'));
});

test('a custom header naming authorization, x-api-key, host or proxy-* is refused', () => {
  for (const n of ['Authorization', 'x-api-key', 'HOST', 'Proxy-Authorization']) {
    refusal({ spawnEnv: { ANTHROPIC_CUSTOM_HEADERS: `${n}: v` }, serverEnv: OAUTH }, new RegExp(n, 'i'));
  }
});

test('Bedrock, Vertex and Foundry are refused when truthy', () => {
  for (const x of ['BEDROCK', 'VERTEX', 'FOUNDRY']) {
    for (const v of ['1', 'true', 'TRUE', 'yes']) {
      refusal({ spawnEnv: { [`CLAUDE_CODE_USE_${x}`]: v }, serverEnv: OAUTH }, new RegExp(`This model signs its own requests \\(CLAUDE_CODE_USE_${x}\\), which an E2B sandbox cannot relay\\. Pick Local for this model\\.`));
    }
  }
});

test('falsy CLAUDE_CODE_USE_* (empty, 0, false, any case) does not refuse', () => {
  for (const v of ['', '0', 'false', 'FALSE', ' False ']) {
    assert.doesNotThrow(() => route({ spawnEnv: { CLAUDE_CODE_USE_BEDROCK: v }, serverEnv: OAUTH }));
  }
});

test('another secret-named key in the model env is refused', () => {
  refusal({ modelEnv: { ANTHROPIC_AUTH_TOKEN: 't', MY_GATEWAY_TOKEN: 's' }, serverEnv: OAUTH },
    /This model's setting MY_GATEWAY_TOKEN holds a secret, which never enters an E2B sandbox\. Pick Local for this model\./);
  refusal({ modelEnv: { SOME_SECRET: 's' } }, /SOME_SECRET/);
  refusal({ modelEnv: { AWS_SECRET_ACCESS_KEY_ID_KEY: 's' } }, /holds a secret/);
});

test('no credential anywhere is refused', () => {
  refusal({}, /no model credential in the worca server's environment/);
});

test('unparseable base URL is refused', () => {
  refusal({ spawnEnv: { ANTHROPIC_BASE_URL: 'not a url' }, serverEnv: OAUTH }, /^This model's ANTHROPIC_BASE_URL is not a valid URL\.$/);
});

test('the label words the refusal copy', () => {
  assert.throws(() => route({ label: 'Foo sandbox', spawnEnv: { CLAUDE_CODE_USE_VERTEX: '1' } }), /which an Foo sandbox cannot relay/);
});

test('the server credential is trimmed in the header and in secrets', () => {
  const o = route({ serverEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x\n' } });
  assert.equal(o.authHeaders({}).authorization, 'Bearer sk-ant-oat01-x');
  assert.deepEqual(o.secrets, ['sk-ant-oat01-x']);
  const k = route({ serverEnv: { ANTHROPIC_API_KEY: 'k1 ' } });
  assert.deepEqual(k.authHeaders({}), { 'x-api-key': 'k1' });
  assert.deepEqual(k.secrets, ['k1']);
});

test('upstream is the normalised URL from the same parse', () => {
  assert.equal(route({ spawnEnv: { ANTHROPIC_BASE_URL: 'HTTPS://GW.Example:443/v1/x' } }).upstream, 'https://gw.example/v1/x');
  assert.equal(route({ spawnEnv: { ANTHROPIC_BASE_URL: 'https://gw.example/' } }).upstream, 'https://gw.example');
});

test('a base URL with userinfo is refused', () => {
  refusal({ spawnEnv: { ANTHROPIC_BASE_URL: 'https://u:p@gw.example/v1' } },
    /^This model's ANTHROPIC_BASE_URL carries a user name or password, which never enters an E2B sandbox\. Pick Local for this model\.$/);
  refusal({ spawnEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com@evil.example' }, serverEnv: OAUTH }, /user name or password/);
});

// I3: a worca server whose own env names a gateway (ANTHROPIC_BASE_URL) signs it with the server's own gateway key.
const GW = 'https://gw.example/v1';

test('server-env gateway: the server\'s ANTHROPIC_AUTH_TOKEN as Bearer, trimmed, a secret (I3)', () => {
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: ` ${GW} ` }, serverEnv: { ANTHROPIC_BASE_URL: `${GW}\n`, ANTHROPIC_AUTH_TOKEN: ' gw-token-1 ', ANTHROPIC_API_KEY: 'gw-key-1' } });
  assert.equal(r.upstream, GW);
  assert.deepEqual(r.authHeaders({}), { authorization: 'Bearer gw-token-1' });
  assert.deepEqual(r.secrets, ['gw-token-1']);
  assert.equal(r.signed, true);
});

test('server-env gateway: else the server\'s ANTHROPIC_API_KEY as x-api-key (I3)', () => {
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: GW }, modelEnv: { ANTHROPIC_MODEL: 'm' }, serverEnv: { ANTHROPIC_BASE_URL: GW, ANTHROPIC_API_KEY: ' gw-key-1 ' } });
  assert.deepEqual(r.authHeaders({}), { 'x-api-key': 'gw-key-1' });
  assert.deepEqual(r.secrets, ['gw-key-1']);
});

test('server-env gateway without a gateway key is refused, and the OAuth token is never sent to it (I3)', () => {
  refusal({ spawnEnv: { ANTHROPIC_BASE_URL: GW }, serverEnv: { ANTHROPIC_BASE_URL: GW } },
    /^The worca server's ANTHROPIC_BASE_URL points at https:\/\/gw\.example, but the server has no ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY for it\. Set one, or pick Local for this model\.$/);
  refusal({ spawnEnv: { ANTHROPIC_BASE_URL: GW }, serverEnv: { ANTHROPIC_BASE_URL: GW, ...OAUTH } }, /has no ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY/);
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: GW }, serverEnv: { ANTHROPIC_BASE_URL: GW, ...OAUTH, ANTHROPIC_API_KEY: 'gw-key-1' } });
  assert.ok(!JSON.stringify([r.authHeaders({}), r.secrets]).includes('sk-ant-oat01-x'), 'never CLAUDE_CODE_OAUTH_TOKEN to a third party');
});

test('the server-env gateway rule needs the same URL and no model base URL (I3)', () => {
  // A model entry naming the same gateway itself is the entry's route: keyless, never the server's key.
  const own = route({ spawnEnv: { ANTHROPIC_BASE_URL: GW }, modelEnv: { ANTHROPIC_BASE_URL: GW }, serverEnv: { ANTHROPIC_BASE_URL: GW, ANTHROPIC_API_KEY: 'gw-key-1' } });
  assert.deepEqual(own.authHeaders({}), {}); assert.equal(own.signed, false);
  const other = route({ spawnEnv: { ANTHROPIC_BASE_URL: 'https://other.example' }, serverEnv: { ANTHROPIC_BASE_URL: GW, ANTHROPIC_API_KEY: 'gw-key-1' } });
  assert.deepEqual(other.authHeaders({}), {});
  // The server env pointing at api.anthropic.com is the first-party route, OAuth included.
  const first = route({ spawnEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, serverEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ...OAUTH } });
  assert.equal(first.authHeaders({}).authorization, 'Bearer sk-ant-oat01-x');
});

test('a keyless route says so and names its origin', () => {
  const r = route({ spawnEnv: { ANTHROPIC_BASE_URL: 'https://gw.example/v1' } });
  assert.equal(r.signed, false); assert.equal(r.origin, 'https://gw.example');
  assert.equal(route({ serverEnv: OAUTH }).signed, true);
});

test('a base URL with a query string or fragment is refused (Minor 4)', () => {
  for (const u of ['https://gw.example/v1?key=abc', 'https://gw.example/v1#x', 'https://gw.example/?', 'https://gw.example#']) {
    refusal({ spawnEnv: { ANTHROPIC_BASE_URL: u }, serverEnv: OAUTH },
      /^This model's ANTHROPIC_BASE_URL has a query or fragment, which the relay cannot extend\. Pick Local for this model\.$/);
  }
});

test('a lowercase secret-named model setting is refused too (Minor 5)', () => {
  refusal({ modelEnv: { my_api_key: 's' }, serverEnv: OAUTH }, /This model's setting my_api_key holds a secret/);
  refusal({ modelEnv: { Gateway_Token: 's' }, serverEnv: OAUTH }, /Gateway_Token/);
});
