// test/settings-projects-root.test.mjs
// Phase 2 (§5.1 + the five-key settings table): the `projectsRoot` accessors, the
// three scalar context/skill keys, and the guarantee that every write to any one
// of them preserves the others (readSettings is a read-modify-write over a plain
// object, so unknown keys must survive in BOTH directions — a `projectsRoot`
// write must not disturb `root`, and vice versa).
//
// The `runRootMode` READER's own precedence tests live in test/run-root-layout.mjs
// (Phase 1); what is pinned here is only that the settings *key* round-trips
// through settings.json and feeds runRootMode() alongside the new keys.
//
// SANDBOX: settingsFile() and defaultRoot() both derive from HOME/USERPROFILE, so
// the whole file runs with those pointed at a temp dir and WORCA_HOME removed
// (the settings tier is otherwise never consulted). WORCA_TEST_ALLOW_HOME_FALLBACK
// opts out of the worcaHome() test-runner guard, which is safe precisely because
// HOME is sandboxed — the fallback cannot reach the real ~/.worca-cc.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  defaultRoot, settingsFile, readSettings,
  getWorcaRoot, setWorcaRoot,
  getProjectsRoot, setProjectsRoot, rawProjectsRoot, defaultProjectsRoot,
  contextMaxBytesPerFile, setContextMaxBytesPerFile,
  contextMaxBytesTotal, setContextMaxBytesTotal,
  skillMount, setSkillMount,
  runRootMode,
  DEFAULT_CONTEXT_MAX_BYTES_PER_FILE, DEFAULT_CONTEXT_MAX_BYTES_TOTAL, DEFAULT_SKILL_MOUNT,
} from '../src/core/settings.mjs';
import { _resetForTests } from '../src/core/db.mjs';

let home, srv, apiBase;
const prev = {};
const scratch = [];

/** A throwaway directory (registered for cleanup). */
async function tmp(prefix = 'worca-cc-pr-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** Overwrite settings.json wholesale (the hand-edited-file path). */
async function writeSettingsFile(obj) {
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(settingsFile(), JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

const readSettingsFile = async () => JSON.parse(await readFile(settingsFile(), 'utf8'));

/** Run `fn` with WORCA_PROJECTS_ROOT pinned (or removed), restoring after. */
async function withEnv(value, fn) {
  const prevValue = process.env.WORCA_PROJECTS_ROOT;
  if (value === undefined) delete process.env.WORCA_PROJECTS_ROOT;
  else process.env.WORCA_PROJECTS_ROOT = value;
  try { return await fn(); }
  finally {
    if (prevValue === undefined) delete process.env.WORCA_PROJECTS_ROOT;
    else process.env.WORCA_PROJECTS_ROOT = prevValue;
  }
}

/** Capture console.warn for the duration of `fn`. */
async function withWarnings(fn) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  try { await fn(warnings); } finally { console.warn = orig; }
}

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-projroot-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK',
    'WORCA_PROJECTS_ROOT']) prev[k] = process.env[k];
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.WORCA_HOME;
  delete process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${srv.address().port}`;
});

beforeEach(() => writeSettingsFile({}));   // every test starts from an empty file

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  _resetForTests();
  await rm(home, { recursive: true, force: true });
  await Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true })));
});

// ── getProjectsRoot: precedence env → settings → default ─────────────────────

test('getProjectsRoot: no env, no settings -> defaultRoot(), always absolute, never ""', async () => {
  await withEnv(undefined, () => {
    const r = getProjectsRoot();
    assert.equal(r, defaultRoot());
    assert.equal(r, home);
    assert.ok(isAbsolute(r), `must be absolute: ${r}`);
    assert.notEqual(r, '', 'unlike getWorcaRoot(), this reader never returns ""');
  });
});

test('getProjectsRoot: settings.projectsRoot beats the default', async () => {
  const target = await tmp('worca-cc-pr-set-');
  await withEnv(undefined, async () => {
    await setProjectsRoot(target);
    assert.equal(getProjectsRoot(), target);
    assert.equal((await readSettingsFile()).projectsRoot, target, 'persisted absolute');
  });
});

test('getProjectsRoot: WORCA_PROJECTS_ROOT env beats settings.projectsRoot', async () => {
  const settingsTarget = await tmp('worca-cc-pr-s-');
  const envTarget = await tmp('worca-cc-pr-e-');
  await setProjectsRoot(settingsTarget);
  await withEnv(envTarget, () => {
    assert.equal(getProjectsRoot(), envTarget, 'env wins');
  });
  await withEnv('   ', () => {
    assert.equal(getProjectsRoot(), settingsTarget, 'a blank env value is ignored');
  });
});

test('getProjectsRoot: the env tier is NOT dir-validated — a missing path passes through', async () => {
  const missing = join(home, 'no', 'such', 'folder');
  await withEnv(missing, () => {
    // §5.1 missing-path tolerance: read time never throws; the degradation
    // (root layer contributes nothing + one named warning) is Phase 3's job.
    assert.equal(getProjectsRoot(), missing);
  });
});

test('getProjectsRoot: `~` expands in the env tier AND in a hand-written settings value', async () => {
  await mkdir(join(home, 'code'), { recursive: true });
  await withEnv('~/code', () => {
    assert.equal(getProjectsRoot(), join(home, 'code'), 'env ~ expanded');
  });
  await writeSettingsFile({ projectsRoot: '~/code' });
  await withEnv(undefined, () => {
    assert.equal(getProjectsRoot(), join(home, 'code'), 'settings ~ expanded at read time');
  });
  // The SETTER expands + resolves before persisting, so the stored value is absolute.
  await setProjectsRoot('~/code');
  assert.equal((await readSettingsFile()).projectsRoot, join(home, 'code'));
});

test('getProjectsRoot: a blank / non-string settings value falls back to the default', async () => {
  await withEnv(undefined, async () => {
    for (const bad of ['', '   ', 42, null, {}, []]) {
      await writeSettingsFile({ projectsRoot: bad });
      assert.equal(getProjectsRoot(), defaultRoot(), `bad value ${JSON.stringify(bad)} -> default`);
    }
  });
});

test('getProjectsRoot: a corrupt settings.json still yields the default (never throws)', async () => {
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(settingsFile(), '{ not json', 'utf8');
  await withEnv(undefined, () => {
    assert.equal(getProjectsRoot(), defaultRoot());
  });
});

// ── rawProjectsRoot / defaultProjectsRoot: the UI's raw view ─────────────────
// getProjectsRoot() answers "what does a RUN use"; these two answer "what is
// stored" and "what applies if it is cleared" — the settings field's value and
// placeholder. Keeping them apart is what makes a blank field representable.

test('rawProjectsRoot: "" when unset, the persisted value when set, and BLIND to the env', async () => {
  const settingsTarget = await tmp('worca-cc-pr-raw-s-');
  const envTarget = await tmp('worca-cc-pr-raw-e-');

  await withEnv(undefined, () => {
    assert.equal(rawProjectsRoot(), '', 'unset reads as "" — exactly like getWorcaRoot()');
    assert.notEqual(rawProjectsRoot(), getProjectsRoot(), 'raw "" vs effective defaultRoot()');
  });
  // The env override must NOT show up as a stored value: were it echoed into the
  // settings field, the next Save would persist it and outlive the env var.
  await withEnv(envTarget, () => {
    assert.equal(rawProjectsRoot(), '', 'an env override is not a setting');
    assert.equal(getProjectsRoot(), envTarget, 'the run still resolves to the env value');
  });

  await setProjectsRoot(settingsTarget);
  await withEnv(undefined, () => assert.equal(rawProjectsRoot(), settingsTarget));
  await withEnv(envTarget, () => {
    assert.equal(rawProjectsRoot(), settingsTarget, 'the field shows what is stored, not the override');
    assert.equal(getProjectsRoot(), envTarget);
  });

  // Same never-throwing tolerance as every other reader in this module.
  for (const bad of ['', '   ', 42, null, {}, []]) {
    await writeSettingsFile({ projectsRoot: bad });
    await withEnv(undefined, () => assert.equal(rawProjectsRoot(), '', `bad value ${JSON.stringify(bad)} -> ""`));
  }
  await writeSettingsFile({ projectsRoot: '~/code' });
  await mkdir(join(home, 'code'), { recursive: true });
  await withEnv(undefined, () => assert.equal(rawProjectsRoot(), join(home, 'code'), '`~` expanded like getProjectsRoot()'));
});

test('defaultProjectsRoot: the blank-field fallback — env tier when exported, else defaultRoot()', async () => {
  const envTarget = await tmp('worca-cc-pr-def-e-');
  const settingsTarget = await tmp('worca-cc-pr-def-s-');
  await withEnv(undefined, () => assert.equal(defaultProjectsRoot(), defaultRoot()));
  await withEnv(envTarget, () => assert.equal(defaultProjectsRoot(), envTarget,
    'with the env exported, clearing the field yields the env path — not the home folder'));
  await withEnv('~/code', () => assert.equal(defaultProjectsRoot(), join(home, 'code'), '`~` expanded'));
  await withEnv('   ', () => assert.equal(defaultProjectsRoot(), defaultRoot(), 'a blank env value is ignored'));
  // A persisted value never changes what "blank" would fall back to.
  await setProjectsRoot(settingsTarget);
  await withEnv(undefined, () => assert.equal(defaultProjectsRoot(), defaultRoot()));
});

// ── setProjectsRoot: validation + reset ──────────────────────────────────────

test('setProjectsRoot: "" (and null / non-string) deletes the key -> back to the default', async () => {
  const target = await tmp('worca-cc-pr-reset-');
  await withEnv(undefined, async () => {
    assert.equal((await setProjectsRoot(target)).projectsRoot, target, 'a set reports back what was stored');
    assert.equal(getProjectsRoot(), target);
    const res = await setProjectsRoot('');
    assert.equal(res.projectsRoot, '', 'the setter reports the RAW state, so a reset round-trips as blank');
    assert.equal(res.default, defaultRoot(), 'and names what now applies');
    assert.equal(getProjectsRoot(), defaultRoot());
    assert.equal('projectsRoot' in (await readSettingsFile()), false, 'the key is DELETED, not blanked');

    await setProjectsRoot(target);
    await setProjectsRoot(null);
    assert.equal('projectsRoot' in (await readSettingsFile()), false, 'null resets too');
  });
});

test('setProjectsRoot: rejects a file path and a nonexistent path; nothing is persisted', async () => {
  const filePath = fileURLToPath(import.meta.url);      // a file, not a directory
  await assert.rejects(() => setProjectsRoot(filePath), /not a directory/);
  await assert.rejects(() => setProjectsRoot(join(home, 'ghost-dir')), /does not exist|not a directory/);
  assert.equal('projectsRoot' in (await readSettingsFile()), false, 'a rejected write persists nothing');
  // And it must never create anything at the rejected path (worca-cc owns no data
  // under projectsRoot — unlike setWorcaRoot, which pre-creates <base>/.worca-cc).
  assert.equal((await readSettingsFile()).root, undefined);
});

// ── unknown-key preservation, BOTH directions ────────────────────────────────

test('unknown-key preservation: `root` survives a projectsRoot write and vice versa', async () => {
  const rootTarget = await tmp('worca-cc-pr-root-');
  const projTarget = await tmp('worca-cc-pr-proj-');

  // root first, then projectsRoot.
  await setWorcaRoot(rootTarget);
  await setProjectsRoot(projTarget);
  assert.equal(getWorcaRoot(), rootTarget, 'root survived the projectsRoot write');
  await withEnv(undefined, () => assert.equal(getProjectsRoot(), projTarget));

  // The reverse order, from a clean file.
  await writeSettingsFile({});
  await setProjectsRoot(projTarget);
  await setWorcaRoot(rootTarget);
  await withEnv(undefined, () => assert.equal(getProjectsRoot(), projTarget,
    'projectsRoot survived the root write'));
  assert.equal(getWorcaRoot(), rootTarget);

  // A reset of one key leaves the other intact.
  await setProjectsRoot('');
  assert.equal(getWorcaRoot(), rootTarget, 'clearing projectsRoot does not clear root');
  await setProjectsRoot(projTarget);
  await setWorcaRoot('');
  await withEnv(undefined, () => assert.equal(getProjectsRoot(), projTarget,
    'clearing root does not clear projectsRoot'));
});

test('unknown-key preservation: a foreign key written by a future version survives every setter', async () => {
  const target = await tmp('worca-cc-pr-foreign-');
  await writeSettingsFile({ someFutureKey: { deep: [1, 2] }, root: '/kept/root' });
  await setProjectsRoot(target);
  await setContextMaxBytesPerFile(4096);
  await setContextMaxBytesTotal(8192);
  await setSkillMount('symlink');
  const s = await readSettingsFile();
  assert.deepEqual(s.someFutureKey, { deep: [1, 2] }, 'no migration, no key loss');
  assert.equal(s.root, '/kept/root');
  assert.equal(s.projectsRoot, target);
  assert.equal(s.contextMaxBytesPerFile, 4096);
  assert.equal(s.contextMaxBytesTotal, 8192);
  assert.equal(s.skillMount, 'symlink');
});

// ── /api/settings round-trip ─────────────────────────────────────────────────

const getApi = () => fetch(`${apiBase}/api/settings`).then((r) => r.json());
const postApi = (body) => fetch(`${apiBase}/api/settings`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('GET /api/settings returns {root, projectsRoot, projectsRootDefault, default} + the budget keys', async () => {
  await withEnv(undefined, async () => {
    const j = await getApi();
    assert.deepEqual(Object.keys(j).sort(), ['chat', 'costLimitResetPeriod', 'default', 'pipelineCostLimitUsd',
      'projectsRoot', 'projectsRootDefault', 'root', 'totalCostLimitUsd']);
    assert.equal(j.root, '', 'nothing set yet');
    assert.equal(j.projectsRoot, '', 'the RAW setting — "" when unset, exactly like root');
    assert.equal(j.projectsRootDefault, defaultRoot(), 'what applies while it is blank');
    assert.equal(j.default, home);
    assert.equal(j.pipelineCostLimitUsd, null, 'no cap set -> unlimited');
    assert.equal(j.totalCostLimitUsd, null, 'no cap set -> unlimited');
    assert.equal(j.costLimitResetPeriod, 'monthly', 'the default window');
  });
});

test('GET /api/settings: with WORCA_PROJECTS_ROOT exported and no persisted key, projectsRoot stays ""', async () => {
  const envTarget = await tmp('worca-cc-pr-api-env-');
  await withEnv(envTarget, async () => {
    const j = await getApi();
    assert.equal(j.projectsRoot, '', 'the env override is NOT reported as a stored setting');
    assert.equal(j.projectsRootDefault, envTarget, 'it is reported as the blank-field fallback instead');
    assert.equal(getProjectsRoot(), envTarget, 'runs still resolve to it');

    // The whole point: saving the settings form (blank field) must not promote
    // the env value into settings.json, where it would outlive the env var.
    const saved = await (await postApi({ root: '', projectsRoot: j.projectsRoot })).json();
    assert.equal(saved.projectsRoot, '', 'a blank save round-trips as blank');
    assert.equal('projectsRoot' in (await readSettingsFile()), false, 'no silent env promotion');
  });
});

test('POST /api/settings: projectsRoot round-trips and does NOT clobber root', async () => {
  const rootTarget = await tmp('worca-cc-pr-api-root-');
  const projTarget = await tmp('worca-cc-pr-api-proj-');
  await withEnv(undefined, async () => {
    assert.equal((await (await postApi({ root: rootTarget })).json()).root, rootTarget);

    const posted = await (await postApi({ projectsRoot: projTarget })).json();
    assert.equal(posted.projectsRoot, projTarget);
    assert.equal(posted.root, rootTarget, 'a projectsRoot-only POST must not reset root');

    const got = await getApi();
    assert.equal(got.projectsRoot, projTarget);
    assert.equal(got.root, rootTarget);

    // An explicit empty value resets it; root still untouched.
    const reset = await (await postApi({ projectsRoot: '' })).json();
    assert.equal(reset.projectsRoot, '', 'a reset reports blank, not the default it fell back to');
    assert.equal(reset.projectsRootDefault, defaultRoot(), 'the fallback is named separately');
    assert.equal(reset.root, rootTarget, 'the reset did not touch root either');
  });
});

test('POST /api/settings: a root-only POST does NOT clobber projectsRoot', async () => {
  const rootTarget = await tmp('worca-cc-pr-api-r2-');
  const projTarget = await tmp('worca-cc-pr-api-p2-');
  await withEnv(undefined, async () => {
    await postApi({ projectsRoot: projTarget });
    const j = await (await postApi({ root: rootTarget })).json();
    assert.equal(j.root, rootTarget);
    assert.equal(j.projectsRoot, projTarget, 'projectsRoot survived a root write through the API');
  });
});

test('POST /api/settings: an unusable projectsRoot is a 400, and the old value stands', async () => {
  const projTarget = await tmp('worca-cc-pr-api-p3-');
  await withEnv(undefined, async () => {
    await postApi({ projectsRoot: projTarget });
    assert.equal((await postApi({ projectsRoot: fileURLToPath(import.meta.url) })).status, 400);
    assert.equal((await postApi({ projectsRoot: join(home, 'ghost') })).status, 400);
    assert.equal((await getApi()).projectsRoot, projTarget, 'the rejected write changed nothing');
  });
});

test('POST /api/settings: today`s root-only contract is unchanged (a bodyless POST resets root)', async () => {
  const rootTarget = await tmp('worca-cc-pr-api-legacy-');
  await withEnv(undefined, async () => {
    await postApi({ root: rootTarget });
    assert.equal((await (await postApi({})).json()).root, '', 'POST {} still resets the root');
  });
});

// ── the three scalar keys ────────────────────────────────────────────────────

test('scalars: the defaults are 20480 / 65536 / copy', () => {
  assert.equal(DEFAULT_CONTEXT_MAX_BYTES_PER_FILE, 20480);
  assert.equal(DEFAULT_CONTEXT_MAX_BYTES_TOTAL, 65536);
  assert.equal(DEFAULT_SKILL_MOUNT, 'copy');
  assert.equal(contextMaxBytesPerFile(), DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);
  assert.equal(contextMaxBytesTotal(), DEFAULT_CONTEXT_MAX_BYTES_TOTAL);
  assert.equal(skillMount(), DEFAULT_SKILL_MOUNT);
});

test('scalars: round-trip through the setters and through a hand-written settings.json', async () => {
  await setContextMaxBytesPerFile(51200);
  await setContextMaxBytesTotal(131072);
  await setSkillMount('symlink');
  assert.equal(contextMaxBytesPerFile(), 51200);
  assert.equal(contextMaxBytesTotal(), 131072);
  assert.equal(skillMount(), 'symlink');

  // Hand-edited file (these keys are settings-file-only in this phase — no UI).
  await writeSettingsFile({ contextMaxBytesPerFile: 1, contextMaxBytesTotal: 2, skillMount: 'copy' });
  assert.equal(contextMaxBytesPerFile(), 1);
  assert.equal(contextMaxBytesTotal(), 2);
  assert.equal(skillMount(), 'copy');

  // Empty input resets each key to its default.
  await setContextMaxBytesPerFile('');
  await setContextMaxBytesTotal(null);
  await setSkillMount('');
  const s = await readSettingsFile();
  assert.equal('contextMaxBytesPerFile' in s, false);
  assert.equal('contextMaxBytesTotal' in s, false);
  assert.equal('skillMount' in s, false);
  assert.equal(contextMaxBytesPerFile(), DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);
  assert.equal(contextMaxBytesTotal(), DEFAULT_CONTEXT_MAX_BYTES_TOTAL);
  assert.equal(skillMount(), DEFAULT_SKILL_MOUNT);
});

test('scalars: the setters REJECT out-of-range / unknown values and persist nothing', async () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'abc', {}, [], true]) {
    await assert.rejects(() => setContextMaxBytesPerFile(bad), /positive integer/,
      `per-file must reject ${JSON.stringify(bad)}`);
    await assert.rejects(() => setContextMaxBytesTotal(bad), /positive integer/,
      `total must reject ${JSON.stringify(bad)}`);
  }
  for (const bad of ['hardlink', 'COPY', 'sym link', 42, {}, true]) {
    await assert.rejects(() => setSkillMount(bad), /copy|symlink/,
      `skillMount must reject ${JSON.stringify(bad)}`);
  }
  const s = await readSettingsFile();
  assert.deepEqual(s, {}, `no rejected value was persisted: ${JSON.stringify(s)}`);
  assert.equal(contextMaxBytesPerFile(), DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);
  assert.equal(skillMount(), DEFAULT_SKILL_MOUNT);
});

test('scalars: an invalid HAND-WRITTEN value degrades to the default with a named warning', async () => {
  // Reads are never-throwing by module contract (settings.mjs header), so a file a
  // user edited badly must behave like runRootMode()'s invalid-value fallback.
  await writeSettingsFile({ contextMaxBytesPerFile: 0, contextMaxBytesTotal: 'lots', skillMount: 'hardlink' });
  await withWarnings(async (warnings) => {
    assert.equal(contextMaxBytesPerFile(), DEFAULT_CONTEXT_MAX_BYTES_PER_FILE);
    assert.equal(contextMaxBytesTotal(), DEFAULT_CONTEXT_MAX_BYTES_TOTAL);
    assert.equal(skillMount(), DEFAULT_SKILL_MOUNT);
    assert.ok(warnings.some((w) => /contextMaxBytesPerFile/.test(w) && /0/.test(w)),
      `warning names the key and value: ${JSON.stringify(warnings)}`);
    assert.ok(warnings.some((w) => /contextMaxBytesTotal/.test(w) && /lots/.test(w)),
      `warning names the key and value: ${JSON.stringify(warnings)}`);
    assert.ok(warnings.some((w) => /skillMount/.test(w) && /hardlink/.test(w)),
      `warning names the key and value: ${JSON.stringify(warnings)}`);
  });
});

// ── the runRootMode KEY (the reader's precedence is Phase 1's file) ──────────

test('runRootMode: the settings key round-trips through settings.json and feeds runRootMode()', async () => {
  const prevMode = process.env.WORCA_RUN_ROOT;
  delete process.env.WORCA_RUN_ROOT;                 // §6 mode pinning: no env tier here
  const target = await tmp('worca-cc-pr-mode-');
  try {
    await writeSettingsFile({ runRootMode: 'detached', root: '/kept' });
    assert.equal(runRootMode(), 'detached', 'the hand-written key is read');
    assert.equal(readSettings().runRootMode, 'detached');

    // It rides the same read-modify-write object as the Phase-2 keys: a
    // projectsRoot write must not drop the mode.
    await setProjectsRoot(target);
    await setSkillMount('symlink');
    assert.equal(runRootMode(), 'detached', 'runRootMode survived the Phase-2 writes');
    const s = await readSettingsFile();
    assert.equal(s.runRootMode, 'detached');
    assert.equal(s.root, '/kept');
    assert.equal(s.projectsRoot, target);
  } finally {
    if (prevMode === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prevMode;
  }
});
