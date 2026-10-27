// test/settings-keep-awake.test.mjs — the keepAwake setting (docs/keep-awake.md), graduated from the keepAwake flag.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keepAwakeEnabled, setKeepAwake, assertKeepAwakeInput, migrateLegacyKeepAwakeFlag, migrateKeepAwakeFlag,
  settingsFile, readSettings, SETTINGS_POST_KEYS } from '../src/core/settings.mjs';

let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-keepawake-'));
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = home; }
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});

test('keepAwake: on by default; only false is stored; POST /api/settings knows the key', async () => {
  writeFileSync(settingsFile(), '{}');
  assert.equal(keepAwakeEnabled(), true);
  assert.deepEqual(await setKeepAwake(false), { keepAwake: false });
  assert.equal(readSettings().keepAwake, false);
  assert.deepEqual(await setKeepAwake(true), { keepAwake: true });
  assert.equal('keepAwake' in readSettings(), false);
  assert.ok(SETTINGS_POST_KEYS.includes('keepAwake'));
});

test('keepAwake: a boolean only', async () => {
  for (const bad of [null, 'false', 0, {}]) {
    assert.throws(() => assertKeepAwakeInput(bad), /keepAwake must be true or false/);
    await assert.rejects(setKeepAwake(bad), /keepAwake must be true or false/);
  }
});

test('the old flag: false becomes keepAwake false, true just goes; other flags stay', async () => {
  writeFileSync(settingsFile(), JSON.stringify({ flags: { keepAwake: false, smartRunNaming: true } }));
  assert.equal(await migrateKeepAwakeFlag(), true);
  const s = JSON.parse(readFileSync(settingsFile(), 'utf8'));
  assert.deepEqual(s, { flags: { smartRunNaming: true }, keepAwake: false });
  assert.equal(await migrateKeepAwakeFlag(), false, 'a second start changes nothing');
  assert.deepEqual(migrateLegacyKeepAwakeFlag({ flags: { keepAwake: true } }), { changed: true, settings: {} });
  assert.deepEqual(migrateLegacyKeepAwakeFlag({ theme: 'dark' }), { changed: false, settings: { theme: 'dark' } });
});

test('a stored keepAwake wins over a leftover flag; an unwritable home still reads the flag', () => {
  assert.deepEqual(migrateLegacyKeepAwakeFlag({ flags: { keepAwake: false }, keepAwake: true }).settings, { keepAwake: true });
  assert.equal(keepAwakeEnabled({ flags: { keepAwake: false } }), false);
  assert.equal(keepAwakeEnabled({ flags: { keepAwake: false }, keepAwake: true }), true);
  assert.equal(keepAwakeEnabled({}), true);
});
