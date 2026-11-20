// test/broker-github-paste-only.test.mjs
// "Push as me" without a GitHub App or OAuth App (docs/credential-broker.md): in multi mode
// the broker's `github` slot always exists. Without WORCA_BROKER_GITHUB_CLIENT_ID it is
// paste-only: the key page takes a fine-grained token (checked with GET /user, sealed) and
// has no sign-in flow; /internal/github-token hands the token to worca, and worca with
// WORCA_GH_AS_PERSON=prefer uses it for a write. With a client ID the slot keeps its sign-in.
// A fake GitHub stands in for github.com and api.github.com.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBroker, startBroker } from '../src/broker/main.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { githubSecretOf } from '../src/broker/copilot.mjs';
import { githubEnv } from '../src/core/github-credentials.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';

const SECRET = 'p'.repeat(48);
const PUBLIC = 'https://keys.example.com';
const PAT = 'github_pat_pastedfinegrained0000000000000007';
const GHU = 'ghu_signinusertoken00000000000000000000008';
const ghCalls = [];
let gh; let ghUrl; let dir;
const brokers = [];

async function brokerWith(extraEnv = {}) {
  const env = {
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1', WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '0',
    WORCA_BROKER_VAULT_KEY: randomBytes(32).toString('base64'), WORCA_BROKER_PUBLIC_URL: PUBLIC,
    WORCA_IDENTITY_HEADER: 'x-email', WORCA_IDENTITY_TRUSTED_PROXIES: '127.0.0.1',
    // Point the built-in github slot at the fake GitHub; everything else is the real wiring.
    WORCA_BROKER_SLOTS_FILE: join(dir, 'slots.json'),
    ...extraEnv,
  };
  const { config, slots, errors } = loadBroker(env);
  assert.deepEqual(errors, []);
  const b = await startBroker({ config, slots, log: () => {} });
  brokers.push(b);
  const priv = `http://127.0.0.1:${b.ports.private}`;
  const ui = `http://127.0.0.1:${b.ports.ui}`;
  const internal = async (method, path, body) => {
    const res = await fetch(`${priv}${path}`, { method, headers: { authorization: `Bearer ${SECRET}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  // The key page, as `email` behind the trusted identity proxy.
  const page = async (email) => {
    const me = await fetch(`${ui}/api/me`, { headers: { 'x-email': email } });
    const body = await me.json();
    const cookie = me.headers.get('set-cookie').split(';')[0];
    const send = async (method, p, payload) => {
      const res = await fetch(`${ui}${p}`, { method, headers: { 'x-email': email, origin: PUBLIC, cookie, 'x-worca-csrf': body.csrf, 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    return { me: body, send };
  };
  return { broker: b, priv, internal, page };
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'worca-gh-paste-'));
  gh = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      ghCalls.push({ url: req.url, headers: req.headers, body: b });
      const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/user') return [`token ${PAT}`, `token ${GHU}`].includes(req.headers.authorization) ? json(200, { login: 'ada' }) : json(401, { message: 'Bad credentials' });
      if (req.url === '/login/device/code') return json(200, { device_code: 'dev-7', user_code: 'PQRS-7777', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
      json(404, {});
    });
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  ghUrl = `http://127.0.0.1:${gh.address().port}`;
  writeFileSync(join(dir, 'slots.json'), JSON.stringify([{ id: 'github', upstream: ghUrl, deviceBaseUrl: ghUrl }]));
});
after(async () => {
  for (const b of brokers) await b.close();
  gh?.close();
  rmSync(dir, { recursive: true, force: true });
});

const KEYS = ['WORCA_BROKER_URL', 'WORCA_BROKER_SECRET'];
const SAVED = {};
beforeEach(() => { for (const k of KEYS) SAVED[k] = process.env[k]; resetBrokerClient(); });
afterEach(() => {
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  resetBrokerClient();
});

test('builtinSlots: github in multi mode without a client id is paste-only; with one it has its sign-in', () => {
  assert.ok(!builtinSlots().some((s) => s.id === 'github'), 'single mode without a client id: no github slot');
  const paste = builtinSlots({ multi: true }).find((s) => s.id === 'github');
  assert.equal(paste.auth, 'github-user');
  assert.equal(paste.signIn, undefined);
  assert.equal(paste.clientId, undefined);
  const signIn = builtinSlots({ multi: true, github: { clientId: 'Iv23liTestClient', scope: 'repo' } }).find((s) => s.id === 'github');
  assert.equal(signIn.signIn, 'github-device');
  assert.equal(signIn.clientId, 'Iv23liTestClient');
  // A slots file cannot give the paste-only slot a sign-in (it would run on Copilot's app).
  const forced = mergeSlots(builtinSlots({ multi: true }), [{ id: 'github', signIn: 'github-device' }]).find((s) => s.id === 'github');
  assert.equal(forced.signIn, undefined);
});

test('no client id: the key page takes a pasted token, has no sign-in, and worca pushes with it', async () => {
  const { internal, page, priv } = await brokerWith();
  const ada = await page('ada@acme.dev');
  const row = ada.me.slots.find((s) => s.id === 'github');
  assert.ok(row, 'the github slot is on the key page');
  assert.equal(row.signIn, undefined, 'no "Sign in with GitHub"');
  assert.equal(row.state, 'missing');

  // The device sign-in answers as for a slot with no sign-in flow, and never reaches GitHub.
  const before = ghCalls.length;
  const dev = await ada.send('POST', '/api/slots/github/device');
  assert.equal(dev.status, 404);
  assert.match(dev.body.error, /no sign-in flow/);
  assert.equal((await ada.send('POST', '/api/slots/github/device/poll')).status, 404);
  assert.equal(ghCalls.length, before);

  assert.equal((await ada.send('PUT', '/api/slots/github', { secret: 'github_pat_wrongwrongwrong000000000000' })).status, 422);
  const saved = await ada.send('PUT', '/api/slots/github', { secret: PAT });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(ghCalls.at(-1).url, '/user');
  assert.equal(ghCalls.at(-1).headers.authorization, `token ${PAT}`);
  assert.equal((await page('ada@acme.dev')).me.slots.find((s) => s.id === 'github').state, 'set');

  const t = await internal('POST', '/internal/github-token', { person: 'ada@acme.dev' });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.deepEqual(t.body, { token: PAT, expiresAt: null });
  const none = await internal('POST', '/internal/github-token', { person: 'bob@acme.dev' });
  assert.equal(none.body.code, 'not_connected');

  // worca with WORCA_GH_AS_PERSON=prefer: Ada's write goes out with her pasted token.
  process.env.WORCA_BROKER_URL = priv;
  process.env.WORCA_BROKER_SECRET = SECRET;
  resetBrokerClient();
  const env = { WORCA_BROKER_URL: priv, WORCA_GH_AS_PERSON: 'prefer', GH_TOKEN: 'ghs_worcas_own' };
  const w = await githubEnv('write', { base: env, person: 'ada@acme.dev' });
  assert.equal(w.error, null);
  assert.equal(w.as, 'ada@acme.dev');
  assert.equal(w.env.GH_TOKEN, PAT);
  assert.equal(w.env.WORCA_GIT_TOKEN, PAT);
  const bob = await githubEnv('write', { base: env, person: 'bob@acme.dev' });
  assert.equal(bob.env.GH_TOKEN, 'ghs_worcas_own', 'prefer: no GitHub connected, worca\'s own credential');
});

test('no client id: a sign-in\'s token due for renewal answers as expired, without calling GitHub', async () => {
  const { broker, internal } = await brokerWith();
  // Left over from when the broker had a client id: a GitHub App user token with its refresh token.
  const nearly = githubSecretOf({ token: GHU, refreshToken: 'ghr_1', expiresIn: 60 });
  assert.equal((await broker.service.saveCredential('cy@acme.dev', 'github', nearly)).ok, true);
  const before = ghCalls.length;
  const r = await internal('POST', '/internal/github-token', { person: 'cy@acme.dev' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'expired');
  assert.match(r.body.error, /no GitHub client ID to renew it/);
  assert.equal(ghCalls.length, before);
  assert.equal(broker.service.slotStatus('cy@acme.dev').find((s) => s.id === 'github').state, 'invalid');
});

test('with a client id: the slot keeps "Sign in with GitHub" through the operator\'s app, and pasting', async () => {
  const { page, internal } = await brokerWith({ WORCA_BROKER_GITHUB_CLIENT_ID: 'Iv23liTestClient' });
  const dee = await page('dee@acme.dev');
  assert.equal(dee.me.slots.find((s) => s.id === 'github').signIn, 'github-device');
  const dev = await dee.send('POST', '/api/slots/github/device');
  assert.equal(dev.status, 200, JSON.stringify(dev.body));
  assert.equal(dev.body.userCode, 'PQRS-7777');
  assert.equal(JSON.parse(ghCalls.at(-1).body).client_id, 'Iv23liTestClient');
  assert.equal((await dee.send('PUT', '/api/slots/github', { secret: PAT })).status, 200);
  assert.equal((await internal('POST', '/internal/github-token', { person: 'dee@acme.dev' })).body.token, PAT);
});

test('single mode without a client id has no github slot: /internal/github-token is not configured', async () => {
  const { config, slots, errors } = loadBroker({ WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1', WORCA_BROKER_PORT: '0' });
  assert.deepEqual(errors, []);
  assert.ok(!slots.some((s) => s.id === 'github'));
  const b = await startBroker({ config, slots, log: () => {} });
  brokers.push(b);
  const res = await fetch(`http://127.0.0.1:${b.ports.private}/internal/github-token`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ person: 'ada@acme.dev' }) });
  const body = await res.json();
  assert.equal(res.status, 404);
  assert.equal(body.code, 'not_configured');
});
