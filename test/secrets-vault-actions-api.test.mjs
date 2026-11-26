// test/secrets-vault-actions-api.test.mjs — Settings › General › Secret vault's routes, in process over the file-backed
// OS-store fake: the status carries the counts by kind (never a value or a name), and the actions (check, enable,
// reset) need a same-origin JSON request with a confirm. In a container every action answers 409 and the status is
// "not available" with no key store call.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { isVaultRef } from '../src/core/secrets/refs.mjs';
import { readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';

const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE', 'WORCA_TEST_STORE_TIMEOUT_MS', 'WORCA_CONTAINER'];
const KEY = 'sk-acme-vault-ui-0001';
let root, userHome, state, srv, base;
const prev = {};
const settingsFile = () => join(userHome, '.worca-cc', 'settings.json');

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'worca-vault-actions-'));
  for (const k of KEYS) prev[k] = process.env[k];
  userHome = join(root, 'home');
  const worca = userHome;   // the default Worca home owns settings.json (settings-vault.mjs ownsSettingsHome)
  mkdirSync(join(userHome, '.worca-cc'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify({ providers: { openai: { apiKey: KEY } } }, null, 2) + '\n', { mode: 0o600 });
  state = join(root, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  Object.assign(process.env, {
    HOME: userHome, USERPROFILE: userHome, WORCA_HOME: worca, WORCA_TEST_ALLOW_HOME_FALLBACK: '1',
    WORCA_TEST_OS_STORE: state, WORCA_TEST_STORE_TIMEOUT_MS: '300', WORCA_FLAGS: 'secretVault',
  });
  delete process.env.WORCA_PROJECTS_ROOT;
  delete process.env.WORCA_CONTAINER;
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

const status = async () => (await fetch(`${base}/api/secrets/status`)).json();
const post = (path, body, headers = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('status: counts by kind, never a value or a key name', async () => {
  const s = await status();
  assert.equal(s.state, 'ready');
  assert.equal(s.counts.files.settings, 1);
  assert.equal(s.counts.vault.settings, 0);
  const text = JSON.stringify(s);
  assert.ok(!text.includes(KEY) && !text.includes('openai'), text);
});

test('actions: a confirm, JSON and the same origin are required', async () => {
  assert.equal((await post('/api/secrets/enable', {})).status, 400, 'no confirm');
  const notJson = await fetch(`${base}/api/secrets/enable`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'confirm' });
  assert.equal(notJson.status, 415);
  assert.equal((await post('/api/secrets/enable', { confirm: true }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post('/api/secrets/reset', {})).status, 400);
  assert.equal(JSON.parse(readFileSync(settingsFile(), 'utf8')).providers.openai.apiKey, KEY, 'nothing moved');
});

test('Check now, then Turn on: the check passes, the key moves, the counts follow; Reset refuses a readable vault', async () => {
  const c = await (await post('/api/secrets/check', {})).json();
  assert.equal(c.ok, true);
  const r = await post('/api/secrets/enable', { confirm: true });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.moved, 1);
  assert.ok(isVaultRef(JSON.parse(readFileSync(settingsFile(), 'utf8')).providers.openai.apiKey));
  assert.equal(body.status.counts.vault.settings, 1);
  assert.equal(body.status.counts.files.settings, 0);
  const reset = await post('/api/secrets/reset', { confirm: true });
  assert.equal(reset.status, 409);
});

test('in a container: status says not available with no key store call, and every action answers 409', async () => {
  const before = readFakeCalls(state).length;
  process.env.WORCA_CONTAINER = '1';
  try {
    const s = await status();
    assert.equal(s.state, 'container');
    for (const p of ['/api/secrets/check', '/api/secrets/enable', '/api/secrets/reset']) {
      const r = await post(p, { confirm: true });
      assert.equal(r.status, 409, p);
      assert.equal((await r.json()).code, 'VAULT_CONTAINER');
    }
    assert.equal(readFakeCalls(state).length, before, 'the key store was not asked');
  } finally { delete process.env.WORCA_CONTAINER; }
});
