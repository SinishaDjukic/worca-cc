// test/broker-subscription-github.test.mjs
// Two per-person credentials beyond API keys (docs/credential-broker.md):
//  - a Claude subscription token (sk-ant-oat…): sent as a Bearer with the OAuth beta,
//    verified with a one-token message, recorded without a price, and in multi mode only
//    used by spawns that run under their person's own agent user;
//  - "push as me": a person's GitHub user token, handed to worca for one git/gh call
//    (/internal/github-token), renewed when it is about to expire, never proxied to agents.
// A fake provider and a fake GitHub stand in for the real ones.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBrokerConfig } from '../src/broker/config.mjs';
import { builtinSlots, mergeSlots } from '../src/broker/slots.mjs';
import { startBroker } from '../src/broker/main.mjs';
import { openStore } from '../src/broker/store.mjs';
import { credentialKind, mergeBetas, OAUTH_BETA } from '../src/broker/service.mjs';
import { parseGithubSecret, githubSecretOf, refreshGithubToken, pollDeviceFlow, startDeviceFlow } from '../src/broker/copilot.mjs';
import { startFakeUpstream, GOOD_KEY } from './helpers/fake-model-upstream.mjs';

const SECRET = 'q'.repeat(48);
const OAT = 'sk-ant-oat01-subscriptiontoken0123456789abcdef';
const GH_OLD = 'ghu_oldusertoken000000000000000000000001';
const GH_NEW = 'ghu_newusertoken000000000000000000000002';
const PAT = 'github_pat_pastedfinegrained0000000000000003';
let up; let gh; let ghUrl; let broker; let base;
const ghCalls = [];

before(async () => {
  up = await startFakeUpstream({ validKeys: [GOOD_KEY, OAT] });
  gh = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      ghCalls.push({ url: req.url, headers: req.headers, body: b });
      const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/user') {
        const ok = [`token ${GH_OLD}`, `token ${GH_NEW}`, `token ${PAT}`].includes(req.headers.authorization);
        return ok ? json(200, { login: 'ada' }) : json(401, { message: 'Bad credentials' });
      }
      if (req.url === '/login/device/code') return json(200, { device_code: 'dev-9', user_code: 'WXYZ-9876', interval: 1, expires_in: 900 });
      if (req.url === '/login/oauth/access_token') {
        const j = JSON.parse(b || '{}');
        if (j.grant_type === 'refresh_token') {
          return j.client_secret === 'cs-secret' && j.refresh_token === 'ghr_1' ? json(200, { access_token: GH_NEW, refresh_token: 'ghr_2', expires_in: 28800 }) : json(200, { error: 'bad_refresh_token' });
        }
        return json(200, { access_token: GH_OLD, refresh_token: 'ghr_1', expires_in: 28800 });
      }
      json(404, {});
    });
  });
  await new Promise((r) => gh.listen(0, '127.0.0.1', r));
  ghUrl = `http://127.0.0.1:${gh.address().port}`;
  const { config, errors } = readBrokerConfig({
    WORCA_BROKER_MODE: 'multi', WORCA_BROKER_SECRET: SECRET, WORCA_BROKER_HOST: '127.0.0.1', WORCA_BROKER_PORT: '0', WORCA_BROKER_UI_PORT: '1',
    WORCA_BROKER_VAULT_KEY: randomBytes(32).toString('base64'), WORCA_BROKER_PUBLIC_URL: 'https://keys.example.com', WORCA_IDENTITY_HEADER: 'x-email',
    WORCA_BROKER_GITHUB_CLIENT_ID: 'Iv23liTestClient', WORCA_BROKER_GITHUB_CLIENT_SECRET: 'cs-secret',
  });
  assert.deepEqual(errors, []);
  const slots = mergeSlots(builtinSlots({ github: config.github }), [
    { id: 'anthropic', upstream: up.url },
    { id: 'github', upstream: ghUrl, deviceBaseUrl: ghUrl },
  ]);
  broker = await startBroker({ config: { ...config, port: 0, uiEnabled: false }, slots, log: () => {} });
  base = `http://127.0.0.1:${broker.ports.private}`;
});
after(async () => { await broker?.close(); await up?.close(); gh?.close(); });

async function internal(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { authorization: `Bearer ${SECRET}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
let seq = 0;
async function mint(billTo, extra = {}) {
  const r = await internal('POST', '/internal/tokens', { billTo, slots: ['anthropic'], spawnId: `sp-s${++seq}`, kind: 'phase', issuer: 'srv-test', ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}
const call = (token, headers = {}, path = '/p/anthropic/v1/messages') => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: `Bearer ${token}`, ...headers },
  body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }),
});

test('credentialKind and mergeBetas', () => {
  const anthropic = { protocol: 'anthropic', auth: 'x-api-key' };
  assert.equal(credentialKind(anthropic, OAT), 'subscription');
  assert.equal(credentialKind(anthropic, GOOD_KEY), 'api-key');
  assert.equal(credentialKind({ protocol: 'openai', auth: 'bearer' }, OAT), 'api-key', 'only an Anthropic slot takes a subscription');
  assert.equal(credentialKind({ protocol: 'github', auth: 'github-user' }, PAT), 'github');
  assert.equal(mergeBetas('a, b', OAUTH_BETA, 'b'), `a,b,${OAUTH_BETA}`);
  assert.equal(mergeBetas(undefined, OAUTH_BETA), OAUTH_BETA);
});

test('a subscription token is verified with a one-token message and saved as a subscription', async () => {
  up.requests.length = 0;
  const r = await broker.service.saveCredential('ada@acme.dev', 'anthropic', OAT);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.kind, 'subscription');
  const v = up.requests.at(-1);
  assert.equal(v.method, 'POST');
  assert.equal(v.url, '/v1/messages');
  assert.equal(v.headers.authorization, `Bearer ${OAT}`);
  assert.equal(v.headers['x-api-key'], undefined);
  assert.equal(v.headers['anthropic-beta'], OAUTH_BETA);
  assert.equal(JSON.parse(v.body).max_tokens, 1);
  const st = broker.service.slotStatus('ada@acme.dev').find((s) => s.id === 'anthropic');
  assert.equal(st.kind, 'subscription');
  assert.ok(!JSON.stringify(st).includes(OAT));
});

test('multi mode: a subscription is refused (403) for a spawn that does not run under its own user', async () => {
  const token = await mint('ada@acme.dev');
  up.requests.length = 0;
  const res = await call(token);
  assert.equal(res.status, 403);
  assert.match(await res.text(), /Claude subscription is only used by agents that run under their own user/);
  assert.equal(up.requests.length, 0, 'nothing reached the provider');
});

test('an isolated spawn uses the subscription: Bearer + merged betas, tokens recorded at $0 on the subscription plan', async () => {
  const token = await mint('ada@acme.dev', { isolated: true, runId: 'run-sub' });
  up.requests.length = 0;
  const res = await call(token, { 'anthropic-beta': 'claude-code-20250219' });
  assert.equal(res.status, 200);
  await res.text();
  const got = up.requests.at(-1);
  assert.equal(got.headers.authorization, `Bearer ${OAT}`);
  assert.equal(got.headers['anthropic-beta'], `claude-code-20250219,${OAUTH_BETA}`);
  assert.ok(!JSON.stringify(got.headers).includes(token));
  await new Promise((r) => setTimeout(r, 50));
  const u = await internal('GET', '/internal/usage?runId=run-sub');
  const row = (u.body.rows || u.body).find((x) => x.run_id === 'run-sub' || x.runId === 'run-sub');
  assert.ok(row, JSON.stringify(u.body));
  assert.equal(Number(row.usd), 0);
  const sum = await internal('GET', '/internal/usage/summary');
  const s = sum.body.rows.find((x) => x.billTo === 'ada@acme.dev' && x.slot === 'anthropic');
  assert.equal(s.plan, 'subscription');
  assert.ok(s.inputTokens > 0);
});

test('an API key still goes as x-api-key and is priced', async () => {
  assert.equal((await broker.service.saveCredential('bob@acme.dev', 'anthropic', GOOD_KEY)).kind, 'api-key');
  const token = await mint('bob@acme.dev');
  up.requests.length = 0;
  const res = await call(token);
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(up.requests.at(-1).headers['x-api-key'], GOOD_KEY);
  assert.equal(up.requests.at(-1).headers['anthropic-beta'], undefined);
});

test('the github slot exists only with a client id, and is never reachable through the proxy', async () => {
  assert.ok(!builtinSlots().some((s) => s.id === 'github'));
  assert.ok(builtinSlots({ github: { clientId: 'Iv23liTestClient', scope: 'repo' } }).some((s) => s.id === 'github' && s.auth === 'github-user'));
  const r = await internal('POST', '/internal/tokens', { billTo: 'ada@acme.dev', slots: ['github'], spawnId: 'sp-gh', kind: 'phase', issuer: 'srv-test' });
  if (r.status === 200) {
    const res = await fetch(`${base}/p/github/user`, { headers: { authorization: `Bearer ${r.body.token}` } });
    assert.ok(res.status >= 400, 'no path of the github slot is proxied');
    await res.text();
  }
  assert.ok(!ghCalls.some((c) => c.url === '/user' && c.headers.authorization?.includes('wbt_')));
});

test('/internal/github-token: not connected, then a pasted token, then an expiring App token renewed', async () => {
  let r = await internal('POST', '/internal/github-token', { person: 'cy@acme.dev' });
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'not_connected');

  const saved = await broker.service.saveCredential('cy@acme.dev', 'github', PAT);
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.kind, 'github');
  assert.equal(ghCalls.at(-1).headers.authorization, `token ${PAT}`);
  r = await internal('POST', '/internal/github-token', { person: 'cy@acme.dev' });
  assert.equal(r.status, 200);
  assert.equal(r.body.token, PAT);
  assert.equal(r.body.expiresAt, null);

  // A GitHub App user token that expires in a minute: the broker renews it with the refresh token.
  const nearly = githubSecretOf({ token: GH_OLD, refreshToken: 'ghr_1', expiresIn: 60 });
  assert.equal((await broker.service.saveCredential('dee@acme.dev', 'github', nearly)).ok, true);
  r = await internal('POST', '/internal/github-token', { person: 'dee@acme.dev' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.token, GH_NEW);
  const refresh = ghCalls.filter((c) => c.url === '/login/oauth/access_token').at(-1);
  assert.equal(JSON.parse(refresh.body).client_id, 'Iv23liTestClient');
  // Stored renewed: the next call needs no refresh.
  const before = ghCalls.length;
  r = await internal('POST', '/internal/github-token', { person: 'dee@acme.dev' });
  assert.equal(r.body.token, GH_NEW);
  assert.equal(ghCalls.length, before);

  r = await internal('POST', '/internal/github-token', { person: 'local' });
  assert.equal(r.status, 400);
});

test('an expired App token whose refresh fails reports expired and marks the credential', async () => {
  const dead = githubSecretOf({ token: GH_OLD, refreshToken: 'ghr_bad', expiresIn: 1 });
  assert.equal((await broker.service.saveCredential('eve@acme.dev', 'github', dead)).ok, true);
  const r = await internal('POST', '/internal/github-token', { person: 'eve@acme.dev' });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'expired');
  assert.match(r.body.error, /sign in again/);
  assert.equal(broker.service.slotStatus('eve@acme.dev').find((s) => s.id === 'github').state, 'invalid');
});

test('GitHub secret helpers and the device flow with an operator client id', async () => {
  assert.deepEqual(parseGithubSecret(PAT), { token: PAT, refreshToken: null, expiresAt: null });
  const s = githubSecretOf({ token: 't1', refreshToken: 'r1', expiresIn: 10 }, 1000);
  assert.deepEqual(parseGithubSecret(s), { token: 't1', refreshToken: 'r1', expiresAt: 11_000 });
  assert.equal(githubSecretOf({ token: 't2' }), 't2');
  await assert.rejects(refreshGithubToken({ refreshToken: 'r', clientId: 'x' }), /no client secret/);

  const f = await startDeviceFlow({ baseUrl: ghUrl, clientId: 'Iv23liTestClient', scope: 'repo' });
  assert.equal(f.userCode, 'WXYZ-9876');
  assert.deepEqual(JSON.parse(ghCalls.at(-1).body), { client_id: 'Iv23liTestClient', scope: 'repo' });
  const p = await pollDeviceFlow('dev-9', { baseUrl: ghUrl, clientId: 'Iv23liTestClient' });
  assert.deepEqual(p, { token: GH_OLD, refreshToken: 'ghr_1', expiresIn: 28800 });
});

test('config: a client secret needs a client id; a bad client id is refused', () => {
  const base = { WORCA_BROKER_MODE: 'single', WORCA_BROKER_SECRET: SECRET };
  assert.match(readBrokerConfig({ ...base, WORCA_BROKER_GITHUB_CLIENT_SECRET: 'x' }).errors.join(' '), /needs WORCA_BROKER_GITHUB_CLIENT_ID/);
  assert.match(readBrokerConfig({ ...base, WORCA_BROKER_GITHUB_CLIENT_ID: 'bad id!' }).errors.join(' '), /does not look like/);
  assert.equal(readBrokerConfig(base).config.github, null);
});

test('store: an older database gains the new columns without losing rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-broker-mig-'));
  try {
    const path = join(dir, 'b.db');
    const s1 = openStore(path);
    s1.insertUsage({ billTo: 'ada@acme.dev', slot: 'anthropic', usd: 1.5 });
    s1.close();
    // Simulate the first release's schema: drop the added columns.
    const db = new DatabaseSync(path);
    db.exec('ALTER TABLE usage DROP COLUMN plan; ALTER TABLE credentials DROP COLUMN kind; ALTER TABLE tokens DROP COLUMN isolated;');
    db.close();
    const s2 = openStore(path);
    const rows = s2.summarizeUsage({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].plan, 'api');
    assert.equal(rows[0].usd, 1.5);
    s2.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
