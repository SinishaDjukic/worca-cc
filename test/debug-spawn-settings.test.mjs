// test/debug-spawn-settings.test.mjs
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  settingsFile, debugSpawnEnabled, setDebugSpawnEnabled,
  applyDebugSpawnEnvFromSettings, DEFAULT_DEBUG_SPAWN_ENABLED,
} from '../src/core/settings.mjs';
import { debugSpawnEnabled as gateEnabled } from '../src/core/claude-runner.mjs';

let home, prevHome, prevProfile, prevGate;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-debug-spawn-'));
  prevHome = process.env.HOME; prevProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
});
beforeEach(async () => {
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(settingsFile(), '{}\n', 'utf8');
});
after(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
  await rm(home, { recursive: true, force: true });
});

test('missing setting reads as OFF (default)', () => {
  assert.equal(debugSpawnEnabled(), false);
  assert.equal(DEFAULT_DEBUG_SPAWN_ENABLED, false);
});

test('corrupt settings.json falls back to OFF, never throws', async () => {
  await writeFile(settingsFile(), '{ not json', 'utf8');
  assert.equal(debugSpawnEnabled(), false);
});

test('corrupt stored value (non-boolean) falls back to OFF loudly', async () => {
  await writeFile(settingsFile(), JSON.stringify({ debugSpawnEnabled: 'yes' }), 'utf8');
  const realWarn = console.warn; const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try { assert.equal(debugSpawnEnabled(), false); } finally { console.warn = realWarn; }
  assert.ok(warnings.some((w) => /debugSpawnEnabled/.test(w)));
});

test('setter round-trips true/false and returns the effective value', async () => {
  assert.deepEqual(await setDebugSpawnEnabled(true), { debugSpawnEnabled: true });
  assert.equal(debugSpawnEnabled(), true);
  assert.deepEqual(await setDebugSpawnEnabled(false), { debugSpawnEnabled: false });
  assert.equal(debugSpawnEnabled(), false);
});

test('setter rejects non-boolean input and persists nothing', async () => {
  await assert.rejects(() => setDebugSpawnEnabled('true'), /must be true or false/);
  const raw = JSON.parse(await readFile(settingsFile(), 'utf8'));
  assert.equal('debugSpawnEnabled' in raw, false);
});

test('unknown keys survive a setter write (read-modify-write)', async () => {
  await writeFile(settingsFile(), JSON.stringify({ someFutureKey: 42 }), 'utf8');
  await setDebugSpawnEnabled(true);
  const raw = JSON.parse(await readFile(settingsFile(), 'utf8'));
  assert.equal(raw.someFutureKey, 42);
  assert.equal(raw.debugSpawnEnabled, true);
});

test('saving the setting flips process.env so claude-runner\'s live gate changes with no restart', async () => {
  prevGate = process.env.WORCA_DEBUG_SPAWN;
  try {
    delete process.env.WORCA_DEBUG_SPAWN;
    assert.equal(gateEnabled(), false, 'sanity: unset env is off');
    await setDebugSpawnEnabled(true);
    assert.equal(gateEnabled(), true, 'flips on with no restart');
    await setDebugSpawnEnabled(false);
    assert.equal(gateEnabled(), false, 'flips back off with no restart');
  } finally {
    if (prevGate === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prevGate;
  }
});

test('applyDebugSpawnEnvFromSettings: an env var already set at launch is NOT overwritten', async () => {
  prevGate = process.env.WORCA_DEBUG_SPAWN;
  try {
    process.env.WORCA_DEBUG_SPAWN = '1'; // "set at launch"
    await setDebugSpawnEnabled(false);   // stored preference disagrees
    // Simulate a fresh process by re-reading only the stored value's effect:
    process.env.WORCA_DEBUG_SPAWN = '1'; // re-assert the launch-time value the real boot would see
    applyDebugSpawnEnvFromSettings();
    assert.equal(process.env.WORCA_DEBUG_SPAWN, '1', 'launch override wins, stored OFF is not applied');
  } finally {
    if (prevGate === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prevGate;
  }
});

test('applyDebugSpawnEnvFromSettings: applies the stored setting when no launch env is present', async () => {
  prevGate = process.env.WORCA_DEBUG_SPAWN;
  try {
    delete process.env.WORCA_DEBUG_SPAWN;
    await setDebugSpawnEnabled(true);
    delete process.env.WORCA_DEBUG_SPAWN; // undo the setter's own env write to isolate the boot helper
    applyDebugSpawnEnvFromSettings();
    assert.equal(process.env.WORCA_DEBUG_SPAWN, '1');
  } finally {
    if (prevGate === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prevGate;
  }
});
