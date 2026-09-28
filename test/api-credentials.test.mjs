// test/api-credentials.test.mjs
// ui/server.mjs with the credential broker on, several people signed in through
// Cloudflare Access (plans/credential-broker-design.html §6.6, §7.2): /api/credentials
// reports the signed-in person's slots (never a key), and a person with no key is
// refused before a run or an Ask turn starts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';
import { seal, suffixOf } from '../src/broker/vault.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';

useTempHome(after);

const PUBLIC = 'worca-01.example.com';
const KEY = 'sk-ant-api03-ada-0000000000001a2b';
const key = makeAccessKey();
const fakeCerts = certsFetch({ keys: [key] });
const realFetch = globalThis.fetch;
const VK = randomBytes(32);
const projectDir = mkdtempSync(join(tmpdir(), 'worca-cred-proj-'));
let srv; let port; let broker;

before(async () => {
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: 'q'.repeat(40), WORCA_BROKER_VAULT_KEY: VK.toString('base64'),
    WORCA_BROKER_PUBLIC_URL: 'https://worca-01-keys.example.com', WORCA_IDENTITY_HEADER: 'x-email',
    WORCA_BROKER_HOST: '127.0.0.1', WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '0',
  });
  assert.deepEqual(errors, []);
  broker = await startBroker({ config, slots: builtinSlots(), log: () => {} });
  broker.store.putCredential({ billTo: 'ada@example.com', slot: 'anthropic', sealed: seal(VK, KEY, { billTo: 'ada@example.com', slot: 'anthropic' }), suffix: suffixOf(KEY) });

  delete process.env.WORCA_MOCK;
  process.env.WORCA_ALLOWED_HOSTS = PUBLIC;
  process.env.WORCA_CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.WORCA_CF_ACCESS_AUD = AUD;
  process.env.WORCA_BROKER_URL = `http://127.0.0.1:${broker.ports.private}`;
  process.env.WORCA_BROKER_SECRET = 'q'.repeat(40);
  resetBrokerClient();
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  await broker?.close();
  globalThis.fetch = realFetch;
  for (const k of ['WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN', 'WORCA_CF_ACCESS_AUD', 'WORCA_BROKER_URL', 'WORCA_BROKER_SECRET']) delete process.env[k];
  resetBrokerClient();
  rmSync(projectDir, { recursive: true, force: true });
});

function call(method, path, email, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port, path, method,
      headers: {
        host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(key, { email }),
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (resp) => {
      let b = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { b += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: b ? JSON.parse(b) : null }));
    });
    r.on('error', rej);
    r.end(data);
  });
}

test('/api/credentials: the signed-in person\'s own slots, the key page, and never a key', async () => {
  const ada = await call('GET', '/api/credentials', 'ada@example.com');
  assert.equal(ada.status, 200);
  assert.equal(ada.body.enabled, true);
  assert.equal(ada.body.mode, 'multi');
  assert.equal(ada.body.person, 'ada@example.com');
  assert.equal(ada.body.keyPage, 'https://worca-01-keys.example.com');
  const slot = ada.body.slots.find((s) => s.id === 'anthropic');
  assert.deepEqual([slot.state, slot.suffix], ['set', '1a2b']);
  assert.ok(!JSON.stringify(ada.body).includes(KEY));
  const bob = await call('GET', '/api/credentials', 'bob@example.com');
  assert.equal(bob.body.slots.find((s) => s.id === 'anthropic').state, 'missing');
});

test('a run started with an explicit model is refused up front when that model\'s key is missing', async () => {
  const bob = await call('POST', '/api/run', 'bob@example.com', { projectDir, prompt: 'do it', model: 'claude-sonnet-5' });
  assert.equal(bob.status, 409);
  assert.equal(bob.body.code, 'credential-missing');
  assert.match(bob.body.error, /You haven't added your Anthropic API key or Claude subscription yet, and claude-sonnet-5 needs it.*https:\/\/worca-01-keys\.example\.com/);
  const ada = await call('POST', '/api/run', 'ada@example.com', { projectDir: '/definitely/not/a/project', prompt: 'do it', model: 'claude-sonnet-5' });
  assert.notEqual(ada.body?.code, 'credential-missing', 'Ada has a key: whatever else happens, it is not this refusal');
});

test('/api/credentials maps every catalog model to its slot (the picker badges)', async () => {
  const r = await call('GET', '/api/credentials', 'ada@example.com');
  assert.deepEqual(r.body.models['claude-sonnet-5'], { slot: 'anthropic' });
});

test('/api/stats adds spend per person from the broker', async () => {
  broker.store.insertUsage({ billTo: 'ada@example.com', slot: 'anthropic', usd: 1.25, inputTokens: 100, outputTokens: 10 });
  broker.store.insertUsage({ billTo: 'bob@example.com', slot: 'openai', usd: 0.5, inputTokens: 10, outputTokens: 1 });
  const r = await call('GET', '/api/stats?range=month', 'ada@example.com');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.byPerson.people.map((p) => [p.person, p.usd]), [['ada@example.com', 1.25], ['bob@example.com', 0.5]]);
});

test('an Ask message without a key is refused the same way', async () => {
  const t = await call('POST', '/api/ask/threads', 'bob@example.com', {});
  assert.ok(t.status === 200 || t.status === 201, JSON.stringify(t.body));
  const id = t.body.thread?.id ?? t.body.id;
  const m = await call('POST', `/api/ask/threads/${id}/messages`, 'bob@example.com', { text: 'hello', model: 'claude-sonnet-5', effort: 'medium' });
  assert.equal(m.status, 409, `thread ${JSON.stringify(t.body)} -> ${JSON.stringify(m.body)}`);
  assert.equal(m.body.code, 'credential-missing');
});
