// test/theme-settings.test.mjs — the stored theme mode (spec §6.1): system|light|dark,
// default system, invalid stored value ⇒ default loudly, the setter persists and
// deletes the key for the default, and the POST key list knows it.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  settingsFile, theme, setTheme, assertThemeInput, THEME_MODES, DEFAULT_THEME, SETTINGS_POST_KEYS,
} from '../src/core/settings.mjs';

let home, prevHome, prevProfile;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-theme-settings-'));
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

test('THEME_MODES and the default', () => {
  assert.deepEqual([...THEME_MODES], ['system', 'light', 'dark']);
  assert.equal(DEFAULT_THEME, 'system');
  assert.equal(theme(), 'system', 'absent ⇒ default');
});

test('a stored valid mode is returned; an invalid one warns and yields the default', async () => {
  await writeFile(settingsFile(), JSON.stringify({ theme: 'dark' }), 'utf8');
  assert.equal(theme(), 'dark');
  await writeFile(settingsFile(), JSON.stringify({ theme: 'blue' }), 'utf8');
  const warned = [];
  const orig = console.warn; console.warn = (m) => warned.push(String(m));
  try { assert.equal(theme(), 'system'); } finally { console.warn = orig; }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /invalid theme "blue"/);
});

test('assertThemeInput: the three modes and a clear pass; anything else throws', () => {
  for (const v of ['system', 'light', 'dark', '', null, undefined]) assert.doesNotThrow(() => assertThemeInput(v), String(v));
  for (const v of ['blue', 'Dark', 1, true, {}, ['dark']]) assert.throws(() => assertThemeInput(v), /theme must be system, light or dark/, String(v));
});

test('setTheme persists a non-default mode and deletes the key for the default or a clear', async () => {
  assert.deepEqual(await setTheme('dark'), { theme: 'dark' });
  assert.equal(JSON.parse(await readFile(settingsFile(), 'utf8')).theme, 'dark');
  assert.deepEqual(await setTheme('system'), { theme: 'system' });
  assert.equal('theme' in JSON.parse(await readFile(settingsFile(), 'utf8')), false, 'default ⇒ key deleted');
  await setTheme('light');
  await setTheme('');
  assert.equal('theme' in JSON.parse(await readFile(settingsFile(), 'utf8')), false, 'clear ⇒ key deleted');
  await assert.rejects(() => setTheme('blue'), /theme must be system, light or dark/);
});

test('setTheme leaves every other key alone', async () => {
  await writeFile(settingsFile(), JSON.stringify({ hideBuiltinModels: true, askMaxTurns: 7 }), 'utf8');
  await setTheme('dark');
  assert.deepEqual(JSON.parse(await readFile(settingsFile(), 'utf8')), { hideBuiltinModels: true, askMaxTurns: 7, theme: 'dark' });
});

test('the POST key list names theme (a theme-only POST must not clear root)', () => {
  assert.ok(SETTINGS_POST_KEYS.includes('theme'));
});
