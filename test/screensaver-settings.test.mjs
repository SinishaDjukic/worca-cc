// test/screensaver-settings.test.mjs — the Settings › Appearance screensaver setting { enabled, idleMinutes }.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screensaverSettings, setScreensaver, assertScreensaverInput, SCREENSAVER_IDLE_MINUTES, DEFAULT_SCREENSAVER,
  settingsFile, readSettings, SETTINGS_POST_KEYS } from '../src/core/settings.mjs';

let home; const prev = {};
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-screensaver-'));
  for (const k of ['HOME', 'USERPROFILE']) { prev[k] = process.env[k]; process.env[k] = home; }
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});

test('defaults: nothing stored reads { enabled:false, idleMinutes:5 }', () => {
  writeFileSync(settingsFile(), '{}');
  assert.deepEqual(screensaverSettings(), { enabled: false, idleMinutes: 5 });
  assert.deepEqual(DEFAULT_SCREENSAVER, { enabled: false, idleMinutes: 5 });
  assert.deepEqual(SCREENSAVER_IDLE_MINUTES, [5, 10, 15, 20, 25, 30]);
});

test("assertScreensaverInput: rejects a non-object, an unknown field, a non-boolean enabled, and 0/7/35/'10' minutes", async () => {
  for (const bad of [[], 'on', 5, true]) {
    assert.throws(() => assertScreensaverInput(bad), { message: 'screensaver must be an object with enabled and the minutes' });
  }
  assert.throws(() => assertScreensaverInput({ enabled: true, x: 1, y: 2 }), { message: 'screensaver has an unknown field "x"' });
  for (const bad of ['true', 1, null]) {
    assert.throws(() => assertScreensaverInput({ enabled: bad }), { message: 'screensaver.enabled must be true or false' });
  }
  for (const bad of [0, 7, 35, '10', null]) {
    assert.throws(() => assertScreensaverInput({ idleMinutes: bad }), { message: 'screensaver.idleMinutes must be 5, 10, 15, 20, 25 or 30' });
  }
  writeFileSync(settingsFile(), '{}');
  await assert.rejects(setScreensaver({ idleMinutes: 7 }), /screensaver\.idleMinutes must be/);
  assert.equal('screensaver' in readSettings(), false, 'a refusal writes nothing');
});

test('assertScreensaverInput: accepts {}, clears and each allowed minute', () => {
  for (const ok of [{}, null, '', undefined, { enabled: true }, { enabled: false }]) assertScreensaverInput(ok);
  for (const m of SCREENSAVER_IDLE_MINUTES) assertScreensaverInput({ enabled: true, idleMinutes: m });
});

test('only non-default fields are stored; all-default removes the key', async () => {
  writeFileSync(settingsFile(), '{}');
  assert.deepEqual(await setScreensaver({ enabled: false }), { screensaver: { enabled: false, idleMinutes: 5 } });
  assert.equal('screensaver' in readSettings(), false);
  await setScreensaver({ idleMinutes: 5 });
  assert.equal('screensaver' in readSettings(), false);
  assert.deepEqual(await setScreensaver({ enabled: true }), { screensaver: { enabled: true, idleMinutes: 5 } });
  assert.deepEqual(readSettings().screensaver, { enabled: true });
  await setScreensaver({ enabled: true, idleMinutes: 15 });
  assert.deepEqual(readSettings().screensaver, { enabled: true, idleMinutes: 15 });
  await setScreensaver({ enabled: false, idleMinutes: 5 });
  assert.equal('screensaver' in readSettings(), false);
  await setScreensaver({ enabled: true, idleMinutes: 30 });
  assert.deepEqual(await setScreensaver(null), { screensaver: { enabled: false, idleMinutes: 5 } });
  assert.equal('screensaver' in readSettings(), false, 'a clear deletes the key');
});

test('a partial save keeps the other field', async () => {
  writeFileSync(settingsFile(), JSON.stringify({ screensaver: { enabled: true, idleMinutes: 20 }, theme: 'dark' }));
  assert.deepEqual(await setScreensaver({ idleMinutes: 10 }), { screensaver: { enabled: true, idleMinutes: 10 } });
  assert.deepEqual(await setScreensaver({}), { screensaver: { enabled: true, idleMinutes: 10 } });
  assert.deepEqual(await setScreensaver({ enabled: false }), { screensaver: { enabled: false, idleMinutes: 10 } });
  assert.deepEqual(readSettings(), { screensaver: { idleMinutes: 10 }, theme: 'dark' });
});

test('an invalid stored value reads as the default', () => {
  const warn = console.warn; const warned = [];
  console.warn = (m) => warned.push(String(m));
  try {
    assert.deepEqual(screensaverSettings({ screensaver: { enabled: 'yes', idleMinutes: 7 } }), { enabled: false, idleMinutes: 5 });
    assert.deepEqual(screensaverSettings({ screensaver: { enabled: true, idleMinutes: 7 } }), { enabled: true, idleMinutes: 5 });
    assert.deepEqual(screensaverSettings({ screensaver: 'on' }), { enabled: false, idleMinutes: 5 });
  } finally { console.warn = warn; }
  assert.ok(warned.length >= 3 && warned.every((m) => /screensaver/.test(m)), warned.join('\n'));
});

test('SETTINGS_POST_KEYS lists screensaver', () => {
  assert.ok(SETTINGS_POST_KEYS.includes('screensaver'));
});
