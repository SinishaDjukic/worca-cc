// test/settings-api.test.mjs
//
// SANDBOX: HOME/USERPROFILE point at a temp dir and WORCA_HOME and WORCA_PROJECTS_ROOT are
// removed, so the settings file is never the real ~/.worca-cc one; WORCA_TEST_ALLOW_HOME_FALLBACK
// lets the settings readers see that sandboxed file (same boot as
// test/settings-projects-root.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _resetForTests } from '../src/core/db.mjs';
import { checkRows } from './helpers/rows.mjs';

let home, srv, base, prev;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK',
    'WORCA_PROJECTS_ROOT']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  delete process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await rm(home, { recursive: true, force: true });
});

const post = (root) => fetch(`${base}/api/settings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root }),
});

test('POST sets the root; GET reflects it; empty resets it', async () => {
  const target = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-tgt-'));
  assert.equal((await (await post(target)).json()).root, target);
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).root, target);
  assert.equal((await (await post('')).json()).root, '');
  await rm(target, { recursive: true, force: true });
});

const postJson = (body) => fetch(`${base}/api/settings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('humanRateUsdPerHour: GET null by default, POST stores a positive number, empty clears, junk → 400', async () => {
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).humanRateUsdPerHour, null);
  assert.equal((await (await postJson({ humanRateUsdPerHour: 95 })).json()).humanRateUsdPerHour, 95);
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).humanRateUsdPerHour, 95);
  assert.equal((await postJson({ humanRateUsdPerHour: -1 })).status, 400);
  assert.equal((await (await postJson({ humanRateUsdPerHour: '' })).json()).humanRateUsdPerHour, null);
});

test('GET /api/settings: debugSpawnEffective is {false, settings} by default and {true, env} with WORCA_DEBUG_SPAWN=1 while the stored value stays false', async () => {
  await checkRows([
    { name: 'GET /api/settings: debugSpawnEnabled defaults to false, with the effective state and its source', run: async () => {
      const j = await (await fetch(`${base}/api/settings`)).json();
      assert.equal(j.debugSpawnEnabled, false);
      assert.deepEqual(j.debugSpawnEffective, { enabled: false, source: 'settings' });
    } },
    { name: 'GET /api/settings: a non-empty WORCA_DEBUG_SPAWN reports source "env" while the stored value stays false', run: async () => {
      const prev = process.env.WORCA_DEBUG_SPAWN;
      process.env.WORCA_DEBUG_SPAWN = '1';
      try {
        const j = await (await fetch(`${base}/api/settings`)).json();
        assert.equal(j.debugSpawnEnabled, false, 'stored');
        assert.deepEqual(j.debugSpawnEffective, { enabled: true, source: 'env' });
      } finally {
        if (prev === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prev;
      }
    } },
  ]);
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

test('a mixed POST whose root is unusable answers 400 with neither the debug toggle nor the theme applied', async () => {
  const filePath = fileURLToPath(import.meta.url); // a file, not a dir → setWorcaRoot throws
  const r = await postJson({ debugSpawnEnabled: true, theme: 'dark', root: filePath });
  const j = await (await fetch(`${base}/api/settings`)).json();
  await checkRows([
    { name: 'a mixed POST whose root is unusable answers 400 with the debug toggle NOT applied', run: () => {
      assert.equal(r.status, 400);
      assert.equal(j.debugSpawnEnabled, false, 'nothing half-applied');
    } },
    { name: 'a mixed POST whose root is unusable answers 400 with the theme NOT applied', run: () => {
      assert.equal(r.status, 400);
      assert.equal(j.theme, 'system', 'the theme write must come after the root write, which failed');
    } },
  ]);
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
      projectsRoot: '', chat: {}, pipelineCostLimitUsd: '', totalCostLimitUsd: '', costLimitResetPeriod: '', humanRateUsdPerHour: '',
      askMaxTurns: '', askMaxBudgetUsd: '', askWeb: null, debugSpawnEnabled: false,
      titleModel: '', hideBuiltinModels: false, theme: '', uiLevel: '',
      autoWorkflowModel: '',
      prDescriptionModel: '',
      memoryDefrag: null,
      workspaceScan: null,
      schedule: {},
      nightMode: {}, nightModeToggle: 'auto',
      sync: null,
      actions: {},
      runEngine: null, stepModels: {}, utilityModels: {},   // cascading settings (Plan 2a): null / {} change nothing
      askEngine: null, askModels: {},                        // Ask Worca's engine (Plan 2b, D17): null / {} change nothing
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

// The Settings ▸ About card reads these fields. They are derived from
// package.json at module load, so a release bump needs no code change; the
// assertion below is what stops anyone hardcoding a version string.
test('GET /api/settings carries app identity: version + a browsable repo URL', async () => {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  const j = await (await fetch(`${base}/api/settings`)).json();

  assert.ok(j.app && typeof j.app === 'object', 'GET carries an `app` block');
  assert.deepEqual(Object.keys(j.app).sort(), ['bugsUrl', 'releaseUrl', 'repoUrl', 'version'],
    'exactly the four About fields');
  assert.equal(j.app.version, pkg.version, 'straight from package.json — never a literal');
  // Derived, not hardcoded: this stays true if the repo is ever moved or renamed.
  assert.equal(j.app.repoUrl, pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
    'the npm git URL normalised to its browsable form');
  assert.match(j.app.repoUrl, /^https:\/\//, 'browsable, not a git:// or git+ URL');
  // The tag the release workflow publishes from (.github/workflows/release-npm-app.yml).
  assert.equal(j.app.releaseUrl, `${j.app.repoUrl}/releases/tag/worca-app-v${pkg.version}`,
    'version links to its worca-app-v<version> release tag');
});

test('POST { theme } stores the mode, answers the full shape, does not touch root; the default deletes the key', async () => {
  const target = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-themeroot-'));
  try {
    const first = await (await post(target)).json();   // not `before`: that name is the node:test hook imported above
    assert.equal(first.root, target);
    const after = await (await postJson({ theme: 'dark' })).json();
    assert.equal(after.theme, 'dark');
    assert.equal(after.root, target, 'a theme-only POST must not clear root');
    const refetched = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(refetched.theme, 'dark');
    const file = JSON.parse(readFileSync(join(home, '.worca-cc', 'settings.json'), 'utf8'));
    assert.equal(file.theme, 'dark');
    const back = await (await postJson({ theme: 'system' })).json();
    assert.equal(back.theme, 'system');
    assert.equal('theme' in JSON.parse(readFileSync(join(home, '.worca-cc', 'settings.json'), 'utf8')), false);
  } finally {
    await postJson({ theme: 'system' });
    await post('');
    await rm(target, { recursive: true, force: true });
  }
});

test('POST rejects an unknown theme → 400, nothing written', async () => {
  const r = await postJson({ theme: 'blue' });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /“Theme” must be system, light or dark/);
  assert.equal(body.field, 'theme');
  const j = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(j.theme, 'system');
});

test('GET has askWeb; POST askWeb validates, saves, and null clears', async () => {
  const get = async () => (await fetch(`${base}/api/settings`)).json();
  assert.deepEqual((await get()).askWeb, { enabled: false, anyHost: false, allowedDomains: [], search: null });
  const r = await postJson({ askWeb: { enabled: true, allowedDomains: ['docs.example.com'], search: null } });
  assert.equal(r.status, 200); assert.deepEqual((await r.json()).askWeb.allowedDomains, ['docs.example.com']);
  const bad = await postJson({ askWeb: { enabled: true, allowedDomains: ['nope'] } });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /not a host name/);
  assert.deepEqual((await (await postJson({ askWeb: null })).json()).askWeb, { enabled: false, anyHost: false, allowedDomains: [], search: null });
});

// #555: a POST /api/settings validation failure answers 400 { error, field }, where `field` is the
// body path of the bad input (the path a Settings input carries in data-setting) and `error`
// names the visible label, never an internal camelCase or dotted key.
const NO_KEY = /\b[a-z]+[A-Z][a-z]\w*\b|\b(?:askWeb|memoryDefrag|workspaceScan|nightMode|actions|sync|schedule|criteria|chat|search)\.\w+/;

// [bad body, expected field]
const cases = [
  [{ actions: { portLow: 5000, portHigh: 4000 } }, 'actions.portRange'],
  [{ actions: { portLow: 80 } }, 'actions.portLow'],
  [{ askMaxTurns: 0 }, 'askMaxTurns'],
  [{ askMaxBudgetUsd: 500 }, 'askMaxBudgetUsd'],
  [{ pipelineCostLimitUsd: -1 }, 'pipelineCostLimitUsd'],
  [{ schedule: { maxFailures: 101 } }, 'schedule.maxFailures'],
  [{ sync: { refreshMinutes: 9999 } }, 'sync.refreshMinutes'],
  [{ titleModel: 'nope-model' }, 'titleModel'],
  [{ projectsRoot: '/definitely/missing' }, 'projectsRoot'],
  [{ nightMode: { maxDecisions: 0 } }, 'nightMode.maxDecisions'],
];
test('POST /api/settings validation failures → 400 { error, field } with the body path and no internal key (table over 10 bodies)', async () => {
  await checkRows(cases.map(([body, field]) => ({
    name: `POST /api/settings ${JSON.stringify(body)} → 400, field ${field}, no internal key`,
    run: async () => {
      const r = await postJson(body);
      const j = await r.json();
      assert.equal(r.status, 400, JSON.stringify(j));
      assert.equal(j.field, field, JSON.stringify(j));
      assert.equal(typeof j.error, 'string');
      assert.doesNotMatch(j.error, NO_KEY);
    },
  })));
});
