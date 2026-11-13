// test/desktop-app-menu.test.mjs — the macOS application menu, the About panel options and the version they show
// (desktop/src/app-menu.mjs). Pure helpers: no electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, appMenuTemplate, aboutPanelOptions, readRootVersion, aboutVersion, devIconPath } from '../desktop/src/app-menu.mjs';
import { desktopBuilderConfig } from '../tools/build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const roles = (menu) => menu.submenu.map((i) => i.role || i.type);
const byLabel = (t, label) => t.find((m) => m.label === label);

test('APP_NAME equals desktop/package.json productName and the builder productName (the userData folder name)', () => {
  assert.equal(APP_NAME, 'Worca');
  const d = JSON.parse(readFileSync(join(ROOT, 'desktop/package.json'), 'utf8'));
  assert.equal(APP_NAME, d.productName);
  assert.equal(APP_NAME, desktopBuilderConfig({ version: '1.0.0', platform: 'mac', arch: 'arm64', signed: false, notarize: false }).productName);
});

test('appMenuTemplate: Worca/Edit/View/Window in order; About/Hide/Quit Worca labels with their roles; services, hideOthers, unhide', () => {
  const t = appMenuTemplate({ packaged: true });
  assert.deepEqual(t.map((m) => m.label), ['Worca', 'Edit', 'View', 'Window']);
  const app = t[0];
  assert.deepEqual(roles(app), ['about', 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit']);
  const label = (role) => app.submenu.find((i) => i.role === role).label;
  assert.deepEqual([label('about'), label('hide'), label('quit')], ['About Worca', 'Hide Worca', 'Quit Worca']);
  for (const i of app.submenu.filter((x) => x.type === 'separator')) assert.ok(!('role' in i));
  assert.deepEqual(appMenuTemplate({ appName: 'Other', packaged: true })[0].submenu.filter((i) => i.label).map((i) => i.label), ['About Other', 'Hide Other', 'Quit Other']);
  assert.equal(appMenuTemplate({ appName: 'Other', packaged: true })[0].label, 'Other');
});

test('appMenuTemplate Edit: undo, redo, cut, copy, paste, pasteAndMatchStyle, delete, selectAll roles', () => {
  assert.deepEqual(roles(byLabel(appMenuTemplate({ packaged: true }), 'Edit')),
    ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']);
});

test('appMenuTemplate View: reload, resetZoom, zoomIn, zoomOut, togglefullscreen; toggleDevTools only when unpackaged', () => {
  const base = ['reload', 'separator', 'resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen'];
  assert.deepEqual(roles(byLabel(appMenuTemplate({ packaged: true }), 'View')), base);
  assert.deepEqual(roles(byLabel(appMenuTemplate({ packaged: false }), 'View')), [...base, 'separator', 'toggleDevTools']);
  assert.deepEqual(roles(byLabel(appMenuTemplate({}), 'View')), [...base, 'separator', 'toggleDevTools'], 'packaged falsy');
  for (const packaged of [true, false]) {
    assert.ok(!roles(byLabel(appMenuTemplate({ packaged }), 'View')).includes('forceReload'));
  }
});

test('appMenuTemplate Window: role window; minimize, zoom, close, front', () => {
  const w = byLabel(appMenuTemplate({ packaged: true }), 'Window');
  assert.equal(w.role, 'window');
  assert.deepEqual(roles(w), ['minimize', 'zoom', 'close', 'separator', 'front']);
});

test('appMenuTemplate: no click functions (roles only), and a second call is deep-equal', () => {
  for (const packaged of [true, false]) {
    const t = appMenuTemplate({ packaged });
    for (const m of t) {
      assert.ok(!('click' in m));
      for (const i of m.submenu) {
        assert.ok(!('click' in i), JSON.stringify(i));
        assert.ok(i.type === 'separator' || typeof i.role === 'string', JSON.stringify(i));
      }
    }
    assert.deepEqual(appMenuTemplate({ packaged }), t);
    assert.notEqual(appMenuTemplate({ packaged }), t, 'a fresh array per call');
  }
});

test('aboutPanelOptions: name, version twice, iconPath; iconPath omitted when absent', () => {
  assert.deepEqual(aboutPanelOptions({ version: '1.2.3', iconPath: '/i.png' }), { applicationName: 'Worca', applicationVersion: '1.2.3', version: '1.2.3', iconPath: '/i.png' });
  assert.deepEqual(aboutPanelOptions({ version: '1.2.3' }), { applicationName: 'Worca', applicationVersion: '1.2.3', version: '1.2.3' });
  assert.ok(!('iconPath' in aboutPanelOptions({ version: '1', iconPath: '' })));
  assert.equal(aboutPanelOptions({ appName: 'Other', version: '1' }).applicationName, 'Other');
});

test('readRootVersion: reads ../package.json; null on missing file, bad JSON, empty version (never throws)', () => {
  const reads = [];
  const read = (text) => (p, enc) => { reads.push([p, enc]); if (text instanceof Error) throw text; return text; };
  assert.equal(readRootVersion('/a/desktop', { read: read('{"version":"9.8.7"}') }), '9.8.7');
  assert.deepEqual(reads[0], [resolve('/a/desktop', '..', 'package.json'), 'utf8']);
  assert.equal(readRootVersion('/a/desktop', { read: read(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })) }), null);
  assert.equal(readRootVersion('/a/desktop', { read: read('{not json') }), null);
  assert.equal(readRootVersion('/a/desktop', { read: read('{"version":""}') }), null);
  assert.equal(readRootVersion('/a/desktop', { read: read('{"version":3}') }), null);
  assert.equal(readRootVersion('/a/desktop', { read: read('{}') }), null);
  assert.equal(readRootVersion('/a/desktop', { read: read('null') }), null);
  const rootVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  assert.equal(readRootVersion(join(ROOT, 'desktop')), rootVersion);
});

test('aboutVersion: packaged → app version; dev → root version, else app version', () => {
  assert.equal(aboutVersion({ packaged: true, appVersion: '2.0.0', rootVersion: '1.2.3' }), '2.0.0');
  assert.equal(aboutVersion({ packaged: false, appVersion: '0.0.0', rootVersion: '1.2.3' }), '1.2.3');
  assert.equal(aboutVersion({ packaged: false, appVersion: '0.0.0', rootVersion: null }), '0.0.0');
});

test('devIconPath: build-resources/icon.png under the desktop dir', () => {
  assert.equal(devIconPath('/app/desktop'), join('/app/desktop', 'build-resources', 'icon.png'));
});
