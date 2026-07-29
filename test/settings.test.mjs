// test/settings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worcaHome } from '../src/core/projects.mjs';
import { getWorcaRoot, setWorcaRoot, settingsFile, defaultRoot } from '../src/core/settings.mjs';
import { _resetForTests } from '../src/core/db.mjs';

// Sandbox BOTH the home (so settingsFile + defaultRoot resolve into a temp dir)
// and clear WORCA_HOME so the settings file is actually consulted. The whole
// suite runs under WORCA_HOME=.worca-cc-test (Task 3); these tests must remove
// that inherited value to exercise the settings tier, then restore it.
async function withSandbox(fn) {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-set-'));
  const prev = {
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
    WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
  };
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  // These tests exercise the settings/home fallback tiers with no WORCA_HOME,
  // which the worcaHome() test-runner guard otherwise forbids. Safe here:
  // HOME/USERPROFILE point into the sandbox, so the fallback cannot reach the
  // real ~/.worca-cc.
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  try { return await fn(home); }
  finally {
    // These tests delete WORCA_HOME + repoint HOME mid-suite. Reset the db.mjs
    // singleton on the way OUT (Task 6.14) so the next file reopens cleanly at
    // .worca-cc-test instead of against a stale/sandbox handle.
    _resetForTests();
    for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
    await rm(home, { recursive: true, force: true });
  }
}

test('default: no settings, no env -> homedir base', async () => {
  await withSandbox(async (home) => {
    assert.equal(getWorcaRoot(), '');
    assert.equal(defaultRoot(), home);
    assert.equal(worcaHome(), join(home, '.worca-cc'));
  });
});

test('settings.json root wins over the home default', async () => {
  await withSandbox(async () => {
    const target = await mkdtemp(join(tmpdir(), 'worca-cc-target-'));
    await setWorcaRoot(target);
    assert.equal(getWorcaRoot(), target);
    assert.equal(worcaHome(), join(target, '.worca-cc'));
    await rm(target, { recursive: true, force: true });
  });
});

test('WORCA_HOME env wins over settings.json', async () => {
  await withSandbox(async () => {
    const target = await mkdtemp(join(tmpdir(), 'worca-cc-target2-'));
    await setWorcaRoot(target);
    const envBase = await mkdtemp(join(tmpdir(), 'worca-cc-env-'));
    process.env.WORCA_HOME = envBase;
    assert.equal(worcaHome(), join(envBase, '.worca-cc'), 'env beats settings');
    delete process.env.WORCA_HOME;
    await rm(target, { recursive: true, force: true });
    await rm(envBase, { recursive: true, force: true });
  });
});

test('reset (empty root) falls back to the home default', async () => {
  await withSandbox(async (home) => {
    const target = await mkdtemp(join(tmpdir(), 'worca-cc-target3-'));
    await setWorcaRoot(target);
    await setWorcaRoot('');           // reset
    assert.equal(getWorcaRoot(), '');
    assert.equal(worcaHome(), join(home, '.worca-cc'));
    await rm(target, { recursive: true, force: true });
  });
});

test('corrupt settings.json -> home default (never throws)', async () => {
  await withSandbox(async (home) => {
    await mkdir(join(home, '.worca-cc'), { recursive: true });
    await writeFile(settingsFile(), '{ not json', 'utf8');
    assert.equal(getWorcaRoot(), '');
    assert.equal(worcaHome(), join(home, '.worca-cc'));
  });
});

test('setWorcaRoot rejects a path that is a file, not a dir', async () => {
  await withSandbox(async (home) => {
    await mkdir(join(home, '.worca-cc'), { recursive: true });
    const f = join(home, 'afile');
    await writeFile(f, 'x', 'utf8');
    await assert.rejects(() => setWorcaRoot(f), /not a directory/);
  });
});
