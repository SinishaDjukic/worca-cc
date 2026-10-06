// test/github-as-person.test.mjs
// "Push as me" on worca's side (src/core/github-credentials.mjs): with WORCA_GH_AS_PERSON
// a write call (push, pull request) gets the acting person's own GitHub token from the
// credential broker, for that call only. prefer falls back to worca's own credential;
// required refuses. A fake broker answers /internal/github-token.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubEnv, asPersonMode } from '../src/core/github-credentials.mjs';
import { resetBrokerClient } from '../src/core/broker-client.mjs';
import { checkBrokerAtBoot } from '../src/core/broker-boot.mjs';
import { withBillTo } from '../src/core/billing.mjs';

const SECRET = 'g'.repeat(40);
let server; let url;
let slots = [{ id: 'anthropic', auth: 'x-api-key', upstream: 'https://api.anthropic.com' }];
const asked = [];
const SAVED = {};
const KEYS = ['WORCA_BROKER_URL', 'WORCA_BROKER_SECRET', 'WORCA_GH_AS_PERSON', 'GH_TOKEN'];

before(async () => {
  server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== `Bearer ${SECRET}`) return json(401, {});
      if (req.url === '/internal/info') return json(200, { mode: 'multi', slots, publicUrl: 'https://keys.example.com' });
      if (req.url === '/internal/tokens/revoke') return json(200, { revoked: 0 });
      if (req.url === '/internal/github-token') {
        const { person } = JSON.parse(b);
        asked.push(person);
        if (person === 'ada@acme.dev') return json(200, { token: 'ghu_adas_own_token', expiresAt: null });
        if (person === 'old@acme.dev') return json(409, { error: 'GitHub would not renew the sign-in (bad_refresh_token): sign in again', code: 'expired' });
        return json(404, { error: `${person} has not connected GitHub`, code: 'not_connected' });
      }
      json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());
beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  process.env.WORCA_BROKER_URL = url;
  process.env.WORCA_BROKER_SECRET = SECRET;
  resetBrokerClient();
  asked.length = 0;
});
afterEach(() => {
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  resetBrokerClient();
});

const base = (extra = {}) => ({ WORCA_BROKER_URL: url, GH_TOKEN: 'ghs_worcas_own', ...extra });

test('asPersonMode: needs the broker and a known value', () => {
  assert.equal(asPersonMode({ WORCA_GH_AS_PERSON: 'prefer' }), null);
  assert.equal(asPersonMode({ WORCA_BROKER_URL: url, WORCA_GH_AS_PERSON: 'Required' }), 'required');
  assert.equal(asPersonMode({ WORCA_BROKER_URL: url, WORCA_GH_AS_PERSON: 'yes' }), null);
  assert.equal(asPersonMode({ WORCA_BROKER_URL: url }), null);
});

test('off: a write uses worca\'s own token and never asks the broker', async () => {
  const r = await githubEnv('write', { base: base(), person: 'ada@acme.dev' });
  assert.equal(r.env.GH_TOKEN, 'ghs_worcas_own');
  assert.equal(asked.length, 0);
});

test('prefer: the acting person\'s token for writes, worca\'s own for reads and for people without GitHub', async () => {
  const env = base({ WORCA_GH_AS_PERSON: 'prefer' });
  const w = await withBillTo('ada@acme.dev', () => githubEnv('write', { base: env }));
  assert.equal(w.error, null);
  assert.equal(w.env.GH_TOKEN, 'ghu_adas_own_token');
  assert.equal(w.env.WORCA_GIT_TOKEN, 'ghu_adas_own_token');
  assert.equal(w.as, 'ada@acme.dev');
  const r = await githubEnv('read', { base: env, person: 'ada@acme.dev' });
  assert.equal(r.env.GH_TOKEN, 'ghs_worcas_own');
  const nobody = await githubEnv('write', { base: env, person: 'bob@acme.dev' });
  assert.equal(nobody.env.GH_TOKEN, 'ghs_worcas_own');
  const local = await githubEnv('write', { base: env, person: 'local' });
  assert.equal(local.env.GH_TOKEN, 'ghs_worcas_own');
  assert.deepEqual(asked, ['ada@acme.dev', 'bob@acme.dev']);
});

test('required: no token means no credential and a reason, never worca\'s own', async () => {
  const env = base({ WORCA_GH_AS_PERSON: 'required' });
  const ok = await githubEnv('write', { base: env, person: 'ada@acme.dev' });
  assert.equal(ok.env.GH_TOKEN, 'ghu_adas_own_token');
  const missing = await githubEnv('write', { base: env, person: 'bob@acme.dev' });
  assert.equal(missing.env.GH_TOKEN, undefined);
  assert.match(missing.error, /pushing as bob@acme.dev: bob@acme.dev has not connected GitHub/);
  const expired = await githubEnv('write', { base: env, person: 'old@acme.dev' });
  assert.equal(expired.env.GH_TOKEN, undefined);
  assert.match(expired.error, /sign in again/);
  const system = await githubEnv('write', { base: env, person: null });
  assert.equal(system.env.GH_TOKEN, undefined);
  assert.match(system.error, /nobody signed in/);
});

test('asPerson:false (worca\'s own metrics branch) always uses worca\'s credential', async () => {
  const r = await githubEnv('write', { base: base({ WORCA_GH_AS_PERSON: 'required' }), person: 'ada@acme.dev', asPerson: false });
  assert.equal(r.env.GH_TOKEN, 'ghs_worcas_own');
  assert.equal(asked.length, 0);
  const metricsSrc = readFileSync(new URL('../src/core/metrics/sync.mjs', import.meta.url), 'utf8');
  assert.match(metricsSrc, /githubOnlyEnv\('write', \{[^}]*asPerson: false/);
  assert.match(metricsSrc, /gitEnvFor\('write', url, \{[^}]*asPerson: false/);
});

test('boot: WORCA_GH_AS_PERSON without a GitHub slot on the broker is a warning', async () => {
  const home = mkdtempSync(join(tmpdir(), 'worca-asperson-'));
  const savedHome = process.env.HOME;
  process.env.HOME = home;
  try {
  slots = [{ id: 'anthropic', auth: 'x-api-key', upstream: 'https://api.anthropic.com' }];
  const env = { WORCA_BROKER_URL: url, WORCA_BROKER_SECRET: SECRET, WORCA_GH_AS_PERSON: 'required', HOME: home };
  const r = await checkBrokerAtBoot({ env, waitMs: 0, log: () => {} });
  assert.deepEqual(r.fatal, []);
  assert.match(r.warnings.join(' '), /no GitHub slot.*every push will fail/);
  slots = [...slots, { id: 'github', auth: 'github-user', upstream: 'https://api.github.com' }];
  resetBrokerClient();
  const r2 = await checkBrokerAtBoot({ env, waitMs: 0, log: () => {} });
  assert.deepEqual(r2.warnings, []);
  } finally { process.env.HOME = savedHome; rmSync(home, { recursive: true, force: true }); }
});
