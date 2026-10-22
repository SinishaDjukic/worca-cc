// test/api-app-update.test.mjs — the update routes (#841) against a fake registry on loopback
// (WORCA_UPDATE_REGISTRY), so nothing leaves the machine. The suite runs from a git checkout,
// so this server is a 'source' install: it reports a newer version but never installs one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let sandboxHome, srv, base, registry, registryHits = 0;
const prevEnv = {};
const JSONH = { 'Content-Type': 'application/json' };
const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: JSONH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

before(async () => {
  registry = http.createServer((req, res) => {
    registryHits += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ name: '@worca/app', 'dist-tags': { latest: '99.0.0', rc: '99.1.0-rc.1' }, versions: { '98.0.0': {}, '99.0.0': {}, '99.1.0-rc.1': {} } }));
  });
  await new Promise((r) => registry.listen(0, '127.0.0.1', r));
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-cc-appupdate-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK', 'WORCA_UPDATE_REGISTRY', 'WORCA_UPDATE_CHECK', 'WORCA_SELF_UPDATE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_UPDATE_REGISTRY = `http://127.0.0.1:${registry.address().port}`;
  delete process.env.WORCA_UPDATE_CHECK; delete process.env.WORCA_SELF_UPDATE;
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await Promise.race([new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }), new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); })]);
  await new Promise((r) => registry.close(r));
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(sandboxHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

test('GET /api/app/update before any check: the version, no registry call, who updates this copy', async () => {
  const { status, body } = await call('GET', '/api/app/update');
  assert.equal(status, 200);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(body.current, pkg.version);
  assert.equal(body.check.enabled, true);
  assert.equal(body.check.checkedAt, null);
  assert.equal(registryHits, 0, 'reading the status never calls the registry; a server that never bound never polls');
  assert.equal(body.installKind, 'source', 'the suite runs from a checkout');
  assert.equal(body.apply, 'managed');
  assert.equal(body.managedBy, 'source');
});

test('POST /api/app/update/check asks the configured registry and reports the newer version with notes', async () => {
  const { status, body } = await call('POST', '/api/app/update/check');
  assert.equal(status, 200);
  assert.equal(registryHits, 1);
  assert.equal(body.check.registry, process.env.WORCA_UPDATE_REGISTRY);
  assert.equal(body.latest, '99.0.0');
  assert.equal(body.updateAvailable, true);
  assert.ok(['99.0.0', '99.1.0-rc.1'].includes(body.target), 'stable follows latest; an RC build may follow rc');
  assert.ok(body.notes.releases.some((r) => r.version === '99.0.0' && /releases\/tag\/worca-app-v99\.0\.0$/.test(r.url)));
  assert.match(body.notes.compareUrl, /\/compare\/worca-app-v.+\.\.\.worca-app-v99/);
  assert.deepEqual(body.instructions.steps, ['git pull && npm install', 'worca ui restart']);
});

test('apply and restart are refused on a copy Worca does not own (here: a source checkout)', async () => {
  const apply = await call('POST', '/api/app/update/apply', { version: '99.0.0' });
  assert.equal(apply.status, 403);
  assert.equal(apply.body.code, 'MANAGED');
  const restart = await call('POST', '/api/app/update/restart');
  assert.equal(restart.status, 403);
});

test('Settings: updates.{check,auto} round-trip; WORCA_UPDATE_CHECK=0 wins over the stored choice', async () => {
  const bad = await call('POST', '/api/settings', { updates: { auto: 'yes' } });
  assert.equal(bad.status, 400);
  const off = await call('POST', '/api/settings', { updates: { check: false } });
  assert.equal(off.status, 200);
  assert.deepEqual(off.body.updates, { check: false, auto: false });
  const st = await call('GET', '/api/app/update');
  assert.equal(st.body.check.enabled, false);
  assert.equal(st.body.updateAvailable, false, 'checks off: no "newer version" claim from an old answer');
  const refused = await call('POST', '/api/app/update/check');
  assert.equal(refused.status, 409);
  await call('POST', '/api/settings', { updates: { check: true } });
  process.env.WORCA_UPDATE_CHECK = '0';
  try {
    const locked = await call('GET', '/api/app/update');
    assert.equal(locked.body.check.enabled, false);
    assert.equal(locked.body.check.lockedBy, 'env');
  } finally {
    delete process.env.WORCA_UPDATE_CHECK;
  }
});
