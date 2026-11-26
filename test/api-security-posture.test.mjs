// test/api-security-posture.test.mjs — the server side of the security setups UI (#1619): GET /api/security/posture,
// GET /api/settings' `box` and the Local sandbox (Docker) settings, POST /api/settings' Docker fields, and the hardened
// box's clone-only Add project (POST /api/projects and /bulk refuse a folder there).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
let homeDir, srv, base;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, p, b) => {
  const r = await fetch(`${base}${p}`, { method, headers: JSONH, ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
  return { status: r.status, body: await r.json() };
};
const withBox = async (value, fn) => {
  const prev = process.env.WORCA_BOX;
  process.env.WORCA_BOX = value;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.WORCA_BOX; else process.env.WORCA_BOX = prev; }
};

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-posture-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'WORCA_BOX']) prevEnv[k] = process.env[k];
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  delete process.env.WORCA_BOX;
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/security/posture: the native rows, Local not sandboxed', async () => {
  const r = await call('GET', '/api/security/posture');
  assert.equal(r.status, 200);
  assert.equal(r.body.where, 'native');
  assert.deepEqual(r.body.rows.map((x) => x.id), ['where', 'broker', 'agents', 'network', 'proxy', 'exec-env']);
  assert.equal(r.body.execEnv.name, 'local');
  assert.equal(r.body.execEnv.sandboxed, false);
});

test('GET /api/security/posture follows the saved default and the hardened box', async () => {
  assert.equal((await call('POST', '/api/settings', { execEnv: 'docker' })).status, 200);
  try {
    const r = await call('GET', '/api/security/posture');
    assert.equal(r.body.execEnv.label, 'Local sandbox (Docker)');
    assert.equal(r.body.rows.find((x) => x.id === 'exec-env').status, 'on');
    await withBox('hardened', async () => { assert.equal((await call('GET', '/api/security/posture')).body.where, 'hardened'); });
  } finally { await call('POST', '/api/settings', { execEnv: null }); }
});

test('GET /api/settings carries the box and the Docker settings (unset: null)', async () => {
  const s = (await call('GET', '/api/settings')).body;
  assert.equal(s.box, 'native');
  assert.equal(s.dockerMaxSandboxes, null);
  assert.equal(s.dockerMaxWaitMin, null);
  assert.equal(s.dockerSandbox, null);
  await withBox('hardened', async () => { assert.equal((await call('GET', '/api/settings')).body.box, 'hardened'); });
});

test('POST /api/settings saves the Docker limits and container settings, refuses a bad one, and clears with null', async () => {
  const ok = await call('POST', '/api/settings', { dockerMaxSandboxes: 3, dockerMaxWaitMin: 60, dockerSandbox: { memory: '8g', cpus: 4, pids: null, runtime: 'runsc' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const s = (await call('GET', '/api/settings')).body;
  assert.equal(s.dockerMaxSandboxes, 3);
  assert.equal(s.dockerMaxWaitMin, 60);
  assert.deepEqual(s.dockerSandbox, { memory: '8g', cpus: 4, runtime: 'runsc' });
  const bad = await call('POST', '/api/settings', { dockerSandbox: { memory: '100m' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Memory per sandbox must be a size such as 4g, at least 512m/);
  assert.equal((await call('POST', '/api/settings', { dockerMaxSandboxes: 0 })).status, 400);
  assert.equal((await call('POST', '/api/settings', { dockerSandbox: { swap: '1g' } })).status, 400);
  assert.equal((await call('POST', '/api/settings', { dockerMaxSandboxes: null, dockerMaxWaitMin: null, dockerSandbox: null })).status, 200);
  const cleared = (await call('GET', '/api/settings')).body;
  assert.deepEqual([cleared.dockerMaxSandboxes, cleared.dockerMaxWaitMin, cleared.dockerSandbox], [null, null, null]);
});

test('the hardened box refuses a folder add (single and bulk); a native install still adds it', async () => {
  const repo = gitDir('acme-posture');
  await withBox('hardened', async () => {
    const one = await call('POST', '/api/projects', { name: 'acme', path: repo });
    assert.equal(one.status, 409);
    assert.equal(one.body.code, 'HARDENED_CLONE_ONLY');
    assert.match(one.body.error, /Clone from URL/);
    const bulk = await call('POST', '/api/projects/bulk', { projects: [{ name: 'acme', path: repo }] });
    assert.equal(bulk.status, 409);
    assert.equal(bulk.body.code, 'HARDENED_CLONE_ONLY');
  });
  const added = await call('POST', '/api/projects', { name: 'acme', path: repo });
  assert.equal(added.status, 200, JSON.stringify(added.body));
});
