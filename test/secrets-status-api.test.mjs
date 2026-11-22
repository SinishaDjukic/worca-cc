// test/secrets-status-api.test.mjs — GET /api/secrets/status, the startup probe and the refresh on a settings save,
// in process over the file-backed OS-store fake with a 300 ms store time limit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { readServerSource } from '../src/core/read-server-source.mjs';
import { VAULT_NAME_PREFIX } from '../src/core/secrets/files.mjs';
import { osItemName } from '../src/core/secrets/os-store.mjs';
import { createVault } from '../src/core/secrets/vault.mjs';
import { fileFakeOsStore, peekKey, readFakeCalls, writeFakeState } from './helpers/os-store-fake.mjs';

const KEYS = ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_FLAGS', 'WORCA_TEST_OS_STORE', 'WORCA_TEST_STORE_TIMEOUT_MS'];
const CANARY = 'CANARY-probe-text-a81c';
let root, home, state, item, srv, base, routes;
const prev = {};

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'worca-secrets-api-'));
  for (const k of KEYS) prev[k] = process.env[k];
  const worca = join(root, 'worca');
  home = join(worca, '.worca-cc');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, 'home'), { recursive: true });
  state = join(root, 'fake', 'state.json');
  writeFakeState(state, { state: 'available' });
  item = osItemName(home);
  Object.assign(process.env, {
    HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), WORCA_HOME: worca, WORCA_TEST_ALLOW_HOME_FALLBACK: '1',
    WORCA_TEST_OS_STORE: state, WORCA_TEST_STORE_TIMEOUT_MS: '300', WORCA_FLAGS: '-secretVault',
  });
  delete process.env.WORCA_PROJECTS_ROOT;
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  routes = await import('../ui/routes/settings/secrets.mjs');
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

const get = () => fetch(`${base}/api/secrets/status`);
const postSettings = () => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: { summariseCommands: false } }) });
const vaultEntries = () => Object.fromEntries(readdirSync(home).filter((f) => f.startsWith(VAULT_NAME_PREFIX)).map((f) => [f, readFileSync(join(home, f), 'hex')]));
const until = async (cond, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('flag off: 404, and the startup probe and a settings save make no probe and no store call', async () => {
  const r = await get();
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'not found' });
  let probes = 0;
  const logs = [];
  assert.equal(routes.startSecretsProbe({ log: (m) => logs.push(m), probe: () => { probes++; return {}; } }), undefined);
  assert.equal(routes.refreshSecretsStatus(), undefined);
  assert.equal((await postSettings()).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(probes, 0);
  assert.deepEqual(logs, []);
  assert.deepEqual(readFakeCalls(state), []);
});

test('flag on and available: 200 ready; the GET and the probe write nothing', async () => {
  process.env.WORCA_FLAGS = 'secretVault';
  await createVault({ home, store: fileFakeOsStore(state, { item }) }).put({ store: 'settings', field: 'f', value: CANARY });
  const entries = vaultEntries();
  const key = peekKey(state, item);
  const setKeys = () => readFakeCalls(state).filter((c) => c.op === 'setKey').length;
  const calls = setKeys();
  const r = await get();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual([body.backend, body.label, body.state, body.vault, body.reason], ['fake', 'test store', 'ready', 'readable', null]);
  const logs = [];
  routes.startSecretsProbe({ log: (m) => logs.push(m) });
  await until(() => logs.length === 1);
  assert.deepEqual(logs, ['[worca-ui] secrets: test store (ready)']);
  assert.equal(setKeys(), calls);
  assert.ok(peekKey(state, item).equals(key));
  assert.deepEqual(vaultEntries(), entries);
  assert.ok(!JSON.stringify(body).includes(CANARY));
});

test('a never-answering store: the probe returns before it logs, settles on locked within 1500 ms; then ready', async () => {
  process.env.WORCA_FLAGS = 'secretVault';
  writeFakeState(state, { state: 'never-answers', items: { [item.account]: peekKey(state, item) } });
  const logs = [];
  const t0 = Date.now();
  assert.equal(routes.startSecretsProbe({ log: (m) => logs.push(m) }), undefined);
  assert.equal(logs.length, 0);
  await until(() => logs.length === 1, 1500);
  assert.ok(Date.now() - t0 < 1500);
  assert.deepEqual(logs, ['[worca-ui] secrets: test store (locked)']);
  writeFakeState(state, { state: 'available', items: { [item.account]: peekKey(state, item) } });
  const r = await get();
  assert.equal((await r.json()).state, 'ready');
});

test('a settings save with the flag on leads to 1 more probe', async () => {
  process.env.WORCA_FLAGS = 'secretVault';
  let probes = 0;
  routes.startSecretsProbe({ log: () => {}, probe: async () => { probes++; return { label: 'x', state: 'ready' }; } });
  await until(() => probes === 1);
  assert.equal((await postSettings()).status, 200);
  await until(() => probes === 2);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(probes, 2);
});

test('a throwing probe: the log line holds no canary, the GET answers 200 unavailable, the server keeps answering', async () => {
  process.env.WORCA_FLAGS = 'secretVault';
  const logs = [];
  routes.startSecretsProbe({ log: (m) => logs.push(m), probe: () => { throw new Error(CANARY); } });
  await until(() => logs.length === 1);
  assert.ok(!logs[0].includes(CANARY));
  assert.match(logs[0], /^\[worca-ui\] secrets: .+ \(unavailable\)$/);
  assert.equal((await postSettings()).status, 200);
  const r = await get();
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.state, 'unavailable');
  assert.ok(!JSON.stringify(body).includes(CANARY));
  assert.equal((await fetch(`${base}/api/settings`)).status, 200);
});

test('ui/server.mjs never awaits the startup probe', () => {
  const src = readServerSource();
  assert.ok(src.includes('startSecretsProbe({'));
  assert.ok(!/await\s+startSecretsProbe/.test(src));
});

// ---- the moved-secrets notice (GET /api/secrets/notice, POST /api/secrets/notice/ack) ----

const { recordMoveNotice, readNotice } = await import('../src/core/secrets/notice.mjs');
const { spawn } = await import('node:child_process');
const { fileURLToPath } = await import('node:url');
const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const noticeGet = () => fetch(`${base}/api/secrets/notice`);
const noticeAck = (body, headers = {}) => fetch(`${base}/api/secrets/notice/ack`, { method: 'POST',
  headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const record = () => recordMoveNotice({ home, backend: 'fake', label: 'test store', keys: [{ store: 'settings', name: 'Provider key: openai' }] });
function cli(args) {
  return new Promise((res) => {
    const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8', WORCA_FLAGS: 'secretVault' };
    delete env.WORCA_HOST_PID;
    const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (b) => (stdout += b));
    c.stderr.on('data', (b) => (stderr += b));
    c.on('exit', (code) => res({ code, stdout, stderr }));
  });
}

test('notice routes: 404 with the flag off; GET and POST /api/secrets/export are 404 with the flag on', async () => {
  process.env.WORCA_FLAGS = '-secretVault';
  assert.equal((await noticeGet()).status, 404);
  assert.equal((await noticeAck({ id: 'a'.repeat(16) })).status, 404);
  process.env.WORCA_FLAGS = 'secretVault';
  assert.equal((await fetch(`${base}/api/secrets/export`)).status, 404);
  assert.equal((await fetch(`${base}/api/secrets/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
});

test('notice routes: names only, 400 on a bad body, a foreign origin and an agent are refused, compare-and-delete', async () => {
  process.env.WORCA_FLAGS = 'secretVault';
  assert.deepEqual(await (await noticeGet()).json(), { notice: null });
  const n = record();
  const body = await (await noticeGet()).json();
  assert.deepEqual(body, { notice: { id: n.id, at: n.at, label: 'test store', keys: [{ store: 'settings', name: 'Provider key: openai' }], left: 0 } });
  for (const bad of [{}, { id: 7 }, { id: 'nope' }]) {
    const r = await noticeAck(bad);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'send the notice id' });
  }
  assert.equal((await noticeAck({ id: n.id }, { origin: 'http://evil.example' })).status, 403);
  const keep = { WORCA_AGENT_USER: process.env.WORCA_AGENT_USER, WORCA_AGENT_HOME: process.env.WORCA_AGENT_HOME };
  Object.assign(process.env, { WORCA_AGENT_USER: 'worca-agent', WORCA_AGENT_HOME: '/data/agent-home' });
  try {
    assert.equal((await noticeAck({ id: n.id })).status, 403, 'a possible agent is refused');
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.ok(readNotice({ home }), 'the refusals cleared nothing');
  assert.deepEqual(await (await noticeAck({ id: 'b'.repeat(16) })).json(), { ok: true, cleared: false }, 'a stale id clears nothing');
  assert.deepEqual(await (await noticeAck({ id: n.id })).json(), { ok: true, cleared: true });
  assert.deepEqual(await (await noticeGet()).json(), { notice: null });
});

test('notice routes: a failing read answers a fixed 500 and the server keeps answering', async () => {
  process.env.WORCA_FLAGS = 'secretVault';
  const keep = { WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  // worcaHome() throws under the test runner with neither a WORCA_HOME nor the fallback opt-in.
  delete process.env.WORCA_HOME;
  delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  try {
    const r = await noticeGet();
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'The message about moved secrets could not be read.' });
  } finally { Object.assign(process.env, keep); }
  assert.equal((await noticeGet()).status, 200);
});

test('cross-surface: a CLI ack clears the API notice, and an API ack stops the CLI print', async () => {
  process.env.WORCA_FLAGS = 'secretVault';
  writeFakeState(state, { state: 'available', items: { [item.account]: peekKey(state, item) } });
  record();
  const shown = await cli(['models', 'list']);
  assert.equal(shown.code, 0, shown.stderr);
  assert.match(shown.stderr, /These keys are now in the vault:\n {2}- Provider key: openai\n/, 'positive control: the CLI prints it');
  const acked = await cli(['secrets', 'ack']);
  assert.equal(acked.code, 0, acked.stderr);
  assert.deepEqual(await (await noticeGet()).json(), { notice: null });
  const n = record();
  assert.deepEqual(await (await noticeAck({ id: n.id })).json(), { ok: true, cleared: true });
  const quiet = await cli(['models', 'list']);
  assert.equal(quiet.code, 0, quiet.stderr);
  assert.ok(!quiet.stderr.includes('These keys are now in the vault'));
});
