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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { _resetForTests } from '../src/core/db.mjs';
import { checkRows } from './helpers/rows.mjs';

let home, srv, base, prev, testing;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-setapi-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK',
    'WORCA_PROJECTS_ROOT']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  delete process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  const { app, _testing: t } = await import('../ui/server.mjs');
  testing = t;
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

test('resumeAfterUsageLimit / autoGeneratePrDescription: GET defaults to false, POST true round-trips, a non-boolean answers 400 naming the field', async () => {
  await checkRows([
    { name: 'GET /api/settings: autoGeneratePrDescription defaults to false', run: async () => {
      assert.equal((await (await fetch(`${base}/api/settings`)).json()).autoGeneratePrDescription, false);
    } },
    { name: 'POST autoGeneratePrDescription true round-trips through GET and back to false', run: async () => {
      try {
        assert.equal((await (await postJson({ autoGeneratePrDescription: true })).json()).autoGeneratePrDescription, true);
        assert.equal((await (await fetch(`${base}/api/settings`)).json()).autoGeneratePrDescription, true);
      } finally {
        assert.equal((await (await postJson({ autoGeneratePrDescription: false })).json()).autoGeneratePrDescription, false);
      }
    } },
    { name: 'POST autoGeneratePrDescription "yes" answers 400 naming the field', run: async () => {
      const r = await postJson({ autoGeneratePrDescription: 'yes' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).field, 'autoGeneratePrDescription');
    } },
    { name: 'GET /api/settings: resumeAfterUsageLimit defaults to false', run: async () => {
      assert.equal((await (await fetch(`${base}/api/settings`)).json()).resumeAfterUsageLimit, false);
    } },
    { name: 'POST resumeAfterUsageLimit true round-trips through GET and back to false', run: async () => {
      try {
        assert.equal((await (await postJson({ resumeAfterUsageLimit: true })).json()).resumeAfterUsageLimit, true);
        assert.equal((await (await fetch(`${base}/api/settings`)).json()).resumeAfterUsageLimit, true);
      } finally {
        assert.equal((await (await postJson({ resumeAfterUsageLimit: false })).json()).resumeAfterUsageLimit, false);
      }
    } },
    { name: 'POST resumeAfterUsageLimit "yes" answers 400 naming the field', run: async () => {
      const r = await postJson({ resumeAfterUsageLimit: 'yes' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).field, 'resumeAfterUsageLimit');
    } },
  ]);
});

test('updateCheck: GET defaults to true, POST false round-trips, a non-boolean answers 400 naming the field', async () => {
  await checkRows([
    { name: 'GET /api/settings: updateCheck defaults to true', run: async () => {
      assert.equal((await (await fetch(`${base}/api/settings`)).json()).updateCheck, true);
    } },
    { name: 'POST updateCheck false round-trips through GET and back to true', run: async () => {
      try {
        assert.equal((await (await postJson({ updateCheck: false })).json()).updateCheck, false);
        assert.equal((await (await fetch(`${base}/api/settings`)).json()).updateCheck, false);
      } finally {
        assert.equal((await (await postJson({ updateCheck: true })).json()).updateCheck, true);
      }
    } },
    { name: 'POST updateCheck "yes" answers 400 naming the field', run: async () => {
      const r = await postJson({ updateCheck: 'yes' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).field, 'updateCheck');
    } },
  ]);
});

test('keepAwake: GET defaults to true, POST false round-trips, a non-boolean answers 400 naming the field', async () => {
  await checkRows([
    { name: 'GET /api/settings: keepAwake defaults to true', run: async () => {
      assert.equal((await (await fetch(`${base}/api/settings`)).json()).keepAwake, true);
    } },
    { name: 'POST keepAwake false round-trips through GET and back to true', run: async () => {
      try {
        assert.equal((await (await postJson({ keepAwake: false })).json()).keepAwake, false);
        assert.equal((await (await fetch(`${base}/api/settings`)).json()).keepAwake, false);
      } finally {
        assert.equal((await (await postJson({ keepAwake: true })).json()).keepAwake, true);
      }
    } },
    { name: 'POST keepAwake "no" answers 400 naming the field', run: async () => {
      const r = await postJson({ keepAwake: 'no' });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).field, 'keepAwake');
    } },
  ]);
});

test('GET /api/app/version: unknown with no fetch under tests; a fake fetcher drives outdated + links; setting off = no fetch', async () => {
  const get = async () => (await fetch(`${base}/api/app/version`)).json();
  const pkgVersion = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version;
  // The test tree is itself a git checkout: pin "installed from npm" unless a row says otherwise.
  testing.setSourceBuild(false);
  await checkRows([
    { name: 'default fetcher under NODE_TEST_CONTEXT: unknown, no network', run: async () => {
      testing.setUpdateFetcher(null);
      const j = await get();
      assert.equal(j.status, 'unknown');
      assert.equal(j.current, pkgVersion);
      assert.equal(j.links.releaseNotes, 'https://docs.worca.dev/changelog/');
      assert.equal(j.links.whatsNew, '');
    } },
    { name: 'a newer latest reads outdated with What\'s new and compare links', run: async () => {
      let calls = 0;
      testing.setUpdateFetcher(async () => { calls++; return '99.0.0'; });
      const j = await get();
      assert.equal(j.status, 'outdated');
      assert.equal(j.latest, '99.0.0');
      assert.equal(j.links.whatsNew, 'https://docs.worca.dev/changelog/99.0.0/');
      assert.match(j.links.compare, new RegExp(`/compare/worca-app-v${pkgVersion.replace(/\./g, '\\.')}\\.\\.\\.worca-app-v99\\.0\\.0$`));
      await get();
      assert.equal(calls, 1, 'cached');
      const forced = await (await fetch(`${base}/api/app/version/check`, { method: 'POST' })).json();
      assert.equal(forced.status, 'outdated');
      assert.equal(calls, 1, 'Check now inside the minimum interval does not refetch');
    } },
    { name: 'updateCheck false: unknown, enabled false, fetcher never called', run: async () => {
      let calls = 0;
      testing.setUpdateFetcher(async () => { calls++; return '99.0.0'; });
      try {
        await postJson({ updateCheck: false });
        const j = await get();
        assert.equal(j.status, 'unknown');
        assert.equal(j.enabled, false);
        assert.equal(calls, 0);
      } finally { await postJson({ updateCheck: true }); testing.setUpdateFetcher(null); }
    } },
    { name: 'POST updateCheck false clears the cached answer: back on = a fresh fetch', run: async () => {
      let calls = 0;
      testing.setUpdateFetcher(async () => { calls++; return calls === 1 ? '99.0.0' : '0.0.1'; });   // not pkgVersion: an RC is never an npm latest, so it reads unknown
      try {
        assert.equal((await get()).status, 'outdated');
        await postJson({ updateCheck: false });
        await postJson({ updateCheck: true });
        assert.equal((await get()).status, 'ahead', 'the second answer, not the cached one');
        assert.equal(calls, 2);
      } finally { await postJson({ updateCheck: true }); testing.setUpdateFetcher(null); }
    } },
    { name: 'a source build: status source, no links, no fetch, Check now included', run: async () => {
      let calls = 0;
      testing.setUpdateFetcher(async () => { calls++; return '99.0.0'; });
      testing.setSourceBuild(true);
      try {
        for (const j of [await get(), await (await fetch(`${base}/api/app/version/check`, { method: 'POST' })).json()]) {
          assert.equal(j.status, 'source');
          assert.equal(j.latest, null);
          assert.equal(j.current, pkgVersion);
          assert.deepEqual(j.links, { releaseNotes: 'https://docs.worca.dev/changelog/', whatsNew: '', compare: '' });
        }
        assert.equal(calls, 0);
      } finally { testing.setSourceBuild(false); testing.setUpdateFetcher(null); }
    } },
    { name: 'the real detection on this checkout: source build, unless WORCA_UPDATE_CHECK_LATEST is set', run: async () => {
      const prevLatest = process.env.WORCA_UPDATE_CHECK_LATEST;
      testing.setSourceBuild(null);
      try {
        delete process.env.WORCA_UPDATE_CHECK_LATEST;
        assert.equal((await get()).status, 'source');
        process.env.WORCA_UPDATE_CHECK_LATEST = '99.1.0';
        const j = await get();
        assert.equal(j.status, 'outdated');
        assert.equal(j.latest, '99.1.0');
      } finally {
        if (prevLatest === undefined) delete process.env.WORCA_UPDATE_CHECK_LATEST; else process.env.WORCA_UPDATE_CHECK_LATEST = prevLatest;
        testing.setSourceBuild(false); testing.setUpdateFetcher(null);
      }
    } },
  ]);
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
      askMaxTurns: '', askMaxBudgetUsd: '', askWeb: null, smartNaming: null, debugSpawnEnabled: false, keepAwake: true, resumeAfterUsageLimit: false, autoGeneratePrDescription: false, updateCheck: true,
      titleModel: '', hideBuiltinModels: false, theme: '', uiLevel: '',
      autoWorkflowModel: '',
      prDescriptionModel: '',
      memoryDefrag: null,
      requirementsInterview: null,
      agentGenModel: null,
      namingModel: null,
      commandSummaryModel: null,
      workspaceScan: null,
      schedule: {},
      nightMode: {}, nightModeToggle: 'auto',
      sync: null,
      networkWait: null,
      actions: {},
      runEngine: null, stepModels: {}, utilityModels: {},   // cascading settings (Plan 2a): null / {} change nothing
      modelRoles: {},                                        // Models › Roles: {} changes nothing
      execEnv: null, e2bMaxSandboxes: null, e2bMaxWaitMin: null,   // the execution environment (docs/e2b.md): null clears
      askEngine: null, askModels: {},                        // Chat's engine (Plan 2b, D17): null / {} change nothing
      flags: {},                                             // feature flags (docs/feature-flags.md): {} is a no-op
      tagDimensions: [],                                     // Settings › Tags › Tag dimensions: [] clears (already clear)
      enforceTags: false,                                    // Settings › Tags › Require mandatory tags: false clears (already clear)
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

test('smartNaming: GET has defaults, POST saves a partial block, rejects a bad pattern, null clears', async () => {
  const get = async () => (await fetch(`${base}/api/settings`)).json();
  const g = (await get()).smartNaming;
  assert.equal(g.pattern, '{type}/{slug}'); assert.equal(g.trigger, 'debounce'); assert.equal(g.addRunId, false);
  assert.equal('model' in g, false, 'the model is a helper job of its own (namingModel)');
  const ok = await postJson({ smartNaming: { pattern: '{type}/{ticket}-{slug}', types: ['fix', 'feat'] } });
  assert.equal(ok.status, 200);
  const saved = (await get()).smartNaming;
  assert.equal(saved.pattern, '{type}/{ticket}-{slug}'); assert.deepEqual(saved.types, ['fix', 'feat']);
  const bad = await postJson({ smartNaming: { pattern: '{type}/no-slug' } });
  assert.equal(bad.status, 400);
  const body = await bad.json();
  assert.match(body.error, /\{slug\}/); assert.equal(body.field, 'smartNaming');
  assert.equal((await postJson({ smartNaming: { types: ['Bad Type'] } })).status, 400);
  assert.equal((await get()).smartNaming.pattern, '{type}/{ticket}-{slug}', 'a refused save writes nothing');
  assert.deepEqual((await (await postJson({ smartNaming: null })).json()).smartNaming.types, ['feat', 'fix', 'chore', 'docs', 'refactor', 'test']);
});

test('smartNaming: a leftover stored model is ignored on read and dropped on the next save; a posted one is ignored', async () => {
  const file = join(home, '.worca-cc', 'settings.json');
  const cur = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...cur, smartNaming: { model: { model: 'x' }, pattern: '{type}/{slug}-b' } }));
  const g = (await (await fetch(`${base}/api/settings`)).json()).smartNaming;
  assert.equal('model' in g, false); assert.equal(g.pattern, '{type}/{slug}-b');
  const r = await postJson({ smartNaming: { suggestTitle: false, model: { model: 'y' } } });
  assert.equal(r.status, 200);
  const stored = JSON.parse(readFileSync(file, 'utf8')).smartNaming;
  assert.deepEqual(stored, { pattern: '{type}/{slug}-b', suggestTitle: false });
  assert.equal((await postJson({ smartNaming: null })).status, 200);
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

test('POST tagDimensions: a bad entry is 400 with field tagDimensions; a valid list round-trips through GET', async () => {
  const bad = await postJson({ tagDimensions: [{ key: '', label: 'x' }] });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).field, 'tagDimensions');
  const ok = await postJson({ tagDimensions: [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }] });
  assert.equal(ok.status, 200);
  assert.deepEqual((await (await fetch(`${base}/api/settings`)).json()).tagDimensions, [{ key: 'cc', label: 'Cost centre', values: ['4410'], required: true }]);
  await postJson({ tagDimensions: [] });
  assert.deepEqual((await (await fetch(`${base}/api/settings`)).json()).tagDimensions, []);
});

test('POST enforceTags: a non-boolean is 400 with field enforceTags; true round-trips through GET', async () => {
  const bad = await postJson({ enforceTags: 'yes' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).field, 'enforceTags');
  const ok = await postJson({ enforceTags: true });
  assert.equal(ok.status, 200);
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).enforceTags, true);
  await postJson({ enforceTags: false });
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).enforceTags, false);
});

test('chat.summariseCommands defaults on, saves false, rejects a non-boolean (#911)', async () => {
  let s = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(s.chat.summariseCommands, true);
  let r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: { summariseCommands: false } }) });
  assert.equal(r.status, 200);
  s = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(s.chat.summariseCommands, false);
  r = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat: { summariseCommands: 'no' } }) });
  assert.equal(r.status, 400);
  // settingsErrorReply (src/core/settings-errors.mjs) answers { error, field }: the field is the body key validated.
  const body = await r.json();
  assert.equal(body.field, 'chat');
  assert.equal(typeof body.error, 'string');
});

test('POST modelRoles: a model outside the catalog or a bad effort is 400 and writes nothing; ids are stored canonical', async () => {
  const file = join(home, '.worca-cc', 'settings.json');
  const ok0 = await postJson({ enforceTags: false });   // the file exists before the byte comparison
  assert.equal(ok0.status, 200);
  const before = readFileSync(file);
  const unknown = await postJson({ modelRoles: { claude: { deep: { model: 'nope' } } } });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).field, /^modelRoles/);
  const effort = await postJson({ modelRoles: { claude: { deep: { model: 'claude-opus-5-5', effort: 'rm -rf' } } } });
  assert.equal(effort.status, 400);
  assert.equal((await effort.json()).field, 'modelRoles.claude.deep.effort');
  assert.deepEqual(readFileSync(file), before, 'a refused POST leaves settings.json byte-identical');
  const canon = await postJson({ modelRoles: { claude: { deep: { model: 'Claude-Opus-5-5' } } } });
  assert.equal(canon.status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).modelRoles, { claude: { deep: { model: 'claude-opus-5-5' } } });
  assert.equal((await postJson({ modelRoles: { claude: { deep: null } } })).status, 200);
  assert.equal('modelRoles' in JSON.parse(readFileSync(file, 'utf8')), false);
});

const getApi = async () => (await fetch(`${base}/api/settings`)).json();
test('execution environment: GET has the raw values, POST saves and echoes them, null clears, bad values are 400', async () => {
  const g0 = await getApi();
  assert.deepEqual([g0.execEnv, g0.e2bMaxSandboxes, g0.e2bMaxWaitMin], [null, null, null], 'unset: the UI shows the defaults as placeholders');
  const r = await postJson({ execEnv: 'e2b', e2bMaxSandboxes: 2, e2bMaxWaitMin: 30 });
  assert.equal(r.status, 200);
  const g1 = await getApi();
  assert.deepEqual([g1.execEnv, g1.e2bMaxSandboxes, g1.e2bMaxWaitMin], ['e2b', 2, 30]);
  for (const [body, field] of [[{ execEnv: 'docker' }, 'execEnv'], [{ e2bMaxSandboxes: 0 }, 'e2bMaxSandboxes'], [{ e2bMaxWaitMin: 2 }, 'e2bMaxWaitMin']]) {
    const bad = await postJson(body);
    const j = await bad.json();
    assert.equal(bad.status, 400, JSON.stringify(j));
    assert.equal(j.field, field, JSON.stringify(j));
  }
  await (await postJson({ execEnv: null, e2bMaxSandboxes: null, e2bMaxWaitMin: null })).json();
  const g2 = await getApi();
  assert.deepEqual([g2.execEnv, g2.e2bMaxSandboxes, g2.e2bMaxWaitMin], [null, null, null]);
});
