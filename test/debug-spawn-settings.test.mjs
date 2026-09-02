// test/debug-spawn-settings.test.mjs
// The stored spawn-diagnostics preference and the ONE precedence rule the runner
// gate and the settings API share (settings.mjs#effectiveDebugSpawn): a non-empty
// WORCA_DEBUG_SPAWN wins, otherwise the stored value applies. The setter persists
// only — it never writes process.env.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  settingsFile, debugSpawnEnabled, setDebugSpawnEnabled, effectiveDebugSpawn,
  assertDebugSpawnInput, DEFAULT_DEBUG_SPAWN_ENABLED,
} from '../src/core/settings.mjs';
import { debugSpawnEnabled as gateEnabled } from '../src/core/claude-runner.mjs';

let home, prevHome, prevProfile, prevGate;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-debug-spawn-'));
  prevHome = process.env.HOME; prevProfile = process.env.USERPROFILE; prevGate = process.env.WORCA_DEBUG_SPAWN;
  process.env.HOME = home; process.env.USERPROFILE = home;
});
beforeEach(async () => {
  delete process.env.WORCA_DEBUG_SPAWN;            // every test starts with no env override
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  await writeFile(settingsFile(), '{}\n', 'utf8');
});
after(async () => {
  if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
  if (prevGate === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prevGate;
  await rm(home, { recursive: true, force: true });
});

/** Run `fn` with WORCA_DEBUG_SPAWN set to `value` (undefined = unset), restoring after. */
async function withGate(value, fn) {
  const prev = process.env.WORCA_DEBUG_SPAWN;
  if (value === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = value;
  try { return await fn(); }
  finally { if (prev === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prev; }
}

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

test('setter round-trips true/false, returns the stored value, and never touches process.env', async () => {
  assert.deepEqual(await setDebugSpawnEnabled(true), { debugSpawnEnabled: true });
  assert.equal(debugSpawnEnabled(), true);
  assert.equal(process.env.WORCA_DEBUG_SPAWN, undefined, 'no env write on true');
  assert.deepEqual(await setDebugSpawnEnabled(false), { debugSpawnEnabled: false });
  assert.equal(debugSpawnEnabled(), false);
  assert.equal(process.env.WORCA_DEBUG_SPAWN, undefined, 'no env write on false (no leaked "0" into child envs)');
  const raw = JSON.parse(await readFile(settingsFile(), 'utf8'));
  assert.equal('debugSpawnEnabled' in raw, false, 'the default is stored as absence');
});

test('setter rejects non-boolean input and persists nothing; assertDebugSpawnInput is the same rule', async () => {
  await assert.rejects(() => setDebugSpawnEnabled('true'), /must be true or false/);
  const raw = JSON.parse(await readFile(settingsFile(), 'utf8'));
  assert.equal('debugSpawnEnabled' in raw, false);
  assert.throws(() => assertDebugSpawnInput('on'), /debugSpawnEnabled must be true or false/);
  assert.throws(() => assertDebugSpawnInput(1), /must be true or false/);
  assert.doesNotThrow(() => assertDebugSpawnInput(true));
  assert.doesNotThrow(() => assertDebugSpawnInput(false));
});

test('unknown keys survive a setter write (read-modify-write)', async () => {
  await writeFile(settingsFile(), JSON.stringify({ someFutureKey: 42 }), 'utf8');
  await setDebugSpawnEnabled(true);
  const raw = JSON.parse(await readFile(settingsFile(), 'utf8'));
  assert.equal(raw.someFutureKey, 42);
  assert.equal(raw.debugSpawnEnabled, true);
});

test('effectiveDebugSpawn: env unset ⇒ the stored value, source "settings"; the runner gate follows with no restart', async () => {
  assert.deepEqual(effectiveDebugSpawn(), { enabled: false, source: 'settings' });
  assert.equal(gateEnabled(), false, 'sanity: unset env + default setting is off');
  await setDebugSpawnEnabled(true);
  assert.deepEqual(effectiveDebugSpawn(), { enabled: true, source: 'settings' });
  assert.equal(gateEnabled(), true, 'the runner sees the saved setting on its next read');
  await setDebugSpawnEnabled(false);
  assert.equal(gateEnabled(), false, 'and flips back');
});

test('effectiveDebugSpawn: a NON-EMPTY env value wins over the stored value, in both directions', async () => {
  await setDebugSpawnEnabled(false);
  await withGate('1', () => {
    assert.deepEqual(effectiveDebugSpawn(), { enabled: true, source: 'env' });
    assert.equal(gateEnabled(), true);
  });
  await setDebugSpawnEnabled(true);
  for (const off of ['0', 'false']) {
    await withGate(off, () => {
      assert.deepEqual(effectiveDebugSpawn(), { enabled: false, source: 'env' }, `an exported ${JSON.stringify(off)} is an explicit OFF override`);
      assert.equal(gateEnabled(), false);
    });
  }
});

test('effectiveDebugSpawn: an EMPTY env export is not an override — the stored value still applies', async () => {
  await setDebugSpawnEnabled(true);
  await withGate('', () => {
    assert.deepEqual(effectiveDebugSpawn(), { enabled: true, source: 'settings' });
    assert.equal(gateEnabled(), true);
  });
});

test('a UI save while the env overrides: stored changes, effective does not, env untouched', async () => {
  await withGate('1', async () => {
    await setDebugSpawnEnabled(false);
    assert.equal(debugSpawnEnabled(), false, 'stored');
    assert.deepEqual(effectiveDebugSpawn(), { enabled: true, source: 'env' }, 'launch override still in force');
    assert.equal(process.env.WORCA_DEBUG_SPAWN, '1', 'the env var is untouched');
  });
});
