// test/desktop-title-bar.test.mjs — the desktop window's title bar per OS, the shell-state contract with the preload,
// the saved window-shell.json prefs (desktop/src/title-bar.mjs) and the window / tray icon choice (desktop/src/app-icons.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOP_BAR_HEIGHT, THEME_COLORS, TRAFFIC_LIGHTS, TRAFFIC_LIGHTS_SIZE, titleBarChrome, parseShellState, resolveScheme,
  chromeWindowOptions, readShellPrefs, writeShellPrefs, DESKTOP_SHELL_CSS, readDesktopShellCss, titleDoubleClickAction,
  TITLE_DBLCLICK_CHANNEL,
} from '../desktop/src/title-bar.mjs';
import { windowIconFile, trayImageFile, systemUIDark } from '../desktop/src/app-icons.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const withDir = (fn) => { const dir = mkdtempSync(join(tmpdir(), 'desk-shell-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('constants: the top bar is 48px; THEME_COLORS and TRAFFIC_LIGHTS are frozen', () => {
  assert.equal(TOP_BAR_HEIGHT, 48);
  assert.deepEqual(THEME_COLORS, {
    light: { background: '#F1F1EF', overlay: '#FFFFFF', symbol: '#19191B' },
    dark: { background: '#161614', overlay: '#222220', symbol: '#ECECE8' },
  });
  for (const o of [THEME_COLORS, THEME_COLORS.light, THEME_COLORS.dark, TRAFFIC_LIGHTS, TRAFFIC_LIGHTS.expanded, TRAFFIC_LIGHTS.rail]) assert.ok(Object.isFrozen(o));
  assert.deepEqual(TRAFFIC_LIGHTS_SIZE, { width: 52, height: 14 });
});

test('titleBarChrome: darwin inset, win32 overlay, everything else native', () => {
  assert.deepEqual(['darwin', 'win32', 'linux', 'freebsd', undefined].map(titleBarChrome), ['inset', 'overlay', 'native', 'native', 'native']);
});

test('parseShellState: only { mode, scheme, rail } of the right enums and types; extra keys dropped', () => {
  assert.deepEqual(parseShellState({ mode: 'system', scheme: 'dark', rail: false }), { mode: 'system', scheme: 'dark', rail: false });
  assert.deepEqual(parseShellState({ mode: 'light', scheme: 'light', rail: true, background: '#000', __proto__x: 1 }), { mode: 'light', scheme: 'light', rail: true });
  const refused = [
    null, undefined, 'dark', 42, [], ['dark'], { mode: 'dark', scheme: 'dark', rail: 'yes' }, { mode: 'dark', scheme: 'dark' },
    { mode: 'auto', scheme: 'dark', rail: false }, { mode: 'dark', scheme: 'system', rail: false }, { mode: 'DARK', scheme: 'dark', rail: false },
    Object.create({ mode: 'dark', scheme: 'dark', rail: false }), new (class S { constructor() { this.mode = 'dark'; this.scheme = 'dark'; this.rail = false; } })(),
  ];
  for (const v of refused) assert.equal(parseShellState(v), null, JSON.stringify(v));
  Object.prototype.rail = false;   // a polluted prototype must not complete a payload
  try { assert.equal(parseShellState({ mode: 'dark', scheme: 'dark' }), null); } finally { delete Object.prototype.rail; }
  const getter = { scheme: 'dark', rail: false, get mode() { return 'dark'; } };
  assert.deepEqual(parseShellState(getter), { mode: 'dark', scheme: 'dark', rail: false }, 'a plain object is read once per key');
});

test('resolveScheme: an explicit mode wins; system follows the OS', () => {
  assert.equal(resolveScheme('light', true), 'light');
  assert.equal(resolveScheme('dark', false), 'dark');
  assert.equal(resolveScheme('system', true), 'dark');
  assert.equal(resolveScheme('system', false), 'light');
  assert.equal(resolveScheme('bogus', true), 'dark', 'unknown mode = system');
});

test('chromeWindowOptions: exact options per chrome and scheme', () => {
  assert.deepEqual(chromeWindowOptions({ chrome: 'inset', scheme: 'light', rail: false }), { backgroundColor: '#F1F1EF', titleBarStyle: 'hidden', trafficLightPosition: { x: 18, y: 17 } });
  assert.deepEqual(chromeWindowOptions({ chrome: 'inset', scheme: 'dark', rail: true }), { backgroundColor: '#161614', titleBarStyle: 'hidden', trafficLightPosition: { x: 4, y: 9 } });
  assert.deepEqual(chromeWindowOptions({ chrome: 'overlay', scheme: 'light', rail: false }), { backgroundColor: '#F1F1EF', titleBarStyle: 'hidden', titleBarOverlay: { color: '#FFFFFF', symbolColor: '#19191B', height: 48 } });
  assert.deepEqual(chromeWindowOptions({ chrome: 'overlay', scheme: 'dark', rail: true }), { backgroundColor: '#161614', titleBarStyle: 'hidden', titleBarOverlay: { color: '#222220', symbolColor: '#ECECE8', height: 48 } });
  assert.deepEqual(chromeWindowOptions({ chrome: 'native', scheme: 'dark', rail: false }), { backgroundColor: '#161614' });
  assert.deepEqual(chromeWindowOptions({ chrome: 'weird', scheme: 'odd', rail: true }), { backgroundColor: '#F1F1EF' }, 'unknown → native, light');
  const o = chromeWindowOptions({ chrome: 'inset', scheme: 'light', rail: false });
  o.trafficLightPosition.x = 99;
  assert.equal(TRAFFIC_LIGHTS.expanded.x, 18, 'the returned position is a copy');
});

test('readShellPrefs: missing, corrupt and bad-shape files give the default; a round trip with writeShellPrefs', () => withDir((dir) => {
  assert.deepEqual(readShellPrefs(dir), { mode: 'system', rail: false });
  for (const text of ['{nope', '[]', 'null', '"dark"', '{"mode":"dark","rail":"yes"}', '{"mode":"auto","rail":true}', '{"mode":"dark"}']) {
    writeFileSync(join(dir, 'window-shell.json'), text);
    assert.deepEqual(readShellPrefs(dir), { mode: 'system', rail: false }, text);
  }
  assert.deepEqual(readShellPrefs(join(dir, 'missing', 'deeper')), { mode: 'system', rail: false });
  assert.deepEqual(readShellPrefs(undefined), { mode: 'system', rail: false });
  const errors = [];
  writeShellPrefs(dir, { mode: 'dark', rail: true }, { onError: (e) => errors.push(e) });
  assert.deepEqual(errors, []);
  assert.equal(readFileSync(join(dir, 'window-shell.json'), 'utf8'), '{"mode":"dark","rail":true}\n');
  assert.deepEqual(readShellPrefs(dir), { mode: 'dark', rail: true });
}));

test('writeShellPrefs: an unwritable path calls onError and never throws', () => withDir((dir) => {
  const file = join(dir, 'regular-file');
  writeFileSync(file, 'x');
  const errors = [];
  assert.doesNotThrow(() => writeShellPrefs(join(file, 'user-data'), { mode: 'light', rail: false }, { onError: (e) => errors.push(e) }));
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
  assert.doesNotThrow(() => writeShellPrefs(join(file, 'user-data'), { mode: 'light', rail: false }));
}));

test('app icons: the window icon, the tray image per OS and theme, the system UI theme fallback', () => {
  assert.equal(windowIconFile('darwin'), null);
  assert.equal(windowIconFile('win32'), 'icon.png');
  assert.equal(windowIconFile('linux'), 'icon.png');
  assert.equal(trayImageFile({ platform: 'darwin', darkSystemUI: true }), 'trayTemplate.png');
  assert.equal(trayImageFile({ platform: 'darwin', darkSystemUI: false }), 'trayTemplate.png');
  assert.equal(trayImageFile({ platform: 'win32', darkSystemUI: true }), 'tray-white.png');
  assert.equal(trayImageFile({ platform: 'linux', darkSystemUI: false }), 'tray-black.png');
  assert.equal(systemUIDark({ shouldUseDarkColorsForSystemIntegratedUI: true, shouldUseDarkColors: false }), true);
  assert.equal(systemUIDark({ shouldUseDarkColorsForSystemIntegratedUI: false, shouldUseDarkColors: true }), false);
  assert.equal(systemUIDark({ shouldUseDarkColors: true }), true, 'absent API → shouldUseDarkColors');
  assert.equal(systemUIDark({ shouldUseDarkColorsForSystemIntegratedUI: undefined, shouldUseDarkColors: 0 }), false);
  assert.equal(systemUIDark({}), false);
});

test('every file name trayImageFile and windowIconFile can return exists in desktop/assets', () => {
  const names = new Set();
  for (const platform of ['darwin', 'win32', 'linux']) {
    const w = windowIconFile(platform);
    if (w) names.add(w);
    for (const darkSystemUI of [true, false]) names.add(trayImageFile({ platform, darkSystemUI }));
  }
  assert.deepEqual([...names].sort(), ['icon.png', 'tray-black.png', 'tray-white.png', 'trayTemplate.png']);
  for (const n of names) assert.ok(existsSync(join(ROOT, 'desktop/assets', n)), n);
});

test('readDesktopShellCss: the real part from the repo root; missing dir → null; empty → null', () => {
  assert.deepEqual(DESKTOP_SHELL_CSS, ['ui', 'public', 'shell', 'desktop-shell.css']);
  assert.ok(Object.isFrozen(DESKTOP_SHELL_CSS));
  assert.equal(readDesktopShellCss(ROOT), readFileSync(join(ROOT, 'ui/public/shell/desktop-shell.css'), 'utf8'));
  assert.match(readDesktopShellCss(ROOT), /data-shell-chrome="inset"/);
  withDir((dir) => {
    assert.equal(readDesktopShellCss(join(dir, 'missing')), null);
    mkdirSync(join(dir, 'ui', 'public', 'shell'), { recursive: true });
    writeFileSync(join(dir, 'ui', 'public', 'shell', 'desktop-shell.css'), '');
    assert.equal(readDesktopShellCss(dir), null, 'an empty file');
    writeFileSync(join(dir, 'ui', 'public', 'shell', 'desktop-shell.css'), 'a{}');
    assert.equal(readDesktopShellCss(dir), 'a{}');
  });
  const paths = [];
  assert.equal(readDesktopShellCss('/srv', { readFile: (p, enc) => { paths.push([p, enc]); return 'X'; } }), 'X');
  assert.deepEqual(paths, [[join('/srv', 'ui', 'public', 'shell', 'desktop-shell.css'), 'utf8']]);
  assert.equal(readDesktopShellCss('/srv', { readFile: () => { throw new Error('EACCES'); } }), null, 'a read error');
  assert.equal(readDesktopShellCss(undefined), null, 'no root');
});

test('titleDoubleClickAction: macOS follows AppleActionOnDoubleClick (Maximize, Fill, Minimize, None, unset, junk); Windows and Linux toggle maximize', () => {
  const mac = (appleAction) => titleDoubleClickAction({ platform: 'darwin', appleAction });
  assert.equal(mac('Minimize'), 'minimize');
  assert.equal(mac('None'), 'none');
  for (const v of ['Maximize', 'Fill', '', null, undefined, 'minimize', 'none', 'NONE', ' Minimize', 42, true, {}, ['None']]) assert.equal(mac(v), 'maximize', JSON.stringify(v));
  for (const platform of ['win32', 'linux', 'freebsd', undefined]) {
    for (const appleAction of ['Minimize', 'None', null]) assert.equal(titleDoubleClickAction({ platform, appleAction }), 'maximize', `${platform} ${appleAction}`);
  }
  assert.equal(titleDoubleClickAction({}), 'maximize');
  assert.equal(TITLE_DBLCLICK_CHANNEL, 'worca:title-dblclick');
});
