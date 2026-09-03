// test/settings-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let home, srv, base, prev;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-'));
  prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME };
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME']) {
    if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
  }
  await rm(home, { recursive: true, force: true });
});

const post = (root) => fetch(`${base}/api/settings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }),
});

test('GET /api/settings returns root + default', async () => {
  const r = await fetch(`${base}/api/settings`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.root, '');        // nothing set yet
  assert.equal(j.default, home);   // default = sandboxed home
});

test('POST sets the root; GET reflects it; empty resets it', async () => {
  const target = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-tgt-'));
  assert.equal((await (await post(target)).json()).root, target);
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).root, target);
  assert.equal((await (await post('')).json()).root, '');
  await rm(target, { recursive: true, force: true });
});

test('POST rejects a file path -> 400', async () => {
  const filePath = fileURLToPath(import.meta.url); // this test file: a file, not a dir
  assert.equal((await post(filePath)).status, 400);
});

const postJson = (body) => fetch(`${base}/api/settings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('GET /api/settings: debugSpawnEnabled defaults to false, with the effective state and its source', async () => {
  const j = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(j.debugSpawnEnabled, false);
  assert.deepEqual(j.debugSpawnEffective, { enabled: false, source: 'settings' });
});

test('GET /api/settings: a non-empty WORCA_DEBUG_SPAWN reports source "env" while the stored value stays false', async () => {
  const prev = process.env.WORCA_DEBUG_SPAWN;
  process.env.WORCA_DEBUG_SPAWN = '1';
  try {
    const j = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(j.debugSpawnEnabled, false, 'stored');
    assert.deepEqual(j.debugSpawnEffective, { enabled: true, source: 'env' });
  } finally {
    if (prev === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prev;
  }
});

test('POST sets debugSpawnEnabled; GET reflects it; does not touch root', async () => {
  const target = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-dbgroot-'));
  try {
    const before = await (await post(target)).json();
    assert.equal(before.root, target); // sanity: root is genuinely non-empty going in
    const after = await (await postJson({ debugSpawnEnabled: true })).json();
    assert.equal(after.debugSpawnEnabled, true);
    assert.equal(after.root, target, 'a debug-spawn-only POST must not clear root');
    const refetched = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(refetched.debugSpawnEnabled, true);
    assert.equal(refetched.root, target);
  } finally {
    await postJson({ debugSpawnEnabled: false }); // leave it clean for other tests
    await post(''); // reset root
    await rm(target, { recursive: true, force: true });
  }
});

test('POST rejects a non-boolean debugSpawnEnabled -> 400', async () => {
  const r = await postJson({ debugSpawnEnabled: 'on' });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /must be true or false/);
});

test('POST does not write process.env (the runner reads the setting itself)', async () => {
  const prev = process.env.WORCA_DEBUG_SPAWN;
  delete process.env.WORCA_DEBUG_SPAWN;
  try {
    await postJson({ debugSpawnEnabled: true });
    assert.equal(process.env.WORCA_DEBUG_SPAWN, undefined);
    await postJson({ debugSpawnEnabled: false });
    assert.equal(process.env.WORCA_DEBUG_SPAWN, undefined);
  } finally {
    if (prev === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prev;
  }
});

test('a mixed POST whose root is unusable answers 400 with the debug toggle NOT applied', async () => {
  const filePath = fileURLToPath(import.meta.url); // a file, not a dir → setWorcaRoot throws
  const r = await postJson({ debugSpawnEnabled: true, root: filePath });
  assert.equal(r.status, 400);
  const j = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(j.debugSpawnEnabled, false, 'nothing half-applied');
});

test('every SETTINGS_POST_KEYS key is exempt from the legacy "no known key clears root" fallback', async () => {
  const { SETTINGS_POST_KEYS } = await import('../src/core/settings.mjs');
  assert.ok(SETTINGS_POST_KEYS.includes('debugSpawnEnabled'), 'the new key is registered beside its setter');
  const target = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-keys-'));
  try {
    assert.equal((await (await post(target)).json()).root, target);
    // A body carrying only a non-root known key must not clear root — one probe per
    // key, each with a value its setter accepts as "no change / default".
    const probes = {
      projectsRoot: '', chat: {}, pipelineCostLimitUsd: '', totalCostLimitUsd: '', costLimitResetPeriod: '',
      askMaxTurns: '', askMaxBudgetUsd: '', debugSpawnEnabled: false,
      titleModel: '', hideBuiltinModels: false,
    };
    for (const k of SETTINGS_POST_KEYS) {
      if (k === 'root') continue;
      assert.ok(k in probes, `test probe missing for new key ${k}`);
      const j = await (await postJson({ [k]: probes[k] })).json();
      assert.equal(j.root, target, `a ${k}-only POST must not clear root`);
    }
    assert.equal((await (await postJson({})).json()).root, '', 'the legacy contract itself still holds');
  } finally {
    await post('');
    await rm(target, { recursive: true, force: true });
  }
});

// The Settings ▸ About card reads these two fields. They are derived from
// package.json at module load, so a release bump needs no code change; the
// assertion below is what stops anyone hardcoding a version string.
test('GET /api/settings carries app identity: version + a browsable repo URL', async () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  const j = await (await fetch(`${base}/api/settings`)).json();

  assert.ok(j.app && typeof j.app === 'object', 'GET carries an `app` block');
  assert.deepEqual(Object.keys(j.app).sort(), ['repoUrl', 'version'], 'exactly the two About fields');
  assert.equal(j.app.version, pkg.version, 'straight from package.json — never a literal');
  // Derived, not hardcoded: this stays true if the repo is ever moved or renamed.
  assert.equal(j.app.repoUrl, pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
    'the npm git URL normalised to its browsable form');
  assert.match(j.app.repoUrl, /^https:\/\//, 'browsable, not a git:// or git+ URL');
});

test('POST /api/settings does NOT echo app identity (it is not a setting)', async () => {
  const posted = await (await post('')).json();       // resets root to '', as the suite already does above
  assert.equal(posted.app, undefined, 'app identity is GET-only; POST echoes settings state only');
  assert.equal(posted.root, '', 'the reset itself still works');
});
